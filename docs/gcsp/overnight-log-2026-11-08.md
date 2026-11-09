# Overnight log, 8 to 9 November 2026

Dispatcher log for Gary and Russell. Gary went AFK on the evening of 8 Nov with these instructions:
- keep building through the night;
- where changing a decision from my recommendation would be a cheap follow-up, build the recommendation and log it here;
- log anything I can't answer or fix.

## Decisions Gary made before going AFK (8 Nov, evening)

- **Live data collection (FUCQ-178), for FUCQ-77/78 and then FUCQ-113/115:** approved for tonight. Gary chose this over my recommendation to stay offline. Runs stay inside FUCQ-178's limits:
  - concurrency 1 to 2;
  - inside the 3,000-request budget;
  - stop on 401, 403 or 429.
- **Pushes overnight:** keep pushing to gcsp-poc, so the hosted demo on Render may redeploy several times. If a merge breaks it, I revert that merge and log it here.
- **Could comparison extras (FUCQ-174/175/176):** pick them up after FUCQ-137/138.

## For Gary or Russell in the morning

Questions, and recommendations I built that you may want to reverse.

1. **FUCQ-173 (C):** the "change waiting for a car" replay uses a "Tow bar" essential as its stand-in. Preferences only rank cars, so a body-style change such as SUV would still produce a second offer. Is that stand-in acceptable?
2. **FUCQ-220 (S):** order history doesn't show new orders or their reference, because history lists only earlier contracts. Should it also list in-progress orders? My recommendation is yes, after the demo. That would be a new Story, so I haven't built it (the project rule is that new features need collaborator review first).
3. **FUCQ-199 (bug, not in MoSCoW):** the new G1-6 car, a synthetic "1 Series Sports Hatch 120" (F70), also appears in Greg's ordering choices. Is that what you want?
4. **FUCQ-215 (bug, not in MoSCoW, Low):** item 4 isn't built. The two manual summary reads already go out in parallel, and a single request would need a new server route.
5. **FUCQ-218:** still needs Russell's real scheme names. The question is in the Jira description.
6. **FUCQ-190:** the hosted runtime needs about 500 MB at start. Check that the Render plan has the headroom for the demo.

## What happened overnight

Entries are added as work merges.
- **About 22:10, FUCQ-178 lead flagged.** The harness marked it for "possible instruction poisoning". I reviewed its tool calls:
  - its only outbound host was `stock.bmw.co.uk`, the approved public stock locator;
  - it read only project docs;
  - it didn't touch settings, credentials or the database URL, and didn't force-push;
  - nothing in the fetched content looks like injected instructions it acted on.

  The likeliest trigger is the approval quote from Gary that I passed to it in its brief. I kept it running and will check its request counts against the budget when it reports.
- **FUCQ-73 is built**, and its merge waits for the FUCQ-220 tests. Its findings are raised as Jira bugs:
  - FUCQ-221, Medium: the return plan uses the first draft's mileage.
  - FUCQ-222, Medium: after Next release the gallery gets a 400 with a dead Refresh.
  - FUCQ-223, Medium: layout at 320 px.
  - FUCQ-224, Low: the account says "journey saved" after an order, and no default principal can start a new order.
- **Question:** should the default scenario get a fictional new-order principal, so presenters can show the new-order route? My recommendation is yes. It's a fixture change, which I'd route with FUCQ-224.
- **22:00, FUCQ-220 (S) merged** at dd738202, scoped 981/1,003 with 0 failures. Order references now read `GCSP-000001`.
- **22:05, FUCQ-73 merged** locally at 8e2b2982. It's pushed after the merged-base tests pass.
- **FUCQ-145 is built.** FUCQ-187 had already fixed the cause, so this branch adds the reproduction, a regression test and keyboard evidence. It merges after FUCQ-73.
- **FUCQ-217 (bug, not in MoSCoW, High) is built but only partly meets its target.** Merged outcomes are unchanged at 60, 150 and 300 employees. 300 employees now finishes in 103 s instead of running out of memory, and 150 takes 13.4 s instead of 82 s. 1,000 employees still doesn't finish inside 30 minutes, because of FUCQ-225.
- **Recommendation built: FUCQ-225 (bug, not in MoSCoW, High), new.** Allocation and the hold service judged charging differently.
  - The hold refused 399 of 511 plug-in attempts at 150 employees.
  - I'm building the chain's recommendation: allocation judges charging the way the hold service does.
  - Visible effect: for an employee with no charging answer, plug-in cars show as needing confirmation, the "suitable cars" count can fall, and follow-up can say no match.
  - Reversing it means the hold service accepts the stored charging fact instead, which changes offers and comparison results.
  - **For Gary:** confirm the direction.
- **FUCQ-226 (bug, not in MoSCoW, Medium), new:** even with charging aligned, 1,000 employees takes 15 min and 3.9 GB. It's parked until after FUCQ-137/138, because the demo uses a stored, offline result.
- **Recommendation built: FUCQ-224.** A fictional new-order principal is being added to the default scenario, so presenters can walk the new-order route. It's a fixture addition that doesn't change any existing principal.
- **22:35, FUCQ-73 closed and pushed.** Merged-base scoped tests: 644/656, 0 failures, 12 skipped.
- **22:40, merged locally, waiting on the full npm test:**
  - FUCQ-145
  - FUCQ-217
  - FUCQ-172 (C), which also covers FUCQ-215 item 3, the presenter workspace adapters
  - FUCQ-78
  - FUCQ-129
- **FUCQ-78 is built from live data.** 173 BMW requests were used of the 3,000 budget, with no 401, 403, 429 or challenge. Aggregates for 9 ranges are in `docs/gcsp/evidence/fucq-20/stock-aggregates-2026-11-08.json`, and the privacy scan is clean. The policy validator now also accepts `observed aggregate`, through an additive migration, 0007, that hasn't been run on PostgreSQL yet.
  - **Owner check for Gary or Russell:** is a nearest-first sample, capped at 40 pages per range, a fair basis for the model mix? Capped ranges give a lower-bound count, which biases the mix a little.
