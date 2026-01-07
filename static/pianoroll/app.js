/*
  Hum2Song Piano-roll MVP UI
  Fix重点：
  1) Generate 完成后自动加载 /tasks/{id}/score → 解决 “No score loaded / 钢琴卷帘空白 / Play没反应”
  2) Generate 成功后自动把 URL 切到 ?task_id=新id（避免旧id 404 反复出现）
  3) 页面初始化时：优先 query task_id，其次 localStorage 的 last_task_id（如果服务没重启还能自动恢复）
  4) 如果 /tasks/{id}/score 404（常见：服务重启），自动清掉 task_id，避免一直报错
*/

const $ = (id) => document.getElementById(id);

const state = {
  taskId: null,
  score: null,         // ScoreDoc
  playing: false,
  zoom: 1.0,
  pxPerSec: 120,
  sel: null,
  drag: null,
  _map: null,
};

// ---------- logging ----------
function log(line){
  const el = $("log");
  const ts = new Date().toISOString().slice(11,19);
  el.textContent += `[${ts}] ${line}\n`;
  el.scrollTop = el.scrollHeight;
}

// ---------- URL helpers ----------
function getQueryTaskId(){
  const u = new URL(location.href);
  return u.searchParams.get("task_id");
}
function setQueryTaskId(taskId){
  const u = new URL(location.href);
  if(taskId) u.searchParams.set("task_id", taskId);
  else u.searchParams.delete("task_id");
  history.replaceState({}, "", u);
}
function clearTaskIdEverywhere(){
  setTaskUI(null);
  setQueryTaskId(null);
  try{ localStorage.removeItem("hum2song_last_task_id"); }catch(_e){}
}

// ---------- UI binding ----------
function setTaskUI(taskId){
  state.taskId = taskId || null;
  $("taskIdLabel").textContent = taskId || "-";

  if(taskId){
    const link = `/ui?task_id=${encodeURIComponent(taskId)}`;
    const a = $("shareLink");
    a.href = link;
    a.textContent = link;
    a.style.display = "";
  }else{
    $("shareLink").style.display = "none";
  }

  const enabled = !!taskId;
  $("btnSave").disabled = !enabled;
  $("btnExport").disabled = !enabled;
  $("btnDownloadServerScore").disabled = !enabled;
}

function midiToName(m){
  const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const o = Math.floor(m/12)-1;
  return `${names[m%12]}${o}`;
}

function scoreStats(){
  if(!state.score){ return {notes:0, bpm:"-", pitch:"-", span:"-"}; }
  const bpm = state.score.tempo_bpm?.toFixed?.(2) ?? state.score.tempo_bpm ?? "-";
  let n=0, lo=999, hi=-1, maxT=0;
  for(const tr of state.score.tracks||[]){
    for(const ne of tr.notes||[]){
      n++;
      lo = Math.min(lo, ne.pitch);
      hi = Math.max(hi, ne.pitch);
      maxT = Math.max(maxT, ne.start + ne.duration);
    }
  }
  const pitch = (hi>=0) ? `${midiToName(lo)} - ${midiToName(hi)}` : "-";
  return {notes:n, bpm, pitch, span:maxT.toFixed(3)};
}

function updateStatsUI(){
  const s = scoreStats();
  $("kNotes").textContent = String(s.notes);
  $("kBpm").textContent = String(s.bpm);
  $("kPitch").textContent = String(s.pitch);
  $("kSpan").textContent = String(s.span);
  $("kSel").textContent = state.sel ? `${state.sel.tidx}:${state.sel.nidx}` : "-";
}

function normalizeScore(score){
  // safe normalize: sort + round + ensure Track.name is str
  if(!score || !score.tracks) return score;
  for(const tr of score.tracks){
    tr.name = String(tr.name ?? "Track");
    if(!Array.isArray(tr.notes)) tr.notes = [];
    tr.notes.sort((a,b)=> (a.start-b.start) || (a.pitch-b.pitch));
    for(const n of tr.notes){
      n.start = +(+n.start).toFixed(6);
      n.duration = +(+n.duration).toFixed(6);
      n.velocity = Math.max(1, Math.min(127, parseInt(n.velocity ?? 64, 10)));
      n.pitch = Math.max(0, Math.min(127, parseInt(n.pitch ?? 60, 10)));
      if(n.duration<=0) n.duration = 0.01;
      if(n.start<0) n.start = 0;
    }
  }
  return score;
}

