# Clip notation implementation and verification

Date: 2026-09-25. Implementation verification; release preparation authorized after the initial read-only audit.

## Ownership and launch

- Worktree: `W:\git\Hum2song1\hum2song-studio-notation`
- Branch: `codex/clip-notation-workspace`
- Base: `8948ade` from `hum2song-studio-cloud` (MVP repository).
- Cloud repository and the original Studio worktree were not edited. Existing Baidu upload sidecars remain untouched.
- Static local preview: run `python -m http.server 8767 --bind 127.0.0.1` from this worktree, then open `http://127.0.0.1:8767/static/pianoroll/index.html`.
- The preview server is currently running on port 8767. A headed Playwright session named `notation` contains the test project. A separate browser can import `output/playwright/notation-fixture.json` through Project -> Import project JSON.
- Static preview does not provide `/api/v1/health` or processing endpoints; its health 404 is expected. No generation, cloud authentication, production write, or provider call was used.

## Behavior

1. Each note clip independently chooses Piano roll / Staff / Numbered. Audio clips retain their waveform.
2. All views edit the same modal draft. Pitch, start beat, duration, velocity, insert/delete, selection, undo/redo and playback highlighting use the shared editor state.
3. Switching views only projects the score; it does not quantize playback data. Save persists the view/key/clef/display grid in `clip.meta.notation`; Cancel discards those draft preferences.
4. Reconciliation retains exact stored beat values and extension fields for untouched notes. Edited clips preserve the prior head in the existing revision chain.
5. Saved timeline thumbnails follow the clip view. They remain time-aligned overview drawings, rather than print-layout thumbnails. Dense symbols necessarily overlap at very small timeline zoom; open the clip for the full score.
6. Export freezes the selected clip's current draft into paginated SVG pages, previews them on the web, generates a downloadable PDF locally, and links to the actual PDF before download. SVG export combines all pages into one vector document.
7. VexFlow handles staff engraving. The numbered renderer shares the same pitch/duration/voice/tie projection. Dependencies are pinned and served locally; their licenses are included.

## Verification

- `node scripts/run_frontend_all_tests.js`: PASS (full existing frontend gate plus new notation tests).
- `git diff --check`: PASS.
- Pure tests: projection immutability, multiple voices, chords, rests, cross-bar ties and duration conservation, key spelling, seconds/beats conversion, selective edits, invalid inputs and bounded score size, preservation of untouched beat precision.
- Browser: view switching without draft changes; staff pitch editing; numbered duration editing; named pitch/duration controls; insert/delete; undo/redo; Cancel; exact view-only save; save/reload; independent saved view preference; staff/numbered timeline thumbnails; actual playback highlight; audio waveform routing; 760px and 390px layouts.
- Browser save regression: untouched note retained start `1.123456789` and duration `.456789123`; changed note persisted; new parent revision points to the original active head and contains its original pitch.
- Export regression: a 288-note chord clip rendered every note ID and produced 3 staff pages and 4 numbered pages. Poppler rendered every page and all were visually inspected, including titles, accidentals, octave dots, chord spacing, bar lines, and pagination.
- PDF output is A4. Music and Chinese titles are rasterized at 2x SVG resolution for consistent output; SVG remains vector. These are not text-searchable/vector PDFs.
- Evidence: `output/playwright/frontend-tests.log`, `browser-main.log`, `browser-extra.log`, `browser-save.log`, `browser-pagination.log`, final workspace screenshots, PDF fixtures and Poppler page PNGs. Browser scripts/fixtures there are QA material, not shipped application assets.

## Pitch gesture follow-up (2026-09-25)

- Staff dragging follows five SVG units per diatonic step, using the initial screen transform so CSS scaling does not alter the gesture. A bass-clef test verifies the same mapping. Only the targeted pitch changes, including notes with precise non-grid timing.
- Real pointer checks passed: multiple steps, exactly one undo entry, undo/redo, return-to-origin retaining redo, Escape restoration and pointer cancellation. Piano roll drag still uses its existing edit/history logic and now previews changed pitches.
- Piano keyboard: click/hold audition, active-key feedback, no score/history changes, and horizontal pinning at scrollLeft 200 passed. Preview mute suppresses new attacks.
- Actual WebAudio output was captured locally with MediaRecorder and decoded: nonzero post-envelope peak 0.1363. A main-thread analyser can miss short notes while engraving blocks JavaScript, so it is not used as the authoritative sound-output assertion. No microphone or upload was used. Physical speaker output is not an automated acceptance claim.
- Pure audition tests cover pending audio unlock cancellation, latest-pitch wins, same-pitch deduplication, mute, and disposal preventing late playback. Staff transposition tests cover key signatures, chromatic offsets, octave boundaries and every MIDI pitch's zero-step identity in all supported keys.
- Evidence: `output/playwright/drag-audition-result.log`, `verify-drag-audition.js`, `piano-preview-keyboard.png`, `staff-drag-preview.png`; `scripts/tests/editor_audition.test.js` and extended `notation.test.js`.
- Adjacent chord-tone hit areas and displaced heads are independently selectable. Browser checks passed dragging the lower note in a C/D/E cluster and dragging its second tied fragment, preserving the other pitches and original duration (`drag-chords-result.log`).

