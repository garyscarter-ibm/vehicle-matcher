# GCSP email login Implementation Plan

> For agentic workers: use the current session's scoped implementation tasks; preserve ownership and selected verification.

**Goal:** Signed-in employees use their own durable backend records throughout the live site.

**Architecture:** Extend the existing identity boundary with an injected login adapter. Reuse cookie-scoped account/brief consumers and the PostgreSQL repository; keep presenter redesign independently owned.

**Tech Stack:** Node ES modules, native crypto/http, existing pg, vanilla JS/CSS, JSDOM, headless browser.

**Spec:** docs/gcsp/login-context-2026-11-10.md

## Global Constraints
Read AGENTS.md, build-rules.md, experience-quality.md and COMPONENTS.md. No new runtime dependencies; no inline scripts/handlers/eval; no on-screen em dash; preserve stable IDs and existing data. Do not claim full acceptance from integration merge. Keep unrelated files and other claims unchanged.

## Task 1: Authentication and durable profile (parent)
- [x] Add regression tests for real login rejection/success, injected adapter replacement, all configured email identities, legacy profile backfill and role refusal.
- [x] Implement server/gcsp/identity/login-adapter.js and extend identity/index.js: signIn(credentials,commandId), signOut(cookie), persistent profile enrichment, session revocation. Keep authenticate port independent of application routes.
- [x] Extend identity/http.js for login/logout before/around its existing guards and expose only safe context/landing path.
- [x] Run scoped identity/login tests through test_stamp; record red/green evidence.

## Task 2: Login screen and shared sign-out (Taz, Sol/medium)
- [x] Add meaningful DOM interaction tests covering validation, pending/error, success redirect, account sign-out, long name/email and keyboard labels.
- [x] Create gcsp-login.html plus blocks/gcsp/login view/controller/harness and styling using shared controls/tokens.
- [x] Extend shared portal-shell menu with Sign out and email; clear view before navigating after successful revoke.
- [x] Consumes POST /api/gcsp/session/login {email,password} -> {status:'ok',value:{context,redirectTo}}; POST /api/gcsp/session/logout {} -> {status:'ok'}.
- [x] Preserve presenter and fixture behaviour via explicit options; no presenter redesign. Parent owns host routing and persistence.
- [x] Run selected DOM tests, update COMPONENTS.md only for shared API changes.

## Task 3: Host, session and PostgreSQL integration (parent)
- [x] Test live-page redirects, authenticated routing, no employee presenter grants, logout/history, and presenter page accessible without employee login.
- [x] Update host/runtime composition and Render configuration to durable PostgreSQL without memory fallback.
- [x] Validate a real native PostgreSQL reconstruction with unchanged saved profile/preferences and user isolation. Any installation/download is owned and bounded, no production DB access.
- [x] Review account/brief/current-vehicle callers and remove any active-path fixed identity assumptions in scope.

## Task 4: Verification, independent critique and delivery
- [x] Run scoped regression plus UI ratchet; refresh compact file/function-to-test impact evidence keyed by code identity.
- [x] Inspect rendered desktop and narrow login/account states, long content, validation and sign-out; reviewer independently critiques proportions/hierarchy/identification/controls/actions/feedback.
- [x] Correct actionable findings and inspect again; preserve real failures/skips/unrun deployment checks.
- [ ] Commit/push each coherent validated checkpoint with Codex trailer, update product-map/Jira In Review when acceptance evidence supports it, integrate through project helpers.
- [ ] Stop owned processes, remove scratch and verify absence; retain bounded evidence/cleanup receipt.
