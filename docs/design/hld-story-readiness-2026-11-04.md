# HLD readiness for story breakdown — 4 November 2026

Assessment of the GCSP HLD on `origin/gcsp-poc` at `c7cfa9d` (`gcsp-high-level-design.md`, `high-level-design.drawio`, `hld-review-gc.md`, `../gcsp/hld-agreement-2026-11-04.md`) against the initial requirements: the [demo brief](../gcsp/demo-brief.md), the [22 capability proposals](../gcsp/capability-breakdown.md) and the [build rules](../gcsp/build-rules.md). The Jira FUCQ backlog was read on the same date. Nothing was changed in Jira or the design.

## Verdict

**Ready, with conditions.** The architecture is settled and agreed. Every required demo element has a responsible module, and Gary's 19 review decisions are applied to the draw.io diagram. Story breakdown can start once three things are done, which should take hours, not days:

1. Bring the narrative record into line with the 4 November decisions (section A). Story authors read it, and in five places it still says the old thing.
2. Write the decided build constraints where agents will read them (section B).
3. Create Epics for the critical-path capabilities, which have no backlog yet (section C), and re-align the existing stories that predate the review (section D).

The bigger risk is time, not the design. The demo is in 8 days. None of the 57 existing Stories has started, and the capabilities on Gary's critical path (Q9: Paula's offer → decline → second offer → select, plus Greg's dashboard) have no Stories at all.

## Requirements coverage

| Requirement (demo brief) | Where the HLD puts it | Coverage | Backlog |
|---|---|---|---|
| Employee home: current car, connected use, countdown, preferences, buddy on/off | Blueprint columns 01–04; connected use is future and synthetic-only (Q17) | Good | FUCQ-67 (contracts) only; **no buddy home, brief or activity Epic** |
| Sliders plus separate importance weights | Column 02; precedence rule 1 | Good | FUCQ-29/30/31 cover the controls; saving the brief has no owner |
| Tranche release triggers matching on saved briefs | Column 09; release = stock appearing on the next pull, run by a presenter tick (Q3) | Good | **None** |
| Buddy hold, competition and a shared scarce pool | Allocation and offers; transaction invariants; two hold types (Q15) | Good | FUCQ-66 has the manual claim only; **no buddy allocation or offer hold** |
| Real email after a hold, through an adapter | Atomic hold + offer + outbox; outbox viewer always, one real transport if ready (Q11) | Good | **None** |
| Offer landing page that reflects current state | Demo access and offer links (hashed run-bound token) | Good | **None** |
| Accept, reject, expiry, second offer | Columns 05–11; invariants | Good | **None** |
| Manual route on the same pool | Columns 01a/11; one authority | Good | FUCQ-64–73 |
| Greg: demand, points and weights, order requests, stages | Supply loop; page 07 | Good | **None** (FUCQ-74 covers only the predictive part) |
| Greg: predicted demand and constrained order plan (FUCQ-74) | Dedicated section; page 08; deterministic baseline drives the plan (Q10) | Good | Epic exists, **no Stories** |
| Demo clock, reset, presenter navigation | Invariants (reset, ticks); `DemoIdentityAdapter` | Adequate | FUCQ-75 Epic, **no Stories** |
| Unresolved renewals and recovery | Column 08 help and owned case; "no automatic recovery priority" | Thin but consistent with the brief's caution | **None** |
| 1,000-employee comparison | One paragraph; one unlabelled diagram node | **Thin**: no module placement, inputs, outputs or UI | **None** |
| Central policy and assumptions source | PolicyService over dated Postgres tables (Q6) | Good | **No foundation story**, though every consumer needs it |
| Shared launcher | FUCQ-13 | Good | FUCQ-32–36 (FUCQ-36 is stale, see D) |
| Vehicle evidence and synthetic identity | Section and page 06; three identities (Q13) | Good | FUCQ-37–63, 77, 78 (re-scoped 4 Nov) |
| Deployment and later BMW gates | Q1, Q2, Q14; gates table | Good in the diagram; stale in the narrative (A3) | None needed beyond provisioning |

