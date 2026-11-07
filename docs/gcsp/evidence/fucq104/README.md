# FUCQ-104 scoped evidence, 6 November 2026

Status: blocked at canonical integration and final validation. This evidence covers the additive supply service and shared-kit tracking block with actual published producer modules, explicit synthetic inputs and the memory repository. It does not claim native PostgreSQL, canonical shared runtime/host or live ordering integration.

## Producer identity and assertions

| Producer | Exact commit |
| --- | --- |
| F92 release | `15a79957e61d81612311d3aab7dbf77733dc4e0d` |
| F96 allocator and trusted identity resolver | `d12358bcd02f4c10a5dc9f0851efe94bc2c9d864` |
| F100 hold/offer/outbox | `b4154ce3bfe195564a2d9f17980309d76e545eba` |

The producer proof passed1/1: request and acknowledgement create no stock; the canonical lead time controls queue eligibility; release creates exact stock; the actual allocator creates one hold, offer and outbox record; Greg demand and order tracking update; replay adds no further effects. The published F96 identity resolver exists in that commit and is used in this proof; its canonical shared adoption remains GC's integration work.

## Browser evidence

[Browser report](browser/browser-report.json) records real authenticated HTTPS requests, the control inputs and cleanup. [Contact sheet](browser/visual-review-sheet.png) shows all seven states at1440px and390px. Full screenshots are in `browser/`:

| State | Desktop | Narrow |
| --- | --- | --- |
| Empty | [1440](browser/empty-1440.png) | [390](browser/empty-390.png) |
| Requested | [1440](browser/requested-1440.png) | [390](browser/requested-390.png) |
| Partly confirmed | [1440](browser/partly-confirmed-1440.png) | [390](browser/partly-confirmed-390.png) |
| Delayed remainder | [1440](browser/delayed-1440.png) | [390](browser/delayed-390.png) |
| Confirmed | [1440](browser/confirmed-1440.png) | [390](browser/confirmed-390.png) |
| Released | [1440](browser/released-1440.png) | [390](browser/released-390.png) |
| Production unavailable | [1440](browser/adapter-unavailable-1440.png) | [390](browser/adapter-unavailable-390.png) |

[Desktop shell viewport](browser-shell/shell-viewport-1440.png), [desktop orders in shell](browser-shell/orders-in-shell-1440.png), [narrow shell viewport](browser-shell/shell-viewport-390.png), [narrow orders in shell](browser-shell/orders-in-shell-390.png) and [keyboard focus](browser/keyboard-focus-narrow.png) complete the visual record. The lead inspected all four normal shell viewport images, desktop partial, narrow delayed and the seven-state contact sheet. Density tokens/shared kit, operational density, table scrolling, no page overflow and visible keyboard focus passed in this scope.

The dispatcher identified repeating top content in the two original fullPage embedded-shell images. They are invalid capture evidence and retained byte-for-byte in the launching clone's `red-shell-capture/`, with hashes in `shell-diagnosis.json`. A focused follow-up recorded exactly one dashboard, header, h1, main and orders element at both widths; distinct heading bounds/scroll offsets and four correct viewport captures prove continuous live content. A fresh fullPage diagnostic is also correct. The exact original renderer/capture trigger remains unconfirmed; no duplicate product DOM was found and no product repair was made. [Shell report](browser-shell/shell-report.json) holds that evidence. Human layout review remains deferred to the working end-to-end demo under the experience contract.

The reproducible browser walkthrough uses a dedicated local HTTPS composition: authenticate Greg and retain the separate presenter cookie; submit quantity3 by keyboard; confirm1 by keyboard; delay the outstanding2; confirm the remaining2; advance actual release/allocation; make production unavailable and reload saved tracking. It captures both widths after each stage, checks CSP and collects page/console/network errors. There were zero page errors, console errors or external requests. The controlled provider choices/exact stock are explicit synthetic inputs. No browser state alone proves canonical shared runtime or native execution.

## Validation and resource receipt

The final serial orders/UI/dashboard/clock/demand/ratchet selection passed119/119; the copy guard passed2/2. The earlier storage checkpoint passed45 with2 native skips. Authored `npm test` is still required and has not run for the final identity.

The launching clone retains `.claude/dev-poller-restart-20261105/lead104/validation-plan.json`, exact `runs/targeted-*` and checkpoint records, `producer-proof.mjs`, `browser-proof.mjs`, `run-proof.py` and `final-resource-receipt.json`. The final scoped key is `3ff9d1ca64f2f7fae9def66ac00b81ff0b935c0ab9896f497fc81738a5cce465`. The independent receipt records 19 scratch roots absent, no live owned process groups/reservations or dependency overlays,36765615 bytes recorded scratch removed and106843 bytes successful verbose logs removed. Useful failed logs and concise success tails/hashes remain. Browser profile/cache and ephemeral synthetic HTTPS certificate were bounded local scratch (latest matrix 9167840 bytes; focused shell follow-up 8990465 bytes); all removed. No leftovers.

