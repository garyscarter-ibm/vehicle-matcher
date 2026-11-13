# Angular/Java migration — Jira publication

**Current design context — 13 November 2026:** the [FUCQ-434 baseline](migration-baseline-2026-11-13.md) now freezes implementation at **`e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`**; the [replacement contracts](migration-replacement-contracts-2026-11-13.md) govern implementation. Earlier publication statuses and “not started” statements below are timestamped authoring observations, not current worker/status claims. Gary's [combined run](angular-java-dev-poller-kickoff-2026-11-13.md) includes **all four Epics / 66 Stories**, including all 17 native FUCQ-408 performance Stories. Their Node-specific acceptance remains required; Java-only work does not close them. Completing all Node tuning is not a gate for all migration. Read the [consolidated decisions](../design/migration-decisions-2026-11-13.md); published Story acceptance below is preserved.

Gary requested “Write our new stories to Jira” on 13 November 2026, then explicitly lifted the wider Jira-write pause: “You can stop the wider pause too”. The current shared direction is recorded in `AGENTS.md` and `CLAUDE.md`. Publication does not start implementation, a poller, provisioning, deployment, data reset, email sending or the final merge.

**Published and verified: three Epics and 49 child Stories, FUCQ-431–482.** Every issue is To Do, unassigned and unestimated. No priority, sprint, start date, estimate or adoption transition was set. Native Jira applies its default priority; recommended delivery order is in the descriptions and source decisions.