All 22 original capability proposals map to an HLD responsibility. None was dropped.

## A. Narrative record still contradicts the 4 November decisions

**Done 4 Nov, same commit as this assessment:** items 1–5 fixed in `gcsp-high-level-design.md` and the design README; the exception in item 4 is now in `build-rules.md`. The PNG re-export is still to do.

The record says the review takes precedence where they disagree. That works for a careful reader but not for a story author working from one section. Fix these before writing stories:

1. **Column 09, line 80:** "including the lower ceiling and decline history". Q16 replaced the lower contribution ceiling with a single preference change.
2. **Lifecycle, line 137:** `selection-received` → `handoff-pending` → `order-acknowledged` is the old state set. Q19 adopts the target's approval and appointment names, and diagram page 07 already uses them.
3. **Technical deployment, lines 183–196, and offer links, line 164:** these still describe Pages from `main`, the EDS publication route and "the agreed main/manual route", with a "stable Pages landing URL" for offer links. Q1 and Q12 put GCSP on its own Render backend plus a Render static site from `gcsp-poc`, with no EDS route.
4. **Corpus, lines 102 and 125:** "must prove 10,000 distinct signatures". The 4 November data route (FUCQ-77/78) uses at least 200 real configurations for the demo and moves FUCQ-61's 10,000 to after 12 November. That is a second exception to the full-build rule, but `build-rules.md` records only the Q5 exception.
5. **Responsibilities table:** it doesn't state Q8 (separate GCSP blocks importing the shared kit, with `vehicle-matcher` staying retail-only) or Q18 (blocks also mount as custom elements). Story authors need both to place files.

The PNG exports also predate the review (the design README says so). Re-export them, or drop them from story briefs.

## B. Decided constraints that agents won't see

**Done 4 Nov, same commit:** `CLAUDE.md` and `build-rules.md` allow `pg`; the experience contract has an "Embeddable blocks" section with the CSP rule; the HLD invariants state both hold types. FUCQ-66 itself is still to update in Jira (section D).

- **`pg` is allowed (Q4),** but `CLAUDE.md` on `gcsp-poc` still says "Zero runtime dependencies on both sides". Implementers follow `CLAUDE.md`, so any Postgres story will either stall or put the database in memory. Update `CLAUDE.md`.
- **CSP rule (Q18):** no inline scripts, inline event handlers or `eval` in GCSP blocks. It appears in no story, and in neither the build rules nor the experience contract. Add it to the experience contract so every UI story inherits it.
- **Cart hold of about two minutes (Q15):** FUCQ-66 still leaves the manual timing "pending SAN-017".

## C. Capabilities with no Epic or Story

These are most of the demo's critical path. The 2 November [delivery readiness review](../gcsp/delivery-readiness-review.md) found the same gap, and it is still open:

1. **Foundation (do first; the others share it):** Postgres transaction repository and migrations, PolicyService plus a seeded policy file, `DemoIdentityAdapter`, and the presenter tick/clock/reset. FUCQ-66 currently carries part of the repository inside a manual-journey story. Pull it out, or name FUCQ-66 as the owner explicitly.
2. **Brief and buddy:** save and revise a versioned brief, buddy on/off and pause, and the activity view.
3. **Release → allocation → buddy offer hold**, including competing employees and the allocation tie-break held in the policy source.
4. **Notification:** outbox, captured-outbox viewer, one transport adapter.
5. **Offer page and decisions:** token access, accept/decline/expiry, the step-07 preference change, the second offer, and selection handoff.
6. **Greg's dashboard:** demand aggregation, points and weights publish, and order request → confirmed → released. FUCQ-74's Stories layer prediction on top of this.
7. **Lifecycle after selection:** target approval and appointment states, and the renewal-risk case.
8. **1,000-employee comparison:** needs an HLD paragraph first, covering where it runs (offline script or backend job), what it reuses, its seeds and outputs, and how the presenter shows it.
9. **FUCQ-74 and FUCQ-75 Stories** under their existing Epics.

