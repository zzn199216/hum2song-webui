# PR-5 Console Acceptance (Revchain + Optimize Preset)

Use this in the **browser console** (after the app is loaded and you have at least one clip) to verify PR-5a–5f behavior. This doc **does not change runtime/production behavior**.

**Prerequisites:** Open the app, create or load a project with at least one clip. Ensure `H2SApp` (or `APP` / `app`) is available.

---

## 0) Common helpers (paste once per tab)

> 建议先把这一段粘贴执行一次，后面各段脚本会复用这些 helper。

```js
function _getAPP(){
  return globalThis.H2SApp || globalThis.APP || globalThis.app;
}

function _getP2(APP){
  return APP && APP.getProjectV2 && APP.getProjectV2();
}

function _pickCid(p2){
  // Prefer clipOrder[0], fallback to any clip id
  return (p2?.clipOrder?.[0]) || (p2?.clips ? Object.keys(p2.clips)[0] : null);
}

function _safeReadOptMap(){
  try {
    const raw = globalThis.localStorage?.getItem?.("hum2song_studio_opt_options_by_clip");
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn("localStorage read failed:", e);
    return null;
  }
}

function _isNonEmptyString(x){
  return typeof x === "string" && x.trim().length > 0;
}
```

---

## 1) Revchain consistency (all clips)

**Expected:** For every clip:
- `clip.revisions` is a **non-array object map**
- `revisions[revisionId]` exists
- if `parentRevisionId` is set (non-empty), then `revisions[parentRevisionId]` exists

```js
(function(){
  const APP = _getAPP();
  const p2 = _getP2(APP);
  if (!p2 || !p2.clips) return console.log("No project/clips");

  const bad = [];
  for (const cid of Object.keys(p2.clips)) {
    const c = p2.clips[cid];
    const isObj = !!c.revisions && !Array.isArray(c.revisions) && typeof c.revisions === "object";
    const hasHead = _isNonEmptyString(c.revisionId) && !!(c.revisions && c.revisions[c.revisionId]);
    const hasParent = !_isNonEmptyString(c.parentRevisionId) || !!(c.revisions && c.revisions[c.parentRevisionId]);

    if (!isObj || !hasHead || !hasParent) {
      bad.push({
        cid,
        revisionsType: Array.isArray(c.revisions) ? "array" : typeof c.revisions,
        rev: c.revisionId,
        parent: c.parentRevisionId,
        isObj, hasHead, hasParent,
        keys0: c.revisions ? Object.keys(c.revisions).slice(0, 8) : null,
      });
    }
  }

  console.log("revchain badCount =", bad.length);
  if (bad.length) console.table(bad.slice(0, 30));
  console.log(bad.length === 0 ? "PASS revchain consistency" : "FAIL revchain");
})();
```

---

## 2) Noop preset persist across hard refresh (localStorage)

- **Storage key:** `hum2song_studio_opt_options_by_clip`
- **Flow:** set noop for one clip → confirm localStorage 写入 → Ctrl+F5 → confirm preset 仍然能读出来

### 2.1 Before refresh (set noop + confirm localStorage)

```js
(function(){
  const APP = _getAPP();
  const p2 = _getP2(APP);
  const cid = _pickCid(p2);
  if (!cid) return console.log("No clip");

  APP.setOptimizeOptions({ requestedPresetId: "noop" }, cid);

  console.log("Using cid =", cid);
  console.log("Stored preset =", APP.getOptimizePresetForClip?.(cid));

  const map = _safeReadOptMap();
  console.log("ls map readable?", map !== null);
  console.log("ls[cid] =", map && map[cid]);
})();
```

### 2.2 After refresh (verify stored preset still used)

> Ctrl+F5 强刷后，重新打开 console，**先粘贴 helper（第0段）**，再跑这一段。

```js
(function(){
  const APP = _getAPP();
  const p2 = _getP2(APP);
  const cid = _pickCid(p2);
  if (!cid) return console.log("No clip");

  console.log("Using cid =", cid);
  console.log("presetAfterReload =", APP.getOptimizePresetForClip?.(cid));

  const map = _safeReadOptMap();
  console.log("ls[cid] =", map && map[cid]);
})();
```

---

## 3) optimize(no override) uses stored preset after reload

**Expected (when stored preset is noop):**
- `await APP.optimizeClip(cid)` returns `ops === 0`
- rev/parent/revCount unchanged

⚠️ 注意：`APP.optimizeClip` 可能会替换 project 对象，所以必须 optimize 前后各取一次 `getProjectV2()`，避免读旧引用误判。

```js
(async function(){
  const APP = _getAPP();
  const p2a = _getP2(APP);
  const cid = _pickCid(p2a);
  if (!cid) return console.log("No clip");

  const c0 = p2a.clips[cid];
  const rev0 = c0.revisionId;
  const parent0 = c0.parentRevisionId;
  const n0 = Object.keys(c0.revisions || {}).length;

  const stored = APP.getOptimizePresetForClip?.(cid);
  console.log("Using cid =", cid, "storedPreset =", stored);

  const res = await APP.optimizeClip(cid); // no override

  const p2b = _getP2(APP);
  const c1 = p2b.clips[cid];
  const rev1 = c1.revisionId;
  const parent1 = c1.parentRevisionId;
  const n1 = Object.keys(c1.revisions || {}).length;

  console.log("optimizeClip(cid) res =", res);
  console.log("rev0->rev1", rev0, "=>", rev1);
  console.log("parent0->parent1", parent0, "=>", parent1);
  console.log("revCount0->1", n0, "=>", n1);

  if (res?.ok && res.ops === 0) {
    const same = (rev1 === rev0) && (parent1 === parent0) && (n1 === n0);
    console.log(same ? "PASS noop: unchanged rev/parent/revCount" : "FAIL noop: state changed unexpectedly");
  } else {
    console.warn("NOTE ops!=0 (stored preset may not be noop)", { storedPreset: stored, ops: res?.ops });
  }
})();
```

