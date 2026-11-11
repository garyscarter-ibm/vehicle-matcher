# FUCQ-381 — use the employee's points allowance

Authorised 11 November 2026. The collaborator confirmed: prioritise points usage **among similarly well-matched cars**. Native Bug FUCQ-381 relates to the verified originating Story FUCQ-29. No original Story acceptance criteria changed.

## Diagnosis and change

The employee service used points only as an affordability gate. Its preference-score/UUID ordering did not reward saving points, but also gave no benefit to consuming the allowance. A focused regression reproduced 800 points ahead of 1,200 points at identical preference fit; the corrected result reverses that order.

The canonical `employee.recommendation.v1.ranking` setting now defines `similarFitThenPoints`, with a five-point fit tolerance. Bands anchor to their highest preference fit; within each band, monthly points descend, then preference fit and UUID break ties. All eligibility, essentials, charging, timing and affordability gates run first. Saved results, unsaved previews and feedback share the helper. Preference percentages remain unchanged. Older policy pins without the setting retain their original order. Employee allocation's separate renewal/fit/lottery policy is unchanged.

The real preview calculation in the retained `computed-order.json` capture returns:

| Order | Monthly points | Preference fit |
| --- | ---: | ---: |
| First | 1,200 | 96 |
| Second | 800 | 100 |
| Third | 1,300 | 63 |

These are small synthetic test inputs through the actual PolicyService, snapshot, gate and scoring services, not a named-employee winner override. The render uses the actual brief/shell/card modules with an explicit fixture transport. It proves rendering and calculation together; it does not prove deployed PostgreSQL or a real BMW integration.

## Scoped validation

The affected selector reported that automatic selection is unsupported for the configured Node runner. Explicit supervised scoped commands were selected after reviewing the recommendation, feedback, preview, terms, policy and allocation boundaries. No full suite was run: this change does not modify retail scoring, allocation fairness, stock transactions, holds, offers or external adapters.

| Check | Result |
| --- | --- |
| Employee ordering, recommendation service and feedback | 50 passed |
| Brief rendering and plain copy | 32 passed |
| Recommendation HTTP, stored subjects, PolicyService and preview transport | 46 passed |
| Frozen retail contracts/reference corpora | 168 passed |
| Separate TASTE_SHARE subprocess parity | 1 passed |
| Real browser, 1280/375, recommendation/empty/unavailable/read-only states | 8 state/width checks passed; no browser exceptions or horizontal overflow |
| Impeccable detector, changed JS targets | No findings |

The new behavioural and badge regressions failed before their fixes. An initial test could not load the missing locked `pg` dependency; `npm ci --prefix server --ignore-scripts` installed the declared dependency without running the fleet build. A price-plan test fixture initially overlapped the existing plan and was corrected before the behavioural RED result.

The HTTP module passed its assertions on Node 26 and bundled Node 24, but held its isolated test worker open; both runs were stopped and cleaned rather than reported as passes. The complete 46-check boundary command then passed on bundled Node 24 using `--test-isolation=none --test-force-exit`. One combined retail check exceeded its supervised RAM reservation after 203 assertions; splitting it into the two bounded commands above completed all planned retail checks. No skipped/cancelled attempt is counted as a completed check. Browser-fixture calibration and screenshot-selector/framing errors were corrected before the successful capture.

## Rendered critique and rollout

The launcher inspected desktop/narrow captures, long vehicle names, the points/allowance line, eligibility and trade-off disclosures, selected practical answers, failed-save feedback, empty/unavailable results and the accepted/read-only page. The new badge wraps below long names at narrow width, remains prominent at desktop width, and says **Recommended** instead of falsely claiming the highest preference fit. Existing controls, hierarchy and action placement remain usable. The desktop/narrow screenshots, full state captures and `browser-observations.json` are retained in the external evidence directory below.

The collaborator explicitly waived independent visual/design review on 11 November 2026 because this is backend tuning. The launcher inspections above remain supplementary evidence for the small recommendation-label correction. No agents were spawned: the machine-wide capacity check returned `can_start=0` (9–12 active agents), and no capacity exception was assumed.

No deployment, live policy publication or reset was performed. Newly seeded/reset runs after deployment read the tuned seed. An already persisted run needs an explicitly published successor or collaborator-authorised reset; existing offers keep their quote. HLD component/store/connection boundaries are unchanged.

Run/impact/cleanup receipts are retained under `.claude/test-runs/` on the launching machine. Headless Chrome and the private static server close in `finally`; every test command uses `test_stamp.py` ownership manifests, reservations, bounded chunks and scratch cleanup. No archives or outputs approaching 256 MiB were created. Installed dependencies are retained.

## Retained artifacts

The 12 PNG/JSON captures (2,429,038 bytes) are stored outside Git under the project evidence policy:

```text
/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/_agent-output/fucq381-2026-11-11/
```

Open `1280-recommendations.png` or `375-recommendations.png` for the inspected cards; `computed-order.json` and `browser-observations.json` contain the calculation and browser results. `manifest.json` lists the SHA-256 and size of every file. Destination hashes were verified before removing the repository copies. This verifies the local retained copy; OneDrive upload/sharing was not verified.

Manifest SHA-256: `89562a1dccb92bb2336776e8ac0e18727b2e6f8ba0cdf49993d7553b03db548c`.

Final cleanup receipt: `.claude/test-runs/fucq381-final-receipt.json`. All 19 owned scratch roots were verified absent and their owners had exited; no task scratch remains. The headless Chrome working-profile exception peaked at 7,004,308 bytes locally. Observed scratch peaks across the sequential attempts totalled 29,827,918 bytes, now removed. Successful verbose logs were compacted to the receipt; checkpoints and the code/test impact map are retained.
