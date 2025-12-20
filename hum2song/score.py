from __future__ import annotations

import argparse
from pathlib import Path

from music21 import converter  # type: ignore

from core.score_convert import midi_to_score, score_to_midi
from core.score_models import ScoreDoc


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


def midi_to_json(midi_path: str | Path, *, out_dir: str | Path | None = None, out_path: str | Path | None = None) -> Path:
    midi_path = Path(midi_path)
    score = midi_to_score(midi_path)

    if out_path is not None:
        p = Path(out_path)
        if p.exists() and p.is_dir():
            p = p / f"{midi_path.stem}.json"
        if p.suffix.lower() != ".json":
            p = p.with_suffix(".json")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(score.model_dump_json(indent=2), encoding="utf-8")
        return p.resolve()

    out_base = Path(out_dir) if out_dir is not None else midi_path.parent
    out_base.mkdir(parents=True, exist_ok=True)
    p = (out_base / f"{midi_path.stem}.json").resolve()
    p.write_text(score.model_dump_json(indent=2), encoding="utf-8")
    return p


def json_to_midi(json_path: str | Path, *, out_dir: str | Path | None = None, out_path: str | Path | None = None) -> Path:
    json_path = Path(json_path)
    if not json_path.exists() or not json_path.is_file():
        raise FileNotFoundError(f"json_path not found: {json_path}")

    score = ScoreDoc.model_validate_json(json_path.read_text(encoding="utf-8"))

    if out_path is not None:
        p = Path(out_path)
        if p.exists() and p.is_dir():
            p = p / f"{json_path.stem}_from_json.mid"
        if p.suffix.lower() not in (".mid", ".midi"):
            p = p.with_suffix(".mid")
        return score_to_midi(score, p)

    out_base = Path(out_dir) if out_dir is not None else json_path.parent
    out_base.mkdir(parents=True, exist_ok=True)
    p = (out_base / f"{json_path.stem}_from_json.mid").resolve()
    return score_to_midi(score, p)


def json_to_musicxml(json_path: str | Path, *, out_dir: str | Path | None = None, out_path: str | Path | None = None) -> Path:
    """
    Convenience: JSON -> MIDI -> MusicXML
    (keeps one canonical conversion path)
    """
    json_path = Path(json_path)
    if not json_path.exists() or not json_path.is_file():
        raise FileNotFoundError(f"json_path not found: {json_path}")

    score = ScoreDoc.model_validate_json(json_path.read_text(encoding="utf-8"))

    # create a temp midi next to xml output target
    if out_path is not None:
        out_xml = Path(out_path)
        if out_xml.exists() and out_xml.is_dir():
            out_xml = out_xml / f"{json_path.stem}.musicxml"
        if out_xml.suffix.lower() not in (".musicxml", ".xml"):
            out_xml = out_xml.with_suffix(".musicxml")
        out_xml.parent.mkdir(parents=True, exist_ok=True)
        tmp_midi = (out_xml.parent / f"{json_path.stem}__tmp.mid").resolve()
        score_to_midi(score, tmp_midi)
        try:
            return midi_to_musicxml(tmp_midi, out_path=out_xml)
        finally:
            try:
                tmp_midi.unlink(missing_ok=True)  # py3.11 ok
            except Exception:
                pass

    out_base = Path(out_dir) if out_dir is not None else json_path.parent
    out_base.mkdir(parents=True, exist_ok=True)
    out_xml = (out_base / f"{json_path.stem}.musicxml").resolve()
    tmp_midi = (out_base / f"{json_path.stem}__tmp.mid").resolve()
    score_to_midi(score, tmp_midi)
    try:
        return midi_to_musicxml(tmp_midi, out_path=out_xml)
    finally:
        try:
            tmp_midi.unlink(missing_ok=True)
        except Exception:
            pass


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="hum2song.score", description="Score tools (local)")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("midi2xml", help="Convert MIDI to MusicXML for editing in MuseScore")
    c.add_argument("midi", type=str, help="Path to .mid")
    c.add_argument("--out-dir", default=None, help="Output directory (default: same as midi)")
    c.add_argument("--out", default=None, help="Explicit output file path (.musicxml)")

    j = sub.add_parser("midi2json", help="Convert MIDI to Score JSON (internal canonical format)")
    j.add_argument("midi", type=str, help="Path to .mid")
    j.add_argument("--out-dir", default=None, help="Output directory (default: same as midi)")
    j.add_argument("--out", default=None, help="Explicit output file path (.json)")

    m = sub.add_parser("json2midi", help="Convert Score JSON back to MIDI")
    m.add_argument("json", type=str, help="Path to score.json")
    m.add_argument("--out-dir", default=None, help="Output directory (default: same as json)")
    m.add_argument("--out", default=None, help="Explicit output file path (.mid)")

    x = sub.add_parser("json2xml", help="Convert Score JSON to MusicXML (via MIDI bridge)")
    x.add_argument("json", type=str, help="Path to score.json")
    x.add_argument("--out-dir", default=None, help="Output directory (default: same as json)")
    x.add_argument("--out", default=None, help="Explicit output file path (.musicxml)")

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.cmd == "midi2xml":
        out = midi_to_musicxml(args.midi, out_dir=args.out_dir, out_path=args.out)
        print(str(out))
        return 0

    if args.cmd == "midi2json":
        out = midi_to_json(args.midi, out_dir=args.out_dir, out_path=args.out)
        print(str(out))
        return 0

    if args.cmd == "json2midi":
        out = json_to_midi(args.json, out_dir=args.out_dir, out_path=args.out)
        print(str(out))
        return 0

    if args.cmd == "json2xml":
        out = json_to_musicxml(args.json, out_dir=args.out_dir, out_path=args.out)
        print(str(out))
        return 0

    raise SystemExit(f"Unknown command: {args.cmd}")


if __name__ == "__main__":
    raise SystemExit(main())
