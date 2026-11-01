# Studio testing workflow

## Single development line

- The only active Studio checkout is `W:/git/Hum2song1/hum2song-studio-cloud`, branch `codex/unified-maintenance-20261101`. Use this same source for both regions; retain region-specific configuration and verified startup artifacts.
- Coordinate through the Hum2Song unified maintenance chat and the Cloud checkout's `docs/ops/UNIFIED_DEVELOPMENT_PLAN_20261101.md` / `UNIFIED_TASK_QUEUE_20261101.md` at `W:/git/Hum2song1/_worktrees/music-model-display-cn-20261011`.
- Other Studio worktrees are read-only recovery/history inputs. Preserve their work; do not start another regional or UI implementation line from them.
- Remote `master` has independent merge/license history. Reconcile it through reviewed normal integration before upstream publication; never force-push this branch over it.

- Use `docs/ON_DEMAND_TESTING.md`: preview `node scripts/test-changed.js plan --base <verified-base>` and execute the matching `run` command.
- Include committed changes by selecting the correct pre-change base. HEAD alone only covers remaining working-tree changes.
- Keep complete frontend regression for releases (`--release --full`), including source syntax and multistem source timing checks.
- Local checks do not prove browser, real audio, billing or production acceptance. Record those separately. Do not rerun full-song inference for unrelated UI/doc changes.
- Review the semantic risk: billing/refund/authorization changes must retain Cloud's membership and ledger acceptance; worker/model/resource changes need the corresponding audio/load/voice checks.
- Preserve unrelated working-tree changes and never include local test caches or private fixtures in commits.
