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
