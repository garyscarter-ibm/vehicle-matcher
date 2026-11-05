# Actual manual/buddy exclusion proof plan

FUCQ-100 / DEV-2026-11-04-060, 5 November 2026. Proposed bounded memory proof; no proof allocation
or result is claimed. The dispatcher reviews the exact source and resource plan before execution.

Refreeze the final owned quote producer after the current-car metadata checkpoint; its owning local
commit is reported to the dispatcher with these exact source identities:

| Owned source | SHA-256 |
|---|---|
| `server/gcsp/offers/buddy-hold.js` | `b9f1a9be9cf42552a56313492bf0703b49ed715ffe2059f477ee11637c44b3d6` |
| `server/gcsp/offers/current-car-comparison.js` | `c5aaf8b2e3123301d50f3dade21e89e4f88abf12ede4e2c7ed801adbc56099cd` |
| `server/gcsp/offers/buddy-remote.js` | `0284045ab38c22c305019ad4a560724aa233e830c6c37186d5661da430c59e01` |

This supersedes the initial524294dproduct pin. Current-car19/19 + freshly selected193/193 boundaries
pass at these identities; `parent-current-car-audit.json` verifies35clean manifests. Publication remains
blocked by the shared GitHub `commit_refs_rules` failure; last published100checkpoint is `41f995f`.
Do not alter the manual story/worktree, paused allocator, repository/schema, identity, policy, BriefService
or central composition. No native database, credentials, HTTP listener, network or full suite.

Use actual published FUCQ-66 commit `eb5a677b37c486e3da7c4547803f739e22df8ac3`, exporting its two
required source files byte-for-byte through scaffold Git under the short checkout mutex:

| Source | SHA-256 |
|---|---|
| `server/gcsp/manual-claims/index.js` | `32c80ef72d8329fcdbc4a208d9ab911f68156e6234d3917975754415d04ef059` |
| `server/gcsp/manual-context/index.js` | `3e694f3a68b9d3c9f40b44ddb785bec2edce3b3ada43d491995be77a2930fd43` |

Read-only contract `f81855f:docs/gcsp/manual-claims-contract.md` remains pinned to
`9c31f6f368ed4ed616c755eed168ae6bd75869cf65c4efc811eb0a2cd0cff294`. The published browser exposes
`claimInput = { orderUuid, expectedStockVersion, expectedDraftVersion, expectedContextVersion,
expectedTermsDigest }`, which the proof passes unchanged with its own logical command ID to
`ManualClaimsService.claim`. It must use the actual ManualContextService and real branded identity,
confirmed brief, policy, clock, shared memory repository, fixture read ports and conditional claim.
It must not substitute a fake manual claimant or call conditionalClaim as a manual-service stand-in.

The supervisor creates a run-owned scratch module tree for just these two immutable source files.
A task-owned ESM loader maps their relative imports back to this story's frozen actual dependencies;
only the two selected module URLs are redirected. Never import a copied file with accidentally changed
relative resolution, transform its source, copy a dependency tree or make a symlink. Verify source
hashes before loading and after the run. Retain the exact existing named read-only pg/jsdom loader
entries and their device/inode/hash checks. No install or alternate module fallback is allowed.

Add `server/test/gcsp-buddy-manual-services.proof.mjs`, selected explicitly by the admitted proof variant
(the ordinary old-branch test glob does not imply that its absent manual source is integrated). One fresh runtime
per case seeds real authenticated employee/slot/brief/manual context and exact released stock. Prepare
the actual manual draft through readAccount/saveDraft, then get browseStock.claimInput from the real
manual service. Capture current buddy candidate revisions through repository reads. Cases:

1. Actual manual claim succeeds; refresh buddy observed revisions, then buddy refuses the same car
   without creating a buddy quote, offer, outbox or second occupying claim. Include same employee/slot
   and a second genuine employee to prove exact-car exclusion beyond per-employee capacity.
2. Actual buddy offer succeeds; a fresh real manual browse reports that exact car unavailable and
   a previously captured real manual claimInput cannot claim it. Refresh/replay outcomes remain
   truthful and the original buddy quote/hold/offer/outbox remain unchanged.
3. If admitted within the same scope, concurrent actual service claims use one shared repository and
   produce at most one occupying winner, with failed buddy attempts producing no offer/outbox.

These are integration protocol checks against the actual published manual sources and this branch's
foundation, not merged-server or native PostgreSQL proof. Any source incompatibility is a failed
boundary requiring diagnosis and a separate edit grant; do not patch the imported manual source.

Select at most four to six synthetic cases initially. Record the exact import graph/fixture edges,
source/test/environment identity, base, exclusions and affected callers in shared
`.claude/test-runs/impact/fucq100-manual-proof.json` before launch. Every chunk has fresh HostBudget,
an external ownership manifest, registered finalizer, owned TMPDIR/TMP/TEMP, recursive PID/PGID start
identities, maximum120seconds/768MiB RSS/128MiB scratch/2MiB bounded redacted logs/one worker.
Unset every DB alias and NODE_OPTIONS. Hold no Git mutex while tests or process waits run. Retain small
summaries and useful failures, stop/join descendants, delete owned scratch and prove root/PIDs/groups/
reservation absence plus unchanged dependency identities in the parent's final audit. OneDrive remains
unavailable; no large artifact or archive is planned. Register no server or browser resources.
