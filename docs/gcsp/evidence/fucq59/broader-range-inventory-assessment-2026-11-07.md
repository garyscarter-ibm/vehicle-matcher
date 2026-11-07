# Wider BMW range inventory assessment — 7 November 2026

Status: offline assessment followed by parent-authorised minimal implementation in `g42-range-inventory-2026-11-07/`. The exact G42 three-GET allocation is prepared and unspent; none is released, and no additional source traffic has occurred. This is within the existing F58/F59 discovery lane; it does not change claimed acceptance criteria, publish catalogue data or create backlog scope.

## Smallest path

Introduce one distinct observation-only inventory registration and source version, then use the existing collection session for exactly three GETs: the literal seed page, its one discovered settings file, and one exact range tree query. Start with a separately reviewed allocation for one range. Retain the direct source facts needed to prepare existing strict options qualification; do not require an invented AG code or weaken model registration.

There is no zero-change route for unknown AG. `validateBmwModelRegistration` in `scripts/gcsp/bmw-public-registration.mjs` requires model/AG, raw range, complete aliases, RL and dates before either context or options qualification. `bmwPublicRequestUrls` needs only range/model seed and query dates for page/tree construction, but its validation also requires that full registration. The common executor in `scripts/gcsp/collection-session.mjs` permits only the registered versions and exact corresponding endpoint/query combinations. The previous `f70-range-shape-diagnostic-2026-11-07/diagnostic-source.mjs` first calls strict context qualification, so it also cannot discover unknown AG.

The minimum implementation touches the existing registration module, executor allowlist and source operations module, plus an evidence-local caller and focused tests. It needs no new transport, general discovery framework, collector/admission API, policy change, runtime dependency or publication change. Keep `validateBmwModelRegistration`, strict context qualification, explicit options-trim relationship validation and batch admission unchanged.

## Historical leads to corroborate

The parent supplied these BMW UK configurator links from a Parallel extract acquired **18 October 2026**. They are historical discovery leads, not current model registrations or proof of scheme coverage. The original extract was not independently fetched or revalidated during this assessment.

| Catalogue range query | Literal page model seed |
| --- | --- |
| G42 | 2PMC |
| G21 | T3PF |
| U11 | X1S0 |
| U10 | IXS4 |
| G26E | I4PC |
| I20 | IXSC |

Their page route form is `https://configure.bmw.co.uk/en_GB/configure/<range>/<seed>`. Existing retained 4 November iX deep-link observations provide a separate historical IXSC lead, but do not retain the full direct model/AG/date/alias facts this registration requires. Neither the historical G21 substitution record nor VIN samples may supply a guessed current AG, raw range or physical-production profile.

## Request scope and retained output

A new inventory request registration should contain only an exact schema/version, GB/en-GB, one catalogue range key, one page model seed and explicit tree effect/order query dates. These are **request inputs**, never claims about the returned vehicle. Pin the planned qualification day separately. Do not put AG, aliases, raw model range, trim, steering or candidate elements in the registration. The source URL builder constructs the two static routes; callers cannot pass arbitrary URLs. Settings remains restricted to one fresh `/en_GB/settings.<alphanumeric>.json` path on the configurator origin.

Use the intended corpus query dates explicitly; `2026-11-01` / `2026-11-01` are existing query inputs to consider, not inferred current model dates. A tree response may have different actual model dates. Preserve that distinction and do not automatically substitute dates, seeds or ranges or follow a new endpoint. Fresh HTTP observation time alone does not turn a query date into a current BMW catalogue claim.

Project only the requested range at every observed top-level alias, within finite alias/model/line/record/byte limits. Retain:

- Each direct `/<alias>/modelRanges/<range>/models/<key>` pointer and its safe, directly present `modelCode`, `agModelCode`, `modelRange`, `steering`, `orderDate` and `effectDate` values. Record absent or invalid fields explicitly. Check the model key against `modelCode`; do not promote a compact `defaultModel` reference to a full model record.
- The existing bounded optional model facts and missing-field information, only where directly present and safe. Preserve each alias appearance and conflicts; a complete alias set is established by exhaustive bounded inspection of this response, never by a first-match shortcut.
- Bounded direct line pointers, line `option`, default model/AG, included transmission variant model codes and same-response included trim-element membership. Retain source pointer/type/missing status. Do not infer an option class from a prefix or interpret every included variant as the line default.
- Executor-owned observation metadata, exact request, raw response digest/decoded byte count and sealed safe-projection bytes/digest. Keep page/settings metadata without their raw bodies or bootstrap values. The tree header stays only in the operation closure; inspect decoded projection keys/values for accidental inclusion before persistence.

