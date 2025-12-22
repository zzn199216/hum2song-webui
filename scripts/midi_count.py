from pathlib import Path
import sys
import mido

def count_notes(mid_path: Path) -> int:
    mid = mido.MidiFile(mid_path)
    active = set()
    notes = 0
    for tr in mid.tracks:
        t = 0
        for msg in tr:
            t += msg.time
            if msg.type == "note_on" and msg.velocity > 0:
                active.add((msg.channel, msg.note))
            elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
                key = (msg.channel, msg.note)
                if key in active:
                    active.remove(key)
                    notes += 1
    return notes

if __name__ == "__main__":
    p = Path(sys.argv[1])
    print(p.name, "notes=", count_notes(p), "ppq=", mido.MidiFile(p).ticks_per_beat)
