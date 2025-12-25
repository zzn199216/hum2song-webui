from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import librosa
import soundfile as sf
from scipy.signal import butter, sosfilt


# expected step pattern for major scale (do re mi fa sol la ti do)
MAJOR_STEPS = [2, 2, 1, 2, 2, 2, 1]


@dataclass
class Variant:
    key: str
    hp_hz: float
    norm: str          # "peak" or "rms"
    gate: bool         # spectral gate
    rms_target: float  # used only if norm=="rms"


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


def highpass(y: np.ndarray, sr: int, cutoff_hz: float) -> np.ndarray:
    if cutoff_hz <= 0:
        return y
    sos = butter(4, cutoff_hz / (sr / 2.0), btype="highpass", output="sos")
    return sosfilt(sos, y).astype(np.float32)


def spectral_gate(y: np.ndarray, sr: int, noise_seconds: float = 0.25, reduction_db: float = 18.0) -> np.ndarray:
    """Very conservative spectral gate (no extra deps)."""
    n_fft = 2048
    hop = 512
    S = librosa.stft(y, n_fft=n_fft, hop_length=hop)
    mag = np.abs(S)
    phase = np.angle(S)

    n_frames = max(1, int((noise_seconds * sr) / hop))
    noise_mag = np.median(mag[:, :n_frames], axis=1, keepdims=True)

    factor = 10 ** (reduction_db / 20.0)
    thresh = noise_mag * factor
    mask = np.clip((mag - thresh) / (mag + 1e-8), 0.0, 1.0)

    mag2 = mag * mask
    S2 = mag2 * np.exp(1j * phase)
    y2 = librosa.istft(S2, hop_length=hop, length=len(y))
    return y2.astype(np.float32)


def write_wav(path: Path, y: np.ndarray, sr: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), y, sr, subtype="PCM_16")


def run_cli_generate(wav_path: Path, out_dir: Path, fmt: str, host: str) -> Tuple[Optional[str], str]:
    cmd = [
        sys.executable, "-m", "hum2song.cli",
        "generate", str(wav_path),
        "--format", fmt,
        "--out-dir", str(out_dir),
        "--download-midi",
    ]
    env = dict(os.environ)
    # try common env keys (in case你的 client 读取其中之一)
    env["H2S_BASE_URL"] = host
    env["HUM2SONG_BASE_URL"] = host
    env["HUM2SONG_API_BASE_URL"] = host

    p = subprocess.run(cmd, capture_output=True, text=True, env=env)
    out = (p.stdout or "") + "\n" + (p.stderr or "")
    m = re.search(r"task_id=([0-9a-fA-F-]{36})", out)
    tid = m.group(1) if m else None
    return tid, out


def midi_extract_note_ons(midi_path: Path) -> List[Tuple[float, int, int]]:
    try:
        import mido  # type: ignore
    except Exception:
        return []
    mid = mido.MidiFile(str(midi_path))
    ticks_per_beat = mid.ticks_per_beat
    # assume tempo ~120 if none, but for ordering we only need relative time
    tempo = 500000  # 120bpm
    notes: List[Tuple[float, int, int]] = []
    for tr in mid.tracks:
        t_ticks = 0
        for msg in tr:
            t_ticks += msg.time
            if msg.type == "set_tempo":
                tempo = msg.tempo
            if msg.type == "note_on" and int(msg.velocity) > 0:
                # ticks -> seconds
                sec = (t_ticks * tempo) / (ticks_per_beat * 1_000_000.0)
                notes.append((sec, int(msg.note), int(msg.velocity)))
    notes.sort(key=lambda x: (x[0], x[1]))
    return notes


def midi_stats(midi_path: Path) -> Dict[str, float]:
    notes = midi_extract_note_ons(midi_path)
    if not notes:
        return {"notes": 0, "low_pitch_notes": 0, "uniq_pitches": 0}
    pitches = [p for _, p, _ in notes]
    return {
        "notes": float(len(notes)),
        "low_pitch_notes": float(sum(1 for p in pitches if p < 50)),
        "uniq_pitches": float(len(set(pitches))),
    }


