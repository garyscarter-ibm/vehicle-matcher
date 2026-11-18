# FUCQ-438 release proof summary

Run `f438-final` of `scripts/gcsp/fucq438-release-proof.mjs` on source `fb603d49ae9592e543b889a21f6c58a36cbd9cd0`, 2026-11-18T16:00:29.763Z to 2026-11-18T16:01:08.343Z, overall **PASS**.

Repository policy keeps only Markdown here. The compact JSON receipt (SHA-256 `d7aea05af9bec7d0a4464e369f00651ff665ce94fa5827b2938723affa7c5558`, 16,187 bytes) and run log stay in local evidence at `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq438/`.

| Build | Revision | Identity (SHA-256) |
| --- | --- | --- |
| API A | `befb96e7d` | app jar `2c53134ceea7e414b43a39a791f8a2e3787876918d867f7ff5011bc93cbc2767` |
| API B | `fb603d49a` | app jar `d54824648100e8073eb99a4ba925ce88ad66e3d0b38b25709029b59d7c1fb034` |
| Web A | `befb96e7d` | `main-UEGSX6EE.js` `736b1523fc2204c6dac60080670ae9160ee71d6536ca7d400b54e01a802eead9` |
| Web B | `fb603d49a` | `main-RVROMT5F.js` `20c561a652be335cba41946f5b1cac7f62d88c5b2d863e326b3e1725274d1987` |

Build B's revision is the proof commit; its API and web trees are identical to `1d57ed5ca`.

| Phase | Pair | Result | Checks |
| --- | --- | --- | ---: |
| P0-fresh-start | web A + API A (api-1) | PASS | 5/5 |
| P1-create-state | web A + API A (api-1) | PASS | 5/5 |
| P2-frontend-release | web B + API A (api-1) | PASS | 10/10 |
| P3-api-release | web B + API B (api-2) | PASS | 12/12 |
| P4-previous-web | web A + API B (api-2) | PASS | 10/10 |
| P5-restart-both | web B + API B (api-3) | PASS | 11/11 |

Database: native PostgreSQL 170012, throwaway schema `gcsp_s_f438_f438_final`, dropped after the run. Flyway: 26 successful history rows for 25 migration files, unchanged across releases.
Mock OIDC: 5 PKCE authorizations, 5 verified exchanges. Employee write: `POST /brief/preferences` returned 200.
Teardown: all owned processes exited, servers and browser contexts closed, no errors.

Limitations:

- Local proof only: real prebuilt jars and compiled web bundles, native PostgreSQL 17, headless Chrome; the hosted Render checks remain Gary's end-of-build review.
- The web emulator mirrors the explicit Render fixed/named-placeholder rewrites; a frontend release is a close and restart of that server on the same origin.
- Local labelled OIDC issuer exercises real code/PKCE, signed JWTs and Java verification; the hosted identity provider is unrun.
- No email transport is configured; the captured outbox link is the producer output and opening it proves deep-link login return only.
- Offer decisions are never submitted; the offer stays pending throughout.
- Parent owns resource reservation, scratch supervision, aggregate deadline and final schema/scratch audit.
