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
