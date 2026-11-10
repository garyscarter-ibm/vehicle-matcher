# FUCQ-333: issued-offer acceptance after preference changes

Implemented on 10 November 2026. This is the separately authorised preference-only precedence refinement; FUCQ-106's original acceptance criteria and historical evidence remain unchanged.

## Cause and repair

The acceptance service compared the complete current preference and essential objects with the issued brief. Changing preferences therefore returned `conflict / brief-changed-review-required`. Reconfirming a brief also refreshes essential `confirmedAt` timestamps, so merely removing the preference comparison would still reject unchanged practical requirements.

Acceptance now compares essential field membership, value, operator, unit and confirmation state. It ignores source/confirmation metadata and the ordering of an `includes` list. The existing evaluator checks the exact held car against the latest confirmed brief, and current eligibility, allowance, driver/selection authority, declarations, hold, quote and expiry gates still run. The original offer and quote remain immutable. The decision retains latest and issued brief versions; the ordering receipt remains pinned to the issued terms. No migration is needed: a still-valid previously refused offer may retry.

## Regression and boundaries

The positive regression advances the clock by 120 seconds, changes preference value and importance, refreshes essential metadata and reorders unchanged required equipment. Acceptance succeeds with the original quote, both brief versions and a single idempotent decision/event. The runtime regression issues a genuine buddy offer, changes preferences, completes the actual declarations and accepts through private offer access and the real ordering service, with one allocation/order on retry.

Negative cases independently retain changed essential values, added/removed fields, charging, confirmation, operator and unit refusals. Existing suites cover authorization/ownership, current driver and policy eligibility/allowance, hold/quote expiry, wrong revisions, competing authority, declaration gates, decline and rollback.

Checks are scoped. The JavaScript affected selector did not support automatic selection, so explicit service/caller/presentation boundaries were selected. Retail, learning/training, collection, live PostgreSQL, deployment and a full suite are excluded because this change only adjusts the existing offer acceptance comparison. Integration with FUCQ-302's repository change requires a fresh run of these same callers.

## Checks and limitations

- Initial test setup failed because the isolated worktree lacked the locked `pg` dependency. `npm ci --prefix server --ignore-scripts --no-audit --no-fund` restored the existing lock without source/lock changes.
- The pre-fix FUCQ-333 positive regression failed with the exact brief-change conflict. The negative essential cases passed. The first green targeted run passed all three FUCQ-333 cases.
- Initial broader service run: 51 passed, zero failed, 12 skipped; 255.2 seconds. It completed normally before an attempted stop signal, so there was no interrupted test result. The 12 skips require the historical `FUCQ106_MODULE_MAP` supervisor; current actual runtime/order composition is independently exercised by the buddy test.
- Presentation boundary run: 147 passed, zero failed, two supervisor-only cases skipped. Those two require the historical finite105 decision supervisor. Controller, declarations, refresh, projection, rendering, focus and CSP checks passed.
- Strengthened decision suite: 28 passed with native coverage. A first added equipment fixture used a list where the existing evaluator expects a boolean map; that setup failure was corrected and rerun. No product fix was needed for it.
- The first integrated coverage run was interrupted after five minutes of post-test work: ten tests passed, nine file tasks were cancelled by that stop, and no completed suite result was claimed. The same scope then passed with `--test-force-exit` (13.9 seconds). Successful-log pruning retained the large coverage table but removed totals, so a final concise rerun records observable counts without a second coverage table. The final integrated result is recorded in `validation.json`.

No live deployment or hosted acceptance smoke check was performed. These results do not claim the live demo already runs the fix. No full-suite stamp or acceptance/Done transition is claimed.

## Review and unchanged UI

Shaggy independently reviewed the production diff, regressions and retained gates: code/security PASS, no blocking or major findings. Requested/selected reviewer model: `gpt-6.1-sol`, effort `high`, no fallback; effective runtime pair unverified. No descendants.

No UI source, component or token changed. The collaborator explicitly clarified that visual review is unnecessary for this change. Before that clarification, headless Chromium captured existing display fixtures with long content at 1440×1000 and 390×844: pending/unchecked, ready/checked, accepted, error, not-found, expired and loading. The JSON records declaration gating, keyboard acceptance, heading focus and order-progress destination. These are display-fixture evidence, separate from real backend journey proof. The harness's first static-server attempt failed before capture, was corrected, and its scratch was removed. A settled ready capture corrected a colour-transition timing artefact; this was not a product defect.

The existing shell/cards fit both widths; long names wrap, controls remain readable, and the accepted result identifies the order and leads to progress. The reviewer inspected the captures before the clarification. One incidental minor terminal-state recovery observation was recorded against existing linked backlog Bug FUCQ-332 for independent triage; it does not expand or block FUCQ-333. Desktop email wrapping is a small observation, not an acceptance blocker. No UI repair was made or claimed.

## Manual trial after an authorised deployment

1. Reset/start the normal demo scenario, sign in as the employee and obtain a still-valid buddy offer.
2. Change only preference values or importance and confirm; retain the issued offer/quote.
3. Reopen the issued offer, check its required declarations and accept.
4. Expect the accepted outcome and order-progress destination. Verify the original price/quote, latest/issued decision brief pins and a single order on retry.
5. Independently change a genuine essential or let the quote/hold expire: acceptance must still refuse. Do not mistake an expired or genuinely changed offer for the preference-only regression.

## Resource receipt

One test worker, serial bounded chunks, at most ten minutes/2 GiB scratch per test allocation. Headless Chromium used its own isolated profile/cache in supervised local scratch (bounded compatibility exception); no foreground app or browser focus was changed. Test/browser supervisors stop/join their process groups and remove owned scratch. Large output placement was not required; retained captures are approximately 2 MiB. `cleanup.json` records final verified paths, allocations and leftovers. Pre-existing shared dependencies and unrelated user files are preserved. The task-local dependency installation was removed with the merged disposable worktree by the configured cleanup helper.
