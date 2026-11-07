# Lead-audited activation9 proof, 6 November 2026

At tested revision `12982598ec761aeace20485ca00b107606f2d307` (evidence-only after
`30e7663` and the `f80fc61` product/test freeze; the delta was checked to touch only
the publish15 evidence paths), the once-granted `eligibility-activation` selection
passed **9/9** cases: 7 in `server/test/gcsp-policy-activation.test.js` and 2 in
`server/test/gcsp-greg-publish-http.test.js`, both whole files with no name filter,
with zero suites, failures, cancellations, skipped or todo cases. The
[1,057-byte original SPEC log](test.log) is copied byte for byte; Node prints the HTTP
file first. Child and supervisor exits were 0. No completed mode was rerun.

Grant `fucq103-eligibility-activation-1298259-1336` came from the Codex assist
assignment's conditional-once-per-chunk grant. A second independent managed reviewer
(Cool Cat, opus/high) passed the exact command, the evidence-only HEAD delta, the
source and dependency closure, the assertions, the strict all-row ledger admission and
all-outcome cleanup before execution. The grant is consumed; there is no retry.

Limits. Everything runs in memory: memory repository, `MemoryPolicyProvider`,
synthetic released stock and a `DemoClock` advanced by command. The activation cases
use the alternative small-count threshold 1; the two HTTP cases use the canonical
policy. Faults are injected through wrapped transaction stubs (clock race, lost
response, unavailable, permanent stale version), session expiry uses a stubbed
`sessionNow`, and the HTTP recommendation provider is a stub over repository stock.
One check is shape only (principal key count). The HTTP cases bound loopback
`127.0.0.1` listeners only (ports 57244 and 57259, both closed). No DOM, rendered panel,
PostgreSQL, external network or actual producer journey was exercised.

Wall 9.78s; peak aggregate RSS 882.5MiB within 1024MiB; combined peak 4,348,579B;
scratch removal 4,338,401B. Four owned PIDs and group 29602 are absent, both recorded
listeners are closed, scratch and worktree dependency paths are absent, and the ledger
reads `{}` with the exact token gone. The [concise index](index.json) binds the
originals by path, bytes and SHA-256. Root final collection is pending.
