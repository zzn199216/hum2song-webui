# Hum2Song Studio — ProjectDoc v2（Beats）冻结规范 v0.1.1（执行版）

> 目的：实现 DAW「搭积木编曲」核心链路（**beats 存储 → flatten 秒事件 → 播放/导出**），并且在整个 T1/T2 期间 **不破坏现有 UI/交互与测试体系**。
>
> 本文是 **冻结执行规范**：实现与测试必须以本文为验收依据。

---

## 0) 范围与长期不变量

### 0.1 不变量（必须长期成立）

1) **存储层只用 beats**：ProjectDoc v2 迁移完成后不得出现 `startSec / playheadSec / pxPerSec / spanSec` 等秒字段（兼容导入阶段可短暂出现，但完成迁移后必须消失）。

2) **播放调度只用秒（派生值）**：Tone schedule 只接受 `flatten(ProjectDocV2)` 输出的秒事件；秒不回写 ProjectDoc。

3) **清洗 ≠ 吸附**：默认只做浮点去噪（float round），不做网格吸附（grid snap）。

4) **BPM 真值唯一**：`project.bpm` 是系统唯一时间基准（真值），所有 sec↔beat 转换、flatten、editor snap 换算都只使用它。

5) **禁止回归（关键 UX）**：timeline dblclick 打开 editor、timeline 拖拽、删除语义、note 绘制可见性、Node/pytest 全绿必须保持。

---

## 1) BPM 规则（冻结）

### 1.1 真值规则

- `project.bpm` 是唯一真值。
- 所有 `secToBeat / beatToSec`、flatten、editor snap 换算 **只使用 `project.bpm`**。
- `clip.meta.sourceTempoBpm` / `score.tempo_bpm` 仅用于追溯，不参与计算。

### 1.2 初始化规则（新工程首次导入 clip）

当 project 尚未“初始化 bpm”时（新工程第一次导入 score）：

- 若 `score.tempo_bpm` 存在且在 `[40, 240]`：`project.bpm = score.tempo_bpm`
- 否则：`project.bpm = 120`

同时记录：`clip.meta.sourceTempoBpm = score.tempo_bpm ?? null`

动机：工程内部统一节拍体系；修改 BPM 才是整体快慢变化（符合 DAW 预期）。

---

## 2) 清洗与吸附（冻结）

### 2.1 存储层去噪（默认开启）

- 只做 float round，不做 grid snap。
- `roundBeat(x) = round(x, 1e-6)`（默认，极保守）
- `roundSec(x) = round(x, 1e-6)` **仅用于 UI 展示/日志/测试对比**，不得用于 Tone schedule。

### 2.2 snapIfClose（默认关闭，可选开关）

用于“只修漂移，不改节奏”的可选模式：

- `snapIfCloseBeat(x, gridBeat, epsBeat)`：仅当 `abs(x - round(x/gridBeat)*gridBeat) < epsBeat` 才吸附，否则保持原值（并仅做 float round）。

冻结 epsilon 两档：

- `epsBeatTiny = 1e-6 beat`（默认如果开启 snapIfClose，先用 Tiny）
- `epsBeatLoose = 1e-4 beat`（仅当导入源漂移明显才用）

### 2.3 交互层吸附（Snap Grid）

- 用户拖拽/插入时才使用网格吸附（如 1/16、1/32…）。
- Snap 语义永远是 beat（见第 7 节）。

### 2.4 Tone schedule 精度（冻结）

- Tone 调度必须使用 `flatten` 计算出的 **高精度秒值**（不得对秒值 round 再 schedule）。
- `roundSec` 仅用于 UI/日志/测试。

---

## 3) ProjectDoc v2 Schema（冻结）

### 3.1 顶层结构

```js
ProjectDocV2 = {
  version: 2,
  timebase: "beat",

  bpm: number, // >0

  tracks: [{ id: string, name: string }], // 编曲层轨道（timeline track）

  clips: { [clipId: string]: ClipV2 },    // map
  clipOrder: string[],                    // 保持 UI 顺序

  instances: InstanceV2[],

  ui: {
    pxPerBeat: number,     // >0，BPM 改动不改变它（视觉不漂移）
    playheadBeat: number   // >=0
  }
}
```

