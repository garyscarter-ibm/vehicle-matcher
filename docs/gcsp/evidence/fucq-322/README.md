# FUCQ-322 login and durable user context

10 November 2026. Authorised scope and repeatable walkthrough: [login-context](../../login-context-2026-11-10.md). This is a medium cross-cutting extension of the existing identity, account and repository services. It replaces automatic Paula impersonation with email/password authentication through an injected adapter. BMW sign-on itself remains future work.

## Delivered behaviour

- Configured people retain stable IDs and receive full names and `firstname.lastname@gcsp-demo.com` addresses. Existing account contracts, saved preferences and entitlement records survive profile backfill.
- The server owns identity, roles and landing destinations. An authentication adapter returns a configured principal ID; adapter-supplied role claims confer no authority.
- A root HttpOnly Secure cookie covers live HTML and API requests. Login receives only email/password. Logout persistently revokes the acting session and expires current and legacy cookie paths.
- The shared shell displays the stored name/email and Sign out. Session changes clear existing tabs and discard delayed responses; history restoration passes through the server guard.
- Greg's landing uses the HTTP adapters and the same trusted session. His pre-registration adapter survives custom-element upgrade.
- The presenter entry issues its separate control cookie without selecting an employee or changing an existing employee cookie. FUCQ-324 owns the remaining presenter separation/redesign.
- Hosted configuration selects PostgreSQL and fails explicitly without database configuration. Explicit memory mode remains available for isolated tests.

## Selected validation

Affected-test selection is unsupported for this JavaScript runner. Commands are explicit scoped selections, with one worker at a time. Retail, matching algorithms, large fleet collection and unrelated business suites are excluded because this change reuses their interfaces. No full-suite result is claimed.

Before integration, the stable backend selection passed **59/59**, no failed/cancelled/skipped checks, in 47.8 seconds. It covers login/identity, Origin and access authority, host/cache/TLS, durable runtime defaults and account/brief consumers. Shared local record: `.claude/test-runs/targeted-7f3ba0a7e8e5470b3d0a6fc0929279aa29663767160a61b008348f2c716c1b37-default-1794311332495897000.json`.

The scoped frontend run passed 256/257 before its exact source whitelist was updated for the new session guard. The corrected shell/startup selection passed **46/46**, zero failed/cancelled/skipped, in 7.1 seconds. CSP/external modules and no URL-selected state remain enforced; only the single invalidation reload is permitted. Integrated-base selection remains pending.

Native PostgreSQL 16.15 restart proof passed **1/1**, zero failed/cancelled/skipped. It writes distinct Paula/Alex records, saves Paula preferences/odometer, revokes Paula, stops/restarts the actual database and reconstructs the application. Revocation persists; Alex's session and Paula's re-login restore their own stored records. A separate connection verifies JSONB name/email. [Test result](postgres-restart-test.log) and [source/resource receipt](postgres-resource-receipt.json) retain the exact tested source hashes and cleanup. This is local native PostgreSQL evidence, not a deployed Render proof.

The pre-upgrade Greg regression failed before its correction (0/1), then passed with the adjacent element case (2/2). Login and stale-startup regressions also have recorded red/green evidence. Earlier broad/diagnostic runs with changed code or interrupted lingering HTTP handles are not stable final evidence. The final commands use `GCSP_OFFLINE=1`, serial Node test workers and `--test-force-exit` after completed assertions/teardown.

The painted-copy check exempts complete addresses only at the collaborator-requested `gcsp-demo.com` domain. Standalone demo wording, other domains and deceptive domain suffixes remain rejected. This implements the explicit 10 November email decision; it does not weaken the disclaimer ban.

## Rendered browser proof and independent critique

Headless isolated Chrome, actual HTTPS host, 1440 × 1000 and 390 × 844 viewports: **8 scenarios passed**, **18 captures**, zero uncaught page errors or horizontal overflow. Every capture asserts one portal header and settles fonts, frames and finite animations. [Browser summary](browser-summary.json) records the checked states and screenshot hashes; [resource receipt](browser-resource-receipt.json) records cleanup.

