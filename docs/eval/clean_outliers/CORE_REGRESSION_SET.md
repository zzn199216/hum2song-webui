# Core Regression Set — `clean_outliers`

**Purpose:** Small fixed set to catch **baseline regressions** before/after changes that touch optimize, templates, or LLM plumbing for outlier cleanup.

**How to run:** Use the same clip construction, same `clean_outliers` / `reduceOutliers` path, and same listening checklist each time. Record **Result** and **Notes** after each run.

**Template:** `clean_outliers_v1` with intent `reduceOutliers: true` (and other intent flags off unless you explicitly test mixed intent).

---

| Case ID | CO-01 |
|---------|--------|
| **Short name** | Single high outlier |
| **Clip description** | Short melody with **one** note clearly higher than the rest (pitch spike). |
| **Why in set** | Most common “wrong note” mental model for outliers. |
| **Expected behavior** | Spike softened, deleted, or pulled toward cluster **without** flattening the whole phrase. |
| **What should NOT happen** | Mass deletion; retune entire line to a new scale; velocity-only disguise as “cleanup.” |
| **Result** | _pass / suspicious / fail_ |
| **Notes** | |

---

| Case ID | CO-02 |
|---------|--------|
| **Short name** | Single low outlier |
| **Clip description** | Same idea as CO-01 but **one** note obviously **below** the main cluster. |
| **Why in set** | Models sometimes treat high vs low outliers differently. |
| **Expected behavior** | Obvious low stray addressed; contour still recognizable. |
| **What should NOT happen** | Bass-anchored melody destroyed; octave jumps “fixed” into mud. |
| **Result** | _pass / suspicious / fail_ |
| **Notes** | |

---

| Case ID | CO-03 |
|---------|--------|
| **Short name** | Two clear outliers |
| **Clip description** | **Two** separated wrong notes (one high, one low or both same direction). |
| **Why in set** | Tests whether cleanup stops after real issues vs over-continuing. |
| **Expected behavior** | Both addressed or clearly justified partial fix; middle of phrase stable. |
| **What should NOT happen** | “Cleaning” every note after the first outlier; adding/removing notes everywhere. |
| **Result** | _pass / suspicious / fail_ |
| **Notes** | |

---

| Case ID | CO-04 |
|---------|--------|
| **Short name** | Dense cluster + one weird note |
| **Clip description** | Tight rhythmic cluster of **similar** pitches; **one** note off (pitch or timing stick-out). |
| **Why in set** | Classic hum-to-score failure mode: one glitch in a busy bar. |
| **Expected behavior** | Weird note fixed or removed; cluster **mostly** intact. |
| **What should NOT happen** | Cluster thinned to a few notes; grid “correction” that shatters rhythm. |
| **Result** | _pass / suspicious / fail_ |
| **Notes** | |

---

| Case ID | CO-05 |
|---------|--------|
| **Short name** | Very short, very high note |
| **Clip description** | **Short duration** note with **very high** pitch vs neighbors (glitch or squeak). |
| **Why in set** | Duration + pitch extremes stress validation and “delete vs move” choices. |
| **Expected behavior** | Glitch removed or attenuated; no collateral damage on longer notes. |
| **What should NOT happen** | Legitimate short ornaments removed wholesale; adjacent notes dragged up. |
| **Result** | _pass / suspicious / fail_ |
| **Notes** | |

---

| Case ID | CO-06 |
|---------|--------|
| **Short name** | Near-boundary (not a true outlier) |
| **Clip description** | Slightly wide interval or edge of range but **musically intentional** (not a mistake). |
| **Why in set** | Guards **under-edit** and “do no harm” when user asks cleanup but music is already fine. |
| **Expected behavior** | **Minimal or no change**; melody preserved. |
| **What should NOT happen** | “Cleaning” intentional leaps; forcing notes into a tight cluster. |
| **Result** | _pass / suspicious / fail_ |
| **Notes** | |

---

| Case ID | CO-07 |
|---------|--------|
| **Short name** | Melody intact priority |
| **Clip description** | Pleasant, coherent phrase with **maybe** one debatable stray; overall **keep contour**. |
| **Why in set** | Product test: users forgive missed glitches more than ruined tunes. |
| **Expected behavior** | Contour and recognizable tune **remain**; light touch if any. |
| **What should NOT happen** | Rewritten melody; new rhythmic pattern that feels like a different song. |
| **Result** | _pass / suspicious / fail_ |
| **Notes** | |

---

| Case ID | CO-08 |
|---------|--------|
| **Short name** | Do less beats over-clean |
| **Clip description** | Slightly messy but **characterful** take (swing, drift, human variation). |
| **Why in set** | Regression test for **over-edit**: “clean” that kills feel. |
| **Expected behavior** | Subtle fixes only where clearly wrong; **character** remains. |
| **What should NOT happen** | Quantized-to-death feel; all velocities pushed to narrow band; phrase flattened. |
| **Result** | _pass / suspicious / fail_ |
| **Notes** | |

---

| Case ID | CO-09 |
|---------|--------|
| **Short name** | Empty / edge clip (sanity) |
| **Clip description** | **Very few notes** (e.g. 1–3) or minimal span. |
| **Why in set** | Guards no-op and no bizarre structural edits on tiny clips. |
| **Expected behavior** | No error; either no change or minimal defensible edit. |
| **What should NOT happen** | Invented notes; crashes; patch rejected loops without user-readable outcome. |
| **Result** | _pass / suspicious / fail_ |
| **Notes** | |

---

## Session log (optional)

| Date | Build / branch | Tester | Overall core set outcome | Follow-ups |
|------|----------------|--------|---------------------------|------------|
| | | | | |
