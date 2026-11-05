# Scoped local feedback (FUCQ-30)

The canonical action contract is `blocks/vehicle-matcher/feedback-actions.js`. Retail questionnaire refinement and the read-only employee draft adapter use the same serialisable actions and atomic local reducer. Other retail modes retain their existing state machines. Actions contain no predicate closures.

An action has `schemaVersion: 1`, a local unique `id`, `type`, `target`, human-readable `reason`, `scope: { kind, id }` and `expectedVersion`. Scope kind is `browse` or `employee-draft`. The reducer rejects a mismatched scope or stale version without returning a new state. Success explicitly returns `nextVersion` and a new state. Inputs are unchanged.

| Type | Target | Meaning |
| --- | --- | --- |
| `exclude-candidate` | `{ id }` | One exact candidate key or retail listing id. |
| `exclude-group` | `{ id }` | One current retail model/card id, or employee configuration id over exact decisions. |
| `filter` | `{ field, operator, value }` | Retail shade/gearbox equals or not-equals, feature includes, purchase price/odometer less-than. Applies to the complete current search, including later nearby listings. |
| `confirm-change` | `{ path, value }` | One existing employee preference value/importance or full essential. Requires `confirmation: { actor: 'employee', confirmed: true, at }`. |
| `undo` | `{ actionIds }` | Remove specified local actions and recompute. |
| `reset` | `{}` | Clear local feedback and recompute. |

Purchase price is GBP purchase price. Odometer is distance already driven; it is never annual usage. Unknown paint survives a colour rejection, while unknown odometer does not prove a lower reading. A whole-card shrug removes the group. Reconstruction follows surviving exact listings for count, price range, paint, equipment, image and link.

`server/scenarios/employee/feedback.js` consumes the complete `decisions` result from FUCQ-29, its original brief version and the policy-owned configuration/slider/charging inputs. Capped `recommendations` alone are insufficient. Every action starts from the original complete authorised decisions, replays remaining confirmed changes on the immutable base brief, recomputes employee essentials and `rankCars()` preference scores, and applies exact/group exclusions. Provider eligibility, points, driver, timing and provider-owned essentials remain authoritative. All exact decisions are retained; only presentation is capped. Source failure is `unavailable`, no suitable result is `no-match`, and unconfirmed facts are `needs-confirmation`.

Inference may propose an action. It cannot apply a change without employee confirmation, remove an essential, or replace charging `none` with `either`. A confirmed employee correction can change that charging value; it remains distinct from unknown charging. Unknown essentials retain their `needs-confirmation` state through unrelated preference changes. Policy definitions and assumptions come from the existing PolicyService, never a new local seed.

FUCQ-91's saved-brief single-change operation calls `applyConfirmedFeedbackChange`. FUCQ-91 still owns transaction boundaries, decline validation, version checks, audit, idempotency and consent. Canonical business no-op detection ignores essential provenance metadata and equipment ordering/duplicates, preserving the unused single-change opportunity. FUCQ-107 can consume the same action later.

Undo is local to the browse session or ephemeral draft. It cannot release or restore a durable hold, decline/expire/accept an offer, or claim account learning. There is no new employee application screen. The developer gallery illustrates the shared controls with fictional input only.

## Validation selection and resource plan

Changed boundaries: serialisable action contract; questionnaire exact-listing refinement and grouped cards; pure employee draft recomputation; the narrow FUCQ-91 confirmed-change call. Regression checks cover exact/group scope, all four existing negative operators, reconstruction/undo, immutable input, explicit confirmation, unknown/no-match/unavailable outcomes, complete candidates beyond the display cap and stale atomic rejection. No matching policy, source/identity resolver, manual context, offer lifecycle or other retail mode state machine changes are planned.

Selected checks before allocation:

- `node --test server/test/feedback-actions.test.js` for both pure consumers.
- `node --test server/test/employee-recommendation.test.js server/test/gcsp-brief.test.js` for exact recommendation parity and saved single-change semantics, including existing no-op regressions.
- `node --test server/test/render.test.js server/test/ui-ratchet.test.js` for all retail mode mounts, rejection controls and component reuse.
- Explicit share/preview/HTTP checks where the integrated boundary review identifies a change. No new source/feed tests are required for unchanged provider code.
- Headless desktop/narrow/keyboard browser inspection of changed rejection, undo, empty results and gallery. Inspect actual captures and record reset instructions.
- The story explicitly prescribes one final `npm test` after FUCQ-65 is integrated and source is frozen. Run one actual Node test worker under the shared full-suite lock and record reproducible executable/environment/stamp identity. Documentation-only result changes reuse that identity.

The JavaScript affected selector has no automatic ownership map; inspect its dry-run plan and use explicit scoped commands rather than accepting its legacy full-suite fallback. Shared impact evidence records reviewed ownership and fixture/config/subprocess edges; missing observations remain unknown.

Run: `fucq30-20261105-feedback-actions`. The ownership manifest and finalising supervisor are under shared `.claude/test-runs/ownership/`; each chunk uses a named child of shared `.claude/test-runs/scratch/fucq30-20261105-feedback-actions`. The supervisor supplies owned `TMPDIR`, `TMP`, `TEMP`, one test worker, a short-held shared host reservation and a ten-minute limit. Small synthetic inputs are expected below 128 MiB scratch/512 MiB RAM per scoped test chunk. Browser native working data is a bounded local compatibility working set, measured and removed. Outputs expected at 256 MiB or larger, and every archive, go directly to the run's OneDrive destination; none is currently planned. Keep at least 5 GiB emergency free space, shrink chunks under pressure, retain concise evidence and useful bounded failure logs, remove disposable roots/helpers and verify absence at completion.

The canonical HLD already describes shared feedback. Its status/render update and additive shared-contract prose wait for FUCQ-65 and dispatcher release. No draw.io tab was available at dispatch; foreground-changing tab creation and raw XML edits are prohibited. A missing render/status update must be recorded as such, never claimed verified.
