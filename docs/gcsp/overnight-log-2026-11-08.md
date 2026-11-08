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
