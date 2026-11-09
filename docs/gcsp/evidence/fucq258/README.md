# FUCQ-258 browser evidence: Greg's remedy options with charging unconfirmed

9 November 2026. Bug DEV-2026-11-09-GC-024 (FUCQ-258), observation 3 of `../fucq-110/fucq171/README.md`. Greg's options read used to answer unavailable when any car yielded the unknown `charging-unconfirmed`, so Greg saw no remedies.

- **Runner:** `browser-capture.mjs`, trimmed from the FUCQ-171 runner to its T6 world. The one change to that setup is Paula's brief: it confirms seats only, so charging stays unconfirmed. Real memory runtime, `buildServer` and the demo stock over loopback HTTP on `127.0.0.1` ports 9130 and 9139 (Chrome CDP). No live external calls, no PostgreSQL.
- **Run:** `FUCQ258_SCRATCH=<owned dir> FUCQ258_CHUNK=desktop|narrow node docs/gcsp/evidence/fucq258/browser-capture.mjs`, one viewport per run, about 40 seconds each.

| Run | Result | Checks | PNG |
|---|---|---|---|
| 1280 (`results-1280.json`) | passed | 14/14 | `browser/1280-01-greg-options-charging-unconfirmed.png` |
| 375 (`results-375.json`) | passed | 14/14 | `browser/375-01-greg-options-charging-unconfirmed.png` |

**What it shows:** Greg opens Paula's case with the keyboard and the options load ("Current case options loaded."). The remedy select offers five alternative cars, "Change body" and "Manual decision". The API read answers 200 with `preferenceRelaxations.available` true. No overflow, no em dashes, no console errors.

**Not shown on screen:** the demo stock's one EV also has a blocker, so it is left out as unsuitable and not listed as needing confirmation. In this world `needsConfirmation` is empty. The "Cars that need confirmation before they can be proposed" list, with its reason "Charging access not confirmed", is covered by the DOM test `FUCQ-258: cars needing confirmation are listed ...` in `server/test/gcsp-case-views.test.js`, not by a screenshot.

**Before the fix:** the same setup returns 503 `unavailable` from the options route. The e2e test `FUCQ-258: with charging unconfirmed, a help case after a declined offer still gives Greg feasible options` in `server/test/gcsp-lifecycle-e2e.test.js` fails on the old code for this reason.
