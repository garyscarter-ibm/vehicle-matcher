# Buddy subset preference correction — 11 November 2026

The reported symptom was repeated stock releases with no suitable Buddy car for Greg. The Account flow retained unanswered practical controls from the earlier brief editor. Their policy placeholders were being evaluated as unresolved employee requirements, so an otherwise suitable car could never become an allocation contender.

The originating Account capability is FUCQ-368 (`_dev/done/2026-11/DEV-2026-11-10-010.md`, commit `99affe71`); the retained editor defaults came from FUCQ-94. FUCQ-225 supplies the existing charging-consistency contract. This correction is directly authorised in the conversation; native Jira Bug creation/linking remains outstanding because no usable Jira connector was available. No Story acceptance or Jira status was changed.

## Resulting behaviour

- An untouched brief practical control is recognised only by the exact existing sentinel: `source: 'policy:brief.editor.v1'`, `state: 'needs-confirmation'`, `value: null`. It adds no optional employee requirement. Independent provider requirements and explicit employee unknowns still gate suitability.
- An untouched charging control preserves the source adapter's charging evidence. Known readiness can qualify a plug-in; unavailable charging blocks it; absent/unknown evidence still needs confirmation. Explicit employee answers and genuinely absent brief answers retain the previous behaviour.
- Untouched policy preference defaults remain draft on engagement and contribute no score. A selected midpoint uses the existing canonical medium importance of 50; an unset preference contributes no weight. No additional multiplier or product copy is needed.
- The same distinction applies to preview, allocation, local/remote hold validation, acceptance, case options, demand, policy-fit preview and future planning. Fresh and retained drafts are covered. Stored history, confirmed choices, consent, source profile data and pinned quotes are not rewritten.

The shared contract is documented in [shared-contracts.md](shared-contracts.md). No frontend files changed. The collaborator explicitly waived UI work/review for this task.

## Validation

Basis: branch `gcsp-poc`, base `1f88bb7882f46dc40c95ffd372aec4084345580b`, Node `v26.7.0`. Final server/test diff SHA-256: `7470a1a6760fae6478fac292160e4befd7d05e22ed44386480e8c7abb3c00d47`.

The narrow regression first reproduced the default-requirement failure. Tests then covered sparse save, preview and engagement for fresh/retained drafts; explicit and provider requirements; midpoint scoring; source charging readiness/unavailability/unknown; and a real runtime stock release, allocation, hold, offer and ordering acceptance with the current terms/declarations/mileage contract.

Scoped checks, with one test worker:

1. Primary selection: `employee-recommendation`, `gcsp-account-preferences`, `gcsp-buddy-engagement`, `gcsp-brief-editor`, `gcsp-allocation`, `gcsp-allocation-runtime`, `gcsp-buddy-hold` (`node --test --test-concurrency=1`). The run passed 182 tests, skipped one native PostgreSQL test and exposed an incomplete new acceptance-test invocation. Its test request was corrected to supply the actual current handoff contract; the corrected acceptance test passed. Three unrelated baseline failures were excluded by name.
2. Boundary selection: `gcsp-offer-decisions`, `gcsp-case-options`, `gcsp-case-journey`, `gcsp-order-plan-future`, `gcsp-greg-demand`, `gcsp-greg-publish`, `employee-feedback-evidence`, `employee-recommendation-feedback`, `gcsp-recommendation-stored-subject`, `gcsp-release`. Passed 200, failed one pre-existing case fixture, skipped one native PostgreSQL test.
3. Final complete `gcsp-allocation-runtime.test.js` rerun: **6 passed, 0 failed, 1 native PostgreSQL skip**, 64.51 seconds.

Four pre-existing failures were reproduced using unchanged HEAD server files in an isolated symlink overlay:

- Account rating and Same again tests expect scoring without the baseline now required by FUCQ-371.
- The old controller Save test expects separate search/hold consent, superseded by binary Buddy engagement.
- `gcsp-case-journey.test.js:108` posts `/brief/draft` to a server fixture lacking the `gcspBriefEditor` now required by the route. It fails before the changed suitability code executes (Medium test-fixture defect).

These failures were not repaired as part of this correction. Native Bug intake for them remains outstanding. Early test-fixture mistakes and failed exploratory checks are retained in the local run summary rather than reported as passes. The full suite, native PostgreSQL performance, live BMW adapters and the guarded FUCQ-106 supervisor were not run. The actual composed runtime hold/acceptance regression was selected instead of the stale compact-tick assertion in `gcsp-offer-runtime-composition.test.js`.

Independent review: Lord Business, requested/selected `gpt-6.1-sol` with `high` effort, no fallback. Final code verdict: **PASS, no blocking or major issues**. The separate case-fixture failure was also independently traced and confirmed against the baseline.

## Delivery and resources

Code commit `3d84a36b12af76b921f50742238dfc23d741e33c` was pushed to `gcsp-poc`. GitHub Render deployment `7722244049` for `gcsp-poc - gcsp-api` reported **success at 22:09:58 UTC on 11 November 2026**. The committed server diff exactly matches the tested SHA-256 above. No frontend deployment was required for this backend correction.

Hosted checks used an isolated Greg HTTP session and an unsaved three-category midpoint preview. Login, editor and preview returned `ok`; four untouched optional practical controls were present. The saved brief and brief/draft versions were identical after the first preview, and logout succeeded. No preference save, clock advance, reset or offer operation was performed.

**Live matching limit:** the hosted response contained zero candidates and reported `state: 'no-stock'`. The candidate-availability assertion therefore could not pass, so the hosted check does not prove matching or allocation with actual released stock. Those paths are proven by the local composed runtime regression above. A separate diagnostic probe of `/api/gcsp/manual/stock` returned 404 and supplies no stock evidence. Both actual attempt receipts are retained in `subset-preferences-hosted-first-summary.json` and `subset-preferences-hosted-summary.json`; no shared demo state was changed to manufacture a passing result.

Local evidence is retained under ignored `.claude/test-runs/`: `subset-preferences-plan.json`, `subset-preferences-20261111-summary.json`, per-test-file V8 observations in `impact/subset-preferences-*.json`, and ownership manifests in `subset-preferences-resources/ownership/`. Unobserved paths are not presumed covered.

Each chunk uses the existing resource supervisor, one worker, a 200 MiB scratch budget, 1 GiB RAM budget and a ten-minute limit. Temporary roots are manifest-owned `/private/tmp/test-stamp-shard-*`; finalizers stop/join children, release the host reservation, remove scratch and verify absence. No output reaches 256 MiB; no archive or browser profile was created. Final filesystem check: all 12 manifest-owned roots have state `removed` and are absent; summed measured chunk peaks were 45,956,144 bytes (43.8 MiB), with a largest chunk of 12,276,096 bytes (11.7 MiB). No scratch leftovers remain. Evidence summaries and impact observations are retained; no large-output compatibility exception was needed.
