# PR-UX1 Selection Consistency / Click Hitbox — Audit Report

## 1) Selection state variables (names + where stored)

| Context | Variable | Location | Type |
|---------|----------|----------|------|
| Clip Library | `selectedClipId` | `app.state.selectedClipId` | string \| null |
| Timeline instances | `selectedInstanceId` | `app.state.selectedInstanceId` | string \| null |
| Inspector | reads `selectedInstanceId` + `selectedClipId` | `selection_controller.js` | derived |

Storage: `app.js` state object (lines ~566-567).

---

## 2) Event handler entry points (functions + files)

### Timeline instance selection
- **File**: `static/pianoroll/timeline_controller.js`
- **Selection**: `instancePointerDown(e, instId, el)` (line ~643)
- **Bound to**: `hit` = `el.querySelector('.instBody') || el` (line 644)
- **Binding**: `hit.addEventListener('pointerdown', ...)` 
- **Other**: `el.addEventListener('click', (e)=>{ e.stopPropagation(); });` — stops click from bubbling to `tracks.onclick` (playhead)
- **Remove button**: `btnRemove` has `pointerdown` and `click` with `stopPropagation`

### Clip Library selection
- **File**: `static/pianoroll/controllers/library_controller.js`
- **Selection**: `_handleClick(e)` → when no `[data-act]` button, finds `.clip-card` and calls `opts.onSelectClip(clipId)`
- **Binding**: `rootEl.addEventListener('click', _handleClick, true)` (capture phase)
- **Guard**: `if (t.closest('details, summary, button, select, input, textarea, a')) return` — prevents selection when clicking those

---

## 3) Suspected root cause(s)

### Timeline — "right side not clickable"

**Cause**: Pointer events are attached only to `.instBody`, not the whole `.instance` block.

- `instBody` wraps title and subtitle only
- `.instRemove` (×) is `position: absolute; top: 6px; right: 6px`, so it overlays the top-right
- `instRemove` has `stopPropagation` on pointerdown/click, so clicks on it do not select
- The rest of the instance block (right of `instBody`, padding, etc.) may not be covered by `instBody` if `instBody` does not fill the full width/height
- `.instance` uses `display: flex` with `padding: 8px 10px`. `instBody` is a flex child and may not expand to full area
- The Remove button overlays top-right; any area to the right of or below `instBody` that doesn’t belong to it would have no pointer handler

**Conclusion**: The hit area is `instBody` only. `instBody` may not cover the entire instance block, especially the right side, so clicks there hit the `.instance` container and not `instBody`, and no selection/drag handler runs.

### Clip Library — "click card background selects"

- Selection handler runs when click target is not a `[data-act]` button and not inside `details, summary, button, ...`
- Clicking a button is handled by the `[data-act]` branch; selection is not updated
- Possible improvement: update selection when handling button actions so selection stays consistent

---

## 4) Minimal fix plan + exact files to edit

### Timeline
1. **File**: `static/pianoroll/timeline_controller.js`
2. **Change**: Attach `pointerdown` (and `dblclick`) to the **entire instance element** `el`, not just `instBody`.
3. **Logic**: `hit` should be `el` (the `.instance` div) so the full block is clickable.
4. **Button**: Keep `stopPropagation` on `btnRemove` so Remove does not trigger selection/drag.
5. **Code**: Replace `const hit = el.querySelector('.instBody') || el` binding with `const hit = el` (or bind to `el` and let `el` be the hit area).

### Clip Library
1. **File**: `static/pianoroll/controllers/library_controller.js`
2. **Change**: When handling a button action (`act === 'play'`, etc.), call `opts.onSelectClip(clipId)` first so selection updates before the action.
3. **Logic**: Ensures clicking any part of the card, including buttons, updates selection consistently.

### Files to edit
- `static/pianoroll/timeline_controller.js` — use full instance as hit area
- `static/pianoroll/controllers/library_controller.js` — select before button actions
