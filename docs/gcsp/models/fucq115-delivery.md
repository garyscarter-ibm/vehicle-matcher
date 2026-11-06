# FUCQ-115 delivery evidence

## Independent optimizer checkpoint

Pluto reviewed the five new model/test files (329 lines), their imports and their
acceptance boundary. No production consumer imports them. Features use vehicle
attributes, confirmed categorical preferences, separate importance and confirmed
seat/boot spare capacity, plus missingness and the wait intercept. Code has no
runtime policy defaults, network or persistent-state effects.

Scoped command: `node --test --test-concurrency=1 server/test/gcsp-choice-model.test.js`.
Ran 6, passed 6, failed 0, skipped 0. Test duration 222ms; supervisor wall 0.585s.
Known-logit unit input: 4,000 seeded choices over three candidates plus wait, truth
`[0.7, -1.1, -0.4]`, coefficient tolerance 0.15, L2 0.0001. This experiment proves
optimizer recovery, not FUCQ-113 generator integration or BMW calibration. Other
checks cover analytic gradient central differences, extreme utilities, malformed
inputs, meaningful feature interactions and temporal/cohort leakage refusal.

Validation base: `fc1e283a079aa2ffe6e0a78fe74ba3002e7b9cda`; contract checkpoint
`dd9b334319b113f1285ad35527a6a69abbdf8407`. Tested file SHA-256 identities:

| File | SHA-256 |
|---|---|
| `server/gcsp/predict/model/features.js` | `36983ebd66dffa5bd79bbea6cf274232882a203572d174ffc0977787f9d54878` |
| `server/gcsp/predict/model/index.js` | `b10247d76b6afdd9b54b51d8edb453aeee4feeb09ed05dff5a5b0586aa10a0f3` |
| `server/gcsp/predict/model/optimizer.js` | `f7dee4b01895f1e4d0f2d3c335fe657cb44ac3eefd5cd3fb43e67e47b15c9e1b` |
| `server/gcsp/predict/model/split.js` | `7865dcb3c41921f5598918db268860ee68c5ab4b20a2577c393f3c86cd80b154` |
| `server/test/gcsp-choice-model.test.js` | `bb4c20cfde030163603f60c6ad65d9c6ec888ca5fe7f6d340eb562d2d6c9b0e4` |

Resource receipt: `_tools/test_resources.py`, one worker, 120s/768MiB/128MiB/2MiB
bounds. Sampled peak RSS 21,970,944 bytes, scratch 0 bytes, retained log 735 bytes.
External manifest:
`.claude/test-runs/fucq115/ownership/fae9f98d2d3e4ec4a2eae16721b873af.json`.
Owned `/private/tmp/test-stamp-shard-fae9f98d2d3e4ec4a2eae16721b873af` removed and
host reservation absent, both checked after stop/join. Checkpoint and concise
summary: `.claude/test-runs/fucq115/optimizer-v1-summary.json`, impact selection
`impact.json`. Two launcher setup errors (wrong unit field/path before allocation)
were corrected; neither allocated a test child. No filesystem leftovers or large
output exception. Database aliases, NODE_OPTIONS and debug/trace environment were
removed from the offline child.

Remaining gates: reviewed source import; meaningful actual generated dataset;
actual expressed-demand and deterministic-fit baselines; computed held-out metrics;
immutable artifact and safe panel fixture; canonical key adoption and dated model
publication/historical reads; authored CLI and final root-granted full validation.
No full stamp, live producer, corpus delivery or story completion is claimed.
