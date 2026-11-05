# Repeatable manual acceptance scenarios

2 November 2026. [FUCQ-75](https://ibm-consulting.atlassian.net/browse/FUCQ-75) records Russell's request for scenarios he can click through after the first build, see what happens and refine through trial and improvement. It is a To Do capability; this document records the approach, not completed runnable scenarios or implementation Stories. [Authoring and verification record](evidence/fucq-74/README.md).

## Shared capability and per-Epic coverage

Use one bounded capability for shared scenario preparation, reset/replay support and the walkthrough catalogue. Each relevant implementation Epic supplies or links its own manual scenarios through the same approach. Add a dedicated child Story where preparing the fixtures or walkthrough needs distinct delivery work; scenarios can otherwise be part of the implementing Stories' acceptance and validation. Research-only Epics do not need artificial click-through Stories. Data/API capabilities demonstrate their effect through the consuming journey or an appropriate inspectable result.

The existing `decided`, `acceptance` and `validate` sections carry the obligation, alongside the [experience quality contract](experience-quality.md). Authors reference applicable scenarios, implementers keep their setup and observed behaviour current, and reviewers check that Russell can actually run them when the connected capability is offered for review. A cross-capability scenario records which dependencies must be available. Existing published Stories are reviewed against this requirement when picked up; this recording has not bulk-edited them or created a Story for every Epic.

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
