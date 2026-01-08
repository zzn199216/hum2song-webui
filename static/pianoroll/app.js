// static/pianoroll/app.js
import {
  STORAGE_KEY,
  emptyProject,
  clipFromScore,
  addInstance,
  normalizeProject,
  loadFromStorage,
  saveToStorage,
  serialize,
  uid,
} from "./project.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const ui = {
  wavInput: $("#wavInput"),
  importProjectInput: $("#importProjectInput"),
  genState: $("#gen-state"),
  genMsg: $("#gen-msg"),
  clipList: $("#clipList"),
  lanes: $("#lanes"),
  timelineCanvas: $("#timelineCanvas"),
  playhead: $("#playhead"),
  playheadLabel: $("#playheadLabel"),
  zoomRange: $("#zoomRange"),
  zoomLabel: $("#zoomLabel"),
  bpmInput: $("#bpmInput"),
  logArea: $("#logArea"),
  toast: $("#toast"),

  kTracks: $("#kTracks"),
  kClips: $("#kClips"),
  kInst: $("#kInst"),

  selEmpty: $("#selEmpty"),
  selBox: $("#selBox"),
  selId: $("#selId"),
  selClip: $("#selClip"),
  selStart: $("#selStart"),
  selTrans: $("#selTrans"),

  editorModal: $("#editorModal"),
  editorTitle: $("#editorTitle"),
  editorCanvas: $("#editorCanvas"),
};

const state = {
  project: normalizeProject(loadFromStorage() || emptyProject()),
  lastTaskId: null,
  dragging: null, // {instId, startX, origLeftPx}
  audio: new Audio(),
};

function log(msg) {
  const t = new Date();
  const ts = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
  ui.logArea.textContent += `[${ts}] ${msg}\n`;
  ui.logArea.scrollTop = ui.logArea.scrollHeight;
}

