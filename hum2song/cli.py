from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from core.models import FileType, TaskStatus
import core.synthesizer as synth  # IMPORTANT: allow monkeypatch in tests
from core.score_models import ScoreDoc
from core.score_optimize import OptimizeConfig, optimize_score

from hum2song.api_client import ContractError, HTTPError, Hum2SongClient, NetworkError


# exit codes (keep stable)
EXIT_OK = 0
EXIT_TASK_FAILED = 2
EXIT_TIMEOUT = 3
EXIT_NETWORK_OR_HTTP = 4
EXIT_BAD_ARGS = 5


def _print_err(msg: str) -> None:
    print(msg, file=sys.stderr)


def _safe_filename(name: str) -> str:
    # minimal cross-platform sanitize
    return "".join(c if c not in r'<>:"/\\|?*' else "_" for c in name)


class _MidiOutAction(argparse.Action):
    """
    argparse action:
    --midi-out <path> implies download_midi=True
    """

    def __call__(self, parser, namespace, values, option_string=None):
        setattr(namespace, self.dest, values)
        # imply midi download
        setattr(namespace, "download_midi", True)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="hum2song", description="Hum2Song CLI (FastAPI backend + local tools)")
    sub = p.add_subparsers(dest="cmd", required=True)

    # ------------------------------------------------------------
    # generate: upload -> poll -> (optional) download
    # ------------------------------------------------------------
    g = sub.add_parser("generate", help="Upload -> poll -> download artifacts")
    g.add_argument("file", type=str, help="Path to audio file")
    g.add_argument("--base-url", dest="base_url", default="http://127.0.0.1:8000", help="Server base url")
    g.add_argument("--format", default="mp3", choices=["mp3", "wav"], help="Output format")
    g.add_argument("--out-dir", dest="out_dir", default=".", help="Output directory")
    g.add_argument("--poll-interval", type=float, default=1.0, help="Polling interval seconds")
    g.add_argument("--timeout", type=float, default=60.0, help="Polling timeout seconds")
    g.add_argument("--no-wait", action="store_true", help="Only submit task and exit (no polling)")
    g.add_argument("--no-download", action="store_true", help="Do not download artifacts")
    g.add_argument(
        "--download",
        default="audio",
        choices=["audio", "midi", "both"],
        help="What to download when task completes",
    )
    g.add_argument("--download-midi", dest="download_midi", action="store_true", help="Download midi after completion")
    # required by existing tests:
    g.add_argument("--midi-out", dest="midi_out", default=None, action=_MidiOutAction, help="Write midi to this path")

    # ------------------------------------------------------------
    # synth: local MIDI -> audio (no server)
    # ------------------------------------------------------------
    s = sub.add_parser("synth", help="Local synth: MIDI -> WAV/MP3")
    s.add_argument("midi", type=str, help="Path to MIDI file")
    s.add_argument("--format", default="mp3", choices=["mp3", "wav"], help="Output format")
    s.add_argument("--out-dir", dest="out_dir", default=".", help="Output directory")
    s.add_argument("--gain", type=float, default=0.8, help="Synthesis gain (0.0~5.0)")
    s.add_argument("--keep-wav", action="store_true", help="Keep intermediate wav when output is mp3")

    # ------------------------------------------------------------
    # score: score.json workflow
    # ------------------------------------------------------------
    sc = sub.add_parser("score", help="Score workflow: pull/push/optimize score.json")
    sc_sub = sc.add_subparsers(dest="score_cmd", required=True)

    pull = sc_sub.add_parser("pull", help="GET /tasks/{id}/score -> save score.json")
    pull.add_argument("task_id", type=str, help="Task UUID")
    pull.add_argument("--base-url", dest="base_url", default="http://127.0.0.1:8000", help="Server base url")
    pull.add_argument("--out", type=str, default="", help="Output .json path (default: <out-dir>/<task_id>.score.json)")
    pull.add_argument("--out-dir", dest="out_dir", type=str, default=".", help="Output directory")

    push = sc_sub.add_parser("push", help="PUT /tasks/{id}/score (and optionally render + download)")
    push.add_argument("task_id", type=str, help="Task UUID")
    push.add_argument("--base-url", dest="base_url", default="http://127.0.0.1:8000", help="Server base url")
    push.add_argument("--score", type=str, required=True, help="Path to score.json")
    push.add_argument("--render", action="store_true", help="Trigger /render after uploading score")
    push.add_argument("--format", default="mp3", choices=["mp3", "wav"], help="Render output format (when --render)")
    push.add_argument("--out-dir", dest="out_dir", default=".", help="Output directory for downloaded artifacts")
    push.add_argument(
        "--download",
        default="auto",
        choices=["auto", "none", "audio", "midi", "both"],
        help="Download after push",
    )
    push.add_argument("--download-midi", dest="download_midi", action="store_true", help="Download midi after push")
    push.add_argument("--midi-out", dest="midi_out", default=None, action=_MidiOutAction, help="Write midi to this path")

    # NEW: optimize score.json locally (no server)
    opt = sc_sub.add_parser("optimize", help="Optimize a local score.json (deterministic rules; LLM-ready)")
    opt.add_argument("score_path", type=str, help="Input score.json path")
    opt.add_argument("--out", type=str, default="", help="Output .json path (default: <input>.opt.score.json)")

    # Presets:
    # - safe (default): do NOT change timing/order; only apply explicit options user asked for.
    # - strong: quantize/clip/merge/monophonic/noise-filter (good for demo, can change melody).
    opt.add_argument("--preset", choices=["safe", "strong"], default="safe", help="Optimization preset (default: safe)")

    # Use None defaults so preset can decide. Any explicit flag overrides preset.
    opt.add_argument("--grid-div", dest="grid_div", type=int, default=None, help="Quantize grid: subdivisions per quarter (e.g., 4=1/16). 0/None disables quantize")
    opt.add_argument("--min-pitch", dest="min_pitch", type=int, default=None, help="Clamp pitch lower bound (0-127). None disables")
    opt.add_argument("--max-pitch", dest="max_pitch", type=int, default=None, help="Clamp pitch upper bound (0-127). None disables")
    opt.add_argument("--velocity", dest="velocity", type=int, default=0, help="If >0, force all velocities to this (1-127)")

    mg = opt.add_mutually_exclusive_group()
    mg.add_argument("--merge-overlaps", dest="merge_overlaps", action="store_true", default=None, help="Merge same-pitch overlapping notes")
    mg.add_argument("--no-merge-overlaps", dest="merge_overlaps", action="store_false", default=None, help="Do not merge same-pitch overlapping notes")

    mono = opt.add_mutually_exclusive_group()
    mono.add_argument("--monophonic", dest="monophonic", action="store_true", default=None, help="Force monophonic (remove overlaps)")
    mono.add_argument("--polyphonic", dest="monophonic", action="store_false", default=None, help="Keep polyphony (do not remove overlaps)")

    return p