def monophonic_melody(notes: List[Tuple[float, int, int]], time_eps: float = 0.05, drop_below_pitch: int = 0) -> List[int]:
    """Group close-onset notes, keep the loudest, then de-dup consecutive pitches."""
    if drop_below_pitch > 0:
        notes = [x for x in notes if x[1] >= drop_below_pitch]
    if not notes:
        return []
    out: List[int] = []
    i = 0
    while i < len(notes):
        t0 = notes[i][0]
        group = [notes[i]]
        i += 1
        while i < len(notes) and abs(notes[i][0] - t0) <= time_eps:
            group.append(notes[i])
            i += 1
        # pick by max velocity, tie-break by higher pitch
        group.sort(key=lambda x: (x[2], x[1]), reverse=True)
        out.append(group[0][1])
    # remove consecutive duplicates
    dedup: List[int] = []
    for p in out:
        if not dedup or dedup[-1] != p:
            dedup.append(p)
    return dedup


def major_step_score(pitches: List[int]) -> float:
    """
    Score how well the pitch-steps match MAJOR_STEPS, regardless of transposition.
    Returns score in [0, 1].
    """
    if len(pitches) < 8:
        return 0.0
    # take first 8 notes (you hum 8 notes)
    seq = pitches[:8]
    diffs = [seq[i + 1] - seq[i] for i in range(7)]
    # allow octave ambiguity: fold diffs into [-6, 6] by +/-12 once
    norm_diffs = []
    for d in diffs:
        while d > 6:
            d -= 12
        while d < -6:
            d += 12
        norm_diffs.append(d)
    # Compare to major steps; we only care absolute steps direction (ascending)
    # penalize non-ascending heavily
    if any(d <= 0 for d in norm_diffs):
        return 0.0
    mism = sum(1 for i, d in enumerate(norm_diffs) if abs(d - MAJOR_STEPS[i]) > 1)
    return float(max(0, 7 - mism) / 7.0)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_path", required=True, help="Input wav")
    ap.add_argument("--out", dest="out_dir", default="outputs/bakeoff_grid", help="Output dir")
    ap.add_argument("--sr", type=int, default=22050)
    ap.add_argument("--max-seconds", type=float, default=30.0)
    ap.add_argument("--format", default="mp3", choices=["mp3", "wav"])
    ap.add_argument("--host", default="http://127.0.0.1:8000")
    ap.add_argument("--hp", default="0,40,60,80,100,120", help="HP cutoffs (comma-separated)")
    ap.add_argument("--norm", default="peak,rms", help="normalize modes: peak,rms")
    ap.add_argument("--gate", action="store_true", help="include spectral gate variants")
    ap.add_argument("--top", type=int, default=5, help="print top N")
    args = ap.parse_args()

    in_path = Path(args.in_path).resolve()
    out_root = Path(args.out_dir).resolve()
    wav_root = out_root / "wav_variants"
    run_root = out_root / "runs"
    wav_root.mkdir(parents=True, exist_ok=True)
    run_root.mkdir(parents=True, exist_ok=True)

    y, sr = load_mono(in_path, args.sr, args.max_seconds)

    hp_list = [float(x.strip()) for x in args.hp.split(",") if x.strip() != ""]
    norm_list = [x.strip() for x in args.norm.split(",") if x.strip() != ""]
    gate_list = [False, True] if args.gate else [False]

    variants: List[Variant] = []
    for hp in hp_list:
        for norm in norm_list:
            for gate in gate_list:
                key = f"hp{int(hp)}_{norm}" + ("_gate" if gate else "")
                variants.append(Variant(key=key, hp_hz=hp, norm=norm, gate=gate, rms_target=0.08))

    rows: List[Dict] = []
    for v in variants:
        yv = y.copy()
        yv = highpass(yv, sr, v.hp_hz)
        if v.norm == "rms":
            yv = rms_normalize(yv, v.rms_target)
            yv = peak_normalize(yv, 0.99)  # keep headroom consistent
        else:
            yv = peak_normalize(yv, 0.99)

        if v.gate:
            yv = spectral_gate(yv, sr, noise_seconds=0.25, reduction_db=18.0)
            yv = peak_normalize(yv, 0.99)

        wav_out = wav_root / f"{in_path.stem}.{v.key}.wav"
        write_wav(wav_out, yv, sr)

        run_dir = run_root / v.key
        run_dir.mkdir(parents=True, exist_ok=True)
        tid, log = run_cli_generate(wav_out, run_dir, args.format, args.host)
        (run_dir / "generate.log").write_text(log, encoding="utf-8")

        rec: Dict = {
            "variant": v.key,
            "hp_hz": v.hp_hz,
            "norm": v.norm,
            "gate": v.gate,
            "wav": str(wav_out),
            "task_id": tid,
        }

        if tid:
            mp3 = run_dir / f"{tid}.{args.format}"
            mid = run_dir / "downloads" / f"{tid}.mid"
            rec["audio_out"] = str(mp3) if mp3.exists() else None
            rec["midi_out"] = str(mid) if mid.exists() else None

            if mid.exists():
                st = midi_stats(mid)
                notes = midi_extract_note_ons(mid)
                # Two melody views: include lows, and drop low pitches (<50) to judge scale
                mel_all = monophonic_melody(notes, time_eps=0.05, drop_below_pitch=0)
                mel_hi = monophonic_melody(notes, time_eps=0.05, drop_below_pitch=50)
                rec["midi_stats"] = st
                rec["melody_len_all"] = len(mel_all)
                rec["melody_len_dropLow"] = len(mel_hi)
                rec["major_step_score"] = major_step_score(mel_hi)
        rows.append(rec)

    # Save summary
    summary_json = out_root / "summary.json"
    summary_json.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")

    # Save CSV
    summary_csv = out_root / "summary.csv"
    with summary_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([
            "variant", "hp_hz", "norm", "gate", "task_id",
            "notes", "low_pitch_notes", "uniq_pitches",
            "melody_len_dropLow", "major_step_score",
            "audio_out", "midi_out",
        ])
        for r in rows:
            st = r.get("midi_stats", {}) or {}
            w.writerow([
                r.get("variant"), r.get("hp_hz"), r.get("norm"), r.get("gate"), r.get("task_id"),
                int(st.get("notes", 0)), int(st.get("low_pitch_notes", 0)), int(st.get("uniq_pitches", 0)),
                r.get("melody_len_dropLow", 0), f"{float(r.get('major_step_score', 0.0)):.3f}",
                r.get("audio_out"), r.get("midi_out"),
            ])

    # Rank: prefer major_step_score high, melody length near 8, low_pitch_notes low
    def rank_key(r: Dict) -> Tuple[float, float, float]:
        st = r.get("midi_stats", {}) or {}
        major = float(r.get("major_step_score", 0.0) or 0.0)
        mel_len = float(r.get("melody_len_dropLow", 0) or 0)
        low = float(st.get("low_pitch_notes", 0) or 0)
        # closeness to 8
        mel_score = -abs(mel_len - 8.0)
        return (major, mel_score, -low)

    ranked = sorted(rows, key=rank_key, reverse=True)

    print(f"\nsummary.json: {summary_json}")
    print(f"summary.csv : {summary_csv}")
    print("\nTOP variants to listen:")
    for r in ranked[: max(1, int(args.top))]:
        st = r.get("midi_stats", {}) or {}
        print(
            f"- {r['variant']}: major={float(r.get('major_step_score',0.0)):.3f} "
            f"mel_dropLow={r.get('melody_len_dropLow',0)} "
            f"notes={int(st.get('notes',0))} low<{50}={int(st.get('low_pitch_notes',0))} "
            f"audio={r.get('audio_out')}"
        )

    print("\n直接去 outputs/bakeoff_grid/runs/<variant>/ 下听 mp3，对比哪个最像“哆来咪发索拉西哆”。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
