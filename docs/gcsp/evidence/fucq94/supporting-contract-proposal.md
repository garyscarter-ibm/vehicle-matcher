# FUCQ-94 minimum supporting contract proposal

5 November 2026. The dispatcher reviewed and released these exact supporting backend paths, the conditional controller change and one implementer after FUCQ-95 froze backend commit `1bcea40338c8d1f1464f963fae831c4b0fb38784`. No new component, service deployment, datastore, provider authority or framework is proposed. FUCQ-95 is unmerged here: do not copy its code/tests or claim combined route continuity until integration.

## Exact proposed paths

| Path | Change and reason |
|---|---|
| `server/gcsp/brief/editor.js` (new) | Read-only `createBriefEditorService({ brief, account, provider, policy, clock, identity })`, exposing `readEditor(context)` and `previewDraft(context, input)`. Existing BriefService owns reads/versions/writes; the existing manual account service and recommendation provider own facts. |
| `server/gcsp/brief/http.js` | Add `GET /api/gcsp/brief/editor` and `POST /api/gcsp/brief/preview`, employee role, no-store and existing trusted origin/session/run gate. Retain all FUCQ-91/FUCQ-95 routes and signatures; an optional second editor-service argument is additive. Missing configuration is unavailable. |
| `server/gcsp/recommendation/index.js` | Add a trusted server-only unsaved-preview entry on the existing recommendation service, sharing its complete candidate evaluation. Keep the existing `recommend(context, body)` and public recommendations route strict and compatible. No independent scoring or capped candidate sample. |
| `server/scenarios/employee/index.js` | Extract reusable brief-content validation from approved-version validation if needed by the unsaved entry; permit an explicit empty equipment list as a confirmed no-required-equipment answer. Existing `includes` gate already evaluates an empty requirement truthfully. The direct approved recommendation request still requires a positive brief version. |
| `server/gcsp/policy/seed-v1.json` | Add the single labelled assumed `brief.editor.v1` presentation/input entry: registered practical question mappings and initial draft control positions/importance. Existing dimension definitions, ranges, enums and charging vocabulary remain authoritative. No browser default table or copied tuning. These defaults remain draft/unconfirmed until employee action/Save and never drive a hold. |
| `server/index.js` | One serial composition seam: pass an injected editor service into the brief route factory. Preserve FUCQ-95's activity wiring and every existing route; no automatic provider fallback. |
| `docs/gcsp/shared-contracts.md` | Add accepted editor/preview/explicit-negative semantics, canonical assumption key, version provenance and unchanged approved-route boundary. |
| `server/test/gcsp-brief-editor.test.js` (new) | Execute context and preview services plus guarded HTTP against the real FUCQ-29/FUCQ-91 services with small synthetic input and canonical PolicyService; no recorded winner responses. |
| `blocks/gcsp/brief/brief-controller.js` and its dedicated new regression | Only if necessary to admit the accepted empty equipment-list no answer. These remain FUCQ-94-owned paths, not shared kit. |

Existing `gcsp-brief.test.js`, `employee-recommendation-api.test.js`, `gcsp-policy-service.test.js` and `gcsp-brief-controller.test.js` are selected boundary checks, not blanket edit allocations. New snapshot fixtures should be unnecessary. No UI, shared controls, catalogue/gallery or ratchet work enters this backend slice.

## Read contract

`GET /brief/editor` returns the standard typed envelope. On success, `value.context` matches the controller input: canonical `preferences`, `essentials`, `slider`, sourced `knownFacts` and explicit `permissions`, with policy/context versions and assumption provenance alongside. Expose only control definition fields; do not send employee tuning or use a second registry.

`value.initial` contains the editable FUCQ-91 fields, current approved version (zero if absent), current persisted draft version (zero if absent), and independently saved consent. Prefer a current matching draft; otherwise project the approved brief; otherwise use the canonical editor draft defaults. A stale draft base is an explicit refresh/review result. Account, current car, driver and contract facts are prefilled through the existing account/provider ports with their source/version. No facts are silently accepted from a request. This initial editor projection makes known facts read-only (`editable: false`), since FUCQ-94 adds no HR/driver/contract write authority. A source miss stays missing; an unavailable required context fails unavailable.

