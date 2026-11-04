# Handover: author GCSP readiness items C7, C8 and C9

4 November 2026, from the session that authored FUCQ-79 to FUCQ-109. Branch `gcsp-poc`, head `8bb7272` or later; pull first. Jira FUCQ on `ibm-consulting.atlassian.net` (cloudId `9024e134-9d2e-4f15-af8d-4df1fd4c2cb1`). Each item runs in its own session; this file is shared by all three, and each session does only its own section.

## Shared rules for every session

- **Story authoring only.** No application code, pollers or provisioning.
- **Get approval first.** Before creating anything in Jira, show Gary (or Russell) the Epic and Story titles with one line each, plus the dependency order, and wait for their OK. Equal authority applies (`AGENTS.md`).
- **Copy the format** of [fucq-86-90-stories.md](../gcsp/fucq-86-90-stories.md) and Jira FUCQ-91. That means:
  - the scaffolding preamble line;
  - the fenced `text` header;
  - Goal, Acceptance criteria (`- [ ]`), Files or areas, Decided, Out of scope, Validate.

  Leave `story_points` out. `ui`-kind stories add a `ui:` line naming kit components from [COMPONENTS.md](../../COMPONENTS.md).
- **Every Story's Decided section:**
  - cites `docs/gcsp/README.md`, `demo-brief.md`, `build-rules.md`, `experience-quality.md` and `shared-contracts.md` (FUCQ-80);
  - includes the four-line "Foundation (FUCQ-79)" list used in FUCQ-91 (repository FUCQ-81, PolicyService FUCQ-82, identity FUCQ-84, clock FUCQ-85);
  - cites the HLD review decisions it relies on (`docs/design/hld-review-gc.md`).
- **Fields:**
  - Priority: High, written `priority: P2` with `priority_reason: due 2026-11-12: GCSP demo`, unless the item is clearly after the demo. Then use P3 with `priority_reason: default`, and say so when you ask for approval.
  - Labels: `backlog`, `design-impact` where relevant, `kind:<kind>`, `size:<size>`. Each Story's parent is its Epic.
- **Epics** use the `scaffolding:backlog` skill in Jira mode. Labels are `backlog`. The description ends with `Added by: garyscarter-ibm`. Once the first Story is written, move the Epic to In Progress (transition id `21`) and set its Start date (`customfield_10015`) to the day's date.
- **Dependencies are native Blocks links.** Use `createJiraIssueLink` via `executeWrite`, where `inwardIssue` blocks `outwardIssue`. Links cannot be deleted, so create one, read it back to confirm the direction, then create the rest. Every Story's `depends_on` must equal its inward Blocks links.
- **Records:**
  1. Read back every issue.
  2. Write `docs/gcsp/<epic-key>-stories.md` and `docs/gcsp/evidence/<epic-key>/story-publication.json`, in the same shape as the FUCQ-86–90 pair.
  3. Add one README row under the FUCQ-86–90 row in `docs/gcsp/README.md`.
- **Pushing:** work on a new branch from `origin/gcsp-poc`. Commit, run `git fetch origin gcsp-poc && git rebase origin/gcsp-poc`, then `git push origin HEAD:gcsp-poc`. Other sessions push to the same branch. If the README conflicts, keep both rows.
- **Don't touch** the other sessions' Epics, or FUCQ-30, 36, 69, 70, 71, 73 and 78. A separate session is editing those ([handover-existing-story-edits-2026-11-04.md](handover-existing-story-edits-2026-11-04.md)).
- **Read first:**
  1. [hld-story-readiness-2026-11-04.md](hld-story-readiness-2026-11-04.md), section C.
  2. The tables at the top of [fucq-79-stories.md](../gcsp/fucq-79-stories.md) and [fucq-86-90-stories.md](../gcsp/fucq-86-90-stories.md).
  3. The [gcsp-high-level-design.md](gcsp-high-level-design.md) sections named below.
  4. [build-rules.md](../gcsp/build-rules.md) and [experience-quality.md](../gcsp/experience-quality.md).

## C7 · Lifecycle after selection