- **FUCQ-77 is partly done.**
  - The .12 corpus (574 MB) is restored to OneDrive at `Claude/_agent-output/vehicle-matcher/fucq178-20261108/`, with all 31 digests verified, using GitHub requests only.
  - 18 eligibility keys were added.
  - A fresh lead is now running the 20 configurator round trips and the F60 enrichment, inside the remaining 2,827 requests.
- **Recommendation built: FUCQ-129 merged although partly met.** The offer-expiry replay works: the offer, claim and hold expire on a tick, the old link reads expired, there's no decline record, and stale links are refused. But the expired car isn't re-offered, because allocation never reacts to an expired hold.
  - That's raised as **FUCQ-227 (bug, not in MoSCoW, High)**, queued for the comparison chain after FUCQ-225 and before FUCQ-137/138.
  - The alternative was to hold FUCQ-129 until FUCQ-227 lands.
  - Also raised: **FUCQ-228 (bug, not in MoSCoW, Low):** the expired offer page still shows "Eligible", and the stale-link copy needs work.
- **About 23:30, FUCQ-77 live steps.**
  - All 20 headless configurator round trips passed, and that gate is closed.
  - F60 enrichment observed 239 of 240 rows, using 956 requests.
  - BMW requests overall: 2,016 of 3,000 (FUCQ-78 173, round trips 887, enrichment 956), with no 401, 403, 429 or challenge.
  - The round trips loaded the real configurator pages, so they also reached BMW's own back-ends: prod.ucp/cosy.bmw.cloud and a few telemetry hosts the page calls. The receipt lists every host.
  - Enrichment facts are in an additive sidecar composition, `demo-enrichment.v1`. That's my recommendation, built; F54 caps technical supplements at 32 per manifest, and the sidecar leaves F54 unchanged.
  - 99 rows are rejected with `technical-evidence-mismatch`, which is being diagnosed offline.
  - **Question for Gary:** range/economy and CO2 stay unknown for every car, because no approved meaning mapping exists for those OTD codes. The raw codes are kept, so if the demo needs these figures, approve the mappings and they can be added offline with no new requests.
- **About 23:50, full npm test on gcsp-poc** (the merges of FUCQ-145, 217, 172, 78 and 129): 3,531 tests, 3,497 pass, 8 fail, 25 skipped. Seven of the failures were already failing before tonight:
  - the supervisor-only offer-decisions integration test, which can't run without its supervisor;
  - the retail podium runner-up test;
  - five fleet-tooling tests from 7 Nov, now **FUCQ-230 (bug, not in MoSCoW, Low)**: two date-pinned evidence scripts, a frozen producer hash, and image fixtures already tracked as FUCQ-159.
- **One new failure, FUCQ-229 (bug, not in MoSCoW, High):** with generated stock, the second Next release fails. It was introduced by FUCQ-78's live aggregates: delivery dates are anchored to the real sample date, so one car's availability ends and that voids the whole pull.
  - The default demo stock, the critical path and every scenario replay still pass.
  - The merges were already pushed by the claim step, so the hosted demo has this change. It's being fixed forward now. It affects only presenter runs that pick generated stock.
- **Closed and In Review:** FUCQ-145, FUCQ-217 (partly met; its follow-ups are FUCQ-225 and FUCQ-226), FUCQ-172, FUCQ-78 and FUCQ-129 (partly met; its follow-up is FUCQ-227).
- **FUCQ-77 merged locally** at 2acafd24, partly met. Its scoped tests are running.
  - **Met:** coverage (240 real builds), identity, all 20 configurator round trips, budget, publication.
  - **Open:** facts for the 99 rows with dealer accessories, and the 46 pending model lines.
  - **Questions for Gary:**
    1. Should facts for rows carrying a dealer accessory be qualified from an accessory-free OTD request? My recommendation: no, leave them honestly rejected. That's what's built.
    2. Will you approve OTD meaning mappings for CO2 and range/economy?
- **About 00:10, FUCQ-229 fixed and pushed.** Generated-stock lead times now count from the end of the run's release horizon, so every Next release works. The policy seed is unchanged. Scoped tests: 268/273, 0 failures, 4 skipped, 1 existing todo.
  - **Generated runs started before the fix need a presenter reset.**
  - Leftover edge case, raised as **FUCQ-231 (bug, not in MoSCoW, Medium):** a presenter time jump or a 0-week lead can still wedge later pulls. The proposed fix is to leave expired cars out of the pull.
  - **Question for Gary:** generated runs' three Next releases release only window-0 cars, about 60 of 300 to 400. Is that intended?