# -------------------------------
# Commands
# -------------------------------
def cmd_generate(args: argparse.Namespace) -> int:
    audio_path = Path(args.file)
    out_dir = Path(args.out_dir)

    client = Hum2SongClient(base_url=args.base_url)
    try:
        # 1) submit
        resp = client.submit_task(audio_path, output_format=args.format)
        task_id = str(resp.task_id)
        print(f"task_id={task_id}")
        print(f"poll_url={resp.poll_url}")

        if args.no_wait:
            return EXIT_OK

        # 2) poll
        deadline = time.time() + float(args.timeout)
        last_line = ""
        while True:
            if time.time() > deadline:
                _print_err("Timeout waiting for task completion.")
                return EXIT_TIMEOUT

            info = client.get_status(task_id)
            line = f"status={info.status} stage={info.stage} progress={info.progress:.2f}"
            if line != last_line:
                print(line)
                last_line = line

            if info.status == TaskStatus.completed:
                break
            if info.status == TaskStatus.failed:
                msg = info.error.message if info.error else "Task failed"
                _print_err(f"Task failed: {msg}")
                return EXIT_TASK_FAILED

            time.sleep(max(0.1, float(args.poll_interval)))

        # 3) download
        if args.no_download:
            return EXIT_OK

        # Resolve what to download (keep backward compatible semantics):
        # - args.download selects base set
        # - args.download_midi OR args.midi_out implies midi included
        want_audio = args.download in ("audio", "both")
        want_midi = (
            args.download in ("midi", "both")
            or bool(getattr(args, "download_midi", False))
            or bool(getattr(args, "midi_out", None))
        )

        targets: list[FileType] = []
        if want_audio:
            targets.append(FileType.audio)
        if want_midi:
            targets.append(FileType.midi)

        for ft in targets:
            # file name
            filename = None
            if info.result and info.result.file_type == ft:
                filename = info.result.filename

            if not filename:
                ext = "mid" if ft == FileType.midi else args.format
                filename = f"{task_id}.{ext}"
            filename = _safe_filename(filename)

            if ft == FileType.midi:
                # if user provided --midi-out, use it; else default under out_dir/downloads/
                if getattr(args, "midi_out", None):
                    dest = Path(args.midi_out).resolve()
                else:
                    dest = (out_dir / "downloads" / filename).resolve()
            else:
                dest = (out_dir / filename).resolve()

            # use either new or old method (both exist)
            if hasattr(client, "download_task_file"):
                dl = client.download_task_file(task_id, file_type=ft, dest_path=dest, overwrite=True)  # type: ignore[attr-defined]
            else:
                dl = client.download_file(task_id, file_type=ft, dest_path=dest, overwrite=True)

            print(f"downloaded {ft.value}: {dl.path} ({dl.bytes_written} bytes)")

        return EXIT_OK

    except (NetworkError, HTTPError) as e:
        _print_err(str(e))
        return EXIT_NETWORK_OR_HTTP
    except ContractError as e:
        _print_err(f"Contract error: {e}")
        return EXIT_NETWORK_OR_HTTP
    except ValueError as e:
        _print_err(str(e))
        return EXIT_BAD_ARGS
    finally:
        client.close()


