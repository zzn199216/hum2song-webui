from core.score_models import ScoreDoc, Track, NoteEvent, normalize_score
import pytest

def test_normalize_fixes_track_name_type():
    """
    DoD: 强制 Track.name = str(...) 兜底，防止 int 导致的 crash。
    """
    # 模拟一个脏数据，name 是 int，或者 None
    raw_data = {
        "tempo_bpm": 120,
        "tracks": [
            {
                "name": 12345,  # 这里的 int 曾导致 Bug
                "notes": []
            },
            {
                "name": None,   # 这里的 None 也是隐患
                "notes": []
            }
        ]
    }
    # Pydantic 在 validate 时可能允许 coercion，但在 normalize 里我们显式处理了
    doc = ScoreDoc.model_validate(raw_data)
    
    # 执行 Normalize
    normalized = normalize_score(doc)
    
    # 断言
    t1 = normalized.tracks[0]
    t2 = normalized.tracks[1]
    
    assert isinstance(t1.name, str)
    assert t1.name == "12345"
    
    assert isinstance(t2.name, str)
    assert t2.name.startswith("Track")  # 默认补名逻辑

def test_normalize_stable_ids_and_sorting():
    """
    DoD: 排序稳定 + 补 note.id + float round
    """
    # 乱序、无 ID、浮点数精度过高的音符
    raw_notes = [
        {"pitch": 60, "start": 1.000000009, "duration": 0.5},
        {"pitch": 58, "start": 0.5, "duration": 0.5},
        {"pitch": 60, "start": 1.0, "duration": 0.5}, # start 与第一个极为接近，应视为同一时间
    ]
    
    doc = ScoreDoc(tracks=[Track(name="Test", notes=raw_notes)])
    
    normalized = normalize_score(doc, round_ndigits=6)
    track = normalized.tracks[0]
    
    # 1. 检查 ID 是否补全
    assert track.id is not None
    assert all(n.id.startswith("n_") for n in track.notes)
    
    # 2. 检查 Rounding (1.000000009 -> 1.0)
    # 此时两个 start 应该都是 1.0
    assert track.notes[1].start == 1.0
    assert track.notes[2].start == 1.0
    
    # 3. 检查排序 (Start -> Pitch)
    # 预期顺序：
    # - 0.5s, pitch 58
    # - 1.0s, pitch 60 (原第3个，因为 id hash 可能会影响次序，但在 stable sort 下只要 start/pitch 一样就行)
    # - 1.0s, pitch 60
    assert track.notes[0].pitch == 58
    assert track.notes[0].start == 0.5
    
    assert track.notes[1].start == 1.0
    assert track.notes[2].start == 1.0

def test_normalize_is_idempotent():
    """
    DoD: normalize(normalize(x)) == normalize(x)
    """
    doc = ScoreDoc(tracks=[Track(name="Test", notes=[{"pitch": 60, "start": 0, "duration": 1}])])
    
    once = normalize_score(doc)
    twice = normalize_score(once)
    
    # dump json string compare
    assert once.model_dump_json() == twice.model_dump_json()

if __name__ == "__main__":
    # 允许直接 python 运行
    import sys
    from pydantic import ValidationError
    try:
        test_normalize_fixes_track_name_type()
        test_normalize_stable_ids_and_sorting()
        test_normalize_is_idempotent()
        print("✅ Step 0 DoD Passed: All normalize tests green.")
    except Exception as e:
        print(f"❌ Step 0 Failed: {e}")
        sys.exit(1)