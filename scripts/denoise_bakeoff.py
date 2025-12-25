from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

# Project deps usually already have these
import librosa
import soundfile as sf
from scipy.signal import butter, sosfilt


@dataclass
class Variant:
    key: str
    desc: str


DEFAULT_VARIANTS = [
    Variant("baseline_peak", "Decode->mono->resample->peak normalize (≈当前clean逻辑)"),
    Variant("hp120_rms", "High-pass 120Hz + RMS normalize（更保守，常能减低频嗡声）"),
    Variant("hp120_rms_nr", "hp120_rms + spectral reduce（需 pip install noisereduce）"),
]


def load_mono(path: Path, sr: int, max_seconds: float) -> Tuple[np.ndarray, int]:
    y, _sr = librosa.load(str(path), sr=sr, mono=True, duration=max_seconds)
    if y.size == 0:
        raise ValueError(f"Loaded empty audio: {path}")
    return y.astype(np.float32), sr


def peak_normalize(y: np.ndarray, peak: float = 0.99) -> np.ndarray:
    m = float(np.max(np.abs(y))) if y.size else 0.0
    if m <= 0:
        return y
    return (y * (peak / m)).astype(np.float32)


def rms_normalize(y: np.ndarray, target_rms: float = 0.08) -> np.ndarray:
    rms = float(np.sqrt(np.mean(y * y))) if y.size else 0.0
    if rms <= 1e-12:
        return y
    return (y * (target_rms / rms)).astype(np.float32)


def highpass(y: np.ndarray, sr: int, cutoff_hz: float = 120.0) -> np.ndarray:
    # 4th-order Butterworth high-pass
    sos = butter(4, cutoff_hz / (sr / 2.0), btype="highpass", output="sos")
    return sosfilt(sos, y).astype(np.float32)


def maybe_noisereduce(y: np.ndarray, sr: int) -> Optional[np.ndarray]:
    try:
        import noisereduce as nr  # type: ignore
    except Exception:
        return None
    # Conservative settings: don't overkill (avoid harming pitch contours)
    out = nr.reduce_noise(y=y, sr=sr, prop_decrease=0.75)
    return out.astype(np.float32)


def write_wav(path: Path, y: np.ndarray, sr: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), y, sr, subtype="PCM_16")


def run_cli_generate(wav_path: Path, out_dir: Path, fmt: str, host: str) -> Tuple[Optional[str], str]:
    """
    Calls: python -m hum2song.cli generate <wav> --format mp3 --out-dir <out_dir> --download-midi
    Returns: (task_id or None, combined stdout/stderr)
    """
    cmd = [
        sys.executable,
        "-m",
        "hum2song.cli",
        "generate",
        str(wav_path),
        "--format",
        fmt,
        "--out-dir",
        str(out_dir),
        "--download-midi",
    ]
    # If your CLI reads base_url from env, set it here; otherwise ignore.
    env = dict(**os.environ)
    env["H2S_BASE_URL"] = host

    p = subprocess.run(cmd, capture_output=True, text=True, env=env)
    out = (p.stdout or "") + "\n" + (p.stderr or "")
    m = re.search(r"task_id=([0-9a-fA-F-]{36})", out)
    tid = m.group(1) if m else None
    return tid, out


