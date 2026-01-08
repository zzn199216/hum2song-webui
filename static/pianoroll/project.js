// static/pianoroll/project.js
// Pure data utilities (no DOM). ESM exports.

export const STORAGE_KEY = "hum2song.project.v1";

export function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export function emptyProject() {
  return {
    version: 1,
    bpm: 120,
    tracks: [{ id: "t1", name: "Track 1" }],
    clips: {},         // clipId -> ClipDoc
    instances: [],     // {id, clipId, trackId, start, transpose}
    ui: {
      zoomPxPerSec: 120,
      selectedInstanceId: null,
    }
  };
}

export function clipFromScore({ clipId, name, score, taskId = null }) {
  const span = estimateScoreSpanSeconds(score);
  const notesCount = countNotes(score);
  return {
    id: clipId,
    name: name || `Clip ${clipId.slice(0, 6)}`,
    createdAt: new Date().toISOString(),
    source: { task_id: taskId },
    score, // ScoreDoc JSON
    stats: {
      span_s: span,
      notes: notesCount,
      bpm: score?.bpm ?? null,
      pitchMin: minPitch(score),
      pitchMax: maxPitch(score),
    },
    // server audio preview (optional)
    audio_url: taskId ? `/tasks/${taskId}/download?file_type=audio` : null,
  };
}

export function countNotes(score) {
  if (!score?.tracks?.length) return 0;
  let n = 0;
  for (const t of score.tracks) n += (t.notes?.length || 0);
  return n;
}

export function allNotes(score) {
  const out = [];
  if (!score?.tracks?.length) return out;
  for (const t of score.tracks) {
    const arr = t.notes || [];
    for (const note of arr) out.push(note);
  }
  return out;
}

export function minPitch(score) {
  const notes = allNotes(score);
  if (!notes.length) return null;
  let m = notes[0].pitch;
  for (const n of notes) m = Math.min(m, n.pitch);
  return m;
}

export function maxPitch(score) {
  const notes = allNotes(score);
  if (!notes.length) return null;
  let m = notes[0].pitch;
  for (const n of notes) m = Math.max(m, n.pitch);
  return m;
}

export function estimateScoreSpanSeconds(score) {
  const notes = allNotes(score);
  if (!notes.length) return 0;
  let end = 0;
  for (const n of notes) {
    const e = (n.start ?? 0) + (n.duration ?? 0);
    if (e > end) end = e;
  }
  return end;
}

export function addInstance(project, { clipId, trackId = "t1", start = 0, transpose = 0 }) {
  const inst = {
    id: uid("inst"),
    clipId,
    trackId,
    start: Number(start) || 0,
    transpose: Number(transpose) || 0,
  };
  project.instances.push(inst);
  return inst;
}

export function ensureTrack(project) {
  if (!project.tracks?.length) project.tracks = [{ id: "t1", name: "Track 1" }];
  if (!project.tracks.find(t => t.id === "t1")) project.tracks.unshift({ id: "t1", name: "Track 1" });
  return project;
}

export function serialize(project) {
  return JSON.stringify(project, null, 2);
}

export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveToStorage(project) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}

export function normalizeProject(p) {
  // Defensive normalization (avoid undefined fields)
  if (!p || typeof p !== "object") return emptyProject();
  if (p.version !== 1) p.version = 1;
  if (typeof p.bpm !== "number") p.bpm = 120;
  if (!Array.isArray(p.tracks)) p.tracks = [{ id: "t1", name: "Track 1" }];
  if (!p.clips || typeof p.clips !== "object") p.clips = {};
  if (!Array.isArray(p.instances)) p.instances = [];
  if (!p.ui || typeof p.ui !== "object") p.ui = { zoomPxPerSec: 120, selectedInstanceId: null };
  if (typeof p.ui.zoomPxPerSec !== "number") p.ui.zoomPxPerSec = 120;
  if (!("selectedInstanceId" in p.ui)) p.ui.selectedInstanceId = null;
  ensureTrack(p);
  return p;
}