Unknown fields and unrelated ranges, imagery, pricing, technical numeric subtrees, VINs and user/configuration identifiers are omitted or counted. A finite traversal or output ceiling stops the allocation rather than truncating an alias inventory and presenting it as complete. A missing seed/range, incompatible dates/steering or conflicting aliases remains an explicit observation/gap; it cannot become an admitted configuration.

## Capability, retention and proposed first release

Only `bmw-page`, `bmw-settings` and `bmw-model-tree` belong to the inventory version. The executor must reject options, solver, image, arbitrary route/query, changed range/seed and wrong registration versions before fetch. Register the inventory request in checkpoint identity. Strict JSON checks apply to tree/settings. Keep accepted/rejected/duplicate arrays empty and report zero admitted configurations, zero candidate/solver allowance and no acceptance.

Reuse the proven three-request lifecycle: one worker, no retries, fresh page/settings/tree bootstrap, primary retained from its first write, exclusive runner-owned once marker, parent exact release at runner and supervisor, child join and existing checkpoint export plus safe inventory export before scratch cleanup. After any partial HTTP attempt, a retained restart returns an interruption/refusal without replaying bootstrap. No saved application header or raw settings body is reusable evidence.

A proportionate **proposal**, to pin only after offline validation and independent parent review:

| Resource | Proposed ceiling |
| --- | --- |
| GETs | 3 total: page1/settings1/tree1 |
| Decoded bytes | 4 MiB aggregate; 1 MiB per response |
| Safe operation projection | 128 KiB maximum, fail closed |
| Time | 90 seconds source; 105 seconds child; 120 seconds supervisor |
| RAM / scratch | 512 MiB host; 448 MiB child; 64 MiB scratch |
| Parallelism / retries | One worker; zero retries |
| Solver / candidate / admission | Zero / zero / zero |

Use an owned absolute scratch root, external ownership manifest/reservation/finalizer and retained output directory, then freeze every executable, input and helper hash. Keep FUCQ-151/FUCQ-154 as separately prioritised Medium defects and preserve the existing manual reconciliation responsibility. Run one range first and inspect actual size/shape before allocating another; the six leads do not grant eighteen requests.

## Offline validation before any release

Use small synthetic tree fixtures for complete multi-alias inventory, conflicting/missing full records, direct default/included relationships, unsafe/unknown fields, header leakage, malformed/duplicate JSON, traversal/output limits and exact URL/registration mutations. Exercise the existing session with an injected fixture transport: exactly three requests, no options/solver port, executor-owned observation metadata, sealed retained bytes, checkpoint tamper refusal, durable partial-interruption and no replay. Verify no-grant runner/supervisor refusal with a fetch tripwire before marker/resource allocation.

Select the narrow new tests plus the shared session/context/options/batch boundary tests for affected registration/endpoint callers. Record changed paths, code/test identity, fixture/subprocess edges, observed timing and cleanup in the shared impact map. A full application suite, UI/browser proof, native SQL, source acceptance and publication tests are excluded because this bounded observation stage does not change those consumers. Reassess if implementation changes that boundary.

The assessment preceded implementation. The implemented inventory stage now has its own scoped validation and cleanup receipts under `g42-range-inventory-2026-11-07/capability-validation.json`; the earlier options results alone are not used as inventory proof.

## Gate after actual inventory

For a selected model, review the actual full model/AG/raw-range/steering/date facts, complete consistent aliases and explicit same-response line default/included/trim relationship. Those observed values may then prepare the existing four-GET options qualification, which freshly corroborates them before fetching typed definitions. Review the actual typed paint/fabric/rim definitions before a separately pinned finite solver allocation. Constructibility and novel canonical admission still require the existing strict binder and cumulative spent/canonical indexes. Historical links and inventory row counts add no configuration credit or scheme-eligibility/physical-production proof.
