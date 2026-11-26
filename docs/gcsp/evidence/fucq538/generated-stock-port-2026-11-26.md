# FUCQ-538 native generated stock

Status: native implementation, scoped validation and independent risk review complete; required canonical Java CI, dispatcher batch and human acceptance remain pending. The original two acceptance items remain open for that handoff. Story: `DEV-2026-11-22-vesper-014`, 13 points, branch `dev/DEV-2026-11-22-vesper-014`. Native observation supplied by the root: In Progress, Russell, 13 points, Story, parent FUCQ-433, updated 26 November 2026 08:01:29.625 UTC; original body and both acceptance items unchanged.

## Contract and plan

AC1 adds the generated/run-stock source to Java selection and makes selected Main preparation and its real tick release use the generated tranche. AC2 requires exact same-input Node stock, replay, stale/unavailable and restart behaviour, including F229 horizon anchoring, F231 expiry and F310 unbound planning. No provider-only closure, runtime Node invocation, derived-output seeding, new BMW collection or silent generated-to-demo fallback is allowed. Existing none/demo/tranche choices, explicit published-demo scenarios and confirmed Production priority remain supported.

The compact data delta is in `docs/gcsp/shared-contracts.md`, “Native generated stock · FUCQ-538”. Strategy remains specified PostgreSQL 17 and existing application services. Reuse `stock_cars`, immutable command receipts, run revision and the release transaction. An environment-scoped transaction lock protects cross-run native generated identity allocation; complete generation, stock rows and its report commit atomically. Release remains a separate command, so preparation cannot produce released stock, holds or offers. Existing receipt/active-run guards own replay, conflicts and reset isolation.

`design_impact: no`: this is internal work in the existing Java application using existing PostgreSQL and immutable artifact connections. No service, store, queue, CLI or connection is added. The existing HLD Java/artifact/PostgreSQL responsibilities were inspected locally. The required draw.io wrapper preflight was attempted; the OpenTabs extension reported “Extension not connected”. No tab, foreground app, diagram or plugin configuration was changed; that unavailable inspection does not establish a diagram update.

The durable product-map plan has five stable slices, including final integration and validation:

1. `contract`: verified retained inputs and the durable generation contract.
2. `generation`: native deterministic engine, retained plan/facts, qualification and offline Node oracle.
3. `durability`: atomic generation/replay, retained identity allocation and generated pull adapter.
4. `main-integration`: Main preparation, real clock/tick/release and allocation.
5. `validation-review`: same-input parity, expiry/horizon/unbound regressions, native concurrency/restart, scoped callers and covering review.

File ownership: Emmet owns new pure `GeneratedStockGenerator` helpers and its tests; Daffy Duck owns `GeneratedStockInputs`, exact browse-fact port, its tests and minimal offline supply-oracle extension. Pugh owns selection, durable generation/provider, Main/ScenarioWiring integration, exact HTTP tests, shared contract, card/map and this result. Any write outside these boundaries is coordinated first. `offers/**`, F542 and all peer work stay protected.

Agents requested/selected: Pugh `gpt-6.1-sol/high`; Emmet and Daffy Duck `gpt-6.1-sol/medium`; no fallback. Both child cartoon titles were verified by their native title calls. No grandchildren are authorised for their current slices.

## Source qualification

Retained dataset `gcsp-demo-fleet`, version `2026-11-08.1`, schema `2`, qualification `bounded-fixture-or-partial-corpus`:

| Artifact | Rows | Bytes | SHA-256 |
|---|---:|---:|---|
| Manifest | — | retained source | `7c9cc707ab44b36f9cb5eb64b54170b25d914d5ee7e31722384c737612c45a9c` |
| Configurations | 240 | 4,530,504 | `8e855b0d9f94c7deae99243a94145eb3f0628ae6d1243c8b10e023c62a8e05f3` |
| Images | 2 | 1,410 | `eb04f0dca3046b045dd000ef4312eabc3d4b9af59b141cb0bd0e26a32230588a` |
| VIN mappings | 0 | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

Observed source classification gives 154 usable and 142 selected configurations after the existing label and eight-per-colour rules; all 24 AG codes have current eligibility mappings. This inspection result is not executed generator parity. No OneDrive location was read, checked or written.

## Validation scope and observations

Run pure Node reference checks sequentially, then Java supply/scenario owning packages, exact Main/presenter integration and direct changed-contract planning/recommendation/Production callers. Inspect the affected selector; do not execute its unrelated full-suite fallback. Include the AGENTS startup/wiring selection once. A changed test profile is named as the full-Java trigger for the root's final canonical CI; other full suites remain dispatcher-batch work. No UI layout or control is added; the affected presentation contract is the existing Main facts, availability and refusal behaviour.

All native PostgreSQL and JVM work uses the shared test stack, one heavy slot, 3 GiB daytime maximum and 600-second supervised chunks. External ownership manifest and supervisor finalizer precede scratch allocation; TMP paths are owned local directories. Target scratch is below 2 GiB; indivisible larger work belongs in CI/overnight without changing the product or acceptance. Root owns final covering review/rerun and native status; no Done or human acceptance is implied.

