# FUCQ-439 connected shell proof, 18 November 2026

Script: `scripts/gcsp/fucq439-connected-shell-proof.mjs`. Source `36570ce7f`, base `931a59c5d`. Local mock OIDC issuer (Gary, 18 Nov: sign-on is mocked for the PoC), started Java API, native PostgreSQL 17, headless Chrome at 1280x800. Result: 8/8 scenarios, 87/87 checks, 94 s.

Captures and the JSON receipt are local only (this folder ignores non-Markdown files); rerun the script to regenerate them.

| Scenario | AC | Result | Checks |
|---|---|---|---|
| ac1a: Login and role landing for employee, Greg and presenter | AC1 | PASS | 21/21 |
| ac1b: Direct entry to a deep route survives sign-in | AC1 | PASS | 8/8 |
| ac1c: Refresh keeps route and session, no new issuer request | AC1 | PASS | 6/6 |
| ac1d: Denied states show no private body | AC1 | PASS | 9/9 |
| ac1e: Unavailable state with retry, recovery after the API returns | AC1 | PASS | 6/6 |
| ac2a: Expired access token renewed with the refresh token | AC2 | PASS | 8/8 |
| ac2b: Expiry without renewal restores page and saved progress, no automatic order | AC2 | PASS | 15/15 |
| ac2c: Sign-out clears app and provider sessions, a different account can sign in | AC2 | PASS | 14/14 |

Limitations recorded by the proof:

- The parent supplies prebuilt production web/API; input hashes do not independently establish their source revision.
- Every sign-on item is proved against a local mock issuer (code/PKCE, refresh grant, provider session cookie, end-session). The real hosted provider is not exercised.
- Access-token lifetime and refresh-token issue are issuer policy changed between scenarios, so expiry is real (short lifetime) rather than simulated in the browser.
- Only the upstream account, stock and one saved draft are seeded through Java and the run-owned schema; the unfinished order is made through the Angular controls.
- GET /context carries no displayName; the mock id_token supplies name and email for paula and greg and none for the presenter, so the header name comes from the Angular profile fallback.
- Chrome only, desktop viewport 1280x800; Safari and hosted deployment remain unrun.
- The outer supervisor owns HostBudget, manifest/finalizer, aggregate output/RSS limits and final process/listener/schema/scratch audit.
