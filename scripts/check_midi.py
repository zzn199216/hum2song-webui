# check_midi.py
from music21 import midi
import os

# ==========================================
# 🔴 请把下面这行引号里的内容，改成你刚才找到的那个 MIDI 文件的实际路径
# 注意：在 Windows 里路径可以用斜杠 /，这样比较不容易出错
FILE_PATH = "outputs/qa/你的文件名.mid"  
# ==========================================

def check():
    print(f"Checking MIDI file: {FILE_PATH}")
    
    if not os.path.exists(FILE_PATH):
        print("❌ 错误：找不到文件！请检查路径是否写对。")
        return

    try:
        mf = midi.MidiFile()
        mf.open(FILE_PATH)
        mf.read()
        mf.close()
    except Exception as e:
        print(f"❌ 读取失败，文件可能损坏: {e}")
        return
    
    print(f"--- MIDI 结构信息 ---")
    print(f"总轨道数 (Tracks): {len(mf.tracks)}")
    
    total_notes = 0
    for i, tr in enumerate(mf.tracks):
        print(f"\n[轨道 {i}] 事件数: {len(tr.events)}")
        for ev in tr.events:
            # 筛选“按下琴键”的事件 (Note On 且力度大于0)
            if ev.type == "NOTE_ON" and ev.velocity > 0:
                print(f"  🎵 音符: 音高(Pitch)={ev.pitch}, 力度={ev.velocity}, 时间={ev.time}")
                total_notes += 1
    
    print(f"\n==============================")
    print(f"🟢 最终统计：一共找到了 {total_notes} 个音符")
    print(f"==============================")

if __name__ == "__main__":
    check()