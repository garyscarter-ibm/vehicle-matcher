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

7 November 2026 (FUCQ-128): the retained successful variant is available. The no-second-match waiting variant moved to FUCQ-173 under the authorised 7 November split; its v1 row below is history.

- **Start:** `decline-then-change-inputs-v2`, variant `later-suitable-stock`. Paula's versioned brief (estate preference at importance 80, five seats, charging not ready, search and hold consent) and the synthetic demo stock (`server/gcsp/stock/demo-provider.js`). v2 changes the declared one change to `preferences.body.value` = `saloon`, because the reviewed demo stock has no SUV and v1's `suv` could never yield a matching second offer. After the reset, the start loader (`server/gcsp/scenarios/decline-then-change.js`) applies these inputs through the actual services in the new run: BriefService draft and confirmation, the presenter release cue (09:30 UTC) and one tick, so stock release and the FUCQ-96 allocator give Paula her first offer. No brief, hold or offer is written by the fixture. The reset response's `startState` names the first offer, or the step that failed.
- **Reset:** launch the demo (`node scripts/gcsp-demo.mjs`, see the presenter strip section below), open `gcsp-presenter.html`, open **Presenter controls**, choose **Decline then change** and press **Reset scenario**, then confirm. A journey reset takes a few seconds because it runs the real release and allocation. Read back the new run and DemoClock time (09:30 UTC).
- **Click-through:** switch the acting principal to Paula. Open her offer (a 3 Series Touring estate). Decline it with the typed reason *body style*. The follow-up asks one question: choose **Saloon** and confirm. The page reads *waiting*. As presenter, press **Tick** (one step). Paula's page, after **Check current state**, shows the second offer: a 3 Series Saloon, compared with the declined estate.
- **Expected visible/state result:** the decline is its own decision record (offer rejected, not expired); the confirmed change is brief version 2 with the other essentials kept; the second offer is a separate offer on brief version 2. The declined Touring is never offered to Paula again while her brief is unchanged and returns to the pool for others. Nothing is accepted or marked satisfied. Reset again and the same models appear in the new run (order identifiers differ).
- **Provisional assumptions:** one-change limit and declined-car exclusion use `brief.lifecycle.v1` and `offer.declinedCar.exclusion`; decline reasons and the follow-up question come from the adopted `offer-journey-v1` set, re-adopted after each scenario reset. Fixture stock differences are inputs, not proof of policy outcomes.
- **Automated replay:** `server/test/gcsp-scenario-decline-change.test.js` drives this route through the actual presenter and employee HTTP routes after reset, twice across two resets (`server/test/helpers/gcsp-decline-change-route.js` is the reusable route for FUCQ-109).

| Date UTC | Variant/fixture | Run ID | Build | Result | Feedback / next revision |
|---|---|---|---|---|---|
| 2026-11-05 | later-suitable-stock / waiting-for-suitable-stock; v1 | No new run (refused) | `96bc997` | Catalogue declares both variants; actual service preparation/replays unavailable. | FUCQ-128 integrates both variants and records real waiting/offer behaviour. |
| 2026-11-07 | later-suitable-stock; v2 | `demo-cfd9f03e…` (1280), `demo-d8f0868e…` (375), each from its own reset | `ff69c9f4` | Launched memory demo over a scratch loopback front, headless Chrome. Reset read back 09:30 UTC; Paula's first offer Touring 320i; declined by keyboard (reason select, Enter), chose Saloon, change saved in brief version 2 (waiting); one 60 s Tick (09:31); Check current state showed the Saloon 320i as the next offer beside the declined Touring. PNGs: `evidence/fucq-75/fucq-128/`. | Low: duplicate "Check current state", raw ISO times, slow first loads of presenter controls; an unstyled duplicate "Next offer" block seen once at 375. Waiting variant: FUCQ-173. |

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

### Greg's next order · `greg-next-order` · FUCQ-121