States inspected: blank login, required-field and malformed-email validation, wrong password, pending sign-in, Paula account/menu, failed sign-out, second-tab invalidation, browser Back, Alex identity replacement, Jordan without a current car, Greg identity/unavailable data, and a realistic long name/email with keyboard disclosure. [Reviewed source hashes](reviewed-code-identity.json) identify the source at capture time.

Assessment A: Pussyfoot, requested/selected `gpt-6.1-sol` / `high`, no fallback. Independent substantive inspection of all 18 captures plus source and interaction evidence: **33/40**, no remaining actionable scoped finding. Form proportions, hierarchy, validation/focus, empty state, readable identity and action placement were assessed. Assessment B: Taz, requested/selected `gpt-6.1-sol` / `medium`, no fallback; one detector run over nine explicit targets returned no primary/advisory findings. B's independent image/source inspection agreed with A. No descendants.

The parent inspected the actual corrected desktop credential-error and narrow pending renders, narrow validation and long identity, desktop sign-out error and Greg layout. The early duplicate-header capture anomaly is absent in settled recaptures; this was a capture issue, with no second mount in the application. No code change was needed for that anomaly.

The long-name case projects only account presentation to exercise wrapping; it does not create a persisted person. The isolated browser runtime intentionally omits operational stock/ordering providers: Greg's demand/orders unavailable presentation is evidence for identity and error layout, not successful operational demand or ordering integration. The owned native database proof separately establishes durable user data.

## Actual unsuccessful attempts and limits

- First native PostgreSQL attempt built successfully but the new proof omitted `CREATE SCHEMA`, so runtime opening failed `database-unavailable`. The proof now creates its own schema; this was test setup, not a production database fault.
- First browser attempt assumed an account remained in history even though both login/logout replace it. The corrected proof creates an in-session history entry before signing out.
- Browser attempts two/three exposed Greg's lost pre-upgrade adapter. The constructor preservation and regression correct that application fault; the final browser proof passes.
- Earlier assertion failures expecting automatic Paula bootstrap were updated to require explicit login; interrupted diagnostics are superseded, not reported as clean runs.
- No live BMW SSO, hosted PostgreSQL configuration or deployed Render restart has been verified. Applying/pushing the Blueprint does not establish that its environment changes took effect.

## Independent backlog findings

Two Medium product findings are separately captured and linked, with browser reproduction still unrun: **FUCQ-342** (some named visual fixtures expose live Sign out) and **FUCQ-343** (pre-existing offer BFCache disposal can restore a blank page). Neither is claimed fixed. FUCQ-343 is linked to its originating FUCQ-105 and discovery FUCQ-322. They do not expand or block this Story under the shared delivery policy. Vehicle-image gaps remain separately owned by FUCQ-323. **FUCQ-344** separately records a pre-existing validation-quality fault from FUCQ-321: the painted-copy test activates hidden presenter Tick controls after failed initial read and calls the wrong catalogue service. Its two JSDOM errors do not demonstrate a reachable product fault; the affected presenter-state coverage is not claimed. Other explicit email-ban cases and the final browser proof remain valid. No production presenter change is included.

## Resources and integration

Browser working data used a run-owned isolated local profile/TLS exception: peak scratch 7,120,156 bytes, peak process RSS 295,665,664 bytes. Browser/app closed and scratch absence verified; 1,605,464 bytes of actual screenshots retained here. Native PostgreSQL cloud source/build peak was 256,180,322 bytes and local runtime/database peak 70,066,788 bytes; maximum build RSS 237,109,248 bytes. The checksum-verified source/archive were built directly under OneDrive. The bounded active native runtime/database/socket used an owned local compatibility exception. PostgreSQL stopped with exit 0 and both cloud/local roots are verified absent in the retained receipt. Test-stamp chunks also verify scratch removal; integrated final chunk receipts remain pending. No production database was accessed or reset.

Integration commit and final Jira state: pending. Development completion and In Review do not constitute collaborator acceptance or Done.
