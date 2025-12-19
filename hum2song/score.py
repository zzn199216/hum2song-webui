from __future__ import annotations

import argparse
from pathlib import Path

from music21 import converter  # type: ignore


def midi_to_musicxml(
    midi_path: str | Path,
    *,
    out_dir: str | Path | None = None,
    out_path: str | Path | None = None,
) -> Path:
    midi_path = Path(midi_path)
    if not midi_path.exists() or not midi_path.is_file():
        raise FileNotFoundError(f"midi_path not found: {midi_path}")

    score = converter.parse(str(midi_path))

    if out_path is not None:
        p = Path(out_path)
        if p.exists() and p.is_dir():
            p = p / f"{midi_path.stem}.musicxml"
        if p.suffix.lower() not in (".musicxml", ".xml"):
            p = p.with_suffix(".musicxml")
        p.parent.mkdir(parents=True, exist_ok=True)
        score.write("musicxml", fp=str(p))
        return p.resolve()

    out_base = Path(out_dir) if out_dir is not None else midi_path.parent
    out_base.mkdir(parents=True, exist_ok=True)
    p = (out_base / f"{midi_path.stem}.musicxml").resolve()
    score.write("musicxml", fp=str(p))
    return p


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="hum2song.score", description="Score tools (local)")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("midi2xml", help="Convert MIDI to MusicXML for editing in MuseScore")
    c.add_argument("midi", type=str, help="Path to .mid")
    c.add_argument("--out-dir", default=None, help="Output directory (default: same as midi)")
    c.add_argument("--out", default=None, help="Explicit output file path (.musicxml)")

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.cmd == "midi2xml":
        out = midi_to_musicxml(args.midi, out_dir=args.out_dir, out_path=args.out)
        print(str(out))
        return 0

    raise SystemExit(f"Unknown command: {args.cmd}")


if __name__ == "__main__":
    raise SystemExit(main())
