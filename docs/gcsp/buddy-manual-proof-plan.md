# Actual manual/buddy exclusion proof

FUCQ-100 / DEV-2026-11-04-060, 5 November 2026. The dispatcher granted the bounded memory proof
after independently checking the published source pins below. All four selected cases pass, with no skips.
This proves the actual published service boundary against this branch’s foundation; merged runtime and
native PostgreSQL acceptance remain separate.

The final owned quote producer is published at `a7fc8580efba36c329b2479711d6b66db53962bd`,
with these frozen source identities:

| Owned source | SHA-256 |
|---|---|
| `server/gcsp/offers/buddy-hold.js` | `b9f1a9be9cf42552a56313492bf0703b49ed715ffe2059f477ee11637c44b3d6` |
| `server/gcsp/offers/current-car-comparison.js` | `c5aaf8b2e3123301d50f3dade21e89e4f88abf12ede4e2c7ed801adbc56099cd` |
| `server/gcsp/offers/buddy-remote.js` | `0284045ab38c22c305019ad4a560724aa233e830c6c37186d5661da430c59e01` |

This supersedes the initial `524294d` producer pin. Current-car 19/19 and freshly selected 193/193
boundaries pass at these identities; `parent-current-car-audit.json` verifies 35 clean manifests.
Normal publication recovered and remote readback matched `a7fc858`; the earlier GitHub rule failure
is historical. No product source changed for this proof, so those boundary checks were reused.
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

The selected four cases are those two directions for the same employee and a second genuine
employee. A concurrent-service race was not selected or run.

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


## Observed result and retained evidence

`server/test/gcsp-buddy-manual-services.proof.mjs` passes 4/4, zero skips, through the strict targeted
wrapper `python3 -I <shared-root>/.claude/test-runs/fucq100/manual66-stamp.py`. Its selected command is
`python3 -I <shared-root>/.claude/test-runs/fucq100/manual66-supervisor.py proof`. This explicit proof
variant supplies the two published modules absent from the branch’s ordinary test variant.

Each case uses a fresh real runtime, branded Paula/Alex identities, seeded manual context, confirmed
brief/consent and one synthetic exact F70 Sports Hatch|120 visible to both employees. That model key
is eligible under both actual grade rules and its assumed points fit both actual allowances. No
policy, identity, employee authority or manual implementation was changed to make the proof pass.

Manual-first uses the actual manual account, draft, browse-produced claimInput and claim. After its
cart hold/claim/quote succeeds, the buddy receives freshly observed revisions and refuses the exact
car, creating no offer/outbox. Both command replays remain stable. Buddy-first captures an initially
eligible actual manual claimInput, then creates the buddy hold/claim/quote/offer/outbox. The old manual
claim refuses; a newly saved actual draft/browse reports `not-available`, ineligible and null claimInput.
All authority rows remain unchanged after refusal/refresh/replay. Plaintext token remains only in the
outbox. Same-employee and distinct genuine employee cases pass in both directions.

The first launch failed in the strict loader before case execution; returning the validated exact
relative-import URL directly corrected that harness issue. The next run passed three cases, then
correctly refused the original 320i fixture for Alex’s G1-6 policy. Only the synthetic stock input was
corrected to the common permitted model key before rerunning all four. These were runner/fixture
corrections, not imported-service repairs; useful redacted failures remain in the shared records.

Retained under `<shared-root>/.claude/test-runs/fucq100/`:

- Proof receipt: `fucq100-manual66-P-4f8f44295a8c46a1ad3186cd41f89256-receipt.json`.
- Strict targeted evidence against published base `a7fc858`:
  `strict-manual66/targeted-c38f96f36c3b974bedf15925c845cd37f6315f6baaf20722e2b0931859acedaa-default-1793922225179113000.json`.
- Parent receipt: `parent-manual66-audit.json`; impact/import/fixture/environment map:
  `../impact/fucq100-manual-proof.json` (43 source entries).

Measured proof: 1.16 seconds, 194,363,392 B peak RSS, 77,824 B scratch. All six allocations from the
three proof/strict attempts are removed; the parent also rechecked all 35 earlier manifests (41 total).
Owned roots, process identities/groups and reservations are absent. Both pinned source copies match
before/after, all retained pg/jsdom device/inode/hash identities match, and the tested source graph
still matches. No listener, port, profile, browser, native database, network, full suite or large artifact
was allocated. Small plans, receipts and useful bounded failure logs remain locally.

The manual-exclusivity slice is complete as a source integration proof. Central registration/current-base
adoption, the paused allocator’s current-operation read consumer, and the authored integrated full/native
gates retain their separate owners and remain outstanding. This record does not mark FUCQ-100 built.
