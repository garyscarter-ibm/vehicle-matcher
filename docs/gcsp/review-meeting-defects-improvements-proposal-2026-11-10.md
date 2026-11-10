# GCSP demo review: approved findings and Jira receipt

Prepared 10 November 2026 for Russell Gowers and Gary Carter (GC).

**Status: published to Jira on 10 November 2026: 10 new Bugs, 7 Stories and 1 retrospective Task; 2 findings reuse existing records. D01 is being worked on in another session and was not replicated. S01 has been removed because D01 supersedes it.** The D/S/A references below map to Jira in the receipt. This request created backlog records; it did not start an implementation run.

Source: `Review demo and record defects_improvements.vtt`, supplied from `/Users/usget/Downloads/`. The transcript contains 515 cues and ends at **00:31:27**. All references below are elapsed recording times. The VTT does not establish the meeting's calendar date.

This analysis combines repeat mentions, distinguishes observations from suspected causes, and follows later corrections and decisions. Defects are **reported in the meeting**, not independently reproduced against the current application. Russell approved creation of the remaining items after the exclusions above; current diagnosis and existing-work reconciliation still apply.

## What the meeting prioritised

At **00:29:51–00:30:36**, GC asks to see the proposed work first and focus on the key items rather than start fixing the existing backlog of roughly 30 defects:

1. Presenter controls: separate setup from the employee experience and simplify operation (**D03, S02, S03**).
2. Time running automatically, so the buddy acts without repeated manual ticks (**S04**).
3. Smooth, connected end-to-end navigation (**D04**, supported by **D05** and the separately owned **D01**).
4. UI polish, including vehicle images (**D06, D07**).
5. Vehicle configuration options that make the cars visibly different (**S05, S06**).

Separately, Russell explicitly calls the blocked offer acceptance a **P1 defect** at **00:27:09** (**D13**). Keep that failure visible alongside the closing shortlist.

The shortlist is a record of meeting emphasis, not an agreed delivery order or a severity assessment of every item. Other priorities remain for agreement. Existing defect severities and authorised deferrals must be preserved until properly reassessed.

## Jira publication receipt

All 18 new records were read back as **To Do**, with their native types, descriptions, parent Epics, labels and related-issue links verified at **11:30 UTC on 10 November 2026**. No assignments, story points, blocking dependencies or existing Story acceptance criteria were changed. D13 carries the explicitly requested **P1**, mapped to Jira **Highest**; other new records retain the project default priority. Severity assessments are recorded separately in each Bug.

