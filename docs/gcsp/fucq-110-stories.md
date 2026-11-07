# FUCQ-110 · GCSP lifecycle after selection

**Current scope revision, 7 November:** this document preserves the 4 November publication. Russell's [authorised split decision](build-rules.md#scope-split-decision-7-november-2026) revises the live contracts: FUCQ-114 → FUCQ-167, FUCQ-118 → FUCQ-168, FUCQ-120 → FUCQ-169, FUCQ-122 → FUCQ-170 and FUCQ-124 → FUCQ-171. Existing numbers retain the necessary planning/help scope; new remainders are To Do. Use current Jira and local contracts plus the [MoSCoW scope/order tables](backlog-moscow-review-2026-11-07.md) for pickup. The original descriptions below remain historical evidence.

**Published and verified on 4 November 2026.** One Epic, [FUCQ-110](https://ibm-consulting.atlassian.net/browse/FUCQ-110), "Take a selected car through approval, handover planning and renewal help", with eight native Stories. It covers blueprint columns 08, 12 and 13 and diagram page 07, starting where FUCQ-108 (buddy handoff) and FUCQ-72 (manual handoff) stop, at "sent to ordering".
- The Epic is In Progress, with Start date 2026-11-04.
- The Stories are To Do and unassigned, at High (P2, `due 2026-11-12: GCSP demo`). No Story Points were authored.
- 18 native Blocks links record the dependencies. [Publication verification](evidence/fucq-110/story-publication.json) records the read-back.

Gary approved the Epic, the Story titles, their one-line outcomes, the P2 priority and the dependency order on 4 November 2026, under the equal-authority rule (`AGENTS.md`). P2 rather than P3 because the build rules require the full planned build, and the HLD walkthrough and demo brief include columns 12 and 13 and the unresolved-renewal route. Source of the scope: [C7–C9 handover](../design/handover-section-c7-c9-2026-11-04.md), section C7, and [HLD story readiness](../design/hld-story-readiness-2026-11-04.md), section C7. Template: [_dev/story-template.md](../../_dev/story-template.md). Each `ui`-kind story names its kit components from [COMPONENTS.md](../../COMPONENTS.md). Only stories were authored: no implementation, poller, provisioning or deployment was started.

The Story keys are not consecutive, because a sibling session created FUCQ-74 Stories at the same time.

| Story | Outcome | Kind, size | Depends on |
|---|---|---|---|
| [FUCQ-111](https://ibm-consulting.atlassian.net/browse/FUCQ-111) | Progress a selected order through the target approval states on presenter ticks | code, M | FUCQ-108, 72 |
| [FUCQ-112](https://ibm-consulting.atlassian.net/browse/FUCQ-112) | Open an owned renewal-risk case on request or a configured trigger | code, M | FUCQ-91, 85 |
| [FUCQ-114](https://ibm-consulting.atlassian.net/browse/FUCQ-114) | Request, confirm and complete a handover appointment, or record a no-show | code, M | FUCQ-111 |
| [FUCQ-116](https://ibm-consulting.atlassian.net/browse/FUCQ-116) | Track documents and vehicle readiness with a named owner for each | code, M | FUCQ-111 |
| [FUCQ-118](https://ibm-consulting.atlassian.net/browse/FUCQ-118) | Plan the old car's return separately from the new car's handover | code, S | FUCQ-114 |
| [FUCQ-120](https://ibm-consulting.atlassian.net/browse/FUCQ-120) | Show Paula her order progress, handover plan and who owns each next step | ui, L | FUCQ-114, 116, 118, 105, 67 |
| [FUCQ-122](https://ibm-consulting.atlassian.net/browse/FUCQ-122) | Ask for help, and let the scheme team work the renewal-risk case | ui, M | FUCQ-112, 95, 101 |
| [FUCQ-124](https://ibm-consulting.atlassian.net/browse/FUCQ-124) | Verify the lifecycle after selection end to end with browser evidence | code, M | FUCQ-120, 122, 109 |

**Build order:**
1. FUCQ-111 and FUCQ-112, in parallel.
2. FUCQ-114 and FUCQ-116, in parallel.
3. FUCQ-118.
4. FUCQ-120 and FUCQ-122, in parallel.
5. FUCQ-124.

**Shared decisions.** Every Story's Decided section cites:
- `docs/gcsp/README.md`, `demo-brief.md`, `build-rules.md` and `experience-quality.md`;
- `docs/gcsp/shared-contracts.md` (FUCQ-80);
- the foundation's ownership of the repository, PolicyService, identity and clock;
- the HLD review decisions each Story relies on (chiefly Q19, Q14 and Q3).

State changes run through synthetic ordering and appointment adapters on FUCQ-85 ticks. Each port also has a live-shaped stub that reports unsupported writes rather than pretending success. FUCQ-111 extends FUCQ-71's ordering adapter rather than building a second one. FUCQ-111, 114, 116 and 118 record lifecycle-exception event receipts (approval declined, no-show, overdue document, missed return), and FUCQ-112's trigger reads them by a keyed type list. So FUCQ-112 can be built in parallel with FUCQ-111, and FUCQ-124 proves the chain. No case gives automatic recovery priority (blueprint column 08). UI stories carry the `blocks/gcsp/` placement (Q8), the custom-element and CSP rule (Q18), the shared-kit and ratchet obligations, and browser evidence at desktop and 375 px with keyboard operation.

**Links not made:** FUCQ-71 and FUCQ-73 are not linked, so those Stories (edited by another session) are untouched. The manual route joins through FUCQ-72, as the handover asks.

The Story bodies below are the Jira descriptions as read back, with `id` and `title` added to each header and the scaffolding preamble line dropped. The only other changes are the heading level, the bullet marker and escaped checkboxes, which are normalised.

---

## [FUCQ-110](https://ibm-consulting.atlassian.net/browse/FUCQ-110) · Take a selected car through approval, handover planning and renewal help

---

### [FUCQ-111](https://ibm-consulting.atlassian.net/browse/FUCQ-111) · Progress a selected order through the target approval states on presenter ticks

```text
id: FUCQ-111
title: Progress a selected order through the target approval states on presenter ticks
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-110, lifecycle from HLD readiness section C7)
epic: FUCQ-110
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-108, FUCQ-72
```

#### Goal

As Paula, once my selection is sent on, I want my order to move through the real approval steps and show each one truthfully, so that I know whose decision I am waiting for.

#### Acceptance criteria

- [ ] **LifecycleService:** a service over FUCQ-81's repository that reads and advances the order FUCQ-71's adapter recorded, for both the buddy route (FUCQ-108) and the manual route (FUCQ-72). There is one lifecycle record per allocated `orderUuid`, and each stage keeps its own provider reference.
- [ ] **Target approval states (Q19):** the stages use the target platform's names, in this order:

    - selection received;
    - HR approval, only when the PolicyService key says the scheme uses it, because the target may drop it;
    - sales-manager approval;
    - sent to ordering.

    Each stage records pending, approved or declined, with its demo-clock time and provider reference. No local button or employee action approves anything.

- [ ] **Synthetic adapter on ticks:** the synthetic ordering adapter advances each stage from a tick handler this story registers on FUCQ-85's clock, after a keyed number of ticks. A scenario key can make a named stage decline, for the difficult case.
- [ ] **Live adapter boundary:** the ordering port has the synthetic adapter and a live-shaped stub. The stub reports each write as unsupported with a reviewable reason and leaves the state where it was. It never pretends success.
- [ ] **Uncertain outcomes:** a timeout or uncertain response stays pending under the same idempotency key, and FUCQ-85's reconciliation tick resolves it before any retry. Replaying a tick is a no-op that returns the original outcome.
- [ ] **Exception events:** a declined approval records a lifecycle-exception event receipt with its type and reason. The renewal-risk case Story in this Epic reads these by a keyed type list.
- [ ] **Read model and routes:** an `/api/gcsp` route returns the order's stages, its current stage, who owns it (HR, sales manager or ordering) and the expected next step, using FUCQ-84's server-owned context. Greg and the presenter can read any order in the run. Another employee's order is refused, and browser-supplied employee or run IDs are ignored.
- [ ] **Policy keys:** the stage list, the HR-approval flag, the tick delays and the decline scenario are PolicyService keys, each with its basis and assumed status (`docs/gcsp/build-rules.md`). Changing the HR-approval key changes the stage list everywhere it is read.

#### Files or areas

- `server/gcsp/lifecycle/ (proposed)`
- `server/gcsp/adapters/synthetic-ordering (extend FUCQ-71's adapter; no second adapter)`
- `server/gcsp/migrations/ (additive lifecycle tables)`
- `server/index.js (routes under /api/gcsp)`
- `server/test/gcsp-lifecycle-approval.test.js (proposed)`
- `docs/gcsp/shared-contracts.md (lifecycle stage and exception-event shapes)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C7; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`: "Greg's supply loop" (the lifecycle paragraph), "Paula's version-4 blueprint" column 12 and "Lifecycle and help". Carry these decisions and acceptance criteria into every child-agent brief.

FUCQ-71 owns the ordering adapter and FUCQ-108 calls it. This story extends that adapter's status reads and adds the tick handler; it builds no second ordering adapter.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q19: the target's approval stage names, with HR approval configurable.
- Q14: adapters model the target AWS platform, not the mainframe.
- Q3: presenter ticks drive state changes; no unattended promises.
- Knowledge-base finding: the target has HR and sales-manager approval and sent to ordering, so the demo adopts them rather than inventing names.

#### Out of scope

The selection handoff itself (FUCQ-108, FUCQ-71, FUCQ-72); appointments, documents and the return plan (other Stories in FUCQ-110); the screens (the order progress Story in FUCQ-110); a real BMW approval workflow.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-lifecycle-approval.test.js`: these pass:

    - stage order with HR approval on and off;
    - tick advance, and tick replay as a no-op;
    - the decline scenario and its exception event;
    - the live stub reporting unsupported without moving state;
    - an uncertain write reconciled before retry;
    - buddy and manual orders both progressing;
    - employee and run scoping.

- `npm test` passes.
- Backend-only: no screen. Record each stage's response shape in fixtures for the order progress screen (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-112](https://ibm-consulting.atlassian.net/browse/FUCQ-112) · Open an owned renewal-risk case on request or a configured trigger

```text
id: FUCQ-112
title: Open an owned renewal-risk case on request or a configured trigger
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-110, lifecycle from HLD readiness section C7)
epic: FUCQ-110
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-91, FUCQ-85
```

#### Goal

As Paula, if I may not get a suitable car before my contract ends, I want someone named to own my case and tell me what happens next, so that I am not left to chase it.

#### Acceptance criteria

- [ ] **Opening help changes nothing:** reading help content creates no case, changes no priority and records nothing beyond an ordinary read.
- [ ] **Case on request:** Paula can ask for help. That opens one case for her renewal, with her reason, scoped to the employee and run from FUCQ-84. Asking again adds to the same open case rather than opening a second one.
- [ ] **Case on a configured trigger:** a tick handler this story registers on FUCQ-85's clock opens a case when a keyed renewal-risk rule holds. The rules are:

    - the renewal deadline is within a keyed number of days, with no acknowledged selection;
    - a lifecycle-exception event of a keyed type (for example approval declined or appointment no-show) is recorded for her order.

    Each rule and threshold is a PolicyService key with its basis and assumed status. Replaying a tick opens no duplicate case.

- [ ] **Owned case:** each case records its owner (the scheme team role), the trigger or request, the reason, the next action, its due time in demo-clock time and a dated history of updates. Status moves through open, in progress, remedy proposed, resolved or closed, and each change records who made it.
- [ ] **Remedies need their authorised owner:** candidate remedies are another suitable available car, an employee-approved relaxation of a preference (through FUCQ-91's single-change operation), a later release with a realistic date, or a manual scheme-team decision. A contract extension is offered only if a PolicyService key says the scheme permits it. Only the scheme-team role can record a remedy, and an employee-approved relaxation still needs Paula's confirmation.
- [ ] **No automatic recovery priority:** opening or resolving a case never changes allocation priority, tie-break or hold order. Essentials, eligibility and the points allowance stay constraints. A test proves allocation input is unchanged by a case.
- [ ] **Read model and routes:** `/api/gcsp` routes let Paula open and read her own case, and let Greg and the presenter list the run's cases and record updates. Another employee's case is refused, and browser-supplied employee or run IDs are ignored.
- [ ] **Notification hook:** each case update that Paula should hear about writes an outbox job through FUCQ-93's port in the same transaction, if FUCQ-93 is merged; otherwise the update is visible on her account and the outbox write is a recorded follow-up.

#### Files or areas

- `server/gcsp/cases/ (proposed)`
- `server/gcsp/migrations/ (additive case tables)`
- `server/index.js (routes under /api/gcsp)`
- `server/test/gcsp-renewal-case.test.js (proposed)`
- `docs/gcsp/shared-contracts.md (case shape and trigger keys)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C7; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md` ("Unresolved renewals and recovery"), `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`: "Paula's version-4 blueprint" column 08 and "Lifecycle and help". Carry these decisions and acceptance criteria into every child-agent brief.

Blueprint column 08: an owned case only on request or a configured renewal-risk trigger; merely opening help changes nothing; an extension or other remedy requires its authorised owner; actual dates stay authoritative. The demo brief leaves a bounded recovery priority as an open policy question (SAN-016), so this story gives none.

This story reads lifecycle-exception events by a keyed type list rather than depending on the approval and appointment Stories, so it can be built in parallel with them. The end-to-end Story in FUCQ-110 proves the chain.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q3: presenter ticks run the trigger; no unattended promises.
- Q6: trigger rules and thresholds are dated policy keys.
- Q16: an employee-approved relaxation uses the single preference change, not a contribution ceiling.

#### Out of scope

The help and case screens (the help Story in FUCQ-110); a recovery-priority policy; automatic remedies; real BMW case tooling.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-renewal-case.test.js`: these pass:

    - reading help opens nothing;
    - a request opens one case, and a repeat adds to it;
    - the deadline trigger and the exception-event trigger, read from PolicyService;
    - tick replay opens no duplicate;
    - remedy recording refused for the employee role;
    - the extension remedy gated by its key;
    - allocation input unchanged by a case;
    - employee and run scoping.

- `npm test` passes.
- Backend-only: no screen. Record the case and update response shapes in fixtures for the help screens (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-114](https://ibm-consulting.atlassian.net/browse/FUCQ-114) · Request, confirm and complete a handover appointment, or record a no-show

```text
id: FUCQ-114
title: Request, confirm and complete a handover appointment, or record a no-show
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-110, lifecycle from HLD readiness section C7)
epic: FUCQ-110
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-111
```

#### Goal

As Paula, once my order is sent to ordering, I want to request a handover slot and see when it is actually confirmed, so that I never plan around a booking that does not exist.

#### Acceptance criteria

- [ ] **Appointment port:** an appointment port with a synthetic adapter and a live-shaped stub, following FUCQ-111's pattern. The stub reports each write as unsupported with a reviewable reason and leaves the state where it was.
- [ ] **Target appointment states (Q19):** an appointment moves through requested, then scheduled (confirmed by the provider), then completed or no-show. Each state records its demo-clock time and provider reference. Requested is never shown or returned as booked.
- [ ] **Request rules:** Paula can request a slot only after her order reaches sent to ordering in FUCQ-111. She chooses from slots the synthetic adapter offers, and earliest dates and slot lengths are PolicyService keys. Repeating the same request returns the same appointment.
- [ ] **Confirmation on a tick:** the synthetic adapter confirms or proposes another slot from a tick handler on FUCQ-85's clock, after a keyed delay. A proposed change needs Paula's acceptance before it becomes scheduled.
- [ ] **Completion gate:** an appointment can be marked completed only when the documents and the car's readiness from the documents Story in FUCQ-110 are all complete. If that Story is not yet merged, the gate reads a port that returns not ready, so completion is refused rather than assumed.
- [ ] **No-show:** a scenario key or presenter action can record a no-show. It records a lifecycle-exception event receipt of type no-show, leaves the order allocated, and lets Paula request a new slot.
- [ ] **Uncertain outcomes:** a timeout stays pending under the same idempotency key and is reconciled on FUCQ-85's reconciliation tick before any retry.
- [ ] **Read model and routes:** `/api/gcsp` routes request a slot, accept a proposed change and read the current appointment, with who owns the next step (Paula, the retailer or the scheme team). Another employee's appointment is refused, and browser-supplied employee or run IDs are ignored.

#### Files or areas

- `server/gcsp/lifecycle/appointments (proposed)`
- `server/gcsp/adapters/synthetic-appointments (proposed)`
- `server/gcsp/migrations/ (additive appointment tables)`
- `server/index.js (routes under /api/gcsp)`
- `server/test/gcsp-lifecycle-appointment.test.js (proposed)`
- `docs/gcsp/shared-contracts.md (appointment shape)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C7; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`: "Greg's supply loop" (the lifecycle paragraph), "Paula's version-4 blueprint" column 13 and "Lifecycle and help". Carry these decisions and acceptance criteria into every child-agent brief.

Blueprint column 13: requested differs from confirmed; signing may follow booking; completed documents and a ready vehicle gate physical handover. GCSP unifies ordering and the former ISA handover system (`docs/gcsp/demo-brief.md`), so the appointment belongs in the same experience.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q19: the target's appointment states (scheduled, completed), with no-show as the failure case.
- Q14: adapters model the target AWS platform.
- Q3: presenter ticks drive confirmation; no unattended promises.

#### Out of scope

The old car's return (the return plan Story in FUCQ-110); document and readiness tracking (the documents Story); the screens; physical collection; real retailer calendars.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-lifecycle-appointment.test.js`: these pass:

    - request refused before sent to ordering;
    - requested then scheduled on a tick, and an idempotent repeat request;
    - a proposed slot change needing acceptance;
    - completion refused until documents and readiness are complete;
    - no-show with its exception event and a new request;
    - the live stub reporting unsupported;
    - an uncertain write reconciled before retry;
    - employee and run scoping.

- `npm test` passes.
- Backend-only: no screen. Record each appointment state's response shape in fixtures for the order progress screen (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-116](https://ibm-consulting.atlassian.net/browse/FUCQ-116) · Track documents and vehicle readiness with a named owner for each

```text
id: FUCQ-116
title: Track documents and vehicle readiness with a named owner for each
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-110, lifecycle from HLD readiness section C7)
epic: FUCQ-110
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-111
```

#### Goal

As Paula, I want to see which documents and preparation steps are done, which are waiting, and who has each one, so that I know what I must do and what others are doing for me.

#### Acceptance criteria

- [ ] **Item set from policy:** the documents (for example the agreement to sign and licence check) and the car's readiness steps (for example preparation and delivery to the retailer) come from PolicyService keys, each labelled a synthetic assumption with its basis. The scheme's configuration decides which apply.
- [ ] **Status and owner per item:** each item has a status (not started, waiting for the employee, in progress, complete, or failed with a reason), an owner (the employee, the scheme team or the retailer), a due time in demo-clock time and a provider reference. Items open when the order reaches the keyed lifecycle stage in FUCQ-111.
- [ ] **Employee tasks:** items owned by the employee form her task list, with the action she can take. A synthetic acknowledgement stands in for signing, labelled as such; it never claims a real signature. Signing may follow booking.
- [ ] **Provider progress on ticks:** items owned by the scheme team or retailer advance through the synthetic adapter from a tick handler on FUCQ-85's clock, after keyed delays. A scenario key can make one fail, for the difficult case. The live-shaped stub reports writes as unsupported.
- [ ] **Readiness gate:** a read reports whether all documents are complete and the car is ready. The appointment Story in FUCQ-110 uses it to gate completion. Nothing else can mark handover ready.
- [ ] **Overdue items:** an employee item past its due time is shown as overdue, and records a lifecycle-exception event receipt of a keyed type, so the renewal-risk trigger can use it.
- [ ] **Read model and routes:** `/api/gcsp` routes read the items and complete an employee task, using FUCQ-84's server-owned context. Another employee's items are refused, and browser-supplied employee or run IDs are ignored.

#### Files or areas

- `server/gcsp/lifecycle/documents (proposed)`
- `server/gcsp/adapters/synthetic-ordering (document and readiness status reads)`
- `server/gcsp/migrations/ (additive document and readiness tables)`
- `server/index.js (routes under /api/gcsp)`
- `server/test/gcsp-lifecycle-documents.test.js (proposed)`
- `docs/gcsp/shared-contracts.md (item shape and keys)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C7; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`: "Greg's supply loop" (the lifecycle paragraph: separate document and readiness states), "Paula's version-4 blueprint" columns 12 and 13, and "Lifecycle and help". Carry these decisions and acceptance criteria into every child-agent brief.

Blueprint column 12: show who owns outstanding work and delays, and do not invent approval from a local button. Column 13: completed documents and a ready vehicle gate physical handover. Declarations at selection belong to FUCQ-72 (SAN-020); this story tracks the documents after it.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q19: document and readiness states are separate from the approval and appointment stages.
- Q14: adapters model the target AWS platform.
- Q3: presenter ticks drive provider progress.

#### Out of scope

Real e-signature, document storage or uploads; the selection declarations (FUCQ-72); the screens (the order progress Story in FUCQ-110).

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-lifecycle-documents.test.js`: these pass:

    - the item set read from PolicyService, and a changed key changing it;
    - items opening at the keyed stage;
    - an employee task completed, and refused for another employee;
    - provider items advancing on ticks, and the failure scenario;
    - the readiness gate;
    - an overdue item recording its exception event;
    - the live stub reporting unsupported.

- `npm test` passes.
- Backend-only: no screen. Record the item and task response shapes in fixtures for the order progress screen (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-118](https://ibm-consulting.atlassian.net/browse/FUCQ-118) · Plan the old car's return separately from the new car's handover

```text
id: FUCQ-118
title: Plan the old car's return separately from the new car's handover
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-110, lifecycle from HLD readiness section C7)
epic: FUCQ-110
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: S
depends_on: FUCQ-114
```

#### Goal

As Paula, I want my current car's return planned in its own right, so that I know when I hand it back and I keep it until the new one is actually mine.

#### Acceptance criteria

- [ ] **Separate return plan:** a replacement order has a return plan for the current car, linked to the old contract and vehicle slot FUCQ-71 recorded, and separate from the new car's handover appointment. A new order (no current car) has none.
- [ ] **Return states:** the plan moves through not planned, return requested, return scheduled, then returned or missed. It records the return location, the slot from FUCQ-114's appointment port (the same port, a separate appointment), the demo-clock time and a provider reference. Requested is never shown as scheduled.
- [ ] **Same-visit or separate:** Paula can ask to return the old car at the new car's handover or at a separate slot. The choice and its rules are PolicyService keys, labelled synthetic assumptions.
- [ ] **Current-car relationship:** only a confirmed handover completion or a confirmed return changes Paula's current car. Acceptance, approval or a scheduled slot never does. A test proves her current car is unchanged until then.
- [ ] **Missed return:** a missed return records a lifecycle-exception event receipt of a keyed type, for the renewal-risk trigger.
- [ ] **Return mileage:** the plan carries the return mileage FUCQ-70 captured, read-only, as recorded at selection.
- [ ] **Read model and routes:** `/api/gcsp` routes read the return plan and request a return slot, using FUCQ-84's server-owned context. Another employee's plan is refused, and browser-supplied employee or run IDs are ignored.

#### Files or areas

- `server/gcsp/lifecycle/return-plan (proposed)`
- `server/gcsp/migrations/ (additive return-plan tables)`
- `server/index.js (routes under /api/gcsp)`
- `server/test/gcsp-lifecycle-return.test.js (proposed)`
- `docs/gcsp/shared-contracts.md (return-plan shape)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C7; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`: "Paula's version-4 blueprint" column 13 and the paragraph after the blueprint table. Carry these decisions and acceptance criteria into every child-agent brief.

Blueprint column 13 names a separate old-car return plan. The HLD: only confirmed collection or return changes the current-car relationship; acceptance alone does not. Physical collection and return stay outside the main walkthrough, so the confirmations come from the synthetic adapter.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q19: appointment states reused for the return slot.
- Q13: the current car is a delivered car with a VIN; the new car is keyed by `orderUuid` until delivery.

#### Out of scope

The new car's appointment (FUCQ-114); vehicle inspection, damage or end-of-contract charges; used-market resale; the screens.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-lifecycle-return.test.js`: these pass:

    - a return plan only for a replacement order;
    - requested then scheduled, separate from the handover appointment;
    - same-visit and separate-slot choices read from PolicyService;
    - the current car unchanged until confirmed completion or return;
    - a missed return with its exception event;
    - employee and run scoping.

- `npm test` passes.
- Backend-only: no screen. Record the return-plan response shapes in fixtures for the order progress screen (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-120](https://ibm-consulting.atlassian.net/browse/FUCQ-120) · Show Paula her order progress, handover plan and who owns each next step

```text
id: FUCQ-120
title: Show Paula her order progress, handover plan and who owns each next step
kind: ui
design_impact: yes
ui: el, mediaWell; screenIntro, button and statusScreen (all listed under "Not yet in the kit"; reuse them if already added); FUCQ-31's shared fact and status components; FUCQ-95's activityTimeline (reuse for dated history if added); new: stageTracker, because no kit component shows ordered stages with an owner and a current step, and taskList, because none lists actionable owned items with due times
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-110, lifecycle from HLD readiness section C7)
epic: FUCQ-110
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: L
depends_on: FUCQ-114, FUCQ-116, FUCQ-118, FUCQ-105, FUCQ-67
```

#### Goal

As Paula, after selecting my car, I want one clear place that shows how far my order has got, what my handover and return look like, and who has the next step, so that I never have to ask anyone where it stands.

#### Acceptance criteria

- [ ] **Order progress:** on her account (FUCQ-67) and on the offer page (FUCQ-105) once selected, Paula sees the selected car (with `mediaWell` and its 7-digit `orderNumber`) and the approval stages from FUCQ-111 in the target's names. The current stage, its owner (HR, sales manager or ordering) and the expected next step are shown. HR approval appears only when the policy key includes it.
- [ ] **Handover appointment:** the appointment from FUCQ-114 shows as requested, scheduled, completed or no-show, never calling a requested slot booked. Paula can request a slot once the order is sent to ordering, and accept or refuse a proposed change.
- [ ] **Documents and readiness:** the items from FUCQ-116 show as a task list, with Paula's own tasks first and their actions, then items others own with their owner and due time. Overdue and failed items are distinct.
- [ ] **Old-car return:** for a replacement order, the return plan from FUCQ-118 shows separately from the new car's handover, with her current car still shown as current until a confirmed completion or return.
- [ ] **Every state rendered:**

    - waiting for HR or sales-manager approval;
    - approval declined, with what happens next and the help entry;
    - sent to ordering, no slot requested;
    - slot requested, then scheduled, and a proposed change;
    - documents waiting for Paula, in progress, overdue, failed;
    - ready for handover;
    - no-show, with a new request;
    - completed;
    - unsupported provider write, shown as not done rather than done;
    - loading and source failure.

    Reload and reopening show the server's current state, never a cached client state.

- [ ] **Copy:** labels use the target's stage names and say plainly who is acting. The demo signing stand-in is labelled synthetic. No em dashes.
- [ ] **Shared kit:** the views are built from the shared kit per `COMPONENTS.md`. New or extended components go into the kit, the catalogue and the gallery in the same commit. The ratchet baseline only falls.
- [ ] **Embeddable (Q18):** the block mounts as a custom element, with no inline scripts, inline handlers or `eval`. Keyboard access, visible focus and status announcements throughout.

#### Files or areas

- `blocks/gcsp/ (proposed order progress view, used by the account and offer views)`
- `COMPONENTS.md`, kit gallery, `server/test/ui-ratchet.json`
- `server/test/gcsp-order-progress-view.test.js (proposed)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C7; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/screens/README.md`, `COMPONENTS.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`: "Paula's version-4 blueprint" columns 12 and 13. Carry the experience contract, the visual reference and these criteria into every child-agent brief.

Visual reference: the screenshots govern the shell, and FUCQ-64's reviewed body reference governs the body. Blueprint column 12: show who owns outstanding work and delays.

Foundation (FUCQ-79): server-owned context from FUCQ-84, and time from FUCQ-85's demo clock. All labels and stage lists come from the server projection, which reads PolicyService.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q19: target approval and appointment state names.
- Q8: GCSP UI lives in separate blocks under `blocks/gcsp/` that import the shared kit; `vehicle-matcher` stays retail-only.
- Q18: custom element, with no inline scripts, inline event handlers or `eval`.
- Q3: no copy claims the platform progresses overnight unattended.

#### Out of scope

The help entry and case views (the help Story in FUCQ-110); the services behind each state (FUCQ-111, 114, 116, 118); Greg's views.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-order-progress-view.test.js`: rendering from fixtures of each listed state passes, including HR approval on and off.
- `npm test` passes, including the UI ratchet and the em-dash test.
- Browser evidence at desktop and narrow (375 px) widths, with keyboard-only operation, of each listed state on the account and the offer page, with the screenshot paths recorded (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-122](https://ibm-consulting.atlassian.net/browse/FUCQ-122) · Ask for help, and let the scheme team work the renewal-risk case

```text
id: FUCQ-122
title: Ask for help, and let the scheme team work the renewal-risk case
kind: ui
design_impact: yes
ui: el, gbp; screenIntro, button and statusScreen (all listed under "Not yet in the kit"; reuse them if already added); FUCQ-31's shared fact and decision components; FUCQ-95's activityTimeline for case history (reuse if added); FUCQ-101's dataTable for Greg's case queue (reuse if added); new: caseSummary, because no kit component shows an owned case with its next action and due time
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-110, lifecycle from HLD readiness section C7)
epic: FUCQ-110
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-112, FUCQ-95, FUCQ-101
```

#### Goal

As Paula, I want to ask for help and see who owns my case and what they will do, and as Greg, I want a queue of at-risk renewals with reasons and feasible options, so that no one runs out of time without a named person acting.

#### Acceptance criteria

- [ ] **Help entry for Paula:** a help entry on her activity view (FUCQ-95) and order progress view explains what help can do. Opening it changes nothing. Asking for help states the effect before she confirms, then opens or adds to her case through FUCQ-112.
- [ ] **Paula's case view:** shows the case owner (the scheme team role), the reason, the next action and its due time in demo-clock time, the dated history and any remedy proposed for her. An employee-approved relaxation is confirmed through FUCQ-91's single-change operation and states what it changes.
- [ ] **Greg's case queue:** in Greg's dashboard (FUCQ-101), a queue of the run's cases shows employee, renewal deadline, trigger or request, reason, status, owner and next-action due time. It sorts by deadline and status.
- [ ] **Working a case:** Greg can open a case and see feasible next options. They are other suitable available cars from the existing evaluation, a preference relaxation, a later release with its realistic date, a manual decision, and an extension only where the policy key permits it. He records an update or a remedy, which Paula's view shows on reload.
- [ ] **No priority promise:** no copy promises a specific next car or greater priority. The views say remedies need the scheme team's decision.
- [ ] **Every state rendered:**

    - no case, help available;
    - case open from a request, and from a trigger;
    - in progress;
    - remedy proposed and waiting for Paula;
    - resolved and closed;
    - empty queue;
    - loading and source failure.

    Reload shows the server's current state.

- [ ] **Shared kit:** the views are built from the shared kit per `COMPONENTS.md`. New or extended components go into the kit, the catalogue and the gallery in the same commit. The ratchet baseline only falls.
- [ ] **Embeddable (Q18):** both blocks mount as custom elements, with no inline scripts, inline handlers or `eval`. Keyboard access, visible focus and status announcements throughout.

#### Files or areas

- `blocks/gcsp/ (proposed help and case views in the employee block; case queue in Greg's block)`
- `COMPONENTS.md`, kit gallery, `server/test/ui-ratchet.json`
- `server/test/gcsp-case-views.test.js (proposed)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C7; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md` ("Unresolved renewals and recovery"), `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/screens/README.md`, `COMPONENTS.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`: "Paula's version-4 blueprint" column 08 and "Lifecycle and help". Carry the experience contract, the visual reference and these criteria into every child-agent brief.

Visual reference: the screenshots govern the shell, and FUCQ-64's reviewed body reference governs the body. Greg's views use the denser operational treatment FUCQ-101 establishes, in the same shell and visual language.

The demo brief asks for a manual-intervention job on Greg's page with reasons and feasible next-best options, and for the flow to show who owns the case and how the employee hears about progress.

Foundation (FUCQ-79): server-owned context from FUCQ-84, so only Greg's role can record remedies; time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q8: GCSP UI lives in separate blocks under `blocks/gcsp/` that import the shared kit.
- Q18: custom elements, with no inline scripts, inline event handlers or `eval`.
- Q16: a relaxation is one confirmed preference change.

#### Out of scope

The case service and its triggers (FUCQ-112); a recovery-priority policy; the order progress view (the order progress Story in FUCQ-110).

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-case-views.test.js`: rendering from fixtures of each listed state passes, for Paula's views and Greg's queue.
- `npm test` passes, including the UI ratchet and the em-dash test.
- Browser evidence at desktop and narrow (375 px) widths, with keyboard-only operation, of each listed state for Paula and Greg, with the screenshot paths recorded (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-124](https://ibm-consulting.atlassian.net/browse/FUCQ-124) · Verify the lifecycle after selection end to end with browser evidence

```text
id: FUCQ-124
title: Verify the lifecycle after selection end to end with browser evidence
kind: code
design_impact: no
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-110, lifecycle from HLD readiness section C7)
epic: FUCQ-110
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-120, FUCQ-122, FUCQ-109
```

#### Goal

As the presenter, I want the whole journey from selection to handover, and the renewal-risk route, proven on the running app with a repeatable scenario, so that I can demonstrate it on cue and Russell can trial it.

#### Acceptance criteria

- [ ] **Happy path, buddy route:** from FUCQ-109's end state (Paula has selected her second offer), ticks move the order through HR approval (when on), sales-manager approval and sent to ordering. Paula requests a slot, it is scheduled, she completes her document tasks, the car becomes ready, her old-car return is scheduled, and the handover completes. Only then does her current car change.
- [ ] **Manual route:** the same lifecycle runs for an order handed off through FUCQ-72, proving both routes share it.
- [ ] **Difficult cases:** each runs from a scenario key on a fresh run:

    - HR approval switched off by its policy key;
    - an approval declined, which opens a renewal-risk case;
    - an appointment no-show, then a new request;
    - an overdue document task;
    - Paula asking for help near her deadline, and Greg recording a remedy she sees;
    - the live-shaped stub reporting an unsupported write, shown as not done.

- [ ] **Repeatable scenarios:** each path has a known starting state, reset through FUCQ-85, short click-through steps, the expected outcome and a place to record observed behaviour, following `docs/gcsp/manual-acceptance-scenarios.md` and FUCQ-75's shared setup.
- [ ] **Policy change proven:** changing the HR-approval key and one delay key in the policy source changes the stages and timing consistently on every screen (`docs/gcsp/build-rules.md`, acceptance).
- [ ] **No recovery priority:** an automated check shows that opening and resolving a case leaves allocation input unchanged.

#### Files or areas

- `server/test/gcsp-lifecycle-e2e.test.js (proposed)`
- `docs/gcsp/manual-acceptance-scenarios.md (lifecycle scenarios)`
- `docs/gcsp/evidence/fucq-110/ (captures and observations)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C7; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md` ("Repeatable manual trials" and "Verify before declaring a UI story built"), `docs/gcsp/manual-acceptance-scenarios.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`: blueprint columns 08, 12 and 13 and diagram page 07. Carry these decisions and acceptance criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock, and reset runs through it.

HLD review (`docs/design/hld-review-gc.md`), as it applies here: Q19 (target state names), Q3 (presenter ticks), Q15 and Q9 (this follows the critical path, which FUCQ-109 proves first).

#### Out of scope

New features; fixes belong to the Story that owns the defect. Physical collection and after-use feedback stay outside the walkthrough.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-lifecycle-e2e.test.js`: the buddy and manual paths and each difficult case pass against the in-memory repository double, and on the configured PostgreSQL provider where available.
- `npm test` passes.
- Browser evidence at desktop and narrow (375 px) widths, with keyboard-only operation, for every path above, as Paula and as Greg, with the screenshot paths and observations recorded in `docs/gcsp/evidence/fucq-110/` (`docs/gcsp/experience-quality.md`).

---
