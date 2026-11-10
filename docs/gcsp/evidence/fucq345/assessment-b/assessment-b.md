# Assessment B — FUCQ-345

## Result

The 19 frozen source hashes still match the integrated-source manifest at checkpoint `5a5ae694923c26c59acb81a121a56683e424159c` (base `95f391414685638618f71665ab23630508f7aa45`). The bundled CLI detector exited 0 with zero findings for `blocks/gcsp/manual-review/gcsp-manual-review.js`; this is a code-file scan and is separate from the browser runtime diagnostics below.

The completed direct headless browser run captured 18 images: 14 product-state views at desktop/narrow widths and four gallery media views. It also retained 20 state/geometry records. The lead independently inspected all 18 images and judged the fixed media acceptance criteria passed, with no media correction required. The review separately identified a Low heading hierarchy issue for a linked backlog Bug; it does not fail the media criteria.

## Browser evidence

The capture used a fresh Playwright Core context and headless Chrome inside one supervised helper allocation. The application fixture was the frozen worktree served on localhost over HTTP, backed by the in-memory runtime. The local HTTP fallback was authorized after the native browser tool rejected the fixture's self-signed certificate. No screenshots were recaptured during the later diagnostics run.

All five runtime detector injections in the capture loaded. The capture reported zero page errors and zero blocked external requests; the local egress guard recorded `externalCalls: []`. The original console capture retained five detector group headers with counts `7, 10, 6, 9, 4`, plus five generic HTTP 404 console errors without request URLs. The supplemental diagnostic below resolved both gaps.

## Runtime detector and request diagnostics

The supplemental diagnostic served the bundled `detect-antipatterns-browser.js` from the same-origin fixture route; it did not start the Impeccable detector server or rerun the CLI detector. `window.impeccableDetect()` returned 41 rule findings across 36 groups at the five original detector points:

| Point | Viewport | Groups | Findings |
| --- | ---: | ---: | ---: |
| Selected review | 375 | 7 | 9 |
| Order review summary | 1280 | 10 | 11 |
| Confirmation | 375 | 6 | 7 |
| Offer | 1280 | 9 | 10 |
| Activity | 375 | 4 | 4 |

The detail list is in [runtime-diagnostics.json](runtime-diagnostics.json), with classifications in [diagnostic-classification.json](../diagnostic-classification.json). It includes `text-occlusion`, `overused-font`, `gpt-thin-border-wide-shadow`, `cramped-padding`, `monotonous-spacing`, `skipped-heading`, `line-length`, and `undersized-ui-text`, with selectors, bounds, severity, advisory state and descriptions. The lead verified that the account-context occlusion findings refer to hidden content and that the border, table-boundary and font signals align with the approved tokens. The `skipped-heading` findings identify the model `h3` following page `h1` headings; the lead recorded that Low issue as the separate linked Bug.

The five 404 responses all came from `GET /api/gcsp/manual/order`: one on selected review, two on summary and two on confirmation. This is the optional saved-order read at [journey.js](../../../../../blocks/gcsp/manual-setup/journey.js#L75). A missing order is represented as `not-found`; the summary adapter accepts that status and the HTTP test explicitly covers 404. These responses were not missing page assets. The 11 failed requests were `net::ERR_ABORTED` during state navigation: four to `/api/gcsp/presenter/scenarios`, four to `/api/gcsp/presenter/scenarios/faults`, and three to `/api/gcsp/context`. No external request was blocked.

## Failed attempts and limitations

- The first supervised helper reached its 300-second wait ceiling before a browser context existed; it exited cleanly and its scratch was removed.
- Two native tool calls failed before browser setup (`SyntaxError: missing ) after argument list` and `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`). The tool-managed page context returned `browser() === null`. A later attempt mistakenly called `clearCookies()`, installed a context-wide route, and called `close()` on that supplied context after the HTTPS bootstrap failed with `self-signed certificate`. A separate probe navigated the supplied page to `chrome-error://chromewebdata/` after `ERR_CERT_AUTHORITY_INVALID`. The context's ownership and prior contents were not established, so this report does not claim its state was preserved. No app page or capture came from those native attempts; no foreground browser interaction was used and no cookie was transferred to the direct browser.
- The first direct capture stopped after four images because its confirmation path assumed the summary had not already persisted. The corrected run resumed an already-open summary and completed all 18 images.
- The first diagnostic-only chunk stopped before app navigation due to a runner `ReferenceError` (`stripStyle` referenced an undefined `s`). After a fake-source invocation preflight, one corrected diagnostic chunk completed. No further diagnostic retries were made.

## Resources and cleanup

All nine supervised receipts report their scratch roots removed; [resource-receipt.json](resource-receipt.json) verifies each root is absent. Across the run history, peak scratch was 7,161,369 bytes and peak process-group RSS was 282,886,144 bytes, within the 128 MiB / 1 GiB allocation. The final capture run took 29.77 seconds; the corrected diagnostic run took 30.48 seconds. Both completed with `rc=0` and `externalCalls: []`.

Detector server PID `81671` was stopped and verified absent. Its empty, run-created `.impeccable/live` directory was removed. The owned headless Chrome and helper processes were joined and absent at final verification. Temporary scratch roots were absent. The existing `server/node_modules` symlink was left untouched.

The retained `browser-runner.js` is an earlier native-tool runner, not the bytes used for the successful direct capture. The exact 17,018-byte runner used by the completed run is preserved as [browser-runner-completed18.js](browser-runner-completed18.js), SHA-256 `2939f92916d9640c45d4efa731751da8bb23e7c66ea06f2408f8ed8d3ac66282`. The capture helper's contemporaneous hash was not recorded; a reconstruction made by removing the later diagnostics-only additions has SHA-256 `a89340b4763f66c0d3121162edfc3fede0a45bfe04cc4d99b6edaf15d60459de`. Hashes for the successful diagnostic helper, runner and detector source are recorded in [runtime-diagnostics.json](runtime-diagnostics.json). Full evidence hashes and provenance are in [browser-provenance.json](browser-provenance.json).
