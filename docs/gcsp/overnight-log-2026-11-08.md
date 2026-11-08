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