Observed RED, `red-selection-inputs`: 11 tests, three expected failures, zero errors/skips. Selection rejects unknown `generated-stock`; the loader stub cannot produce the retained plan or guarantee refusal. Wall 10.19 seconds, peak RSS 801,226,752 bytes. Scratch and test databases were verified absent; owned Maven target is retained for subsequent focused compilation and final teardown. Logs and resource receipts are under `/Users/usget/Claude/vehicle-matcher/.claude/poller/velko-f538-20261126`.

The executed final evidence below supersedes the early pending implementation observations; canonical CI and dispatcher acceptance remain pending.

### First verified implementation checkpoint

Parent read the complete retained-input/fact helpers and offline-oracle diff. Loader five-case GREEN includes the independent Node request oracle: all pins/plan/assumptions, all 142 complete configuration digests, 59 Main qualifiers, exact browse facts and strict completeness types. The Node oracle generated 500 complete cars; all three commands passed in 8.65 seconds, peak RSS 538,951,680 bytes and owned scratch 50,237,440 bytes; all full outputs and scratch were removed. Pure native generation subsequently matched all 500 Node rows, complete report and allocation inventory; four focused variants passed horizon, guarantee substitutions, retained identity collisions and unchanged reuse. Native PostgreSQL preparation/rollback/source-absent replay passed two cases. Main signed-OIDC/PostgreSQL HTTP passed five cases, including actual generated release, Paula offer/notification and interrupted preparation recovery; two generated-window clock tests also passed. These observations do not complete pending concurrency, ordinary-process restart, direct caller and final review work.

The first Java supervisors propagated TMP environment variables but did not pin `java.io.tmpdir`; their scratch peaks therefore do not establish JVM-temporary allocation. The supervisor now sets `JAVA_TOOL_OPTIONS=-Djava.io.tmpdir=<owned root>`; subsequent runs measured and removed the real 38–122 MiB JVM/oracle working set. JUnit default cleanup applied to the earlier temporary directories; no broad search or deletion was attempted.


### Native engine and durability checkpoint

All six independent Node-output oracle tests passed after two observed numeric regressions were repaired: safe-integer aggregate counts retain their full value, and guarantees above the integer range are refused before narrowing. Each successful comparison checks the complete rows, report and inventory, including Main's 500 cars, F229 horizon anchoring, guarantee substitutions, retained collisions and unchanged reuse. The oracle group took 32.94 seconds within the supervised `durability-red` chunk; the remaining expected expiry-record failure and test-harness errors in that chunk are not hidden by that group result.

The final focused durability/provider chunk passed 11/11 with zero failure, error or skip in 26.38 seconds. It covers atomic batch insert/rollback, source-absent replay, changed-clock conflict, two simultaneous independent instances (one commit), different-input racing conflict, stale retired-run refusal, unavailable-source refusal, confirmed Production priority, exact expiry equality/window offsets and sorted immutable expired-ID recording/reconstruction. Ordinary restart is proved by two sequential independent JVMs: the first generates against PostgreSQL; the second has an absent corpus path and recovers the same complete row/report/pull digests and expired IDs from the receipt and retained stock. No Java application runtime invokes Node. The restart test's first 256 MiB child exhausted its heap during JSON batch binding; the test child now uses 512 MiB and passed within the unchanged 3 GiB process-group budget. The stale-run fixture was corrected to include the schema-required retirement timestamp.

`durability-green.json` records peak RSS 2,336,423,936 bytes, scratch 110,912 bytes, and verified removal of owned scratch and both test databases. Earlier complete-oracle scratch was 128,266,752 bytes. Maven target remains owned and retained until final validation/teardown. Doug the Dog's independent read-only risk review is running, requested/selected `gpt-6.1-sol/high`, no fallback. Final direct callers, refreshed-base proof, final result and root canonical Java CI remain pending.


## Final scoped evidence and handoff

The branch refreshed cleanly to integration `7b84c3482` in merge `a9e9aa8da`; all six F542 source/test files are unchanged relative to its merge `8bee4b3c`. The final source delta moves an observed wide-JSON SQL sort into an equivalent Java reference sort. Doug the Dog independently reviewed the complete source at `f63b8783a` and then this exact two-file delta: **PASS — no blocking or major issues found**. Parent read the child diffs and ran the covering checks. Requested/selected reviewer model/effort `gpt-6.1-sol/high`, no fallback; native cartoon title verified. No reviewer test, file or database writes occurred.

