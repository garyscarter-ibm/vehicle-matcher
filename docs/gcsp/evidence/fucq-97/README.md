# FUCQ-97 presenter outbox viewer: rendered evidence

Story DEV-2026-11-04-062 (Jira FUCQ-97, Epic FUCQ-88). Rendered evidence for the presenter-only captured email viewer inside the GCSP shell.

- **Path:** `gcsp-outbox.html` (harness), `blocks/gcsp/presenter/` (viewer, `messageList`, adapter, fixtures, styles), `server/gcsp/notify/http.js` (route). Gallery: `components.html`, "GCSP". Contract: `docs/gcsp/presenter-outbox-contract.md`.
- **Revision:** `<rev>` (to be filled in by the story lead). `fucq-97-browser-matrix.json` records the full HEAD it was captured at, the SHA-256 of each source file and every check result.
- **How to reproduce:** `npm run serve`, then open `http://localhost:3000/gcsp-outbox.html?fixture=<name>` with `<name>` one of `messages`, `empty`, `retrying`, `failed`, `unavailable`, `refused`, `loading`. `capture-fucq-97.mjs` re-runs every capture in headless system Chrome: set `PLAYWRIGHT_CORE` to a playwright-core `index.mjs` and `BASE` to the static server.
- **Data:** synthetic and labelled fictional. Fixture HTML and text follow the shape of `renderOfferMessage` output but are static strings.

## Captures (1280x900 desktop, 320x740 narrow)

| File | Shows |
|---|---|
| `messages-desktop.png`, `messages-narrow-320.png` | List newest first: sent, retrying (2 attempts), failed (3 attempts) and a sent email with a very long name. Each row has recipient, subject, demo-clock time and status as text plus icon. |
| `message-open-desktop.png`, `message-open-narrow-320.png` | Opened by keyboard only (Tab to the first row, Enter): focus moves to the message heading. Offer link, sandboxed HTML frame, plain-text version. |
| `message-retrying-open-*.png`, `message-failed-open-*.png` | Retrying and failed messages opened by keyboard: error in plain words, attempt count and next attempt time (retrying), no frame or link. |
| `retrying-*.png`, `failed-*.png` | Fixtures holding only those messages. |
| `empty-*.png` | No messages yet. |
| `unavailable-*.png` | Source unavailable with Retry. |
| `refused-*.png` | Refused for a non-presenter or a stale run. |
| `loading-*.png` | Loading state (the fixture never resolves). |
| `reduced-motion-desktop.png` | `prefers-reduced-motion: reduce`; computed transition durations are in the matrix. |
| `gallery-messagelist-desktop.png`, `gallery-messagelist-narrow-320.png` | The `messageList` example in the GCSP gallery section. |

All 23 captures reported no horizontal overflow, no console or page errors, no failed requests and no external requests. The matrix records the keyboard path (tabs to the first row, focused element before and after Enter, focus outline) and the frame and link attributes (`sandbox=""`, `referrerpolicy=no-referrer`, `target=_blank`, `rel=noopener`).

## Limitations

- The captures use fixtures. The real route and its role, run and reset checks are covered by `server/test/gcsp-outbox-route.test.js`, not by a browser run against the API.
- Offer links in fixtures point at `/gcsp/offer`, which does not exist yet (FUCQ-89 owns the offer page), so clicking the link was not exercised in a browser.
- Chrome only; no Safari or Firefox check.
- Screenshots of the sandboxed frame show the fixture email, not output from a live dispatcher.