def cmd_synth(args: argparse.Namespace) -> int:
    midi_path = Path(args.midi)
    out_dir = Path(args.out_dir)

    try:
        out_path = synth.midi_to_audio(
            midi_path,
            output_dir=out_dir,
            output_format=args.format,
            gain=float(args.gain),
            keep_wav=bool(args.keep_wav),
        )
        print(str(out_path))
        return EXIT_OK
    except FileNotFoundError as e:
        _print_err(str(e))
        return EXIT_BAD_ARGS
    except Exception as e:
        _print_err(str(e))
        return EXIT_NETWORK_OR_HTTP


def cmd_score_pull(args: argparse.Namespace) -> int:
    task_id = str(args.task_id)
    out_dir = Path(args.out_dir)
    out_path = Path(args.out) if args.out else (out_dir / f"{task_id}.score.json")
    out_path = out_path.resolve()

    client = Hum2SongClient(base_url=args.base_url)
    try:
        score = client.get_score(task_id)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(score, ensure_ascii=False, indent=2), encoding="utf-8")
        print(str(out_path))
        return EXIT_OK
    except (NetworkError, HTTPError) as e:
        _print_err(str(e))
        return EXIT_NETWORK_OR_HTTP
    except ContractError as e:
        _print_err(f"Contract error: {e}")
        return EXIT_NETWORK_OR_HTTP
    finally:
        client.close()


def _read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        raise ValueError(f"Invalid JSON: {path} ({e})") from e