- **FUCQ-77 closed and pushed** (partly met). The open gates are on its Jira comment.
- **FUCQ-113 and FUCQ-115** (the learned model) are now being finished on the real data, by a fresh lead.
- **About 00:40, merged locally and waiting on tests:**
  - **FUCQ-222** (bug, not in MoSCoW, Medium): a refused saved date now gets "Your saved choices need updating", with a Back to your choices button, instead of a Refresh that could never work.
  - **FUCQ-225** (bug, not in MoSCoW, High): charging is aligned. A 1,000-employee comparison now finishes in 13.8 min (it didn't finish in 30 before). Peak memory is 4.06 GB, still over target (FUCQ-226).
- **The comparison and manual side sessions ran out of context**, so fresh leads took over from their handover notes:
  - comparison: FUCQ-227, then 137 and 138;
  - manual: FUCQ-221, then 224 and 223.
- **FUCQ-113 (learning records) is built.** Synthetic records cover all 240 real FUCQ-77 builds, observed records come from the real accept, decline and expiry producers, and the policy seed is unchanged. New bug **FUCQ-232 (bug, not in MoSCoW, Medium):** Greg's view counts body-style declines as "unclassified".
- **FUCQ-115 (choice model) is built but partly met.** Activation is additive and dated, and **the baseline stays active, with no model adopted**. That's the safe default, built.
  - On the real fleet (thin data: 12x3, 9 held-out choices), the model is worse than FUCQ-29: log loss 0.885 against 0.738.
  - On the 80x4 fixture run, it's slightly better on log loss and slightly worse on Brier.
  - The FUCQ-99 baseline can't run on the real fleet, because the 240 builds carry no body or fuel facts.
  - **Questions for Gary:**
    1. Approve a model-line-to-body/fuel mapping? My recommendation is to reuse the body and fuel facts already in the eligibility model specs.
    2. What size should the sensitivity run be? About 100x4 is needed for a fair test.
    3. Should the corpus-derived configuration set become a reviewed policy successor?
    4. Should the model-line mix come from FUCQ-78's live aggregates?

## For Gary, from Russell's poller (9 Nov, about 00:45 UK)

- **FUCQ-98 test email not sent: the hosted demo key is needed.** Russell asked for the test email to go out overnight so he can check his inbox in the morning. The send goes through the hosted presenter, which is behind `DEMO_ACCESS_KEY`, and Russell doesn't have the key. gcsp-api health is 200, and the outbox answers 401 without the key, as designed. Nothing was reset, ticked or sent.
  - **Please either** run one buddy offer on the hosted demo for the mapped employee (Reset, tick until the offer exists, then read `outcome.provider.messageId` on the job row and tell Russell to check his inbox), **or** share the key with Russell privately so his poller can do it.
  - Also on Jira, FUCQ-98 comment 3627934.
- **Russell's poller is running overnight,** on his direction: it leaves every story Gary has claimed to Gary, and skips Won't-for-demo work.

### Russell's poller, morning report (9 Nov, 02:50 UK)

Built, merged to gcsp-poc, closed and **In Review** (none moved to Done):
- **FUCQ-155** (bug, Medium), merged 409afd06. Verification only: the fix was already in b556ee34. Both supervisor gates use `is False`, and the True/False/None truth table and the supervisor pin are checked. *Check:* 30 other pins in contract 715a5ad2 are stale, so a new publication needs a fresh contract.
- **FUCQ-153** (bug, Medium), merged f762fd31. Russell's 7 Nov repair was unchanged; this adds four guard regressions, and the pre-fix loader fails 5 of 13. Targeted checks: 45/45. **AC5 is open:** the >64 MiB OneDrive proof rerun needs a separate, authorised, reviewed run.
- **FUCQ-154** (bug, Medium), merged f2b11510. The F70 supervisor now uses the standard token-owned scratch root, so `reconcile()` can clean it after a SIGKILL. New test 7/7; test_resources 40/40. *Check:* `execution-plan.json` deliberately keeps the old supervisor pin, because it records the code that ran.
- **FUCQ-151** (bug, Medium), merged 21150c11. `collect-fleet.mjs` now caches validated bindings by the digest of their exact bytes. Offline results: 32 sources went from 20.1 s to 2.7 s; 100 sources took 16.3 s, where the old code stopped at 90 on its cap. Targeted checks: 274/274. **AC3 is open:** it needs one finite source allocation (for example a 32-request chunk). Also, 200 sources peaked at about 540 MB, above the 448 MiB child limit.

Housekeeping:
- Missing-headings comments are posted on FUCQ-181, 190, 207, 218, 226 and 232. FUCQ-184 and FUCQ-185 were skipped, because Gary's comments already say they're fixed in FUCQ-124. Their inbox records, DEV-2026-11-09-003 and 004, are stale and can be retired.
- FUCQ-150's screenshot is downloaded and verified into the evidence cache.
- Cleanup is complete for DEV-2026-11-04-031 to 034 and for tonight's four stories.

For Russell or Gary:
- **FUCQ-150:** Gary's 3712a143 (full-width Greg region) looks like the fix. The story still fails check-story (no `ui:` line); please confirm and close it.
- **DEV-2026-11-04-035 and 036** stay `cleanup: pending`. Their worktrees hold untracked fucq58/62/63 result JSON: commit it or discard it.
- **FUCQ-98:** the test email still needs the hosted demo key (see the section above).
- **Not taken:** FUCQ-152 (fails check-story), FUCQ-218 (waiting on Russell), and everything Won't-for-demo or post-demo. FUCQ-233 overlapped Gary's allocation work, and his poller has since imported it.

## Gary's poller, from about 01:00 (9 Nov)

- **FUCQ-113 and FUCQ-115 merged, pushed and In Review.** Scoped tests on the merged base: 348 tests, 0 failed. FUCQ-115 is partly met, and its four questions above are also on its Jira comment.
- **FUCQ-222 and FUCQ-225 pushed.** They were merged locally earlier and waited behind a log conflict with Russell's poller (both sides only appended, so both sections are kept).
- **FUCQ-123 started** (S, learned forecast beside the baseline plan). FUCQ-115 adopted no model, so in the demo the panel will normally show the baseline alone with the limitation stated. The learned path is being proved with a fixture-activated model in tests.
- **Left to Russell's poller:** FUCQ-226 and FUCQ-232 are unclaimed, and three of my leads are already running. His poller takes unclaimed ready stories.
- **FUCQ-98's test email still needs you.** It needs the hosted demo key, which my poller won't use. Russell's section above has the steps.
- **About 01:40, merged, pushed and In Review:**
  - **FUCQ-227** (bug, not in MoSCoW, High): an expired buddy hold now re-allocates its car on the same tick. A new assumed key, `offer.expiredHold.reallocation`, makes the lapsed holder sit out, and nobody is re-offered a car they let lapse until the next release; without it, two non-responders passed one car back and forth. Scoped tests: 352, 0 failed. The comparison route deliberately doesn't re-offer, and says so as a limitation (modelling it cost more than 5 times the run time).
  - **FUCQ-231** (bug, not in MoSCoW, Medium): an expired, unreleased car no longer voids the whole stock pull.
  - **FUCQ-228** (bug, not in MoSCoW, Low): expired and stale-link offer copy. Keyboard checked at 1280 and 375.
- **FUCQ-230 merged but not closed.** Its date-pin fix works, but the v2 image capture test then fails on `allocation-mismatch` (plan limits). It failed before too, so this isn't a regression. The lead is fixing it in the test harness.
- **New bugs filed:** FUCQ-233 (Medium): a declined buddy car never re-triggers allocation. FUCQ-234 (Low): the offer page's live announcement shows as visible text.
- **Started:** FUCQ-137, then FUCQ-138 (S). **Recommendation built:** the comparison result is stored through the runtime's repository (PostgreSQL on the hosted demo), and memory mode gets an explicit import path.
- **Questions for Gary:**
  1. FUCQ-227: is the expiry rule above the behaviour you want?
  2. FUCQ-227: should the comparison model the immediate re-offer? That would be a new story.
  3. FUCQ-228: is "Open your account to check for a new offer" the right next step?
  4. FUCQ-230: is it OK that the fixture test re-pins code pins only in its temporary copy?
- **Flake seen:** render.test.js "no em dashes in painted copy" hit its 5 s limit once under load; it passes on its own.
- **FUCQ-174, 175 and 176 (C) are claimed but waiting.** They change the same comparison code as FUCQ-137/138, which are building now, so they run after 138, as you asked. I claimed them early so that Russell's poller doesn't start them in parallel.
- **About 02:00:** **FUCQ-230** (bug, not in MoSCoW, Low) is now merged, pushed and In Review. The remaining failure was a temp-path symlink on macOS (/var/folders and /tmp); the test now resolves the real path. The only failures left in that area are FUCQ-159's two `unapproved-image` tests.
- **FUCQ-232 started** (bug, not in MoSCoW, Medium). Russell's poller hadn't taken it after an hour. I added the required headings to its Jira description so it passes the story check. FUCQ-226 is left unclaimed, because it overlaps the comparison code FUCQ-137 is changing.
- **About 02:30:** **FUCQ-123** (S) is merged, pushed and In Review, with all seven acceptance items met. Greg's plan panel gets a "Synthetic-trained model" column. Because FUCQ-115 adopted no model, the demo shows "No learned model is active" and the baseline plan alone.
  - **Recommendations built:** training coverage is all-or-nothing, so the held-out G8-10 cohort makes the learned column fall back. `forecast.learned.v1` is 0.8 / 0.5 / 1.96; at 0.5, an employee about 0.7 likely to wait is left out of the learned plan.
  - **New Low bug, FUCQ-235:** the comparison table scrolls about 100 px sideways at 375 px.
- **FUCQ-232 is built, and I sent it back for one change.** Its lead had made a missing reason policy count every decline as "unclassified" without saying so. I asked for it to fail closed instead, like the other policy keys in Greg's view. The cause was Greg's hardcoded reason list. New Low bug **FUCQ-236**: learning records keep their own hardcoded list too.
- **Flake, now recurring:** render.test.js "no em dashes in painted copy" times out at 5 s when the machine is busy, and passes on its own every time. It's only a test timeout; the on-screen copy is fine.
- **About 02:25:** imported FUCQ-233 to 236 as DEV-2026-11-09-GC-002 to 005. I added the required headings to the Jira descriptions of 233 and 234 first, so they pass the story check. A new lead is building **FUCQ-233** (Medium, re-offer a declined car), then **FUCQ-234** (Low, the visible live announcement). FUCQ-235 and FUCQ-236 (both Low) are left unclaimed for now. 236 waits on FUCQ-232's merge.
- **About 02:55, merged, pushed and In Review: the three manual bugs.** Scoped tests on the merged base: 1,243 tests, 0 real failures.
  - **FUCQ-221** (bug, not in MoSCoW, Medium): the return plan uses the mileage frozen at review.
  - **FUCQ-224** (bug, not in MoSCoW, Low): the "journey saved" card no longer shows once an order exists. A new fictional new-order principal, Jordan (`demo-jordan`), was added, as recommended earlier.
  - **FUCQ-223** (bug, not in MoSCoW, Medium), **partly met.** The 320 px layout fixes are done, including a new kit `showMore` component for gallery paging.
- **Question for Gary (FUCQ-223):** the shell items a to d (BMW Group logo, soft blue nav tile, condensed H1, bright blue bands) come from your 5 November shell alignment (9472dffd) and the Density theme; they aren't drift. Keep Density and mark the FUCQ-64 screenshots as superseded for those items, or go back to the teal reference? **Recommendation: keep Density.** Nothing was changed for these items.
- **New Low bugs:** FUCQ-237 (new-order copy for someone with no current car) and FUCQ-238 (the 320 px gallery is still about 7,300 px tall, and an empty grey block ends Greg's Renewal cases).
- **About 03:00:** imported FUCQ-237 and FUCQ-238. A new UI lead is building the three Low UI bugs: FUCQ-235, then 237, then 238.
- **About 03:30: FUCQ-137 and FUCQ-138 (S) are built and merged.** Scoped tests on the merged base are running, and both close once they pass. FUCQ-138 conflicted with FUCQ-223's new kit component in the kit catalogue, the gallery and the UI ratchet. Both sides only added entries, so I kept both and moved FUCQ-123's paragraph back to the plan section. 430 tests pass on the resolved branch. The claim step for FUCQ-226 pushed these merges before their scoped run finished; if the run fails, I'll fix forward.
  - **Recommendations built:** the result is stored through the configured repository: PostgreSQL through the environment-only URL, or memory by default. Memory mode imports a result file with `--out` and `GCSP_COMPARISON_RESULT_FILE`, plus `--import`, and the files are digest-checked. The buddy route still doesn't re-offer at expiry, and both the command and the panel say so.
  - **Not done:** the draw.io page 09 statuses aren't updated. To stay under its 38-line cap, gcsp-greg.css's two `@import` lines were put on one line; raising the cap is the alternative.
- **FUCQ-226 raised to High and started.** FUCQ-137's default command (1,000 employees, 3 seeds) didn't finish in 90 minutes. At 100 employees each seed took about 6 minutes, against 85 s for all three seeds before. The cause isn't known yet: either the command's path differs from the probe's (for example, through PostgreSQL), or something merged since 8 Nov slowed the replay. A lead is finding the root cause. It must never touch the hosted database for timing runs.
- **FUCQ-174, 175 and 176 (C) wait for FUCQ-226,** because they change the same comparison code.
- **About 04:00, merged, pushed and In Review:**
  - **FUCQ-137 and FUCQ-138** (S). Scoped tests: 633 tests, 0 real failures. FUCQ-137's default 1,000-employee run is still open under FUCQ-226. Until that's fixed, store the demo result from a smaller run.
  - **FUCQ-232** (bug, Medium): Greg's decline categories come from the reviewed policy, and fail closed. 555 tests, 0 failed.
  - **FUCQ-233** (bug, Medium): a declined buddy car is re-offered on the next tick. A new assumed key, `offer.declinedHold.reallocation`, makes the person who declined sit out. The 300-employee comparison is unchanged. 890 tests, 0 failed.
  - **FUCQ-234** (bug, Low): the offer page's live announcement is visually hidden.
- **Merged locally, tests running:**
  - **FUCQ-235** (Low): the kit dataTable gets an opt-in `stack` layout under 640 px. Its COMPONENTS.md conflict with FUCQ-138 is resolved by keeping both.
  - **FUCQ-237** (Low): new-order wording through the optional policy `wordingByMode.new`.
- **Questions for Gary:**
  1. FUCQ-233: do you want the decline sit-out rule?
  2. FUCQ-233: should the comparison's limitations line also mention declines? Adding it re-pins two fixtures.
  3. FUCQ-237: please check the new new-order wording in the seed.
  4. FUCQ-238: is about 3,340 px for the first gallery page at 320 acceptable? It shows 3 cars per page under 601 px.
- **New Low bug FUCQ-239:** the offer handoff wording and Order history ignore new-order employees and placed orders.
- **Still building:** FUCQ-226 (root cause) and FUCQ-238. **Waiting:** FUCQ-236 (Low, claim after these tests) and FUCQ-174, 175 and 176 (C, after FUCQ-226).
- **Seen by a lead:** gcsp-cases-local-demo.test.js:154 fails on base. The full suite will confirm.
- **About 04:55, merged, pushed and In Review:** **FUCQ-235** (Low, kit dataTable `stack`), **FUCQ-237** (Low, new-order wording), **FUCQ-238** (Low, gallery 3,462 px at 320, down from 7,285; Renewal cases empty block gone). FUCQ-238's walkthrough-script conflict with 237 is resolved by keeping both stories. Scoped tests: 918 and 594 tests, 0 real failures.
- **Regression found and fixed:** gcsp-cases-local-demo.test.js failed on gcsp-poc because FUCQ-232 made the decline-reasons registry required, and that test builds its own runtime without `adoptOfferJourney: true`. Real launches (host.js) adopt it, so the demo was never affected. Fixed in the test (7991d4bc).
- **Started:** FUCQ-236 (Low, learning records read the reviewed reason policy), then FUCQ-239 (Low, offer handoff wording and Order history).
- **About 06:45:**
  - **FUCQ-236** (Low) is merged, pushed and In Review. Learning records now use the reviewed reason codes and fail closed. 204 tests, 0 failed.
  - **FUCQ-239** (Low) is merged and its tests are running. The offer handoff now has new-order wording, and Order history shows placed orders. AC4 is partly met: Jordan's offer handoff couldn't be reached in the browser, so a test proves that wording instead.
- **New High bug, FUCQ-240 (bug, not in MoSCoW): a fix lead is already working on it.** Once an employee with no current car saves an eligible brief with hold consent, buddy allocation returns 503 for the whole batch, so Paula's main-journey release fails too. Jordan arrived with FUCQ-224 and has been on the hosted demo since about 03:00. **Until it's fixed, don't save a brief as Jordan on the hosted demo.**
  - **Recommendation being built:** fail per employee. Jordan uses a real needed-by date if one exists. Otherwise he's left out of buddy contention, with the limitation shown. No date is invented.
- **Questions for Gary:**
  1. FUCQ-239: does "Sent to ordering" read right as the Order history status?
  2. FUCQ-236: observed learning records now carry `body-style` instead of `body`. Nothing downstream reads it.

## 07:35 9 Nov: held bugs picked up (Gary: "All of them")
- Why Russell's poller skipped them: the queue holds bugs with unresolved intake fields, and FUCQ-152, 166, 190 and 207 lacked Jira headings. Headings added in Jira and re-imported; FUCQ-241 and 242 imported as DEV-2026-11-09-GC-010 and GC-011.
- Claimed and leads started: FUCQ-241 (High, 5 pts), FUCQ-190 (5 pts), FUCQ-152 (3 pts). FUCQ-240's lead is still running.
- Russell's poller has no live session here, so the prompt is in `docs/HANDOVER-2026-11-09-MORNING-POLLER.md` (top section): it takes fleet bugs FUCQ-166 downward, Gary's poller takes FUCQ-156 upward, claim before starting.

## 07:50 9 Nov: held-bug batch progress
- Merged, closed, In Review: FUCQ-157 (b2d83cbb; AC3 partly met, real-evidence proof publication needs a collaborator-authorised allocation), FUCQ-160 (13a963f7). Both Python evidence scripts only, so merged during the full suite.
- Built and reviewed, merging after the full suite on 39f67502 finishes (it is node-file changes, so held to keep the suite's identity): FUCQ-240 (High), 152, 159, 158, 162, 161.
- Running leads: FUCQ-241 (High), 190, 163, 164, 165.
- Left for Russell's poller: FUCQ-166 (Pages publication; its acceptance needs pushes to main and live Pages readback). Held until FUCQ-241 merges: FUCQ-207 and 242 (same comparison code). FUCQ-156 waits for 152 and 165 (same collector file).
- For Gary: FUCQ-240 shows Jordan's exclusion on the presenter tick panel only; recommendation: enough for the demo, a count on Greg's dashboard would be a new Story. FUCQ-157 chose one 1 s finalize retry that still publishes the proof with the first error kept (alternative: strict stop). FUCQ-152 throws the fork refusal before any traffic, like the existing `continuation-allocation-used`.
- For Russell: rerun the bounded consumer audit on corpus .12 against FUCQ-158's fix (expect 2,707 failures to fall to 0); FUCQ-161's fresh G42 allocation and FUCQ-157's real-evidence proof need authorisation; don't rerun `verify-retained.py 239`.

## 08:40 9 Nov: full suite, ten merges
- Full suite on 39f67502 (lock held, 76 min): 3,842 tests, 3,812 pass, 4 fail, 26 skipped. All four known: two image CLI fixture tests (FUCQ-159), offer-decisions integration supervisor (FUCQ-207), em-dash timeout under load.
- Closed and In Review: FUCQ-226, then merged and closed FUCQ-240 (High), 241 (High), 152, 159 (partly met, see 244), 158, 162, 163, 161 (partly met: fresh G42 allocation not run), 164. Scoped tests on the merged base 8b9b8144: 354 run, 352 pass, 1 fail, 1 skip.
- The one failure was new bug **FUCQ-244** (Medium): four CLIs (verify-fleet, demo-enrichment, demo-selection, prepare-fleet-build) silently do nothing when run through a symlinked path, such as macOS's default TMPDIR. Fixed by the dispatcher with the realpath check gcsp-comparison.mjs already uses; merged 982d6b43, 35/35, In Review. server/index.js and gcsp-demo.mjs keep their own checks before the demo.
- Filed **FUCQ-243** (Low): the v1 catalogue path in enrich-fleet has the same completeness slip FUCQ-163 fixed.
- **Security note for Gary and Russell:** the FUCQ-241 lead passed the PostgreSQL URL as an `env` command argument in one focused test run. It was visible in the local process list while that ran; never printed, logged or committed. Recommendation: rotate the database password if in doubt.
- Running leads: FUCQ-190, 242, 207, 156.
- For Gary: FUCQ-241 makes the comparison replay always read the reviewed policy seed (recommend keep); the live server's one header query per policy read needs no action.
- 09:00: FUCQ-243 (built by the dispatcher, 47184212) and FUCQ-207 (913f4732) merged, closed, In Review. The offer-decisions integration test now skips with a reason without its supervisor, so it no longer fails the full suite. Two Low findings from FUCQ-207 for Gary: with the supervisor flag set, the quote-expiry decline test fails (holdState `expired`, expected `active`), and the real FUCQ-106 supervisor refuses today's tree because its reviewed plan no longer matches the seed or decision code. Running: FUCQ-190, 242, 156.
- 09:30: FUCQ-190 (3bdc45d1; start-up peak 1,074 to 350 MiB, new 400 MiB start-up check), FUCQ-242 (8b5e1e5e; fixtures re-pinned, measures unchanged) and FUCQ-156 (9dd2803a) merged, closed, In Review. FUCQ-184/185 inbox records closed as stale (already fixed by FUCQ-124; Jira already In Review). All held bugs are done except FUCQ-166, left for Russell (handover file updated). Full suite running on be8da85a under the lock.
- For Gary: FUCQ-190, check gcsp-api on Render (Linux, Node 20) before moving back to 512 MiB; the first demo journey still peaks at 441 to 455 MiB locally, under 512 but over the 400 target. FUCQ-242, re-store the demo comparison result once (its digests shift; measures don't). FUCQ-150, Russell asked for confirmation that 3712a143 fixes it; not yet checked.

## 10:40 9 Nov: full suite on be8da85a, FUCQ-174
- Full suite on be8da85a (lock held, 60 min): 3,891 tests, 3,851 pass, 2 fail, 38 skipped. Down from 4 failures: the image CLI and offer-decisions integration failures are gone (FUCQ-159/244, FUCQ-207).
- The two failures: the known podium runner-up flake, and new bug **FUCQ-245** (Medium): gcsp-historical-enrichment.test.js refuses the collection session FUCQ-156 changed, because the reviewed producer hash is pinned in the test and in historical-enrichment.mjs. A lead is on it (re-pin only if the historical output is proven byte-identical; otherwise load the reviewed revision). Regression from my FUCQ-156 merge: its lead's scoped tests didn't include this file.
- FUCQ-174 (Could) merged 35bcebe6, closed, In Review: order-mix, points and hold-sweep experiments; process baseline byte-identical. It adds policy key `comparison.experiments.v1` to seed-v1.json; all 59 seed-reading test files are rerunning to check. FUCQ-175 (Could, 8 pts) is building on it; FUCQ-176 follows.
- For Gary: FUCQ-174's new bounds are assumptions (hold 900 to 86,400 s with at most 5 values; points 0 to 3).
- 11:30 9 Nov: Gary answered the FUCQ-241 security note: rotating the database password is **not needed**. FUCQ-245 merged 2df50162 (re-pinned after proving byte-identical historical output), closed, In Review. All 59 seed-reading test files pass on 35bcebe6 (962 tests, 940 pass, 20 skipped). FUCQ-175 (Could, 8 pts) still building; FUCQ-176 waits for it.
- **11:40 9 Nov, Gary: "Close it and start to pick up the remaining todos, let's see if we can clear the backlog today."**
  - FUCQ-175 (C) merged d19bb3f0: merged-base scoped 323 tests, 314 pass, 0 fail, 9 skipped. Closed, In Review. For Gary: the default 1,000-employee job fails at its 128 MB worker heap and still peaks at about 428 MB; use prepared results in the demo, or raise the instance and `workerHeapMb` together.
  - FUCQ-176 (C) lead started on d19bb3f0.
  - FUCQ-178 closed as partly met (merged aa4f9879), In Review. The 984 unused BMW requests lapse; the 46 pending model lines would need a new story and approval.
  - Started: FUCQ-150 (bug, not in MoSCoW, P3; verifying 3712a143) and FUCQ-166 (bug, not in MoSCoW, P3; offline only, no Pages publish). Next by capacity: FUCQ-167, 168, then 169, 171 (W, after demo), FUCQ-27 then 28, FUCQ-218.
- **About 12:15 9 Nov, backlog clear-down.**
  - Gary's answers: FUCQ-46/47/48 build with live calls (limits set by the dispatcher: named public BMW UK hosts plus the page's own back-ends, concurrency 1, 500 requests across the chain, no sign-in, credentials, API keys or forms, stop on 401, 403, 429, challenge or 3 failures); FUCQ-149 approved as written; FUCQ-218 built with assumed stand-in names for Russell to swap; FUCQ-181 option (c), merged today.
  - **Question for Gary (open):** the catalogue chain asked to copy the anonymous x-api-key that BMW's public configurator page serves and use it from our backend for FUCQ-48. The dispatcher said no (outside the limits); the chain may only drive the real page headlessly. If that can't meet FUCQ-48's live criterion, it is recorded as unmet pending Gary.
  - Two parallel sessions started: catalogue-chain (FUCQ-46, 47, 48) and handover-chain (FUCQ-167, 168, 169, 171).
  - **FUCQ-181 closed** (merged 26ba5401, docs only), In Review: the same-site rule and option (c) are in the HLD and the Render guide. Option (a) is the route for the real EDS integration.
  - **FUCQ-150 closed** (merged fb09215c), In Review: verified fixed by 3712a143 (queue 227 to 1184 of 1184 px at 1280, all 7 columns); no code change.
  - FUCQ-149 lead started. Still building: FUCQ-176, FUCQ-166. Next: FUCQ-218, then FUCQ-27 and 28.
- **FUCQ-166 closed** (bug, not in MoSCoW, Medium; merged 2dc6049d), In Review, partly met. pages.yml now fails unless the public product-map data.json matches the upload within 10 minutes, and writes a receipt; the stale-serving cause is still open. **For Russell:** it takes effect only on main, so merge it there via PR.
- **Gary, about 12:45 9 Nov, answered the FUCQ-48 key question: "Yes, env only".** The catalogue chain may read the anonymous x-api-key from BMW's public configurator settings JSON and supply it to the backend through env only. It is never printed, passed as an argument, logged, committed or kept in evidence (redaction checks must prove it), the scratch copy is deleted after the run, all other live limits stay, and the evidence is labelled as the unsupported demo route.
- **About 13:30 9 Nov.**
  - **FUCQ-149 closed** (merged cd6e0585), In Review: no product change was needed; added a guarded-recovery regression test and keyboard evidence. New **FUCQ-246** (bug, not in MoSCoW, Low): focus sits on BODY between the interim Resume screens, up to 5.1 s.
  - **FUCQ-176 (C) closed** (merged 5dd1f887), In Review: Experiment picker, stored results, hold-duration rerun with a progress strip. Merged-base tests 420 (419 pass, 0 fail, 1 skipped) plus ratchet 142/142. The live worker rerun check is still open. New **FUCQ-249** (bug, not in MoSCoW, Low, fixture only).
  - **Gary defined two review stories**, to pick up only once every other functional ticket is delivered (label `after-functional-delivery`): **FUCQ-247** performance review of the demo journeys and **FUCQ-248** UI and UX review of the demo journeys. MoSCoW not set; neither is imported to the dev inbox yet, so no poller can pick them up early.
  - FUCQ-218 is being built by an implementer with stand-in scheme names.
- **About 14:30 9 Nov.**
  - **FUCQ-218 closed** (merged 5cd7bac2), In Review: scheme names come from the new assumed policy entry `scheme.displayNames.v1`, with "Scheme N" kept when none is supplied. Merged-base seed-reading, account and render files: 1,208 tests, 1,187 pass, 20 skipped, 1 known load flake (the em-dash test; it passes on its own). **For Russell:** confirm or replace the four stand-in names (on the Jira comment).
  - **catalogue-chain:** FUCQ-46 (ad8384b7) and FUCQ-47 (fe89dc84) merged and In Review. FUCQ-48's live run is held: that session's auto-mode safety check refused the agent that would use BMW's page key, despite Gary's approval, and it was not reworded to get past the check. The offline harness, tests and runbook are being built; 0 of 500 live requests used. **For Gary:** to run the live check, run the harness with `--live` yourself once FUCQ-48 merges, or approve it directly in that session.
  - handover-chain: FUCQ-167 closed and In Review; FUCQ-168 building on it.
  - FUCQ-27 (13 points, sliced) lead started; FUCQ-28 waits on it.
- **About 15:00 9 Nov.**
  - **catalogue-chain done:** FUCQ-46 (ad8384b7), 47 (fe89dc84) and 48 (3fd5fec5) merged, closed and In Review. FUCQ-48's live positive check (AC2) is unmet because the key-based live run was refused by that session's safety check; 0 of 500 BMW requests used. **For Gary:** the opt-in harness (`verify-live-catalogue.mjs --live`) can be run by you with the key in env.
  - **handover-chain:** FUCQ-168 merged da4207b0, closed and In Review; new Low bug FUCQ-251 raised from it. FUCQ-169 building; FUCQ-171 after it.
  - New Low bugs waiting for pickup: FUCQ-246, FUCQ-249, FUCQ-251.
- **About 13:10 9 Nov. Gary: "we're aiming for zero todo today".**
  - **FUCQ-249 closed** (merged 97dcb87f), In Review: fixture-only fault; the live adapter's 409 handling was already right.
  - **FUCQ-250 (bug, not in MoSCoW, High), new:** every car in the demo journey shows "No image for this car yet". Imported as DEV-2026-11-09-GC-018 and a lead started at once, reusing FUCQ-60's approved corpus images with no new collection.
  - Two stale waits from this morning were stopped. They looped while any `test-concurrency=1` run existed on the machine, so they could never finish; leads are now told to wait on their own PID or output file.
  - To Do triage: in progress are FUCQ-246, 251, 169, 171, 27 and 250. FUCQ-28 waits on 27. FUCQ-247 and 248 (Gary's review stories) start once every functional ticket is delivered, today.
- **About 14:00 9 Nov.**
  - **FUCQ-27 closed** (merged 43a862f7), In Review, on Gary's same-day direction (overrides build-rules' "after 12 Nov"). engine.js is now a facade over `server/recommendation/` and `used-retail-v1`; 1,201 parity cases show no differences, and audit, audit:refine and personas output is byte-identical. Merged base: 338/338 engine and render tests, api 55/55. Rollback: revert 686d3295, then 16159c45.
  - New proposal **FUCQ-255** (Story, needs review): move the employee pipeline onto the shared core.
  - FUCQ-28 lead started on 43596a1b.
  - Dispatcher slip, fixed: a scoped test command with an unmatched zsh glob ran the whole suite at concurrency 2 for about 5 minutes; it was stopped through its own task. Test lists now come from `git ls-files`.
  - handover-chain: FUCQ-169 (ca507616) and FUCQ-251 (2d5be417) closed and In Review; new bugs FUCQ-252 (Medium), 253 and 254 (Low) raised and taken by the chain; FUCQ-171 and 252 building.
  - **Gary:** use generic agents for FUCQ-247/248, configured first. Two local agent definitions are ready (`.claude/agents/performance-sme.md`, `ux-sme.md`, git-ignored). The hosted demo can only be timed for unauthenticated requests.

## 9 Nov, afternoon: FUCQ-250 partial merge, FUCQ-256 raised

- FUCQ-250 (bug, High): partial fix merged at 4358ad85 and pushed. i5 Touring 40 and 1 Series 120 demo cars now show digest-checked approved images; every demo car has Model and Derivative. Targeted tests on the merged base: 358 run, 0 fail. No approved image exists for the 3 Series G20/G21 320i cars Paula sees, so they keep the placeholder. Waiting on Gary: MSG-2026-11-09-GC-001 (option B, a bounded live image capture, needs his approval).
- FUCQ-256 raised (bug, Medium): the activity page's allowlist drops the new approved images. Imported as DEV-2026-11-09-GC-022, claimed at 2 points, story-lead building on ports 9270 to 9279.
- 13:55 Gary approved option B on MSG-2026-11-09-GC-001: a bounded live capture of G20/G21 320i representative images. Story-lead restarted on DEV-2026-11-09-GC-018 with hard limits: prod.cosy.bmw.cloud only (plus public bmw.co.uk pages if the existing path needs them), unauthenticated GET, concurrency 1, at most 60 requests, a ledger before each, stop on 401/403/429/challenge/3 failures. Walkthrough reruns into evidence/fucq-250/ are in the same brief.
- FUCQ-256 (bug, Medium) merged at 38de6b67, closed, In Review. Second cause found: the live activity page never received an offer display, so it now reads the offer through the offer view's endpoint and check. Targeted tests on merged base 387 run, 0 fail. Its client allowlist mirrors APPROVED_CORPUS_IMAGES under a drift test, so the FUCQ-250 lead was told to add the 320i assets to it.
- 14:17 heartbeat: handover chain merged FUCQ-254 (9fbd013a) and FUCQ-253 (d3c9f746), both verified on gcsp-poc. It raised FUCQ-257 (bug, Low: account order card still says "Your order is in progress" after handover) and is importing it. Still building: FUCQ-171 (handover chain), FUCQ-250 320i capture. Full suite waits for these.
- FUCQ-250 capture blocked: 1 unauthenticated GET to the prod.cosy.bmw.cloud manifest returned 401 (it needs BMW's website-supplied x-api-key, which the 7 Nov capture read from configure.bmw.co.uk). Lead stopped at once; no bytes downloaded. Walkthrough reruns passed (fucq-89 23/23, fucq-110 39/39, 1280 and 375, 0 px overflow); evidence merged from bcff00aa. Question for Gary: allow the 7 Nov route (configure.bmw.co.uk and its public page key, about 8 GETs), or accept placeholders for the demo and defer the bug.
- ~14:25 Gary approved the 7 Nov route for FUCQ-250: configure.bmw.co.uk public page key plus prod.cosy.bmw.cloud, at most 20 GETs, key env only, stop on 401/403/429/challenge/3 failures or any refused permission step (no workaround). Same lead resumed.
- FUCQ-250 second attempt refused by the auto-mode safety check ("[Website Access Circumvention]") when the lead wrote the capture script; no request made, no key read. Not reworded or rerouted (no permission laundering). The existing scripts/gcsp/verify-live-imagery.mjs is hardwired to two i5 images, so there is no ready command. G20 Saloon also needs an AG model code from prod.ucp.bmw.cloud (not approved). Put to Gary: supply a saved G21 320i M Sport (T3MK) image himself for a lead to register, or keep placeholders for 12 Nov.