function enableLocalDownload(){
  $("btnDownloadLocalScore").disabled = !state.score;
}

// ---------- server I/O ----------
async function fetchScore(taskId){
  const r = await fetch(`/tasks/${encodeURIComponent(taskId)}/score`);
  if(!r.ok){
    const t = await r.text();
    throw new Error(`GET /tasks/${taskId}/score failed: ${r.status} ${t}`);
  }
  return await r.json();
}

// fallback: 如果 /score 不可用，尝试下载 score.json 再 parse
async function fetchScoreViaDownload(taskId){
  const r = await fetch(`/tasks/${encodeURIComponent(taskId)}/score/download?file_type=json`);
  if(!r.ok){
    const t = await r.text();
    throw new Error(`GET /tasks/${taskId}/score/download?file_type=json failed: ${r.status} ${t}`);
  }
  const txt = await r.text();
  return JSON.parse(txt);
}

async function putScore(taskId, score){
  const r = await fetch(`/tasks/${encodeURIComponent(taskId)}/score`, {
    method:"PUT",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(score),
  });
  if(!r.ok){
    const t = await r.text();
    throw new Error(`PUT /tasks/${taskId}/score failed: ${r.status} ${t}`);
  }
  return await r.json();
}

async function postRender(taskId, fmt="mp3"){
  const r = await fetch(`/tasks/${encodeURIComponent(taskId)}/render?output_format=${encodeURIComponent(fmt)}`, {
    method:"POST",
  });
  if(!r.ok){
    const t = await r.text();
    throw new Error(`POST /tasks/${taskId}/render failed: ${r.status} ${t}`);
  }
  return await r.json();
}

async function tryLoadScoreFromServer(taskId, {retries=10, delayMs=250} = {}){
  // 先试 /score；不行再试 download-json；都不行就报错
  let lastErr = null;
  for(let i=0;i<retries;i++){
    try{
      const obj = await fetchScore(taskId);
      return obj;
    }catch(e){
      lastErr = e;
      // 如果是 404（常见：task不存在/服务重启），直接终止重试
      if(String(e.message).includes(" 404 ")) break;
      await new Promise(res=>setTimeout(res, delayMs));
    }
  }

  // fallback
  try{
    const obj2 = await fetchScoreViaDownload(taskId);
    return obj2;
  }catch(e2){
    lastErr = e2;
  }

  throw lastErr || new Error("Unknown error loading server score");
}

// ---------- canvas render ----------
function getPitchRange(){
  let lo=999, hi=-1;
  if(!state.score) return {lo:60, hi:72};
  for(const tr of state.score.tracks||[]){
    for(const ne of tr.notes||[]){
      lo = Math.min(lo, ne.pitch);
      hi = Math.max(hi, ne.pitch);
    }
  }
  if(hi<0) return {lo:60, hi:72};
  lo = Math.max(0, lo-2);
  hi = Math.min(127, hi+2);
  return {lo, hi};
}

