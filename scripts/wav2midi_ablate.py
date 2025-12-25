from __future__ import annotations

# --- [Fix] ensure repo root on sys.path so `import core` works when running from scripts/ ---
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
# -----------------------------------------------------------------------------------------

import argparse
import csv
import json
import subprocess
import shutil
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np
import librosa

try:
    import soundfile as sf
    _HAS_SF = True
except Exception:
    sf = None
    _HAS_SF = False

# optional: highpass
try:
    from scipy.signal import butter, sosfilt  # type: ignore
    _HAS_SCIPY = True
except Exception:
    _HAS_SCIPY = False

from core.ai_converter import audio_to_midi  # uses your project wrapper (basic_pitch or stub)


@dataclass
class Variant:
    name: str
    do_mono: bool = True
    resample_sr: Optional[int] = 22050
    norm: str = "none"      # none|peak|rms
    peak: float = 0.99
    rms: float = 0.08
    highpass_hz: float = 0.0


def to_mono(y: np.ndarray) -> np.ndarray:
    if y.ndim == 1:
        return y
    # librosa.load(mono=False) => shape can be (channels, n)
    return np.mean(y, axis=0)


def peak_norm(y: np.ndarray, peak: float) -> np.ndarray:
    m = float(np.max(np.abs(y))) if y.size else 0.0
    if m <= 1e-12:
        return y
    return (y * (peak / m)).astype(np.float32)


def rms_norm(y: np.ndarray, target: float) -> np.ndarray:
    r = float(np.sqrt(np.mean(y * y))) if y.size else 0.0
    if r <= 1e-12:
        return y
    return (y * (target / r)).astype(np.float32)


def highpass(y: np.ndarray, sr: int, hz: float) -> np.ndarray:
    if hz <= 0:
        return y
    if not _HAS_SCIPY:
        return y
    sos = butter(4, hz / (sr / 2.0), btype="highpass", output="sos")
    return sosfilt(sos, y).astype(np.float32)


def _ensure_frames_channels(y: np.ndarray) -> np.ndarray:
    """
    soundfile expects shape (frames, channels) for 2D audio.
    librosa with mono=False often yields (channels, frames).
    """
    if y.ndim != 2:
        return y
    # if first dim looks like channels (1..8) and second dim is long => transpose
    if y.shape[0] <= 8 and y.shape[1] > y.shape[0]:
        return y.T
    return y


