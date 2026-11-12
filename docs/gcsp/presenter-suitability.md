# Presenter car suitability

Gary approved building Option 1 (Match matrix) on 12 November 2026. Options 2 and 3 remain deferred.
Jira writes are paused; this records the directly approved scope without inventing a Story association.

## Decided

- Put a collapsed Car suitability disclosure below Allocation and above What happened. Load on opening.
- Show every released car against current engaged Buddies, with all/latest release and bounded paging.
- Read stored allocation evaluations. Never calculate a second score or change matching policy.
- Describe fit as /100, distinct from offer probability. There is no numeric minimum fit score today.
- Explain hard checks, recorded allocation outcomes and current reservations separately.
- Missing evaluations and older brief/policy results must be explicit, never invented or silently current.
- Selecting a cell opens its explanation within the same section.

## Acceptance and validation

Validate recorded packed/legacy decisions, null/zero scores, gates, provenance, occupancy, both paging
axes, engaged membership, selector validation, presenter authorisation and read-only behaviour.
Exercise disclosure, selected-cell details, refresh/reset/race/destroy lifecycle and failure recovery.
Review the running presenter at desktop and narrow widths, including release-to-matrix flow.
Use the existing shared table, button, field and loading primitives with Density tokens.

The original build request authorised a feature branch. Gary subsequently authorised merging it
on 12 November 2026 with “Merge please”.

## Built and reviewed

Implemented on `dev/presenter-suitability`, based on `gcsp-poc` at `3b6e51f109ce`.
The presenter-only GET `/api/gcsp/presenter/suitability` projects stored packed or legacy
allocation evaluations. It does not run matching, change policy or claim cars. It pages eight
cars and four Buddies, reads only the visible Buddies' referenced evaluation rows, and expands
only visible car decisions. Required checks are distinct from preference fit and offer allocation.
There is no numeric fit threshold in the current matching policy; the section says so explicitly.

Missing evaluations show Not evaluated; missing scores remain unscored; zero stays zero.
Earlier brief/policy/permission/employee versions are labelled. Historical allocation and current
stock/hold status have separate explanations. Refresh, release, clock change, reset and teardown
invalidate stale requests. The disclosure has native keyboard access and opens lazily.

Visual reference: the existing Density presenter and shared kit, following
`experience-quality.md` and `COMPONENTS.md`. No new component primitive or runtime dependency.

## Repeatable walkthrough

Use an isolated GCSP runtime with memory repository and a disposable generated-stock path,
then open `gcsp-presenter.html` through that runtime. Production data and email delivery are
not required. Start again with Main successful journey and confirm the reset.

1. Observe Car suitability collapsed below Allocation and above What happened.
2. Release the next cars. Open Car suitability after the release completes.
3. Inspect Paula's fit scores and required-check blockers. Select a blocked cell with Enter.
   Its details identify the blocker, recorded checks, allocation at that check and the car now.
4. Move to the next car page, choose Latest release, and refresh. The filter resets paging.
5. At 375px width, scroll the table sideways. The page remains within the viewport.
6. Start again. The section closes and previous run details clear.

Observed on 12 November 2026: the real release flow produced 100 cars. The standard Paula-only
run produced one allocation. A second isolated run engaged Alex and Sam through the existing
brief editor routes with body Estate, fuel Petrol and comfort 50 before release; it produced
three allocations and showed three Buddy columns with different recorded fit and gate results.
Keyboard Enter selected Paula's BMW iX1 20 charging blocker. Next cars moved from page 1 to 2
of 13 and retained focus; Latest release returned to page 1. At 375 × 812, page width was 375px,
the scroll region 319px and the table 680px; horizontal scrolling reached 363px without page overflow.

Screenshots: [desktop placement](evidence/presenter-suitability/desktop.jpg),
[full matrix and selected explanation](evidence/presenter-suitability/full.jpg),
[narrow view](evidence/presenter-suitability/mobile.jpg).
The screenshot's scenario time is Friday 13 November; inspection date was Thursday 12 November.

