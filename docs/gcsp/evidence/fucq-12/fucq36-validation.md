# FUCQ-36 package validation

Prepared 6 November 2026 by Mary-Sue Walton, story lead requested/selected
`gpt-6.1-sol` with `high` effort. No descendants were spawned. The desktop chat
title was verified; chat `01a1ae28-6e71-7cf1-855c-85c7c38d3392`.

## Tested identity and configuration

The browser artifacts were built from
`0d8e56cba303441064b9bea87d44625c8f70c79b` plus the following frozen package
content. The next published checkpoint retains those exact bytes; metadata-only
updates and the authored full integration gate are recorded below when complete.
The latest backend source commit in this tree is
`fbcc2ae2f6d6721d36c49112c516ba52180d8aa9`; no backend code was changed by FUCQ-36.

| Input | SHA-256 |
|---|---|
| `scripts/assemble-site.mjs` | `e568b983750da27e49201c1a3ed6baf41c3407144fc528ea6200d61a28ca1e47` |
| `server/test/launcher-package.test.js` | `56ab5e00372a2613910dfefd4253201c76147fbf29241d27e9dbaf9ed12f0c2a` |
| `fucq36-browser.mjs` | `33bde847348230b1ec49641b4c532ff70cd632bff41cc09221a6a73c78e96661` |
| `scripts/gcsp-demo.mjs` | `b8ce1a7760ada2c7742f7869d1b1d6045af1777a2c3cc67be1ff1bc165345216` |
| `server/index.js` | `1560e4a99077e4ea648f66b87566b908404312787e5fdfcc59a5ba10debf1741` |
| `server/gcsp/policy/seed-v1.json` | `c585213b98631d6e82acc1b3720d47efae49fdb502f5fc86fb440703ef6e41a6` |

Node `v26.7.0`, Chromium `151.0.7922.34`, macOS arm64. The actual
`startGcspDemo`/`buildServer` memory runtime, file policy, identity/session and
manual account services were used. Retail providers used the existing frozen
compatibility fixture through documented provider seams. No native database,
external stock source, deployment or mail was used. Temporary loopback TLS kept
the actual Secure/SameSite=None cookie contract intact.

The local artifact used `https://localhost:58641`; the deployed-style artifact
used `https://gcsp-api.example.test`. Browser requests in the latter carried that
configured HTTPS origin and were forwarded only to the owned loopback API.
This proves browser configuration/composition, not a live remote service, deployed
CORS/cookie policy, DNS, provisioning or transport readiness. Exact artifact
manifest digests and source hashes are in each report.

Available schema files, in order:

| Migration | SHA-256 |
|---|---|
| `0001_transaction_foundation.sql` | `3bde8db01f103141ca9bbe7398a6e1172df9b9789df745244a0071a00b9629d1` |
| `0002_policy_tables.sql` | `65346093f811df63b225436a0ca35cd4061990a78caacb44ffde7b1effd1edd0` |
| `0003_renewal_cases.sql` | `e76750fddd75b9d363fd209c243169ce1f9b06c78f96b7dbb74fe3c296f08c98` |

The seed is schema version 1, policy version `gcsp-policy-v1`, effective
4 November 2026. These are file identities, not an applied schema ledger or live
policy publication. See `fucq36-release.md` for compatible revision and release checks.

## Scoped checks and actual browser inspection

- Package tests: `node --test server/test/launcher-package.test.js`, **13/13**.
  They cover directory discovery, future nested offer discovery, deterministic
  output, literal dynamic dependencies, required assets, API/default boundaries,
  employee availability, script CSP, root/prefix direct URLs/reloads and named
  missing/modified-file failures.
- Earlier package plus launcher context/render/navigation/employee checks:
  **59/59** at the initial 11-case package checkpoint. The later 13-case package
  run covers the added gallery/nested-page changes; this is scoped evidence.
- Existing UI ratchet: **42/42**. No component, token, layout or baseline changed.
- Final local and deployed-style trials: **116 checks and 14 captures each**,
  using `node docs/gcsp/evidence/fucq-12/fucq36-browser.mjs`; the latter sets
  `FUCQ36_API_STYLE=deployed`. Reports are `fucq36-browser/report.json` and
  `fucq36-deployed-browser/report.json`.

Each configuration covers the launcher, retail, authenticated real employee
entry, Greg, outbox and gallery at 1440/375 pixels; keyboard link activation and
visible focus; direct root/prefix routes including standalone `block.html` and
refresh; all six brands × five modes at both base paths; all 30 retail
combinations with employee disabled; and a named account-service 503 state.
Employee account replies were real memory-service HTTP 200; absent drafts were
typed 404, not a fabricated successful draft. Greg and outbox remain their
existing labelled fixture harnesses.

Both final trials recorded zero JavaScript errors, failed local requests, HTTP
asset errors, missing images or horizontal overflow. Each deliberately blocked
249 external synthetic image requests; image fallback remained intact.
Inspected desktop/narrow launcher/retail/employee/Greg/outbox/gallery captures,
plus `employee-disabled-narrow.png` and `employee-service-error.png`. Shared
shell/header/sidebar, representative image labels, fictional/source labels,
responsive stacking and visible keyboard focus are preserved. No redesign was made.

The integrated base has no offer block. A separate immutable actual-public-source
trial proves its eight root/prefix/direct/reload cases and named missing-module
failure, while explicitly recording failed visual acceptance. See
`fucq36-offer-handoff.md` and `fucq36-offer-browser/report.json`. Its synthetic
pending state and unconfigured “Offer not found” do not prove live offer access,
decisions or later-block acceptance. The native no-later-block-dependency clause
governs FUCQ-36 pickup and completion.

Harness failures were diagnosed before correction: missing local `pg` dependency;
navigation asserted before destination readiness; HTTP rejected the actual Secure
session cookie; presenter heading mismatch; hidden narrow navigation text selected
before visible content; and SVG MIME in the separate offer harness. Fixes affect
only evidence harnesses/dependency setup, not product authentication or GC source.

## Integration and resources

The authored `npm test` full gate is pending at this checkpoint; no full stamp is
claimed yet. Dispatcher granted the sole serial gate after frozen publication.
The selected resource variant uses one Node test worker, 128 MiB scratch,
768 MiB process-group RAM and a five-minute chunk, with the shared supervisor,
owned manifests/finalizers and HostBudget reservations.

Scoped test and browser scratch was supervised and removed after every chunk.
The temporary `server/node_modules` link used only the already installed locked
`pg` dependency from worktree 069, and was independently removed after each run.
The actual worktree and source dependency installation were preserved. Browser
profiles, local TLS material and the assembled trees lived only in owned local
scratch; no generated archive or output approached 256 MiB, so no OneDrive
allocation was required. Retained small reports/captures are evidence artifacts.
Final measured cleanup and full-gate receipts will be appended here.
