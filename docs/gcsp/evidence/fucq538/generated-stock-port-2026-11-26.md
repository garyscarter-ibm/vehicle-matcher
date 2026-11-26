# FUCQ-538 native generated stock

Status: implementation in progress; original two acceptance items remain open. Story: `DEV-2026-11-22-vesper-014`, 13 points, branch `dev/DEV-2026-11-22-vesper-014`. Native observation supplied by the root: In Progress, Russell, 13 points, Story, parent FUCQ-433, updated 26 November 2026 08:01:29.625 UTC; original body and both acceptance items unchanged.

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

Acceptance parity, positive HTTP, restart, concurrency, final scoped checks and independent risk review remain pending.

### First verified implementation checkpoint

Parent read the complete retained-input/fact helpers and offline-oracle diff. Loader five-case GREEN includes the independent Node request oracle: all pins/plan/assumptions, all 142 complete configuration digests, 59 Main qualifiers, exact browse facts and strict completeness types. The Node oracle generated 500 complete cars; all three commands passed in 8.65 seconds, peak RSS 538,951,680 bytes and owned scratch 50,237,440 bytes; all full outputs and scratch were removed. Pure native generation subsequently matched all 500 Node rows, complete report and allocation inventory; four focused variants passed horizon, guarantee substitutions, retained identity collisions and unchanged reuse. Native PostgreSQL preparation/rollback/source-absent replay passed two cases. Main signed-OIDC/PostgreSQL HTTP passed five cases, including actual generated release, Paula offer/notification and interrupted preparation recovery; two generated-window clock tests also passed. These observations do not complete pending concurrency, ordinary-process restart, direct caller and final review work.

The first Java supervisors propagated TMP environment variables but did not pin `java.io.tmpdir`; their scratch peaks therefore do not establish JVM-temporary allocation. The supervisor now sets `JAVA_TOOL_OPTIONS=-Djava.io.tmpdir=<owned root>`; subsequent runs measured and removed the real 38–122 MiB JVM/oracle working set. JUnit default cleanup applied to the earlier temporary directories; no broad search or deletion was attempted.