**Scope:** one Epic, for what happens after Paula selects her car:
- the target platform's approval states: HR approval (configurable), sales-manager approval, sent to ordering (Q19);
- appointment requested, then confirmed, then completed or no-show;
- document and readiness status;
- the separate old-car return plan;
- the owned renewal-risk case (blueprint column 08: help on request or a configured renewal-risk trigger, with no automatic recovery priority).

These are blueprint columns 08, 12 and 13, and diagram page 07.

**Where it connects:**
- **Start point:** it begins where FUCQ-108 (buddy handoff) and FUCQ-71/72 (manual handoff) stop at "sent to ordering".
- **State changes:** they run through a synthetic ordering/appointment adapter on FUCQ-85 ticks. A live adapter must report unsupported writes, not pretend success.
- **Employee screens:** the account and the offer page show who owns outstanding work.
- **Dependencies:** link the new Stories to FUCQ-108 and FUCQ-72 as their dependencies.

**Read:** [gcsp-high-level-design.md](gcsp-high-level-design.md): "Greg's supply loop" (the lifecycle paragraph), "Paula's version-4 blueprint" rows 08, 12 and 13, and "Lifecycle and help" in Responsibilities.

## C8 · The 1,000-employee comparison

**This needs a design step first.** The readiness review found the HLD thin here: one paragraph and one unlabelled diagram node. The scaffolding says design is on, so use the `scaffolding:design-with-drawio` skill. Agree with Gary an HLD paragraph and diagram change that cover:
- where it runs (offline script or backend job);
- what it reuses (FUCQ-29's employee policy, FUCQ-96's allocation, FUCQ-82 for the assumptions);
- its seeds and outputs;
- how the presenter shows it, for example as a panel on Greg's dashboard, FUCQ-101.

Then write the Epic and Stories.

**What it shows:** the buddy route against today's first-come-first-served release, over 1,000 synthetic employees, measuring:
- the share who get an acceptable car before renewal;
- unused stock;
- decline and expiry counts.

Use identical feasible inputs and declared assumptions. The synthetic employees are generated from PolicyService keys, never hard-coded.

**Read:** the readiness review's "1,000-employee comparison" row and item C8; [demo-brief.md](../gcsp/demo-brief.md), for what the comparison must prove.

## C9 · Stories for FUCQ-74 and FUCQ-75

Both Epics exist and have no Stories. First edit each Epic's description, adding a paragraph and keeping the migration record. Then write its Stories.

**FUCQ-74, Greg's predictive next order:**
- **Epic paragraph:** prediction and the constrained order plan layer on FUCQ-90's dashboard. FUCQ-99's expressed-demand aggregation is the deterministic baseline that drives the plan (Q10). The learned model is shown alongside, labelled synthetic-trained. Submission and tracking go through FUCQ-104's request → confirmed → released flow. Weights, bounds and the active model reference are dated policy rows via FUCQ-83, read through FUCQ-82. Add a `Relates` link: FUCQ-90 relates to FUCQ-74.
- **Stories:** follow "Greg's next best order: FUCQ-74" in the HLD: learning records; offline training and held-out evaluation; `PredictionInput` → `DemandForecast`; forecast plus supply plus policy → `OrderPlan`; Greg's preview, constraint edit and replan; the plan panel on FUCQ-101.
- **Also read:** [greg-predictive-research.md](../gcsp/greg-predictive-research.md).

**FUCQ-75, replay manual acceptance scenarios:**
- **Epic paragraph:** reset and replay call FUCQ-85, with no reset of their own. Roles and starting state come from FUCQ-84. Add a `Relates` link: FUCQ-85 relates to FUCQ-75.
- **Stories:**
  - the presenter control UI: tick, next release, reset, scenario picker, and switching the acting principal (FUCQ-85 explicitly leaves this to FUCQ-75);
  - scenario setup fixtures;
  - the scenario set in [manual-acceptance-scenarios.md](../gcsp/manual-acceptance-scenarios.md): no match, decline then change, expiry, unavailable data, uncertain handoff. FUCQ-109 supplies the happy path.

  The presenter control UI is on the demo's critical path, because the presenter needs it to run the walkthrough. Make it P2.
