from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import httpx

# Use your existing converters/models
from core.score_convert import midi_to_score  # seconds-based ScoreDoc
from core.score_models import ScoreDoc, Track, NoteEvent


@dataclass(frozen=True)
class ArtifactPaths:
    task_json: Optional[Path]
    score_json: Optional[Path]
    midi_path: Optional[Path]
    audio_path: Optional[Path]


def _safe_mkdir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def _write_text(p: Path, s: str) -> None:
    _safe_mkdir(p.parent)
    p.write_text(s, encoding="utf-8")


def _write_json(p: Path, obj: Any) -> None:
    _safe_mkdir(p.parent)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def _copy_if_exists(src: Optional[Path], dst: Path) -> Optional[Path]:
    if not src:
        return None
    src = Path(src)
    if not src.exists():
        return None
    _safe_mkdir(dst.parent)
    shutil.copy2(src, dst)
    return dst


def _guess_ext_from_headers(headers: httpx.Headers, fallback: str) -> str:
    ct = (headers.get("content-type") or "").lower()
    if "audio/mpeg" in ct or "mpeg" in ct:
        return ".mp3"
    if "audio/wav" in ct or "wave" in ct:
        return ".wav"
    if "audio/" in ct:
        # unknown audio subtype
        return fallback
    return fallback


def _http_get_json(client: httpx.Client, url: str) -> Dict[str, Any]:
    r = client.get(url)
    r.raise_for_status()
    return r.json()


def _http_get_bytes(client: httpx.Client, url: str, params: Optional[dict] = None) -> Tuple[bytes, httpx.Headers]:
    r = client.get(url, params=params)
    r.raise_for_status()
    return r.content, r.headers


def _download_remote(task_id: str, base_url: str, out_dir: Path) -> ArtifactPaths:
    base_url = base_url.rstrip("/")
    _safe_mkdir(out_dir)

    with httpx.Client(timeout=60.0) as client:
        # task json (optional but useful)
        task_json = None
        try:
            task = _http_get_json(client, f"{base_url}/tasks/{task_id}")
            task_json = out_dir / "remote" / "task.json"
            _write_json(task_json, task)
        except Exception:
            task_json = None

        # score json
        score_json = None
        try:
            score = _http_get_json(client, f"{base_url}/tasks/{task_id}/score")
            score_json = out_dir / "remote" / f"{task_id}.score.json"
            _write_json(score_json, score)
        except Exception:
            score_json = None

        # midi
        midi_path = None
        try:
            midi_bytes, midi_headers = _http_get_bytes(
                client, f"{base_url}/tasks/{task_id}/download", params={"file_type": "midi"}
            )
            midi_path = out_dir / "remote" / f"{task_id}.mid"
            _safe_mkdir(midi_path.parent)
            midi_path.write_bytes(midi_bytes)
        except Exception:
            midi_path = None

        # audio
        audio_path = None
        try:
            audio_bytes, audio_headers = _http_get_bytes(
                client, f"{base_url}/tasks/{task_id}/download", params={"file_type": "audio"}
            )
            ext = _guess_ext_from_headers(audio_headers, ".mp3")
            audio_path = out_dir / "remote" / f"{task_id}{ext}"
            _safe_mkdir(audio_path.parent)
            audio_path.write_bytes(audio_bytes)
        except Exception:
            audio_path = None

    return ArtifactPaths(task_json=task_json, score_json=score_json, midi_path=midi_path, audio_path=audio_path)


