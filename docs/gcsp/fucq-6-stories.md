# FUCQ-7 · Manual journey implementation stories

**Published and verified:** ten native Jira Stories, FUCQ-64–73, under [FUCQ-7](https://ibm-consulting.atlassian.net/browse/FUCQ-7). All Stories are To Do and Medium/P3; author sizes are M/L, and no Story Points were authored. FUCQ-7 is In Progress under the scaffolding authoring procedure. Native Blocks links record 19 story prerequisites; the existing FUCQ-7 → FUCQ-35 dependency is preserved.

Refinement: [modern manual journey](manual-journey-refinement.md). Structured source: [fucq-6-stories.json](fucq-6-stories.json). Template: [_dev/story-template.md](../../_dev/story-template.md). [Publication evidence](evidence/fucq-6/story-publication.json) records native field, description and relationship read-back. This authoring did not start implementation or a dispatcher.

Russell requested FUCQ-7 refinement on 1 November 2026. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, manual-journey-refinement.md, COMPONENTS.md and the canonical docs/design/high-level-design.drawio with docs/design/gcsp-high-level-design.md. The eight supplied screenshots govern header/sidebar/palette; their dense forms and seven-step wizard are historical information evidence. Redesign the body toward Used Cars. FUCQ-64 must record and review one representative body with Russell/Gary before other body designs fan out. Use shared components and scenario-scoped tokens; FUCQ-31 owns shared decision-card/control contracts and establishing/extending the single gallery, FUCQ-7 owns shell and manual page composition. Reuse one gallery and extend ratchet coverage to all new GCSP JS/CSS. Carry the experience contract, reviewed reference and these acceptance/validation criteria into every descendant brief. Use the existing Node/vanilla-ES-module stack and replaceable adapters; keep synthetic assumptions, image fidelity and unavailable facts explicit. October 2024 is the accepted eligibility baseline. BMW-only initially; preserve all six retail brands/five modes. Do not treat a shared demo password or URL employee ID as identity. Do not implement buddy automation, mail, Greg planning or downstream lifecycle here. Proposed test files below are deliverables, not existing verification results.

| Story | Outcome | Depends on |
|---|---|---|
| [FUCQ-64](https://ibm-consulting.atlassian.net/browse/FUCQ-64) | Build the shared GCSP shell and review an employee body reference | none |
| [FUCQ-65](https://ibm-consulting.atlassian.net/browse/FUCQ-65) | Resolve manual-selection context and validate employee journey drafts | FUCQ-26, FUCQ-29 |
| [FUCQ-66](https://ibm-consulting.atlassian.net/browse/FUCQ-66) | Persist exact manual claims and expiry through a shared authority | FUCQ-65 |
| [FUCQ-67](https://ibm-consulting.atlassian.net/browse/FUCQ-67) | Show current contracts and start the right new or replacement journey | FUCQ-64, FUCQ-65 |
| [FUCQ-68](https://ibm-consulting.atlassian.net/browse/FUCQ-68) | Collect scheme driver and collection choices without losing context | FUCQ-67 |
| [FUCQ-69](https://ibm-consulting.atlassian.net/browse/FUCQ-69) | Browse released cars with visual cards and complete vehicle details | FUCQ-68, FUCQ-31 |
| [FUCQ-70](https://ibm-consulting.atlassian.net/browse/FUCQ-70) | Review a claimed car with contact details and return mileage | FUCQ-66, FUCQ-69 |
| [FUCQ-71](https://ibm-consulting.atlassian.net/browse/FUCQ-71) | Submit manual selections through an idempotent ordering adapter | FUCQ-66 |
| [FUCQ-72](https://ibm-consulting.atlassian.net/browse/FUCQ-72) | Review declarations and show the actual order handoff outcome | FUCQ-70, FUCQ-71 |
| [FUCQ-73](https://ibm-consulting.atlassian.net/browse/FUCQ-73) | Verify the complete manual journey and its employee entry contract | FUCQ-67, FUCQ-68, FUCQ-69, FUCQ-70, FUCQ-71, FUCQ-72 |

Independent evidence and final review requested/selected gpt-6.1-sol/high (reviewer/Opus); component research requested/selected gpt-6.1-sol/medium (Sonnet implementer). No fallback or descendants. Effective runtime settings were not independently inspected. Final review: PASS, no blocking or major issues; its minor contract/test wording corrections are incorporated. No application tests were run for this authoring-only change. SQL provider/deployment confirmation (GC-003), full declarations and other SAN assumptions remain visible in the stories.

---

### [FUCQ-64](https://ibm-consulting.atlassian.net/browse/FUCQ-64) · Build the shared GCSP shell and review an employee body reference

Scaffolding template: `_dev/story-template.md`. Jira supplies story ID/title/parent/priority; kind/size/design impact are labels. Story points are assigned by the implementing agent.

```text
kind: ui
design_impact: yes
ui: el, mediaWell, existing card/button/status primitives; new: portalShell and accountNavigation, because no existing component supplies portal landmarks, account context and narrow icon navigation. Coordinate shared primitives/gallery with FUCQ-31.
requested: 2026-11-01, by Russell via Codex (backlog FUCQ-7, manual journey refinement)
epic: FUCQ-7
priority: P3
priority_reason: from FUCQ-7
size: L
depends_on: none
```

## Goal

As an employee, I want a recognisable portal with a clear, visual car-selection experience so the manual route feels coherent and easy to use.

## Acceptance criteria

- [ ] Build one reusable slim branded header with account context, narrow icon sidebar with meaningful labels/active state, content landmarks and optional breadcrumbs from screenshots 00–07. Exclude browser/OS chrome; unimplemented destinations are honestly unavailable rather than decorative dead links.
- [ ] Use GCSP-scoped semantic neutral/teal tokens without changing retail themes. Reuse or extract shared headings/buttons/status/fact primitives; catalogue additions and extend the single component gallery, avoiding duplicate card/control/gallery ownership with FUCQ-31.
- [ ] Compose a representative current-car plus selection surface using a small explicit fixture: substantial vehicle imagery, readable model/specification and contract hierarchy, clear primary action, points/contribution with units and image/missing-fact labels. It demonstrates information-rich body composition without reproducing the dense portal tables or legacy seven-step layout.
- [ ] Review the actual representative desktop and narrow body with Russell/Gary, record its repository path/revision and observations under docs/gcsp/evidence/fucq-6/, and use that reference in consuming stories. This internal design review is a completion prerequisite for FUCQ-64; supplied screenshots already clear the external missing-reference concern.
- [ ] Export/document a testable employee entry/mount/teardown contract and navigation context for FUCQ-35. Shell harnesses may use explicit fixtures; the public launcher remains unavailable until the real journey exists. Do not create another route serializer or make FUCQ-64 depend on FUCQ-35.
- [ ] Desktop and 320px layouts handle long names, absent imagery, loading/unavailable account states, keyboard navigation, visible focus, meaningful account/menu labels and reduced motion. New paths/styles have explicit ratchet coverage without raising old baselines.

## Files or areas

- `blocks/gcsp/ (proposed shell, scoped tokens and entry)`
- `blocks/vehicle-matcher/ui.js and tokens.css where genuinely shared`
- `COMPONENTS.md`
- `single developer component gallery`
- `server/test/gcsp-shell.test.js (proposed)`
- `server/test/ui-ratchet.test.js and ui-ratchet.json`
- `docs/gcsp/evidence/fucq-6/`

## Decided

Russell requested FUCQ-7 refinement on 1 November 2026. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, manual-journey-refinement.md, COMPONENTS.md and the canonical docs/design/high-level-design.drawio with docs/design/gcsp-high-level-design.md. The eight supplied screenshots govern header/sidebar/palette; their dense forms and seven-step wizard are historical information evidence. Redesign the body toward Used Cars. FUCQ-64 must record and review one representative body with Russell/Gary before other body designs fan out. Use shared components and scenario-scoped tokens; FUCQ-31 owns shared decision-card/control contracts and establishing/extending the single gallery, FUCQ-7 owns shell and manual page composition. Reuse one gallery and extend ratchet coverage to all new GCSP JS/CSS. Carry the experience contract, reviewed reference and these acceptance/validation criteria into every descendant brief. Use the existing Node/vanilla-ES-module stack and replaceable adapters; keep synthetic assumptions, image fidelity and unavailable facts explicit. October 2024 is the accepted eligibility baseline. BMW-only initially; preserve all six retail brands/five modes. Do not treat a shared demo password or URL employee ID as identity. Do not implement buddy automation, mail, Greg planning or downstream lifecycle here. Proposed test files below are deliverables, not existing verification results.

The portal shell is owned by FUCQ-7, not FUCQ-13 or FUCQ-31. Do not block independent shell work on all recommendation or vehicle-evidence stories; coordinate contracts first. Detailed body composition remains a reviewed implementation deliverable.

## Out of scope

A new visual identity, retail redesign, launcher implementation, role administration, buddy/preference pages and claims of a working transaction from the fixture surface.

## Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- node --test server/test/gcsp-shell.test.js server/test/ui-ratchet.test.js server/test/render.test.js — landmarks, mount/teardown, responsive navigation, token isolation and retail mounts pass.
- npm run serve and npm run server; inspect shell plus representative body at desktop and 320px, keyboard and reduced motion. Record the reviewed reference and screenshot paths, including missing-image/loading/error examples.

---

### [FUCQ-65](https://ibm-consulting.atlassian.net/browse/FUCQ-65) · Resolve manual-selection context and validate employee journey drafts

Scaffolding template: `_dev/story-template.md`. Jira supplies story ID/title/parent/priority; kind/size/design impact are labels. Story points are assigned by the implementing agent.

```text
kind: code
design_impact: yes
requested: 2026-11-01, by Russell via Codex (backlog FUCQ-7, manual journey refinement)
epic: FUCQ-7
priority: P3
priority_reason: from FUCQ-7
size: L
depends_on: FUCQ-26, FUCQ-29
```

## Goal

As an employee, I want my account and permitted ordering choices supplied consistently so each decision uses my actual scheme context.

## Acceptance criteria

- [ ] Add replaceable employee/contract, driver, scheme/terms, collection-rule and released-stock ports within the existing backend. The server resolves one configured fictional principal and entitled renewal/vehicle slot; reject caller attempts to change employee, grade, scheme support or policy through URL/body fields.
- [ ] Expose account/driver/licence summaries, per-scheme contract/order history and contextual Order/Replace actions, with absent-HR-account, no entitlement, no contract, unknown scheme/grade, unavailable source and valid empty history as distinct outcomes. Initial enabled ordering is BMW within one explicitly selected October 2024 matrix; unsupported history remains readable where supplied without implying ordering support.
- [ ] Provide a versioned manual draft with new/replacement mode, old contract and entitlement slot, scheme, nominated driver, contract term+mileage, requested collection date/location, brand, contact details, expected return mileage and bounded special requirements. Preserve exact IDs and source/effective versions; never merge incompatible screenshot rows into one employee transaction.
- [ ] Reuse the server-owned gates and typed facts/terms from FUCQ-26/FUCQ-29; expose complete eligible released-stock results for manual browsing without requiring preference ranking. Catalogue constructibility and displayed model images do not establish availability. Fail closed for unknown decision-critical eligibility/driver facts.
- [ ] Validate permitted driver/contract/date/location combinations, points allowance, scheme-authorised contribution/top-up with currency/period and applicable insurance/grade gates. Do not impose a universal over-allowance ban or infer a current conversion from the 2024 guide. Missing tables or unconfirmed rules use documented synthetic configuration and appropriate confirmation-needed states.
- [ ] Version draft updates and reject stale writes. Changing scheme/driver/contract/timing or vehicle slot invalidates dependent choices/quotes explicitly. Keep current-car return mileage distinct from new-car odometer and current contract dates distinct from requested collection.
- [ ] Define the view/error contract consumed by FUCQ-67–FUCQ-72, including editability and support ownership. Use fictional records; no screenshot contact/licence details or secrets enter fixtures/logs. Integration tests exercise equivalent synthetic and real-shaped payload contracts.

## Files or areas

- `server/gcsp/ (proposed application services, ports, view projections and HTTP handlers)`
- `server/index.js`
- `server/test/gcsp-manual-context.test.js (proposed)`
- `server/test/fixtures/gcsp/ (proposed)`
- `docs/gcsp/manual-journey-refinement.md`

## Decided

Russell requested FUCQ-7 refinement on 1 November 2026. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, manual-journey-refinement.md, COMPONENTS.md and the canonical docs/design/high-level-design.drawio with docs/design/gcsp-high-level-design.md. The eight supplied screenshots govern header/sidebar/palette; their dense forms and seven-step wizard are historical information evidence. Redesign the body toward Used Cars. FUCQ-64 must record and review one representative body with Russell/Gary before other body designs fan out. Use shared components and scenario-scoped tokens; FUCQ-31 owns shared decision-card/control contracts and establishing/extending the single gallery, FUCQ-7 owns shell and manual page composition. Reuse one gallery and extend ratchet coverage to all new GCSP JS/CSS. Carry the experience contract, reviewed reference and these acceptance/validation criteria into every descendant brief. Use the existing Node/vanilla-ES-module stack and replaceable adapters; keep synthetic assumptions, image fidelity and unavailable facts explicit. October 2024 is the accepted eligibility baseline. BMW-only initially; preserve all six retail brands/five modes. Do not treat a shared demo password or URL employee ID as identity. Do not implement buddy automation, mail, Greg planning or downstream lifecycle here. Proposed test files below are deliverables, not existing verification results.

FUCQ-29 owns recommendation policy; this story consumes its server-owned gates/context contracts rather than adding another permissive employee matcher. FUCQ-65 defines/consumes the repository interface with contract test doubles; FUCQ-66 supplies durable persistence, so FUCQ-65 has no implementation dependency back on FUCQ-66. No connected-use or saved buddy-brief feature is introduced.

## Out of scope

BMW SSO provisioning, live HR/stock writes, new eligibility matrices/brands, points-policy design, weighted recommendation UI, additional-driver maintenance and connected telemetry.

## Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- node --test server/test/gcsp-manual-context.test.js — principal/slot isolation, source failures vs absence, typed terms, conditional fields, draft version conflicts and recomputation pass.
- node --test server/test/employee-recommendation.test.js server/test/employee-recommendation-api.test.js server/test/api.test.js — reuse the implemented FUCQ-29 policy checks and retained API compatibility; if its delivered test name differs, record the actual command.
- npm test — passes. No independent new screen is introduced; record presentation-contract fixtures and leave rendered state evidence to consuming UI stories.

---

### [FUCQ-66](https://ibm-consulting.atlassian.net/browse/FUCQ-66) · Persist exact manual claims and expiry through a shared authority

Scaffolding template: `_dev/story-template.md`. Jira supplies story ID/title/parent/priority; kind/size/design impact are labels. Story points are assigned by the implementing agent.

```text
kind: code
design_impact: yes
requested: 2026-11-01, by Russell via Codex (backlog FUCQ-7, manual journey refinement)
epic: FUCQ-7
priority: P3
priority_reason: from FUCQ-7
size: L
depends_on: FUCQ-65
preconditions: Resolve GC-003 with Gary: record the SQL provider/configuration and deployable persistence choice before integration completion. Canonical HLD proposes PostgreSQL behind a repository port; no hosting/subscription provisioning is authorised by this story.
```

## Goal

As an employee selecting scarce stock, I want a real exclusive claim so another chooser cannot take the same car while I review it.

## Acceptance criteria

- [ ] Implement the manual slice of the HLD transaction repository/stock-action authority: versioned drafts, run-scoped shared exact stock with employee/entitlement-scoped access and claims, claims, pinned quotes, expiry and pending operations. Retain state across backend restart using the agreed SQL repository provider; in-memory/browser-only storage cannot satisfy completion.
- [ ] Browsing never reserves. An explicit Review/select action conditionally claims one exact released vehicle after revalidating current employee/driver eligibility, entitlement limits, draft/stock versions and terms. Two competing employees or tabs produce at most one active holder; retries are idempotent.
- [ ] Store server expiry timestamps and configurable, separately named manual preview and order-review timing semantics. Their precise defaults/transition are documented demo assumptions pending SAN-017, not screenshot seconds or the buddy's proposed two-hour hold. Moving between views or refreshing cannot reset expiry.
- [ ] Define replace/change/back/cancel behaviour: no silent second hold, no abandoned leaked claim, and a released car becomes available only after confirmed release. Expiry reconciliation works on server reads/commands, startup and explicit demo clock ticks without an active browser; do not claim unattended scheduling on a sleeping host.
- [ ] Use the same authority/ports planned for future buddy access, without implementing buddy allocation. For remote-shaped adapters persist uncertain claims/releases as pending, reconcile before retry/reallocation and never turn a timeout into success or an available car.
- [ ] Expose current claim/status/quote reads for reload and concurrent sessions; isolate fictional principals/runs and reject stale or cross-principal commands. Reset is an explicitly authorised synthetic-run fixture operation and cannot touch operational providers.
- [ ] Record a minimal synthetic policy/stock fixture plus deterministic clock and repository contract evidence. Missing or failed storage returns clear unavailable/pending outcomes, never a fake successful reservation.

## Files or areas

- `server/gcsp/transaction-repository and stock-action services (proposed)`
- `server/gcsp/adapters/ (proposed SQL and synthetic stock adapters)`
- `server/index.js`
- `server/test/gcsp-manual-claims.test.js (proposed)`
- `server/test/gcsp-repository-contract.test.js (proposed)`
- `docs/gcsp/evidence/fucq-6/`

## Decided

Russell requested FUCQ-7 refinement on 1 November 2026. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, manual-journey-refinement.md, COMPONENTS.md and the canonical docs/design/high-level-design.drawio with docs/design/gcsp-high-level-design.md. The eight supplied screenshots govern header/sidebar/palette; their dense forms and seven-step wizard are historical information evidence. Redesign the body toward Used Cars. FUCQ-64 must record and review one representative body with Russell/Gary before other body designs fan out. Use shared components and scenario-scoped tokens; FUCQ-31 owns shared decision-card/control contracts and establishing/extending the single gallery, FUCQ-7 owns shell and manual page composition. Reuse one gallery and extend ratchet coverage to all new GCSP JS/CSS. Carry the experience contract, reviewed reference and these acceptance/validation criteria into every descendant brief. Use the existing Node/vanilla-ES-module stack and replaceable adapters; keep synthetic assumptions, image fidelity and unavailable facts explicit. October 2024 is the accepted eligibility baseline. BMW-only initially; preserve all six retail brands/five modes. Do not treat a shared demo password or URL employee ID as identity. Do not implement buddy automation, mail, Greg planning or downstream lifecycle here. Proposed test files below are deliverables, not existing verification results.

Follow the canonical HLD transaction invariants, including pending remote-operation reconciliation. Manual timing is independent from buddy policy. A deployable SQL provider is a recorded GC-003 prerequisite; do not silently replace it with ephemeral Render memory/files or provision infrastructure.

## Out of scope

Buddy matching/allocation, notifications/outbox delivery, two-hour offer policy, production integration, Greg controls and general lifecycle orchestration.

## Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- node --test server/test/gcsp-manual-claims.test.js — exact-car contention, retries, stale versions, expiry, cancellation/replacement, pending remote responses and cross-principal/run rejection pass using an injected clock.
- node --test server/test/gcsp-repository-contract.test.js — run against the configured SQL provider; prove persistence across repository/process reopen, rollback and concurrent claim uniqueness. A skipped provider integration is remaining work.
- npm test — passes. Supply response/state fixtures for expired/unavailable/conflict/pending UI; browser evidence belongs to FUCQ-70/FUCQ-72.

---

### [FUCQ-67](https://ibm-consulting.atlassian.net/browse/FUCQ-67) · Show current contracts and start the right new or replacement journey

Scaffolding template: `_dev/story-template.md`. Jira supplies story ID/title/parent/priority; kind/size/design impact are labels. Story points are assigned by the implementing agent.

```text
kind: ui
design_impact: no
ui: FUCQ-64 portalShell, mediaWell and shared card/fact/status/button primitives; new: contractSummary and schemeHistory only if existing shared composition cannot express dated contracts/history.
requested: 2026-11-01, by Russell via Codex (backlog FUCQ-7, manual journey refinement)
epic: FUCQ-7
priority: P3
priority_reason: from FUCQ-7
size: M
depends_on: FUCQ-64, FUCQ-65
```

## Goal

As an employee, I want to understand my current cars and contracts so I can start the appropriate permitted selection.

## Acceptance criteria

- [ ] Render the account information inventory for screenshots 00/01 in manual-journey-refinement.md: employee/company/grade/contact context, licence/additional-driver summaries, current car and dated contract facts, order histories grouped by scheme, row status and meaningful Order/Replace/Print/history actions where supported.
- [ ] Use a vehicle-led current-car card with actual contract end/countdown calculated from supplied dates, term+mileage, allowance/contribution and relevant replacement action. Do not treat order receipt as collection or overwrite the existing current car when a replacement is merely selected.
- [ ] Make less frequent identity/licence/history/technical fields accessible in labelled detail sections without hiding decision-critical cost, dates, driver or status. Histories support realistic long names/multiple vehicles and record counts; fictional data is coherent across the journey.
- [ ] Show missing-HR-account support, no current car/history, renewal not yet eligible, unsupported ordering scheme and source failure with distinct reasons/actions. Provide a New order branch when allowed and Replace tied to the selected contract and vehicle slot; neither is an unguarded shortcut.
- [ ] Use existing vehicle-evidence adapters where delivered, with a small provenance-labelled fixture permitted initially; representative images/unknown exact specification have designed fallbacks. Connected-use summaries and buddy preferences are separate scope.
- [ ] Carry the selected old contract/slot into FUCQ-68 and preserve context across Back/reload with the server draft. Initial body review uses the FUCQ-64 recorded reference; keyboard, long/missing data and 320px behaviour match that reference.

## Files or areas

- `blocks/gcsp/account and contracts views (proposed)`
- `COMPONENTS.md and single gallery for new consumed components`
- `server/test/gcsp-account-render.test.js (proposed)`
- `docs/gcsp/evidence/fucq-6/`

## Decided

Russell requested FUCQ-7 refinement on 1 November 2026. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, manual-journey-refinement.md, COMPONENTS.md and the canonical docs/design/high-level-design.drawio with docs/design/gcsp-high-level-design.md. The eight supplied screenshots govern header/sidebar/palette; their dense forms and seven-step wizard are historical information evidence. Redesign the body toward Used Cars. FUCQ-64 must record and review one representative body with Russell/Gary before other body designs fan out. Use shared components and scenario-scoped tokens; FUCQ-31 owns shared decision-card/control contracts and establishing/extending the single gallery, FUCQ-7 owns shell and manual page composition. Reuse one gallery and extend ratchet coverage to all new GCSP JS/CSS. Carry the experience contract, reviewed reference and these acceptance/validation criteria into every descendant brief. Use the existing Node/vanilla-ES-module stack and replaceable adapters; keep synthetic assumptions, image fidelity and unavailable facts explicit. October 2024 is the accepted eligibility baseline. BMW-only initially; preserve all six retail brands/five modes. Do not treat a shared demo password or URL employee ID as identity. Do not implement buddy automation, mail, Greg planning or downstream lifecycle here. Proposed test files below are deliverables, not existing verification results.

Preserve the account/history information without recreating screenshot table composition. Historical motorcycle/other-scheme records do not authorise new scheme ordering. Exact VIN/build facts remain separate from handbook/model-level evidence.

## Out of scope

Editing HR/licence/additional-driver source records, connected usage, buddy briefs, contract extension decisions and downstream appointment actions.

## Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- node --test server/test/gcsp-account-render.test.js — coherent multi-contract account, new/replacement branch, entitlement/support/error states and context retention pass.
- node --test server/test/ui-ratchet.test.js server/test/render.test.js; npm test — pass.
- Browser: desktop/320px account and replacement flows, keyboard detail/history controls, missing image, multiple slots, absent HR and not-yet-eligible states; save captures and reviewed observations.

---

### [FUCQ-68](https://ibm-consulting.atlassian.net/browse/FUCQ-68) · Collect scheme driver and collection choices without losing context

Scaffolding template: `_dev/story-template.md`. Jira supplies story ID/title/parent/priority; kind/size/design impact are labels. Story points are assigned by the implementing agent.

```text
kind: ui
design_impact: no
ui: portalShell, renderOptionList, shared labelled form/date/status/button primitives; add shared driverSummary and validationSummary only where none fits.
requested: 2026-11-01, by Russell via Codex (backlog FUCQ-7, manual journey refinement)
epic: FUCQ-7
priority: P3
priority_reason: from FUCQ-7
size: L
depends_on: FUCQ-67
```

## Goal

As an employee, I want clear prefilled ordering choices so the cars shown match the driver, terms and collection I need.

## Acceptance criteria

- [ ] Present scheme as trusted context and collect/confirm nominated driver or self, relationship and relevant licence validity, contract term with mileage, requested collection date, collection location and supported brand. Show only allowed combinations supplied by FUCQ-65 and explain disabled choices.
- [ ] Prefill known facts and distinguish editable contact/draft information from source-owned HR/licence data; provide an honest support/correction route. New orders and replacements handle absence of an old vehicle and expected-return-mileage requirements appropriately.
- [ ] Show applicable allowance/points and contribution context with units and period before vehicle selection. A permitted top-up is explained and confirmed according to configured scheme rules; missing or unresolved cost/eligibility information is never silently accepted.
- [ ] Validate required fields, licence/date/collection-window constraints and conditional requirements server-side and inline. Requested collection is neither earliest availability nor a confirmed appointment; changing a choice refreshes downstream availability and invalidates stale quote/claim context visibly.
- [ ] Preserve draft choices through Back/reload, show version conflict/source errors with recovery, and prevent duplicate progression requests. Avoid a forced one-field-per-page wizard; use the reviewed grouped body with clear progression and an accessible error summary.
- [ ] Use the FUCQ-64 body reference and shared controls; inspect self/additional-driver, new/replacement, unavailable location/date and long/absent-data cases at desktop and narrow widths with keyboard focus management.

## Files or areas

- `blocks/gcsp/manual setup views/controllers (proposed)`
- `shared kit forms/validation where required`
- `server/test/gcsp-manual-setup.test.js (proposed)`
- `COMPONENTS.md and gallery`
- `docs/gcsp/evidence/fucq-6/`

## Decided

Russell requested FUCQ-7 refinement on 1 November 2026. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, manual-journey-refinement.md, COMPONENTS.md and the canonical docs/design/high-level-design.drawio with docs/design/gcsp-high-level-design.md. The eight supplied screenshots govern header/sidebar/palette; their dense forms and seven-step wizard are historical information evidence. Redesign the body toward Used Cars. FUCQ-64 must record and review one representative body with Russell/Gary before other body designs fan out. Use shared components and scenario-scoped tokens; FUCQ-31 owns shared decision-card/control contracts and establishing/extending the single gallery, FUCQ-7 owns shell and manual page composition. Reuse one gallery and extend ratchet coverage to all new GCSP JS/CSS. Carry the experience contract, reviewed reference and these acceptance/validation criteria into every descendant brief. Use the existing Node/vanilla-ES-module stack and replaceable adapters; keep synthetic assumptions, image fidelity and unavailable facts explicit. October 2024 is the accepted eligibility baseline. BMW-only initially; preserve all six retail brands/five modes. Do not treat a shared demo password or URL employee ID as identity. Do not implement buddy automation, mail, Greg planning or downstream lifecycle here. Proposed test files below are deliverables, not existing verification results.

The screenshot's seven-step navigation is not a mandatory layout. Do not infer authoritative contract lengths, licence rules or collection windows from junk INT values. SAN-018/019 cover those gaps; documented synthetic rules allow demo progress.

## Out of scope

Creating or approving additional drivers/licences, new brand/scheme support, real appointment booking and background-search consent.

## Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- node --test server/test/gcsp-manual-setup.test.js — conditional self/nominated driver, new/replacement, required fields, invalid combinations and stale draft handling pass.
- node --test server/test/ui-ratchet.test.js; npm test — pass.
- Browser: desktop/320px valid and invalid setups, keyboard/date controls, error summary/focus, back/reload and changed-choice invalidation; save actual evidence.

---

### [FUCQ-69](https://ibm-consulting.atlassian.net/browse/FUCQ-69) · Browse released cars with visual cards and complete vehicle details

Scaffolding template: `_dev/story-template.md`. Jira supplies story ID/title/parent/priority; kind/size/design impact are labels. Story points are assigned by the implementing agent.

```text
kind: ui
design_impact: no
ui: matchCard, mediaWell, listingsOf, shared fact/term components, portalShell and status controls; extend callback/view-data contracts from FUCQ-31 rather than copy cards.
requested: 2026-11-01, by Russell via Codex (backlog FUCQ-7, manual journey refinement)
epic: FUCQ-7
priority: P3
priority_reason: from FUCQ-7
size: L
depends_on: FUCQ-68, FUCQ-31
```

## Goal

As an employee choosing manually, I want attractive car choices with all relevant facts so I can compare what is actually available.

## Acceptance criteria

- [ ] Replace series/body tiles and the dense model table with visual series/body navigation and exact-car cards using the complete authorised released-stock projection. Preserve quick text search, useful sorting, availability/record counts and a discoverable path to all eligible exact vehicles; browsing never claims.
- [ ] Retain screenshot 03–05 facts: available allowance, model/body/engine, exterior/interior, monthly scheme cost/contribution with period, points where available, NEDC and WLTP CO2 as distinct typed observations, transmission, insurance group and earliest collection. Missing values stay unknown, not zero.
- [ ] Vehicle details expose configured options/equipment, specification, image disclaimer/provenance and relevant historic fields from the inventory. Distinguish exact fitted facts, model/reference data and representative images. Stock/quote/identity remain aligned when changing exact member; no aggregate equipment union becomes an exact claim.
- [ ] Ineligible or confirmation-needed choices are explained without active select/claim actions. No suitable stock, source outage, loading, empty search and car-taken-since-listing are distinct recoverable states. Do not display a weighted fit score or recommendation explanation unless actually supplied for this manual context.
- [ ] Show the same information in a stronger visual hierarchy: large useful imagery, concise key facts, visible cost/availability, readable expandable technical details and a clear explicit Review this car action. Match FUCQ-64's recorded design and FUCQ-31's card contract.
- [ ] Use FUCQ-14/15 evidence interfaces or contract-compatible small dated/synthetic fixtures without blocking on live BMW access, VIN generation or 10,000 configurations. State precisely which provider/corpus was used in evidence.
- [ ] Search/sort/series/detail controls work by keyboard and at 320px; long model/option names and image/data failures do not break cards or hide decision-critical facts. Hand the chosen exact ID/revisions to FUCQ-70, without claiming from a catalogue/image ID.

## Files or areas

- `blocks/gcsp/manual gallery and vehicle detail views (proposed)`
- `blocks/vehicle-matcher/modes/result-card.js through FUCQ-31 contracts`
- `server/test/gcsp-manual-gallery.test.js (proposed)`
- `COMPONENTS.md and gallery`
- `docs/gcsp/evidence/fucq-6/`

## Decided

Russell requested FUCQ-7 refinement on 1 November 2026. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, manual-journey-refinement.md, COMPONENTS.md and the canonical docs/design/high-level-design.drawio with docs/design/gcsp-high-level-design.md. The eight supplied screenshots govern header/sidebar/palette; their dense forms and seven-step wizard are historical information evidence. Redesign the body toward Used Cars. FUCQ-64 must record and review one representative body with Russell/Gary before other body designs fan out. Use shared components and scenario-scoped tokens; FUCQ-31 owns shared decision-card/control contracts and establishing/extending the single gallery, FUCQ-7 owns shell and manual page composition. Reuse one gallery and extend ratchet coverage to all new GCSP JS/CSS. Carry the experience contract, reviewed reference and these acceptance/validation criteria into every descendant brief. Use the existing Node/vanilla-ES-module stack and replaceable adapters; keep synthetic assumptions, image fidelity and unavailable facts explicit. October 2024 is the accepted eligibility baseline. BMW-only initially; preserve all six retail brands/five modes. Do not treat a shared demo password or URL employee ID as identity. Do not implement buddy automation, mail, Greg planning or downstream lifecycle here. Proposed test files below are deliverables, not existing verification results.

Manual selection is a full released-stock browse, not a configurator or a top-N recommendation list. FUCQ-31 owns shared card changes; FUCQ-7 owns composition/controller. Image snapshots are representative and never authoritative stock. Existing screenshot RETAIL price is not relabelled as salary contribution.

## Out of scope

Catalogue collection, live imagery access, VIN fabrication, new comparison feature, preference/ranking UI and configurator ordering.

## Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- node --test server/test/gcsp-manual-gallery.test.js — full candidate reachability, search/sort, exact-member facts/terms, typed emissions, unknowns and source/no-stock distinctions pass.
- node --test server/test/shared-kit-contracts.test.js server/test/ui-ratchet.test.js server/test/render.test.js; npm test — pass using delivered shared-kit test names.
- Browser: desktop/320px gallery→exact details, keyboard, long options, image failure, ineligible/unknown and empty/unavailable states; save captures against FUCQ-64 reference.

---

### [FUCQ-70](https://ibm-consulting.atlassian.net/browse/FUCQ-70) · Review a claimed car with contact details and return mileage

Scaffolding template: `_dev/story-template.md`. Jira supplies story ID/title/parent/priority; kind/size/design impact are labels. Story points are assigned by the implementing agent.

```text
kind: ui
design_impact: no
ui: portalShell, shared vehicle/fact/typed-term components, labelled forms, statusScreen and button; new shared expiryStatus only if none fits.
requested: 2026-11-01, by Russell via Codex (backlog FUCQ-7, manual journey refinement)
epic: FUCQ-7
priority: P3
priority_reason: from FUCQ-7
size: M
depends_on: FUCQ-66, FUCQ-69
```

## Goal

As an employee reviewing a car, I want a trustworthy hold and clear required details so I understand the time and information needed to continue.

## Acceptance criteria

- [ ] Review this car calls FUCQ-66's exact conditional claim once and shows active hold only after confirmation. Loading, taken/conflict, ineligible, source unavailable and pending/uncertain claim have appropriate recovery; a timeout never displays a held car.
- [ ] Retain the screenshot 05 information: exact vehicle and typed quote, representative-image label, required phone/email, expected mileage for the returning vehicle when replacement applies, and optional special requirements with the evidenced 500-character cap/counter enforced on client and server.
- [ ] Show a useful server-derived hold/review countdown and its consequence, with accessible low-time/expired announcements that do not speak every second. Both timing phases follow configured policy; refresh, Back/Forward, clock skew or reopening does not extend the claim.
- [ ] Expired or lost claims disable continuation, preserve safe draft inputs and offer a clear route to refresh stock. Back/change/cancel uses the defined release policy and does not quietly retain a second car or restore a released claim.
- [ ] Keep requested collection, old contract/slot and return-mileage context visible. Validation identifies the exact field and focuses an error summary; input failure must not silently submit a partial review.
- [ ] Use FUCQ-64's reviewed body and FUCQ-31 shared components at desktop/320px with keyboard, long names and missing-image support. Expose current claim read after reload rather than relying on a client-only hold flag.

## Files or areas

- `blocks/gcsp/manual claim/review view and controller (proposed)`
- `shared expiry/form/status components where needed`
- `server/test/gcsp-manual-review.test.js (proposed)`
- `COMPONENTS.md and gallery`
- `docs/gcsp/evidence/fucq-6/`

## Decided

Russell requested FUCQ-7 refinement on 1 November 2026. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, manual-journey-refinement.md, COMPONENTS.md and the canonical docs/design/high-level-design.drawio with docs/design/gcsp-high-level-design.md. The eight supplied screenshots govern header/sidebar/palette; their dense forms and seven-step wizard are historical information evidence. Redesign the body toward Used Cars. FUCQ-64 must record and review one representative body with Russell/Gary before other body designs fan out. Use shared components and scenario-scoped tokens; FUCQ-31 owns shared decision-card/control contracts and establishing/extending the single gallery, FUCQ-7 owns shell and manual page composition. Reuse one gallery and extend ratchet coverage to all new GCSP JS/CSS. Carry the experience contract, reviewed reference and these acceptance/validation criteria into every descendant brief. Use the existing Node/vanilla-ES-module stack and replaceable adapters; keep synthetic assumptions, image fidelity and unavailable facts explicit. October 2024 is the accepted eligibility baseline. BMW-only initially; preserve all six retail brands/five modes. Do not treat a shared demo password or URL employee ID as identity. Do not implement buddy automation, mail, Greg planning or downstream lifecycle here. Proposed test files below are deliverables, not existing verification results.

Short manual timing remains a versioned synthetic policy until Sandeep confirms it. The screenshot's remaining seconds are not duration defaults. Return mileage concerns the previous car; no old car means the replacement-only requirement is absent.

## Out of scope

Buddy offers, extending holds, real mail/phone validation services, document uploads and appointment confirmation.

## Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- node --test server/test/gcsp-manual-review.test.js — claim success/pending/conflict, expiry/reopen, required contact/conditional return mileage, 500-character boundary and cancel/change pass.
- node --test server/test/ui-ratchet.test.js; npm test — pass.
- Browser: desktop/320px claimed-car form, keyboard validation/focus, countdown expiry, network timeout/pending and back/reload with an injected short clock; save actual captures.

---

### [FUCQ-71](https://ibm-consulting.atlassian.net/browse/FUCQ-71) · Submit manual selections through an idempotent ordering adapter

Scaffolding template: `_dev/story-template.md`. Jira supplies story ID/title/parent/priority; kind/size/design impact are labels. Story points are assigned by the implementing agent.

```text
kind: code
design_impact: yes
requested: 2026-11-01, by Russell via Codex (backlog FUCQ-7, manual journey refinement)
epic: FUCQ-7
priority: P3
priority_reason: from FUCQ-7
size: L
depends_on: FUCQ-66
```

## Goal

As an employee submitting a selection, I want one recorded order handoff with an honest status so I know what I have committed to.

## Acceptance criteria

- [ ] Add versioned terms/declaration read and selection-submit/order-read contracts behind replaceable scheme terms and ordering ports. Supply a coherent fictional terms version; the clipped screenshot cannot establish the full approved wording or set of controls.
- [ ] Submit checks principal/entitlement, exact live claim and expiry, draft/stock/policy versions, pinned terms/quote validity, required contact/return data, driver/licence and all applicable declarations again. Reject stale/expired/invalid submissions with reviewable reasons, without releasing confirmed ownership to another chooser mid-operation.
- [ ] Persist selection-received and pending handoff before an external-shaped write; an acknowledged synthetic adapter returns one generated order reference plus the actual approval-pending state. Repeated/double-click/retried requests return the same operation/order, never duplicate orders.
- [ ] Persist and reconcile unknown/time-out outcomes using the same operation/idempotency key before retry or reallocation. A failed or unsupported provider never produces an approval, order number or confirmation invented by the UI.
- [ ] Model configured HR/IS/manager approval flags as returned order status without building an approval workflow. Preserve snapshot terms/quote/employee/driver/old-contract/vehicle-slot facts for readback and print; new quotes do not silently change the recorded selection.
- [ ] Read/reopen/restart returns current pending/acknowledged/failure state and updates account history from the same store. A selection or awaiting-approval order does not confirm collection, end/return the old contract or replace the employee's current-car relationship.
- [ ] Prevent a second active selection for the same renewal/entitlement and stop competing manual claims for that slot after acknowledgement. Keep the common authority callable by future buddy acceptance without adding its offers/events/mail now.

## Files or areas

- `server/gcsp/manual selection/order services and ports (proposed)`
- `server/gcsp/adapters/synthetic-ordering (proposed)`
- `server/index.js`
- `server/test/gcsp-manual-order.test.js (proposed)`
- `server/test/gcsp-repository-contract.test.js (proposed)`
- `docs/gcsp/evidence/fucq-6/`

## Decided

Russell requested FUCQ-7 refinement on 1 November 2026. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, manual-journey-refinement.md, COMPONENTS.md and the canonical docs/design/high-level-design.drawio with docs/design/gcsp-high-level-design.md. The eight supplied screenshots govern header/sidebar/palette; their dense forms and seven-step wizard are historical information evidence. Redesign the body toward Used Cars. FUCQ-64 must record and review one representative body with Russell/Gary before other body designs fan out. Use shared components and scenario-scoped tokens; FUCQ-31 owns shared decision-card/control contracts and establishing/extending the single gallery, FUCQ-7 owns shell and manual page composition. Reuse one gallery and extend ratchet coverage to all new GCSP JS/CSS. Carry the experience contract, reviewed reference and these acceptance/validation criteria into every descendant brief. Use the existing Node/vanilla-ES-module stack and replaceable adapters; keep synthetic assumptions, image fidelity and unavailable facts explicit. October 2024 is the accepted eligibility baseline. BMW-only initially; preserve all six retail brands/five modes. Do not treat a shared demo password or URL employee ID as identity. Do not implement buddy automation, mail, Greg planning or downstream lifecycle here. Proposed test files below are deliverables, not existing verification results.

SAN-013/017/020 cover the real commitment and declarations. Demo defaults must be explicit and the result must say awaiting approval or handoff pending as appropriate. State semantics follow the HLD; no local button establishes BMW approval.

## Out of scope

Live BMW writes, approvals execution, document signing, confirmed booking, physical collection/return, buddy acceptance and email.

## Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- node --test server/test/gcsp-manual-order.test.js — terms/eligibility/expiry recheck, duplicate submit, lost response/reconciliation, unsupported provider, cross-principal and one-entitlement selection pass.
- node --test server/test/gcsp-repository-contract.test.js — acknowledged and pending outcomes survive reopen on the configured SQL provider; npm test passes.
- Record response fixtures for reviewable errors/pending/approval status; rendered evidence belongs to FUCQ-72.

---

### [FUCQ-72](https://ibm-consulting.atlassian.net/browse/FUCQ-72) · Review declarations and show the actual order handoff outcome

Scaffolding template: `_dev/story-template.md`. Jira supplies story ID/title/parent/priority; kind/size/design impact are labels. Story points are assigned by the implementing agent.

```text
kind: ui
design_impact: no
ui: portalShell, shared vehicle/typed-term/fact/form/status/button components; new: reviewSection and declarationGroup if existing controls cannot express readback and explicit acknowledgements.
requested: 2026-11-01, by Russell via Codex (backlog FUCQ-7, manual journey refinement)
epic: FUCQ-7
priority: P3
priority_reason: from FUCQ-7
size: L
depends_on: FUCQ-70, FUCQ-71
```

## Goal

As an employee, I want a clear final review and accurate outcome so I can make an informed selection and understand what happens next.

## Acceptance criteria

- [ ] Replace the dense screenshot 06 summary with readable review sections for order/contract/collection/contact/requirements, employee and nominated driver/licence, and exact car/specification/options/terms. Preserve every relevant inventory field through visible key facts or accessible details; distinguish absent historic values from required inputs.
- [ ] Provide edit links to the correct section with defined claim/quote invalidation. Display final allowance/points and cash contribution with currency/period, contract term+mileage, requested versus earliest collection and any return information. No screenshot inconsistency is copied into the synthetic transaction.
- [ ] Present all applicable versioned terms/declarations with accessible text/links and explicit unchecked acknowledgements, including employee and nominated-driver conditions where configured. The screenshot is clipped; use labelled synthetic wording until SAN-020 supplies approved wording. Submit stays unavailable until the requirements are met and server validation still applies.
- [ ] Show server-derived remaining time and expiry/current-claim status. Submission is an intentional action with in-progress feedback; duplicate click, expired claim, changed terms, taken car, rejected validation and unknown handoff show the returned current state plus useful recovery.
- [ ] Confirmation renders the generated order reference, returned approval-pending or handoff-pending status, exact order/employee/driver/car facts, requested collection and clear next steps. It never labels the car finally approved/collected or a requested date a booked appointment. Finish returns to account; Print produces the actual readback and omits controls.
- [ ] Reload/reopen/history displays the same current order; a lost response can recover it without creating another order. New-order and replacement, self and permitted nominated-driver branches use one coherent journey.
- [ ] Inspect actual reviewed/invalid/submitting/pending/acknowledged/expired/print states at desktop and 320px, keyboard and focus/status announcements, against FUCQ-64's reference. Shared components/gallery are extended consistently and all new UI/CSS remain ratchet-covered.

## Files or areas

- `blocks/gcsp/manual summary and order outcome views/controllers (proposed)`
- `shared review/declaration components where needed`
- `print stylesheet scoped to order readback`
- `server/test/gcsp-manual-summary.test.js (proposed)`
- `COMPONENTS.md and gallery`
- `docs/gcsp/evidence/fucq-6/`

## Decided

Russell requested FUCQ-7 refinement on 1 November 2026. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, manual-journey-refinement.md, COMPONENTS.md and the canonical docs/design/high-level-design.drawio with docs/design/gcsp-high-level-design.md. The eight supplied screenshots govern header/sidebar/palette; their dense forms and seven-step wizard are historical information evidence. Redesign the body toward Used Cars. FUCQ-64 must record and review one representative body with Russell/Gary before other body designs fan out. Use shared components and scenario-scoped tokens; FUCQ-31 owns shared decision-card/control contracts and establishing/extending the single gallery, FUCQ-7 owns shell and manual page composition. Reuse one gallery and extend ratchet coverage to all new GCSP JS/CSS. Carry the experience contract, reviewed reference and these acceptance/validation criteria into every descendant brief. Use the existing Node/vanilla-ES-module stack and replaceable adapters; keep synthetic assumptions, image fidelity and unavailable facts explicit. October 2024 is the accepted eligibility baseline. BMW-only initially; preserve all six retail brands/five modes. Do not treat a shared demo password or URL employee ID as identity. Do not implement buddy automation, mail, Greg planning or downstream lifecycle here. Proposed test files below are deliverables, not existing verification results.

Screenshot 07 is awaiting approval, not completed approval. Preserve Print and Finish; downstream approval/appointment execution remains separate. Declarations must be complete in the synthetic contract rather than guessing hidden screenshot content.

## Out of scope

Approval administration, downstream workflow execution, real signing/booking, marketing copy claiming production readiness and buddy notifications.

## Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- node --test server/test/gcsp-manual-summary.test.js — complete readback, section edits, declaration gating, generated reference, pending/retry/reopen and print rendering pass.
- node --test server/test/ui-ratchet.test.js server/test/render.test.js; npm test — pass.
- Browser: desktop/320px full new and replacement journeys, self/nominated driver, keyboard/validation, expired/pending/recovered response and print preview; save actual captures and status observations.

---

### [FUCQ-73](https://ibm-consulting.atlassian.net/browse/FUCQ-73) · Verify the complete manual journey and its employee entry contract

Scaffolding template: `_dev/story-template.md`. Jira supplies story ID/title/parent/priority; kind/size/design impact are labels. Story points are assigned by the implementing agent.

```text
kind: code
design_impact: no
requested: 2026-11-01, by Russell via Codex (backlog FUCQ-7, manual journey refinement)
epic: FUCQ-7
priority: P3
priority_reason: from FUCQ-7
size: M
depends_on: FUCQ-67, FUCQ-68, FUCQ-69, FUCQ-70, FUCQ-71, FUCQ-72
```

## Goal

As the demo owner, I want evidence that the modern manual route works end to end so it is a credible baseline beside the future buddy experience.

## Acceptance criteria

- [ ] Automate coherent new/self-driver and replacement/permitted-additional-driver journeys against synthetic providers through the real HTTP/application path and configured SQL repository. Assert chosen inputs reach one acknowledged order/current history; no named-winner or canned confirmation shortcut.
- [ ] Exercise no HR/entitlement, no stock vs outage, unknown essential/terms, stock contention, stale draft/quote, short hold expiry, double submit, lost provider response/pending reconciliation and process reopen. Current and requested/confirmed lifecycle dates remain distinct.
- [ ] Complete the screenshot information trace in manual-journey-refinement.md with implemented screen/component and evidence paths for every group, including history/driver details, search/sort, options, contact/return mileage, full terms/declarations and Print/Finish. Record any deliberate omission and owner decision.
- [ ] Verify the real employee mount/teardown/entry contract supplied to FUCQ-35 in a repository-prefix-safe direct harness. Do not implement FUCQ-35's launcher integration here or depend on it, which would create a circular dependency with FUCQ-7.
- [ ] Check retail's six brands/five modes and public API/link contracts remain compatible, as well as component gallery and explicit new JS/CSS ratchet coverage. Record exact revisions/provider/fixture/policy versions and outstanding GC-003/SAN limitations.
- [ ] Inspect desktop/320px full journey plus representative error/empty/loading/expired/pending states with keyboard, focus, contrast, long data, image failures, reduced motion and print. The story result includes actual screenshots/browser observations and independent review against FUCQ-64's recorded reference.

## Files or areas

- `server/test/gcsp-manual-journey.test.js (proposed)`
- `server/test/render.test.js and ui-ratchet coverage`
- `docs/gcsp/evidence/fucq-6/`
- `docs/gcsp/manual-journey-refinement.md`
- `COMPONENTS.md`

## Decided

Russell requested FUCQ-7 refinement on 1 November 2026. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, manual-journey-refinement.md, COMPONENTS.md and the canonical docs/design/high-level-design.drawio with docs/design/gcsp-high-level-design.md. The eight supplied screenshots govern header/sidebar/palette; their dense forms and seven-step wizard are historical information evidence. Redesign the body toward Used Cars. FUCQ-64 must record and review one representative body with Russell/Gary before other body designs fan out. Use shared components and scenario-scoped tokens; FUCQ-31 owns shared decision-card/control contracts and establishing/extending the single gallery, FUCQ-7 owns shell and manual page composition. Reuse one gallery and extend ratchet coverage to all new GCSP JS/CSS. Carry the experience contract, reviewed reference and these acceptance/validation criteria into every descendant brief. Use the existing Node/vanilla-ES-module stack and replaceable adapters; keep synthetic assumptions, image fidelity and unavailable facts explicit. October 2024 is the accepted eligibility baseline. BMW-only initially; preserve all six retail brands/five modes. Do not treat a shared demo password or URL employee ID as identity. Do not implement buddy automation, mail, Greg planning or downstream lifecycle here. Proposed test files below are deliverables, not existing verification results.

FUCQ-35 remains blocked by the completed FUCQ-7 journey; no inverse dependency. This verification story does not deploy or start a dispatcher. FUCQ-7 is complete only when both the information trace and functioning adapter-backed states are evidenced.

## Out of scope

Release/deployment, a second end-to-end suite for unchanged implementation details, live BMW integration and the full buddy/Greg lifecycle.

## Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- node --test server/test/gcsp-manual-journey.test.js server/test/gcsp-repository-contract.test.js — HTTP-to-order journeys and persistence/error/concurrency cases pass against configured SQL; no skipped critical check is claimed complete.
- node --test server/test/render.test.js server/test/ui-ratchet.test.js; npm test — pass once at final integration, recording actual results.
- npm run serve and npm run server; inspect full direct employee route/harness at desktop and 320px, including Print, then adjacent retail surfaces/gallery. Save captures and independent rendered-review result under docs/gcsp/evidence/fucq-6/.