## Remaining canonical gate

GC-owned runtime/server and Greg host need to register the supply service/routes, inject agreed versioned source choices and F92 release port, adopt the reviewed trusted identity resolver and register the actual release/allocation stages. Gary must apply/prove migration0004 and native foundation snapshots/transactions. The final authored full suite and canonical request→confirm→lead-time tick→release→allocation→demand walkthrough remain required. No producer, central runtime, GC host, package assembly or native credential path was edited here.
# Current host attachment supplement, 6 November 2026

The reusable attachment's helper/UI/dashboard/ratchet selection passes74/74, serially, with zero failures/skips. Three new behavioral regressions use the actual dashboard and order elements to verify remount, refresh and replacement/abort cleanup. Scoped evidence is supplementary; canonical/native/source/full acceptance stays open.

The current authenticated isolated HTTPS harness submits a request, refreshes actual demand and replaces the panel once after an actual dashboard remount while retaining the saved request. Both normal viewport captures were inspected: [1440](browser-attachment/attachment-1440.png), [390](browser-attachment/attachment-390.png). Narrow forms stack and table scroll is contained; live DOM has one shell/panel. Strict self-only CSP produced zero page/console/external errors. [Browser report](browser-attachment/attachment-report.json), [validation/resource summary](attachment-validation-summary.json), [source/runtime handoff](../../fucq104-source-runtime-handoff-2026-11-06.md).

Exact manifests, source hashes, red diagnoses, checkpoints and independent cleanup receipt remain in launching `.claude/dev-poller-resume-20261106/lead104/`: all7roots/groups/reservations and owned overlays absent,18260911recorded scratch bytes removed,7369successful-log bytes trimmed, no leftovers. Bounded local headless profile/cache and synthetic certificate were removed. The first copied proof's fixed midnight session produced expired browser cookies; its red evidence is retained and the proof now issues cookies against actual wall time, with the DemoClock still synthetic. No product authentication changed.

# Integrated demo walkthrough, 7 November 2026

Taken over by Gary Carter. Commits `f67fabfd` (supply service composed in `server/gcsp/runtime.js`, routes in `server/index.js`, demo synthetic upstream in `server/gcsp/stock/demo-provider.js`, launcher `scripts/gcsp-demo.mjs`) and `a4e63519` (order panel mounted in the presenter workspace's Greg dashboard, refresh after presenter clock actions).

Run against the real demo launcher copied to loopback HTTP (memory repository, real runtime, routes, presenter controls and upstream; the browser pane refuses self-signed HTTPS). Headless Chrome over CDP, every interaction a key event, at 1280x900 and 375x812. Driver: `integrated/capture.mjs` (+ `lib.mjs`); report: `integrated/capture-report.json`. Zero console errors, page exceptions or failed requests; no em dash on the page.

| State | Captures (`integrated/`) | Seen |
| --- | --- | --- |
| No requests yet | `empty-1280-panel.png`, `empty-375-panel.png`, `empty-1280-dashboard.png`, `empty-375-dashboard.png` | Empty panel; dashboard with no stock released |
| Requested | `requested-1280-panel.png`, `requested-375-panel.png` | 3 Series Touring 320i, 3 requested, 0 confirmed, 0 released |
| Partly confirmed | `partly-confirmed-1280-panel.png`, `partly-confirmed-375-panel.png` | 2 of 3 confirmed, due 31 Dec 2026 (56-day policy lead time), queued for release |
| Delayed | `delayed-1280-panel.png`, `delayed-375-panel.png` | i5 Touring eDrive40, 1 delayed until 20 Nov 2026 with reason |
| Released | `released-1280-panel.png`, `released-375-panel.png`, `released-375-table-scrolled.png` | Presenter Tick to target 31 Dec: 2 released, outstanding 1 and the delayed i5 never counted |
| Dashboard | `dashboard-before-release-1280.png`, `dashboard-after-cue-tick-1280.png`, `dashboard-after-release-1280.png` | Stock and demand reload after each presenter action with no Refresh press |
| Keyboard focus | `focus-visible-375.png` | Visible focus ring on Submit request |

Adapter unavailable is not producible on the real server without a code change; it remains covered by `browser/adapter-unavailable-*.png` and `server/test/gcsp-greg-orders-ui.test.js`.
