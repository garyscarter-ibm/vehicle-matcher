# F69 history and blocked Back component proposal · 6 November 2026

State: **authoring freeze for dispatcher review; no execution grant**. Neither the new component test nor this supervisor has been imported, syntax-checked or executed. This proposal validates the two changed gallery leaves at product checkpoint `0fa03f5eaced52eea7dbb8e3628a0a34318c8f41`. The JSON catalogue is the authoritative finite list; the caller must supply its reviewed SHA-256 as well as the dispatcher's specific grant. Publishing this plan grants no execution.

## Selected boundary

The only test root is `server/test/gcsp-manual-gallery-history-back.test.js`. The static import closure contains 17 JavaScript modules and 29 literal import edges, including the literal dynamic mount import after JSDOM globals. It reaches the existing claim/gallery controllers, account view/adapter, employee shell/fixtures, shared controls, card and UI helpers. Two emitted asset URLs are catalogued and copied: the BMW hero image and `bmwgroup-bmw-mini.svg`. JSDOM is constructed without external-resource loading or script execution; these assets are not browser/render acceptance evidence. Existing employee fixture imports are real import edges even when their representative screen is not mounted. No CSS, font, backend, runtime, actual F92 producer, F70 review or host module is imported.

| Changed behavior | Selected regression/boundary evidence |
| --- | --- |
| `gallery-model.js`: optional typed history is independent of current stock eligibility and controls | Exact selections and `claimInput` unchanged; search/ineligibility/history isolation; employee-relative none-visible; absent and malformed metadata; wrong run and unavailable envelope |
| `gcsp-manual-gallery.js`: visible history and current source uncertainty | Actual mount renders visible counts/latest UTC demo time/current-version-unknown; search leaves history intact; none-visible copy and absent-region behavior |
| Same mount: visible, explained, currently guarded Back | Deferred initial authority, explicit Review/one POST, pending, unavailable/uncertain and matching terminal read; disabled synthetic dispatch; callback/event counts; read-only compatibility |

Exactly four top-level tests, in source order, must appear in the original named TAP:

1. `visible release history survives filters and current ineligibility without changing exact selections`
2. `none-visible stays employee-relative and missing or invalid history never becomes a zero-history fact`
3. `rendered history shows visible past releases and unknown current version independently of search`
4. `Back stays visible explained and guarded through claim checks until the matching terminal read`

Expected totals: tests/pass = 4/4; suites/fail/cancelled/skipped/todo = 0. No name filter, empty selection, skipped case, extra test, silent cancellation or missing original total qualifies. This new explicit scoped selection follows the changed functions and their affected mount/controller boundary. No measured coverage is claimed. The affected-test selector, syntax checks and all broader tests remain unexecuted pending the review/grant; no full-suite fallback is proposed.

## Exact inputs and ordinary module resolution

`history-back-closure.json` pins each source/config/helper SHA-256, byte size, mode, device and inode; the source rows are independently matched to the published checkpoint's Git blob IDs during static catalogue authoring. Root/server `package.json` provide the original ESM package scopes. Own/root installed lock/manifests and scaffolding config are guards, not extra test roots. The new supervisor and this plan are guards authored after the product checkpoint. It verifies itself, tools, source, installed packages and the externally supplied closure digest **before importing `_tools/test_resources.py`**. No Git helper or Git subprocess is needed during the proposed run.

The installed JSDOM 30.0.1 closure is read from `/Users/garycarter/Code/GitHub/vehicle-matcher/node_modules`. Its declared runtime, optional and peer edges are resolved by normal package ancestry without running Node or package code: **38 installed packages, 59 dependency/peer edges, 1,833 regular files, 22,361,356 logical bytes**. Every file in each selected package is included because CJS, generated bindings, JSON and dynamic internal reads make a narrower filename-only guess unsafe. Package development dependencies and unrelated installation packages are excluded. The existing nested `data-urls/node_modules/whatwg-url` 16.0.1 remains nested, distinct from root `whatwg-url` 17.1.0. Directory identities, exact file membership, file identities, original manifests/locks and all searched dependency candidates are frozen and checked before/after.

Two optional peers are absent in the existing installation: JSDOM's `canvas` and `@exodus/bytes`'s `@noble/hashes`. Their searched candidate paths and absence are explicit. No native canvas or other `.node` add-on is in the copied list. The helper does not install packages, run lifecycle scripts, build dependencies, create checkout dependency links, or use a custom loader. It copies the approved package files preserving paths into scratch `node_modules`. It refuses any ancestor `node_modules` above scratch, uses a scratch HOME, and invokes `--no-global-search-paths` so CJS cannot fall back to an unrelated global installation. Every copied byte is checked again before launch and after execution. This pins selected user-space inputs; it does not assert an exhaustive hash of macOS libraries or the Python standard library.

Frozen tools: `/usr/bin/python3` (3.9.6 exact `sys.version` in JSON), `/opt/homebrew/bin/node` (resolved installation `node/26.5.0/bin/node`, binary SHA-256), `/bin/ps` and `/usr/sbin/lsof`, plus `_tools/test_resources.py`. No version command, Node import or helper syntax probe is used to author this freeze. The plan records ordinary executable target identities, rather than assuming a PATH lookup selects the same runtime.

