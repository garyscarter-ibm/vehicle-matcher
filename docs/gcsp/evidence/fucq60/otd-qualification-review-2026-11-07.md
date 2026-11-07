# F60 retained OTD qualification review

Date: 7 November 2026. Source: F60. Reviewer: Charlie Dog (Codex, requested Sol/high; no fallback).

Reviewed `e073f43d..e08d8b26` in `DEV-2026-11-04-036`, including the qualifier, enrichment integration, frozen adapter mapping, tests, retained runner and committed receipts. This was a code and security review only: no tests, source traffic, scratch or descendants. It does not independently reproduce the producer's test receipts.

No Critical/High issue was found. The qualifier checks the accepted-line hash, retained artifact hash/size, registration, request URL, source context and approved mapping digest. The evidence distinguishes absent source units from units and meanings supplied by the existing approved reference-code mapping. The adapter's four mappings are unchanged, and enrichment writes a detached output rather than the accepted catalogue.

## Deferred findings

### P2: technical options can substitute the session-owned row or artifact

At `scripts/gcsp/enrich-fleet.mjs:396` in `e08d8b26`, `{ artifact, accepted: record, ...input.technicalOptions }` permits `technicalOptions.accepted` and `technicalOptions.artifact` to replace the row and artifact supplied by the collector. Validation admits any object for these options. By code reasoning, a caller can enrich accepted row A while supplying a separately valid row B, B's retained artifact, registration and matching pins in the options. The qualifier validates B; its known facts are then assigned to A's output. Supplying only an overriding artifact also bypasses binding to the actual artifact returned by the accounted operation.

Actual impact is a correctness gap in the optional trusted local API, not an observed live substitution or public-input exploit. The only controlled production-like caller at this revision is the retained evidence runner, which passes exactly `registration` and `pins`; that pinned run is unaffected. No HTTP/public caller was found. A separate Bug should allowlist those two option fields or place session-owned fields last, with a substitution regression during that Bug's pickup. No fix is included here.

Disposition: deferred below High under the standing delivery policy. Native linked backlog Bug pending: Jira authentication is invalid, so no issue key or successful Jira write is claimed. Link the eventual Bug to FUCQ-60 and this review.

### P3: an all-unknown technical result changes the completeness flag

At `scripts/gcsp/enrich-fleet.mjs:400-401` in `e08d8b26`, the recalculation selects `complete` or `partial` only. If all four mapped technical values remain unknown and body length is also unknown, the prior `unknown` measurement completeness becomes `partial`. Individual facts remain unknown with null values; this does not invent a measurement. The retained controlled run has four known measurements and is unaffected.

Disposition: deferred below High. Preserve the all-unknown `unknown` flag in a separate Bug. Native linked backlog Bug pending the same Jira authentication repair; no issue key or successful Jira write is claimed. Link the eventual Bug to FUCQ-60 and this review.

Original F60 acceptance criteria and status remain open and unchanged. This review authorises no source traffic, runtime publication, scope expansion or acceptance transition. No disposable allocation was created; there is no review scratch to remove.

VERDICT: passed
