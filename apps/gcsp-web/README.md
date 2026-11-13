# Angular portal

FUCQ-439 shell slice. Angular owns `/gcsp/` routing; the default authentication port is explicitly unavailable. Feature routes retain their role policy and say that the body is not available yet. This is an integration checkpoint, not completed Story acceptance.

Use Node `24.22.3` (`.nvmrc`) and the bundled npm. Run `npm ci`, `npm test`, `npm run check:boundaries`, and `npm run build` in this directory. `npm start` serves the app locally. Production output is `dist/gcsp-web/browser`; the host must provide `/gcsp/` history fallback and serve assets normally. Root deployment composition is owned separately.

## Toolchain evidence

Checked 13 November 2026 against https://angular.dev/reference/versions and official https://registry.npmjs.org metadata: Angular 21 supports Node `^20.19.0 || ^22.12.0 || ^24.0.0`, TypeScript `>=5.9.0 <6.0.0`, RxJS `^6.5.3 || ^7.4.0`. Pinned framework/compiler `21.2.26`, CLI/build `21.2.30`, TypeScript `5.9.3`, RxJS `7.8.2`; every direct package has an exact pin and the lock records transitive integrity. System Node 26 is outside the published Angular 21 table. Use `.nvmrc` with a Node version manager. This implementation used an ignored local `.tools/node` runtime, verified against the official versioned `SHASUMS256.txt` (SHA-256 `ff6e17d4874b76d272212b908cc020d6e815fba5a6c7eaaa06add725840307fd`); its downloaded archive was removed. The runtime bundles npm `11.19.1`.

The Angular build uses external bootstrap, production AOT, external CSS and disabled critical-CSS inlining. Production has no inline scripts, event attributes or eval. Angular compiled event bindings are native Angular behavior. A hosting CSP still needs the actual configured OIDC/API origins and deployed-browser evidence.

## Integration seams

`AuthPort` exposes typed session/context signals, idempotent singleflight initialization, explicit retry, sign-in, callback and sign-out. Its `recovery` signal supports concise expired-session recovery guidance and always requires explicit command confirmation. The shell never replays a command. The real OIDC adapter replaces the unavailable default in the next slice; no fixture login or account impersonation exists here. Router guards are navigation only; API authorization remains authoritative.

`runtime-config.ts` records the root producer contract: GET `/gcsp/runtime-config.json`, schemaVersion 1, environment identity, API base and OIDC authority/client/scope/callback/logout URLs. The next slice validates and consumes it without changing compiled bundles. No credentials belong in public configuration.

Shared native Angular components live in `src/app/kit`; `/gcsp/components` is the app-local gallery. The shell imports the existing Density/theme/font/shell CSS, with packaged brand artwork, and never imports legacy page controllers. Visual references: `docs/gcsp/screens/00-employee-account.webp`, baseline `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`, current shell and two-item employee rail. Project docs and `COMPONENTS.md` govern future bodies.

Remaining acceptance: real test OIDC and Java bearer context, renewal/expiry/sign-out/account separation, native saved progress, deployed origin/deep-link/CSP proof, desktop/narrow/Safari/private/keyboard/focus inspection and hosted review. App tests and builds do not establish these integrations.
