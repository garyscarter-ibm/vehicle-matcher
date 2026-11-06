# Source qualification beyond the known sample — Implementation Plan

> For agentic workers: execute the reviewed plan task by task with `superpowers:executing-plans` in the existing claimed worktree. This planning chunk authorises no code, tests, descendants or requests. The dispatcher assigns the next implementation and shared-file lanes.

**Goal:** make source evidence qualify exact catalogue records through the existing F59/F39/F54 ports, while preserving unknowns and the complete F77 scheme coverage.

**Architecture:** extend validation/projection inside the existing collector/session and catalogue snapshot adapter. Keep its one accounting/cache/checkpoint path and versioned static corpus. No new runtime provider, component, store, dependency or connection is proposed; the normal design-first skill stops at unchanged topology. Any later live F39 provider or topology change requires its normal design review first. No browser/design-tab operation was performed in this planning chunk.

**Tech stack:** existing Node ES modules, native test runner, PolicyService and bounded JSON artifacts; no new dependency.

**Binding specification:** GCSP [build rules](../../../build-rules.md), [source authority](../../../fucq-58-source-authorisation-2026-11-05.md), [experience contract](../../../experience-quality.md), [technical readiness](../../../technical-readiness-2026-11-05.md), HLD page 06 and the frozen F58/F77 contracts identified in [plan.json](plan.json). The [historical route](../readiness-2026-11-06.md) already works and is not this plan's missing capability.

## Frozen basis and scope

F59 topic `f4c9697e5ee1eecf7cfbf288aae11e266c9f2c72` retains AEE source/test identity; current full evidence is 1,291 pass/five planned native skips. F58 owning qualification is `7aa6bee7d7da3b46d14cfe5a0becff93d0a029bd`; F77 inspected topic is `15a98d5f6c83f0c77ad7ca2950420c6826f5545c`. The machine-readable plan pins 24 owning source/evidence files and their absolute roots.

Own F59 producer qualification, not Scooby's F60 historical-consumer integration. F58's claim and source qualification remain intact; F77 owns its exact matrix mapping/verifier. The local F39 story DEV-016 is closed/merged at 5b30feb, but this is not proof that its shared files have no current writer. The dispatcher must allocate any edit to `server/vehicle-evidence/bmw-catalogue-adapter.js` and its snapshots before implementation. This chunk edits none of them and makes no Jira change.

Every HTTP 422 remains diagnostic rather than a child-only credit stop under current AGENTS.md. Preserve credentials/provider, existing claims and checkpoints. No descendants or source/browser/SQL/credential work is needed here.

## Concrete producer blockers

| Owning path | Actual limitation | Planned responsibility |
|---|---|---|
| `scripts/gcsp/public-bmw-source.mjs` | One T5MJ known seed, target one, exact 47 factory codes; only six model literals retained | Typed full-model and localisation projections plus explicit qualification report |
| `scripts/gcsp/collection-session.mjs` | Only the old source version and four pinned GET capabilities/routes | A reviewed version/capability for the missing-field diagnostic through the same executor, without arbitrary URL injection |
| `scripts/gcsp/collect-fleet.mjs` | Public validator requires `accepted`, `rejected` and `duplicates` empty and at most one observation | Explicit evidence-qualified acceptance path after exact F39 registration; retain incomplete observations separately |
| `server/vehicle-evidence/bmw-catalogue-adapter.js` | One registered sample; `validSnapshot` hardcodes 47 selected factory codes | Exact immutable registration and bounded per-snapshot code-set/count validation; retain every identity/date/selection/accessory guard |
| `server/gcsp/vehicle-evidence/corpus-publisher.js` | Closed dated-snapshot schema; no raw observation field | Reuse its existing exact F39 envelope and publication validation, with zero VINs and no runtime selection |
| F77 `scripts/gcsp/demo-plan.mjs` | All 74 mappings pending; exact-date artifact bytes/locator must verify | Producer supplies evidence, F77 verifies its complete plan; no permissive mapping callback or count shortcut |

The fixed 47 count is not a BMW rule: the retained 1 November towbar variant has 48 factory codes. Supporting another registered exact selection does not justify accepting arbitrary incomplete selections.

## Field contract and evidence gaps

Every qualified field needs an artifact SHA-256, exact JSON pointer or request-field locator, source observation date, context and confidence. A matching canonical ID does not bind dates, trim role or accessory quantity. Unknown values remain null with a reason; conflicting evidence refuses qualification.

