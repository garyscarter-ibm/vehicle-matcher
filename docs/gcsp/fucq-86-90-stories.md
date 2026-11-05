# FUCQ-86 to FUCQ-90 · GCSP critical-path stories

**Published and verified on 4 November 2026.** This is the backlog for Gary's critical path for the 12 November demo (HLD review Q9: Paula's offer, decline, second offer and select, plus Greg's dashboard): five Epics, FUCQ-86 to FUCQ-90, with 19 native Stories, FUCQ-91 to FUCQ-109. They build on the foundation, [FUCQ-79](fucq-79-stories.md).
- The Epics are In Progress, with Start date 2026-11-04.
- The Stories are To Do and unassigned, at High (P2, `due 2026-11-12: GCSP demo`). No Story Points were authored.
- 47 native Blocks links record the dependencies. [Publication verification](evidence/fucq-86-90/story-publication.json) records the read-back.

Gary approved the Epics, the Story titles, their one-line outcomes and the dependency order on 4 November 2026, under the equal-authority rule (`AGENTS.md`). Russell explicitly resumed FUCQ-98 on 5 November; implementation can proceed with the [Brevo handoff](email-transport.md), with sender/configuration verification before real sending. Source of the scope: [HLD story readiness](../design/hld-story-readiness-2026-11-04.md), section C (items C2–C6). Template: [_dev/story-template.md](../../_dev/story-template.md). Each `ui`-kind story names its kit components from [COMPONENTS.md](../../COMPONENTS.md). This document records story scope and subsequent decisions.