function draw(){
  const c = $("roll");
  const ctx = c.getContext("2d");

  const {lo, hi} = getPitchRange();
  const pitchSpan = (hi-lo+1);

  const zoom = state.zoom;
  const pxPerSec = state.pxPerSec * zoom;

  let maxT = 10;
  if(state.score){
    for(const tr of state.score.tracks||[]){
      for(const ne of tr.notes||[]){
        maxT = Math.max(maxT, ne.start + ne.duration);
      }
    }
  }
  const width = Math.max(1200, Math.ceil(maxT * pxPerSec) + 120);
  const height = c.height;
  c.width = width;

  const laneH = height / pitchSpan;
  const x0 = 60;
  const y0 = 10;

  const pitchToY = (p)=> y0 + (hi - p) * laneH;
  const timeToX = (t)=> x0 + t * pxPerSec;

  ctx.clearRect(0,0,c.width,c.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0,0,c.width,c.height);

  // grid
  ctx.lineWidth = 1;
  for(let i=0;i<=pitchSpan;i++){
    const y = y0 + i*laneH;
    ctx.strokeStyle = (i%12===0) ? "rgba(17,24,39,.10)" : "rgba(17,24,39,.05)";
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke();
  }

  const step = 0.25;
  const nLines = Math.ceil(maxT/step);
  for(let i=0;i<=nLines;i++){
    const t = i*step;
    const x = timeToX(t);
    ctx.strokeStyle = (i%4===0) ? "rgba(17,24,39,.10)" : "rgba(17,24,39,.05)";
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, c.height); ctx.stroke();
  }

  // pitch labels
  ctx.fillStyle = "rgba(107,114,128,1)";
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
  for(let p=hi; p>=lo; p--){
    const y = pitchToY(p) + laneH*0.72;
    if(laneH >= 12 && (p%12===0 || laneH>=18)){
      ctx.fillText(midiToName(p), 8, y);
    }
  }

  // notes
  if(state.score){
    for(const tr of state.score.tracks||[]){
      for(const ne of tr.notes||[]){
        const x = timeToX(ne.start);
        const y = pitchToY(ne.pitch) + 1;
        const w = Math.max(2, ne.duration * pxPerSec);
        const h = Math.max(3, laneH - 2);
        ctx.fillStyle = "rgba(37,99,235,.85)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = "rgba(29,78,216,.95)";
        ctx.strokeRect(x+0.5, y+0.5, Math.max(1,w-1), Math.max(1,h-1));
      }
    }
  }

  // selection highlight
  if(state.sel && state.score){
    const tr = state.score.tracks[state.sel.tidx];
    const ne = tr?.notes?.[state.sel.nidx];
    if(ne){
      const x = timeToX(ne.start);
      const y = pitchToY(ne.pitch) + 1;
      const w = Math.max(2, ne.duration * pxPerSec);
      const h = Math.max(3, laneH - 2);
      ctx.strokeStyle = "rgba(255,255,255,.95)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x+1, y+1, Math.max(1,w-2), Math.max(1,h-2));
      ctx.lineWidth = 1;
    }
  }

  state._map = {lo, hi, laneH, x0, y0, pxPerSec};
  updateStatsUI();
}

// ---------- hit test / edit ----------
function hitTest(mx, my){
  if(!state.score || !state._map) return null;
  const {hi, laneH, x0, y0, pxPerSec} = state._map;

  const t = (mx - x0) / pxPerSec;
  const pitch = hi - Math.floor((my - y0) / laneH);

  let best=null;
  state.score.tracks.forEach((tr,tidx)=>{
    (tr.notes||[]).forEach((ne,nidx)=>{
      if(ne.pitch !== pitch) return;
      if(t >= ne.start && t <= ne.start + ne.duration){
        best = {tidx, nidx};
      }
    });
  });
  return best;
}

function onMouseDown(e){
  if(!state.score) return;
  const rect = $("roll").getBoundingClientRect();
  const mx = e.clientX - rect.left + $("rollWrap").scrollLeft;
  const my = e.clientY - rect.top + $("rollWrap").scrollTop;

  const hit = hitTest(mx, my);
  if(!hit){
    state.sel = null;
    draw();
    return;
  }

  state.sel = hit;

  const tr = state.score.tracks[hit.tidx];
  const ne = tr.notes[hit.nidx];
  const {x0, y0, pxPerSec, laneH, hi} = state._map;
  const nx = x0 + ne.start*pxPerSec;
  const nw = ne.duration*pxPerSec;
  const ny = y0 + (hi - ne.pitch)*laneH;

  const nearRight = (mx >= nx + nw - 8 && mx <= nx + nw + 2);
  state.drag = {
    mode: nearRight ? "resize" : "move",
    startMx: mx,
    startMy: my,
    origStart: ne.start,
    origDur: ne.duration,
    origPitch: ne.pitch,
  };

  draw();
}

function onMouseMove(e){
  if(!state.drag || !state.sel || !state.score) return;
  const rect = $("roll").getBoundingClientRect();
  const mx = e.clientX - rect.left + $("rollWrap").scrollLeft;
  const my = e.clientY - rect.top + $("rollWrap").scrollTop;

  const tr = state.score.tracks[state.sel.tidx];
  const ne = tr.notes[state.sel.nidx];
  const {laneH, pxPerSec} = state._map;

  if(state.drag.mode === "move"){
    const dt = (mx - state.drag.startMx) / pxPerSec;
    const dp = Math.round((my - state.drag.startMy) / laneH);
    ne.start = Math.max(0, state.drag.origStart + dt);
    ne.pitch = Math.max(0, Math.min(127, state.drag.origPitch - dp));
  }else{
    const dt = (mx - state.drag.startMx) / pxPerSec;
    ne.duration = Math.max(0.01, state.drag.origDur + dt);
  }
  draw();
}