def write_wav(path: Path, y: np.ndarray, sr: int) -> None:
    """
    Robust WAV writer:
    1) try soundfile with explicit format='WAV'
    2) fallback to built-in wave module (PCM16)
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    sr = int(sr)

    y = np.asarray(y)
    if y.dtype != np.float32:
        y = y.astype(np.float32)

    y2 = _ensure_frames_channels(y)

    # try soundfile first
    if _HAS_SF:
        try:
            sf.write(str(path), y2, sr, subtype="PCM_16", format="WAV")
            return
        except Exception:
            pass

    # fallback: wave module
    import wave

    # convert float32 [-1,1] -> int16
    y_clip = np.clip(y2, -1.0, 1.0)
    pcm = (y_clip * 32767.0).astype(np.int16)

    if pcm.ndim == 1:
        n_channels = 1
        interleaved = pcm.tobytes()
    else:
        # pcm is (frames, channels)
        n_channels = pcm.shape[1]
        interleaved = pcm.tobytes()

    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(n_channels)
        wf.setsampwidth(2)  # int16
        wf.setframerate(sr)
        wf.writeframes(interleaved)


def midi_note_ons(midi_path: Path) -> List[Tuple[float, int, int]]:
    import mido  # type: ignore
    mid = mido.MidiFile(str(midi_path))
    tpb = mid.ticks_per_beat
    tempo = 500000  # default 120bpm
    out: List[Tuple[float, int, int]] = []
    for tr in mid.tracks:
        t = 0
        for msg in tr:
            t += msg.time
            if msg.type == "set_tempo":
                tempo = msg.tempo
            if msg.type == "note_on" and int(msg.velocity) > 0:
                sec = (t * tempo) / (tpb * 1_000_000.0)
                out.append((float(sec), int(msg.note), int(msg.velocity)))
    out.sort(key=lambda x: (x[0], x[1]))
    return out


def synth_mp3(midi_path: Path, mp3_dir: Path, out_name: str, gain: float = 0.8) -> Optional[Path]:
    """
    Use CLI synth into a temp folder to avoid picking the wrong mp3 when mp3_dir already has many files.
    Then move to mp3/<variant>.mp3.
    """
    mp3_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir = mp3_dir / "_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable, "-m", "hum2song.cli",
        "synth", str(midi_path),
        "--format", "mp3",
        "--out-dir", str(tmp_dir),
        "--gain", str(gain),
    ]
    subprocess.run(cmd, capture_output=True, text=True)

    mp3s = sorted(tmp_dir.glob("*.mp3"), key=lambda x: x.stat().st_mtime, reverse=True)
    if not mp3s:
        return None

    produced = mp3s[0]
    target = mp3_dir / f"{out_name}.mp3"

    try:
        if target.exists():
            target.unlink()
        produced.replace(target)
    except Exception:
        target.write_bytes(produced.read_bytes())

    # clean temp
    try:
        for p in tmp_dir.glob("*"):
            p.unlink()
        tmp_dir.rmdir()
    except Exception:
        pass

    return target


def ensure_dirs(out_root: Path) -> Dict[str, Path]:
    out_root.mkdir(parents=True, exist_ok=True)
    d = {
        "wav": out_root / "wav",
        "midi": out_root / "midi",
        "mp3": out_root / "mp3",
        "logs": out_root / "logs",
    }
    for p in d.values():
        p.mkdir(parents=True, exist_ok=True)
    return d


def run_variant(in_wav: Path, dirs: Dict[str, Path], v: Variant) -> Dict:
    # 1) load (no trim)
    y, sr = librosa.load(str(in_wav), sr=None, mono=False)
    y = np.asarray(y, dtype=np.float32)

    if v.do_mono:
        y = to_mono(y)

    if v.resample_sr is not None and int(sr) != int(v.resample_sr):
        y = librosa.resample(y, orig_sr=int(sr), target_sr=int(v.resample_sr)).astype(np.float32)
        sr = int(v.resample_sr)

    if v.highpass_hz > 0:
        y = highpass(y, int(sr), float(v.highpass_hz)).astype(np.float32)

    if v.norm == "peak":
        y = peak_norm(y, float(v.peak))
    elif v.norm == "rms":
        y = rms_norm(y, float(v.rms))
        y = peak_norm(y, float(v.peak))

    # 2) write processed wav: wav/<variant>.wav
    wav_out = dirs["wav"] / f"{v.name}.wav"
    write_wav(wav_out, y, int(sr))

    # 3) wav -> midi into midi/<variant>.mid
    midi_path = audio_to_midi(wav_out, output_dir=dirs["midi"])
    midi_out = dirs["midi"] / f"{v.name}.mid"
    if Path(midi_path).exists() and Path(midi_path).resolve() != midi_out.resolve():
        try:
            Path(midi_path).replace(midi_out)
        except Exception:
            midi_out.write_bytes(Path(midi_path).read_bytes())

    # 4) synth -> mp3/<variant>.mp3
    mp3_out = synth_mp3(midi_out, dirs["mp3"], out_name=v.name, gain=0.8)

    # 5) stats
    try:
        notes = midi_note_ons(midi_out)
    except Exception:
        notes = []

    pitches = [p for _, p, _ in notes]
    first_onset = notes[0][0] if notes else None

    # 6) log
    log_txt = (
        f"variant={v.name}\n"
        f"input_wav={in_wav}\n"
        f"mono={v.do_mono}\n"
        f"resample_sr={v.resample_sr}\n"
        f"norm={v.norm}\n"
        f"peak={v.peak}\n"
        f"rms={v.rms}\n"
        f"highpass_hz={v.highpass_hz}\n"
        f"has_scipy={_HAS_SCIPY}\n"
        f"has_soundfile={_HAS_SF}\n"
        f"midi_notes={len(notes)}\n"
        f"low_pitch_notes_lt50={sum(1 for p in pitches if p < 50)}\n"
        f"first_onset_sec={first_onset}\n"
        f"wav_out={wav_out}\n"
        f"midi_out={midi_out}\n"
        f"mp3_out={mp3_out}\n"
    )
    (dirs["logs"] / f"{v.name}.log.txt").write_text(log_txt, encoding="utf-8")

    return {
        "variant": v.name,
        "wav": str(wav_out),
        "midi": str(midi_out),
        "mp3": str(mp3_out) if mp3_out else None,
        "notes": len(notes),
        "uniq_pitches": len(set(pitches)) if pitches else 0,
        "first_onset_sec": float(first_onset) if first_onset is not None else None,
        "low_pitch_notes_lt50": int(sum(1 for p in pitches if p < 50)),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_wav", required=True)
    ap.add_argument("--out", dest="out_dir", default="outputs/ablate_wav2midi")
    ap.add_argument("--clean", action="store_true", help="Delete output dir before running")
    args = ap.parse_args()

    in_wav = Path(args.in_wav).resolve()
    out_dir = Path(args.out_dir).resolve()

    if args.clean and out_dir.exists():
        shutil.rmtree(out_dir, ignore_errors=True)

    dirs = ensure_dirs(out_dir)

    variants = [
        Variant("v0_raw", do_mono=False, resample_sr=None, norm="none", highpass_hz=0.0),
        Variant("v1_mono_only", do_mono=True, resample_sr=None, norm="none", highpass_hz=0.0),
        Variant("v2_resample_only", do_mono=True, resample_sr=22050, norm="none", highpass_hz=0.0),
        Variant("v3_peak_norm", do_mono=True, resample_sr=22050, norm="peak", highpass_hz=0.0),
        Variant("v4_rms_norm", do_mono=True, resample_sr=22050, norm="rms", highpass_hz=0.0),
        Variant("v5_hp60_peak", do_mono=True, resample_sr=22050, norm="peak", highpass_hz=60.0),
        Variant("v6_hp120_peak", do_mono=True, resample_sr=22050, norm="peak", highpass_hz=120.0),
    ]

    rows: List[Dict] = []
    for v in variants:
        rows.append(run_variant(in_wav, dirs, v))

    # summary
    (out_dir / "summary.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    with (out_dir / "summary.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    print(f"✅ Done: {out_dir}")
    print(f"🎧 Listen mp3 here: {dirs['mp3']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