| Readiness item | Epic | Stories |
|---|---|---|
| C2 · Brief and buddy | [FUCQ-86](https://ibm-consulting.atlassian.net/browse/FUCQ-86) Save Paula's brief and let the buddy search for her | FUCQ-91, 94, 95 |
| C3 · Release, allocation, buddy hold | [FUCQ-87](https://ibm-consulting.atlassian.net/browse/FUCQ-87) Release stock, allocate it and hold a buddy offer | FUCQ-92, 96, 100 |
| C4 · Notification | [FUCQ-88](https://ibm-consulting.atlassian.net/browse/FUCQ-88) Notify employees through a captured outbox | FUCQ-93, 97, 98 |
| C5 · Offer page and decisions | [FUCQ-89](https://ibm-consulting.atlassian.net/browse/FUCQ-89) Decide on an offer and get a second one | FUCQ-102, 105–109 |
| C6 · Greg's dashboard | [FUCQ-90](https://ibm-consulting.atlassian.net/browse/FUCQ-90) Give Greg a demand and supply dashboard | FUCQ-99, 101, 103, 104 |

| Story | Outcome | Kind, size | Depends on |
|---|---|---|---|
| [FUCQ-91](https://ibm-consulting.atlassian.net/browse/FUCQ-91) | Save and revise a versioned brief with essentials and search permission | code, M | FUCQ-80, 81, 82, 84 |
| [FUCQ-94](https://ibm-consulting.atlassian.net/browse/FUCQ-94) | Set preferences, importance and essentials with a live explained preview | ui, L | FUCQ-91, 29, 31, 64 |
| [FUCQ-95](https://ibm-consulting.atlassian.net/browse/FUCQ-95) | Show buddy activity and pause or resume the search | ui, M | FUCQ-91, 64 |
| [FUCQ-92](https://ibm-consulting.atlassian.net/browse/FUCQ-92) | Release synthetic stock on a presenter tick from the next pull | code, M | FUCQ-85, 78 |
| [FUCQ-96](https://ibm-consulting.atlassian.net/browse/FUCQ-96) | Allocate released cars across competing briefs by the policy tie-break | code, L | FUCQ-92, 91, 29 |
| [FUCQ-100](https://ibm-consulting.atlassian.net/browse/FUCQ-100) | Hold the allocated car and create its offer and outbox job in one transaction | code, M | FUCQ-96 |
| [FUCQ-93](https://ibm-consulting.atlassian.net/browse/FUCQ-93) | Dispatch outbox jobs through a transport port into a captured outbox | code, M | FUCQ-81, 84 |
| [FUCQ-97](https://ibm-consulting.atlassian.net/browse/FUCQ-97) | Show the presenter each captured offer email in an outbox viewer | ui, S | FUCQ-93, 64 |
| [FUCQ-98](https://ibm-consulting.atlassian.net/browse/FUCQ-98) | Send offer emails through one real transport once a sender is set up | code, S | FUCQ-93 (precondition: sender setup) |
| [FUCQ-102](https://ibm-consulting.atlassian.net/browse/FUCQ-102) | Open an offer from a run-bound link that shows its current state | code, M | FUCQ-100, 84, 85 |
| [FUCQ-105](https://ibm-consulting.atlassian.net/browse/FUCQ-105) | Show the offer's exact quote, current-car comparison and countdown | ui, L | FUCQ-102, 31, 64 |
| [FUCQ-106](https://ibm-consulting.atlassian.net/browse/FUCQ-106) | Accept, decline or expire an offer with idempotent outcomes | code, M | FUCQ-102 |
| [FUCQ-107](https://ibm-consulting.atlassian.net/browse/FUCQ-107) | Confirm one preference change after declining and receive a second offer | ui, L | FUCQ-106, 91, 96 |
| [FUCQ-108](https://ibm-consulting.atlassian.net/browse/FUCQ-108) | Hand off a selected buddy offer through the ordering adapter | code, M | FUCQ-106, 71 |
| [FUCQ-109](https://ibm-consulting.atlassian.net/browse/FUCQ-109) | Verify Paula's critical path end to end with browser evidence | code, M | FUCQ-105, 107, 108, 97 |
| [FUCQ-99](https://ibm-consulting.atlassian.net/browse/FUCQ-99) | Aggregate saved demand and offer outcomes for Greg | code, M | FUCQ-91, 81, 84 |
| [FUCQ-101](https://ibm-consulting.atlassian.net/browse/FUCQ-101) | Show Greg demand, outcomes and stock on one dashboard | ui, L | FUCQ-99, 31, 64 |
| [FUCQ-103](https://ibm-consulting.atlassian.net/browse/FUCQ-103) | Preview and publish points and recommendation weights | ui, M | FUCQ-101, 83 |
| [FUCQ-104](https://ibm-consulting.atlassian.net/browse/FUCQ-104) | Track order requests from requested to confirmed to released | ui, M | FUCQ-101, 92 |

**Critical-path build order, after the foundation:**
1. FUCQ-91.
2. FUCQ-92, then FUCQ-96, then FUCQ-100.
3. FUCQ-93 and FUCQ-102, in parallel.
4. FUCQ-106, then FUCQ-107.
5. FUCQ-105 and FUCQ-108.
6. FUCQ-109.

FUCQ-90's Stories run alongside from FUCQ-91 on.

**Shared decisions.** Every Story's Decided section cites:
- `docs/gcsp/README.md`, `demo-brief.md`, `build-rules.md` and `experience-quality.md`;
- `docs/gcsp/shared-contracts.md` (FUCQ-80);
- the foundation's ownership of the repository, PolicyService, identity and clock;
- the HLD review decisions each Story relies on.

UI stories carry the `blocks/gcsp/` placement (Q8), the custom-element and CSP rule (Q18), the shared-kit and ratchet obligations, and browser evidence at desktop and 375 px with keyboard operation.

**Still open, not part of this set:**
- Nine existing stories need follow-up edits so they consume this backlog instead of rebuilding parts of it: FUCQ-30, 36, 69, 70, 71, 73, 74, 75 and 78. Per-story findings are in the session notes, and the edits wait on Gary's go-ahead.
- The four stale Blocks links (FUCQ-27→29, FUCQ-28→29, FUCQ-28→30 and FUCQ-28→31) were deleted by Gary in the Jira UI on 4 November and confirmed gone the same day.
- Readiness items C7–C9 are not yet authored: the lifecycle after selection, the 1,000-employee comparison, and Stories for FUCQ-74 and FUCQ-75.

The Story bodies below are the Jira descriptions as read back, with `id` and `title` added to each header. The only other changes are the bullet marker and escaped checkboxes, which are normalised.

---

## [FUCQ-86](https://ibm-consulting.atlassian.net/browse/FUCQ-86) · Save Paula's brief and let the buddy search for her

---

### [FUCQ-91](https://ibm-consulting.atlassian.net/browse/FUCQ-91) · Save and revise a versioned brief with essentials and search permission

```text
id: FUCQ-91
title: Save and revise a versioned brief with essentials and search permission
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-86, critical path from HLD readiness section C2)
epic: FUCQ-86
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-80, FUCQ-81, FUCQ-82, FUCQ-84
```

#### Goal

As Paula, I want my confirmed brief saved as a version, together with my permission to search and hold, so that the buddy acts only on what I approved.

#### Acceptance criteria

- [ ] **BriefService:** a service over FUCQ-81's repository that can:

    - save a draft;
    - confirm it as a new immutable version;
    - revise it by creating a further version;
    - read the current version and its history.

    The shape follows the brief schema in `docs/gcsp/shared-contracts.md`. Every brief carries the employee and `runId` from FUCQ-84's server-owned context.

- [ ] **Fields:**

    - preference values per dimension, each with its separate importance or indifference weight;
    - confirmed essentials (carrying, equipment, charging readiness);
    - prefilled known facts, with their source;
    - explicit consent to search and to hold (buddy on/off);
    - a paused flag.

    Drafts and inferred suggestions stay separate from confirmed versions. An unknown essential stays unknown and is never defaulted.

- [ ] **Gates through PolicyService:** gate checks read PolicyService keys and FUCQ-29's gates. Charging that is not ready or unknown excludes plug-in cars until it is resolved; that rule is a labelled demo assumption key. No contribution question appears, because Choices is points-based (Q16).
- [ ] **Stale and unconsented saves:** a stale write is rejected with a refresh outcome. Confirming without consent saves the brief with the buddy left off.
- [ ] **Pause and resume:** both are versioned state changes. Pausing stops new searches and holds. An existing offer is unaffected, and the response reports it.
- [ ] **Single post-decline change (Q16):** a dedicated operation records which one field changed, from what to what, and the decline it answers. O4 (blueprint 07) uses it.
- [ ] **Events:** a confirmed version, a change, a pause or a resume each record a brief-changed event receipt. Allocation reads it.
- [ ] **Routes:** `/api/gcsp` routes read the current brief, save a draft, confirm, and pause or resume, all using server-owned context. Another employee's brief is refused, and browser-supplied employee or run IDs are ignored.

#### Files or areas

- `server/gcsp/brief/ (proposed)`
- `server/gcsp/migrations/ (additive brief tables if FUCQ-81's are not enough)`
- `server/index.js (routes under /api/gcsp)`
- `server/test/gcsp-brief.test.js (proposed)`
- `docs/gcsp/shared-contracts.md (update if a shape changes)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`: "Paula's version-4 blueprint" columns 02 to 04 and "Brief and search activity". Carry these decisions and acceptance criteria into every child-agent brief.

Russell's direct clarification (1 November): preference sliders and separate importance weights. This overrides the blueprint's removal of them.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q16: one preference change after a decline, not a contribution ceiling.
- Round-2 finding: the target captures no preferences or saved searches, so the brief is genuinely new.
- Round-2 finding: no rule requires home charging; it is a labelled assumption.

#### Out of scope

The brief and activity screens (the other two Stories in FUCQ-86); allocation, holds and offers (FUCQ-87, FUCQ-89); connected-use data.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-brief.test.js`: these pass:

    - draft, confirm and revise versioning;
    - stale-write rejection;
    - consent handling;
    - pause and resume;
    - the single-change operation;
    - unknown-essential handling;
    - charging exclusion read from PolicyService;
    - cross-employee and cross-run refusal.

- `npm test` passes.
- Backend-only: no screen. Record the brief, conflict and validation response shapes in fixtures for the brief and activity screens (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-94](https://ibm-consulting.atlassian.net/browse/FUCQ-94) · Set preferences, importance and essentials with a live explained preview

```text
id: FUCQ-94
title: Set preferences, importance and essentials with a live explained preview
kind: ui
design_impact: yes
ui: renderRangeSlider (extend: single option, already listed under "Not yet in the kit"), createPreviewFeed (extend: GCSP endpoint), previewTile, mediaWell, el; FUCQ-31's shared decision controls; new: importanceControl, because no kit control sets a separate importance or indifference weight per dimension
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-86, critical path from HLD readiness section C2)
epic: FUCQ-86
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: L
depends_on: FUCQ-91, FUCQ-29, FUCQ-31, FUCQ-64
```

#### Goal

As Paula, I want to say what I prefer, how much each preference matters and what I must have, and see straight away which cars that would favour and why, so that I can trust the buddy with my brief.

#### Acceptance criteria

- [ ] **Brief screen:** a brief screen in a GCSP block under `blocks/gcsp/`, inside FUCQ-64's shell. It has a preference slider per dimension, with a separate importance or indifference control next to each. Comfort and sportiness can both be high, with no forced opposites.
- [ ] **Essentials and known facts:** essentials (carrying, equipment, charging readiness) are confirmed as separate yes, no or unknown answers. Known facts (current car, driver, contract) are prefilled from server context and editable only where the server allows. There is no contribution or cash question (Q16).
- [ ] **Live preview:** a debounced live preview calls FUCQ-29's read-only recommendation endpoint and shows the top cars, each with grounded reasons and trade-offs. It covers loading, zero eligible, essential-unknown and unavailable states; a stale response never overwrites a newer one.
- [ ] **Save and consent:** Save confirms the brief through FUCQ-91 and shows the new version. A separate, clear consent control switches the buddy on to search and hold. A version conflict shows a refresh prompt and keeps the user's edits.
- [ ] **Shared kit:** the screen is built from the shared kit per `COMPONENTS.md`. New or extended components go into the kit, the catalogue and the gallery in the same commit. The ratchet baseline only falls.
- [ ] **Embeddable (Q18):** the block also mounts as a custom element, with no inline scripts, inline event handlers, `eval`, `new Function` or string timers.
- [ ] **Accessibility:** keyboard operable throughout, visible focus, labelled sliders with value readouts, reduced-motion support, and layouts that cope with long model names and missing images.

#### Files or areas

- `blocks/gcsp/ (proposed brief block)`
- `blocks/vehicle-matcher/modes/question-ui.js and preview-feed.js (kit extensions only)`
- `COMPONENTS.md`, kit gallery, `server/test/ui-ratchet.json`
- `server/test/ (render tests for the brief block)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md` (including "Embeddable blocks"), `docs/gcsp/screens/README.md`, `COMPONENTS.md`, `docs/gcsp/shared-contracts.md` and `docs/design/gcsp-high-level-design.md`, blueprint columns 02 and 03. Carry the experience contract, the visual reference and these criteria into every child-agent brief.

Visual reference: the supplied screenshots govern the header, sidebar and palette. The body is redesigned toward Used Cars. Follow FUCQ-64's reviewed employee body reference once it is recorded.

Russell's direct clarification (1 November): preference sliders plus separate importance weights.

Foundation (FUCQ-79): rules and assumptions are read through PolicyService, and context is server-owned.

HLD review: Q8 (separate GCSP blocks importing the shared kit), Q16 and Q18 apply.

#### Out of scope

The activity view (the activity Story in FUCQ-86); the post-decline single change (FUCQ-89); Greg's views.

#### Validate

Run commands from the worktree root.

- `npm test` passes, including the UI ratchet and a render test for the brief block. The em-dash test covers its copy.
- `grep -rnE "on[a-z]+=|eval\(|new Function" blocks/gcsp/` finds nothing in the brief block.
- Browser evidence at desktop and narrow (375 px) widths, with keyboard-only operation, of these states: an empty brief, an edited brief with a preview, zero eligible, essential unknown, preview unavailable, save success and version conflict. Record the screenshot paths in the story result and compare them with the FUCQ-64 reference (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-95](https://ibm-consulting.atlassian.net/browse/FUCQ-95) · Show buddy activity and pause or resume the search

```text
id: FUCQ-95
title: Show buddy activity and pause or resume the search
kind: ui
design_impact: yes
ui: el, mediaWell; statusScreen and button (both listed under "Not yet in the kit": add them to the kit here if no earlier GCSP story has); FUCQ-31's shared decision cards; new: activityTimeline, because no kit component lists dated search events
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-86, critical path from HLD readiness section C2)
epic: FUCQ-86
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-91, FUCQ-64
```

#### Goal

As Paula, I want to see what the buddy has done and whether it is still searching, and be able to pause it, so that I know where I stand without asking anyone.

#### Acceptance criteria

- [ ] **Activity screen:** the screen, in FUCQ-64's shell, shows:

    - whether the buddy is active or paused;
    - the last successful check, in demo-clock time, and what it found;
    - "still searching" or "source delayed" as distinct states;
    - the current offer, if any, with its actual state and a link to it.

    It reads a server activity projection: brief version, last check outcome, offers, and state changes.

- [ ] **Activity projection:** backend support adds an activity read model built from the event receipts. It is scoped to the employee and run, and refuses any other employee.
- [ ] **Pause and resume:** both go through FUCQ-91 and show their effect immediately. When paused, the screen says new searches and holds have stopped, and shows any existing offer and how to handle it.
- [ ] **Every state rendered:**

    - never searched;
    - searching with no match yet;
    - an offer waiting;
    - an offer declined or expired;
    - paused;
    - source unavailable.

    Reload shows the server's current state, never a cached client state.

- [ ] **Shared kit:** the screen is built from the shared kit per `COMPONENTS.md`. New or extended components go into the kit, the catalogue and the gallery in the same commit. The ratchet baseline only falls.
- [ ] **Embeddable (Q18):** the block mounts as a custom element, with no inline scripts, inline handlers or `eval`. Keyboard access and visible focus throughout.

#### Files or areas

- `blocks/gcsp/ (proposed activity block or view)`
- `server/gcsp/brief/ (activity projection)`
- `COMPONENTS.md`, kit gallery, `server/test/ui-ratchet.json`
- `server/test/gcsp-activity.test.js (proposed)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/screens/README.md`, `COMPONENTS.md`, `docs/gcsp/shared-contracts.md` and `docs/design/gcsp-high-level-design.md`, blueprint column 04. Carry the experience contract, the visual reference and these criteria into every child-agent brief.

Visual reference: the screenshots govern the shell, and FUCQ-64's reviewed body reference governs the body.

Foundation (FUCQ-79): server-owned context, and time from FUCQ-85's demo clock.

HLD review: Q3 (presenter ticks; no unattended promises, so the copy never claims the buddy checks overnight), Q8 and Q18 apply.

#### Out of scope

The brief editor (the preview Story in FUCQ-86); offer pages (FUCQ-89).

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-activity.test.js`: the projection states, run and employee scoping, and pause effects pass.
- `npm test` passes, including the UI ratchet and the em-dash test.
- Browser evidence at desktop and narrow (375 px) widths, with keyboard-only operation, of each listed state, with the screenshot paths recorded (`docs/gcsp/experience-quality.md`).

---

## [FUCQ-87](https://ibm-consulting.atlassian.net/browse/FUCQ-87) · Release stock, allocate it and hold a buddy offer

---

### [FUCQ-92](https://ibm-consulting.atlassian.net/browse/FUCQ-92) · Release synthetic stock on a presenter tick from the next pull

```text
id: FUCQ-92
title: Release synthetic stock on a presenter tick from the next pull
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-87, critical path from HLD readiness section C3)
epic: FUCQ-87
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-85, FUCQ-78
```

#### Goal

As the presenter, I want a tick to release the next tranche of synthetic stock, so that the buddy has cars to allocate at the moment I choose.

#### Acceptance criteria

- [ ] **Stock port:** models the target platform: GCSP pulls the scheme's stock list, and a release is a car appearing on the next pull (round-1 finding). There are two providers behind the same contract:

    - a synthetic provider over FUCQ-78's stock, arranged in tranches;
    - a real-shaped provider contract fixture.

- [ ] **Release handler:** a release handler registered on FUCQ-85's tick registry pulls the list and compares it with the known stock. Each newly released exact car is inserted as available, scoped to the run, with its `orderUuid`, 7-digit `orderNumber` and `configurationId`. An event receipt records the tranche ID.
- [ ] **Idempotent:** replaying a tick or a tranche inserts nothing new, and a car already known is never released twice.
- [ ] **Policy keys:** tranche sizes and lead times come from PolicyService keys (synthetic release sizes, release windows). The presenter can trigger "next release" as an explicit tick.
- [ ] **Confirmed supply:** Greg's confirmed supply (FUCQ-90) can queue a tranche. Only an actual release creates holdable `ReleasedStock`. A request or a confirmation never becomes stock.
- [ ] **Event:** each release emits a stock-released event receipt that allocation consumes. Manual browsing (FUCQ-69) reads the same released pool, so manual and buddy routes see one shared pool.

#### Files or areas

- `server/gcsp/stock/ (proposed: stock port, synthetic provider, release handler)`
- `server/gcsp/fixtures/ (tranche plan over FUCQ-78 stock)`
- `server/test/gcsp-release.test.js (proposed)`
- `docs/gcsp/shared-contracts.md (update if a shape changes)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`: "Greg's supply loop" and "Transaction and event invariants". Carry these decisions and acceptance criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock, and register tick work there.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q3: presenter ticks.
- Q13: stock keyed by `orderUuid`, with no VIN on stock.
- Round-1 finding: release is appearance on the next pull, not a pushed event.
- Round-2 finding: releases come in weekly windows and campaigns, first come first served, which is the problem the buddy solves.
- Gary's data route (4 November): real configurations with synthetic stock on top (FUCQ-77, FUCQ-78).

#### Out of scope

Allocation, holds and offers (the other two Stories in FUCQ-87); Greg's order tracking (FUCQ-90); live BMW stock feeds.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-release.test.js`: these pass:

    - tranche release on a tick;
    - replay idempotency;
    - the no-re-release rule;
    - policy-keyed sizes;
    - request and confirmation never becoming stock;
    - the run scope;
    - provider contract parity.

- `npm test` passes.
- Backend-only: no screen. Record the release event and stock-pool shapes in fixtures (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-96](https://ibm-consulting.atlassian.net/browse/FUCQ-96) · Allocate released cars across competing briefs by the policy tie-break

```text
id: FUCQ-96
title: Allocate released cars across competing briefs by the policy tie-break
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-87, critical path from HLD readiness section C3)
epic: FUCQ-87
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: L
depends_on: FUCQ-92, FUCQ-91, FUCQ-29
```

#### Goal

As the scheme, I want each released car offered to the employee it suits best under a published rule, so that competing employees are treated fairly and nobody wins by being first in a loop.

#### Acceptance criteria

- [ ] **Triggers:** on a stock-released event (FUCQ-92), or on a brief-changed event (FUCQ-91), an allocation run evaluates every active, unpaused, consenting brief in the run. Each is checked against the complete released and unheld pool through FUCQ-29's employee policy, with hard gates first and then explained ranking.
- [ ] **Assignment:** a deterministic assignment gives each employee at most one car per renewal or entitlement, and each car at most one employee. It uses the versioned tie-break rule from PolicyService (`allocation.tieBreak` or the key `shared-contracts.md` names). It never uses employee iteration order or mail speed. The rule's version is recorded on the result.
- [ ] **Exclusions:** the policy key for the declined-car exclusion keeps an unchanged declined car out of that employee's candidates. Expiry or a missed email is not treated as dislike, and gives no priority.
- [ ] **Failed claims:** when a claim fails (conflict, stale version), allocation tries that employee's next appropriate candidate. It does not skip the employee or hard-code a winner.
- [ ] **Recorded and replayable:** each run records its trigger event, its inputs (brief, policy and stock versions) and its assignments with reasons. Replaying the same event is idempotent.
- [ ] **Output:** the output is a list of (employee, `orderUuid`, quote snapshot) claims, handed to FUCQ-87's hold story. This story does not write holds itself.
- [ ] **Competition test:** at least three fictional employees compete for scarce cars. Changing the tie-break key changes the assignment, which proves the rule is read from the policy source.

#### Files or areas

- `server/gcsp/allocation/ (proposed)`
- `server/test/gcsp-allocation.test.js (proposed)`
- `docs/gcsp/shared-contracts.md (update if a shape changes)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`: "Allocation and offers", "Transaction and event invariants", and columns 04a and 09. Carry these decisions and acceptance criteria into every child-agent brief.

The HLD says rank order is not a fleet allocation rule. The tie-break is a keyed, plausible demo assumption, labelled as such, and inspectable.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review: Q5 (the employee policy calls `rankCars()` through FUCQ-29), Q9, and the round-2 finding that releases are first come first served today.

#### Out of scope

Writing holds and offers (FUCQ-87, hold story); notifications (FUCQ-88); manual claims (FUCQ-66).

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-allocation.test.js`: these pass:

    - multi-employee competition;
    - one-car-each limits;
    - tie-break read from PolicyService;
    - decline exclusion;
    - expiry carrying no priority;
    - fall-through after a failed claim;
    - replay idempotency;
    - recorded versions.

- `npm test` passes.
- Backend-only: no screen. Record the allocation-run shapes for Greg's outcomes view (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-100](https://ibm-consulting.atlassian.net/browse/FUCQ-100) · Hold the allocated car and create its offer and outbox job in one transaction

```text
id: FUCQ-100
title: Hold the allocated car and create its offer and outbox job in one transaction
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-87, critical path from HLD readiness section C3)
epic: FUCQ-87
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-96
```

#### Goal

As Paula, I want the car the buddy picked for me held exclusively while I decide, with my offer and its email created together, so that I never get an offer for a car someone else can take.

#### Acceptance criteria

- [ ] **One transaction:** for each allocation claim from FUCQ-96, a single transaction on FUCQ-81's repository does four things:

    1. revalidates the employee's consent, pause state, essentials, eligibility and brief and stock versions;
    2. conditionally creates a buddy offer hold on the exact `orderUuid`;
    3. creates the offer, with its pinned quote snapshot and policy version;
    4. enqueues one outbox job.

    All four commit or none do.

- [ ] **Hold expiry:** the hold's expiry is the current demo-clock time plus the buddy offer hold duration from PolicyService (`hold.buddy` key, about two hours, labelled a proposed capability). A browser countdown can never extend it.
- [ ] **Offer link token:** the offer gets an opaque, unguessable token. It is stored hashed and bound to the environment, the run and this offer. The plaintext appears only in the outbox job's link, and never in logs.
- [ ] **Shared authority:** the manual cart hold (FUCQ-66) and this buddy hold use the same exclusive-hold constraint. A car held by one route cannot be held by the other, and a test proves it both ways.
- [ ] **Conflicts:** a conflicting or stale claim returns its outcome to allocation, which tries the next candidate. No offer and no outbox job exist for a failed claim.
- [ ] **Expiry handler:** an expiry handler, registered on FUCQ-85's ticks, expires overdue buddy holds. It returns the car to the shared pool and records the expiry. Expiry is not a decline, and grants no priority.
- [ ] **Remote-shaped stock:** if the stock adapter is remote-shaped, an uncertain claim is stored as pending and reconciled on the next tick before any offer is made.

#### Files or areas

- `server/gcsp/offers/ (proposed: hold and offer transaction, token minting, expiry handler)`
- `server/test/gcsp-buddy-hold.test.js (proposed)`
- `docs/gcsp/shared-contracts.md (update if a shape changes)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`: "Demo access and offer links" and "Transaction and event invariants". Carry these decisions and acceptance criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock, and register tick work there.

HLD review, as it applies here:

- Q15: two hold types sharing one authority. The buddy hold is a proposed new capability with a configurable duration.
- Q3: presenter ticks.
- Q13: holds key on `orderUuid`.
- Round-1 finding: holds are local in GCSP's database, and nothing upstream is told until save.

#### Out of scope

Dispatching and sending mail (FUCQ-88); the offer page and decisions (FUCQ-89); the manual cart hold (FUCQ-66).

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-buddy-hold.test.js`: these pass:

    - atomic hold, offer and outbox, with rollback on failure;
    - revalidation;
    - expiry from PolicyService on the demo clock;
    - hashed run-bound token;
    - manual and buddy exclusivity both ways;
    - no offer for a failed claim;
    - expiry returning the car with no priority;
    - pending reconciliation.

- `node --test server/test/gcsp-repository-contract.test.js` still passes.
- `npm test` passes.
- Backend-only: no screen. Record the offer and hold shapes for the offer page (`docs/gcsp/experience-quality.md`).

---

## [FUCQ-88](https://ibm-consulting.atlassian.net/browse/FUCQ-88) · Notify employees through a captured outbox

---

### [FUCQ-93](https://ibm-consulting.atlassian.net/browse/FUCQ-93) · Dispatch outbox jobs through a transport port into a captured outbox

```text
id: FUCQ-93
title: Dispatch outbox jobs through a transport port into a captured outbox
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-88, critical path from HLD readiness section C4)
epic: FUCQ-88
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-81, FUCQ-84
```

#### Goal

As the presenter, I want every committed offer notification turned into a message I can see, so that the demo shows the email reliably whether or not real mail is set up.

#### Acceptance criteria

- [ ] **Transport port:** a `MailTransport` port with a captured transport. The captured transport stores each rendered message per run: the fictional recipient, subject, plain-text and HTML bodies, the offer link and the demo-clock time. It is the default.
- [ ] **Dispatcher:** `dispatchPending()` processes pending outbox jobs. It runs after each committing transaction and at startup, and is registered as a FUCQ-85 tick handler once that registry exists.
- [ ] **Idempotent per job:** a retry never sends twice. A failure records the attempt count, the error and the next retry time, and the job stays visible as failed or retrying.
- [ ] **Offer message:** an offer notification template renders from the offer and its link. The HTML email contains no script, and there is a plain-text alternative. Copy has no em dashes (house style).
- [ ] **Failures never move stock:** dispatch never acquires a car, releases a hold or changes priority. When mail fails, the offer stays visible in the employee's account.
- [ ] **Run-scoped:** jobs belonging to an earlier run are not dispatched after a reset; they are marked stale.
- [ ] **No token leaks:** the offer token in the link is never written to logs.

#### Files or areas

- `server/gcsp/notify/ (proposed: MailTransport port, captured transport, dispatcher, templates)`
- `server/test/gcsp-outbox.test.js (proposed)`
- `docs/gcsp/shared-contracts.md (update if a shape changes)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`, "Transaction and event invariants". Carry these decisions and acceptance criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q11: the outbox viewer always ships, with one real transport if sender setup is ready.
- Q3: presenter ticks.

The hold, offer and outbox job commit together in FUCQ-87's hold story. This story only dispatches committed jobs.

#### Out of scope

The presenter's viewer (FUCQ-88, viewer story); a real transport (FUCQ-88, transport story); minting offer tokens (FUCQ-87, hold story).

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-outbox.test.js`: these pass:

    - capture;
    - idempotent retry;
    - the failure record;
    - no stock effect on failure;
    - stale-run refusal;
    - template rendering with no script and no em dash;
    - no token in the logs.

- `npm test` passes.
- Backend-only: no screen. Record the captured-message shape for the outbox viewer (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-97](https://ibm-consulting.atlassian.net/browse/FUCQ-97) · Show the presenter each captured offer email in an outbox viewer

```text
id: FUCQ-97
title: Show the presenter each captured offer email in an outbox viewer
kind: ui
design_impact: yes
ui: el; statusScreen and button (both listed under "Not yet in the kit"; reuse them if already added); new: messageList, because no kit component lists messages with a detail pane
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-88, critical path from HLD readiness section C4)
epic: FUCQ-88
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: S
depends_on: FUCQ-93, FUCQ-64
```

#### Goal

As the presenter, I want to open the email Paula would have received and follow its link, so that the demo shows the notification step whether or not real mail is configured.

#### Acceptance criteria

- [ ] **Viewer:** a presenter-only viewer in FUCQ-64's shell lists the current run's captured messages, newest first. Each row shows the recipient, subject, demo-clock time and dispatch status (sent, retrying, failed).
- [ ] **Message view:** opening a message shows its HTML body in a sandboxed frame with scripts disabled, and its plain-text alternative. The offer link opens the offer page in a new tab.
- [ ] **Role and run:** an employee or Greg who opens the viewer gets a clear refusal. After a reset, the viewer shows the new run's messages only.
- [ ] **States:** no messages yet, retrying and failed (with the error and attempt count), and the source unavailable.
- [ ] **Shared kit and embedding:** built from the shared kit per `COMPONENTS.md`, with kit additions in the same commit and a ratchet baseline that only falls. It mounts as a custom element, with no inline scripts, inline handlers or `eval` (Q18). Keyboard operable.

#### Files or areas

- `blocks/gcsp/ (proposed outbox viewer)`
- `server/index.js (presenter route for captured messages)`
- `COMPONENTS.md`, kit gallery, `server/test/ui-ratchet.json`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/screens/README.md`, `COMPONENTS.md` and `docs/gcsp/shared-contracts.md`. Carry the experience contract, the visual reference and these criteria into every child-agent brief.

HLD review: Q11 (the outbox viewer always ships), Q8 and Q18 apply.

Foundation (FUCQ-79): the presenter role and run scope come from FUCQ-84.

#### Out of scope

Real mail sending (FUCQ-88, transport story); the offer page (FUCQ-89).

#### Validate

Run commands from the worktree root.

- `npm test` passes, including the UI ratchet, the em-dash test and a route test for presenter-only access.
- Browser evidence at desktop and narrow widths, with keyboard-only operation, of these states: a list with messages, an open message, empty, failed, and refused for a non-presenter. Record the screenshot paths (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-98](https://ibm-consulting.atlassian.net/browse/FUCQ-98) · Send offer emails through one real transport once a sender is set up

```text
id: FUCQ-98
title: Send offer emails through one real transport once a sender is set up
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-88, critical path from HLD readiness section C4)
epic: FUCQ-88
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: S
depends_on: FUCQ-93
preconditions: implement now using the recorded Brevo handoff; verify the backend sender/API key, explicit demo-recipient mapping and public frontend base URL before the deliberate real-send validation (HLD review Q11).
```

#### Goal

As the presenter, I want an offer email to arrive in a real inbox when sender setup is ready, so that the demo can show a genuine notification.

#### Acceptance criteria

- [ ] **One real transport:** one real `MailTransport` adapter for the sender that is set up, behind FUCQ-93's port. It is selected only by backend configuration. With no configuration, the captured transport stays the default and nothing changes.
- [ ] **Capture always on:** every message is still captured for the viewer when the real transport is active, and the captured record notes the provider's message ID.
- [ ] **Allow-list:** recipients come from a configured list of demo addresses. Mail to any other address is refused and recorded, never sent.
- [ ] **Failures:** provider errors and timeouts are recorded as retrying or failed on the job. A timeout is not treated as success, and nothing touches stock or priority.
- [ ] **Secrets:** API keys and tokens stay backend-only and never appear in logs or responses.

#### Files or areas

- `server/gcsp/notify/ (one real transport adapter)`
- `server/test/gcsp-mail-transport.test.js (proposed, against a stubbed provider)`
- `README.md (environment variables for the GCSP backend)`
- `docs/gcsp/email-transport.md`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026, including this story with its sender-setup precondition (`docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` and `docs/design/gcsp-high-level-design.md`, "Transaction and event invariants". Carry these decisions and acceptance criteria into every child-agent brief.

Brevo reuse handoff, 5 November 2026, requested by Russell: read `docs/gcsp/email-transport.md`. Reuse Deckhead's transactional HTTP method with built-in `fetch`: `POST https://api.brevo.com/v3/smtp/email`, backend-only `api-key`, both rendered GCSP bodies and a stable per-run/job provider idempotency key. The handoff reproduces the method, proposed backend configuration, StanleyPi sender-domain evidence, source revision and remaining setup checks, so another machine does not need those local checkouts. The credential is a Brevo API key; no new PAT is needed for this method.

Preserve FUCQ-93's port, capture, canonical retry policy and run scope, FUCQ-97's viewer and the configured recipient allow-list. Persist the provider ID without leaking keys or token-bearing links. Read the handoff's capture/acknowledgement integration gap and finite provider idempotency window before implementing; copying Deckhead's whole mailer or logs is insufficient.

Russell explicitly resumed FUCQ-98 on 5 November 2026: "Yes resume it, I just gave the Brevo details in another session" (Codex chat 01a1ac41-5c78-7ff1-a49a-b7abdfc17ac3). This supersedes the pause in Jira comment 132470. Implement using docs/gcsp/email-transport.md; verify the configured sender, secret, approved demo recipients and public offer URL before the story's deliberate real-send check. The handoff records the method, not a completed configuration check. Jira comment 132509 records the resumption after reauthentication on 5 November; the updated description and unchanged acceptance/validation sections were verified by read-back.

HLD review, as it applies here:

- Q11: one real transport, if ready.
- Q4: `pg` is the only allowed runtime dependency, so use the provider's HTTP API with built-in `fetch`, not an SDK, unless Gary approves one.

#### Out of scope

Sender, domain or tenant setup; sending to anyone outside the demo allow-list; more than one provider.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-mail-transport.test.js`: against a stubbed provider, these pass:

    - send success;
    - provider error;
    - timeout;
    - the allow-list refusal;
    - capture while the real transport is active;
    - no secret in the logs.

- Follow `docs/gcsp/email-transport.md`, "Selected validation", for stable-key retries/restart/concurrency, ambiguous acknowledgements, capture on real-send failure, payload/body mapping and canonical absolute offer links. Automated tests use a stubbed provider and send no real mail.
- `npm test` passes.
- After the precondition clears: one real send to a demo address, with the provider message ID recorded in the story result.
- No new screen; the outbox viewer shows the status (`docs/gcsp/experience-quality.md`).

---

## [FUCQ-89](https://ibm-consulting.atlassian.net/browse/FUCQ-89) · Decide on an offer and get a second one

---

### [FUCQ-102](https://ibm-consulting.atlassian.net/browse/FUCQ-102) · Open an offer from a run-bound link that shows its current state

```text
id: FUCQ-102
title: Open an offer from a run-bound link that shows its current state
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-89, critical path from HLD readiness section C5)
epic: FUCQ-89
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-100, FUCQ-84, FUCQ-85
```

#### Goal

As Paula opening her offer email in any browser, I want the link to show me exactly where my offer stands now, so that an old or forwarded link can never mislead me or revive a hold.

#### Acceptance criteria

- [ ] **Exchange route:** a `/api/gcsp/offers/access` route exchanges the opaque token from the offer link (minted by FUCQ-100) for an offer access context scoped to that one offer. The token is looked up by hash. Its environment, run and offer binding are checked, and it is never logged.
- [ ] **Offer read:** the offer read returns server-derived current state: pending (with the expiry time from the persisted hold), accepted, declined, expired, superseded or stale run. It includes the pinned quote, the vehicle facts and the comparison inputs, and nothing about the employee's other offers, fleet or usage history.
- [ ] **Old links:** repeated, old or stale links read the current state and never extend or revive a hold. A link from an earlier run returns "this offer belongs to an earlier demo run". An unknown or tampered token returns a generic not-found response.
- [ ] **Account route:** a signed-in employee (FUCQ-84 context) reaches the same offer from their account without a token. Both routes produce one offer access context, and decisions (FUCQ-89, decision story) accept either.
- [ ] **Landing URL:** the landing URL comes from deployment configuration for the GCSP static site (Q1), never hard-coded.

#### Files or areas

- `server/gcsp/offers/ (token exchange, offer read)`
- `server/index.js (offer routes)`
- `server/test/gcsp-offer-access.test.js (proposed)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` and `docs/design/gcsp-high-level-design.md`: "Demo access and offer links" and "Transaction and event invariants". Carry these decisions and acceptance criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review, as it applies here:

- Q1: the GCSP static site on Render.
- Q15: the buddy hold.
- Offer links: hashed, run-bound opaque tokens. Later BMW operation needs the approved sign-in policy instead of this mechanism.

#### Out of scope

The offer page UI (FUCQ-89, offer page story); decisions (FUCQ-89, decision story); minting tokens (FUCQ-100).

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-offer-access.test.js`: these pass:

    - token exchange;
    - each current state;
    - an old link that never revives;
    - earlier-run and tampered tokens;
    - no leakage of other data;
    - account-route parity;
    - no token in the logs.

- `npm test` passes.
- Backend-only: no screen. Record each state's response shape for the offer page (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-105](https://ibm-consulting.atlassian.net/browse/FUCQ-105) · Show the offer's exact quote, current-car comparison and countdown

```text
id: FUCQ-105
title: Show the offer's exact quote, current-car comparison and countdown
kind: ui
design_impact: yes
ui: matchCard (extend: offer variant), mediaWell, el, cardinal; screenIntro, button and statusScreen (all listed under "Not yet in the kit"; reuse them if already added); FUCQ-31's shared decision cards and comparison rows; new: countdown, because no kit component shows a server-derived expiry
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-89, critical path from HLD readiness section C5)
epic: FUCQ-89
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: L
depends_on: FUCQ-102, FUCQ-31, FUCQ-64
```

#### Goal

As Paula, I want my offer to show the exact car, what it costs me in points, how it compares with my current car and how long I have, so that I can decide with confidence, even on my phone.

#### Acceptance criteria

- [ ] **Offer page:** the page, in FUCQ-64's shell, opens from the email link or from the account. It shows:

    - the exact car (model, derivative, colour, options, `orderNumber`, representative image with the fallback);
    - the points cost against the allowance;
    - grounded reasons it fits the brief, and its trade-offs;
    - a side-by-side comparison with Paula's current car (G21 320i M Sport Touring).

    Unknown equipment and representative images are labelled as such.

- [ ] **Countdown:** derived from the server expiry in FUCQ-102's read, never from a client timer. On reaching zero, the page re-reads the server and shows the actual state.
- [ ] **One state at a time:** pending (with accept and decline actions), accepted, declined, expired, earlier run and not found. Reload and a second browser show the same state. Decision actions call FUCQ-89's decision story and show the outcome.
- [ ] **Mobile first:** fully usable at 375 px, because the page is opened from email.
- [ ] **Shared kit:** built from the shared kit per `COMPONENTS.md`. Kit additions go in the same commit, and the ratchet baseline only falls.
- [ ] **Embeddable (Q18):** mounts as a custom element, with no inline scripts, inline handlers, `eval` or string timers. Keyboard operable, with visible focus and reduced motion.

#### Files or areas

- `blocks/gcsp/ (proposed offer block)`
- `blocks/vehicle-matcher/modes/result-card.js (kit extension only)`
- `COMPONENTS.md`, kit gallery, `server/test/ui-ratchet.json`
- `server/test/ (render test for the offer block)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md` ("Email offer pages need a usable narrow-screen experience"), `docs/gcsp/screens/README.md`, `COMPONENTS.md`, `docs/gcsp/shared-contracts.md` and `docs/design/gcsp-high-level-design.md`, blueprint column 05. Carry the experience contract, the visual reference and these criteria into every child-agent brief.

Visual reference: the screenshots govern the shell, and FUCQ-64's reviewed body reference governs the body.

HLD review, as it applies here:

- Q15: the buddy hold, labelled a proposed capability.
- Q16: points allowance; no cash.
- Q13: `orderNumber` is shown, not a VIN.
- Q8 and Q18.

#### Out of scope

The decision logic (FUCQ-89, decision story); the second-offer comparison (FUCQ-89, second-offer story).

#### Validate

Run commands from the worktree root.

- `npm test` passes, including the UI ratchet, the em-dash test and a render test for the offer block.
- `grep -rnE "on[a-z]+=|eval\(|new Function" blocks/gcsp/` finds nothing in the offer block.
- Browser evidence at 375 px and desktop widths, with keyboard-only operation, of each state, including the countdown reaching zero and a second browser showing the same state. Record the screenshot paths and compare them with the FUCQ-64 reference (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-106](https://ibm-consulting.atlassian.net/browse/FUCQ-106) · Accept, decline or expire an offer with idempotent outcomes

```text
id: FUCQ-106
title: Accept, decline or expire an offer with idempotent outcomes
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-89, critical path from HLD readiness section C5)
epic: FUCQ-89
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-102
```

#### Goal

As Paula, I want accepting or declining to take effect exactly once and tell me what happened, and an offer I ignore to lapse cleanly, so that the car goes where it should and nothing is lost to a double click.

#### Acceptance criteria

- [ ] **Accept:** accept revalidates the following before marking the offer accepted:

    - eligibility;
    - essentials;
    - permission;
    - the current hold;
    - the validity of the pinned quote (a newer points version doesn't reprice it).

    Accepting stops further buddy holds for this renewal or entitlement, and emits an offer-accepted event for the handoff (FUCQ-89, handoff story).

- [ ] **Decline:** decline records a typed reason from a fixed list in PolicyService (for example body style, size, fuel or equipment). It releases the hold, and the car becomes available once the release is confirmed. It adds the declined-car exclusion for this employee. It emits an offer-declined event, which the second-offer story uses.
- [ ] **Expire:** FUCQ-100's expiry handler expires an overdue offer. An expired offer stays expired: expiry is not a decline, sets no reason, and grants no priority.
- [ ] **Idempotent:** a decision, or its retry, is idempotent by command ID and returns the original outcome. A conflicting decision on an offer that is no longer pending returns that offer's current state. A stale run is refused.
- [ ] **Same path for both routes:** decisions accept either route's offer access context (from FUCQ-102). An employee cannot decide another employee's offer.
- [ ] **Separate records:** declining, changing the brief and after-use satisfaction are separate records (HLD invariant).

#### Files or areas

- `server/gcsp/offers/ (decision service)`
- `server/index.js (decision routes)`
- `server/test/gcsp-offer-decisions.test.js (proposed)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` and `docs/design/gcsp-high-level-design.md`: "Transaction and event invariants" and blueprint columns 06 and 11. Carry these decisions and acceptance criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review, as it applies here:

- Q15: holds.
- Q16: decline leads to one preference change, not a contribution change.
- Q19: post-selection target states belong to the handoff.

#### Out of scope

The UI (FUCQ-89, offer page story); the post-decline preference change and second offer (FUCQ-89, second-offer story); the ordering handoff (FUCQ-89, handoff story).

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-offer-decisions.test.js`: these pass:

    - accept revalidation;
    - pinned quote kept;
    - decline with a reason, releasing the hold and adding the exclusion;
    - expiry distinct from decline;
    - idempotent retry;
    - conflicting decisions;
    - cross-employee and stale-run refusal.

- `npm test` passes.
- Backend-only: no screen. Record each decision outcome's shape for the offer page (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-107](https://ibm-consulting.atlassian.net/browse/FUCQ-107) · Confirm one preference change after declining and receive a second offer

```text
id: FUCQ-107
title: Confirm one preference change after declining and receive a second offer
kind: ui
design_impact: yes
ui: renderOptionList, matchCard (offer variant from FUCQ-105), el; button and statusScreen (both listed under "Not yet in the kit"; reuse them if already added); FUCQ-30's confirmed preference/essential change action and FUCQ-31's comparison rows
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-89, critical path from HLD readiness section C5)
epic: FUCQ-89
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: L
depends_on: FUCQ-106, FUCQ-91, FUCQ-96
```

#### Goal

As Paula, having declined an offer, I want to confirm the one thing I would change and then get a better-fitting second offer explained against the first, so that declining moves me forward instead of starting over.

#### Acceptance criteria

- [ ] **One question:** after a decline, the page asks one fixed follow-up question chosen by the typed decline reason. The reason-to-question map is a PolicyService key. Paula confirms one preference change, for example body style or an essential. Nothing changes until she confirms (Q16).
- [ ] **Saved through BriefService:** confirming calls FUCQ-91's single-change operation, which creates a new brief version. Her other essentials and priorities are kept, and the brief-changed event triggers re-evaluation. The unchanged declined car is excluded.
- [ ] **Second offer:** on the next presenter release tick (blueprint 09), allocation (FUCQ-96) and the hold (FUCQ-100) produce a second offer when a fitting car exists. If none fits, the page shows a calculated "nothing suitable yet" state, never a prewritten outcome. No winner is hard-coded.
- [ ] **Second offer page:** the second offer page shows the second car against the first (blueprint 10). It explains the measured differences from the two stored quotes and the current brief, never an inferred, unspoken preference.
- [ ] **States:** question shown, change saved, waiting for the next release, second offer ready, no match yet, and source unavailable. Reload shows the server state.
- [ ] **Kit and embedding:** built from the shared kit with no new duplicate controls, and it reuses FUCQ-30's action. No inline scripts, handlers or `eval`. Keyboard operable, and usable at 375 px.

#### Files or areas

- `blocks/gcsp/ (offer block: decline follow-up and second-offer comparison)`
- `server/gcsp/offers/ (first-versus-second quote projection)`
- `server/test/gcsp-second-offer.test.js (proposed)`
- `COMPONENTS.md`, kit gallery, `server/test/ui-ratchet.json`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/screens/README.md`, `COMPONENTS.md`, `docs/gcsp/shared-contracts.md`, `docs/gcsp/hld-agreement-2026-11-04.md` (Q16) and `docs/design/gcsp-high-level-design.md`, blueprint columns 06, 07, 09 and 10. Carry the experience contract, the visual reference and these criteria into every child-agent brief.

HLD review, as it applies here:

- Q16, agreed by Russell: one preference change after a decline, not a contribution ceiling.
- Q9: this is the middle of Gary's critical path.
- Q3: the second release is a presenter tick.
- Q8 and Q18.

#### Out of scope

The decline logic itself (FUCQ-106); the first offer page (FUCQ-105).

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-second-offer.test.js`: these pass:

    - the reason-to-question map read from PolicyService;
    - one confirmed change creating a new brief version, with the rest preserved;
    - declined-car exclusion;
    - a second offer after a tick when a car fits;
    - a calculated no-match;
    - the first-versus-second projection taken from stored quotes.

- `npm test` passes, including the UI ratchet and the em-dash test.
- Browser evidence at 375 px and desktop widths, with keyboard-only operation, of each state. Record the screenshot paths (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-108](https://ibm-consulting.atlassian.net/browse/FUCQ-108) · Hand off a selected buddy offer through the ordering adapter

```text
id: FUCQ-108
title: Hand off a selected buddy offer through the ordering adapter
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-89, critical path from HLD readiness section C5)
epic: FUCQ-89
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-106, FUCQ-71
```

#### Goal

As Paula, having accepted an offer, I want my selection sent on for approval exactly once and shown truthfully, so that I know my car is on its way without anyone pretending it is already approved.

#### Acceptance criteria

- [ ] **Handoff:** on offer-accepted (FUCQ-106), the selection is handed off through FUCQ-71's idempotent ordering adapter, the same one the manual route uses. In the same transaction, the hold becomes an allocation of the existing stock order (round-1 finding). No second ordering adapter is built.
- [ ] **No further holds:** no further buddy holds or offers are made for this renewal or entitlement, and the brief records the selection.
- [ ] **Target state names (Q19):** the offer and account show the post-selection state in the target platform's names:

    - selection received;
    - HR approval (configurable, because the target may drop it);
    - sales-manager approval;
    - sent to ordering.

    An acknowledged selection, a pending handoff and an approved order are distinct, and nothing claims approval from a local button.

- [ ] **Uncertain outcomes:** a timeout or uncertain response stays pending, and is reconciled through FUCQ-85's reconciliation tick before any retry. It never becomes success or frees the car.
- [ ] **Allowance gate:** the points allowance is rechecked through PolicyService at handoff, with the pinned quote kept.

#### Files or areas

- `server/gcsp/offers/ (selection handoff)`
- `server/test/gcsp-buddy-handoff.test.js (proposed)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` and `docs/design/gcsp-high-level-design.md`: "Greg's supply loop" (the lifecycle paragraph) and blueprint column 11. Carry these decisions and acceptance criteria into every child-agent brief.

FUCQ-71 owns the ordering adapter, and this story calls it.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review: Q19 (target approval names), Q14 (target AWS platform) and Q9 (selection is the end of the critical path) apply.

#### Out of scope

Approval progress after "sent to ordering", appointments and handover (lifecycle, C7); the ordering adapter itself (FUCQ-71).

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-buddy-handoff.test.js`: these pass:

    - a single handoff through FUCQ-71's adapter;
    - hold to allocation in one transaction;
    - no further holds after selection;
    - target state names;
    - uncertain outcomes kept pending and reconciled on a tick;
    - allowance recheck with the pinned quote.

- `npm test` passes.
- Backend-only: no new screen. The offer page shows the state; record its shapes (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-109](https://ibm-consulting.atlassian.net/browse/FUCQ-109) · Verify Paula's critical path end to end with browser evidence

```text
id: FUCQ-109
title: Verify Paula's critical path end to end with browser evidence
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-89, critical path from HLD readiness section C5)
epic: FUCQ-89
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-105, FUCQ-107, FUCQ-108, FUCQ-97
```

#### Goal

As Gary presenting on 12 November, I want proof that Paula's path from brief to selection works end to end after a reset, so that the critical path is green before anything else.

#### Acceptance criteria

- [ ] **Integration test:** an automated integration test drives the backend through Paula's path after a reset (FUCQ-85):

    1. save the brief;
    2. release on a tick;
    3. allocate against at least two competing employees;
    4. hold, offer and capture the outbox message;
    5. open the offer link;
    6. decline with a reason;
    7. confirm one change;
    8. release again on the next tick;
    9. receive the second offer;
    10. accept;
    11. hand off.

    Each step's state is asserted, including the declined-car exclusion and the target state names.

- [ ] **Repeat and stale links:** the same test repeats the path after a second reset and gets the same outcome with new identifiers. An offer link from the first run is refused as stale.
- [ ] **Browser walkthrough:** the walkthrough covers the brief, activity, the outbox viewer, the first offer, the decline follow-up, the second offer and the selection outcome. It runs against the integrated build at desktop and 375 px, with keyboard operation, and the screenshot paths are recorded. Visible defects are fixed or listed as remaining work.
- [ ] **One central change:** changing one central PolicyService assumption (for example the buddy hold duration or the tie-break) changes the walkthrough's behaviour and display consistently, as the build-rules acceptance requires.
- [ ] **Manual scenario:** a manual scenario for Russell's click-through is added to `docs/gcsp/manual-acceptance-scenarios.md`. It gives the start state, the reset and tick steps, the expected outcome at each step, and space for observations (FUCQ-75 approach).

#### Files or areas

- `server/test/gcsp-critical-path.test.js (proposed)`
- `docs/gcsp/manual-acceptance-scenarios.md`
- `docs/gcsp/evidence/fucq-89/ (screenshots and results)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md` ("Verify before declaring a UI story built"), `docs/gcsp/manual-acceptance-scenarios.md` and `docs/design/gcsp-high-level-design.md`, blueprint columns 02 to 11. Carry the experience contract, the visual reference and these criteria into every child-agent brief.

HLD review: Q9 (this is Gary's critical path and must be green first), Q3 (presenter ticks) and Q11 (the outbox viewer stands in for real mail) apply.

#### Out of scope

Greg's dashboard verification (FUCQ-90's Stories carry their own evidence); real mail (the transport Story in FUCQ-88); deployment smoke tests (FUCQ-36).

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-critical-path.test.js`: the full path, the repeat after a reset, the stale link from an earlier run, and the central-assumption change all pass.
- `npm test` passes.
- Browser evidence at desktop and 375 px, with keyboard operation, is saved under `docs/gcsp/evidence/fucq-89/` and listed in the story result, with any remaining visual defects named (`docs/gcsp/experience-quality.md`).

---

## [FUCQ-90](https://ibm-consulting.atlassian.net/browse/FUCQ-90) · Give Greg a demand and supply dashboard

---

### [FUCQ-99](https://ibm-consulting.atlassian.net/browse/FUCQ-99) · Aggregate saved demand and offer outcomes for Greg

```text
id: FUCQ-99
title: Aggregate saved demand and offer outcomes for Greg
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-90, critical path from HLD readiness section C6)
epic: FUCQ-90
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-91, FUCQ-81, FUCQ-84
```

#### Goal

As Greg, I want saved demand and what actually happened to offers added up for me, so that I can see which cars employees need and where supply falls short.

#### Acceptance criteria

- [ ] **Demand projection:** a demand projection over the repository for the current run aggregates:

    - active briefs by model line, body, fuel and essentials;
    - unmet needs: briefs with no eligible released car, and the gate that blocks them;
    - holds;
    - offers made, accepted, declined (by typed reason), expired and selected.

    Each aggregate gives its counts, and the brief and policy versions it used.

- [ ] **Stock alongside:** released, held and allocated stock counts by model line sit next to the demand figures.
- [ ] **Privacy:** no individual trip or usage history, and no employee names, appear in Greg's aggregates. A count below a PolicyService threshold key is shown as a band ("fewer than N").
- [ ] **Expressed demand only:** demand is taken from saved briefs and outcomes, never from the retail display sample, and a fit score is never counted as satisfaction (HLD "Greg's supply loop").
- [ ] **Role and run:** a `/api/gcsp` read for the Greg role; other roles are refused. Run-scoped.
- [ ] **Updates:** figures change after a new brief, a release, a decline or a selection, and a test proves this.

#### Files or areas

- `server/gcsp/greg/ (proposed demand projection)`
- `server/index.js (Greg route)`
- `server/test/gcsp-greg-demand.test.js (proposed)`
- `docs/gcsp/shared-contracts.md (update if a shape changes)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md`, `docs/gcsp/personas/scheme-ordering-lead.md` and `docs/design/gcsp-high-level-design.md`, "Greg's supply loop and the commitment boundary". Carry these decisions and acceptance criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

Knowledge-base finding: no KPIs exist on the target for order volumes or unallocated stock, so this is net new.

FUCQ-74 later adds prediction on top of this projection, without replacing it.

#### Out of scope

The dashboard screen (FUCQ-90, dashboard story); prediction and order planning (FUCQ-74); publishing policy (FUCQ-90, publish story).

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-greg-demand.test.js`: these pass:

    - each aggregate;
    - unmet needs by gate;
    - small-count banding;
    - no personal fields in the output;
    - role refusal;
    - run scope;
    - figures updating after events.

- `npm test` passes.
- Backend-only: no screen. Record the projection shape for the dashboard (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-101](https://ibm-consulting.atlassian.net/browse/FUCQ-101) · Show Greg demand, outcomes and stock on one dashboard

```text
id: FUCQ-101
title: Show Greg demand, outcomes and stock on one dashboard
kind: ui
design_impact: yes
ui: el, gbp, cardinal; screenIntro and statusScreen (both listed under "Not yet in the kit"; reuse them if already added); FUCQ-31's shared fact and decision components; new: metricTile and dataTable, because the kit has no dense operational tiles or tables (Greg's denser treatment, docs/gcsp/experience-quality.md)
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-90, critical path from HLD readiness section C6)
epic: FUCQ-90
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: L
depends_on: FUCQ-99, FUCQ-31, FUCQ-64
```

#### Goal

As Greg, I want one screen that shows demand against stock and what happened to offers, so that I can see at a glance where the scheme needs different cars.

#### Acceptance criteria

- [ ] **Dashboard:** a Greg dashboard block in FUCQ-64's shell renders FUCQ-99's projection:

    - demand by model line, body, fuel and essentials;
    - unmet needs, with the blocking gate;
    - offers made, accepted, declined (by reason), expired and selected;
    - released, held and allocated stock alongside.

- [ ] **Versions and refresh:** the dashboard shows the policy and brief versions and the demo-clock time the figures are for. Refreshing after a release, a decline or a selection shows updated figures.
- [ ] **Space for later work:** the layout leaves defined regions for the publish controls and the order-tracking panel (the other two Stories in FUCQ-90), and for FUCQ-74's prediction panel. It does not draw placeholder data for them.
- [ ] **States:** no briefs yet, no stock released, small counts banded, source unavailable, and refused for a non-Greg role.
- [ ] **Operational treatment:** Greg's denser view uses the same shell, tokens and component language as the employee screens. New components go into the kit, `COMPONENTS.md` and the gallery in the same commit, and the ratchet baseline only falls.
- [ ] **Embeddable (Q18):** mounts as a custom element, with no inline scripts, inline handlers or `eval`. Keyboard operable, with readable contrast.

#### Files or areas

- `blocks/gcsp/ (proposed Greg dashboard block)`
- `COMPONENTS.md`, kit gallery, `server/test/ui-ratchet.json`
- `server/test/ (render test for the dashboard block)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md` ("Establish Greg's denser operational treatment"), `docs/gcsp/screens/README.md`, `COMPONENTS.md`, `docs/gcsp/personas/scheme-ordering-lead.md` and `docs/design/gcsp-high-level-design.md`, "Greg's supply loop", plus diagram page 07. Carry the experience contract, the visual reference and these criteria into every child-agent brief.

HLD review, as it applies here:

- Q8: separate GCSP blocks.
- Q18: custom element and CSP.
- Q10: FUCQ-74's deterministic baseline and labelled learned model plug into this dashboard later.

#### Out of scope

Prediction and order planning (FUCQ-74); publishing (the publish Story in FUCQ-90); order tracking (the order-tracking Story in FUCQ-90).

#### Validate

Run commands from the worktree root.

- `npm test` passes, including the UI ratchet, the em-dash test and a render test for the dashboard.
- Browser evidence at desktop and narrow widths, with keyboard-only operation, of these states: populated, figures after a release and a decline, empty, banded counts, unavailable, and refused for a non-Greg role. Record the screenshot paths (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-103](https://ibm-consulting.atlassian.net/browse/FUCQ-103) · Preview and publish points and recommendation weights

```text
id: FUCQ-103
title: Preview and publish points and recommendation weights
kind: ui
design_impact: yes
ui: renderRangeSlider (single option, as extended by FUCQ-94), el, cardinal; button and statusScreen (both listed under "Not yet in the kit"; reuse them if already added); metricTile and dataTable from FUCQ-101
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-90, critical path from HLD readiness section C6)
epic: FUCQ-90
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-101, FUCQ-83
```

#### Goal

As Greg, I want to try a change to points or recommendation weights, see its effect, and then publish it on purpose, so that I can steer employees toward cars the scheme has without breaking any offer already made.

#### Acceptance criteria

- [ ] **Controls:** Greg's dashboard gains controls for the published points costs and recommendation weights that PolicyService exposes as editable. The editable keys are listed in `shared-contracts.md`. Essentials and eligibility gates are not editable here.
- [ ] **Preview:** Preview recomputes demand and fit outcomes (FUCQ-99 and FUCQ-29) against the draft values without writing anything. The screen says clearly that it is a preview and shows its differences from the active version.
- [ ] **Publish:** Publish calls FUCQ-83's `publishPolicyVersion`. It shows the new version number and effective date and records Greg as the publisher. A rejected change set shows its reasons.
- [ ] **Held offers keep their terms:** after publishing, held offers keep their pinned quote, and the screen says how many active offers keep their earlier terms. New allocations and previews use the new version.
- [ ] **One change everywhere:** one published change visibly updates Greg's figures and the next employee preview. This meets the build-rules acceptance: change one entry, and every consumer follows.
- [ ] **States, kit and embedding:** draft, preview loading, preview ready, publishing, published, rejected and refused for a non-Greg role. Built from the shared kit, with no inline scripts, handlers or `eval`, and keyboard operable.

#### Files or areas

- `blocks/gcsp/ (Greg dashboard: publish panel)`
- `server/index.js (Greg preview and publish routes)`
- `server/test/gcsp-greg-publish.test.js (proposed)`
- `COMPONENTS.md`, kit gallery, `server/test/ui-ratchet.json`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md` (rules 4 and 5, and the acceptance paragraph), `docs/gcsp/experience-quality.md` ("Live-change demonstration"), `docs/gcsp/screens/README.md`, `COMPONENTS.md`, `docs/gcsp/shared-contracts.md` and `docs/design/gcsp-high-level-design.md`, "Greg's supply loop". Carry the experience contract, the visual reference and these criteria into every child-agent brief.

The HLD says changes steer appropriate cars only. They cannot relax essentials or silently alter an active quote. A what-if preview is distinct from a published policy.

HLD review, as it applies here:

- Q6: Greg's publish writes a new dated row.
- Q16: points-based allowance.
- Q8 and Q18.

#### Out of scope

Learned-model activation (FUCQ-74); changing eligibility matrices; order requests (the order-tracking Story in FUCQ-90).

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-greg-publish.test.js`: these pass:

    - a preview that writes nothing;
    - publish creating a new version;
    - rejected change sets;
    - pinned offers left unchanged;
    - role refusal.

- `npm test` passes, including the UI ratchet and the em-dash test.
- Browser evidence at desktop and narrow widths, with keyboard-only operation, of preview, publish, the active-offers-kept message, a rejection, and the employee preview changing after a publish. Record the screenshot paths (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-104](https://ibm-consulting.atlassian.net/browse/FUCQ-104) · Track order requests from requested to confirmed to released

```text
id: FUCQ-104
title: Track order requests from requested to confirmed to released
kind: ui
design_impact: yes
ui: el, cardinal; button and statusScreen (both listed under "Not yet in the kit"; reuse them if already added); dataTable and metricTile from FUCQ-101
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-90, critical path from HLD readiness section C6)
epic: FUCQ-90
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-101, FUCQ-92
```

#### Goal

As Greg, I want to request cars, see when production confirms them and see them released to the scheme, so that I know which promised supply is real and when employees can get it.

#### Acceptance criteria

- [ ] **Three records:** `FutureOrderRequest`, `ConfirmedSupply` and `ReleasedStock` are distinct records in FUCQ-81's repository, each with its own status and provenance. A request is Greg's intent, made to the ordering side and not as a GCSP stock write. A synthetic production adapter acknowledges it into confirmed supply, with expected dates. Only FUCQ-92's release on a tick makes released stock.
- [ ] **Submitting a request:** Greg chooses model, derivative and quantity, then submits. The submission is idempotent, records the policy and stock versions it saw, and shows as requested.
- [ ] **Confirmation and release:** the presenter can step the synthetic production adapter to confirm all or part of a request, or to delay it. Confirmed supply queues a release tranche for FUCQ-92, with lead time from a PolicyService key.
- [ ] **Tracking panel:** the panel on Greg's dashboard shows each request's stage (requested, confirmed with expected date, released with count), plus delays and partial confirmations. A delayed or unconfirmed request is never counted as available stock.
- [ ] **Allocation follows release:** after a release from a confirmed request, the buddy's allocation runs on that stock (FUCQ-96), and Greg's demand figures update.
- [ ] **States, kit and embedding:** no requests yet, requested, partly confirmed, delayed, released and adapter unavailable. Built from the shared kit, with no inline scripts, handlers or `eval`, and keyboard operable.

#### Files or areas

- `server/gcsp/supply/ (proposed: order requests, synthetic production adapter)`
- `blocks/gcsp/ (Greg dashboard: order tracking panel)`
- `server/test/gcsp-greg-orders.test.js (proposed)`
- `COMPONENTS.md`, kit gallery, `server/test/ui-ratchet.json`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026 (`docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/screens/README.md`, `COMPONENTS.md`, `docs/gcsp/shared-contracts.md` and `docs/design/gcsp-high-level-design.md`, "Greg's supply loop and the commitment boundary" (a request, an acknowledgement and a release are three different facts). Carry the experience contract, the visual reference and these criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

Knowledge-base findings:

- Future orders live upstream on one status scale, with requested and confirmed dates. GCSP doesn't create them directly.
- Lead times and release sizes are plausible keyed assumptions.

HLD review: Q3, Q8, Q14 (target AWS platform) and Q18 apply.

FUCQ-74 later builds the constrained order plan that proposes these requests.

#### Out of scope

Predicted demand and order planning (FUCQ-74); live ordering-system writes.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-greg-orders.test.js`: these pass:

    - the three distinct records;
    - idempotent submission;
    - partial and delayed confirmation;
    - only a release making stock;
    - allocation and demand updating after a release;
    - role refusal.

- `npm test` passes, including the UI ratchet and the em-dash test.
- Browser evidence at desktop and narrow widths, with keyboard-only operation, of each stage and the delayed and empty states. Record the screenshot paths (`docs/gcsp/experience-quality.md`).
