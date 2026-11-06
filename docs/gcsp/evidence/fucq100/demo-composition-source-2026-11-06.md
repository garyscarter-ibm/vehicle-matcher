# Demo composition source checkpoint, 6 November 2026

This FUCQ-100 source checkpoint connects the existing employee help, Greg case queue, policy publication panel and presenter workspace to the central HTTPS host and runtime. It is not execution evidence or story acceptance. The registry/reset attempt remains the separate published two-test PASS at `f3eedda8c2fb0751598c51cd7199bfc32daa9d99`; its once-only grant is consumed.

## Source and scope

The adoption starts from central `c251f98f77664377b1d53f76e6182f6837be09bc`, which includes the separately reviewed FUCQ-71 acknowledgement correction. Named files are adopted from these published sources, without merging their branches:

| Source | Adopted capability and local adaptation |
|---|---|
| FUCQ-122 `aa64700fa5b20d7a95ab42b9dcc8cb236ce0b2cd` | The eleven case UI/adapter/fixture files, help and queue pages, Greg fixture harness/page, and case-view contracts. The help entry handles the shell's `cars` navigation by returning to the real account entry. |
| FUCQ-103 `c5be593e3f023022f3e6da6e13253d086304d285` | Publication panel/adapter/gallery/element, Greg dashboard composition and HTTP adapter, presenter workspace/harness/styles/page, publication rendering contracts, and narrow shell/employee presenter-control wiring. The workspace uses the central manual journey so account Resume remains available, includes that journey's existing styles, routes employee support to help, and embeds the existing case queue in Greg's reserved region with teardown. |
| FUCQ-122 `1e2d7ae3a11172b6d3d289c1d88af84b096ff88b` | Exact `server/test/gcsp-cases-local-demo.test.js` and its source-only evidence note. Authored against the actual central HTTPS launcher and shared runtime; not executed here. |

The existing central case service, Greg publication service and policy/recommendation facts are retained. No second service is created. The current presenter controls retain their stricter release-result readback (`418f3d4a9b41b3f402bb57bb3413a3838e838300ca7a8e45ccdfbeb451ec08c2`). The four adopted view stylesheets gain exact initial ratchet caps; existing caps, Density tokens, exclusions and component-debt baselines remain unchanged. `COMPONENTS.md` records the existing compositions.

`gcsp-presenter.html` is the live acting-context entry: it mounts the real manual journey for an employee or the HTTP Greg dashboard, publication panel and case queue for Greg. `gcsp-greg.html` retains its explicit synthetic dashboard fixture and must not be presented as the live policy demo entry. Help/queue use existing role-protected HTTP adapters by default; named fixtures remain explicit.

## Navigation diagnosis and repair

Diagnosis: the identity service issues Secure/HttpOnly identity cookies with `Path=/api/gcsp`. A browser therefore omits them on an HTML GET. The old local host resolved the HTML request's cookies, then issued a fresh default employee session whenever none were present. Navigating after a deliberate Greg switch could overwrite that selection with Paula. This follows from the host and identity source; a reproduced runtime result is still pending.

The local host now serves the existing help, Greg, queue and presenter entries and issues `GCSP_LOCAL_BOOTSTRAP=1` with `Path=/`, Secure, HttpOnly, Strict SameSite and the bootstrap session's expiry. This marker only suppresses repeated HTML bootstrap. API authority, selected principal, run, role, origin and Host checks continue through the existing identity/API boundary. A marker cannot authenticate an API request, and query parameters do not choose a principal or run. Marker-only API access is explicitly tested as denied.

The new HTTPS regression uses JSDOM's URL-aware cookie jar for cookie Path selection and applies actual Set-Cookie replies. It first opens help with forged principal/run query parameters, verifies the server-owned Paula context, deliberately switches through the existing API, then navigates presenter/Greg/queue/help/account pages while sending only the marker to HTML. It requires no replacement identity cookies and continued Greg context after every navigation. The FUCQ-122 test uses trusted actor headers and therefore provides a different, explicitly limited seam proof.

## Selected future verification

No application syntax/AST/import/compile check, test, listener, browser or native/database operation ran for this checkpoint. Source comparison, SHA256 provenance, stylesheet line counts and diff inspection are source review only. Existing scoped results retain their original tested bytes and limitations.

After a separate selection/resource admission, use the current suitable bounded launcher, one worker, owned scratch and retained cleanup receipt. Do not reuse the registry grant or FUCQ-103's old browser supervisor with legacy HostBudget pruning. The selected changed-source checks are:

| Check | Command or exact selection | Purpose |
|---|---|---|
| HTTPS host | `node --test --test-concurrency=1 server/test/gcsp-demo-tls.test.js` | The two existing TLS/host cases plus the new exact title `browser cookie paths preserve a deliberate Greg switch across real local page navigation`. |
| Case UI | `node --test --test-concurrency=1 server/test/gcsp-case-views.test.js` | Adopted help/queue contracts, errors, confirmation, stale state, keyboard/focus and CSP source checks. |
| Case launcher seam | `node --test --test-concurrency=1 server/test/gcsp-cases-local-demo.test.js` | Exact owner-authored served assets and actual Paula request → Greg action → persisted employee reload. This is not an added FUCQ-100 merge gate. |
| Publication UI | `node --test --test-concurrency=1 server/test/gcsp-greg-publish-render.test.js` | Adopted panel, HTTP contract, preview/publication, errors, focus and dashboard composition. |
| Shared UI boundaries | `node --test --test-concurrency=1 server/test/gcsp-shell.test.js server/test/gcsp-greg-dashboard.test.js server/test/gcsp-account-render.test.js server/test/ui-ratchet.test.js` | Shell presenter wiring, adjacent Greg/account behavior, shared component/CSP checks and the four new stylesheet caps. |
| FUCQ-71 adoption | `node --test --test-concurrency=1 server/test/gcsp-manual-order.test.js` | Previously authored acknowledgement/renewal and actual local-consumer contracts, still unexecuted on the combined candidate. |

Retain the separate Resume7 selection in `manual-resume-validation-plan.md`: all five `gcsp-manual-journey-resume.test.js` cases, `host account setup Back and resume retain real saved choices and unchanged current car` in `gcsp-runtime-composition.test.js`, and `account journey event enters trusted setup and Back returns to the account with current car unchanged` in `gcsp-manual-setup-render.test.js`. Its old helper/catalogue graph must be refreshed and separately admitted before running against this candidate. Original backend acceptance mappings and the explicit combined `npm test` gate also remain. The current registry proof is reusable only for its matching source boundary. Actual desktop/narrow rendered and keyboard inspection must cover employee account → help → Your cars, presenter switch to Greg without session reset, live queue actions, publication and return to employee readback. JSDOM contracts do not provide this rendered proof or establish browser module upgrade order. No full-suite, current rendered, external-provider or native integration pass is claimed.

The binding references are `docs/gcsp/demo-brief.md`, `build-rules.md`, `experience-quality.md`, the supplied shell screenshots and default Density reference, `COMPONENTS.md` and `technical-readiness-2026-11-05.md`. Existing pauses, claims, foreign source ownership and separate-story gaps remain in force. No Jira lifecycle/links, product-map claims, merge or closure is changed.