def cmd_score_push(args: argparse.Namespace) -> int:
    task_id = str(args.task_id)
    score_path = Path(args.score).resolve()
    out_dir = Path(args.out_dir).resolve()

    client = Hum2SongClient(base_url=args.base_url)
    try:
        score_json = _read_json(score_path)
        client.put_score(task_id, score_json=score_json)
        print("score uploaded")

        did_render = False
        if args.render:
            client.render_audio(task_id, output_format=args.format)
            did_render = True
            print("render triggered")

        # auto policy
        download_choice = str(args.download)
        if download_choice == "auto":
            download_choice = "audio" if did_render else "none"

        want_audio = download_choice in ("audio", "both")
        want_midi = (
            download_choice in ("midi", "both")
            or bool(getattr(args, "download_midi", False))
            or bool(getattr(args, "midi_out", None))
        )

        if download_choice == "none":
            return EXIT_OK

        targets: list[FileType] = []
        if want_audio:
            targets.append(FileType.audio)
        if want_midi:
            targets.append(FileType.midi)

        for ft in targets:
            ext = "mid" if ft == FileType.midi else args.format
            filename = _safe_filename(f"{task_id}.{ext}")

            if ft == FileType.midi:
                dest = Path(args.midi_out).resolve() if getattr(args, "midi_out", None) else (out_dir / "downloads" / filename).resolve()
            else:
                dest = (out_dir / filename).resolve()

            if hasattr(client, "download_task_file"):
                dl = client.download_task_file(task_id, file_type=ft, dest_path=dest, overwrite=True)  # type: ignore[attr-defined]
            else:
                dl = client.download_file(task_id, file_type=ft, dest_path=dest, overwrite=True)

            print(f"downloaded {ft.value}: {dl.path} ({dl.bytes_written} bytes)")

        return EXIT_OK

    except (NetworkError, HTTPError) as e:
        _print_err(str(e))
        return EXIT_NETWORK_OR_HTTP
    except ContractError as e:
        _print_err(f"Contract error: {e}")
        return EXIT_NETWORK_OR_HTTP
    except ValueError as e:
        _print_err(str(e))
        return EXIT_BAD_ARGS
    finally:
        client.close()


def cmd_score_optimize(args: argparse.Namespace) -> int:
    in_path = Path(args.score_path).resolve()
    if not in_path.exists() or not in_path.is_file():
        _print_err(f"score_path not found: {in_path}")
        return EXIT_BAD_ARGS

    # default output naming
    if args.out:
        out_path = Path(args.out).resolve()
    else:
        name = in_path.name
        if name.endswith(".score.json"):
            out_name = name.replace(".score.json", ".opt.score.json")
        else:
            out_name = f"{in_path.stem}.opt.score.json"
        out_path = in_path.with_name(out_name).resolve()

    try:
        raw = _read_json(in_path)
        score = ScoreDoc.model_validate(raw)

        preset = str(getattr(args, "preset", "safe"))

        # Preset defaults (explicit CLI args override these)
        if preset == "strong":
            grid_div = 4 if args.grid_div is None else int(args.grid_div)
            min_pitch = 48 if args.min_pitch is None else int(args.min_pitch)
            max_pitch = 84 if args.max_pitch is None else int(args.max_pitch)
            noise_min_duration = 0.03
            noise_min_velocity = 25
            merge_default = True
            mono_default = True
        else:
            # safe: do not alter timing/order unless explicitly requested
            grid_div = None if args.grid_div is None else int(args.grid_div)
            min_pitch = None if args.min_pitch is None else int(args.min_pitch)
            max_pitch = None if args.max_pitch is None else int(args.max_pitch)
            noise_min_duration = 0.0
            noise_min_velocity = 0
            merge_default = False
            mono_default = False

        if grid_div == 0:
            grid_div = None

        merge_overlaps = merge_default if getattr(args, "merge_overlaps", None) is None else bool(args.merge_overlaps)
        monophonic = mono_default if getattr(args, "monophonic", None) is None else bool(args.monophonic)

        cfg = OptimizeConfig(
            grid_div=grid_div,
            min_pitch=min_pitch,
            max_pitch=max_pitch,
            velocity_target=(int(args.velocity) if int(args.velocity) > 0 else None),
            merge_same_pitch_overlaps=merge_overlaps,
            make_monophonic=monophonic,
            noise_min_duration=noise_min_duration,
            noise_min_velocity=noise_min_velocity,
        )


        optimized = optimize_score(score, cfg)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(optimized.model_dump_json(indent=2), encoding="utf-8")
        print(str(out_path))
        return EXIT_OK

    except ValueError as e:
        _print_err(str(e))
        return EXIT_BAD_ARGS
    except Exception as e:
        _print_err(str(e))
        return EXIT_NETWORK_OR_HTTP


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.cmd == "generate":
        return cmd_generate(args)
    if args.cmd == "synth":
        return cmd_synth(args)
    if args.cmd == "score":
        if args.score_cmd == "pull":
            return cmd_score_pull(args)
        if args.score_cmd == "push":
            return cmd_score_push(args)
        if args.score_cmd == "optimize":
            return cmd_score_optimize(args)

    _print_err("Unknown command.")
    return EXIT_BAD_ARGS


if __name__ == "__main__":
    raise SystemExit(main())