## Proposed invocation and resource ownership

After exact dispatcher review and a separate specific grant, the only launch is:

```text
/usr/bin/python3 -I -B -S docs/gcsp/evidence/fucq69/history-back-supervisor.py --dispatcher-grant GRANT --expected-closure-sha256 REVIEWED_SHA256
```

The helper's only product command, from its materialized scratch root, is:

```text
/opt/homebrew/bin/node --no-global-search-paths --max-old-space-size=512 --test --test-concurrency=1 --test-reporter=tap server/test/gcsp-manual-gallery-history-back.test.js
```

One Node test worker/concurrency slot; Node's test runner may own a child in its dedicated session. Budget: 120 seconds for preparation (including initial verification), a separate 120-second execution deadline, 768 MiB sampled aggregate RSS including supervisor/recursive children/probes, 128 MiB combined allocated scratch and retained records, and 2 MiB original combined stdout/stderr. Request 768 MiB RAM/128 MiB disk; admit a reduced reservation only above 512 MiB RAM/48 MiB disk and enforce the actual granted limits. Estimated source/dependency copies are under 48 MiB allocated; actual measurements decide. The full 2 MiB log counts toward combined disk. No allocation is expected to approach 256 MiB; no archive or OneDrive compatibility exception is proposed. A failed indivisible four-case chunk is incomplete and requires a reviewed replan, not an automatic rerun.

Use a strict machine-wide HostBudget registry at `~/.cache/agent-scaffolding/test-resources`. Malformed/unknown registry state, unknown available memory, changed source/dependency membership, unsafe dependency fallback, cancellation or uncertain process telemetry fails admission or the run. The registry lock is short-lived; no test executes under a Git mutex. Reject inherited parent reservations for this top-level proposal. Preserve all foreign reservations.

Before scratch is created, write an external ownership manifest and incomplete checkpoint in the shared ignored `.claude/test-runs/fucq69-history-back/history-back-<token>/` record directory. Scratch is a unique `/private/tmp/test-stamp-shard-<token>`. Child environment is a clean literal whitelist: PATH `/usr/bin:/bin`, C locale, UTC, scratch HOME, scratch-owned TMPDIR/TMP/TEMP, color disabled and the owned reservation token. No inherited DB/PG aliases, NODE_OPTIONS/NODE_PATH, debugger, coverage, preloads, browser, credentials or service configuration reaches Node. This component fixture run allocates no listener, browser/profile/port, database or network service. The supervisor is a reviewed execution contract, not a native sandbox.

Track recursive PID/start/group ownership; include supervisor and live owned/probe RSS; sample combined allocated disk. Mask SIGINT/SIGTERM across child creation, local-handle assignment and initial durable group/PID/start registration; the installed handlers only set cancellation. Require a single-threaded supervisor and restore the child's prior mask in a minimal pre-exec hook, so Node does not inherit the temporary blocked signals. An enclosing finalizer also adopts/stops/joins an existing local handle if registration/persistence raises, and absence checks always include that handle and original group even with an empty ledger. This addresses the dispatcher's shared creation→registration cancellation-gap finding by source review; no injected-signal reproduction is claimed. On all handled exits, stop/join owned groups, require known process/group absence and an empty successful `lsof +D` probe before deleting the inode-verified owned scratch. Unknown cleanup leaves the named root/reservation and an incomplete receipt. SIGKILL recovery is a separate manifest-based parent reconciliation; never delete by a broad glob. The original TAP is streamed to retained `test.tap`, never scrubbed into a fabricated success transcript. Overflow retains only a bounded prefix and explicitly fails; interrupted/undrained capture is incomplete. Record preparation, execution/stop, verification, cleanup and total wall separately; claim no unsupported strict total preparation measurement.

Retain `plan.json`, `ownership/<token>.json`, `checkpoint.json`, `test.tap` and `receipt.json`. The receipt must include exact names/totals, original bytes/hash/capture completeness, source/dependency/copy before/after identities, sampled aggregate RSS/combined disk, all process/group identities and scratch/reservation absence. The parent must independently parse the original TAP, recheck frozen inputs/copy receipt and audit process/group/manifest/root/reservation absence. The helper's own report is not that independent receipt. Update the compact impact record during the granted run without another coverage or full-suite run.

## Evidence deliberately left open

These are controlled component fixtures, not an actual producer/host/HTTP/protocol proof. The accepted actual released-read 9/9 and F70 six-case boundary remain at their original inputs; the old frontend 131/131 and desktop smoke apply only to their original frontend hashes. None are rerun here. F100 is sole writer of setup/journey/runtime/server; its external `6ef6c5f` product and `7238bec` updated plan are not adopted by this closure. Actual gallery→claim→authoritative readback→F70, run/reset/provider delivery, desktop/320px/keyboard/recovery matrices, native/live-source and serial full acceptance stay open. No Jira lifecycle, claim, foreign product-map row or acceptance checkbox is changed by publishing this proposal.
