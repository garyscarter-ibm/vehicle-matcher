# FUCQ-35 launcher entry checkpoint

Run: `fucq35-20261105-launcher-entry`. Story: `DEV-2026-11-04-046`.

The authorised slice registers the existing account custom element behind the launcher capability. The launcher owns routing, asynchronous loading, recovery and demo-gate integration. The account component and HTTP adapter retain account, draft and journey semantics. Public navigation values and the shared demo password confer no employee identity.

Component plan: reuse `el`, `button`, `statusScreen`, existing launcher destination controls and the real `gcsp-account` element. Keep the supplied header/sidebar and default GCSP tokens inside the existing account composition. No new shared primitive or ratchet-cap increase is planned. The agreed L2 launcher/mount architecture is unchanged; canonical draw.io implementation-status rendering remains a separate coordinated update.

Validation selection:

| Changed surface / boundary | Selected check |
| --- | --- |
| Capability registration, lazy import, real element and account HTTP adapter | `server/test/launcher-employee-entry.test.js` |
| Public URL context, BMW-only selection and stripping authority-like query values | `server/test/launcher-context.test.js` |
| Return context, browser navigation and teardown | `server/test/launcher-navigation.test.js` |
| Existing launcher, gate, disabled/recovery and CSP contract | `server/test/launcher-render.test.js` |
| Retail result rendering and API regression | `server/test/render.test.js`, `server/test/api.test.js` |
| Shared component limits and scanned launcher code | `server/test/ui-ratchet.test.js` |

The affected-selector dry-run (`_tools/test_stamp.py --affected --dry-run`) reports no JavaScript plug-in and falls back to `npm test`. That is not permission to execute the broad fallback. Explicit launcher checks above are the first scoped chunk; render/API/ratchet follow only after resource admission. Account/employee bodies, driver/image features, server bootstrap and unrelated domain suites are excluded from the first chunk because this slice does not change them. New/unobserved code remains unknown until exercised.

Before execution: freeze source/test identity, reserve actual machine-wide HostBudget, establish an absolute run-owned scratch root with outside ownership manifest, register supervisor teardown and propagate TMPDIR/TMP/TEMP. First chunk: one worker, at most 256 MiB RAM, 32 MiB scratch and 120 seconds. The supervisor terminates and joins its process group, releases only its exact reservation, removes owned scratch and verifies absence. Retain a concise summary and bounded failure log; successful verbose output is disposable.

Remaining explicit gates: actual backend/provider employee-session integration, background desktop/narrow/keyboard inspection (including rejection/expiry, failure/retry and disabled retail), the FUCQ-7 dependency and a final `npm test` only after dispatcher serial grant and fresh admission. Synthetic envelopes exercise client contracts; they do not prove the deployed product runtime. No built/completed claim is justified before these gates pass.
