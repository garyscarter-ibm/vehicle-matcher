# Actual first32 source batch — 7 November 2026

Completed in 23.639 seconds using 36 serial actual GETs and 1,048,876 decoded bytes: 28 new distinct admitted configurations, 4 source-not-constructible rejections and 0 duplicates. Together with the earlier admitted row, source-qualified capacity is 29. Target 32 was unmet, so this batch correctly remains incomplete (`queue-exhausted`); F61 is not accepted.

`collection-plan.json` and `execution-plan.json` pin the exact requests, generic collector code and producer identities. `execution-once.json` is permanently spent and must never be reset or replayed. `outcome-index.json` includes all 32 attempted requests, including the 4 rejections.

For F62 restoration/publication, use `collector-state.json`, `accepted.jsonl`, fresh `tree.json`/`options.json` and `solver/*.json` with the immutable producer pins and snapshot version in `execution-plan.json`. The existing collector, binder and catalogue adapter restore these actual source registrations; `run-live.mjs` records their original composition. Source capture does not itself prove F60 enrichment, application publication or demo acceptance.

`receipt.json` records actual source counts, bytes, canonical coverage and checkpoint hash. `resource-receipt.json` records scoped offline artifact verification, observed timing and filesystem cleanup. No raw settings, raw response bodies, credentials, source writes, images or browser interaction were retained/performed. Rejected response hashes/bodies are honestly absent after refusal; their source attempt/status, bytes and checkpoint outcomes remain recorded.