function onMouseUp(){
  if(!state.drag || !state.score) return;
  state.drag = null;
  normalizeScore(state.score);
  draw();
  enableLocalDownload();
}

function deleteSelected(){
  if(!state.sel || !state.score) return;
  const tr = state.score.tracks[state.sel.tidx];
  if(!tr) return;
  tr.notes.splice(state.sel.nidx, 1);
  state.sel = null;
  normalizeScore(state.score);
  draw();
  enableLocalDownload();
}

// ---------- Tone playback ----------
let synth = null;
function ensureSynth(){
  if(!synth){
    synth = new Tone.PolySynth(Tone.Synth).toDestination();
  }
}

async function play(){
  if(!state.score){
    log("No score loaded.");
    return;
  }
  try{ await Tone.start(); }catch(_e){}
  ensureSynth();

  const bpm = state.score.tempo_bpm || 120;
  Tone.Transport.bpm.value = bpm;

  Tone.Transport.cancel();
  for(const tr of state.score.tracks||[]){
    for(const ne of tr.notes||[]){
      const t = ne.start;
      const dur = ne.duration;
      const vel = (ne.velocity ?? 64) / 127;
      const freq = Tone.Frequency(ne.pitch, "midi");
      Tone.Transport.schedule((time)=>{
        synth.triggerAttackRelease(freq, dur, time, vel);
      }, t);
    }
  }
  Tone.Transport.start();
  state.playing = true;
  log(`Play (bpm=${bpm}).`);
}

function stop(){
  try{ Tone.Transport.stop(); Tone.Transport.cancel(); }catch(_e){}
  state.playing = false;
  log("Stop.");
}