| Ref | Jira record | Disposition |
|---|---|---|
| D01 | [FUCQ-322](https://ibm-consulting.atlassian.net/browse/FUCQ-322) | **Other session; excluded.** No duplicate, claim or implementation. |
| D02 | [FUCQ-321](https://ibm-consulting.atlassian.net/browse/FUCQ-321) | Reused existing copy-cleanup Story; In Review at verification. |
| D03 | [FUCQ-324](https://ibm-consulting.atlassian.net/browse/FUCQ-324) | New Bug: separate presenter controls from employee journey. |
| D04 | [FUCQ-325](https://ibm-consulting.atlassian.net/browse/FUCQ-325) | New Bug: connect employee navigation; composed origin needs triage. |
| D05 | [FUCQ-326](https://ibm-consulting.atlassian.net/browse/FUCQ-326) | New Bug: use “Your preferences”. |
| D06 | [FUCQ-327](https://ibm-consulting.atlassian.net/browse/FUCQ-327) | New Bug: residual Your Cars hierarchy and allowance/points prominence. |
| D07 | [FUCQ-323](https://ibm-consulting.atlassian.net/browse/FUCQ-323) | Reused existing imagery Bug; To Do at verification. |
| D08 | [FUCQ-328](https://ibm-consulting.atlassian.net/browse/FUCQ-328) | New Bug: trace and display available starting facts. |
| D09 | [FUCQ-329](https://ibm-consulting.atlassian.net/browse/FUCQ-329) | New Bug: filter ineligible employee recommendations. |
| D10 | [FUCQ-330](https://ibm-consulting.atlassian.net/browse/FUCQ-330) | New Bug: clarify preference value versus importance. |
| D11 | [FUCQ-331](https://ibm-consulting.atlassian.net/browse/FUCQ-331) | New Bug: residual cross-browser preference readback; coordinate FUCQ-322, diagnose before repair. |
| D12 | [FUCQ-332](https://ibm-consulting.atlassian.net/browse/FUCQ-332) | New Bug: observable current-state check feedback. |
| D13 | [FUCQ-333](https://ibm-consulting.atlassian.net/browse/FUCQ-333) | New Bug; **P1 / Highest**, High severity. |
| S01 | — | **Removed; superseded by D01.** |
| S02 | [FUCQ-334](https://ibm-consulting.atlassian.net/browse/FUCQ-334) | New Story: confirm and retain presenter setup. |
| S03 | [FUCQ-335](https://ibm-consulting.atlassian.net/browse/FUCQ-335) | New Story: operate the audience's run from a separate client. |
| S04 | [FUCQ-336](https://ibm-consulting.atlassian.net/browse/FUCQ-336) | New Story: automatic canonical clock and buddy processing. |
| S05 | [FUCQ-337](https://ibm-consulting.atlassian.net/browse/FUCQ-337) | New Story: compare actual vehicle configurations/options. |
| S06 | [FUCQ-338](https://ibm-consulting.atlassian.net/browse/FUCQ-338) | New Story: Paula's configured current-car record/history. |
| S07 | [FUCQ-339](https://ibm-consulting.atlassian.net/browse/FUCQ-339) | New Story: best-match prominence; wider UI remains ahead of it. |
| S08 | [FUCQ-340](https://ibm-consulting.atlassian.net/browse/FUCQ-340) | New Story: repeatable SUV preference-change walkthrough. |
| A01 | [FUCQ-341](https://ibm-consulting.atlassian.net/browse/FUCQ-341) | New Task: agree future clickable-journey review step. |

The saved authoring payloads and verification receipt are in [the publication record](review-meeting-jira-publication-2026-11-10.json). All 57 planned native **Relates** links were verified. These are origin/context links, not blocking dependencies. The intake marker `review-meeting-2026-11-10` returns exactly the 18 new records.

### Scope reconciled during publication

- **D03/S02/S03:** the recording accepted an overlay, but the later FUCQ-322 contract requires a separate presenter page without employee login. The new items preserve that contract and divide clean employee/operator separation, one-confirm setup, and cross-client operation.
- **D04/D06:** reuse the specific work already tracked in FUCQ-270/277/279/284/316/321. New Bugs cover the remaining composed navigation and Your Cars hierarchy, without assuming those existing fixes failed. Activity exists; acceptance navigation was not independently disproved.
- **D07:** FUCQ-323 expressly authorises image sourcing and full coverage. FUCQ-250's earlier scope and authorised deferral remain unchanged.
- **D09:** FUCQ-29 intentionally returns eligible, ineligible and needs-confirmation decisions. The new report concerns their employee-facing consumption; it does not establish an engine fault. The count objection stays withdrawn.
- **D11/S03:** FUCQ-292 excludes different browsers/devices. The new scope concerns residual cross-client readback/operation, while FUCQ-322 owns account persistence and identity. No second login or account store is authorised here.
- **D13:** the latest-brief comparison was part of FUCQ-106's original acceptance contract. The approved preference-only precedence rule is an explicit refinement, retaining genuine eligibility, essentials, permission/consent, hold, quote, declarations and expiry checks. It does not silently amend FUCQ-106's claimed scope.
- **S05/S06/S08:** preserve existing quote/configuration obligations, account interfaces and resettable replay; add richer comparison, a specific supported current-car record, and the SUV scenario variant. No fabricated history or forced match is requested.

## Identified defects

| Ref | Proposed defect | Evidence | Qualification |
|---|---|---|---|
| D01 | Demo entry requires an unwanted passcode/login step | 00:02:01–00:02:15 | **Being worked on in another session; do not replicate.** Existing login/account Story FUCQ-322. |
| D02 | Employee-facing copy exposes distracting demo labels | 00:02:06–00:02:15; 00:25:16–00:25:26 | Paula is labelled fictional; synthetic/example references recur. A fix may already be awaiting merge. |
| D03 | Presenter controls intrude into the employee journey | 00:03:17–00:04:03; 00:05:22–00:06:19 | Final direction permits a side overlay, with separate setup and live actions. |
| D04 | Employee journey is fragmented across manually entered URLs | 00:07:21–00:08:09; 00:10:04–00:11:39; 00:14:47–00:15:55; 00:25:33–00:26:20 | Activity exists; the defect is joining up and presenting the experience. Acceptance navigation was not successfully exercised. |
| D05 | “Your car brief” does not communicate “Your preferences” | 00:07:42–00:08:01 | Explicit replacement wording agreed. |
| D06 | Your Cars has weak hierarchy, too much prose and inconsistent controls | 00:08:37–00:09:27; 00:14:25–00:14:40; 00:30:25–00:30:36 | May overlap existing UI-review bugs. |
| D07 | Vehicle images are missing, notably for the 320i Touring | 00:09:27–00:09:58; 00:12:44–00:12:51; 00:30:25–00:31:23 | An existing bug is acknowledged; reconcile FUCQ-250 before creating another. |
| D08 | “Your scheme and starting answers” exposes many unknown/unsupplied values | 00:10:49–00:11:07 | The data gap is observed; whether available data is being lost is unproved. |
| D09 | Ineligible vehicles appear among employee recommendations | 00:13:13–00:13:46 | Removal is requested; the separate eligible-count objection is then withdrawn. |
| D10 | Preference importance controls are hard to understand | 00:13:53–00:14:02; 00:21:04–00:21:24 | Separate the desired characteristic from how much it matters. |
| D11 | Saved preferences do not appear consistently for the same user across browsers | 00:20:24–00:22:35; 00:22:40–00:22:59 | Local storage is only a hypothesis; later discussion suggests a stale view is also possible. |
| D12 | “Check current state” appears to do nothing | 00:24:57–00:25:15 | No visible result is reported; a failed backend operation is not established. |
| D13 | A changed-brief conflict prevents accepting an existing offer | 00:26:47–00:27:49 | Explicit P1; declarations were checked and an actual brief-conflict message was read out. |

### D01 — Remove the unwanted demo passcode step

**Ownership: being worked on in another session. Do not create a duplicate, claim it here or change its implementation.** The live existing record is FUCQ-322. Russell confirmed this exclusion on 10 November 2026. The separate persona-login proposal is removed and superseded by this work; its original lightweight-login suggestion is historical discussion, not a replacement for that session's later agreed login contract.

**Reported:** GC explicitly asks to remove the login/passcode login at 00:02:01. Russell then requests a small “log in as Paula” interaction, and both converge on choosing a persona from the GCSP landing-page profile control.

**Expected outcome:** follow the login/account contract already agreed in the other session. The transcript's original direction was to remove the passcode interruption while retaining deliberate user identity.

**Validation target:** owned by the other session under FUCQ-322; no duplicate login work is created in this batch.

### D02 — Remove distracting “fictional”, “synthetic” and “example” labels from the main journey

**Reported:** Paula is still marked “fictional” (00:02:06–00:02:15). Later, GC identifies remaining “synthetic” and “example” references, while noting that a relevant story may not yet have merged (00:25:16–00:25:26).

**Expected outcome:** persona names, vehicle names and normal employee-facing messages read like the intended experience. Review visible terms and other repeated demo wording as part of that copy sweep. Retain accurate demo provenance in the appropriate supporting information; removing visual clutter does not make synthetic facts verified BMW data.

**Validation target:** inspect the connected Paula journey after checking the existing fix and its deployment. Reuse existing copy/name reports where their scope matches.

### D03 — Keep presenter controls out of the normal employee view

**Reported:** the controls are very complicated and make the journey appear unreal. Russell first suggests entirely separate screens, accepts GC's side overlay, and suggests opening it from an extra item in the left GCSP menu (00:03:23–00:04:03).

**Final direction:** a side overlay is acceptable. The later suggestion to replace it with an admin panel is explicitly withdrawn at 00:05:31–00:05:38. Setup options and live demonstration actions serve different purposes (00:05:41–00:06:19).

**Expected outcome:** normal employee screens are clear of presenter controls; an operator can deliberately open and close them. Keep the interaction with **S02–S04** coherent rather than build competing presenter interfaces.

**Validation target:** inspect the default employee view, open/closed overlay, keyboard operation and narrow layout; verify that the audience sees a clean journey while the operator can still act.

### D04 — Join up the employee journey without typing page addresses

**Reported:** the walkthrough repeatedly requires URLs for preferences, activity and order progress. Russell asks for preferences under Paula's top-right profile menu (00:07:21–00:07:37); GC agrees there should be no separate address to type (00:08:04–00:08:09).

**Consolidated direction:** provide one coherent employee portal/profile experience containing preferences, buddy activity and recommendations (00:15:45–00:15:55). The discussion also identifies current car, points/allowance, order history and contact details as profile context (00:08:11–00:08:35). Buddy activity explains **what the buddy has done**; recommendations are **the search outcome** (00:14:57–00:15:07). Do not collapse those meanings into an indistinct car list.

After successful offer acceptance, the expected next destination is order progress (00:25:33–00:26:20). That transition was not proved broken independently: acceptance itself failed later (**D13**).

**Expected outcome:** start at GCSP, choose Paula, reach her profile/preferences, see buddy activity and recommendations, open and decide an offer, and continue to order progress using visible navigation and actions. A single coherent portal does not require any particular frontend routing implementation.

**Validation target:** walk that route without manually entering addresses. Check initial/empty activity, recommendations, decline/change, acceptance and the order-progress destination. Validate the acceptance transition after D13 is addressed.

### D05 — Rename “Your car brief” to “Your preferences”

**Reported:** GC cannot tell what “Your car brief” means until opening it. Russell proposes “Your preferences”, and GC agrees (00:07:42–00:08:01).

**Expected outcome:** use the agreed employee-facing name consistently in headings, profile/navigation links and relevant actions. Internal domain terminology need not be renamed solely to change a screen label.

**Validation target:** follow the employee navigation and check consistent, understandable wording.

### D06 — Give Your Cars a clear BMW hierarchy and consistent controls

**Reported:** Russell describes the page as an LLM-default UI with too many words. He asks for the BMW Group design system, a clear information hierarchy, points/allowance shown as prominent numbers, and consistent controls rather than a mixture of buttons, hyperlinks and dropdowns (00:08:37–00:09:27).

**Expected outcome:** a concise, coherent employee screen whose most important facts and actions can be understood quickly. Follow the existing BMW/Density direction and shared component library. **S07** records the smaller best-match prominence suggestion separately; it was explicitly lower priority than the wider UI problems.

**Validation target:** substantive visual/usability critique at desktop and narrow widths, with realistic long vehicle names, populated/empty states, selected controls, validation and confirmation states. Inspect the corrected result. Reconcile against existing UI-review reports before making a new umbrella bug.

### D07 — Populate the missing vehicle images

**Reported:** missing images recur on the current/recommended cars, especially the 3 Series Touring 320i. GC says a bug exists and initially believes the gap is limited to that model (00:09:27–00:09:58). The recommendation view still lacks its Touring image at 00:12:44.

**Final direction:** Russell offers to drive the imagery work separately and asks for images from the BMW configurator using the configurations already held (00:31:03–00:31:23). GC suggests using another model in the demo if images cannot be obtained (00:30:42–00:30:50); that is a fallback suggestion, not evidence that the defect is fixed or the final preferred approach.

**Expected outcome:** the demonstrated vehicles have suitable source-backed imagery with the correct vehicle association and any necessary representative-image distinction.

**Validation target:** inspect current car, recommendations, activity/offer and comparison imagery. Confirm what image work Russell has already started and reconcile the existing **FUCQ-250** report and source/access decisions before assigning duplicate work.

### D08 — Investigate missing scheme and starting-answer information

**Reported:** despite substantial downloaded data, “Your scheme and starting answers” contains many “unknown” / “source not supplied” values (00:10:49–00:11:07).

**Expected outcome:** show information the application actually has, with understandable handling of genuinely absent facts. Identify whether the gaps come from data, mapping or presentation. The recording alone does not prove that every missing value exists in the collected corpus.

**Validation target:** compare the relevant user's source records with the rendered section, identifying supplied, derived and genuinely unavailable fields. Do not manufacture missing values. Exact-vehicle option detail is the distinct improvement in **S05**.

### D09 — Exclude ineligible cars from the employee recommendation set

**Reported:** an apparently ineligible car is displayed. Russell considers that unhelpful and explicitly asks for a defect (00:13:13–00:13:31).

**Expected outcome:** the employee's eligible recommendation set does not include cars she cannot take under her scheme. Any deliberately different stock-browsing view needs a clear purpose and distinction.

**Important correction:** Russell's separate assertion that the “4 eligible cars” count is wrong is withdrawn at 00:13:39–00:13:46. Do not open a count bug from this exchange.

**Validation target:** identify the specific excluded candidate and eligibility decision in the scenario, then verify the eligible list and its count. The recording does not establish the precise rule or root cause.

### D10 — Make preference position and importance understandable

**Reported:** initial importance values are unset (00:13:53–00:14:02). When editing later, Russell finds himself setting “importance” to “very important” without understanding what characteristic that importance applies to, then separately changes sportiness (00:21:04–00:21:24).

**Expected outcome:** each control clearly identifies the quality being chosen, its selected preference and how much that preference matters. The two concepts must be distinguishable, including unset/indifferent states.

**Validation target:** use actual preference controls to choose, for example, electric propulsion and a sportiness preference, with understandable importance settings; save and revisit them. Do not infer a proven ranking-engine defect merely from the earlier unset preferences.

### D11 — Keep user preferences and their displayed state consistent across browsers

**Reported reproduction:** Russell changes Paula's preferences in his browser, including electric/saloon and sportiness (00:20:24–00:21:32). GC refreshes but does not see the changes (00:21:38–00:22:00). Russell explicitly calls this a defect and states that preferences, current vehicle and other key information must belong to the user as stored objects (00:22:02–00:22:35).

**Unresolved cause:** GC suspects local storage. Later the eligible-car count changes, and Russell suggests that preferences may have changed while the view has failed to synchronise (00:22:40–00:22:59). Neither explanation is established.

**Expected outcome:** the same user in the same demo run has one coherent saved profile and preference state across clients. Views read and display that state consistently; switching user/run must retain the appropriate separation. The separately owned D01 supplies the user context; **S06** develops the actual configured current-car record. Reconcile FUCQ-322's saved-account scope without duplicating its implementation.

**Validation target:** save in browser A, reload/open in browser B for the same run/user, compare saved values and derived recommendations, and repeat after a user switch. Diagnose persistence, readback and view refresh separately rather than assuming browser-local storage is the cause.

### D12 — Give “Check current state” an observable result

**Reported:** GC clicks the control and says it does not seem to do anything, explicitly requesting a defect (00:24:57–00:25:15).

**Expected outcome:** the action visibly reports the current offer state or indicates that it has checked and nothing has changed; failures are understandable. Retain a useful route to the next action.

**Validation target:** check unchanged, changed and failed readback states. Establish whether the issue is feedback, stale rendering or a failed request; the transcript does not decide which.

### D13 — Accept an existing offer despite subsequent preference changes

**Reported reproduction:** GC attempts to accept the second offer. Russell checks whether declarations were completed; GC confirms the button cannot be clicked without them. Acceptance fails with a message transcribed as “Briefs conflict, brief changed review required” (00:26:47–00:27:24). Russell explicitly calls this **P1** at 00:27:09.

**Business direction:** an existing offer takes precedence over the brief. Preferences matter when constructing an offer; changing them must not, by itself, prevent accepting that already-issued offer (00:27:29–00:27:49).

**Expected outcome:** a still-valid issued offer retains its own terms and can be accepted after the user's preferences change. This direction concerns a preference-version conflict; it does not establish that expiry or other legitimate acceptance conditions should be bypassed.

**Validation target:** obtain an offer, change the user's brief, complete the declarations, accept it and confirm the recorded outcome and transition to order progress. Also check rejection and genuine expiry independently. Capture the exact application error during reproduction; the VTT wording is not a verified machine error code.

## Improvement user stories

These bounded Stories are approved for backlog capture, not additions to an already claimed Story's acceptance criteria. References to related defects identify overlap; they do not prescribe duplicate tickets or blocking links. Open implementation details remain explicit in the saved records.

### S02 — Configure the presentation once, then confirm and retain it

**As a presenter, I want to select the scenario, acting user and fault options before applying the setup with one confirmation, so that preparation happens before the audience walkthrough.**

**Evidence:** 00:05:01–00:06:19.

**Proposed outcomes:**

- Collect the setup choices before one clear confirm/apply action.
- Keep the confirmed choices until deliberately changed, rather than require repeated setup during the demonstration. The exact persistence lifetime remains to be refined.
- Separate setup options from live actions such as releasing cars or advancing the scenario.

**Validate:** configure once, navigate through the demo and reopen the controls; check the selected setup is still active. Align with the side-overlay direction in D03.

### S03 — Operate one demo run from a separate screen

**As a demo operator, I want to drive the same run from a separate screen or browser, so that the audience watches the employee experience while I release stock or advance events.**

**Evidence:** investigation requested at 00:06:24–00:06:47; a shared-clock experiment succeeds at 00:20:03–00:20:23.

**Proposed outcomes:**

- Establish and document how operator and audience join the same run.
- Operate live controls separately from the audience view and show the resulting real application state there.
- Verify which screens update automatically and which need work; account for D11's preference/view inconsistency.

**Validate:** two clients on the same run, one operating controls and the other displaying the employee journey. The successful clock test is useful existing evidence, so this starts as investigation and completion of the operator experience, not a claim that shared runs are absent.

### S04 — Run an accelerated scenario clock and buddy automatically

**As a presenter, I want time and buddy processing to advance automatically after starting a scenario, so that releases and subsequent offers happen smoothly without repeated Tick clicks.**

**Evidence:** 00:17:55–00:19:30; reiterated as a key item at 00:30:11–00:30:16.

**Proposed outcomes:**

- Start background simulated-time progression with the scenario.
- Run the actual release/search/offer processing as simulated time advances, including searching again after a decline or changed preference.
- Use an agreed accelerated rate. “24 hours in 48 minutes” is an illustrative GTA-style suggestion, not a settled value.

**Validate:** start a prepared scenario, observe a release and offer, decline/change preference and observe the next appropriate action without manual ticks. Refine operator start/pause/reset behaviour and pacing before implementation; those details were not settled in the recording.

### S05 — Show and compare the actual vehicle configurations

**As an employee, I want to see the offered car's actual colour, trim and valuable options alongside my current car, so that I can understand meaningful differences between individual vehicles.**

**Evidence:** 00:23:34–00:24:38; configuration differentiation is explicitly included in the closing focus at 00:30:25–00:30:36.

**Proposed outcomes:**

- Use each vehicle's associated configuration rather than only generic model-level facts.
- Show colour, trim such as M Sport, and key/high-value options where supplied.
- Preserve the current-versus-offered-car comparison that both participants liked, adding useful configuration differences.

**Validate:** compare two same-model vehicles with different supplied configurations and show the correct per-car details. Preserve truthful unavailable-data states. GC's suggested cause, reuse of a dummy used-car specification table, is a hypothesis to verify rather than a completed diagnosis.

### S06 — Give Paula a configured current-car record with its own history

**As an employee, I want my profile to hold my particular configured current car, with its colour, options and history, so that the starting point and offer comparison reflect my car.**

**Evidence:** user-linked records at 00:22:02–00:22:35; explicit story request at 00:24:40–00:24:50.

**Proposed outcomes:**

- Associate Paula's current vehicle with a specific source-backed configuration, not only a generic model placeholder.
- Retain its own colour, option set and vehicle history against her user record.
- Read that same vehicle consistently in the profile, current-car display and comparison.

**Validate:** open Paula's record and offer comparison and verify that both identify the same configured current vehicle. The required history fields remain to be agreed; the discussion does not specify a new history-management workflow.

### S07 — Make the best match easier to notice

**As an employee, I want the top recommendation to be clearly identifiable, so that I can find the suggested starting point without scanning every card.**

**Evidence:** 00:14:22–00:14:40. GC initially misses the best-match indication; Russell agrees while explicitly putting wider UI problems first.

**Proposed outcome:** improve the prominence of the existing indication within D06's hierarchy and shared components, without changing ranking behaviour solely for presentation.

**Validate:** inspect the recommendation set at desktop and narrow widths with realistic vehicle names. Keep this lower-priority enhancement distinct during agreement; it may be delivered with D06 rather than become a separate ticket.

### S08 — Rehearse a second preference-change scenario that produces a different result

**As a presenter, I want a repeatable second scenario where Paula requests an SUV rather than another 320i Touring, so that I can demonstrate recommendations responding to a changed need.**

**Evidence:** 00:27:59–00:28:21, following the run-sheet instruction to reset and repeat.

**Proposed outcomes:**

- Provide or reuse a resettable walkthrough with the changed preference and suitable scenario stock.
- Run the normal matching and eligibility logic and explain the resulting recommendation.
- Make the contrast with the first journey easy to demonstrate; do not force a named winner or imply that a matching result is possible for arbitrary stock.

**Validate:** reset and replay both walkthroughs against their documented inputs. First check whether the existing scenario/run sheet already supplies the capability: this may need only scenario preparation, not a new product feature.

## Separate process action

### A01 — Review a clickable end-to-end flow before future backend builds

At **00:26:21–00:26:42**, Russell proposes a retrospective action: produce a clickable mock-up of the actual journey for human criticism before building the backend, and adopt that approach for future work. The disconnected flow would have been apparent earlier.

Record this for the retrospective and workflow discussion, separately from product defects and improvement Stories. This proposal does not change shared project policy or require reworking the current backend. Any mock-up that requests comments must provide a persistent, tested route to save and retrieve the actual feedback, as required by AGENTS.md.

## Corrections, observations and scope that should not become extra bugs

| Discussion | Final interpretation |
|---|---|
| Used-car matcher previously did not load, 00:00:47–00:01:06 | It loads during this meeting. Historical/intermittent observation only; no current failure established. |
| “Buddy Activity is missing”, 00:11:09–00:15:40 | Activity is found at 00:15:18 after confusion over the URL. Keep D04's discoverability/integration issue; do not report the feature as unbuilt. |
| Five cars in the script versus six released, and a different recommendation mix, 00:12:06–00:12:51 | The participants accept the variation. No product defect is established. The run sheet may need reconciliation with the final scenario. |
| Four eligible cars allegedly counted incorrectly, 00:13:39–00:13:50 | Russell withdraws the objection. Keep the distinct D09 concern about displaying an ineligible candidate. |
| Explanations mainly cite availability, 00:13:04–00:14:02 | They subsequently note preferences/importance were unset. Recheck with meaningful saved preferences; no ranking or explanation defect is proved by this exchange alone. |
| Declining an offer previously failed, 00:16:53–00:17:53 | Decline succeeds in this walkthrough, and the new saloon preference persists. Do not create an unconditional decline-failure Bug. |
| Is the run shared?, 00:19:33–00:20:23 | Cross-browser ticks work after refresh. S03 concerns a usable operator/audience experience and any remaining refresh work. |
| Preferences must be browser-local, 00:21:51–00:22:59 | Suspected cause only. A stale display is a later alternative explanation; D11 must diagnose both. |
| Separate admin panel instead of a side overlay, 00:05:22–00:05:38 | Withdrawn; the side overlay remains acceptable. |
| Accept may be disabled because declarations are incomplete, 00:26:59–00:27:24 | GC confirms declarations are complete; the subsequent brief-conflict message grounds D13. |
| Greg, other users and the rest of the lifecycle, 00:28:40–00:29:22 | Deferred to another recording. This document cannot stand as a review of those journeys. |
| Start pollers and fix everything, 00:29:37–00:30:16 | The meeting finishes with proposal review and focus on key items. The subsequent instruction authorises backlog creation, not fixing the whole backlog or starting pollers. |

## Existing work to reconcile before creation

GC explicitly asks to check the existing UI bugs before raising more (**00:09:33–00:09:58**) and repeats that concern at the end (**00:29:51–00:30:09**).

The committed [9 November UI/UX review](ux-review-2026-11-09.md) is a useful overlap index, but its findings are not all additional findings from this meeting:

| Proposal | Likely existing overlap to inspect |
|---|---|
| D02 | Review findings 1, 9 and 11: internal/source copy, caveat prose and car names. |
| D03, S02 | Finding 7: oversized presenter strip; finding 6: reset/principal experience. The meeting's one-confirm setup and operator split require separate scope comparison. |
| D04 | Findings 4 and 15: offer-page dead ends and inconsistent employee navigation/shell. |
| D06 | Findings 8, 9 and 15: comparison/readability, excessive copy and shell consistency. |
| D07 | **FUCQ-250**, named in the review and [committed delivery log](overnight-log-2026-11-08.md), covers missing 3 Series images. The log records partial work and source/access limitations; do not assume closure. |
| D08 | Finding 9 overlaps missing-value presentation; it does not establish that this meeting's source-data gaps were fixed. |
| D11, S03, S04 | Finding 24 covers views staying stale after presenter actions. Compare that scope with user preference readback and autonomous time; they are not necessarily the same repair. |

The table above records the initial local-document overlap analysis. Live Jira reconciliation is now part of the approved publication pass; its results are recorded in the receipt below. Preserve existing descriptions, claims, statuses and deferrals. Reconcile D03/S02/S03 and D06/S07 to avoid overlapping acceptance or duplicate implementation work; D01 remains outside this batch.

## Remaining refinement

The grouping and creation exclusions were approved on 10 November 2026. Existing-work reuse and origin/context relationships are recorded above. Refine setup persistence lifetime, clock pacing/control behaviour and minimal current-car history before implementation. D13 records the approved preference-only precedence ruling and requires its explicit contract documentation with the other legitimate gates preserved.

The created records contain diagnosis, originating-Story evidence or explicit uncertainty, severity/priority and observable acceptance. They use the existing `decided`, `acceptance` and `validate` sections and apply [build rules](build-rules.md), [experience quality](experience-quality.md), the [GCSP shell reference](screens/README.md) and [shared components](../../COMPONENTS.md). D04 and D11 retain `needs-triage` because their composed origin or failing layer remains unresolved. Existing claims, statuses, deferrals and acceptance criteria are preserved; product-map entries record observed backlog facts, without asserting development progress or acceptance.

## Analysis and validation record

- Read all 515 cues; reconciled repeat discussions and later corrections. Source SHA-256: `5e24fbeccec53353ebe2f4b4db5129c93a07e0f8dd2967976284f44fe84307a2`.
- Initial scope: transcript analysis and Markdown proposal. Checks selected: full transcript coverage, timestamp traceability, deduplication/corrections, independent completeness review, local-link checks and whitespace/diff review. The initial review found no material omissions or unsupported causal claims; its one timestamp correction was applied.
- Publication scope: approved Jira intake, this receipt/publication JSON and bounded product-map associations. Checks selected: live duplicate/origin reconciliation, native type/parent metadata, independent payload review, saved-content and native-link readback, exact marker inventory, local-reference/JSON/whitespace checks. Application implementation, live UI reproduction and software test suites are excluded because no runtime code changed. This is intake verification, not proof that the reported Bugs are fixed.
- Jira results: **18/18 created and verified**, matching native types (**10 Bugs, 7 Stories, 1 Task**); **57/57 Relates links verified**; saved descriptions equivalent after Jira's Markdown square-bracket escaping; zero duplicate marker records. D02/D07 reuse existing records; D01/S01 are excluded as directed.
- Local results: **21 finding sections** remain (13 defects, 7 Stories, 1 action); all **79 timestamp ranges** are ordered and within the recording; **7 local links** resolve; JSON and whitespace checks pass. Product-map source records cover 19 verified product items with 27 component associations added; process Task A01 has no product component. Unrelated map rows, slices and claims are unchanged. Map deployment was not verified in this intake pass.
- Independent reviewer: **Wile E. Coyote**, Opus tier; requested/selected `gpt-6.1-sol` / `high`, no fallback or descendants. Effective runtime settings were not independently confirmed.
- Publication reviewer: **Marvin the Martian**, Opus tier; requested/selected `gpt-6.1-sol` / `high`, no fallback or descendants. Reviewed local origins/overlaps and all 18 concrete payloads; no material problems. Effective runtime settings were not independently confirmed.
- Resource/cleanup receipt: both reviewers completed; no test, browser, build or proof scratch was allocated. Disposable allocation removed: **0 bytes**; scratch leftovers: **zero**. No large outputs or compatibility exceptions. Retained outputs are this Markdown, the publication JSON and bounded product-map source updates; no source transcript copy or recording credentials are included.