Also needed before Stories go in parallel: one owner for the shared contracts (the brief schema, offer/hold state machine, policy keys and repository schema). The HLD defers interface-control review and defines only the vehicle-evidence route. That's fine for an HLD, but without one owning foundation story, parallel pollers will each invent their own.

## D. Existing Stories that predate the review

**Done in Jira, 4 Nov, except the links:**
- **FUCQ-29, 30 and 31:** descriptions edited. `depends_on` drops FUCQ-27/28, the policy builds on `rankCars()`, the points allowance replaces the contribution ceiling, and FUCQ-31 also gets the CSP rule.
- **FUCQ-35 and 36:** rewritten for the GCSP Render environment. FUCQ-36 is retitled "…for the GCSP static site".
- **FUCQ-64–73:** each gets a "HLD review, 4 November 2026" paragraph in Decided covering Q2, Q4, Q6, Q8, Q13, Q16 and Q18, plus story-specific points:
  - FUCQ-66: the cart hold of about two minutes; the GC-003 precondition cleared.
  - FUCQ-70: the countdown follows that hold.
  - FUCQ-71 and FUCQ-72: allocate the existing stock order, and use the target status names (Q19).
- **FUCQ-1 and FUCQ-76:** Rejected.

**Still open:** the connector cannot delete issue links. Four stale Blocks links must be removed in the Jira UI: FUCQ-27→29, FUCQ-28→29, FUCQ-28→30 and FUCQ-28→31. Until then, `jira_sync.py` still puts FUCQ-27/28 into those stories' `depends_on`, because it reads dependencies from links.

| Story | Problem | Fix |
|---|---|---|
| FUCQ-29 | Description still says `depends_on: FUCQ-26, FUCQ-27, FUCQ-28`, and the Blocks links remain. A comment corrects this. AC still gates on a "contribution ceiling" rather than the points allowance. | Edit the description, remove the two links, and replace the ceiling with the allowance gate |
| FUCQ-30, FUCQ-31 | Same leftover FUCQ-27/28 dependency (FUCQ-31 is still blocked by FUCQ-28) | Edit the descriptions and remove the links |
| FUCQ-35, FUCQ-36 | "Existing static host", "keep the existing main/workflow_dispatch release triggers and current Render topology" | Rewrite for the separate `gcsp-poc` Render environment (Q1) |
| FUCQ-64–73 | They predate Q8, Q15, Q18 and Q19, and FUCQ-66 is still gated on an SQL choice that Q2 has now made | Add the block placement, cart hold, CSP rule and target state names; clear the GC-003 precondition |
| FUCQ-1, FUCQ-76 | Placeholder and test items sitting in To Do | Close them before any poller can claim them |

Re-checking the FUCQ-14–20 Stories is not needed. They were re-scoped on 4 November (FUCQ-52–63 updated) and use `orderUuid`/`configurationId`.

## Open items that don't block story breakdown

- GC-001 dashboard facts (Render/Pages ownership, `DEMO_ACCESS_KEY`, `EDS_SYNC_TOKEN`). They matter less now that GCSP gets its own environment, but someone still has to provision that environment and its Postgres, and Q2 asks for a cost flag.
- Sandeep's answers. The build rules permit keyed plausible assumptions.
- Mail sender setup. The outbox viewer covers the demo without it.

## Recommended order

1. Make the A and B fixes in one docs commit on `gcsp-poc`.
2. Author the foundation Epic and its Stories first, then the critical-path Epics C2–C6, then C7–C9.
3. Re-align the D stories during the same pass.
4. Start pollers on FUCQ-21, FUCQ-26, FUCQ-64 and the foundation stories (independent and needed first), then fan out.

Given 8 days, sequence the authoring and building by Gary's critical path. If the full build won't fit, say so early and say which capability moves, rather than cutting verification.