def midi_stats(midi_path: Path) -> Dict[str, float]:
    try:
        import mido  # type: ignore
    except Exception:
        return {"notes": -1, "low_pitch_notes": -1, "uniq_pitches": -1, "duration_s": -1}

    mid = mido.MidiFile(str(midi_path))
    notes = 0
    low = 0
    pitches = set()
    for tr in mid.tracks:
        for msg in tr:
            if msg.type == "note_on" and int(msg.velocity) > 0:
                notes += 1
                p = int(msg.note)
                pitches.add(p)
                if p < 50:
                    low += 1
    duration_s = float(getattr(mid, "length", 0.0) or 0.0)
    return {
        "notes": float(notes),
        "low_pitch_notes": float(low),
        "uniq_pitches": float(len(pitches)),
        "duration_s": duration_s,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_path", required=True, help="Input wav (or any librosa-loadable)")
    ap.add_argument("--out", dest="out_dir", default="outputs/bakeoff", help="Output dir")
    ap.add_argument("--sr", type=int, default=22050, help="Target sample rate")
    ap.add_argument("--max-seconds", type=float, default=30.0, help="Max seconds to load")
    ap.add_argument("--format", default="mp3", choices=["mp3", "wav"], help="Generate audio format")
    ap.add_argument("--host", default="http://127.0.0.1:8000", help="API base url")
    ap.add_argument("--no-generate", action="store_true", help="Only write wav variants; do not call CLI generate")
    args = ap.parse_args()

    in_path = Path(args.in_path).resolve()
    out_root = Path(args.out_dir).resolve()
    wav_dir = out_root / "wav_variants"
    run_dir = out_root / "runs"
    wav_dir.mkdir(parents=True, exist_ok=True)
    run_dir.mkdir(parents=True, exist_ok=True)

    y, sr = load_mono(in_path, args.sr, args.max_seconds)

    rows: List[Dict] = []
    for v in DEFAULT_VARIANTS:
        yv = y.copy()
        if v.key == "baseline_peak":
            yv = peak_normalize(yv, peak=0.99)
        elif v.key == "hp120_rms":
            yv = highpass(yv, sr, 120.0)
            yv = rms_normalize(yv, target_rms=0.08)
            yv = peak_normalize(yv, peak=0.99)  # keep headroom similar
        elif v.key == "hp120_rms_nr":
            yv = highpass(yv, sr, 120.0)
            yv = rms_normalize(yv, target_rms=0.08)
            yv = peak_normalize(yv, peak=0.99)
            nr = maybe_noisereduce(yv, sr)
            if nr is None:
                print("[skip] noisereduce not installed, skip hp120_rms_nr")
                continue
            yv = nr
            yv = peak_normalize(yv, peak=0.99)
        else:
            continue

        wav_out = wav_dir / f"{in_path.stem}.{v.key}.wav"
        write_wav(wav_out, yv, sr)

        rec: Dict = {"variant": v.key, "desc": v.desc, "wav": str(wav_out)}
        if not args.no_generate:
            out_dir = run_dir / v.key
            out_dir.mkdir(parents=True, exist_ok=True)
            tid, log = run_cli_generate(wav_out, out_dir, args.format, args.host)
            rec["task_id"] = tid
            rec["log_path"] = str(out_dir / "generate.log")
            (out_dir / "generate.log").write_text(log, encoding="utf-8")

            if tid:
                mp3 = out_dir / f"{tid}.{args.format}"
                mid = out_dir / "downloads" / f"{tid}.mid"
                rec["audio_out"] = str(mp3) if mp3.exists() else None
                rec["midi_out"] = str(mid) if mid.exists() else None
                if mid.exists():
                    rec["midi_stats"] = midi_stats(mid)
        rows.append(rec)

    summary_path = out_root / "summary.json"
    summary_path.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")

    print("\n=== Bakeoff summary ===")
    print(f"summary: {summary_path}")
    for r in rows:
        ms = r.get("midi_stats")
        if ms:
            print(f"- {r['variant']}: notes={int(ms['notes'])} low<{50}={int(ms['low_pitch_notes'])} "
                  f"uniq_pitches={int(ms['uniq_pitches'])} dur={ms['duration_s']:.2f}s  audio={r.get('audio_out')}")
        else:
            print(f"- {r['variant']}: audio={r.get('audio_out')}")

    print("\n听感对比：去 outputs/bakeoff/runs/<variant>/ 下直接打开 mp3 即可。")
    return 0


if __name__ == "__main__":
    import os
    raise SystemExit(main())
