from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from core.models import FileType, TaskStatus
from hum2song.api_client import Hum2SongClient, ContractError, HTTPError, NetworkError


# exit codes (frozen)
EXIT_OK = 0
EXIT_TASK_FAILED = 2
EXIT_TIMEOUT = 3
EXIT_NETWORK_OR_HTTP = 4
EXIT_BAD_ARGS = 5


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="hum2song", description="Hum2Song CLI (Contract API)")
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("generate", help="Upload -> poll -> (optional) download")
    g.add_argument("file", type=str, help="Path to audio file")
    g.add_argument("--base-url", default="http://127.0.0.1:8000", help="Server base url")
    g.add_argument("--format", default="mp3", choices=["mp3", "wav"], help="Output format")
    g.add_argument("--out-dir", default=".", help="Output directory")
    g.add_argument("--no-download", action="store_true", help="Do not download artifacts")
    g.add_argument("--no-wait", action="store_true", help="Only submit task and exit")
    g.add_argument("--download", default="audio", choices=["audio", "midi", "both"], help="What to download")
    # convenience flags (do not break existing --download semantics)
    g.add_argument("--download-midi", action="store_true", help="Also download MIDI artifact")
    g.add_argument("--midi-out", default=None, help="Custom path to save MIDI file (implies download MIDI)")
    g.add_argument("--poll-interval", type=float, default=1.0, help="Polling interval seconds")
    g.add_argument("--timeout", type=float, default=60.0, help="Polling timeout seconds")

    # ✅ NEW: synth subcommand (local)
    s = sub.add_parser("synth", help="Synthesize audio from a MIDI file (local)")
    s.add_argument("midi", type=str, help="Path to .mid")
    s.add_argument("--format", default="mp3", choices=["mp3", "wav"], help="Output format")
    s.add_argument("--out-dir", default=".", help="Output directory")
    s.add_argument("--gain", type=float, default=0.8, help="FluidSynth gain")
    s.add_argument("--keep-wav", action="store_true", help="Keep intermediate wav when output is mp3")

    return p


def _print_err(msg: str) -> None:
    print(msg, file=sys.stderr)


def _safe_filename(name: str) -> str:
    # minimal cross-platform sanitize
    return "".join(c if c not in r'<>:"/\|?*' else "_" for c in name)


def _resolve_midi_dest(task_id: str, out_dir: Path, *, midi_out: str | None, prefer_downloads_dir: bool) -> Path:
    """
    Default behavior:
    - if --midi-out provided: use that path (if dir -> append <task_id>.mid)
    - else:
        - if --download-midi used: save under <out-dir>/downloads/<task_id>.mid
        - otherwise: save under <out-dir>/<task_id>.mid
    """
    if midi_out:
        p = Path(midi_out)
        if p.exists() and p.is_dir():
            return (p / f"{task_id}.mid").resolve()
        if p.suffix == "":
            return p.with_suffix(".mid").resolve()
        return p.resolve()

    if prefer_downloads_dir:
        return (out_dir / "downloads" / f"{task_id}.mid").resolve()

    return (out_dir / f"{task_id}.mid").resolve()


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

        # 3) completed
        if args.no_download:
            if info.result:
                print(f"download_url={info.result.download_url}")
            return EXIT_OK

        # Decide what to download
        want = args.download
        want_audio = want in ("audio", "both")
        want_midi = want in ("midi", "both") or bool(args.download_midi) or bool(args.midi_out)

        targets: list[FileType] = []
        if want_audio:
            targets.append(FileType.audio)
        if want_midi:
            targets.append(FileType.midi)

        # Download
        for ft in targets:
            if ft == FileType.midi:
                dest = _resolve_midi_dest(
                    task_id,
                    out_dir,
                    midi_out=args.midi_out,
                    prefer_downloads_dir=bool(args.download_midi) and not bool(args.midi_out),
                )
                dest.parent.mkdir(parents=True, exist_ok=True)
                try:
                    dl = client.download_task_file(task_id, file_type=ft, dest_path=dest, overwrite=True)
                    print(f"downloaded {ft.value}: {dl.path} ({dl.bytes_written} bytes)")
                except HTTPError as e:
                    _print_err(f"download {ft.value} failed: {e}")
                continue

            # audio dest
            filename = None
            if info.result and info.result.file_type == ft:
                filename = info.result.filename

            if not filename:
                ext = args.format
                filename = f"{task_id}.{ext}"

            filename = _safe_filename(filename)
            dest = (out_dir / filename).resolve()

            try:
                dl = client.download_task_file(task_id, file_type=ft, dest_path=dest, overwrite=True)
                print(f"downloaded {ft.value}: {dl.path} ({dl.bytes_written} bytes)")
            except HTTPError as e:
                _print_err(f"download {ft.value} failed: {e}")
                return EXIT_NETWORK_OR_HTTP

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
    if not midi_path.exists() or not midi_path.is_file():
        _print_err(f"midi_path not found: {midi_path}")
        return EXIT_BAD_ARGS

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        # local synth
        from core.synthesizer import midi_to_audio

        out_path = midi_to_audio(
            midi_path,
            output_dir=out_dir,
            output_format=args.format,
            gain=float(args.gain),
            keep_wav=bool(args.keep_wav),
        )
        print(str(Path(out_path).resolve()))
        return EXIT_OK
    except Exception as e:
        _print_err(str(e))
        return EXIT_BAD_ARGS


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.cmd == "generate":
        return cmd_generate(args)
    if args.cmd == "synth":
        return cmd_synth(args)

    _print_err(f"Unknown command: {args.cmd}")
    return EXIT_BAD_ARGS


if __name__ == "__main__":
    raise SystemExit(main())
