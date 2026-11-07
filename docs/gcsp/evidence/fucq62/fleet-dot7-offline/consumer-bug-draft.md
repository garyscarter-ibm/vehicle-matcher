# Bug draft: configured consumer rejects documented empty mandatory elements

Severity: Medium. Origin: F63 consuming port / F62 actual .7 reconciliation. Native Jira filing pending in root session. This Bug is independently deferred; it does not expand the current Story or waive acceptance.

The actual admitted 1F7A and 1F7C modelpilot configurations return the correct partial DTO through the lookup and HTTP boundary, but `createConfiguredVehicleDetails` returns `source-unavailable`. `safeV2SourceReference` in `server/gcsp/vehicle-evidence/application-vehicle-details.js` rejects a present empty `mandatory-elements=` query value. The admission contract deliberately supports this documented empty value; actual 1F7D and 1F7F with nonempty values are unaffected.

Impact: 2 of 1,135 configured-consumer requests fail. The other 1,133 consumers pass; all 1,135 direct lookup DTOs match retained rows and the manifest. The all-record consumer gate remains failed.

Exact retained reproductions:

- Model `1F7A`; configuration ID `MUY3QTpGS1VTVyxQMEM2UixTMDFDQixTMDFDRSxTMDFERixTMDFIMixTMDIzMCxTMDJQQSxTMDJURixTMDJWQixTMDJWRCxTMDMwMixTMDQyOCxTMDQzVCxTMDQ3OCxTMDQ5NCxTMDUzNCxTMDVBUyxTMDVBVixTMDVETSxTMDY1NCxTMDZBRSxTMDZBRixTMDZQQSxTMDc2MCxTMDgxMixTMDg1MCxTMDg1MyxTMDg4SyxTMDhLQSxTMDhSMyxTMDhSOSxTMDhTTSxTMDhURixTMDhURw==`.

- Model `1F7C`; configuration ID `MUY3QzpGS1VNWSxQMEM1NixTMDFDQixTMDFERixTMDFINSxTMDIzMCxTMDJQQSxTMDJURSxTMDJWQixTMDJWRCxTMDJWRixTMDMwMixTMDNNMSxTMDQyMCxTMDQyOCxTMDQzWixTMDQ3OCxTMDQ4MSxTMDQ5NCxTMDUzNCxTMDVBUyxTMDVBVixTMDVETSxTMDY1NCxTMDY3NCxTMDZBRSxTMDZBRixTMDZQQSxTMDc1NCxTMDc2MCxTMDc3NSxTMDgxMixTMDg1MCxTMDg1MyxTMDg4SyxTMDhLQSxTMDhSMyxTMDhSOSxTMDhTTSxTMDhURixTMDhURyxTMDlUMSxTMDlUMixTMDlUQSxTMDlUQg==`.

Reproduce without live traffic using the retained .7 isolated store and `diagnose.mjs`. The immutable original audit failed with `active-reconciliation-failed`, 1,135 checked and 2 errors. `diagnose-receipt.json` retains the exact accepted rows, source citations, direct DTOs and failing consumer outcomes.

Evidence:

- `/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/fleet-dot7-offline-20261107/diagnose-receipt.json`
- `audit-summary2-results.json` separates lookup parity from consumer failure.
- Original failed command and cleanup: `/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f62/fleet-dot7-offline/audit/`.

Future Bug acceptance: safely accept the documented present-empty mandatory-elements form; preserve rejection of malformed source references; verify both retained actual configurations through the configured consumer. This increment makes no consumer repair.


## .8 measured impact — 7 November 2026

The immutable .8 offline preparation adds 790 audited admissions. The actual configured-consumer audit now passes 1,456 and fails 469 of 1,925 requests: 144 `1F7A` and 325 `1F7C`. All 1,925 direct lookup DTOs match retained records and manifest; all 1,925 HTTP responses match in the exact 1,024/901 union. Every consumer failure has the same present-empty `mandatory-elements=` citation and `source-unavailable` result. The strict report remains `invalid-active`, 469 errors. This expands the measured impact of this existing defect; it does not create a new Bug, claim a repair, waive ACs or establish acceptance. Parent retains the specifically authorised Medium deferral. Native Jira key remains unverified; no duplicate creation attempted.

Evidence: [summary](../fleet-dot8-1923-offline/summary.json), [strict report](../fleet-dot8-1923-offline/strict-audit-report.json), [DTO/consumer diagnosis](../fleet-dot8-1923-offline/diagnose-results.json), [exact HTTP union](../fleet-dot8-1923-offline/http-complement-results.json).
