# FUCQ-445 delivery record

Native contract: DEV-2026-11-13-013, original two AC unchanged. Actual authorised start: 14 November 2026, linked lead Mugsy (they/them), thread 01a1d8a4-979f-7cc2-b4ec-897119fa9afe. Dispatcher owns queue, Jira, publication and integration.

Admission source: b5975c2c98493a7726c3b5bfbde78adca6ab53c4; frozen visual/capability source: e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38. Verified frozen gcsp-offer.html and blocks/gcsp/offer/** exist through worker scaffold_git API. Helper base gcsp-poc-dev; branch dev/DEV-2026-11-13-013; clean at admission. Gateway PASS api.servicesessentials.ibm.com.

## Stable plan

1. typed-contract: source-backed typed offer/reasons/decision/follow-up transport with bearer ownership boundary and no command replay.
2. offer-view: current authoritative offer state, exact vehicle identity, terms, reasons, comparison/media and terminal reopen.
3. decision-followup: deliberate drawer confirmation, declarations, expected return mileage, server reasons, pending/refused/confirmed and supported follow-up.
4. proof-review: named scoped service/journey/component checks, desktop/narrow rendered review and independent review.
5. integration: dispatcher route wiring; actual Java/OIDC/email/native PostgreSQL and remote journey evidence. This gate remains pending until proven.

Existing product component: offer-journey, Offer decisions and second offer; no boundary change. Reuse Angular AuthPort/runtime config, screen intro, status screen, buttons, labelled field and error summary; reuse approved shell Density tokens and focused offer/car details/drawer semantics from COMPONENTS.md. Native Angular composition inside offers, no legacy controller embedding or shared-file edits.

## Technical readiness and limits

At admission committed Java has notify OfferFacts/OfferMessage and BriefOfferPort types but no offer/decision-reasons/decision/offer-followup resource. Frontend proceeds against the F434 same-method/suffix v1 contract and committed Node semantic source. Old link cookie/access exchange is removed. Opaque offer ID is only a selector; bearer context supplies authority. Java DTO confirmation remains outstanding with Russ F465/F466/F467. No success or live ownership is inferred from fixtures.

Node source decision keys: commandId/runId/decision/reasonCode/expectedOfferVersion/expectedHoldVersion/expectedQuoteVersion/termsDigest/declarations/expectedReturnMileage. runId is a selector and must match current context. Accept alone supplies terms/declarations; optional expectedReturnMileage is conditional on server replacement projection. Decline alone supplies reasonCode. Follow-up confirm keys: commandId/decisionId/expectedBriefVersion/questionVersion/value. Exact parsing derives from source, no invented reason/question registry.

## Validation/resource plan

Only new named offers specs initially, one worker, pinned Node 24.22.3/npm 11.19.1/Angular 21.2.26, ng test --watch=false. Scope: malformed/denied/identity/run isolation/loading/unavailable/stale/terminal reopen; explicit versioned declarations/reasons; truthful pending/conflict/refused/confirmed and saved follow-up; no automatic replay. Actual rendered desktop 1440x1000 and narrow 375x812, keyboard/focus/reduced motion/CSP/accessibility, applicable Safari/private remain required. No broad build/full-suite allocation without concrete rationale.

Owned receipt root: /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq445, ownership.json and registered finalize.py outside scratch. One worker, <=2 GiB scratch, <=600 second chunk, >=5 GiB emergency reserve; adapt near 30 GiB. Large output >256 MiB goes directly to configured OneDrive fucq445 destination. Borrowed toolchain/dependencies remain preserved. Final receipt must verify process and filesystem cleanup.

Real test OIDC/email links to Java/native PostgreSQL, remote substitution F467/F481 and hosted browser proof remain open. This worker has no test-email, deployment, paid-tier or final-switch authorisation. Existing F400/F486-F489/F491/F494 findings remain separate and unfixed; no new defect is diagnosed at planning.

## Initial typed client checkpoint review

Hugo committed 814d67e1ae747f90bc246395d195eb33c81afbbb, exactly four authorised offers files. Requested/selected/effective gpt-6-luna/high, no fallback; saved Hugo title independently verified from session 01a1d8a7-939a-7de3-a08d-b8fe6a6ef7aa. Mugsy lead requested/selected/effective gpt-6.1-sol/high, saved title verified.

Scoped client check passed 12/12. Parent independently verified nine exact before/after input hashes against committed source and cleanup in .claude/fucq445-client-parent-audit-0621.json. Matching proof reused, no duplicate run. Earlier compilation failure and 11-pass/1-fail fixture mismatch remain in client-receipt.json plus both logs. Passed chunk: 4.816s, peak group RSS 911,523,840 bytes, peak scratch 9,961,696 bytes; all three owned process groups and scratch roots absent, borrowed link/runtime/dependency identities preserved. This is scoped proof, no full stamp.

Semantic lead review: bearer request/context/env/run cancellation and no automatic POST replay match the agreed boundary. Two original-scope gaps require correction before marking typed-contract complete: raw source currentCarComparison may validly return partial/comparisonAvailable=false/no facts (access.js lines61-82); client currently rejects that whole offer. Raw accepted decision receipt selection is ManualOrderService projection (operationId/selectionReceived/selection/progress/order/failure/view), not the OfferAccess read selectionProgress DTO; the validator currently rejects a real connected accept receipt. Existing tests use hand-authored null selection and miss this path. Correct these source-backed differences with regression evidence and honest pending/failure presentation. No backend or AC change is authorised.

Parent native adoption independently confirmed In Progress, Gary Carter, 8 points, Start date 2026-11-14, branch comment3629426 and F434coordination3629427; own map row reconciled through helper. All foreign story rows preserved exactly. Original AC remain unchecked, required integration remains pending.

## Corrected typed client review — 2026-11-14T06:37:02Z

Ralph Wolf committed 2043c8c653e2944314223a70fa7b01577800756a: four client/type/validation/spec files and the source-generated offer-command-producer.fixture.ts. Requested, selected and actual runtime gpt-6.1-sol/medium, no fallback; saved Ralph Wolf title and session 01a1d8bb-e1d4-71a3-8f1c-089ab869efbe independently verified.

Lead review passed the original typed-contract delivery boundary. currentCarComparison now matches access.js: all eight missing facts remain unknown and a valid partial/comparisonAvailable=false response preserves the offer; known/unknown partition and source observation before the quote are checked. The accept receipt now parses ManualOrderService's command operation separately from the smaller reopen selection. Its source/quote/stock identity, authenticated employee/run, progress stages, awaiting-approval/pending/failed view and actual outcome are checked. Acknowledgement retains approved=false. Public command output omits private employee/driver/slot/full quote/terms payloads. Explanations support source strings and nested requirement/fact values; ready follow-up requires full coherent previous/next safe offer projections and historical quote pins. These were unmet original criteria in an unmerged slice, not new product scope or a claim to fix a separate backlog defect.

Selected client spec passed 24/24, none skipped. Three real in-memory OfferDecisionService/ManualOrderService captures (acknowledged, unknown/pending, refused/failed) match the committed fixture payloads 3/3. Producer source, transport callers, complete correction diff and retained summaries were reviewed. The 3,121-line fixture retains source payloads with shared subtrees; it is consumer test data, not live Java proof. The initial four TypeScript diagnostics and missing-pg producer-import failure remain recorded in client-correction-receipt.json, corrected before final proof. No full-suite stamp or duplicate unchanged run.

Evidence: .claude/test-runs/fucq445/client-correction-receipt.json; targeted-9e72cb0748473fdd2cf7a90d8408412226ca691d12636052ad9d4f3f737edb7b-default-1794638019818871000.json; client-correction-producer-receipt-2.json. Final consumer chunk 4.892s, peak RSS 1,029,816,320 bytes, peak scratch 9,961,696 bytes. Producer capture 28.940s, peak RSS 397,180,928 bytes. Dispatcher independent audit .claude/fucq445-correction-parent-audit-0634.json verifies exact five input hashes, all ten recorded scratch/process groups absent and the borrowed worker007 toolchain/dependency/link identities preserved.

Typed-contract is complete at the scoped client boundary only. Original AC remain unchecked, native In Progress/Gary Carter unchanged; offer-view, decision-followup, proof-review and actual integration remain open. No store/UI/rendered, real Java/OIDC/email/native PostgreSQL, remote F467/F481 or hosted/Safari/private proof has run.

Next authorised offer-view work may add only the new native shared kit side-drawer, tabs, media-gallery and vehicle-details.component.* families. Dispatcher allocation .claude/fucq445-shared-kit-allocation-0624.json preserves all existing kit, global styles/tokens, gallery/catalog/COMPONENTS, routes/auth/shell/build under dispatcher ownership. Shared primitives remain presentational and follow frozen focused offer/approved Option B; no offer DTO or client imports into kit.
