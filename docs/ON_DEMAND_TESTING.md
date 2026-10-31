# 按需测试入口

开发时先预览，再执行。基线使用本次改动之前、已经验收或部署的 Studio 提交：

```text
node scripts/test-changed.js plan --base <提交>
node scripts/test-changed.js run --base <提交>
```

默认 HEAD 只适用于未提交改动；提交后必须传正确基线。工具包含已提交、暂存、工作区和未跟踪源码；删除/重命名按旧、新路径检查。文档与 output、Playwright 证据等不会触发无关前端测试。

| 改动 | 本地检查 |
| --- | --- |
| 语言 JSON | i18n 契约 |
| CSS | 样式约束；视觉效果仍需浏览器检查 |
| 单独测试文件 | 该测试；删除测试则保守回退完整套件 |
| 核心 JS、HTML、打包脚本、未知路径 | 完整前端套件 |
| 文档 | 无运行时检查 |

`--release` 对代码改动跑完整前端回归，`--full` 无条件跑完整前端回归。delta 打包脚本固定使用两者，保留发布门槛。套件只有数秒，不缓存成功结果。语法和多轨源起点回归已纳入完整套件。

```text
node scripts/test-changed.js run --base <提交> --release
node scripts/test-changed.js run --full
```

日志实时输出，失败返回非零；摘要、逐步耗时和待办在 `.verification-cache/last-run.json`。`localStatus: passed` 只代表选中项本地通过；`externalStatus: NOT_RUN` 表示浏览器等验收待完成。空清单不是整站通过。Python/未知后端路径会提示补充对应后端测试，完整前端套件不覆盖它们。

路径策略不替代代码风险判断：修改导入/分轨/MIDI/保存流程需短素材、源时间偏移、重复点击、保存并显式云端重载。收费、退款、权限变化同步执行 Cloud 的 `docs/ops/MEMBERSHIP_ENTITLEMENTS_RUNBOOK.md`。模型、Worker、GPU或资源配置变化才进入整曲负载和并发声音替换验收；纯前端不重跑 600 秒模型任务。

工具不部署、不启动生产任务。浏览器冒烟和真实服务验证单独记录，不能以本地通过代替。新增路径规则更新 `scripts/test-changed.js` 和 `scripts/tests/test_changed.test.js`；源码变化范围不明确时使用 `--full`。
