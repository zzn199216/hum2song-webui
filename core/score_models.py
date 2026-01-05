from __future__ import annotations

from typing import List, Optional, Union  # <--- 1. 确保引入 Union
import hashlib

from pydantic import BaseModel, Field

# NoteEvent 保持不变...
class NoteEvent(BaseModel):
    id: Optional[str] = Field(None, description="Optional stable note id for UI editing")
    pitch: int = Field(..., ge=0, le=127, description="MIDI pitch 0-127")
    start: float = Field(..., ge=0.0, description="Start time in seconds")
    duration: float = Field(..., gt=0.0, description="Duration in seconds")
    velocity: int = Field(64, ge=1, le=127, description="MIDI velocity 1-127")


class Track(BaseModel):
    id: Optional[str] = Field(None, description="Optional stable track id for UI editing")
    
    # --- 修复点：放宽入口类型，允许 int 或 None 进入，后续由 normalize 转 str ---
    name: Optional[Union[str, int]] = Field("Track", description="Track name")
    
    program: Optional[int] = Field(None, ge=0, le=127, description="MIDI program/instrument 0-127")
    channel: Optional[int] = Field(None, ge=0, le=15, description="MIDI channel 0-15")
    notes: List[NoteEvent] = Field(default_factory=list)

# ScoreDoc 保持不变...
class ScoreDoc(BaseModel):
    version: int = Field(1, description="Schema version")
    tempo_bpm: float = Field(120.0, gt=0.0, description="Tempo in BPM")
    time_signature: str = Field("4/4", description="Time signature, e.g., 4/4")
    tracks: List[Track] = Field(default_factory=list)

# normalize_score 函数逻辑保持不变...
def _sha1_short(s: str, n: int) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:n]

def normalize_score(
    doc: ScoreDoc,
    *,
    round_ndigits: int = 6,
    ensure_ids: bool = True,
) -> ScoreDoc:
    # ... (保持之前的代码不变) ...
    # deep-ish copy
    data = doc.model_dump()
    out = ScoreDoc.model_validate(data)

    for ti, tr in enumerate(out.tracks):
        # 此时 tr.name 可能是 int, None 或 str
        # 强制转换为 str
        if tr.name is None:
            tr.name = f"Track{ti}"
        else:
            tr.name = str(tr.name)
            
        # ... 后续逻辑保持不变 ...
        for ne in tr.notes:
            ne.start = float(round(float(ne.start), round_ndigits))
            ne.duration = float(round(float(ne.duration), round_ndigits))
            ne.velocity = int(ne.velocity)

        if ensure_ids:
            if not tr.id:
                base = f"{ti}|{tr.name}|{tr.channel}|{tr.program}"
                tr.id = f"t_{_sha1_short(base, 10)}"

            seen: dict[str, int] = {}
            for ne in tr.notes:
                if ne.id:
                    continue
                key = f"{ne.pitch}|{ne.start}|{ne.duration}|{ne.velocity}"
                occ = seen.get(key, 0)
                seen[key] = occ + 1
                base = f"{tr.id}|{key}|{occ}"
                ne.id = f"n_{_sha1_short(base, 12)}"

        tr.notes.sort(
            key=lambda n: (
                float(n.start),
                int(n.pitch),
                float(n.duration),
                int(n.velocity),
                (n.id or ""),
            )
        )

    return out