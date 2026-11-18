# FUCQ-438 independent releases and final-switch hand-over

Story DEV-2026-11-13-006 (FUCQ-438), branch `dev/DEV-2026-11-13-006`, 18 November 2026. Built and proved locally under
Gary's 18 November ruling: the Render dev environment does not exist yet, so the hosted check below is Gary's
end-of-build review, not a blocker. Sign-on uses the local labelled mock OIDC issuer; email delivery is not exercised.

## 1. Independent releases stay compatible (acceptance item 1)

**Proof:** `scripts/gcsp/fucq438-release-proof.mjs`, final run `f438-final` on commit `fb603d49a`, 18 Nov 16:00 UTC,
**6/6 phases PASS**, teardown clean. Summary: `docs/gcsp/evidence/fucq438/README.md`; the compact JSON receipt
(SHA-256 `d7aea05a…`) stays in local evidence under `.claude/test-runs/fucq438/`, as evidence policy keeps only Markdown.

It runs real builds as real processes: two prebuilt Quarkus jars on native PostgreSQL 17 (one throwaway schema),
two compiled Angular bundles assembled with the HEAD `scripts/build-gcsp-static.mjs` and one shared public runtime
config, a static host emulating the Render fixed and named-placeholder rewrites, the local OIDC issuer (code + PKCE,
signed JWTs verified by Java) and headless Chrome.

| Build | Source | Identity |
| --- | --- | --- |
| API A (previous) | `gcsp-poc-dev` `befb96e7d`, tree `a001e93c` | app jar `2c53134c…` |
| API B (current) | `1d57ed5ca` / `fb603d49a`, tree `05f6072f` | app jar `d5482464…` |
| Web A (previous) | `befb96e7d`, build key `6a61ff4c` | `main-UEGSX6EE.js` `736b1523…` |
| Web B (current) | `1d57ed5ca` / `fb603d49a`, build key `eeed34a4` | `main-RVROMT5F.js` `20c561a6…` |

A to B is a real compatible release: the web change is FUCQ-439's final OIDC auth service change; the API change
is FUCQ-523 and FUCQ-510. Both API builds carry the same 25 Flyway migrations.

| Phase | Pair | What it shows |
| --- | --- | --- |
| P0 fresh start | web A + API A | Flyway builds an empty schema; unauthenticated `/context` is 401 |
| P1 create state | web A + API A | Sources seeded, Buddy allocates paula a pending offer, the outbox captures its new link, paula saves preferences (comfort 50, current-car rating 4), signs in through the link |
| P2 frontend-only release | web B + API A | Same API process; the signed-in page reloads without re-login; the link signs in and renders the offer |
| P3 API-only release | web B + API B | New API process on the B jar, web untouched, Flyway history unchanged; same checks pass |
| P4 previous web, new API | web A + API B | The previous frontend still works against the new API by link entry |
| P5 ordinary restart | web B + API B | Both restarted on the same builds; same checks pass |

In every phase after P1, the server truth equals the P1 snapshot: account, offer id, pending state, pinned quote
hash, policy version, saved preferences and the outbox link URL. The retained inputs are also unchanged: hashes of the
seeded stock, employee, entitlement, account and brief rows, the policy version, and the tranche-plan and
supply-policy file hashes. No offer decision is ever submitted, and the browser makes no API writes.

**Rerun:** the four builds come from `python3 -B _tools/test_stack_build.py build api|web --worktree <wt>` on the two
commits; run the proof inside `_tools/test_stack.py heavy` with a `pg db create` database (inputs are listed at the
top of the script). About 40 seconds; the heavy slot reserves 3 GiB for Chrome and one JVM.

**Limits:** local emulation of Render routing, not Render itself; mock OIDC issuer, not the hosted provider; captured
outbox link, not a delivered email; Chrome only (Safari unrun).

## 2. Final build and configuration evidence (acceptance item 2)

All in `render.gcsp.yaml` at `1d57ed5ca` (FUCQ-453 is editing that file in parallel; nothing here changes it):

