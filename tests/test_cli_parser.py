from __future__ import annotations

from hum2song.cli import build_parser


def test_cli_parser_generate_defaults():
    p = build_parser()
    args = p.parse_args(["generate", "a.wav"])
    assert args.base_url == "http://127.0.0.1:8000"
    assert args.format == "mp3"
    assert args.out_dir == "."
    assert args.no_download is False
    assert args.download == "audio"
    assert args.download_midi is False
    assert args.midi_out is None


def test_cli_parser_generate_download_midi_flag():
    p = build_parser()
    args = p.parse_args(["generate", "a.wav", "--download-midi"])
    assert args.download_midi is True


def test_cli_parser_generate_midi_out_implies_midi_download():
    p = build_parser()
    args = p.parse_args(["generate", "a.wav", "--midi-out", "x.mid"])
    assert args.midi_out == "x.mid"
    assert args.download_midi is True


def test_cli_parser_score_optimize_defaults():
    p = build_parser()
    args = p.parse_args(["score", "optimize", "in.score.json"])
    assert args.cmd == "score"
    assert args.score_cmd == "optimize"
    assert args.grid_div == 4
    assert args.min_pitch == 48
    assert args.max_pitch == 84
    assert args.velocity == 0
    assert args.no_merge_overlaps is False