def _find_local(task_id: str, outputs_dir: Path) -> ArtifactPaths:
    """
    Try to locate files produced by your repo conventions:
      outputs/<id>.mid
      outputs/<id>.mp3
      outputs/downloads/<id>.mid
      outputs/scores/<id>.score.json
      outputs/scores/<id>.opt.score.json
      outputs/edited/<id>.mp3
    """
    outputs_dir = Path(outputs_dir)

    candidates_audio = [
        outputs_dir / f"{task_id}.mp3",
        outputs_dir / f"{task_id}.wav",
        outputs_dir / "edited" / f"{task_id}.mp3",
        outputs_dir / "edited" / f"{task_id}.wav",
        outputs_dir / "qa" / f"{task_id}.mp3",
        outputs_dir / "qa" / f"{task_id}.wav",
    ]
    candidates_midi = [
        outputs_dir / f"{task_id}.mid",
        outputs_dir / "downloads" / f"{task_id}.mid",
        outputs_dir / "qa" / "downloads" / f"{task_id}.mid",
        outputs_dir / "qa" / f"{task_id}.mid",
    ]
    candidates_score = [
        outputs_dir / "scores" / f"{task_id}.score.json",
        outputs_dir / f"{task_id}.score.json",
    ]

    audio_path = next((p for p in candidates_audio if p.exists()), None)
    midi_path = next((p for p in candidates_midi if p.exists()), None)
    score_json = next((p for p in candidates_score if p.exists()), None)

    return ArtifactPaths(task_json=None, score_json=score_json, midi_path=midi_path, audio_path=audio_path)


def _iter_notes(score: ScoreDoc) -> Iterable[Tuple[int, int, int, float, float, int]]:
    """
    yield (track_index, channel, program, start, duration, velocity)
    """
    for ti, tr in enumerate(score.tracks):
        for ne in tr.notes:
            yield (ti, tr.channel, tr.program, float(ne.start), float(ne.duration), int(ne.velocity))


def _score_stats(score: ScoreDoc, *, bucket_ms: int = 50) -> Dict[str, Any]:
    notes = list(_iter_notes(score))
    if not notes:
        return {"notes": 0}

    starts = [n[3] for n in notes]
    durs = [n[4] for n in notes]
    vels = [n[5] for n in notes]

    # concurrency-ish: bucket start times
    bucket = bucket_ms / 1000.0
    buckets: Dict[int, int] = {}
    for s in starts:
        k = int(round(s / bucket))
        buckets[k] = buckets.get(k, 0) + 1

    max_simul = max(buckets.values()) if buckets else 0
    heavily_stacked = sum(1 for c in buckets.values() if c >= 4)

    # pitch range
    pitches = []
    for tr in score.tracks:
        for ne in tr.notes:
            pitches.append(int(ne.pitch))

    return {
        "tempo_bpm": float(score.tempo_bpm),
        "time_signature": score.time_signature,
        "tracks": len(score.tracks),
        "notes": len(notes),
        "pitch_min": min(pitches) if pitches else None,
        "pitch_max": max(pitches) if pitches else None,
        "start_min_s": min(starts),
        "start_max_s": max(starts),
        "duration_min_s": min(durs),
        "duration_max_s": max(durs),
        "velocity_min": min(vels),
        "velocity_max": max(vels),
        "bucket_ms": bucket_ms,
        "max_notes_same_bucket": max_simul,
        "num_buckets_with_4plus_notes": heavily_stacked,
        "hint_mashed": (max_simul >= 6) or (heavily_stacked >= 3),
    }


def _dump_notes_csv(score: ScoreDoc, csv_path: Path) -> None:
    _safe_mkdir(csv_path.parent)
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["track", "name", "channel", "program", "pitch", "start_s", "duration_s", "velocity"])
        for ti, tr in enumerate(score.tracks):
            for ne in tr.notes:
                w.writerow(
                    [
                        ti,
                        tr.name,
                        tr.channel,
                        tr.program,
                        int(ne.pitch),
                        float(ne.start),
                        float(ne.duration),
                        int(ne.velocity),
                    ]
                )


def _render_report_md(out_dir: Path, *, local: ArtifactPaths, remote: ArtifactPaths, derived: Dict[str, Any]) -> None:
    lines: List[str] = []
    lines.append(f"# Hum2Song Debug Report\n")
    lines.append(f"Output dir: `{out_dir}`\n")

    def show_paths(title: str, ap: ArtifactPaths) -> None:
        lines.append(f"## {title}\n")
        lines.append(f"- task.json: `{ap.task_json}`" if ap.task_json else "- task.json: (none)")
        lines.append(f"- score.json: `{ap.score_json}`" if ap.score_json else "- score.json: (none)")
        lines.append(f"- midi: `{ap.midi_path}`" if ap.midi_path else "- midi: (none)")
        lines.append(f"- audio: `{ap.audio_path}`" if ap.audio_path else "- audio: (none)")
        lines.append("")

    show_paths("Remote capture", remote)
    show_paths("Local found", local)

    lines.append("## Derived\n")
    for k, v in derived.items():
        lines.append(f"### {k}\n")
        lines.append("```json")
        lines.append(json.dumps(v, ensure_ascii=False, indent=2))
        lines.append("```")
        lines.append("")

    _write_text(out_dir / "report.md", "\n".join(lines))


