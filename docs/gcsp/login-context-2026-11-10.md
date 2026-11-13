# GCSP email login and durable account context

> **Historical design record — 13 November 2026.** The [current architecture decisions](../design/migration-decisions-2026-11-13.md) and [replacement contracts](migration-replacement-contracts-2026-11-13.md) govern the Angular 21 / Java 21 / Quarkus 3.x target. Shared-password/HttpOnly-cookie login, unauthenticated presenter entry and acting-session issuance below are legacy only. Real test OIDC bearer JWT, individual employee/Greg logins, dedicated presenter login, owned signed-in offers and safe recovery/logout replace them. The material below retains its original source, implementation and acceptance evidence; this overlay does not amend a claimed Story's acceptance or prove replacement delivery.

Authorised by Russell on 10 November 2026 (FUCQ-322).

## Behaviour
People sign in with their own firstname.lastname@gcsp-demo.com address and the temporary shared password. Each existing live principal receives a surname and unique email while retaining employee/principal IDs. The same backend account supplies current vehicle, grade-based points allowance, preferences, offers and orders across every live page. Sign-out revokes the server session and clears the browser's identity context without deleting saved data.

Presenter simulation is separately owned: /gcsp-presenter.html remains accessible without employee login. Employee login grants no presenter capability; do not redesign presenter controls. Greg signs in to his scheme-lead role. Fixture gallery pages remain previews and never override a live account.

## Existing design boundaries
Extend the existing DemoIdentityAdapter component through an injected login port, and use the already-designed PostgreSQL TransactionRepository and PolicyService. No new external service/store or component connection is introduced. The login adapter authenticates a credential and returns a stable configured principal ID. The application resolves roles/scheme/employee details itself; browser claims never supply authority. A future sanctioned BMW adapter replaces the injected port.

Canonical configured people remain in PolicyService. Enrich their profile with a surname/email without mutating published policy history. Backfill existing employee records through the identity service, preserving contract/manualContext and saved briefs. Use existing full surnames when present; Paula's current configured surname is Mason. New missing surnames are explicit stable fictional assignments, not random on each boot.

## HTTP and sessions
POST /api/gcsp/session/login accepts only email and password under allowed Origin and the existing server gate, before the authenticated-route guard. Response is {status:'ok', value:{context,redirectTo}}; employee landing is /gcsp-account.html, Greg landing is /gcsp-greg.html (existing live registration must be checked).
POST /api/gcsp/session/logout revokes the supplied acting session in the repository and expires identity/offer access cookies as applicable. GET /api/gcsp/context continues returning server-owned context. Credentials/tokens never enter URLs or diagnostics. Login accepts case-insensitive trimmed emails and exact password.
An HttpOnly Secure cookie identifies the session. Keep explicit versioned session expiry behaviour; ordinary navigation never changes principal. HTML navigation to live pages must check that session (cookie Path covers pages) and redirect to /gcsp/login when absent/invalid; no silent employee/presenter bootstrap. Prevent cached identity reuse on logout/history restore and refresh already-open pages before exposing stale data.

## Persistence
Hosted composition defaults to PostgreSQL and fails explicitly when it cannot open; memory remains an explicit isolated-test option. Reuse currentRun on restart and existing profile records; fixture initialization must remain idempotent and never overwrite saved user edits. Existing PostgreSQL tables hold JSON records, so profile/backfill changes must match repository validation and preserve native SQL invariants. Test runtime reconstruction against an owned isolated PostgreSQL schema; disclose any unavailable external deployment evidence.

## Experience
Reuse COMPONENTS.md, shared shell and Density tokens. Login contains email, password and Sign in with concise validation, pending and failure feedback. Account menu includes Sign out and readable name/email. No synthetic/demo disclaimers in new on-screen copy, aligning the independently claimed FUCQ-321. Desktop/narrow, long content, validation, authenticated, sign-out and confirmation states require functional evidence and independent substantive visual critique; implement findings and inspect correction.

## Repeatable walkthrough

Start the same-origin host with PostgreSQL and open `/gcsp/login` (the existing environment access key may be requested first). The temporary password for each live account is `fucq`.

| Person | Login email | Landing |
| --- | --- | --- |
| Paula Mason | paula.mason@gcsp-demo.com | Your account and cars |
| Alex Brennan | alex.brennan@gcsp-demo.com | Your account and cars |
| Sam Patel | sam.patel@gcsp-demo.com | Your account and cars |
| Jordan Hughes | jordan.hughes@gcsp-demo.com | Your account, with no current car |
| Greg Lawson | greg.lawson@gcsp-demo.com | Demand and supply |

1. Sign in as Paula, open the account menu and confirm her name/email. Visit account, brief and activity through the rail; saved facts and allowance remain Paula's.
2. Save a preference, sign out, then sign in as Alex. Alex's account and grade allowance appear; Paula's saved preference does not appear.
3. Sign out, return to Paula and check the saved preference. Reload/restart the same database-backed host and repeat; records and run remain.
4. Open a second account tab. Sign out in the first; the second clears stale content and reloads through the login guard. Browser Back also re-enters through that guard.
5. Sign in as Greg and confirm the live dashboard and his own menu. Open `/gcsp-presenter.html` separately to use simulation controls without employee login. Opening it preserves the root employee cookie; signing in as an employee grants no presenter cookie.

Session expiry follows the existing versioned four-hour wall-clock policy. Expiry returns to sign-in; it never silently selects another person. Intentional Presenter Reset starts a new scenario/run and remains separate from server restart.

## Validation/resources
Use TDD for authentication and session boundaries. Selected scope: identity/login, host entry/cache/TLS, shell/account runtime, brief/account isolation and PostgreSQL restart. Existing affected selector is unsupported for this JS runner, so use explicit scoped commands with reasons; do not fall back to full suite. One test worker; bounded ten-minute chunks, <=2 GiB scratch and <=1.5 GiB child RAM. test_stamp.py owns test manifests, finalizers and TMP variables; browser/native-DB scratch has an external manifest, supervisor finalizer and absence receipt. Expected native DB/browser active scratch <256 MiB, retained captures <20 MiB. Large downloads/archives go straight to OneDrive. No production data resets or credential extraction.
