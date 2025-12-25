from __future__ import annotations

from pathlib import Path
import sys
import json
import subprocess
import shutil
import argparse
from typing import List, Tuple, Optional

# --- ensure repo root on sys.path so `import core` works when running from scripts/ ---
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
# ------------------------------------------------------------------------------------

from core.ai_converter import audio_to_midi
from core.score_convert import midi_to_score, score_to_midi

# Optional: mido for event summary (already in your repo scripts)
import mido  # type: ignore


def midi_notes_summary(midi_path: Path) -> List[Tuple[float, int, float, int]]:
    """
    Return list of (start_sec, pitch, dur_sec, velocity) sorted by start.
    Works best for single-track melody-ish MIDI; good enough for debugging.
    """
    mid = mido.MidiFile(str(midi_path))
    tpb = mid.ticks_per_beat
    tempo = 500000  # default 120bpm

    # Track absolute seconds per track
    # We'll collect note_on and match with note_off (or note_on vel=0).
    notes: List[Tuple[float, int, float, int]] = []

    for tr in mid.tracks:
        abs_ticks = 0
        abs_sec = 0.0
        open_notes = {}  # (channel,pitch)->(start_sec, velocity)

        for msg in tr:
            abs_ticks += msg.time
            # tick -> sec using current tempo
            abs_sec += mido.tick2second(msg.time, tpb, tempo)

            if msg.type == "set_tempo":
                tempo = msg.tempo

            if msg.type == "note_on" and msg.velocity > 0:
                open_notes[(getattr(msg, "channel", 0), msg.note)] = (abs_sec, int(msg.velocity))

            if (msg.type == "note_off") or (msg.type == "note_on" and msg.velocity == 0):
                key = (getattr(msg, "channel", 0), msg.note)
                if key in open_notes:
                    start_sec, vel = open_notes.pop(key)
                    dur = max(0.0, abs_sec - start_sec)
                    notes.append((float(start_sec), int(msg.note), float(dur), int(vel)))

        # close any hanging notes (rare)
        for (ch, p), (st, vel) in open_notes.items():
            notes.append((float(st), int(p), 0.0, int(vel)))

    notes.sort(key=lambda x: (x[0], x[1]))
    return notes


def run_synth_to_named_mp3(midi_path: Path, mp3_dir: Path, out_name: str, gain: float = 0.8) -> Optional[Path]:
    """
    Use your existing CLI synth and rename output to mp3/<out_name>.mp3
    """
    mp3_dir.mkdir(parents=True, exist_ok=True)
    tmp = mp3_dir / "_tmp"
    tmp.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable, "-m", "hum2song.cli",
        "synth", str(midi_path),
        "--format", "mp3",
        "--out-dir", str(tmp),
        "--gain", str(gain),
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)

    # find produced mp3
    mp3s = sorted(tmp.glob("*.mp3"), key=lambda x: x.stat().st_mtime, reverse=True)
    if not mp3s:
        print("[WARN] synth did not produce mp3.")
        print("STDOUT:\n", p.stdout)
        print("STDERR:\n", p.stderr)
        return None

    produced = mp3s[0]
    target = mp3_dir / f"{out_name}.mp3"
    try:
        if target.exists():
            target.unlink()
        produced.replace(target)
    except Exception:
        target.write_bytes(produced.read_bytes())

    # cleanup tmp
    try:
        for f in tmp.glob("*"):
            f.unlink()
        tmp.rmdir()
    except Exception:
        pass

    return target


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_wav", required=True, help="input wav path")
    ap.add_argument("--out", dest="out_dir", required=True, help="output dir")
    ap.add_argument("--clean", action="store_true", help="clean out_dir before run")
    ap.add_argument("--print-n", type=int, default=40, help="print first N notes summary")
    args = ap.parse_args()

    in_wav = Path(args.in_wav).resolve()
    out_dir = Path(args.out_dir).resolve()
    if args.clean and out_dir.exists():
        shutil.rmtree(out_dir, ignore_errors=True)

    out_dir.mkdir(parents=True, exist_ok=True)
    mp3_dir = out_dir / "mp3"
    mp3_dir.mkdir(parents=True, exist_ok=True)

    # 1) WAV -> MIDI (NO preprocess, direct)
    midi_raw = audio_to_midi(in_wav, output_dir=out_dir)  # writes <stem>.mid into out_dir
    midi_raw = Path(midi_raw).resolve()
    raw_mid = out_dir / "01_raw.mid"
    if midi_raw.resolve() != raw_mid.resolve():
        raw_mid.write_bytes(midi_raw.read_bytes())
    print(f"[OK] raw midi: {raw_mid} ({raw_mid.stat().st_size} bytes)")

    # 2) MIDI -> Score JSON
    score = midi_to_score(raw_mid)
    score_json_path = out_dir / "02_raw.score.json"
    score_json_path.write_text(json.dumps(score.model_dump(), ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] score json: {score_json_path}")

    # 3) Score -> MIDI (roundtrip)
    rt_mid = out_dir / "03_roundtrip.mid"
    score_to_midi(score, rt_mid)
    print(f"[OK] roundtrip midi: {rt_mid} ({rt_mid.stat().st_size} bytes)")

    # 4) synth to mp3 (flat in one folder)
    mp3_raw = run_synth_to_named_mp3(raw_mid, mp3_dir, "01_raw", gain=0.8)
    mp3_rt = run_synth_to_named_mp3(rt_mid, mp3_dir, "02_roundtrip", gain=0.8)

    print(f"[OK] mp3 raw: {mp3_raw}")
    print(f"[OK] mp3 roundtrip: {mp3_rt}")
    print(f"🎧 Listen here: {mp3_dir}")

    # 5) Print note summaries
    raw_notes = midi_notes_summary(raw_mid)
    rt_notes = midi_notes_summary(rt_mid)

    print("\n=== NOTE SUMMARY ===")
    print(f"raw_notes={len(raw_notes)}   roundtrip_notes={len(rt_notes)}")

    n = int(args.print_n)
    print("\n-- raw (first N)  (start_sec, pitch, dur_sec, vel) --")
    for row in raw_notes[:n]:
        print(row)

    print("\n-- roundtrip (first N)  (start_sec, pitch, dur_sec, vel) --")
    for row in rt_notes[:n]:
        print(row)

    # quick sanity: compare onset compression (total span)
    def span(ns: List[Tuple[float, int, float, int]]) -> float:
        if not ns:
            return 0.0
        starts = [x[0] for x in ns]
        ends = [x[0] + x[2] for x in ns]
        return max(ends) - min(starts)

    print("\n-- span(sec) --")
    print(f"raw_span={span(raw_notes):.3f}  roundtrip_span={span(rt_notes):.3f}")

    report = out_dir / "report.txt"
    report.write_text(
        f"in_wav={in_wav}\n"
        f"raw_mid={raw_mid}\n"
        f"score_json={score_json_path}\n"
        f"roundtrip_mid={rt_mid}\n"
        f"mp3_raw={mp3_raw}\n"
        f"mp3_roundtrip={mp3_rt}\n"
        f"raw_notes={len(raw_notes)} roundtrip_notes={len(rt_notes)}\n"
        f"raw_span={span(raw_notes):.3f} roundtrip_span={span(rt_notes):.3f}\n",
        encoding="utf-8",
    )
    print(f"[OK] report: {report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
