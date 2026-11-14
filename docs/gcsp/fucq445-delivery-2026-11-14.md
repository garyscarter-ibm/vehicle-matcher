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