### 3.2 Clip / Score / Note

```js
ClipV2 = {
  id: string,
  name: string,
  createdAt: number,
  sourceTaskId: string|null,

  score: ScoreBeatV2,

  meta: {
    notes: number,
    pitchMin: number|null,
    pitchMax: number|null,
    spanBeat: number,
    sourceTempoBpm: number|null
  }
}

ScoreBeatV2 = {
  version: 2,
  tempo_bpm: number|null,
  time_signature: string|null,

  tracks: [{
    id: string,
    name: string,
    notes: NoteBeat[]
  }]
}

NoteBeat = {
  id: string,            // 稳定（只补缺，不重写）
  pitch: int 0..127,
  velocity: int 1..127,
  startBeat: number >=0,
  durationBeat: number >0
}
```

### 3.3 Instance（timeline 摆放）

```js
InstanceV2 = {
  id: string,
  clipId: string,
  trackId: string,   // 引用 project.tracks[].id
  startBeat: number >=0,
  transpose: int     // default 0
}
```

### 3.4 ID 稳定策略（冻结）

- 只补缺，不重写：`clipId / instanceId / noteId` 一旦存在，绝不改变。
- 若导入 score note 不带 id：迁移/导入时补齐 id 并持久化，从此稳定。

---

## 4) Track 语义（冻结，防两套 trackId 混用）

### 4.1 语义区分（必须写死）

- `project.tracks`：编曲层轨道（Arrangement / timeline tracks）
- `clip.score.tracks`：clip 内部音轨（MVP 允许多条，但不参与编曲轨道选择）
- `instances.trackId`：只引用 `project.tracks[].id`

### 4.2 flatten 映射规则（MVP 冻结）

- 一个 instance 将其引用的 clip 内 **所有 score tracks 的 notes**，统一映射到该 instance 指定的 `project.trackId` 输出。
- 未来支持“clip 内多轨映射到多个 project track”时再扩展（不在本轮）。

---

## 5) 删除语义（冻结，防 dangling instance）

### 5.1 删除 instance（保持现有行为）

- 删除 timeline instance：只移除 instance，不影响 clip。

### 5.2 删除 clip（冻结安全默认）

- 若 clip 被任何 instance 引用：必须弹确认框：
  - “删除 clip & 删除所有引用 instances”
  - “取消”
- 若 clip 未被引用：直接删除。

禁止：删除 clip 后留下引用它的 instance。

---

## 6) timebase 桥接 API（冻结，集中提供）

所有 controller 只能调用这些函数，不得散落 sec/beat/px 换算逻辑。

### 6.1 beat 定义（冻结）

- **1 beat = 四分音符（quarter note）**。
- `beatToSec` / `secToBeat` 只由 BPM 决定：
  - `sec = beat * 60 / bpm`
- `time_signature` 仅追溯/显示，本轮不参与 beat 换算。

### 6.2 基础换算

- `beatToSec(beat, bpm)`
- `secToBeat(sec, bpm)`

### 6.3 像素换算

- `pxPerSecToPxPerBeat(pxPerSec, bpm)`
- `pxPerBeatToPxPerSec(pxPerBeat, bpm)`

### 6.4 规范化与可选吸附

- `normalizeBeat(x) = roundBeat(x)`
- `snapIfCloseBeat(x, gridBeat, epsBeatTiny|epsBeatLoose)`（默认关闭）

### 6.5 派生 getter（只读）

- `getPlayheadSec(project)`
- `getInstanceStartSec(project, inst)`

### 6.6 写入 setter：必须区分 Free vs Snapped

目的：避免播放同步时红线“跳格子/抖动/误差累积”，同时允许用户交互吸附。

Playhead：

