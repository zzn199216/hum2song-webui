from __future__ import annotations

from pathlib import Path
import sys
import json
import argparse
import subprocess
import shutil
from typing import List, Tuple, Optional

# --- ensure repo root on sys.path so `import core` works when running from scripts/ ---
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
# ------------------------------------------------------------------------------------

from core.ai_converter import audio_to_midi
from core.score_convert import midi_to_score, score_to_midi

import mido  # type: ignore


def midi_notes_summary(midi_path: Path) -> List[Tuple[float, int, float, int]]:
    mid = mido.MidiFile(str(midi_path))
    tpb = mid.ticks_per_beat
    tempo = 500000
    notes: List[Tuple[float, int, float, int]] = []

    for tr in mid.tracks:
        abs_sec = 0.0
        open_notes = {}
        for msg in tr:
            abs_sec += mido.tick2second(msg.time, tpb, tempo)
            if msg.type == "set_tempo":
                tempo = msg.tempo

            if msg.type == "note_on" and msg.velocity > 0:
                open_notes[(getattr(msg, "channel", 0), msg.note)] = (abs_sec, int(msg.velocity))

            if (msg.type == "note_off") or (msg.type == "note_on" and msg.velocity == 0):
                key = (getattr(msg, "channel", 0), msg.note)
                if key in open_notes:
                    st, vel = open_notes.pop(key)
                    dur = max(0.0, abs_sec - st)
                    notes.append((float(st), int(msg.note), float(dur), int(vel)))

        for (ch, p), (st, vel) in open_notes.items():
            notes.append((float(st), int(p), 0.0, int(vel)))

    notes.sort(key=lambda x: (x[0], x[1]))
    return notes


def span(notes: List[Tuple[float, int, float, int]]) -> float:
    if not notes:
        return 0.0
    starts = [x[0] for x in notes]
    ends = [x[0] + x[2] for x in notes]
    return max(ends) - min(starts)


def synth_to_mp3(midi_path: Path, mp3_path: Path, gain: float = 0.6) -> Optional[Path]:
    mp3_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = mp3_path.parent / "_tmp"
    tmp.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable, "-m", "hum2song.cli",
        "synth", str(midi_path),
        "--format", "mp3",
        "--out-dir", str(tmp),
        "--gain", str(gain),
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)

    mp3s = sorted(tmp.glob("*.mp3"), key=lambda x: x.stat().st_mtime, reverse=True)
    if not mp3s:
        print("[WARN] synth failed:", midi_path)
        print("STDOUT:\n", p.stdout)
        print("STDERR:\n", p.stderr)
        return None

    produced = mp3s[0]
    if mp3_path.exists():
        mp3_path.unlink()
    produced.replace(mp3_path)

    # cleanup tmp
    try:
        for f in tmp.glob("*"):
            f.unlink()
        tmp.rmdir()
    except Exception:
        pass

    return mp3_path


def try_generate_via_cli(in_wav: Path, out_dir: Path) -> Tuple[Optional[Path], Optional[Path]]:
    """
    Optional: run your normal 'generate' (API/CLI) path.
    Requires local server running on 127.0.0.1:8000
    """
    log = out_dir / "C_generate.log"
    cmd = [
        sys.executable, "-m", "hum2song.cli",
        "generate", str(in_wav),
        "--format", "mp3",
        "--out-dir", str(out_dir),
        "--download-midi",
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    log.write_text(p.stdout + "\n\n" + p.stderr, encoding="utf-8")

    # parse downloaded paths from stdout (best-effort)
    midi_path = None
    mp3_path = None
    for line in (p.stdout.splitlines() + p.stderr.splitlines()):
        if "downloaded midi:" in line:
            midi_path = Path(line.split("downloaded midi:", 1)[1].strip().split(" (")[0]).resolve()
        if "downloaded audio:" in line:
            mp3_path = Path(line.split("downloaded audio:", 1)[1].strip().split(" (")[0]).resolve()

    # copy into out_dir with stable names if present
    c_mid = None
    c_mp3 = None
    if midi_path and midi_path.exists():
        c_mid = out_dir / "C_generate_download.mid"
        c_mid.write_bytes(midi_path.read_bytes())
    if mp3_path and mp3_path.exists():
        c_mp3 = out_dir / "C_generate_download.mp3"
        c_mp3.write_bytes(mp3_path.read_bytes())

    return c_mid, c_mp3


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_wav", required=True)
    ap.add_argument("--out", dest="out_dir", required=True)
    ap.add_argument("--clean", action="store_true")
    ap.add_argument("--with-generate", action="store_true", help="also run 'hum2song.cli generate' path (needs server)")
    ap.add_argument("--gain", type=float, default=0.6)
    ap.add_argument("--print-n", type=int, default=25)
    args = ap.parse_args()

    in_wav = Path(args.in_wav).resolve()
    out_dir = Path(args.out_dir).resolve()
    if args.clean and out_dir.exists():
        shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    # A) raw (no preprocess)
    mid_a = Path(audio_to_midi(in_wav, output_dir=out_dir)).resolve()
    A_mid = out_dir / "A_raw.mid"
    if mid_a != A_mid:
        A_mid.write_bytes(mid_a.read_bytes())

    A_mp3 = out_dir / "A_raw.mp3"
    synth_to_mp3(A_mid, A_mp3, gain=args.gain)

    # B) score roundtrip (no optimize)
    score = midi_to_score(A_mid)
    (out_dir / "B_score.json").write_text(json.dumps(score.model_dump(), ensure_ascii=False, indent=2), encoding="utf-8")

    B_mid = out_dir / "B_roundtrip.mid"
    score_to_midi(score, B_mid)
    B_mp3 = out_dir / "B_roundtrip.mp3"
    synth_to_mp3(B_mid, B_mp3, gain=args.gain)

    # Optional C) your normal generate path
    C_mid = None
    C_mp3 = None
    if args.with_generate:
        C_mid, C_mp3 = try_generate_via_cli(in_wav, out_dir)

    # Report
    def dump(label: str, p: Path):
        ns = midi_notes_summary(p)
        print(f"\n[{label}] {p.name} size={p.stat().st_size} notes={len(ns)} span={span(ns):.3f}")
        for row in ns[: args.print_n]:
            print(" ", (round(row[0], 3), row[1], round(row[2], 3), row[3]))

    print("\n==== MIDI NOTE DEBUG ====")
    dump("A", A_mid)
    dump("B", B_mid)
    if C_mid:
        dump("C", C_mid)

    print("\n==== OUTPUT FILES ====")
    for f in sorted(out_dir.glob("*")):
        if f.is_file():
            print(f.name)

    print(f"\n🎧 Listen in folder: {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