---

## 4) One-shot override does NOT overwrite stored preset

**Expected:**
- stored preset before/after is unchanged (e.g. still `noop`)
- the call uses override options but does not persist them

```js
(async function(){
  const APP = _getAPP();
  const p2 = _getP2(APP);
  const cid = _pickCid(p2);
  if (!cid) return console.log("No clip");

  // Ensure a known stored preset first
  APP.setOptimizeOptions({ requestedPresetId: "noop" }, cid);
  const storedBefore = APP.getOptimizePresetForClip?.(cid);

  const res = await APP.optimizeClip(cid, { requestedPresetId: "dynamics_accent" }); // one-shot override
  const storedAfter = APP.getOptimizePresetForClip?.(cid);

  console.log("Using cid =", cid);
  console.log("override res =", res);
  console.log("Stored before:", storedBefore, "after:", storedAfter);

  console.log(storedAfter === storedBefore
    ? "PASS one-shot override did not overwrite stored preset"
    : "FAIL stored preset changed unexpectedly");
})();
```

---

## Quick full check (one paste)

> 这一段会：
> 1) 全量 revchain 检查  
> 2) set noop 并确认 localStorage 写入  
> 3) optimize(no override) 验证 noop 不改 rev/parent/revCount  
> 4) one-shot override 不污染 stored preset

```js
(async function(){
  const APP = _getAPP();
  const p2 = _getP2(APP);
  if (!p2 || !p2.clips) return console.log("No project/clips");

  // 1) Revchain all clips
  const bad = [];
  for (const cid2 of Object.keys(p2.clips)) {
    const c = p2.clips[cid2];
    const isObj = !!c.revisions && !Array.isArray(c.revisions) && typeof c.revisions === "object";
    const hasHead = _isNonEmptyString(c.revisionId) && !!(c.revisions && c.revisions[c.revisionId]);
    const hasParent = !_isNonEmptyString(c.parentRevisionId) || !!(c.revisions && c.revisions[c.parentRevisionId]);
    if (!isObj || !hasHead || !hasParent) bad.push({ cid: cid2, isObj, hasHead, hasParent, rev: c.revisionId, parent: c.parentRevisionId });
  }
  console.log(bad.length === 0 ? "1. PASS revchain" : "1. FAIL revchain");
  if (bad.length) console.table(bad.slice(0, 20));

  // Pick a clip
  const cid = _pickCid(p2);
  if (!cid) return console.log("No clip for optimize checks");

  // 2) Persist noop
  APP.setOptimizeOptions({ requestedPresetId: "noop" }, cid);
  const stored = APP.getOptimizePresetForClip?.(cid);
  const map = _safeReadOptMap();
  console.log("2. Stored preset =", stored, "ls[cid] =", map && map[cid]);

  // 3) optimize(no override) should use stored preset
  const p2a = _getP2(APP);
  const c0 = p2a.clips[cid];
  const rev0 = c0.revisionId;
  const parent0 = c0.parentRevisionId;
  const n0 = Object.keys(c0.revisions || {}).length;

  const resNoOverride = await APP.optimizeClip(cid);

  const p2b = _getP2(APP);
  const c1 = p2b.clips[cid];
  const rev1 = c1.revisionId;
  const parent1 = c1.parentRevisionId;
  const n1 = Object.keys(c1.revisions || {}).length;

  console.log("3. optimize(no override) res =", resNoOverride);
  if (resNoOverride?.ok && resNoOverride.ops === 0) {
    console.log((rev1 === rev0 && parent1 === parent0 && n1 === n0)
      ? "3. PASS noop unchanged"
      : "3. FAIL noop changed state");
  } else {
    console.warn("3. NOTE ops!=0 (maybe stored preset not noop?)", { storedPreset: APP.getOptimizePresetForClip?.(cid), ops: resNoOverride?.ops });
  }

  // 4) one-shot override doesn't overwrite stored
  const storedBefore = APP.getOptimizePresetForClip?.(cid);
  const resOverride = await APP.optimizeClip(cid, { requestedPresetId: "dynamics_accent" });
  const storedAfter = APP.getOptimizePresetForClip?.(cid);

  console.log("4. override res =", resOverride);
  console.log("4. storedBefore=", storedBefore, "storedAfter=", storedAfter, storedAfter === storedBefore ? "PASS" : "FAIL");
})();
```

---

## Note: Tone.js / AudioContext warnings during refresh

During a hard refresh you may see warnings like:

- `The AudioContext was not allowed to start...`

This is Chrome autoplay policy (needs a user gesture) and is **not related** to PR-5 revchain / preset persistence checks. Safe to ignore for acceptance.