- `setPlayheadFromSec_Free(project, sec)`：用于 rAF/播放同步（不 snap，只 normalize）
- `setPlayheadFromSec_Snapped(project, sec, gridBeat)`：用于用户拖动 playhead（可 snap）

Instance：

- `setInstanceStartFromSec_Free(project, inst, sec)`：程序同步/内部调整（不 snap）
- `setInstanceStartFromSec_Snapped(project, inst, sec, gridBeat)`：用户拖拽实例（按 UI snap 开关决定）

### 6.7 normalize-on-write（冻结新增）

- **任何写入到 ProjectDoc 的 beats 字段**（`instance.startBeat / ui.playheadBeat / note.startBeat / note.durationBeat / meta.spanBeat`）必须经过 `normalizeBeat`（以及必要的 clamp）。

---

## 7) Editor Snap 语义（冻结）

Editor 仍可内部以秒工作以保护手感，但 Snap 档位必须是 beat 语义：

- `snapBeat = 1/16, 1/32, ... 或 Off`
- `snapSec = beatToSec(snapBeat, project.bpm)`

BPM 改动后：`snapSec` 必须随 bpm 自动更新（对齐工程 beat 网格）。

---

## 8) flatten 规格（冻结）

### 8.1 输入

- `ProjectDocV2`（beats）

### 8.2 输出（秒事件，给 Tone / 后端导出）

```js
{
  bpm: number,
  tracks: [{
    trackId: string,
    notes: [{
      startSec: number,
      durationSec: number,
      pitch: number,
      velocity: number,
      clipId: string,
      instanceId: string,
      noteId: string
    }]
  }]
}
```

### 8.3 规则（冻结）

对每个 instance、对 clip.score 的每个 note：

- `absBeat = inst.startBeat + note.startBeat`
- `startSec = beatToSec(absBeat, project.bpm)`
- `durationSec = beatToSec(note.durationBeat, project.bpm)`
- `pitch = note.pitch + inst.transpose`

排序：按 `startSec` 升序稳定排序（同 startSec 再按 pitch，再按 noteId）。

### 8.4 Flatten 不改变音乐（冻结硬规则 / 补丁 B）

flatten 必须：

- 一对一展开：每个 `(instance, note)` 产出一个 output note
- 不得做任何音乐语义优化：不合并、不去重、不量化、不裁剪、不 legato/humanize/swing

### 8.5 非法数据处理（冻结）

这属于“数值合法化”，不是音乐优化：

- `durationBeat <= 0`：丢弃（并计数/可见日志）
- `pitch` 越界：clamp 到 `[0,127]`
- `velocity` 越界：clamp 到 `[1,127]`
- `startBeat < 0`：clamp 到 `0`（但迁移/存储层应尽量避免出现）

责任边界（冻结新增）：

- 写入存储层（迁移/保存）应尽量保证合法（避免产生非法 note）。
- flatten 的非法处理仅作为“最后兜底”，并且必须计数/可见日志（避免静默吞音）。

---

## 9) Clip.meta 强一致（冻结硬规则 / 补丁 A）

### 9.1 spanBeat 定义（冻结）

对任意 ClipV2：

- `spanBeat = max(note.startBeat + note.durationBeat)`（遍历所有 tracks 的所有 notes）
- 若无 notes：`spanBeat = 0`

### 9.2 meta 字段派生性质（冻结）

以下字段均为派生字段，允许重算，但必须与 score 强一致：

- `meta.notes`：notes 数量总和（跨 `score.tracks` 汇总）
- `meta.pitchMin / meta.pitchMax`：notes.pitch 的 min/max
  - 无 notes 时冻结约定：`pitchMin = null, pitchMax = null`
- `meta.spanBeat`：按 9.1 定义
- `meta.sourceTempoBpm`：追溯字段（非派生）

### 9.3 重算触发点（冻结）

必须重算 meta：

- editor Save（score 变化）
- 从后端导入 scoreSec → 存 beat
- v1→v2 迁移
- project import（clip.score 变化）

无需重算 meta：

