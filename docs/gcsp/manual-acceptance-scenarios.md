# Repeatable manual acceptance scenarios

2 November 2026. [FUCQ-75](https://ibm-consulting.atlassian.net/browse/FUCQ-75) records Russell's request for scenarios he can click through after the first build, see what happens and refine through trial and improvement. This opening section records the original approach. The FUCQ-125 section below records delivered backend setup and capability refusals separately from later runnable journey replays. [Authoring and verification record](evidence/fucq-74/README.md).

## Shared capability and per-Epic coverage

Use one bounded capability for shared scenario preparation, reset/replay support and the walkthrough catalogue. Each relevant implementation Epic supplies or links its own manual scenarios through the same approach. Add a dedicated child Story where preparing the fixtures or walkthrough needs distinct delivery work; scenarios can otherwise be part of the implementing Stories' acceptance and validation. Research-only Epics do not need artificial click-through Stories. Data/API capabilities demonstrate their effect through the consuming journey or an appropriate inspectable result.

The existing `decided`, `acceptance` and `validate` sections carry the obligation, alongside the [experience quality contract](experience-quality.md). Authors reference applicable scenarios, implementers keep their setup and observed behaviour current, and reviewers check that Russell can actually run them when the connected capability is offered for review. A cross-capability scenario records which dependencies must be available. Existing published Stories are reviewed against this requirement when picked up; this recording has not bulk-edited them or created a Story for every Epic.

## Combined time simulation and release control

5 November 2026. Russell asked to combine his time-passing simulation request with GC's request for a **Release cars** button. Keep this as one demonstration capability under **FUCQ-75**, using **FUCQ-126**'s presenter controls: advance simulated time, release vehicles and show the vehicle population changing as employees claim cars, so the agent's behaviour and resulting outcomes can be demonstrated.

Gary's existing FUCQ-126 Story already specifies **Tick** and **Next release**, including a count of cars released. Use that release action as the common control when refining the connected walkthrough. Releases, the agent's response, employee claims and the resulting availability must reflect actual application state through the shared demo clock and services, following the [demo brief](demo-brief.md#binding-boundaries) and [build rules](build-rules.md). The existing presenter-driven tick boundary remains in force.

**Jira reconciliation pending:** add this combined intent to FUCQ-75 and FUCQ-126 when Jira access is restored; do not create a separate time-simulation backlog item. This records the agreed clarification, not a Jira update or evidence that the walkthrough is runnable.

## Make each trial repeatable

Each delivered scenario needs:

- A stable name/ID, the capability or linked Epics it exercises, and the employee, Greg or presenter role.
- A known starting state, fixture/input versions, applicable policy version and required integrated capabilities.
- Simple instructions to start and reset the scenario, followed by a short sequence of clicks. Where time, a release, source failure or delayed acknowledgement is needed, provide a repeatable way to trigger it through the synthetic demo controls/adapters.
- The current expected visible result and underlying state change, with provisional UX/policy choices identified as assumptions rather than settled BMW rules.
- A place to record the actual result, surprising or confusing behaviour, Russell's feedback and the next revision; retain enough run/build context to replay a finding.

Use the existing HLD's isolated synthetic reset, replayable events and clock capabilities. Scenarios exercise the application's actual services and adapter-backed state changes. They must not set a predetermined winner or merely replace screen text. Runtime rule values come from the one [canonical policy/assumptions source](build-rules.md); scenario instructions reference that version rather than maintaining separate defaults.

## Initial coverage to refine as capabilities connect

| Scenario family | What Russell should be able to explore |
|---|---|
| Main successful journey | Brief and delegation, release/search, explained offer, selection and truthful order/handover status. |
| No suitable match | What the employee sees, why the search has no suitable result and what action remains available. |
| Reject and change the brief | Release/history, a confirmed preference or affordability change and its effect on later offers. |
| Offer expires | Advancing the demo clock, current offer state, stock availability and reopening an old offer link. |
| Data unavailable | The difference between a valid empty result and unavailable/stale input, and how the user continues or retries. |
| Uncertain order handoff | Pending status, ownership, retry/reconciliation and the eventual authoritative acknowledgement. |
| Competing employees, including manual selection | Shared stock, an exclusive claim, the unsuccessful claimant's explanation and the configured allocation rule. |
| Greg's next order | A recommended mix, changed constraints, recalculation, intentional submission and replanning after Production responds. |

This is a coverage guide for authoring, not a set of pre-approved detailed flows or a claim that these capabilities are built. Prepare useful starting assumptions, run the first connected build, inspect the result with Russell and revise. Preserve existing correctness, functional and visual acceptance while improving interaction details.

## Timing and real-user refinement

Russell's hands-on trials start when the first integrated build is available and can continue before the 12 November demo. Walkthroughs with real employees and an ordering lead are expected **after the demo**, subject to the mandate sought from BMW. Russell's clarification is that demonstrating the intention clearly can earn the mandate to refine the experience with real employees; every interaction need not already have been validated with them before the demonstration.

The [demo brief](demo-brief.md) retains the wider 2027 roadmap and agentic-delivery purposes. Real-user research is follow-on refinement, not a prerequisite for the demonstration or a claim of already validated usability. Its detailed scope and scheduling remain to be agreed with BMW.


## FUCQ-85 · presenter clock/reset mechanics

Delivered backend scenario ID `gcsp-clock-scenario-v1`, fixture `gcsp-clock-fixtures-v1`, canonical policy `gcsp-policy-v1`; this is a small fictional mechanics fixture with configuration references, not the FUCQ-77 real corpus. Use the same opened repository, PolicyService, DemoIdentity and DemoClock through the trusted composition documented in [shared contracts](shared-contracts.md#democlock-implementation-and-presenter-binding--fucq-85). A trusted backend bootstrap issues the presenter cookie; the shared access key alone cannot become presenter. The configured frontend Origin and credentialed request are required. There is no presenter screen in this story; these are inspectable API steps for FUCQ-75 to connect to its controls.

1. Start the configured backend and inspect `await server.gcspStartup`. One expiry/reconciliation pass runs without opening a browser. `GET /api/gcsp/presenter/clock` shows the persisted run, 09:00 UTC scenario start (or a retained run's current instant), clock/run versions and last tick. Missing business handlers are listed rather than shown as completed release/allocation work.
2. POST to `/api/gcsp/presenter/clock/advance` with a unique `commandId`, the returned string `expectedClockVersion` and `bySeconds: 60`. Read back 09:01 UTC on the initial fixture. Repeat the exact command: the result is identical and time does not advance again. An old version or a backward time produces a refusal with no change.
3. Advance using another command with `to: "release"` and the new clock version. The current canonical cue is 09:30 UTC. Then POST `/api/gcsp/presenter/clock/tick` with a unique `eventId`, its version and a SHA-256 `inputDigest` of the declared cue/input. Record `handlerOrder`, `missingStages`, per-handler outcomes and completed/pending state. The registry itself does not implement releases or expiry; owning stories register them. Repeat exactly the same tick after reopening the repository: its original result returns without repeated effects. Retry an interrupted event with the same input to resume unfinished handlers.
4. Read state again and POST `/api/gcsp/presenter/clock/reset` with a unique `commandId`, `expectedRunId`, `expectedRunVersion`, `scenarioVersion` and `fixtureVersion` copied from that state. Keep the returned HttpOnly cookies through the ordinary browser cookie mechanism. The result names the previous/new runs and restored start; read-back uses the new cookies. Employee fixture state and exact order identifiers are regenerated; configuration references/images remain unchanged. Retain the build, run IDs, clock/policy/fixture versions and actual result when recording feedback.
5. Try an employee-only cookie for advance/reset: forbidden. Try the previous presenter cookie for an advance/read or an old employee offer/decision/outbox reference: stale run. Retrying the exact original reset may retrieve its original receipt; it cannot reactivate history or issue a credential into a later run. Two concurrent resets against the same run/version have one winner. A failed fixture/allocation or stale version leaves the previous run current and unchanged.

Observed automated result: `server/test/gcsp-clock-reset.test.js` exercises these API/port outcomes, actual old offer ID `old-offer-id`, decision `old-decision-id` and outbox job `old-outbox-job`. `server/test/fixtures/gcsp-clock-outcomes.json` is the computed presentation contract. No screen/browser review is claimed; the future controls follow [the agreed shell/Used Cars reference](screens/README.md) and shared components. Managed PostgreSQL remains unverified when `GCSP_DATABASE_URL` is unset. Real release/offer/expiry/mail handlers arrive with their owning stories. Morning feedback should focus on the named cues, reset wording/continuity and pending/missing-handler presentation once those controls are connected.

Trial record: build/commit ___; previous/new run ___; policy/fixture ___; actual response/visible result ___; surprising behaviour ___; collaborator feedback ___; next authorised revision ___.

## Named scenario preparation · FUCQ-125

5 November 2026. The backend catalogue and input preparation/refusal contract are implemented. The six journey walkthroughs below are **planned checks for their owning Stories**, not a claim that FUCQ-109 or FUCQ-127–131 replays or FUCQ-126's presenter screen already work. Read `availability` from the actual catalogue before attempting one. Current business preparation is unavailable; a reset returns `not available yet` and the missing capability list with no mutation. The separately labelled seventh clock-mechanics support fixture can reset successfully through FUCQ-85, but proves no real configuration corpus, offer or successful business journey.

Use the same opened repository, canonical PolicyService, DemoIdentity and DemoClock. Create `createScenarioService({ repository, policy, clock, identity })` and inject it into `buildServer` as `gcspScenarios`. Use the backend-issued presenter cookie, configured frontend Origin and credentialed request; never put principal/run authority in browser overrides. Read `GET /api/gcsp/presenter/scenarios` and `/scenarios/current`. Reset with `POST /api/gcsp/presenter/scenarios/reset` and `{ commandId, expectedRunId, expectedRunVersion, scenarioId, scenarioVersion, fixtureVersion, policyVersion }` copied from those responses. Keep fresh HttpOnly cookies through the browser's ordinary mechanism. Check the current state after success. Stale versions require refresh; old-run commands cannot act on the replacement.

A failed capability/preparation/version check leaves the old run current and unchanged. Record the actual missing list and stop that walkthrough, rather than showing a canned successful result. Future capability integration must load the declared start inputs through actual services before enabling the entry; confirmed briefs, offers and pending operations must not be manufactured as fixture outcomes. No walkthrough changes an immutable corpus or operational provider.

For every trial retain this observation format, extending a scenario's table with a new dated row rather than overwriting earlier feedback:

| Date/time UTC | Scenario/variant and fixture | Run ID (previous/new on reset) | Build commit | Policy version | Result and observed state change | Feedback / next authorised revision |
|---|---|---|---|---|---|---|
| _actual trial time_ | _stable ID, variant, fixture version_ | _actual server run IDs_ | _exact tested build_ | _read-back version_ | _actual result, including refusal/pending_ | _actual submitted feedback, source and next step_ |

Feedback is recorded in this repository document and committed through the normal project workflow; there is no comments form or promise of in-browser persistence in this backend story. Later presenter controls must implement and verify a retrievable feedback route before inviting comments in a UI. No manual trial or BMW representative-user result is inferred from the automated cases below.

### Main successful journey · `main-successful-journey` · FUCQ-109

- **Start:** versioned `main-successful-journey-inputs-v1`; canonical Paula with a confirmed estate preference, five-seat input, explicit search/hold consent and the declared published-stock release. Greg and the presenter resolve from FUCQ-84's canonical principal fixture. Runtime policy/start/release cues come from read-back. No winner is named in the fixture.
- **Reset/tick:** use the named reset above. If available, advance to the returned `release` cue with the existing clock advance route and a fresh command/version, then issue a fresh event ID/digest through the existing tick route. Inspect missing handlers and actual outcomes. A later pending handoff is reconciled by an explicit tick.
- **Planned click-through:** act as Paula; review saved brief and delegation; inspect the calculated offer/captured notification; decline with a typed reason; confirm one change; trigger the next release; inspect and intentionally accept a later suitable offer. Read truthful handoff/lifecycle status.
- **Expected visible/state result:** actual matching, exclusive hold/offer/outbox, separate decline and brief-change records, then the authoritative accepted or pending state. Email delivery or a countdown cannot establish allocation or order success.
- **Provisional assumptions:** synthetic input preference/consent, `hold.buddy.durationSeconds`, `allocation.tieBreak.rule`, `offer.declinedCar.exclusion` and ordering provider behaviour remain inspectable canonical policy/adapter choices. The mechanics configuration references are not eligible proof of the published real-stock corpus.

| Date UTC | Variant/fixture | Run ID | Build | Result | Feedback / next revision |
|---|---|---|---|---|---|
| 2026-11-05 | main / v1 input manifest | No new run (refused) | `96bc997` | Automated named preparation returns missing domain capabilities before reset; business/manual replay not run. | Integrate FUCQ-109's real services and replay evidence before enabling. |

### No suitable match · `no-suitable-match` · FUCQ-127

- **Start:** `no-suitable-match-inputs-v1`; canonical Paula's confirmed nine-seat essential and Alex's five-seat input compete against the same released stock. These are explicit fictional employee inputs; no `winner` or `no-match` output flag is seeded. Greg and presenter remain their canonical roles.
- **Reset/tick:** named reset; advance to returned release cue; tick the actual release/allocation handlers. An unavailable preparation stops before any run change.
- **Planned click-through:** open Paula's activity, review the blocking essential and available next action; switch to Alex and inspect the actual allocation result; inspect Greg's corresponding unmet-need aggregate using its privacy bands.
- **Expected visible/state result:** calculated no suitable offer for Paula and an offer for Alex only if the actual full input/policy gates permit it. Her activity distinguishes no suitable match from unavailable data. No fixture prescribes an exact winner.
- **Provisional assumptions:** nine seats are a deliberately difficult input; stock coverage, eligibility, points, driver facts and allocation tie-break stay under real services and canonical policy. A later changed corpus can change the computed outcome and must be observed.

| Date UTC | Variant/fixture | Run ID | Build | Result | Feedback / next revision |
|---|---|---|---|---|---|
| 2026-11-05 | no-match / v1 input manifest | No new run (refused) | `96bc997` | Automated missing-capability refusal; no half-reset. No employee screen trial. | FUCQ-127 supplies actual calculated replay and screen observations. |

### Decline then change · `decline-then-change` · FUCQ-128

- **Start:** `decline-then-change-inputs-v1`; Paula's first offer must be produced by actual release/allocation services from her versioned brief, never inserted as a chosen winner. The declared one-change input changes `preferences.body.value` to `suv`. Variants are `later-suitable-stock` and `waiting-for-suitable-stock`; later owning fixtures supply their concrete service-backed stock difference.
- **Reset/tick:** reset into the selected owning variant when integrated; confirm the real first offer exists. After decline/change advance and tick a later release using returned clock versions/cues.
- **Planned click-through:** decline with a typed reason, review and confirm the one change, then inspect the changed brief, released car and either second suitable offer or waiting activity.
- **Expected visible/state result:** decline, change and any satisfaction remain separate records; unchanged declined exact stock is excluded until a relevant confirmed change. The real matcher determines whether a later offer exists. Waiting remains a useful successful state, not a synthetic second offer.
- **Provisional assumptions:** one-change limit and declined-car exclusion use `brief.lifecycle.v1` and `offer.declinedCar.exclusion`; durations and consent remain canonical. Fixture stock differences are inputs, not proof of policy outcomes.

| Date UTC | Variant/fixture | Run ID | Build | Result | Feedback / next revision |
|---|---|---|---|---|---|
| 2026-11-05 | later-suitable-stock / waiting-for-suitable-stock; v1 | No new run (refused) | `96bc997` | Catalogue declares both variants; actual service preparation/replays unavailable. | FUCQ-128 integrates both variants and records real waiting/offer behaviour. |

### Offer expires · `offer-expires` · FUCQ-129

- **Start:** `offer-expires-inputs-v1`; canonical Paula and Alex have confirmed briefs, with a first active offer and captured email created through the actual services during preparation. No exact recipient or offer ID is prescribed by the input manifest.
- **Reset/tick:** after successful preparation read the actual offer `expiresAt`. Advance the existing clock to that instant (not a separately maintained duration), then tick expiry/reconciliation/allocation in the canonical stage order. Read back resulting state.
- **Planned click-through:** reopen Paula's same captured-email link after expiry, inspect its backend state, then inspect the competing employee and Greg's supply picture. Try a previous-run link after a further reset.
- **Expected visible/state result:** actual expiry frees/reassigns only under the real authority; the old page remains expired and an old-run link is stale. No browser refresh/countdown revives a hold. Expiry is recorded separately from decline and gives no priority.
- **Provisional assumptions:** `hold.buddy.durationSeconds`, `hold.deadline.inclusive`, pending blocks and tie-break rules come from PolicyService. The next holder is calculated, not fixture-selected.

| Date UTC | Variant/fixture | Run ID | Build | Result | Feedback / next revision |
|---|---|---|---|---|---|
| 2026-11-05 | expiry / v1 input manifest | No new run (refused) | `96bc997` | Automated pre-reset missing expiry/offer capabilities; no expiry walkthrough claimed. | FUCQ-129 supplies actual offer-deadline and stale-link replay. |

### Data unavailable · `data-unavailable` · FUCQ-130

- **Start:** `data-unavailable-inputs-v1`; canonical Paula's brief and the next declared stock tranche, with a run-scoped synthetic stock fault. Variants are `unavailable` and `stale`. No operational provider fault is introduced.
- **Reset/tick:** reset only when the real synthetic fault adapter is integrated; advance to the returned release cue and tick its actual pull. Clear the synthetic fault through its owning presenter command and tick again. The current catalogue refuses preparation instead of faking an adapter failure.
- **Planned click-through:** inspect Paula's failed-check activity beside the no-suitable-match case; inspect Greg's source state; clear fault and observe actual recovery.
- **Expected visible/state result:** unavailable/stale is distinct from a successful empty pool; failed pull changes neither stock nor priority and creates no offer. Actual recovery resumes normal calculation.
- **Provisional assumptions:** stock-age rules belong to the owning canonical policy key; fixture mode is an explicit synthetic adapter input. No alternative local age threshold is defined here.

| Date UTC | Variant/fixture | Run ID | Build | Result | Feedback / next revision |
|---|---|---|---|---|---|
| 2026-11-05 | unavailable / stale; v1 | No new run (refused) | `96bc997` | Missing source/activity/fault capabilities reported; no fake empty result or run mutation. | FUCQ-130 implements the real run-scoped fault, recovery and screen replay. |

### Uncertain handoff · `uncertain-handoff` · FUCQ-131

- **Start:** `uncertain-handoff-inputs-v1`; Paula is about to act on an offer produced by the real services. Synthetic ordering's declared input is `uncertain-once`; variants `acknowledged` and `rejected` are eventual authoritative provider responses, not preseeded successful order state. No pending operation is invented before the employee submits.
- **Reset/tick:** after available preparation, explicitly accept as Paula, inspect the real recorded pending operation, then tick reconciliation before attempting any retry. Reset clears the synthetic run-scoped input through the same authority; no operational reset exists.
- **Planned click-through:** inspect pending status/owner/action guidance, verify the exact car remains unavailable to another employee, tick, then inspect the authoritative acknowledgement or refusal and target lifecycle names.
- **Expected visible/state result:** uncertain write remains pending, holding exclusive stock; it is not success or a free car. Reconciliation resolves that operation exactly once, preserving identity and idempotency before a retry.
- **Provisional assumptions:** pending ownership, acknowledgement timing and synthetic response are adapter inputs; `hold.pending.blocksReallocation` and canonical handler order remain policy authority. No elapsed-time rule silently approves an order.

| Date UTC | Variant/fixture | Run ID | Build | Result | Feedback / next revision |
|---|---|---|---|---|---|
| 2026-11-05 | acknowledged / rejected; v1 | No new run (refused) | `96bc997` | Missing offer/ordering/reconciliation/fault capabilities; no pending or acknowledged state fabricated. | FUCQ-131 supplies real pending operation and both-resolution replay evidence. |

### Integrated automated evidence · 5 November 2026

FUCQ-125's integrated source `87c0b4ec86312887c7f807746b143e7eb2074b98` passed the 63-case scenario/Greg/clock/outbox regression and the required full suite (794 total, 792 passed, two configured-PostgreSQL skips). The checked catalogue/refusal/reset/current projection remains `server/gcsp/fixtures/scenarios/presentation-v1.json`. All six business preparations still return `not available yet` before mutation; these runs establish backend guards and fictional mechanics reset behaviour. No durable manual business run, screen trial or later journey replay is recorded by this automated checkpoint. Retained execution and cleanup evidence is described in the FUCQ-125 story Result.
