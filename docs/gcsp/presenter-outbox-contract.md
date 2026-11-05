# GCSP presenter outbox contract

FUCQ-97 (DEV-2026-11-04-062). A presenter-only viewer for the captured offer emails of FUCQ-93 ([captured-outbox.md](captured-outbox.md)). It sends nothing and creates no token or link; it only displays what the dispatcher stored.

## Route

`GET /api/gcsp/presenter/outbox`, built by `createOutboxRoutes(outbox)` in `server/gcsp/notify/http.js` and composed as `buildServer({ gcspOutbox: { repository } })`. Role `presenter`, purpose `presenter-control`, `Cache-Control: no-store`.

| Case | Reply |
|---|---|
| Presenter cookie, current run | 200 `ok` with `{ runId, messages }`, newest first by `time` (nulls last, then `jobId`) |
| No cookie, employee or Greg cookie | 403 `forbidden` |
| Cookie from before a reset | 409 `stale-run` |
| Any query parameter or body | 400 `invalid`, `unsupported-query` |
| `gcspOutbox` or its repository missing | 503 `unavailable`, retryable |
| Repository unavailable | passed through (503) |

Each message: `jobId, messageKind, state, attempts, error` (a fixed code or null), `nextAttemptAt, time` (`capturedAt` when sent, else `attemptedAt`, else null), `recipient { employeeId, name }`, `subject, textBody, htmlBody, offerLink` (null until rendered). `stale` rows are left out. `payload`, `idempotencyKey` and `inputDigest` never leave the server. After a reset the new run has no messages.

## Element

Tag `gcsp-outbox`, light DOM, `defineGcspOutbox(registry = customElements)` in `blocks/gcsp/presenter/gcsp-outbox.js` (idempotent; `register.js` calls it).

| Attribute or property | Meaning |
|---|---|
| `fixture` | Name from `FIXTURE_NAMES` in `fixtures.js`: `messages`, `empty`, `retrying`, `failed`, `unavailable`, `refused`, `loading`. An unknown name renders unavailable. |
| `adapter` | `{ loadMessages({ signal }) -> Promise<state> }`; takes precedence over `fixture`. `createOutboxHttpAdapter({ base, fetchImpl })` in `http-adapter.js` is the HTTP one (`credentials: 'include'`). |

State: `{ status: 'ready', messages }`, `{ status: 'empty' }`, `{ status: 'unavailable', message }` or `{ status: 'refused', message }`. `outcomeToState(httpStatus, body)` maps 200 to ready or empty, 401/403 and 409 `stale-run` to refused, everything else to unavailable. Events on the element (`bubbles`, `composed`): `gcsp:ready` `{ view: 'outbox' }` and `gcsp:unavailable` `{ reason }` (`no-adapter`, `unknown-fixture` or `source-unavailable`). `mountOutbox(root, { loadMessages, signal, onUnavailable })` is the function form and returns a teardown with `refresh()`. There are no timers or polling; the Refresh button reloads.

## Message view

Rows are buttons (recipient, subject, demo-clock time, status as text and icon). Opening one moves focus to its heading and shows the HTML body in an `<iframe sandbox="">` (no scripts, no same-origin, no popups) set through `srcdoc`, the plain-text alternative in a wrapping `<pre>`, and the offer link as `target="_blank" rel="noopener"` only when it is a single-slash path or an `https:` URL with no credentials; otherwise "Offer link not available". Retrying and failed messages show the safe error as a sentence (`outbox-copy.js`, one table), the attempt count and, for retrying, the next attempt time. Times read like `5 Nov 2026, 09:20 GMT` and are labelled "Demo clock".

## Embedding rules

Same as the [employee entry](employee-entry-contract.md): no inline script bodies, `on*=` attributes, `eval`, `new Function`, string timers or HTML string injection; the element never reads location. Harness: `npm run serve`, then `/gcsp-outbox.html?fixture=<name>`.