- **`gcsp-java-api`**: Docker (`services/gcsp-api/Dockerfile`, repo-root context), branch `gcsp-poc-dev`, health
  check `/q/health/ready`, no plan selected. Identity, database, origin and environment settings are all
  `sync: false`, so they are supplied at deployment. It needs its own PostgreSQL database: `GCSP_EXPECTED_DATABASE`
  guards the name, and the running Node `gcsp-db` must never be reused.
- **`gcsp-angular-dev`**: static, branch `gcsp-poc-dev`. It runs `npm ci` and `gcsp:compile`, then `gcsp:assemble`
  with `--revision $RENDER_GIT_COMMIT` into `_gcsp-site`. Public API and OIDC settings come from the
  `GCSP_PUBLIC_*` keys, so compiled bundles stay unchanged across configurations. It has exact rewrites,
  `frame-ancestors 'none'`, no-referrer, nosniff, no-store HTML and config, and immutable hashed assets.
- **Independent triggers:** the Java build filter covers `services/gcsp-api/**` plus the retained data it packages.
  The Angular filter covers `apps/gcsp-web/**`, the shared shell, the assembly scripts and the blueprint. Neither
  filter includes the other half's source, so each half releases alone.
- **Blueprint and static checks**, run on this branch:
  `node --test --test-concurrency=1 server/test/render-blueprint.test.js server/test/gcsp-static-angular.test.js`
  gives **18 pass, 2 fail**. Both failures are on base and belong to open Bug **FUCQ-514**: the Dockerfile copies
  `server/data/gcsp/comparison/process-only.json` and `docs/gcsp/models/artifacts`, but the Java build filter omits
  both. A commit changing only those inputs would leave the hosted Java image stale. **Fix FUCQ-514 before the
  final merge.**

## 3. Gary's merge and Render verification steps (unrun until Gary does them)

1. **Create the isolated dev environment** from `gcsp-poc-dev`: apply `render.gcsp.yaml` and give `gcsp-java-api`
   its own new PostgreSQL database. Fill the `sync: false` keys: database, `GCSP_EXPECTED_DATABASE`,
   `GCSP_ENVIRONMENT_ID`, OIDC, `GCSP_ALLOWED_ORIGINS` = the Angular origin. Fill the Angular `GCSP_PUBLIC_*` keys
   with matching values (`docs/gcsp/fucq-436-static-artifact-2026-11-13.md`, identity table).
2. **First start:** `/q/health/ready` is 200. `GET <api>/api/gcsp/v1/context` without a token is 401.
   `/gcsp/runtime-config.json` names the API and issuer. `/gcsp/` shows Sign in.
3. **Create state:** sign in as a test employee, save a preference, and allocate an offer so that a new offer link
   is issued. Note the link.
4. **Frontend-only release:** push a commit touching only `apps/gcsp-web`. Only `gcsp-angular-dev` redeploys. Reload
   while signed in, then open the link: the offer and the saved preference are unchanged.
5. **API-only release:** push a commit touching only `services/gcsp-api`. Only `gcsp-java-api` redeploys. Repeat
   the checks from step 4.
6. **Restart:** manually restart both services from the Dashboard. Repeat the checks from step 4.
7. **Hosted review** (Gary's end-of-build item): real OIDC sign-in and sign-out, exact-origin CORS, a delivered
   offer email and its return, and Safari with private browsing.
8. **Final switch:** merge `gcsp-poc-dev` into `gcsp-poc`. The Java and Angular entries track `gcsp-poc-dev` today,
   so the cutover needs one blueprint decision, taken with the retirement work (FUCQ-453 and E3.S29):
   - either repoint those two entries to `branch: gcsp-poc`;
   - or add production-named copies on `gcsp-poc` with their own database.
   The first option is fewest steps. Downtime and immediate replacement are acceptable, with no old-deployment
   retention and no rollback rehearsal. Then repeat steps 2 and 3 on the replacement. Legacy operational state may
   reset at the switch; retained source, policy, model and baseline artifacts must still be served.

Development stays isolated until step 8: nothing here touches the running `gcsp-poc` services or `gcsp-db`.