- clip.name 改名
- instance 变化（不影响 clip meta）

---

## 10) clipOrder 不变量（冻结新增）

- `clipOrder` 必须无重复。
- `clipOrder` 中每个 id 必须存在于 `clips` map。
- `clips` map 的每个 key 必须出现在 `clipOrder`（本轮不支持“隐藏 clip”）。
- 新增 clip 必须 append 到 `clipOrder`。
- 删除 clip 必须同时从 `clips` 和 `clipOrder` 移除，并按第 5 节规则级联处理 instances。

---

## 11) transpose 合法化（冻结新增）

- `transpose` 必须为整数。
- 写死策略：`transpose = Math.round(transpose)`。
- 写死范围：clamp 到 `[-48, +48]`。

flatten 中：

- `pitchOut = clamp(note.pitch + transpose, 0, 127)`。

---

## 12) 最小数值不变性测试（冻结，必须加）

### Test A：score 往返一致性（sec→beat→sec）

输入：真实 scoreSec JSON（fixture）

操作：`scoreSecToBeat → 再转换回 sec（或 flatten 后对比）`

断言：

- note 数量相同
- pitch/velocity/id 不变
- `abs(startSec2 - startSec1) < 1e-4`
- `abs(durationSec2 - durationSec1) < 1e-4`
- 可选断言（推荐便宜高收益）：`meta.spanBeat` 与重算结果一致（误差 0 或 <1e-9）

匹配策略：

- 优先按 note.id 匹配
- 若缺 id：迁移阶段补 id
- 极端兜底：用 `(pitch, startSec≈, durationSec≈)` 三元组近似匹配（容差 1e-4）

### Test B：project v1→v2 迁移一致性

输入：真实 v1 project JSON（fixture）

操作：`migrateProjectV1toV2`

断言：

- instances 数量相同
- clips 顺序相同（v2.clipOrder 与 v1.clips[] 顺序一致）
- `playheadSec_old ≈ beatToSec(playheadBeat_new)`（误差 <1e-4）
- `startSec_old ≈ beatToSec(startBeat_new)`（误差 <1e-4）
- 不出现 NaN；startBeat>=0；durationBeat>0

### Test C（建议纳入回归套件）：flatten 展开一致性

给 project fixture 加 “同 clip 两个 instance 重叠”用例，断言：

- 输出 note 数量 = `clipNotesCount * instancesCount`
- 以 instanceId 分组后，每组数量都等于 clipNotesCount
- 不合并/不去重（验证 8.4）

---

## 13) 里程碑顺序（冻结执行版）

顺序冻结为：

**T1-0 → T1-1 → T1-2 → T1-3 → T1-4 → T1-6 → T1-5 → T2-1 → T2-2 → T2-3**

解释：

- 先 timebase API + schema + flatten（纯函数）
- 再迁移函数与触发点
- 先立数值测试（T1-6）锁住正确性
- 最后才动 editor 边界适配（交互敏感区）
- 再进入播放闭环（T2）

---

## 14) 实现/测试落点（最低要求）

为满足“冻结规则可追溯”，最低要求如下（实现时可调整文件名，但需一致）：

- **T1-0（timebase API）**：`static/pianoroll/project.js` 或 `static/pianoroll/core/timebase.js`
- **T1-2（flatten）**：`static/pianoroll/project.js` 或 `static/pianoroll/core/flatten.js`
- **T1-6（数值不变性测试）**：`scripts/tests/*.js`（由 `scripts/run_frontend_all_tests.js` 运行），fixtures 放 `tests/fixtures/frontend/`

- **T1-3（迁移）**：`static/pianoroll/project.js`
- **T1-4（触发点/BPM 初始化）**：`static/pianoroll/app.js`
- **T1-6（数值不变性测试）**：新增 Node 测试 `scripts/tests/*.js` + fixtures（建议 `tests/fixtures/frontend/`）并由 `node scripts/run_frontend_all_tests.js` 执行；pytest 通过 `tests/test_frontend_node_contracts.py` 桥接。

