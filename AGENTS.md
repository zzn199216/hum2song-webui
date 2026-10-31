# Studio testing workflow

- Use `docs/ON_DEMAND_TESTING.md`: preview `node scripts/test-changed.js plan --base <verified-base>` and execute the matching `run` command.
- Include committed changes by selecting the correct pre-change base. HEAD alone only covers remaining working-tree changes.
- Keep complete frontend regression for releases (`--release --full`), including source syntax and multistem source timing checks.
- Local checks do not prove browser, real audio, billing or production acceptance. Record those separately. Do not rerun full-song inference for unrelated UI/doc changes.
- Review the semantic risk: billing/refund/authorization changes must retain Cloud's membership and ledger acceptance; worker/model/resource changes need the corresponding audio/load/voice checks.
- Preserve unrelated working-tree changes and never include local test caches or private fixtures in commits.
