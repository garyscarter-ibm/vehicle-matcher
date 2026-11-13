# Static frontend and backend API assessment — 13 November 2026

Requested by Gary: what would it take to return GCSP to the originally planned static frontend calling a backend API?

This is an assessment against `gcsp-poc` at `f04f763c2`, not approval to implement, change hosting, alter claimed acceptance criteria or resume Jira writes. Jira remains paused. No application code, configuration, data or external deployment was changed for this assessment.

## Finding

The product already has most of this separation. Its HTML pages load browser ES modules and shared components; the application services, identity, policy and PostgreSQL repository sit behind HTTP routes. The migration is primarily deployment and session-boundary work. Existing screens and domain services can be reused; a frontend framework, new backend language, separate repository or database migration is not inherently required.

The original separate Render static-site/API plan is recorded in the [HLD review](../design/hld-review-gc.md), Q1. The [current HLD hosting decision](../design/gcsp-high-level-design.md#technical-deployment-and-recovery), dated 9 November, deliberately selected same-origin hosting to avoid cross-site session-cookie failures between the two `onrender.com` addresses. It already identifies sibling custom domains as the route for eventual integration.

Current implementation evidence:

- `server/gcsp/host.js` serves live pages, resolves sessions and redirects by role. Opening Presenter or Outbox also creates a presenter-control cookie. Its HTML transformation adds asset versions and preload links; it does not render employee application data into page bodies.
- `render.gcsp.yaml` publishes only the launcher, gallery and fixture employee page on `gcsp-site`, redirecting 13 live route aliases to `gcsp-api`. The API's build filter therefore includes frontend files.
- API transports are mixed: several accept a backend base URL and use `credentials: 'include'`, while login, shell context, Brief, Activity and Order Progress use same-origin credentials. Offer transport additionally forces `mode: 'same-origin'` and resolves requests against the page origin.
- `server/gcsp/identity/http.js` already implements login/logout/context APIs, exact allowed-origin credentialed CORS, unsafe-method Origin checks and server-owned role/resource checks.
- `scripts/assemble-site.mjs` discovers pages/blocks, verifies dependencies and emits a revision manifest. Its API replacement currently targets the retail launcher/block; it does not configure every GCSP consumer. The Render static build currently uses a separate copy command rather than this assembler.

## Suggested target

Use a static site and Node API under sibling HTTPS subdomains of one controlled domain. The browser loads HTML/CSS/JS from the static host and sends API requests to the API host. PostgreSQL, policy, allocation, mail and other application services remain behind that API.

Keep HttpOnly, Secure cookies scoped to the API host. Use credentialed cross-origin requests with an exact frontend-origin allowlist and retain the API's Origin checks. Select the appropriate SameSite policy centrally, including offer access; sibling same-site domains support the HLD's proposed Lax configuration without sharing cookies across the whole parent domain.

A shared public origin with an edge/reverse proxy routing `/api/*` to Node and other paths to static storage is another valid deployment shape. It reduces browser-origin changes but adds proxy configuration and proof obligations. Do not assume Render's existing static redirects provide a working API proxy. Two unrelated Render default addresses with the current cookie scheme would repeat the documented browser problem.

## Work required

| Area | Concrete change |
|---|---|
| Transport configuration | One trusted deployment API setting and shared request helper; wire every live entry point and nested component to it. Normalize credential handling, error/session outcomes and offer transport. Keep frontend navigation on the frontend host. |
| Session entry and roles | Replace page-request redirects with a frontend context/bootstrap read and loading/sign-in/forbidden states. Create an explicit, appropriately protected API path for presenter-control setup, preserving the existing authority model. Keep every permission enforced by the API. Static HTML must contain no private application state. |
| Static release | Publish all 11 live HTML files and their aliases/dependencies. Move asset versioning/preload generation from the Node request path to the build; define HTML revalidation, immutable asset caching, CSP and referrer headers. Reuse the assembler after checking current page coverage. |
| URLs and hosting | Configure domains, HTTPS, API CORS, central cookie policy, offer landing/base URLs and static route aliases. Preserve offer fragment removal and POST token exchange, old emailed links, deep links and embedded-block mounting. |
| Independent deployments | Separate frontend and backend build filters and retain revision/compatibility evidence. Deploy a compatible API before the frontend, keep the current host during rollout and remove its page duties after parity. Preserve the existing runtime composition when making the entry API-only. |
| Validation | Exercise two actual HTTPS origins in browsers, including Safari/private mode, login/logout/expiry, role denials, Presenter setup/switch/reset, saved preferences, manual claims, offer-link exchange/decisions and Greg's views. Check direct links, cache refresh, rollback and desktop/narrow layouts. Adapt the current same-origin-specific tests; preserve retail compatibility. |

Moving HTML access checks into the browser does not move authority into the browser: data and actions still require the existing server session, role and resource checks. Publicly retrievable static page shells must be safe by construction.

## Indicative effort and delivery

Allow approximately **4–8 engineering days**, roughly **one to two developer weeks**, for the full migration and focused verification, assuming unchanged product behaviour, access to DNS/hosting and the current identity model. This is a code-inspection estimate, not a measured delivery commitment. External setup delays and unrelated defects are additional uncertainty.

A first **1–2 day vertical slice** should prove static login → API session → account read → logout on the chosen HTTPS topology. The fuller estimate includes that slice. Use its browser evidence to refine the estimate, then migrate employee/manual/offer paths and Greg/Presenter paths in coherent increments. Keep the existing host available until the replacement passes the same journeys.

The payoff is independent frontend releases and static asset delivery, with the browser/API boundary also supporting the intended Angular/web-component integration. This hosting change does not establish production identity or resolve separate database/service-performance concerns.

## Evidence limits and external references

Repository source and existing contracts/tests were inspected. No test suite, static build, live session, database write, email send, DNS change or deployment was run. Diff/whitespace and all three newly added local Markdown-link targets pass. A broader existing-index link scan failed on the baseline documentation finding below; it is not a passing index-wide check. Runtime and browser parity remain migration work.

**Separate documentation finding, Low; pending Jira reconciliation while writes are paused.** In this checkout, resolve the relative Markdown targets in `docs/gcsp/README.md`: seven existing `story-publication.json` links have no file, under `evidence/fucq-6`, `fucq-79`, `fucq-86-90`, `fucq-110`, `fucq-132`, `fucq-74-75` and `fucq-13-19`. Expected behaviour is navigable publication evidence; actual behaviour is a missing local target. These links predate this assessment. Impact is broken historical documentation navigation; no application failure is established. The missing destinations reproduce locally; why they are absent, the correct replacement paths and originating Story are unresolved. Linked capability keys are candidates, not verified defect-origin relationships. Future validation: restore or correct each intended reference and rerun the index link check. No repair or new pickup is included in this assessment.

Official documentation checked on 13 November 2026:

- [Render custom domains](https://render.com/docs/custom-domains): custom domains are supported for both static sites and web services.
- [Render static sites](https://render.com/docs/static-sites): static artifacts are served through its CDN.
- [MDN Request credentials](https://developer.mozilla.org/en-US/docs/Web/API/Request/credentials) and [credentialed CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS): separate origins require explicit credential handling and an explicit allowed origin.

## Follow-up: all hosting on Cloudflare Free

Gary asked whether all hosting could move to Cloudflare's free tier. This remains discussion and feasibility assessment, with no authorisation inferred for a migration, new dependencies, service provisioning or Jira writes. Current source observation is `e6303e7fe`; no application code changed since the source assessed above.

**Assessment:** a Cloudflare-only version is plausible, but the existing Node/PostgreSQL deployment does not establish that it will fit the free tier. It needs a backend/storage port and representative resource/transaction proof. The original 4–8 day estimate covers the static-frontend/API separation; it does not cover this full platform migration. There is insufficient implementation or workload evidence to give a firm estimate for the larger port.

| Responsibility | Possible Cloudflare placement | Implication for this app |
|---|---|---|
| Static HTML, modules, styles and small images | Workers Static Assets, alongside a Worker on a supplied hostname | Direct static-asset requests are free and unlimited. One public origin can serve static files and `/api/*`; session/bootstrap work above still applies. |
| HTTP API | Workers | Free allowance: 100,000 requests/day, 10 ms CPU/request and 128 MB memory/isolate. Waiting for I/O is separate from CPU time. Recommendation/release work must be measured and placed or split appropriately. |
| Durable transactions and policy | D1 or SQLite-backed Durable Objects, selected after a port trial | D1 is SQLite-compatible, not PostgreSQL. A replacement repository/policy adapter, migrations and data transfer must preserve exclusive holds, command receipts, pinned policy/quotes and reset/recovery. Neither product is already integrated. Do not put competing authorities in both stores. |
| Stateful coordination and heavier work | SQLite-backed Durable Objects; bounded resumable operations where needed | Available on Free with their own request, duration and storage allowances. Their documented default CPU budget is 30 seconds per request, so the ordinary Worker's 10 ms limit alone does not rule out an all-free design. Worker memory limits still matter. This is a candidate adaptation, not a proved fit. |
| Vehicle corpus and large objects | R2 Standard or suitable static-asset partitions | R2 includes 10 GB-month storage, 1 million Class A and 10 million Class B operations/month. This is a metered allowance with charges beyond it, not a guaranteed zero bill. Runtime filesystem lookups/publication need an object-storage/bundled-data adapter. |
| Comparison jobs | A replacement bounded job mechanism | Current `comparison/jobs.js` uses Node `worker_threads`; that execution path needs replacement/compatibility proof. Retaining an offline-prepared stored result is possible only within the existing authorised capability boundary; it does not fulfil interactive rerun acceptance. |

Specific code evidence: `server/gcsp/repository/postgres.js` and `policy/postgres-provider.js` use JSONB, explicit SQL transactions and PostgreSQL advisory locks. `vehicle-evidence/indexed-jsonl.js`, registry/publication and VIN allocation use local filesystem contracts. `host.js` owns the long-running runtime composition. Pure JavaScript service logic and browser components remain reuse candidates. Cloudflare supports many Node APIs, including HTTP and a virtual filesystem; the compatibility question is actual lifecycle, durable storage and execution semantics, not merely whether a `node:` import exists.

D1 Free currently permits 500 MB per database and 5 GB aggregate storage, with 5 million rows read and 100,000 rows written/day. These are row-operation limits, not equivalent API request counts. Existing broad run snapshot/fingerprint patterns make query shape relevant; no current live database size or D1 usage was measured. Hyperdrive can connect Workers to an existing external PostgreSQL database, but that keeps an external database host and does not meet the literal Cloudflare-only objective.

The Render blueprint records a historical startup RSS near 500 MB. That is not a Worker isolate heap measurement and does not prove a port cannot fit 128 MB; it does justify measuring the real population/corpus and avoiding a blanket fit claim. Cloudflare Containers could retain more Node/server behaviour, but its published pricing requires the $5/month Workers Paid plan plus applicable usage; it is not a Free-plan deployment.

The next useful feasibility proof, if commissioned, is a small port covering sign-in/account state, one representative stock release/allocation, concurrent competing claims, replay/recovery and corpus lookup. Measure CPU, memory, durable bytes and database operations at the intended demo population. Preserve existing product behaviour and data; no live reset, migration or release is authorised by this discussion. The simple frontend/proxy move remains the smaller route, while a successful full port could remove the Render dependency.

No Cloudflare build, compatibility harness, deployment, database export or workload benchmark was run. This follow-up uses repository inspection and the official product documentation checked on 13 November 2026:

- [Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
- [D1 overview](https://developers.cloudflare.com/d1/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [limits](https://developers.cloudflare.com/durable-objects/platform/limits/).
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) and [virtual filesystem](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/).
- [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) and [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/).