## Validation results

All commands used the repository test supervisor, an explicit scoped selection and one worker.
No full-suite stamp or live PostgreSQL performance claim is made.

- **69/69 passed:** suitability backend/UI, presenter console, basic console/model and release-section
  tests. Includes actual HTTP presenter authorisation, read-only checks, current occupancy,
  packed/legacy decisions, provenance, paging, errors and stale-request/reset handling.
  Log: `.claude/test-runs/logs/20261112-114650-xjigrw4v` in the shared main checkout.
- **95/95 passed:** `gcsp-presenter-controls-render.test.js`, including the added transport test
  proving release/page selectors, credentialled GET and cancellation signal handling.
  Log: `.claude/test-runs/logs/20261112-115127-itqxsm87`.
- Existing presenter-release runtime and painted-copy checks passed in the earlier scoped boundary
  run, including the generated 100-car release and 355 painted-copy assertions. Earlier in-progress
  matrix failures were corrected and covered by the final 69-test run; that earlier batch is not
  reported as wholly passing. Log: `.claude/test-runs/logs/20261112-113922-es2ilnwi`.
- Ratchet/feature batch: **221/222 passed**, with only the existing presenter-console CSS cap failure
  below. New matrix CSS is explicitly registered at 18 counted lines; its ratchet checks pass.
  Log: `.claude/test-runs/logs/20261112-114442-hahzl752`.
- `git diff --check` passed. Browser review used the actual local runtime, not a mock response.

## Separate baseline validation debt

Both failures were reproduced on unchanged `gcsp-poc` at `3b6e51f109ce` with
`node --test --test-concurrency=1 server/test/gcsp-presenter-principal-account.test.js server/test/ui-ratchet.test.js`:
**153/155 passed**. Log: `.claude/test-runs/logs/20261112-114311-izm8o_7k`.
These are Low severity test/validation debt; no product failure was established. They remain open
for independent prioritisation. Jira creation is deferred under the project-wide write pause.

- **Greg account expectation:** principal-account test line 56 expects 403 but receives 200.
  Greg's employee + greg roles and account access are an intentional existing change, recorded in
  `greg-profile-2026-11-11.md` and the seed. The test expectation is stale. Future validation should
  reconcile the role contract and test without revoking intended access. Story origin remains
  unresolved; the profile document establishes intended behaviour, not a verified Jira link.
- **Presenter CSS cap:** unchanged `presenter-console.css` counts 44 lines against a 39-line cap in
  `ui-ratchet.json`. The same mismatch exists at base. Future validation should resolve the existing
  style/cap debt independently. Story origin remains unresolved.

## Resource and delivery receipt

Tests used supervisor-owned scratch and retained bounded logs/evidence outside it. Both local
preview servers were stopped and joined; their owned scratch roots were verified absent.
The retained ownership manifests `43d35550b5cd46e790d869586ec5af52` and
`491fc38b04c84e8fbf083581aebd7855` record `state: removed`, with peaks below 1.3 MB.
The browser viewport was reset and the working preview tab closed. A failed first-load temporary
tab could not be explicitly closed because its error-page URL was blocked by browser policy;
it was not marked to survive the turn. No persistent preview service remains.

Full-suite, live PostgreSQL performance and post-deployment checks were not run. No acceptance
transition or Jira update is included. No verified Story association was available, so product-map
progress was not assigned to an unrelated Story.

## Authorised integration, 12 November 2026

Gary requested “Merge please” after reviewing the built feature. Integration targets `gcsp-poc`
at `ff6e34cb6165`; the changes since the original base are documentation and status records only.
The merge has no conflicts. Application, test, component and stylesheet files match validated
feature commit `d7fa989d1b09`, so the existing scoped test and browser evidence is reused.
`git diff --cached --check` passes. The two documented baseline validation failures remain open.
This records the authorised merge; deployment completion and post-deployment behaviour are unverified.