| Field | Existing evidence | Required next evidence |
|---|---|---|
| VG/AG/ranges/order/effect | Fresh 6 November six-literal observation; stricter 5 November full 5/I selector | Reuse exact fresh selection, validate full current source projection and parent paths; retain catalogue key versus payload range and returned effect date |
| Model/engine/body | Rich 1 November model excerpt; fresh projection discards these fields | Direct current model-name/derivative/body/engine fields, then a reviewed exact matrix-to-source crosswalk; no generation or engine substitution |
| Tax date | 5 November retained T5MJ full nodes explicitly say 5 January 2027 | Capture the current direct field, or leave historical evidence historical |
| Catalogue production date | Only historical `prodDate: 20270105`; absent from retained fresh target projection | Direct explicit catalogue context, never effect-date arithmetic or a physical-build claim |
| Trim | Historical S0337; fresh request has mandatory S0337 | Explicit source trim-role/context; a query or mandatory input does not corroborate itself |
| Paint/upholstery classification | Historical `optionType` fabric/paint; fresh solver has only option/accessory | Exact dated model localisation definitions, with code/key equality and safe labels |
| Accessory quantity | Fresh SE000001 quantity null; historical white request/snapshot says one | An explicit positive integer for this exact selection/context; no default one, dropped accessory or transfer between paint/date variants |
| Physical production/model year/plant/VIN fitting/steering meaning | Unknown; RL is a source literal and no enabled G61 GB/RHD VIN profile exists | Preserve unknowns. F52/F58 profile evidence is separate before any delivered/current synthetic VIN use; do not substitute US/LHD profiles |

F39's `catalogueDate` equals the registered snapshot's `observedDate`. A newly qualified 6 November snapshot uses **6 November 2026** there. Its order/tree-request date may still be **1 November 2026**, and resolved model effect date **5 January 2027**. The current unqualified public plan's `context.catalogueDate: 2026-11-01` cannot silently become a fresh F39 snapshot identity. This distinction needs an explicit new source/plan version; the old snapshot stays unchanged.

## Implementation checkpoints

- [ ] **1. Pure field-evidence contract.** Add the proposed internal `scripts/gcsp/bmw-source-qualification.mjs` and focused test file. Verify actual pinned bytes and locators, separate request inputs from returned facts, and emit qualified/missing/conflicting fields. Test wrong hashes, absent locators, conflicting dates, unsupported trim role/quantity and same-ID promotion. Start with the 1/5/6 November retained records; this requires zero network. Retained black/towbar lists can establish distinct historical selections, but do not transplant the white pricing request's quantity or technical values to them.
- [ ] **2. Strict source projection.** Extend owning public-source descriptors and the existing session allowlist with the exact diagnostic below, under a new source version. Apply F58's full record/parent/equal-facts checks for groups 5/I. Retain optional typed model fields only when present. Keep credential values in closure memory and settings uncached. A missing required field still produces an unqualified observation, not an accepted row. Offline source fixtures remain synthetic.
- [ ] **3. Exact F39 registration.** After shared writer assignment and complete evidence, create one immutable allowlisted snapshot with explicit source/date/context and complete selected options/accessories. Replace the fixed sample count with its registered exact selection/count/hash and existing finite bounds. Preserve all exact lookup fields, unsupported-version/refusal behavior and no outbound/nearest-date fallback. Do not register a record while production/trim/quantity evidence is missing. An unknown numeric fact may stay unknown; unknown identity cannot be invented.
- [ ] **4. Qualified acceptance/publication seam.** Add an explicit public qualified path that consumes the verified field manifest and registered F39 envelope. Keep original candidate request, complete typed solver result and added/removed/ignored changes. Canonical identity still comes through PolicyService. Qualifying another date for the same factory selection adds zero distinct configurations. Stage through `writeCorpusCandidate`/`validateCorpusDirectory`, with no VIN or runtime activation. Give F60's owner the preserved contract; do not create its consumer or a second adapter here.

Each checkpoint is independently reviewable and uses narrow validation. Code readiness against these existing ports does not wait for Jira dependencies to finish; completion still requires the actual source and integration evidence.

## Proposed next request chunk — not admitted

Exactly **four GET attempts**, one each: existing public G61E/T5MJ page, its single discovered settings file, the exact existing G61E tree and the researched dated T5MJ option-localisation URL. The request array, exact URLs, fields and locators are in `plan.json`. **No solver request is proposed:** the consumed 6 November seed is not refreshed.

