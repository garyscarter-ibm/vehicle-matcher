# Vehicle Matcher high-level design

Canonical editable artifact: [high-level-design.drawio](high-level-design.drawio). Updated for FUCQ-6 on 1 November 2026 and the approved FUCQ-74 predictive order-planning capability on 2 November. The draw.io tab is named for this repository. This is one design with current and proposed views. Start with **00 GCSP architecture** and the [whole-demo design record](gcsp-high-level-design.md).

FUCQ-6 extends this file with a parent overview; the existing shared recommendation target is a child/detail view. A separate GCSP HLD would duplicate common components, state and release facts. The whole-demo proposal is ready for review; the earlier agreement of FUCQ-8's shared architecture does not imply acceptance of every lifecycle policy or deployment choice. Detailed interface-control review is deferred until the rest of the HLD has been reviewed, at Russell's request.

The target is a **shared pure recommendation core with separate retail and employee policies and workflows**, implemented incrementally inside the existing Node backend and ES-module frontend. The [shared recommendation design](../gcsp/shared-recommendation-design.md) specifies contracts, code seams, migration and regression evidence. Its business baseline is [Paula's service blueprint](../gcsp/service-blueprint.html); the [FUCQ-8 assessment](../gcsp/engine-reuse-assessment.md) supplies source-backed findings and executable evidence.

**Review update, 4 November 2026.** Gary's architecture review ([hld-review-gc.md](hld-review-gc.md)) is applied to the draw.io file on pages 00, 02, 04 to 08 and both employee pages. The PNG exports below predate that update. Re-export them from draw.io before using them. The pre-build pass on 5 November added the backlog's named components (DemoIdentityAdapter, DemoClock and ticks, scenario catalogue, presenter controls, offer link access, outbox viewer, lifecycle adapters) to 00, Employee transactions and 07. Those pages and the 03 overview were re-exported on 5 November; the other PNGs still predate the review update.

## Views

| Draw.io page | Purpose | Export |
|---|---|---|
| 00 GCSP architecture | Whole-demo responsibility and navigation view: employee, Greg, shared entry/kit/core, transactions, data, state, events, mail and release. Links to detail pages. | [PNG](gcsp-architecture.png) |
| 01 Current implementation | The existing EDS client, six brands/five modes, HTTP API, deterministic ranker, sources and caches. | [PNG](current-implementation.png) |
| 02 Shared recommendation target | Retail compatibility surface and employee services consume shared computation, exact decisions, fact provenance and UI primitives. Policies remain separate. | [PNG](shared-recommendation-target.png) |
| 03 Employee data and actions | Navigation overview connecting the two detailed employee views below. Linked area boxes open their pages. | [PNG](employee-overview.png) |
| Employee data adapters | Employee/contract, VIN/description, optional connected use, scheme terms, released stock and future supply. Synthetic and future providers use the same ports. | [PNG](employee-data-adapters.png) |
| Employee transactions | Versioned briefs, full-stock evaluation, allocation, exact holds/offers, cases, Greg's demand, transactional state and notification dispatch. Dashed reference stubs link back to the data view. | [PNG](employee-transactions.png) |
| 04 Migration and regression protection | Contract baseline → focused corrections → parity extraction → employee consumer → transactions → shared presentation/release. | [PNG](migration-and-regression.png) |
| 05 Deployment and future integration | Current Pages/Render route, compatible deployment, durable state/background prerequisites and later BMW identity/data/action/hosting conditions. | [PNG](deployment-and-integration.png) |
| 06 Vehicle evidence providers | Catalogue, representative imagery, handbook and synthetic VIN contracts; immutable corpus publication/HTTP lookup; source isolation and exact-stock boundary. | [PNG](vehicle-evidence-providers.png) |
| 07 Planning and lifecycle | Greg's request → confirmed supply → actual release; policy versions; employee selection, acknowledged order, approval, booking and readiness. | [PNG](planning-and-lifecycle.png) |
| 08 Predictive order planning | FUCQ-74: learning records, offline training/evaluation, versioned model, central policy, demand prediction, constrained order planning and Greg's intentional submission/replanning. | [PNG](predictive-order-planning.png) |
| 09 1,000-employee comparison | Readiness item C8: seeded cohort generator, isolated simulation harness, today's first-come-first-served route and the buddy route on identical inputs, cross-seed measures, immutable results and the route comparison panel on Greg's dashboard. | Not yet exported |

The employee overview was split into area pages to keep connectors readable. Reference stubs denote the same component on another page; they do not create another service. Diagrams show dependencies and named data/actions rather than a complete sequence diagram. Repeated objects across distinct views refer to the same logical object.

## Status and boundaries

Blue means current implementation; purple/dashed means proposed. Current application code was reviewed at `27cf841e1af6ea1c0598bcd63700145138fdb947`; this FUCQ-6 review uses checkout `eefc85c` and its existing working-copy context. The retail API and exports exist; their internal shared-core extraction does not. Russell agreed the shared recommendation direction on 1 November 2026 and requested implementation stories for FUCQ-8. Its shared recommendation work is being refined separately from the wider employee lifecycle. Proposed components remain purple until built and verified; design agreement does not establish implementation or operational acceptance. No application code or hosting was changed by this design update.

**FUCQ-26 implementation evidence, 5 November 2026:** the [immutable vehicle facts and scenario terms contract](vehicle-snapshot-contract.md) is implemented as additive backend modules and opt-in retail/synthetic adapters. The integrated check passed 20 contract cases, 157 frozen retail compatibility cases, and the full suite (513 passed, two PostgreSQL checks skipped with `GCSP_DATABASE_URL` unset). Existing mapper/cache interfaces and retail payloads remain unchanged. This verifies the internal facts/terms boundary; it does not establish employee workflow or live-provider completion. Page 02's diagram status/render remains unverified because no background draw.io tab is available; its status is unchanged, and no new rendered review is claimed.

**FUCQ-29 implementation evidence, 5 November 2026:** the stateless employee service and guarded `POST /api/gcsp/recommendations` evaluate canonical eligibility/allowance, exact essentials, driver/charging and timing before reusing the existing ranker curves. Trusted provider/context/time composition is required. The cash-filter opt-out preserves retail defaults without inventing pounds for points. Integrated scoped validation passed 336/336; the authored full suite passed 574 with two explicit unset-PostgreSQL-URL skips and zero failures on `60419c10` (base executable `d50f74f`). [Consumer contract](../gcsp/employee-recommendation.md) and [nine computed examples](../gcsp/evidence/fucq-29/README.md) retain versions, unknowns and failure states. The unavailable background draw.io tab leaves diagram status and rendered exports unchanged; no fresh diagram/render proof is claimed.

**FUCQ-27 implementation evidence, 9 November 2026:** the shared pure decision core (`server/recommendation/`: weight totals, dimension evaluation, blend, percent and stable comparators) and the explicit server-bound `used-retail-v1` composition (`server/scenarios/retail/`) are built; `server/engine.js` is now a facade that re-exports the unchanged 15 public names, and `server/index.js` binds the retail routes through `RETAIL_PROFILE`. The frozen R1 reference is the verbatim engine from `3f468f6baaccbc7779e5b2e1be7899a88d83ef26` (blob `a5318ab8`) under `server/test/helpers/retail-reference-r1/`. A 1,201-case in-memory differential found zero differences at `TASTE_SHARE` 0.2 and 0.3; the frozen v1 HTTP contract is unchanged; `npm run audit`, `audit:refine` and the offline persona replay are byte-identical to the base. Rollback boundary: revert commit `16159c45` (engine.js wiring) and the `server/index.js` binding that follows it. The employee consumer still calls `rankCars()` through the facade; re-pointing it and the FUCQ-28 projection are separate follow-ups, and page 02/04 diagram cells for the core and retail policy are marked built.

Boundaries that must survive implementation:

- Brand and scenario are separate. Server wiring selects the policy; a client cannot switch an employee request to permissive retail rules.
- Shared scores explain preference fit. Employee hard/unknown gates run first; ranking never reserves a car.
- Evaluate exact candidates before grouping or truncation. A selected listing carries its own score, terms and reasons. Group feature unions never prove fitted equipment.
- Retail purchase price and employee points/contribution are separate typed terms. Employee overlays never mutate shared source cars.
- “Don't like this” shares action/reducer mechanics, while retail local filtering, a confirmed employee brief change and declining an exact offer remain separate operations. Undo cannot restore a committed or expired hold.
- Manual and buddy selection use the same eligibility and transaction authority. Demo hold/offer/outbox writes commit atomically. Future remote reservation authority requires idempotent calls and reconciliation before notification.
- Synthetic and eventual BMW inputs use the same application logic. No fixture may hard-code a winner or dashboard result.
- FUCQ-74 separates learned choice probabilities from deterministic fit scores and order optimisation. Hard gates remain authoritative; forecasts never reserve stock. The canonical policy source owns objectives, bounds and the active immutable model reference. Synthetic model evaluation is labelled separately from real BMW validation.

## Deployment facts and open conditions

GCSP runs in its own Render environment built from `gcsp-poc`: a backend service, a static site and managed PostgreSQL (review Q1, Q2). The retail frontend stays on GitHub Pages from `main`, pointing at the existing Render backend; evidence is [the Pages workflow](../../.github/workflows/pages.yml), [render.yaml](../../render.yaml) and [the block's API resolution](../../blocks/vehicle-matcher/vehicle-matcher.js#L27). Pages, `main` and [EDS repository sync](../../.github/workflows/sync-block.yml) stay retail-only until after the demo. Gary must still confirm the retail dashboard facts (GC-001). The [release procedure](gcsp-high-level-design.md#technical-deployment-and-recovery) and [GC questions](../gcsp/questions-for-gc.md) retain those decisions.

Durable shared briefs/holds/offers use managed PostgreSQL behind the repository adapter (Q2); it is not provisioned yet. Background work is presenter ticks, with no unattended runner (Q3). A captured-outbox viewer always ships, plus one Microsoft or Brevo transport if the sender is ready (Q11). No email was sent.

Later BMW hosting depends on sanctioned identity/roles, authoritative facts/rules/quotes/stock, supported actions/events, exclusive reservation authority, durable infrastructure and operational ownership. Diagrammed future adapters are required capabilities, not verified BMW endpoints. The shared demo password does not provide employee identity. The planned 1,000-employee comparison is included under the [full-build direction](../gcsp/build-rules.md), with captured notifications and the same decision/allocation logic.

**GCSP package preparation, FUCQ-36:** [`scripts/assemble-site.mjs`](../../scripts/assemble-site.mjs)
implements the existing separate static-site assembly boundary. It discovers every
`blocks/gcsp/` directory and includes the shared launcher, real employee entry,
retail block, gallery, styles, fonts and required brand/image assets. The
[release checklist](../gcsp/evidence/fucq-12/fucq36-release.md) defines the proposed
Render build from `gcsp-poc`, explicit API/revision configuration, employee switch,
exact migration/seed expectations and later deployed checks. Local artifact
validation does not establish deployment, current backend revision or database
readiness. The existing retail workflows/blueprint and diagram statuses are
unchanged. Missing direct offer UI remains an explicit release gate until its
actual block/page is integrated; a source branch preview is separate evidence.

## Validation and review

The as-built view was independently reverse-engineered from source. The expanded design received an independent architecture review; corrections included notification atomicity, durable-brief migration order and preserving the configured retail blend. Requested/selected pairs: as-built implementer `gpt-6.1-sol` / `medium`; design reviewers `gpt-6.1-sol` / `high`, no fallback or descendants. Effective runtime selections were not independently inspected.

Each final diagram page was exported with draw.io and visually inspected for legible grouping, clipping and connector routing. The [FUCQ-8 evidence](../gcsp/evidence/fucq-7/README.md) records 234 passing retail tests and the controlled defect probes. Those checks establish the reviewed baseline, not future cross-scenario parity. The [migration regression matrix](../gcsp/shared-recommendation-design.md#regression-matrix) specifies what implementation must prove. No new product visual acceptance is claimed; changed UI must follow the [experience contract](../gcsp/experience-quality.md).

The [FUCQ-6 evidence record](../gcsp/evidence/fucq-5/README.md) records research coverage, independent review and diagram/document verification for the whole-demo proposal. User agreement remains the closing gate for FUCQ-6.

The [FUCQ-74 authoring record](../gcsp/evidence/fucq-73/README.md) records Russell's 2 November approval, Jira readback and verification of the added predictive planning view and linked contracts.