| Source | Jira Epic | Child Stories | Count |
| --- | --- | --- | --- |
| E1 | [FUCQ-431 — Run GCSP through an independently hosted frontend and backend API](https://ibm-consulting.atlassian.net/browse/FUCQ-431) | [FUCQ-434](https://ibm-consulting.atlassian.net/browse/FUCQ-434)–[FUCQ-438](https://ibm-consulting.atlassian.net/browse/FUCQ-438) | 5 |
| E2 | [FUCQ-432 — Deliver the GCSP experience in Angular](https://ibm-consulting.atlassian.net/browse/FUCQ-432) | [FUCQ-439](https://ibm-consulting.atlassian.net/browse/FUCQ-439)–[FUCQ-453](https://ibm-consulting.atlassian.net/browse/FUCQ-453) | 15 |
| E3 | [FUCQ-433 — Run the GCSP backend on Java 21 and Quarkus 3.x with replaceable adapters](https://ibm-consulting.atlassian.net/browse/FUCQ-433) | [FUCQ-454](https://ibm-consulting.atlassian.net/browse/FUCQ-454)–[FUCQ-482](https://ibm-consulting.atlassian.net/browse/FUCQ-482) | 29 |

## Scope, ordering and existing database work

The native descriptions retain the full `decided`, `acceptance` and `validate` cards, technical edges and shared migration contract. Angular 21, Java 21/Quarkus 3.x, independently deployed static frontend/API, real test OIDC with bearer access JWTs, no presenter impersonation, actual test mail, final-only hosted review and the agreed reset/cutover remain explicit. Local IDs continue to identify the exact refined card; the table below maps each to its actual native key.

Recommended order: target architecture/API/provider and persistence design → sign-in/account → Buddy matching, real email, signed-in acceptance and order/status using local substitutes → remaining journeys and complete remote transactional substitution → final hosted-dev acceptance. Engineering checks and coherent commits continue without interim human review gates. Gary performs the eventual merge into `gcsp-poc`.

For Russell's [FUCQ-408 work](https://ibm-consulting.atlassian.net/browse/FUCQ-408), **settle the persistence design early, then implement relevant changes with the Java port**. Do not wait for the whole Node refactor. [FUCQ-456](https://ibm-consulting.atlassian.net/browse/FUCQ-456) owns the Java/PostgreSQL foundation and references FUCQ-419–425; the [17-Story alignment assessment](database-refactor-migration-alignment-2026-11-13.md) maps the remaining overlap. Existing native FUCQ-408/409–425 issues were not edited, reparented, linked, transitioned or closed by this publication. Their Node-specific acceptance remains intact; optional tuning stays independently prioritized.

## Publication verification

Verified source revision: `23f6ce3313916f41264c3157d70188d79287d511`; this is authoring evidence, not the future implementation-kickoff freeze. Read-back observation: **2026-11-13T20:22:18.041Z**. All 52 issue summaries/types, full descriptions, parent relationships, labels, statuses, assignees and the configured Story-point field were checked. Descriptions match the exact submitted text after whitespace and Markdown bullet-marker normalization. All 49 Story parents match their intended Epic. No acceptance, pickup-readiness or development-completion claim follows.

An initial Epic create returned `Mcp error: -32001: mcp-remote: fetch failed`. A read-only query found no matching publication/local-ID issue; one retry against the configured site hostname created FUCQ-431. The exact error and recovery are retained in the receipt. Immediate search indexing returned a temporarily incomplete set despite `isLast: true`; direct known-key reads supplied all missing evidence, avoiding duplicate creation. A later complete label search returned all 52 known keys with `isLast: true`.

Evidence: [exact structured payloads](evidence/angular-java-migration-2026-11-13/issue-payloads.json), [creation and verification receipt](evidence/angular-java-migration-2026-11-13/publication.json), [minimal map input](evidence/angular-java-migration-2026-11-13/product-map-input.json), [verified component associations](evidence/angular-java-migration-2026-11-13/product-map-associations.json). The payloads contain public source links and the authorized issue text, not credentials or session tokens.

The enabled product-map CLI imported the verified native identities/statuses. Forty-nine Story associations reuse existing stable components and explicitly record unsliced work; no worker claim, acceptance, completion or invented slice plan was added. The importer's collection timestamp was corrected to each verified source-read time for these new rows. Existing observations/plans remain unchanged. The configured publication mode is Actions, with `gcsp-poc` as its data branch; the facts are on `gcsp-poc-dev`, and a public projection refresh is not claimed.

Local validation checked the 49 source cards, 42 question rows, 49 native Story mappings, JSON receipts and existing map-fact preservation. A bounded map build produced 20 components and six unrelated FUCQ-58–63 fact-conflict diagnostics; all 49 new Stories project without conflicts. The full branch-scanning snapshot was stopped after approximately 30 seconds; the bounded current-facts build passed and its temporary output was removed. [Local validation receipt](evidence/angular-java-migration-2026-11-13/local-validation.json) records the checks and the seven unchanged pre-existing missing index receipts.

Runtime tests, Angular/Java builds, native PostgreSQL acceptance, browser/OIDC/mail trials, Render capacity and live BMW integration remain unrun. This task verifies authoring/publication and local map consistency only. No runtime code, test processes or persistent scratch allocations were created.

## Native Story mapping

| Local card | Jira Story | Parent |
| --- | --- | --- |
| E1.S01 | [FUCQ-434 — Record the target architecture and implemented baseline](https://ibm-consulting.atlassian.net/browse/FUCQ-434) | [FUCQ-431](https://ibm-consulting.atlassian.net/browse/FUCQ-431) |
| E1.S02 | [FUCQ-435 — Call the separately hosted API with bearer authentication](https://ibm-consulting.atlassian.net/browse/FUCQ-435) | [FUCQ-431](https://ibm-consulting.atlassian.net/browse/FUCQ-431) |
| E1.S03 | [FUCQ-436 — Build and publish the static GCSP artifact](https://ibm-consulting.atlassian.net/browse/FUCQ-436) | [FUCQ-431](https://ibm-consulting.atlassian.net/browse/FUCQ-431) |
| E1.S04 | [FUCQ-437 — Enter and refresh replacement frontend routes](https://ibm-consulting.atlassian.net/browse/FUCQ-437) | [FUCQ-431](https://ibm-consulting.atlassian.net/browse/FUCQ-431) |
| E1.S05 | [FUCQ-438 — Release independent artifacts and hand over the final switch](https://ibm-consulting.atlassian.net/browse/FUCQ-438) | [FUCQ-431](https://ibm-consulting.atlassian.net/browse/FUCQ-431) |
| E2.S01 | [FUCQ-439 — Sign in and navigate through the Angular shell](https://ibm-consulting.atlassian.net/browse/FUCQ-439) | [FUCQ-432](https://ibm-consulting.atlassian.net/browse/FUCQ-432) |
| E2.S02 | [FUCQ-440 — Show employee account and current-vehicle information](https://ibm-consulting.atlassian.net/browse/FUCQ-440) | [FUCQ-432](https://ibm-consulting.atlassian.net/browse/FUCQ-432) |
| E2.S03 | [FUCQ-441 — Edit preferences and control Buddy delegation](https://ibm-consulting.atlassian.net/browse/FUCQ-441) | [FUCQ-432](https://ibm-consulting.atlassian.net/browse/FUCQ-432) |
| E2.S04 | [FUCQ-442 — Browse released stock and inspect an exact vehicle](https://ibm-consulting.atlassian.net/browse/FUCQ-442) | [FUCQ-432](https://ibm-consulting.atlassian.net/browse/FUCQ-432) |
| E2.S05 | [FUCQ-443 — Review and intentionally submit a manual selection](https://ibm-consulting.atlassian.net/browse/FUCQ-443) | [FUCQ-432](https://ibm-consulting.atlassian.net/browse/FUCQ-432) |
| E2.S06 | [FUCQ-444 — Show Buddy activity and search outcomes](https://ibm-consulting.atlassian.net/browse/FUCQ-444) | [FUCQ-432](https://ibm-consulting.atlassian.net/browse/FUCQ-432) |
| E2.S07 | [FUCQ-445 — Open an offer and accept or decline](https://ibm-consulting.atlassian.net/browse/FUCQ-445) | [FUCQ-432](https://ibm-consulting.atlassian.net/browse/FUCQ-432) |
| E2.S08 | [FUCQ-446 — Track the existing order and lifecycle journey](https://ibm-consulting.atlassian.net/browse/FUCQ-446) | [FUCQ-432](https://ibm-consulting.atlassian.net/browse/FUCQ-432) |
| E2.S09 | [FUCQ-447 — Use employee help and Greg's case queue](https://ibm-consulting.atlassian.net/browse/FUCQ-447) | [FUCQ-432](https://ibm-consulting.atlassian.net/browse/FUCQ-432) |
| E2.S10 | [FUCQ-448 — Show Greg's demand and preview/publish controls](https://ibm-consulting.atlassian.net/browse/FUCQ-448) | [FUCQ-432](https://ibm-consulting.atlassian.net/browse/FUCQ-432) |
| E2.S11 | [FUCQ-449 — Plan Greg's order and track Production responses](https://ibm-consulting.atlassian.net/browse/FUCQ-449) | [FUCQ-432](https://ibm-consulting.atlassian.net/browse/FUCQ-432) |
| E2.S12 | [FUCQ-450 — Operate presenter scenarios](https://ibm-consulting.atlassian.net/browse/FUCQ-450) | [FUCQ-432](https://ibm-consulting.atlassian.net/browse/FUCQ-432) |
| E2.S13 | [FUCQ-451 — Inspect notifications and follow delivered offer links](https://ibm-consulting.atlassian.net/browse/FUCQ-451) | [FUCQ-432](https://ibm-consulting.atlassian.net/browse/FUCQ-432) |
| E2.S14 | [FUCQ-452 — Inspect and run supported process comparisons](https://ibm-consulting.atlassian.net/browse/FUCQ-452) | [FUCQ-432](https://ibm-consulting.atlassian.net/browse/FUCQ-432) |
| E2.S15 | [FUCQ-453 — Retire replaced GCSP frontend entry points](https://ibm-consulting.atlassian.net/browse/FUCQ-453) | [FUCQ-432](https://ibm-consulting.atlassian.net/browse/FUCQ-432) |
| E3.S01 | [FUCQ-454 — Build and run the portable Java API artifact](https://ibm-consulting.atlassian.net/browse/FUCQ-454) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S02 | [FUCQ-455 — Authenticate OIDC/JWT users and enforce roles](https://ibm-consulting.atlassian.net/browse/FUCQ-455) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S03 | [FUCQ-456 — Persist state in isolated development PostgreSQL](https://ibm-consulting.atlassian.net/browse/FUCQ-456) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S04 | [FUCQ-457 — Read and publish canonical versioned policy](https://ibm-consulting.atlassian.net/browse/FUCQ-457) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S05 | [FUCQ-458 — Resolve employee/account context through replaceable ports](https://ibm-consulting.atlassian.net/browse/FUCQ-458) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S06 | [FUCQ-459 — Serve exact vehicle evidence from retained artifacts](https://ibm-consulting.atlassian.net/browse/FUCQ-459) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S07 | [FUCQ-460 — Save preferences, feedback and delegation](https://ibm-consulting.atlassian.net/browse/FUCQ-460) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S08 | [FUCQ-461 — Compute equivalent eligibility, quotes and recommendations](https://ibm-consulting.atlassian.net/browse/FUCQ-461) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S09 | [FUCQ-462 — Release stock through the selected supply provider](https://ibm-consulting.atlassian.net/browse/FUCQ-462) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S10 | [FUCQ-463 — Claim and release manual selections safely](https://ibm-consulting.atlassian.net/browse/FUCQ-463) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S11 | [FUCQ-464 — Allocate Buddy offers and reconcile holds](https://ibm-consulting.atlassian.net/browse/FUCQ-464) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S12 | [FUCQ-465 — Resolve offer links under OIDC ownership](https://ibm-consulting.atlassian.net/browse/FUCQ-465) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S13 | [FUCQ-466 — Apply local offer decisions and follow-up](https://ibm-consulting.atlassian.net/browse/FUCQ-466) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S14 | [FUCQ-467 — Complete remote offer acceptance and decline](https://ibm-consulting.atlassian.net/browse/FUCQ-467) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S15 | [FUCQ-468 — Submit and reconcile employee ordering handoffs](https://ibm-consulting.atlassian.net/browse/FUCQ-468) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S16 | [FUCQ-469 — Capture and deliver notifications through the selected transport](https://ibm-consulting.atlassian.net/browse/FUCQ-469) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S17 | [FUCQ-470 — Reconcile approvals and ordering status](https://ibm-consulting.atlassian.net/browse/FUCQ-470) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S18 | [FUCQ-471 — Read and acknowledge documents/readiness](https://ibm-consulting.atlassian.net/browse/FUCQ-471) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S19 | [FUCQ-472 — Plan supported handover appointments](https://ibm-consulting.atlassian.net/browse/FUCQ-472) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S20 | [FUCQ-473 — Plan and reconcile supported old-car returns](https://ibm-consulting.atlassian.net/browse/FUCQ-473) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S21 | [FUCQ-474 — Maintain owned help/renewal cases and remedies](https://ibm-consulting.atlassian.net/browse/FUCQ-474) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S22 | [FUCQ-475 — Calculate Greg's demand and operational projections](https://ibm-consulting.atlassian.net/browse/FUCQ-475) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S23 | [FUCQ-476 — Consume learned artifacts and capture new learning records](https://ibm-consulting.atlassian.net/browse/FUCQ-476) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S24 | [FUCQ-477 — Calculate Greg's constrained next-order plan](https://ibm-consulting.atlassian.net/browse/FUCQ-477) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S25 | [FUCQ-478 — Submit Production requests and reconcile responses](https://ibm-consulting.atlassian.net/browse/FUCQ-478) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S26 | [FUCQ-479 — Run clock, scenarios and presenter operations](https://ibm-consulting.atlassian.net/browse/FUCQ-479) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S27 | [FUCQ-480 — Retain comparison results and supported job behaviour](https://ibm-consulting.atlassian.net/browse/FUCQ-480) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S28 | [FUCQ-481 — Prove provider composition and complete substitution](https://ibm-consulting.atlassian.net/browse/FUCQ-481) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |
| E3.S29 | [FUCQ-482 — Rehearse fresh-state cutover and retire GCSP Node runtime](https://ibm-consulting.atlassian.net/browse/FUCQ-482) | [FUCQ-433](https://ibm-consulting.atlassian.net/browse/FUCQ-433) |

Sources: [Epic acceptance](angular-api-adapter-epic-proposals-2026-11-13.md), [refinement decisions and technical edges](angular-java-story-refinement-2026-11-13.md), [complete Story cards](angular-java-migration-stories-2026-11-13.md).
