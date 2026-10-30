# CN Studio advanced-stem timeout recovery — 2026-10-01

The October 1 advanced-stem task for the 141.624-second source succeeded and
stored 12 stems. Production API logs show a job-status read took 75.7 seconds and
returned HTTP 200. The Studio status RPC deadline is 60 seconds; previously that
single timeout rejected the entire operation, although the server continued
finalizing the stems. This is distinct from the earlier Unicode upload failure.

Commit 6bef93c keeps querying the original job after status/result RPC timeout,
within the existing one-hour operation deadline. It never submits a new job from
the retry path. Provider failure, cancellation and authentication errors remain
terminal. Zero cost on an idempotently reused completed job is preserved rather
than defaulting it to 30. Regression scenarios cover repeated status timeouts,
result timeout, same-job identity, one create, actual failure, auth failure, and
bounded deadline. Full Studio frontend suite passed during packaging.

Commit d66b3d2 aligns existing cache assertions. The delta was built against the
exact live cac67b2 Studio base, deployed through the versioned atomic Studio
helper as d66b3d2f68e6cffb90320ae4b4f8d61be62143c0-suno-timeout-recovery-v1-20261001.
The previous precision release remains rollback. Only Studio restarted; Cloud
Web/API billing code, Core, and home Worker were not modified. Studio, Cloud
Studio and API health return 200. No paid provider call or production job was
created for validation. Release/browser receipts are in ignored output files.

For the affected source, refresh Studio and retain the same original clip and
range. The source preparation key and server advanced-job idempotency key are
stable; requesting that same successful operation returns its stored job with
reused=true and costUnits=0. Changing source/range creates a different operation.
A refreshed document loads the new script cache marker even when the Cloud
iframe URL still carries the older host-side v parameter.