The new policy entry is needed because a new employee has no preferences and the controller correctly refuses to invent an importance value when the first position changes. Initial visual positions are labelled unconfirmed draft input. It also supplies the practical mapping so the browser never guesses that a boolean means five seats or a particular equipment list. No answers are coupled: comfort and sportiness, each weight, carrying, equipment and charging remain separate.

Explicit practical no is preserved through the existing typed essentials where possible: zero minimum for a numeric carrying requirement, empty equipment `includes` list for no required equipment, and the canonical charging `not-ready` enum. Unknown is null plus `needs-confirmation`; a supplied false/zero/no is never rendered unknown. Exact yes values and question labels come from the canonical editor entry. Charging yes still asks the supported home/work/either choice. Do not introduce a second `answers` store or duplicate essentials schema.

## Unsaved preview contract

`POST /brief/preview` consumes exactly the controller's `{ kind: unsaved-draft, baseBriefVersion, draftVersion, brief }`. No command ID or write is needed. Reject extra authority/cash/contribution fields and stale run/context; verify base versions through BriefService. Validate editable content against the same current PolicyService registry, including charging, and keep inferred/unknown input distinct.

The server-only recommendation preview entry evaluates directly with the existing FUCQ-29 pipeline, clock, canonical policy, trusted complete stock and provider driver/known-essential/required-by gates. It must not send a fabricated positive approved version through the existing public route. Separate content validation from approved-version validation. Employee-entered draft values can be evaluated provisionally; no result or stored brief calls them durably approved. The response retains the original draft/provenance and adds `preview: { kind: unsaved-draft, approved: false, baseBriefVersion, baseDraftVersion }`; evaluation `versions.brief` is the actual approved base or null, never a manufactured new brief version. Preserve the exact recommendations, complete decisions, reasons/trade-offs, facts/policy/stock/clock versions and unknown states.

Charging is the only employee-editable provider practical input in this path: resolve the trusted provider source, overlay only the explicitly supplied canonical charging answer with employee-preview provenance, retain all other scoped facts and gates, and feed that projection into the same recommendation service. A null answer remains unknown; it never inherits favourable provider charging. A not-ready answer cannot be rescued by comfort/importance. Do not allow request driver, allowance, stock, policy, identity or time to override trusted sources. The adapter exposes no allocation, hold, offer, outbox or repository write operation. Preview success must leave repository state unchanged.

Existing Save remains draft then confirm through FUCQ-91 with expected versions and independent explicit `{ search, hold }`. Preview neither saves nor enables the buddy. The activity view and service remain FUCQ-95's responsibility.

## Selected validation and resource checkpoint

Inspect the affected-selector plan first; its unsupported-JS full fallback remains unauthorised. Use strict targeted commands, one Node worker:

1. `node --test --test-concurrency=1 server/test/gcsp-brief-editor.test.js` for iteration and actual unsaved-to-FUCQ-29 service/HTTP composition.
2. `node --test --test-concurrency=1 server/test/gcsp-brief-editor.test.js server/test/gcsp-brief.test.js server/test/employee-recommendation-api.test.js server/test/gcsp-policy-service.test.js server/test/gcsp-brief-controller.test.js` at the frozen backend checkpoint. Include the then-current FUCQ-95 activity test as the explicitly reviewed shared-route seam after its exact path is known.

New tests cover absent and saved briefs, current draft/base conflicts, independent comfort/sportiness and importance effects, explicit carrying/equipment/charging yes/no/unknown, canonical one-place configuration changes, no approval/permission changes, provider gate preservation, unknown/unavailable/malformed sources, no repository writes, forged authority, origin/role/run refusals, unchanged approved-route semantics, actual Save compatibility and FUCQ-95 route continuity. Use computed results, not preset winners.

Before execution refresh the run manifest/impact map with these exact paths, fixtures/config/subprocess edges, named commands, changed source identity and headroom. Check declared `pg` dependencies before executable service tests; restore pinned existing dependencies only in the active worktree if required, with owned allocation/finalizer and lockfile preservation. Do not copy another install or add a new runtime package. Keep the existing one-worker small synthetic-fixture budget initially, remeasure and split at a concrete budget failure. No full suite or browser run is authorised for this supporting slice. The complete story still needs its authored full/ratchet/render/copy/CSP checks and desktop/375px keyboard evidence after UI integration.