The purpose is new field coverage: direct model/engine/body/tax-date context omitted by the old projection, and dated option classes via `settingsLocalisation`. Search only explicit source fields for production date/trim role; absent fields stay unknown. The localisation query's `trim=S0337` remains an input. This chunk has no credible promise of accessory quantity, physical build, new constructibility, complete F39 qualification or a new accepted configuration. Stop with a useful field-gap report rather than append unplanned endpoints.

Known prior decoded sizes for these four routes sum to 916,858 bytes. Proposed caps: **four attempts, one worker, zero retries, 1 MiB per response, 2 MiB total, 10 seconds per complete request, 45 seconds absolute wall time, zero images/browser/writes**. Use no-store, omitted credentials and manual redirect refusal. Exact settings profile ambiguity, changed model/date/group/classification or 401/403/429 stops durably. Count consumed bytes before retention, cancel/join timeout work and preserve absolute allowance on resume; lost memory-only bootstrap cannot replenish it.

Before any request: dispatcher admits a new allocation, executable/input/source pins freeze, offline safety checks pass and an exclusive once marker is recorded. Link the allocation to the combined 3,000-attempt F77 ceiling; an old consumed marker or a new stage does not grant more requests. If the actual observation date changes, explicitly repin the qualification date rather than relabel historical evidence. Existing source/retention authority stands; there is no renewed human permission question and currently zero new allocation.

## Selected validation and resources

Planning now uses only static JSON/link/hash/schema and diff checks. Proposed implementation checks:

```sh
node --test --test-concurrency=1 server/test/gcsp-bmw-source-qualification.test.js
node --test --test-concurrency=1 server/test/gcsp-fleet-collector.test.js server/test/bmw-catalogue-adapter.test.js server/test/gcsp-vin-publication.test.js
```

After coordinated F77 integration, use its owning `gcsp-demo-plan.test.js` and `gcsp-demo-verifier.test.js`; those modules are not present in this branch and must not be copied as a parallel producer. The current full evidence is reused for identical unchanged code only. No full suite or native SQL is selected here.

Test the actual boundaries: unknown/malformed identity, registered 47 versus 48 factory sets, reordered/alias/accessory/date duplicates, unsupported snapshot/no fallback, unsafe route/query/header/method refusal before an attempt, cumulative options-stage accounting, cancellation/join, durable stops, incompatible resume, fixture provenance and exact F39/F54 staged publication. F77's pending complete plan must remain incomplete; fixtures do not become real collection or current mappings.

Before later tests, record selected identity/edges and an external ownership manifest before the root. Register the supervisor finalizer first, propagate TMPDIR/TMP/TEMP and use one worker, 64 MiB scratch/384 MiB RAM/120 seconds per narrow chunk, 1 MiB bounded logs. Count actual host jobs manually alongside HostBudget: the parent proved locale-sensitive `ps` start formatting, but the actor removing the earlier live ledger entry remains unproven. Do not claim continuous charging without evidence. Stop/join exact children, remove verified owned scratch/overlays/bytecode and keep concise summaries/failure evidence. All Python uses `-I -B` or `PYTHONDONTWRITEBYTECODE=1`. No large allocation is expected; any output expected at 256 MiB goes directly to the required OneDrive root.

## Coverage and handoff

F77 retains **all 74 model-and-engine entries**. It needs at least **eight distinct configurations per mapped entry** and **200 overall**, hence **592 if all 74 are mapped**, plus 20 real exact deep-link checks, facts/images and publication/lookup reconciliation. Do not prune mappings, infer an engine prefix or exclude a model from an empty/partial tree. Qualification discovery may progress one entry at a time while full-plan collection readiness stays false. A complete ready plan is still required before the bulk demo collection path.

The exact G61 `i5 40` entry is separate from G61 `i5 M60` and G61 Touring `530e`; the six F70 candidates do not establish the exact 120/M135 mapping. A current field probe adds no configurations. VIN-profile/WMI work stays distinct from configuration-only publication; no VIN generation is proposed. FUCQ-61 remains held until 13 November.

Next dispatcher action: allocate offline checkpoints 1–2, coordinate the F39 writer and F58/F77 interfaces, then review this exact four-request missing-field diagnostic after safety proof and frozen pins. F60's historical consumer can continue independently. Source calls, code changes, tests and scratch allocated in this planning chunk: **zero**.