// ---------- local file I/O ----------
function downloadBlob(filename, text){
  const blob = new Blob([text], {type:"application/json;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

async function loadScoreFromFile(file){
  const text = await file.text();
  const obj = JSON.parse(text);
  state.score = normalizeScore(obj);
  state.sel = null;
  draw();
  enableLocalDownload();
  log(`Loaded local score.json: ${file.name}`);
}

function openScorePicker(){
  $("scoreFile").value = "";
  $("scoreFile").click();
}

// ---------- wire UI events ----------
$("btnLoadScoreFile").addEventListener("click", openScorePicker);
$("scoreFile").addEventListener("change", (e)=>{
  const f = e.target.files?.[0];
  if(!f) return;
  loadScoreFromFile(f).catch(err=>log("Error: "+err.message));
});
$("btnDownloadLocalScore").addEventListener("click", ()=>{
  if(!state.score) return;
  downloadBlob("score.json", JSON.stringify(state.score, null, 2));
  log("Downloaded local score.json");
});

$("drop").addEventListener("click", openScorePicker);
$("drop").addEventListener("dragover", (e)=>{ e.preventDefault(); $("drop").classList.add("dragover"); });
$("drop").addEventListener("dragleave", ()=> $("drop").classList.remove("dragover"));
$("drop").addEventListener("drop", (e)=>{
  e.preventDefault();
  $("drop").classList.remove("dragover");
  const f = e.dataTransfer.files?.[0];
  if(!f) return;
  loadScoreFromFile(f).catch(err=>log("Error: "+err.message));
});

$("btnPlay").addEventListener("click", ()=> play().catch(err=>log("Error: "+err.message)));
$("btnStop").addEventListener("click", stop);

$("zoom").addEventListener("input", (e)=>{
  state.zoom = parseFloat(e.target.value || "1");
  $("zoomVal").textContent = `${state.zoom.toFixed(2)}x`;
  draw();
});

$("roll").addEventListener("mousedown", onMouseDown);
window.addEventListener("mousemove", onMouseMove);
window.addEventListener("mouseup", onMouseUp);

window.addEventListener("keydown", (e)=>{
  if(e.key === " "){
    e.preventDefault();
    if(state.playing) stop(); else play();
  }
  if(e.key === "Delete" || e.key === "Backspace"){
    deleteSelected();
  }
});

// ---------- server session flow ----------
$("btnGenerate").addEventListener("click", async ()=>{
  const f = $("wavFile").files?.[0];
  if(!f){
    log("Error: please choose a WAV file first.");
    return;
  }
  $("genStatus").textContent = "uploading...";
  const fd = new FormData();
  fd.append("file", f);

  try{
    const r = await fetch(`/generate?output_format=mp3`, { method:"POST", body: fd });
    const j = await r.json();
    if(!r.ok) throw new Error(JSON.stringify(j));

    const tid = j.task_id;
    setTaskUI(tid);

    // ✅ 关键：生成后把 URL 改成新 task_id，避免旧 id 404
    setQueryTaskId(tid);

    try{ localStorage.setItem("hum2song_last_task_id", tid); }catch(_e){}

    $("genStatus").textContent = `queued (${tid.slice(0,8)}...)`;
    log(`Generate queued: ${tid}`);

    // poll
    const pollUrl = j.poll_url;
    for(let i=0;i<120;i++){
      await new Promise(res=>setTimeout(res, 500));
      const rr = await fetch(pollUrl);
      const info = await rr.json();

      if(info.status === "completed"){
        $("genStatus").textContent = "completed";
        $("audioStatus").textContent = "audio ready";
        log(`Task completed: ${tid}`);

        // ✅ 关键：自动拉取 score 并加载到编辑器（修复空白/无法播放）
        log("Loading score from server...");
        try{
          const scoreObj = await tryLoadScoreFromServer(tid);
          state.score = normalizeScore(scoreObj);
          state.sel = null;
          draw();
          enableLocalDownload();
          log("Loaded server score. You can Play now.");
        }catch(e){
          log("Error: load server score failed: " + e.message);
          log("Tip: you can still click “Download Score (Server)” and load it locally.");
        }

        return;
      }

      if(info.status === "failed"){
        $("genStatus").textContent = "failed";
        throw new Error(info.error?.message || "failed");
      }
    }

    throw new Error("poll timeout");
  }catch(err){
    $("genStatus").textContent = "error";
    log("Error: "+err.message);
  }
});

$("btnDownloadServerScore").addEventListener("click", ()=>{
  if(!state.taskId) return;
  const url = `/tasks/${encodeURIComponent(state.taskId)}/score/download?file_type=json`;
  window.open(url, "_blank");
  log("Download server score.json");
});

$("btnSave").addEventListener("click", async ()=>{
  if(!state.taskId){
    log("Error: task_id empty");
    return;
  }
  if(!state.score){
    log("Error: no score loaded");
    return;
  }
  try{
    const cleaned = normalizeScore(state.score);
    const resp = await putScore(state.taskId, cleaned);
    log("Saved to server. " + JSON.stringify(resp));
  }catch(err){
    log("Error: "+err.message);
  }
});

$("btnExport").addEventListener("click", async ()=>{
  if(!state.taskId){
    log("Error: task_id empty");
    return;
  }
  $("audioStatus").textContent = "rendering...";
  try{
    const r = await postRender(state.taskId, "mp3");
    log("Render ok. " + JSON.stringify(r));
    $("audioStatus").textContent = "render ok";
    const tid = state.taskId;

    const a1 = `/tasks/${encodeURIComponent(tid)}/download?file_type=audio`;
    const a2 = `/tasks/${encodeURIComponent(tid)}/download?file_type=midi`;
    $("dlLinks").innerHTML = `
      <a href="${a1}" target="_blank">Download MP3</a>
      <a href="${a2}" target="_blank">Download MIDI</a>
      <a href="/tasks/${encodeURIComponent(tid)}/score/download?file_type=json" target="_blank">Download score.json</a>
    `;
  }catch(err){
    $("audioStatus").textContent = "render error";
    log("Error: "+err.message);
  }
});

// ---------- init ----------
(async function init(){
  $("zoomVal").textContent = `${state.zoom.toFixed(2)}x`;
  draw();

  // 优先 query task_id，其次 localStorage 的 last_task_id
  let tid = getQueryTaskId();
  if(!tid){
    try{ tid = localStorage.getItem("hum2song_last_task_id"); }catch(_e){}
  }

  if(tid){
    setTaskUI(tid);
    log(`Init: try load score from task_id: ${tid}`);
    try{
      const scoreObj = await tryLoadScoreFromServer(tid, {retries: 2, delayMs: 200});
      state.score = normalizeScore(scoreObj);
      draw();
      enableLocalDownload();
      log("Loaded score from server.");
    }catch(err){
      // 常见：服务重启 → 404
      log("Error: " + err.message);
      if(String(err.message).includes(" 404 ")){
        log("Tip: old task_id is invalid after server restart. Cleared task_id.");
        clearTaskIdEverywhere();
      }
    }
  }else{
    log("UI ready. Tip: open local score.json or click Generate.");
  }
})();
