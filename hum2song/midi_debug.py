from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from core.score_convert import midi_to_score


@dataclass(frozen=True)
class FoundMidis:
    downloads_midi: Optional[Path]
    outputs_midi: Optional[Path]


def _safe_mkdir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def _write_json(p: Path, obj: Any) -> None:
    _safe_mkdir(p.parent)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def _find_first_existing(candidates: List[Path]) -> Optional[Path]:
    for p in candidates:
        if p.exists():
            return p
    return None


def find_midis(task_id: str, outputs_dir: Path) -> FoundMidis:
    """
    We match your repo conventions:
      - downloads midi usually at:
          outputs/downloads/<id>.mid
          outputs/qa/downloads/<id>.mid
      - backend outputs midi usually at:
          outputs/<id>.mid
          outputs/qa/<id>.mid (if you pointed output_dir there)
    """
    outputs_dir = Path(outputs_dir)

    downloads_candidates = [
        outputs_dir / "downloads" / f"{task_id}.mid",
        outputs_dir / "qa" / "downloads" / f"{task_id}.mid",
        outputs_dir / "qa" / f"{task_id}.mid",
    ]
    outputs_candidates = [
        outputs_dir / f"{task_id}.mid",
        outputs_dir / "qa" / f"{task_id}.mid",
    ]

    return FoundMidis(
        downloads_midi=_find_first_existing(downloads_candidates),
        outputs_midi=_find_first_existing(outputs_candidates),
    )


def _score_stats(score_json: Dict[str, Any], *, bucket_ms: int = 50) -> Dict[str, Any]:
    # score_json is ScoreDoc-like
    tracks = score_json.get("tracks") or []
    notes: List[Dict[str, Any]] = []
    for tr in tracks:
        for ne in (tr.get("notes") or []):
            notes.append(ne)

    if not notes:
        return {"notes": 0, "tracks": len(tracks)}

    starts = [float(n["start"]) for n in notes]
    durs = [float(n["duration"]) for n in notes]
    vels = [int(n["velocity"]) for n in notes]
    pitches = [int(n["pitch"]) for n in notes]

    bucket = bucket_ms / 1000.0
    buckets: Dict[int, int] = {}
    for s in starts:
        k = int(round(s / bucket))
        buckets[k] = buckets.get(k, 0) + 1

    max_same_bucket = max(buckets.values()) if buckets else 0
    buckets_4plus = sum(1 for c in buckets.values() if c >= 4)

    return {
        "tempo_bpm": score_json.get("tempo_bpm"),
        "time_signature": score_json.get("time_signature"),
        "tracks": len(tracks),
        "notes": len(notes),
        "pitch_min": min(pitches),
        "pitch_max": max(pitches),
        "start_min_s": min(starts),
        "start_max_s": max(starts),
        "duration_min_s": min(durs),
        "duration_max_s": max(durs),
        "velocity_min": min(vels),
        "velocity_max": max(vels),
        "bucket_ms": bucket_ms,
        "max_notes_same_bucket": max_same_bucket,
        "num_buckets_with_4plus_notes": buckets_4plus,
        # 粗略提示：大量音符挤在同一时间桶内，往往就是“杂糅/压扁”体感
        "hint_mashed": (max_same_bucket >= 6) or (buckets_4plus >= 3),
    }


def _signature(score_json: Dict[str, Any], *, round_ms: int = 10) -> List[Tuple[int, int]]:
    """
    A rough "melody order signature": sort by start then pitch,
    return [(rounded_start_ms, pitch), ...].
    """
    tracks = score_json.get("tracks") or []
    notes: List[Tuple[float, int]] = []
    for tr in tracks:
        for ne in (tr.get("notes") or []):
            notes.append((float(ne["start"]), int(ne["pitch"])))
    notes.sort(key=lambda x: (x[0], x[1]))
    sig: List[Tuple[int, int]] = []
    for s, p in notes:
        sig.append((int(round(s * 1000 / round_ms) * round_ms), p))
    return sig


def dump_two_json(task_id: str, *, outputs_dir: Path, debug_dir: Path) -> int:
    found = find_midis(task_id, outputs_dir=outputs_dir)

    if not found.downloads_midi:
        print(f"[ERR] downloads midi not found for {task_id} under {outputs_dir}")
    if not found.outputs_midi:
        print(f"[ERR] outputs midi not found for {task_id} under {outputs_dir}")

    if not found.downloads_midi or not found.outputs_midi:
        # still dump what we can
        pass

    _safe_mkdir(debug_dir)

    downloads_json = None
    outputs_json = None

    if found.downloads_midi:
        s = midi_to_score(found.downloads_midi)
        downloads_json = s.model_dump()
        out = debug_dir / f"{task_id}.downloads.midi.json"
        _write_json(out, downloads_json)
        print(f"[OK] wrote {out}")

    if found.outputs_midi:
        s = midi_to_score(found.outputs_midi)
        outputs_json = s.model_dump()
        out = debug_dir / f"{task_id}.outputs.midi.json"
        _write_json(out, outputs_json)
        print(f"[OK] wrote {out}")

    # Print comparison summary
    if downloads_json and outputs_json:
        sd = _score_stats(downloads_json)
        so = _score_stats(outputs_json)
        print("\n=== STATS (downloads) ===")
        print(json.dumps(sd, ensure_ascii=False, indent=2))
        print("\n=== STATS (outputs) ===")
        print(json.dumps(so, ensure_ascii=False, indent=2))

        sig_d = _signature(downloads_json)
        sig_o = _signature(outputs_json)

        # compare first N signature items
        N = 40
        mismatch = 0
        for i in range(min(len(sig_d), len(sig_o), N)):
            if sig_d[i] != sig_o[i]:
                mismatch += 1

        print("\n=== SIGNATURE COMPARE ===")
        print(f"downloads notes: {len(sig_d)}")
        print(f"outputs   notes: {len(sig_o)}")
        print(f"first {N} mismatches: {mismatch}")

        if so.get("hint_mashed"):
            print("[WARN] outputs midi looks 'mashed' (many notes share same time bucket).")
        else:
            print("[OK] outputs midi does NOT look mashed by this heuristic.")

    return 0


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="hum2song.midi_debug", description="Dump downloads vs outputs MIDI into debug JSON")
    p.add_argument("task_id", type=str)
    p.add_argument("--outputs-dir", type=str, default="outputs")
    p.add_argument("--debug-dir", type=str, default=str(Path("outputs") / "debug"))
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = _build_parser().parse_args(argv)
    return dump_two_json(
        args.task_id,
        outputs_dir=Path(args.outputs_dir),
        debug_dir=Path(args.debug_dir),
    )


if __name__ == "__main__":
    raise SystemExit(main())