function toast(title, detail = "") {
  ui.toast.innerHTML = `${escapeHtml(title)}${detail ? `<small>${escapeHtml(detail)}</small>` : ""}`;
  ui.toast.classList.add("show");
  setTimeout(() => ui.toast.classList.remove("show"), 2600);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

function setGenState(kind, msg) {
  ui.genState.className = "pill";
  if (kind === "good") ui.genState.classList.add("good");
  if (kind === "warn") ui.genState.classList.add("warn");
  if (kind === "bad") ui.genState.classList.add("bad");
  ui.genState.textContent = kind;
  ui.genMsg.textContent = msg || "";
}

function persist() {
  saveToStorage(state.project);
}

function clipArray() {
  return Object.values(state.project.clips || {});
}

function getSelectedInstance() {
  const id = state.project.ui.selectedInstanceId;
  if (!id) return null;
  return state.project.instances.find(x => x.id === id) || null;
}

function getClip(id) {
  return state.project.clips?.[id] || null;
}

function pxPerSec() {
  return Number(state.project.ui.zoomPxPerSec) || 120;
}

function secToPx(sec) {
  return (Number(sec) || 0) * pxPerSec();
}

function pxToSec(px) {
  return (Number(px) || 0) / pxPerSec();
}

/* ---------------------------
   Rendering
--------------------------- */

function renderKPIs() {
  ui.kTracks.textContent = String(state.project.tracks.length);
  ui.kClips.textContent = String(Object.keys(state.project.clips || {}).length);
  ui.kInst.textContent = String(state.project.instances.length);
}

function renderClipLibrary() {
  const clips = clipArray().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  ui.clipList.innerHTML = "";

  if (!clips.length) {
    ui.clipList.innerHTML = `<div class="muted" style="padding:10px;">还没有 Clip。点击 “Upload WAV” 生成一个。</div>`;
    return;
  }

  for (const c of clips) {
    const span = c.stats?.span_s ?? 0;
    const notes = c.stats?.notes ?? 0;

    const el = document.createElement("div");
    el.className = "clipItem";
    el.innerHTML = `
      <div class="clipTitle">${escapeHtml(c.name)}</div>
      <div class="clipMeta">
        <span>${span.toFixed(2)}s</span>
        <span>${notes} notes</span>
      </div>
      <div class="row" style="margin-top:10px;">
        <button class="miniBtn" data-action="clip-preview" data-clip="${escapeHtml(c.id)}">▶ Preview</button>
        <button class="miniBtn primary" data-action="clip-add" data-clip="${escapeHtml(c.id)}">+ Add to Timeline</button>
        <button class="miniBtn" data-action="clip-edit" data-clip="${escapeHtml(c.id)}">✏ Edit</button>
      </div>
      <div class="muted" style="font-size:12px; margin-top:8px; font-family:var(--mono);">
        ${c.source?.task_id ? `task_id=${escapeHtml(c.source.task_id)}` : "local"}
      </div>
    `;
    ui.clipList.appendChild(el);
  }
}

function renderTimeline() {
  ui.lanes.innerHTML = "";

  const tracks = state.project.tracks;
  for (const tr of tracks) {
    const lane = document.createElement("div");
    lane.className = "lane";
    lane.dataset.track = tr.id;
    ui.lanes.appendChild(lane);
  }

  for (const inst of state.project.instances) {
    const lane = ui.lanes.querySelector(`.lane[data-track="${cssEsc(inst.trackId)}"]`);
    if (!lane) continue;

    const clip = getClip(inst.clipId);
    const name = clip?.name || inst.clipId;

    const w = Math.max(80, secToPx((clip?.stats?.span_s ?? 2.0)));
    const left = secToPx(inst.start);

    const el = document.createElement("div");
    el.className = "clipInst";
    el.dataset.inst = inst.id;
    el.style.left = `${left}px`;
    el.style.width = `${w}px`;
    el.textContent = name;

    if (state.project.ui.selectedInstanceId === inst.id) el.classList.add("selected");

    lane.appendChild(el);
  }
}

function renderInspector() {
  const inst = getSelectedInstance();
  if (!inst) {
    ui.selEmpty.style.display = "block";
    ui.selBox.style.display = "none";
    return;
  }
  const clip = getClip(inst.clipId);

  ui.selEmpty.style.display = "none";
  ui.selBox.style.display = "block";
  ui.selId.textContent = inst.id;
  ui.selClip.textContent = clip?.name || inst.clipId;
  ui.selStart.value = String(inst.start ?? 0);
  ui.selTrans.value = String(inst.transpose ?? 0);
}

function renderAll() {
  renderKPIs();
  renderClipLibrary();
  renderTimeline();
  renderInspector();
  ui.zoomRange.value = String(pxPerSec());
  ui.zoomLabel.textContent = `${pxPerSec()} px/s`;
  ui.bpmInput.value = String(state.project.bpm || 120);
}

/* ---------------------------
   Backend: Generate → Poll → Score
--------------------------- */

async function apiGenerateFromWav(file) {
  const fd = new FormData();
  fd.append("file", file, file.name);

  // Backend expects: POST /generate?output_format=mp3
  const resp = await fetch(`/generate?output_format=mp3`, { method: "POST", body: fd });
  if (!resp.ok) throw new Error(`POST /generate failed: ${resp.status}`);
  const data = await resp.json();
  if (!data.task_id) throw new Error("Missing task_id from /generate");
  return data.task_id;
}

async function apiGetTask(taskId) {
  const resp = await fetch(`/tasks/${taskId}`);
  if (!resp.ok) throw new Error(`GET /tasks/${taskId} failed: ${resp.status}`);
  return await resp.json();
}

async function apiGetScore(taskId) {
  const resp = await fetch(`/tasks/${taskId}/score`);
  if (!resp.ok) throw new Error(`GET /tasks/${taskId}/score failed: ${resp.status}`);
  return await resp.json();
}

async function pollUntilDone(taskId, { intervalMs = 800, maxMs = 180000 } = {}) {
  const start = Date.now();
  while (true) {
    const t = await apiGetTask(taskId);
    if (t.status === "completed") return t;
    if (t.status === "failed") throw new Error(`Task failed: ${t.error?.message || "unknown"}`);
    if (Date.now() - start > maxMs) throw new Error("Task timeout");
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

async function generateAndImportClip(file) {
  setGenState("warn", `Uploading: ${file.name}`);
  log(`Upload WAV: ${file.name}`);

  const taskId = await apiGenerateFromWav(file);
  state.lastTaskId = taskId;
  setGenState("warn", `Generating... task_id=${taskId}`);
  toast("Generate queued", taskId);
  log(`Generate queued: ${taskId}`);

  const t = await pollUntilDone(taskId);
  setGenState("good", `Completed: ${taskId}`);
  toast("Task completed", taskId);
  log(`Task completed: ${taskId}`);

  // Now fetch score and create clip
  const score = await apiGetScore(taskId);
  const clipId = taskId; // simplest stable id
  const clipName = `Clip ${clipId.slice(0, 6)}`;

  const clip = clipFromScore({ clipId, name: clipName, score, taskId });
  state.project.clips[clipId] = clip;

  // Optional: auto add first instance at 0 if timeline empty
  if (state.project.instances.length === 0) {
    addInstance(state.project, { clipId, trackId: "t1", start: 0, transpose: 0 });
  }

  persist();
  renderAll();

  toast("Clip imported", `${clipName} 已入库`);
  log(`Clip imported: ${clipId} notes=${clip.stats.notes} span=${clip.stats.span_s.toFixed(2)}s`);
}

/* ---------------------------
   Playback (MVP)
   - For now: play selected instance's server MP3 if available
--------------------------- */

function stopPlayback() {
  try {
    state.audio.pause();
    state.audio.currentTime = 0;
  } catch {}
  toast("Stop", "preview stopped");
}

function playSelectionPreview() {
  const inst = getSelectedInstance() || state.project.instances[0] || null;
  if (!inst) {
    toast("No instance", "Add a clip to timeline first");
    return;
  }
  const clip = getClip(inst.clipId);
  if (!clip?.audio_url) {
    toast("No audio preview", "This clip has no server audio_url");
    return;
  }
  // NOTE: start offset preview is MVP; we ignore inst.start for now
  state.audio.src = clip.audio_url;
  state.audio.play().then(() => {
    toast("Play", clip.name);
  }).catch((e) => {
    toast("Play blocked", "Browser blocked autoplay. Click again.");
    log(`Audio play error: ${e?.message || e}`);
  });
}

/* ---------------------------
   Editor Modal (MVP: read-only piano-roll preview)
--------------------------- */

function openEditorForClip(clipId) {
  const clip = getClip(clipId);
  if (!clip) return;
  ui.editorTitle.textContent = `Editing: ${clip.name} (MVP: read-only)`;
  ui.editorModal.classList.add("active");
  drawScoreToCanvas(clip.score, ui.editorCanvas);
}

function closeEditor() {
  ui.editorModal.classList.remove("active");
}

function drawScoreToCanvas(score, canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(300, Math.floor(rect.width));
  const h = Math.max(200, Math.floor(rect.height));
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, w, h);

  // background
  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.fillRect(0, 0, w, h);

  const notes = [];
  for (const tr of (score?.tracks || [])) {
    for (const n of (tr.notes || [])) notes.push(n);
  }
  if (!notes.length) {
    ctx.fillStyle = "rgba(255,255,255,.65)";
    ctx.font = "14px system-ui";
    ctx.fillText("No notes in this score.", 18, 28);
    return;
  }

  // auto pitch fit
  let pMin = notes[0].pitch, pMax = notes[0].pitch;
  let tEnd = 0;
  for (const n of notes) {
    pMin = Math.min(pMin, n.pitch);
    pMax = Math.max(pMax, n.pitch);
    tEnd = Math.max(tEnd, (n.start || 0) + (n.duration || 0));
  }
  const pad = 2;
  pMin -= pad; pMax += pad;
  const pitchSpan = Math.max(1, pMax - pMin + 1);

  const leftPad = 60;
  const topPad = 20;
  const rightPad = 20;
  const bottomPad = 20;

  const gridW = w - leftPad - rightPad;
  const gridH = h - topPad - bottomPad;

  // grid
  ctx.strokeStyle = "rgba(255,255,255,.06)";
  ctx.lineWidth = 1;
  const rowH = gridH / pitchSpan;
  const colW = 80; // time grid step
  for (let i = 0; i <= pitchSpan; i++) {
    const y = topPad + i * rowH;
    ctx.beginPath(); ctx.moveTo(leftPad, y); ctx.lineTo(w - rightPad, y); ctx.stroke();
  }
  for (let x = leftPad; x <= w - rightPad; x += colW) {
    ctx.beginPath(); ctx.moveTo(x, topPad); ctx.lineTo(x, h - bottomPad); ctx.stroke();
  }

  // label
  ctx.fillStyle = "rgba(255,255,255,.65)";
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
  ctx.fillText(`Pitch ${pMin}..${pMax} | span ${tEnd.toFixed(2)}s | notes ${notes.length}`, 16, 16);

  // notes
  const scaleX = gridW / Math.max(0.01, tEnd);
  for (const n of notes) {
    const x = leftPad + (n.start || 0) * scaleX;
    const y = topPad + (pMax - n.pitch) * rowH + 1;
    const ww = Math.max(3, (n.duration || 0.05) * scaleX);
    const hh = Math.max(3, rowH - 2);

    ctx.fillStyle = "rgba(47,125,255,.75)";
    ctx.fillRect(x, y, ww, hh);
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.strokeRect(x, y, ww, hh);
  }
}

/* ---------------------------
   Timeline interaction (drag instances horizontally)
--------------------------- */

function selectInstance(instId) {
  state.project.ui.selectedInstanceId = instId;
  persist();
  renderTimeline();
  renderInspector();
}

function removeSelectedInstance() {
  const inst = getSelectedInstance();
  if (!inst) return;
  state.project.instances = state.project.instances.filter(x => x.id !== inst.id);
  state.project.ui.selectedInstanceId = null;
  persist();
  renderAll();
  toast("Removed", "Instance deleted");
}

function updateSelectedFields() {
  const inst = getSelectedInstance();
  if (!inst) return;
  inst.start = Number(ui.selStart.value) || 0;
  inst.transpose = Number(ui.selTrans.value) || 0;
  persist();
  renderTimeline();
  renderInspector();
}

function bindTimelineDrag() {
  ui.timelineCanvas.addEventListener("mousedown", (e) => {
    const target = e.target.closest(".clipInst");
    if (!target) return;

    const instId = target.dataset.inst;
    selectInstance(instId);

    state.dragging = {
      instId,
      startX: e.clientX,
      origLeftPx: parseFloat(target.style.left || "0"),
    };
    target.style.cursor = "grabbing";
  });

  window.addEventListener("mousemove", (e) => {
    if (!state.dragging) return;
    const instId = state.dragging.instId;
    const el = document.querySelector(`.clipInst[data-inst="${cssEsc(instId)}"]`);
    if (!el) return;

    const dx = e.clientX - state.dragging.startX;
    const newLeft = Math.max(0, state.dragging.origLeftPx + dx);
    el.style.left = `${newLeft}px`;
    ui.playheadLabel.textContent = `${pxToSec(newLeft).toFixed(2)}s`;
  });

  window.addEventListener("mouseup", () => {
    if (!state.dragging) return;
    const instId = state.dragging.instId;
    const inst = state.project.instances.find(x => x.id === instId);
    const el = document.querySelector(`.clipInst[data-inst="${cssEsc(instId)}"]`);
    if (inst && el) {
      const left = parseFloat(el.style.left || "0");
      inst.start = pxToSec(left);
      persist();
      renderInspector();
    }
    state.dragging = null;
    renderTimeline();
  });

  // double click -> editor
  ui.timelineCanvas.addEventListener("dblclick", (e) => {
    const target = e.target.closest(".clipInst");
    if (!target) return;
    const instId = target.dataset.inst;
    const inst = state.project.instances.find(x => x.id === instId);
    if (!inst) return;
    openEditorForClip(inst.clipId);
  });
}

/* ---------------------------
   Actions / Events
--------------------------- */

function onAction(action, el) {
  switch (action) {
    case "upload-wav":
      ui.wavInput.click();
      return;

    case "clear-project":
      if (!confirm("Clear project? 这会清空本地 Clips/Timeline（仅浏览器 localStorage）。")) return;
      localStorage.removeItem(STORAGE_KEY);
      state.project = normalizeProject(emptyProject());
      persist();
      renderAll();
      toast("Cleared", "Project reset");
      return;

    case "project-play":
      playSelectionPreview();
      return;

    case "project-stop":
      stopPlayback();
      return;

    case "clear-log":
      ui.logArea.textContent = "";
      return;

    case "clip-preview": {
      const clipId = el.dataset.clip;
      const clip = getClip(clipId);
      if (!clip?.audio_url) {
        toast("No audio preview", "This clip has no server audio_url");
        return;
      }
      state.audio.src = clip.audio_url;
      state.audio.play().catch(() => toast("Play blocked", "Click again"));
      log(`Preview clip: ${clip.name}`);
      return;
    }

    case "clip-add": {
      const clipId = el.dataset.clip;
      addInstance(state.project, { clipId, trackId: "t1", start: 0, transpose: 0 });
      persist();
      renderAll();
      toast("Added", "Instance created on timeline");
      return;
    }

    case "clip-edit": {
      const clipId = el.dataset.clip;
      openEditorForClip(clipId);
      return;
    }

    case "edit-selected": {
      const inst = getSelectedInstance();
      if (!inst) return;
      openEditorForClip(inst.clipId);
      return;
    }

    case "remove-selected":
      removeSelectedInstance();
      return;

    case "close-editor":
      closeEditor();
      return;

    case "export-project": {
      const blob = new Blob([serialize(state.project)], { type: "application/json;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `hum2song_project_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast("Exported", "Project JSON downloaded");
      return;
    }

    case "import-project":
      ui.importProjectInput.click();
      return;

    case "new-track":
      toast("MVP", "多轨后续做；当前默认 1 track");
      return;

    case "use-last":
      toast("MVP", "录音流程后续接入");
      return;

    default:
      toast("Unknown action", action);
  }
}

function bindActions() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    onAction(btn.dataset.action, btn);
  });

  ui.wavInput.addEventListener("change", async () => {
    const file = ui.wavInput.files?.[0];
    ui.wavInput.value = "";
    if (!file) return;

    try {
      await generateAndImportClip(file);
    } catch (err) {
      const m = err?.message || String(err);
      setGenState("bad", m);
      toast("Generate failed", m);
      log(`ERROR: ${m}`);
    }
  });

  ui.zoomRange.addEventListener("input", () => {
    const v = Number(ui.zoomRange.value) || 120;
    state.project.ui.zoomPxPerSec = v;
    ui.zoomLabel.textContent = `${v} px/s`;
    persist();
    renderTimeline();
  });

  ui.bpmInput.addEventListener("change", () => {
    state.project.bpm = Number(ui.bpmInput.value) || 120;
    persist();
    renderKPIs();
    toast("BPM updated", String(state.project.bpm));
  });

  ui.selStart.addEventListener("change", updateSelectedFields);
  ui.selTrans.addEventListener("change", updateSelectedFields);

  ui.importProjectInput.addEventListener("change", async () => {
    const file = ui.importProjectInput.files?.[0];
    ui.importProjectInput.value = "";
    if (!file) return;

    try {
      const txt = await file.text();
      const obj = JSON.parse(txt);
      state.project = normalizeProject(obj);
      persist();
      renderAll();
      toast("Imported", "Project JSON loaded");
      log("Project imported from JSON");
    } catch (e) {
      toast("Import failed", e?.message || String(e));
      log(`ERROR: import failed: ${e?.message || e}`);
    }
  });

  // keyboard
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      playSelectionPreview();
    }
    if (e.code === "Delete") {
      removeSelectedInstance();
    }
    if (e.key === "Escape") {
      closeEditor();
    }
  });

  // close modal on background click
  ui.editorModal.addEventListener("click", (e) => {
    if (e.target === ui.editorModal) closeEditor();
  });

  // resize canvas redraw when modal open
  window.addEventListener("resize", () => {
    if (!ui.editorModal.classList.contains("active")) return;
    const inst = getSelectedInstance();
    if (inst) {
      const clip = getClip(inst.clipId);
      if (clip) drawScoreToCanvas(clip.score, ui.editorCanvas);
    }
  });
}

/* ---------------------------
   Helpers
--------------------------- */

function cssEsc(s) {
  // Minimal CSS.escape fallback
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c);
}

/* ---------------------------
   Boot
--------------------------- */

function boot() {
  log("UI boot: Hum2Song Studio MVP");
  setGenState("idle", "等待上传");

  // render + bind
  renderAll();
  bindActions();
  bindTimelineDrag();

  // If there is at least one instance, select it by default
  if (!state.project.ui.selectedInstanceId && state.project.instances.length) {
    state.project.ui.selectedInstanceId = state.project.instances[0].id;
    persist();
  }
  renderAll();

  // expose for debug (optional)
  window.app = {
    state,
    log,
    generateAndImportClip,
  };
}

boot();