def dump_task_bundle(
    task_id: str,
    *,
    out_dir: Path,
    base_url: Optional[str] = None,
    outputs_dir: Optional[Path] = None,
) -> Path:
    """
    Create a debug bundle directory:
      <out_dir>/<task_id>/
        remote/*
        local/*
        derived/*
        report.md
    """
    bundle_dir = Path(out_dir) / task_id
    remote_dir = bundle_dir / "remote"
    local_dir = bundle_dir / "local"
    derived_dir = bundle_dir / "derived"
    _safe_mkdir(remote_dir)
    _safe_mkdir(local_dir)
    _safe_mkdir(derived_dir)

    remote = ArtifactPaths(None, None, None, None)
    if base_url:
        remote = _download_remote(task_id, base_url, bundle_dir)

    local = ArtifactPaths(None, None, None, None)
    if outputs_dir:
        local = _find_local(task_id, outputs_dir)
        # copy local hits into bundle
        _copy_if_exists(local.midi_path, local_dir / f"{task_id}.mid" if local.midi_path else local_dir / "midi.mid")
        if local.audio_path:
            _copy_if_exists(local.audio_path, local_dir / local.audio_path.name)
        if local.score_json:
            _copy_if_exists(local.score_json, local_dir / local.score_json.name)

    derived: Dict[str, Any] = {}

    # Prefer remote midi if available; else use local
    midi_src = remote.midi_path or local.midi_path
    if midi_src and Path(midi_src).exists():
        score_from_midi = midi_to_score(Path(midi_src))
        _write_json(derived_dir / f"{task_id}.midi.score.json", score_from_midi.model_dump())
        _dump_notes_csv(score_from_midi, derived_dir / f"{task_id}.midi.notes.csv")
        derived["midi_stats"] = _score_stats(score_from_midi)

    # If remote score exists, compute stats too
    score_src = remote.score_json or local.score_json
    if score_src and Path(score_src).exists():
        try:
            raw = json.loads(Path(score_src).read_text(encoding="utf-8"))
            # be permissive: validate if matches ScoreDoc
            score_doc = ScoreDoc.model_validate(raw)
            _write_json(derived_dir / f"{task_id}.score.stats.json", _score_stats(score_doc))
            derived["score_stats"] = _score_stats(score_doc)
            _dump_notes_csv(score_doc, derived_dir / f"{task_id}.score.notes.csv")
        except Exception as e:
            derived["score_stats_error"] = str(e)

    _render_report_md(bundle_dir, local=local, remote=remote, derived=derived)
    return bundle_dir


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="hum2song.debug", description="Hum2Song debug/QA bundle generator")
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("dump", help="Dump a task's artifacts + derived summaries into a debug bundle folder")
    d.add_argument("task_id", type=str)
    d.add_argument("--base-url", type=str, default=None, help="If set, download from server (e.g. http://127.0.0.1:8000)")
    d.add_argument("--out-dir", type=str, default=str(Path("outputs") / "debug"), help="Bundle root output dir")
    d.add_argument(
        "--outputs-dir",
        type=str,
        default=str(Path("outputs")),
        help="Try to find local artifacts under this outputs dir too",
    )

    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = _build_parser().parse_args(argv)
    if args.cmd == "dump":
        bundle = dump_task_bundle(
            args.task_id,
            out_dir=Path(args.out_dir),
            base_url=args.base_url,
            outputs_dir=Path(args.outputs_dir) if args.outputs_dir else None,
        )
        print(bundle)
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