| Final selection | Result | Wall | Peak supervised group RSS | Peak owned scratch |
|---|---|---:|---:|---:|
| Complete supply/scenario owning packages (`final-owned.json`) | 133/133, zero skips | 109.25 s | 3,035,938,816 B | 128,613,664 B |
| Exact changed-contract callers and final preparation/provider (`final-callers.json`) | 104/104, zero skips | 85.86 s | 3,157,393,408 B | 21,927,360 B |
| AGENTS startup/wiring selection (`final-startup.json`) | 56/56, zero skips | 17.44 s | 1,468,530,688 B | 368,352 B |
| Three original Node generator/run-stock/history files, native PostgreSQL enabled (`final-node-ready.json`) | 44/44, zero skips | 13.56 s | 647,036,928 B | 12,764,224 B |

Each final selection had zero failures/errors. The caller chunk includes all 38 RunClock cases, 12 presenter-clock cases, five real signed-OIDC Main cases, native F310 planning tests and Greg planning HTTP, Node-produced planning/service parity, 628 recommendation evaluation cases (230,555 numeric comparisons, maximum difference 0, 4,976 assumption digests), recommendation HTTP and real Production planning composition. The 11 preparation/provider cases reran after the query change, including atomic races/rollback, full stock reconstruction, expiry and the two independent JVM restart. The 133 owning-package cases include all six full independent Node generator oracles and five loader cases. This is scoped evidence, not a full-suite claim.

**AC1 evidence:** explicit `generated-stock` selection, actual retained-corpus native preparation with no released cars/holds/offers, and Main's real signed-OIDC `next-release` tick promotes generated source `stock-generator.v1:<policy>` through release, buddy allocation and Paula's active offer/captured notification. Existing none/demo/tranche choices, explicit published-demo scenarios, confirmed Production priority and explicit named-time controls remain supported. No runtime Node execution or derived-output seed is used.

**AC2 evidence:** independent actual Node output equality checks complete exact rows/report/inventory for pinned Main and variants; native PostgreSQL proves same-input replay without a source, changed-input conflicts and one atomic commit under competing instances. Retired runs and missing generated input refuse without demo fallback. F229 deliveries anchor beyond the complete horizon. F231 omission includes availability equality and preserves tranche offsets/known released cars; Node `generated-provider.js:24,31,49–59` records IDs only in its in-memory Set, and Java matches that model and reconstructs after the next pull following restart. F310's native planning caller omits and reports unbound configuration stock. Two actual JVMs prove ordinary restart from committed receipt/stock with an absent source, preserving row/report/pull digests and reconstructed expired IDs.

**Native cost evidence:** 500 generated cars occupied 24,404,266 bytes as complete generated JSON and 25,802,836 bytes as stored attributes. A single batch insert/receipt transaction generated the fixture in 1,604 ms. Selected allocation projection: 500 actual rows, one loop, 22.417 ms. Current-run complete projection: 500 rows, one index-scan loop, 75.389 ms, zero temporary blocks. The first plan exposed a 25,520 KiB external merge on wide JSON (112.036 ms); sorting Java references after the unchanged complete read removed that spill. These measurements qualify the local 500-car case only; no hosted/growth bound is inferred, no cap or schema/index gate was added, and retained-environment allocation continues to inspect its complete identity inventory.

**Selection/limitations:** `_tools/test_stamp.py --affected <claim> --dry-run` reported no affected-test plug-in for the unspecified language and proposed `npm test`; that unrelated fallback was reviewed and not run. Explicit ownership, fixture/configuration/subprocess and caller edges are recorded in the shared `.Codex/test-runs/impact/` map, keyed by final code/test identity. Java dynamic per-test coverage contexts are unavailable. The first two Node attempts could not import `pg`; the root package cache was insufficient because `pg` belongs to `server/package-lock.json`. The shared server cache was then linked and all 44 cases passed with a fresh owned PostgreSQL database; both owned links were removed. No production dependency, lockfile or framework change was needed. The RunClock replay assertion now compares full canonical JSON because PostgreSQL reparsing changes numeric node classes without changing values; no semantic assertion was dropped.

**Cleanup:** `cleanup.json` verifies all 19 run-owned receipt scratch roots and test process groups absent, owned test databases absent, owned dependency links removed and the initially absent Maven target removed (31,369,180 bytes). Shared PostgreSQL/cache/source/worktree are preserved. Retained output is bounded logs, small oracle summaries, resource receipts and supervisors in `/Users/usget/Claude/vehicle-matcher/.claude/poller/velko-f538-20261126`. No OneDrive path was accessed. The supervisor applies one heavy slot, 600-second chunks, 2 GiB scratch and 3 GiB Java group maximum; the final maximum observed group RSS stayed below that bound. Early Java temporary-directory measurement limitations remain disclosed above.

**Remaining root-owned gates:** canonical full Java CI is required because Main's Quarkus test profile changed; root will run it once on the final branch. Other full suites belong to the shared dispatcher batch, including the 18-family browser CI on the integrated head. No new UI layout/control was introduced; real Main/presenter/fact HTTP contracts were validated, with no new screenshot acceptance claim. Story remains native In Progress and the original acceptance boxes remain unchecked; no Done/human acceptance is claimed.