- **Start:** the `decline-then-change` reset (above): one confirmed brief (Paula, renewal 1 Dec 2026), DemoClock 5 Nov 2026 09:30 GMT, and synthetic stock. Greg's plan reads that saved demand only ("Expressed demand (deterministic baseline)"). Policy values (limits, budget £200,000) come from the policy service.
- **Reset and tick:** launch the demo (`node scripts/gcsp-demo.mjs`), open `gcsp-presenter.html`, open **Presenter controls**, choose **Decline then change**, press **Reset scenario** then **Confirm reset** (about 20 seconds; the page reloads as the presenter). Open **Presenter controls** again, choose **Greg (fictional) (greg)**, press **Switch principal**. **Tick** moves the clock 60 seconds and reloads the plan by itself.
- **Planned click-through:** (1) On Greg's dashboard read the **Next order** panel: heading "No new order recommended", Forecast source, Policy version, Plan for, then proposed order, coverage, unallocated-stock risk, unmet needs, binding constraints and alternative plans. (2) Under **Change limits**, set **Min** to 2 for "3 Series Touring 320i" and press ArrowRight once on its "maximum slider" (3 to 4). (3) Press **Preview with these limits**: "Order 2 vehicles: 3 Series Touring 320i", the **Preview** banner ("Preview only. Nothing is saved, published or ordered."), **Differences from the current plan** (0 to 2, +2) and **Outcome before and after**. **Back to current plan** returns. For the infeasible case press **Reset limits**, set that Min to 2 and the "3 Series Touring" model **Max** to 0, then preview: "No plan meets these limits" and **Limits that conflict**. (4) For **Replan needed**, with a preview showing, open `gcsp-presenter.html` in a second window (same session), press **Tick** there, return and press **Request 2 vehicles from Production**: the changed inputs are listed. Press **Replan with the latest inputs**. (5) Press **Request 2 vehicles from Production** (a separate button; "Nothing is ordered until Production confirms."). The banner reads "Requested from Production" and **Order requests** shows "3 Series Touring 320i, Requested, 2" without pressing **Refresh orders**. (6) In **Order requests** open **Synthetic production controls**, choose the request, **Production response** "Confirm now", **Quantity to confirm** 2, **Save production response**. The plan reloads itself and shows "Replanned after a Production response".
- **Expected visible/state result:** nothing is ordered by a preview, an infeasible preview or a stale request. One submit creates one request with the previewed limits, shown in Order tracking as requested 2, confirmed 0. After the confirmation the row reads Confirmed 2 and the plan names the response it replanned after, with a new "Plan for" time. A single window never shows "Replan needed" after Tick because the plan reloads; the two-window step is the deliberate way to hold an older plan.
- **Provisional assumptions:** the forecast is expressed demand, not a prediction; the order budget, model and derivative limits and lead time are `orderPlan.*` policy assumptions; the production confirmation is the synthetic adapter's, not a real Production response. The plan's binding-constraint rows include minimums at 0.

| Date UTC | Variant/fixture | Run ID | Build | Result | Feedback / next revision |
|---|---|---|---|---|---|
| 2026-11-08 | decline-then-change v2; headless Chrome, keyboard only, 1280 and 375 | `demo-7d3d82a9…` (reset) | `9066cb5f` plus the FUCQ-121 evidence commit | All steps above ran (script `evidence/fucq121/capture.mjs`): plan ready, limits edit and slider, preview, infeasible, stale, replan, submit, confirm, replanned; 403 for an employee on the plan route. PNGs: `evidence/fucq121/`. | Low: unmatched supply rows repeat "Vehicle already in stock" (now merged); alternatives table scrolls sideways at 375. |

### Integrated automated evidence · 5 November 2026

FUCQ-125's integrated source `87c0b4ec86312887c7f807746b143e7eb2074b98` passed the 63-case scenario/Greg/clock/outbox regression and the required full suite (794 total, 792 passed, two configured-PostgreSQL skips). The checked catalogue/refusal/reset/current projection remains `server/gcsp/fixtures/scenarios/presentation-v1.json`. All six business preparations still return `not available yet` before mutation; these runs establish backend guards and fictional mechanics reset behaviour. No durable manual business run, screen trial or later journey replay is recorded by this automated checkpoint. Retained execution and cleanup evidence is described in the FUCQ-125 story Result.

