# FUCQ-436 static artifact delivery record

Status: implementation in progress; neither original acceptance criterion is complete.

The claimed contract is `_dev/in-progress/DEV-2026-11-13-004.md`. Work is confined to branch `dev/DEV-2026-11-13-004`, based on `2dae607953ee978e820527589ad0be2e9e691970`, with integration target `gcsp-poc-dev`. The frozen product baseline remains `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`. No deployment, provisioning or running database change is authorized here.

## Fixed scope and readiness

Build an independent static Angular artifact, preserve required shared branding/fonts, produce public API/OIDC configuration separately from compiled bundles, and define route/cache/CSP/referrer behavior and independent Render build filters. Preserve Used Cars and the current deployment definitions. The Java dev block is copied from the actual `services/gcsp-api/render-service.proposed.yaml`, supplied by Russ in FUCQ-434 comment 3629361; its identity provider is intentionally `none` pending FUCQ-455. No database settings or paid tier are invented.

The published Angular producer is FUCQ-439 at `e58b36a53213c89da8eb3c15bb7be7653a2757a0`, available read-only in its own clean worktree. It emits `apps/gcsp-web/dist/gcsp-web/browser`, base `/gcsp/`, with hashed relative assets. Node 24.22.3/npm 11.19.1, Angular 21.2.26, CLI/build 21.2.30, TypeScript 5.9.3, RxJS 7.8.2 and oidc-client-ts 3.5.0 are the recorded compiler inputs. This unfinished Story is not merged or cherry-picked through FUCQ-436. Any composition proof must record its exact source and compiler/output identities and remains distinct from producer acceptance.

Runtime configuration is fetched before Angular bootstrap at `/gcsp/runtime-config.json`: `schemaVersion`, `environmentId`, `apiBaseUrl` including `/api/gcsp/v1`, and `oidc.authority/clientId/scope/redirectUri/postLogoutRedirectUri`. Public authorization code plus PKCE has no client secret. Required missing/invalid configuration must fail truthfully. Missing configuration, scripts, CSS and assets must never receive SPA fallback; supported nonasset application routes may. The consumer remains FUCQ-439-owned.

## Stable slice plan

- `runtime`: public configuration schema/producer and route/cache/CSP/referrer policy, serving original AC2.
- `artifact`: independent compiled Angular assembly, required assets and separate dev Render build filters, serving original AC1.
- `integration`: actual Angular/Java/OIDC hosted header, asset, bundle identity and browser gates. This required gate remains open until the real environment exists.

The product map associates FUCQ-436 with its existing Shared experience kit component. Plans and observed worker claims are maintained through `_tools/product_map.py`; other Stories and acceptance statuses are preserved. Publication mode remains actions, with dispatcher-owned publication. Local commits establish no served map update.

## Validation and resources

Select focused `node --test --test-concurrency=1 server/test/gcsp-static-angular.test.js` while developing, then relevant `render-blueprint.test.js` and `launcher-package.test.js` boundary checks. The first covers the new producer/artifact; the existing checks preserve current deployment/legacy packaging and retail dependencies. No full backend suite is justified by these paths alone. Record actual failed, skipped and unrun checks below; fixture/source/build evidence never satisfies hosted/identity acceptance.

Session resource manifest and retained results: `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq436/`. Each allocation uses an externally recorded ownership manifest and supervisor finalizer, one worker, at most ten minutes/2 GiB scratch per chunk, a 5 GiB reserve and smaller chunks below 30 GiB free. Outputs expected to reach 256 MiB go directly under `/Users/garycarter/Library/CloudStorage/OneDrive-IBM/_agent-output/vehicle-matcher/fucq436`; installed environments stay in place. Stop/join owned processes, retain compact evidence, remove only owned disposable scratch and verify absence.

## Open original acceptance

- AC1: complete real Angular static composition, required assets and independent frontend/API release evidence pending.
- AC2: two public configurations with unchanged real compiled bundles, deployed cache/CSP/referrer and identity flow evidence pending.
- Hosted Java/OIDC registration, exact-origin CORS/HTTPS callbacks, Safari/private browsing, keyboard/focus and relevant accessibility checks remain unrun. FUCQ-455 has not supplied the actual provider registration. Gary owns isolated Render environment/database creation and final hosted review; no intermediate human approval gate is introduced.

## Agents

Rapunzel requested/selected/effective `gpt-6.1-sol` / `high`, no fallback; title Rapunzel and runtime verified by dispatcher from its saved turn context. Barnyard Dawg requested/selected `gpt-6.1-sol` / `medium` for runtime implementation, no fallback; effective `gpt-6.1-sol` / `medium` independently verified from saved turn context; saved child title Barnyard Dawg, chat `01a1d6f7-7acb-7783-8558-6b99c2a11203`, verified. The launching session retains resource responsibility.

## Runtime producer checkpoint

`scripts/gcsp-runtime-config.mjs` exports strict validation, the single environment-variable mapping, and CSP generation. `_config/gcsp-runtime-config.schema.json` publishes the public field shape and constraints. The producer emits only the agreed public configuration and refuses unknown fields, missing values, unsafe URLs, non-loopback HTTP, incorrect callback/API paths and overwrite of existing output. It never loads the API or processes HTML at request time. Configuration-specific CSP permits API/issuer connections by exact origin, external self scripts, Angular style injection and packaged fonts; frames and object embedding remain disabled. HTTP `frame-ancestors` belongs to host headers, not the meta policy.

Barnyard Dawg completed the implementation; Rapunzel reviewed all three new files against the pinned FUCQ-439 consumer and reran `node --test --test-concurrency=1 server/test/gcsp-static-angular.test.js`: **8 tests passed, 0 failed/skipped**, Node v26.5.0. This validates the producer only; it proves no real Angular hash equality, hosted headers, provider or journey. Lead receipt `lead-runtime.json` under the resource directory records 1.036 seconds, sampled peak scratch 1,251 bytes and child peak RSS 55,689,216 bytes; owned scratch removed and verified absent. Implementer receipts and impact evidence are retained alongside it. No browser/server or large artifact was allocated. The `runtime` slice remains in progress until its packaging/header policy is integrated.