## Visible-note hit and roll extent correction (2026-09-25)

- User-reported staff miss reproduced: beam generation happened after voice drawing and rebuilt VexFlow noteheads. Newly read head coordinates were x=0, placing note hit boxes at x=-5 while the visible music remained at formatted coordinates. Generate beams before formatting/drawing and append hit boxes after all engraving.
- Previous hit-box-driven tests were insufficient: they clicked the invisible interaction geometry itself. The new regression derives pointer positions from `.vf-notehead path` glyph bounds, then verifies the selected source note and changed pitch. Adjacent-chord and tie-fragment checks now also use visible glyphs.
- Short clips now have all 128 MIDI pitch rows, automatically centered on their melody when opened. The roll position survives view switches. Time extent includes eight spare quarter beats; dragging toward the right edge grows content as the note moves past the previous extent.
- Pointer capture plus continuous edge scrolling allow stationary-pointer continuation at top/bottom/left/right. Release, cancellation, focus loss and close stop scrolling. The existing drag history and audition remain the owners of their state.
- Real-browser PASS in separate `notation-fix` session: visible C4 selection and drag, full pitch range, initial framing, top-edge drag to MIDI 80, bottom-edge drag to MIDI 47, horizontal drag past the original 9.45-second clip to 15.15 seconds, content width expansion, one-step undo, release stopping scroll and view-position preservation. Visible adjacent chord/tie tests also pass.
- Evidence: `visible-heads-scroll-result.log`, `visible-chords-result.log`, `full-range-piano-roll.png`, `visible-staff-hit-fixed.png` under `output/playwright/`; complete frontend suite passed in `frontend-tests-hit-scroll.log`. The user's existing browser/editor was not refreshed or replaced during the fix.

## Current boundaries

- Display grids: 1/16, 1/32, 1/64. Irregular timing and tuplets are approximated visually and disclosed; original clip timing is preserved. No tuplet engraving, lyrics, dynamics notation, or free engraving-layout edits.
- Single-clip editing/export; overlapping voices can occupy separate labeled lines inside that clip. No multi-clip orchestral score assembly.
- Rendering guards: 512 measures, 32 projected voices, 12,000 notes and 320 layout rows. Oversized notation reports an error and suggests splitting; original clip content remains intact.
- Phone controls fit the screen; the score scrolls horizontally to preserve readable note sizes. Desktop/tablet are the primary editing layouts.
- Newly added controls have Chinese/English copy; other locales fall back to English. Switching the host language after construction may require a page refresh for these controls.
- No backend, membership, quota or paid processing changes. See the release record for packaging and production verification.

## Deployment preparation (2026-09-25)

- Release marker: `clip-notation-v1-20260925`; entry points and lazy-loaded first-party assets use the formal release marker. Third-party notation bundles have pinned filenames and included licenses.
- Full frontend suite passed again after the marker update.
- Deep review found a pre-existing missing `separatorOption` in the waveform-to-app adapter: enhanced-vocal requests could silently use Demucs. Added the missing forwarding field. `waveform_separation_dispatch.test.js` fails on the production base and passes with the fix, and is included in the full gate.
- Isolated browser regression exercises the real waveform UI, audio decoding, separation clients, local audio persistence and result materialization. Only host RPC responses are simulated: stable separation, enhanced vocals, separation plus editable notes, advanced stems and failure recovery are covered without paid/provider jobs. Anonymous requests are rejected before host RPC.
- Source audio, existing note values, note revision and notation preferences remain intact through result import. Existing v1/v2 materialization can enrich tempo/auto-split metadata and reorder object properties; this is not asserted to be byte-identical JSON.
- Separate save-isolation verification covers untouched high-precision current notes and extension fields. Parent revision snapshots retain the pre-existing six-decimal normalization contract.