## Presenter strip and live workspace · FUCQ-126

Start the local host: `GCSP_REPOSITORY_MODE=memory GCSP_TLS_KEY_FILE=... GCSP_TLS_CERT_FILE=... node scripts/gcsp-demo.mjs`
(see `local-https.md`; the certificate must be trusted by the browser). Opening `gcsp-presenter.html` issues the
trusted backend bootstrap with the separate presenter-control and acting cookies.
Open `gcsp-presenter.html` through the packaged same-origin static/API host. The runtime selects
its employee, Greg or presenter surface from actual `/api/gcsp/context`; no person belongs in the URL.
A shared-key gate, where configured, must already be satisfied by the host. A missing control
cookie hides the strip entirely even when the acting person is an employee or Greg.

1. Open **Presenter controls**. Check scenario, run, DemoClock UTC time, actual acting person and
   last tick in the shared presenter bar. Collapse/reopen with the keyboard; Escape closes the
   strip and focuses its summary. Scenario and Acting principal are named radio groups: Tab enters
   each group once, arrows wrap, and Home/End choose its first/last option. Refresh readback while
   a radio has focus; its mounted node, selected choice and focus must remain stable. During busy
   or uncertain commands both groups are disabled.
2. Choose **Tick**, a server-projected named cue or a future UTC ISO target, or **Next release**.
   Check actual new time and handler results in server order. Missing release handlers say release
   unavailable; they do not report zero cars. A future cue does not establish release capability.
   The launcher composes synthetic demo stock (`server/gcsp/stock/demo-provider.js`): from 09:00, **Next release**
   moves to the 09:30 cue and reports 5 cars released; a repeat shows "No future release cue is configured".
3. Select an unavailable scenario radio; the choice remains enabled and inspectable. Its missing
   capabilities appear and Reset is disabled. Ordinary readbacks preserve a deliberate choice. Choose
   the available clock-mechanics scenario, press **Reset scenario**, then cancel once. Confirm a
   second reset and check the returned new run plus fresh server/context readback. The mechanics
   scenario is not evidence of any full business journey.
4. Select an employee or Greg from the server-projected choices and press **Switch principal**.
   A confirmed actual context navigates to `gcsp-presenter.html` and loads that person's HTTP surface.
   Switch back through the same controls. `gcsp-greg.html` is not live-principal proof.
   Paula, Alex and, after a reset, the new run's employees open a prepared account (Sam's scheme is unsupported).
5. For a deliberately dropped command response, choose **Retry original action**. Verify the request
   body and command ID match exactly; rapid duplicate clicks must produce only one request.
   If session issuance cannot replay its raw cookie, actual context decides whether installation
   succeeded. Unknown/different context stays uncertain/refused. **Issue selected principal again**
   is a deliberate fresh issuance with a new ID.

Current authored scope, 5 November 2026: UI/DOM and HTTP-boundary checks cover these behaviors.
The corrected browser matrix at `393dedc` passed 17 checks at both desktop and 375px, including
Tab, Enter, Escape, radio arrows/Home/End, visible focus and readback focus preservation. The lead
personally inspected all 50 original captures and independently verified cleanup. This is the actual
HTTP memory composition with explicitly synthetic account inputs, not a delivered business journey.
The isolated gallery example demonstrates pending/missing-release presentation only. 7 November: live HTTPS smoke on the composed launcher read back a 5-car release, idempotent tick/release replays,
employee/Greg switches with ready accounts and a mechanics reset into a new run. Journey scenarios, including the main
walkthrough, remain "not available yet" in the FUCQ-125 catalogue.
The browser runner matrix is `evidence/fucq-126/ui-browser-plan.md`; dated observations and captures
must be added after execution, without relabelling mock failure states as real integration proof.
