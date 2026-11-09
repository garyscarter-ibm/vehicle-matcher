# GCSP demo performance review, 9 Nov 2026 (FUCQ-247)

Story DEV-2026-11-09-GC-030. Two runs. Run 1 (below) covers start-up memory, the presenter controls, Paula's
employee journey and her offer decisions. Run 2 covers Greg's dashboard, the 1,000-employee comparison and its
worker heap, stock pulls, the outbox, order progress and hosted unauthenticated timing.

Nothing in product code, policy, fixtures or config was changed. The story names `docs/gcsp/reviews/`; this
file sits where the dispatcher asked.

## Run 1

### How it was measured

- **Where and when:** locally on Gary's Mac (macOS, 10 CPUs, Node v26.5.0, Chrome 157 headless), 9 Nov 2026
  15:46 to 16:05 UTC, branch `dev/DEV-2026-11-09-GC-030` at `5077866e`. The host ran as Render does it, but
  offline: `node index.js` in `server/`, `GCSP_RUNTIME=1`, `GCSP_REPOSITORY_MODE=memory`, `GCSP_OFFLINE=1`, a
  random local demo key, ports 9281 to 9287. Nothing was measured on the hosted demo in run 1 (see "Not measured").
- **Runs:** 3 desktop runs (1280x900, no throttling) and 3 phone runs (375x812, 4x CPU slowdown, 150 ms RTT,
  1.6 Mbit/s down, 750 kbit/s up). Each run starts a **cold** server and a fresh Chrome profile, then walks the
  steps once. At the end it reloads four pages again in the same server and browser: those rows are **warm**.
  Figures are medians, with the min to max range in brackets. The spread was small: most ranges are within 10%.
- **Order:** the manual journey ran on the fresh host before any reset, as the FUCQ-70 walkthrough does. Then
  Reset to Main successful journey, Tick, Reset to Decline then change, switch to Paula, and her offer flow
  (decline with Body style, change to Saloon, Tick, open the second offer, accept). The findings are reported in
  demo order.
- **Per step:** the wall time from the action until the step's main control was usable, plus navigation timing,
  FCP and LCP for page loads. Long tasks over 50 ms were recorded with a `PerformanceObserver`. Every browser
  request was counted with its encoded bytes. A preload probe (`server-probe.mjs`) timed every request on the
  server and sampled RSS, heap, CPU and event-loop delay every 250 ms.
- **Evidence:** `docs/gcsp/evidence/fucq-247/`: `perf-run1.mjs` (journey runner and `summarise`),
  `server-probe.mjs`, `api-floor-profile.mjs`, `results-{desktop,phone}-{1,2,3}.json` (raw, per run),
  `summary.json` (medians and ranges), `startup-{1,2,3}.json` (start-up only) and `api-floor.json` (per-call
  cost and the CPU profile summary).

### Journey at a glance (cold, median)

| Step (demo order) | Desktop | Phone | Server time in step (desktop) |
|---|---|---|---|
| Sign-in: key page usable | 40 ms | 0.41 s | 0 |
| Sign-in: key, Enter, workspace "Your cars" usable | 1.06 s (FCP 0.34 s) | 6.77 s (FCP 6.33 s) | 0.45 s, 9 calls |
| Presenter: Tick (fresh run) | 1.00 s | 1.32 s | 0.85 s |
| Presenter: page load | 1.00 s | 7.14 s (FCP 6.14 s) | 0.91 s, 14 calls |
| Presenter: Reset to Main successful journey | 1.20 s | 7.63 s | 0.83 s |
| Presenter: Reset to Decline then change | 2.47 s | 8.93 s | 2.13 s |
| Presenter: Switch principal to Paula | 1.51 s | 7.72 s | 1.32 s |
| Presenter: Next release | 1.43 s | 2.02 s | 1.24 s |
| Paula: account page load | 0.84 s | 5.05 s (FCP 4.64 s) | 0.42 s, 8 calls |
| Paula: Choose a replacement, setup usable | 1.33 s [0.82-1.33] | 1.38 s | 0.91 s, 15 calls |
| Paula: Save choices | 0.22 s | 0.26 s | 0.31 s |
| Paula: Continue, gallery usable | 1.16 s | **15.45 s** | 0.91 s, 1.96 MB |
| Paula: Review this car | 1.33 s | 1.34 s | 0.89 s |
| Paula: reload, account offers Resume | 0.82 s | 5.06 s | 0.46 s |
| Paula: Resume saved journey, review usable | 1.83 s | 2.42 s | 1.66 s, 22 calls |
| Paula: Continue to order review | 2.33 s [1.82-2.33] | 2.87 s | 1.79 s, 17 calls |
| Paula: Submit order, outcome | 0.65 s | 0.80 s | 0.56 s |
| Paula: Finish, account | 0.80 s | 1.35 s | 0.91 s |
| Offer: Buddy activity load | 1.32 s | 4.25 s | 1.24 s |
| Offer: outbox load, open the email | 0.32 s | 2.47 s | 0.32 s |
| Offer: offer link, page usable | 0.72 s | 4.27 s (FCP 3.58 s) | 0.65 s |
| Offer: Decline, reasons loaded | 0.23 s | 0.25 s | 0.22 s |
| Offer: Confirm decline (Body style), question shown | 0.82 s | 1.34 s | 0.54 s |
| Offer: Confirm this change (Saloon) | 0.25 s | 0.28 s | 0.17 s |
| Presenter: Tick, second offer made | 1.96 s | 3.58 s | 1.82 s |
| Offer: second offer link, page usable | 0.87 s | 4.33 s | 0.76 s |
| Offer: Accept, accepted | 0.69 s | 1.16 s | 0.68 s |
| Warm reload: presenter / account / activity / offer | 1.83 / 1.86 / 1.84 / 0.60 s | 8.49 / 6.05 / 4.79 / 4.25 s | 1.69 / 1.75 / 1.69 / 0.55 s |

All 34 steps passed in all 6 runs. Full figures, with ranges, are in `summary.json`.

### Findings, ranked by demo impact

**1. Every API call deep-copies the whole demo state, one call at a time, so every click waits 0.2 to 2.1 s on the server.**
- *Step:* every step in every journey. On desktop, 70 to 90% of a step's wall time is API server time, for
  example Continue to order review (2.33 s wall, 1.79 s server, 17 calls), Resume (1.83 s, 1.66 s, 22 calls)
  and the presenter page (1.00 s, 0.91 s, 14 calls).
- *Measurement:* `api-floor.json`, local, fresh run, warm process, 30 calls each, measured sequentially.
  Median server time per call: `context` 22 ms (583 B), `offers/current` 34 ms (63 B), `manual/draft` 78 ms
  (a 78 B 404), `manual/account` 74 ms, `presenter/controls` 90 ms. The nine calls a workspace load makes take
  411 ms [404-447] when fired together, against 435 ms as the sum of the sequential medians. So there is no
  concurrency at all. The cost also grows as the demo state grows. The same presenter page needs 0.91 s of
  server time cold and 1.69 s warm after the journeys (desktop); `presenter/controls` goes from 90 to 156 ms,
  and `manual/account` from 74 to 134 ms.
- *Cause:* the hosted runtime builds its memory repository with the default `snapshot = 'deep'`
  (`server/gcsp/runtime.js:56`, `server/gcsp/repository/memory.js:9`). Every `read()` and `transaction()` runs
  `cloneJson(store.state)` over the entire state inside one serialised queue (`memory.js:13-37`). The CPU profile
  of the read-only phase puts **91.2% of server CPU in `cloneJson`** (`server/gcsp/repository/core.js:7`, 19.0 s
  of 20.8 s), with garbage collection a further 1.3%.
- *Change:* give the hosted runtime's reads a snapshot that doesn't copy every row. Shallow snapshots exist
  already, and the comparison harness uses them (`server/gcsp/comparison/harness.js:188`). Or use copy-on-write
  for transactions, and avoid the extra repository reads per request.
- *Effort:* M. *Risk:* medium. Shallow snapshots share row objects, so any service that mutates a row in place
  would leak changes across transactions or survive a rollback. It needs the repository conformance tests and an
  audit for in-place mutation. *Expected gain:* most of the 22 to 90 ms floor per call. That is an estimate,
  not measured: it should take desktop step times from about 1 to 2 s down to a few hundred ms, and it removes
  the slowdown as the demo state grows.

**2. Pages download 0.6 to 1.15 MB of uncompressed, uncacheable CSS and JS on every load, so a phone waits 4.6 to 6.3 s for first paint.**
- *Step:* every page load: sign-in workspace, presenter page, account, activity, outbox, offer link. Phone FCP
  is 6.33 s for the workspace, 6.14 s for the presenter page, 4.64 s for the account, 3.58 s for the offer link
  and 2.16 s for the outbox. Phone usable times are 6.8, 7.1, 5.0, 4.3 and 2.5 s. The warm reload is no faster
  (presenter 8.49 s, account 6.05 s), because nothing is cached.
- *Measurement:* the presenter workspace load makes 141 to 148 requests, 1.07 to 1.15 MB, and none is
  compressed. Of those, 49 are CSS (294 KB) and 82 are JS modules (683 KB). Each run serves 1,821 to 1,825
  requests and 12.4 MB of static files, against about 275 API calls. Browser CPU is not the cause: even at 4x
  slowdown, long tasks total 53 ms on the workspace and 0 on most other pages.
- *Cause:* `createGcspFront` serves every static file with `Cache-Control: no-store` and no compression
  (`server/gcsp/host.js:149-151`). The presenter page also links 13 stylesheets, including the retail
  `blocks/vehicle-matcher/vehicle-matcher.css` (168 KB), and loads Greg's plan and publish panels and retail
  `result-card.js` and `brand-copy.js` modules on Paula's screens (`gcsp-presenter.html:7-19`). ES modules are
  discovered import by import, so each level of the graph adds a round trip.
- *Change:* (a) gzip or brotli for static files and JSON. Gzipped, the repo's GCSP JS and CSS shrink to 0.32 of
  their size (1,109 KB to 357 KB over 179 files). (b) Make static assets revalidatable (`no-cache` with an ETag
  or Last-Modified) while the HTML pages stay `no-store`. (c) Trim each page's CSS and JS graph: load the Greg
  and retail modules only where they're used, and add `modulepreload` for the first screen.
- *Effort:* S for (a) and (b) in `host.js`; M for (c). *Risk:* low for compression. Caching risks a stale asset
  after a deploy, which revalidation avoids. *Expected gain:* an estimate, not measured: phone FCP from about
  6 s to 2 to 3 s, and warm loads close to API-bound times. On the hosted demo, the presenter laptop pays the
  same 140-plus round trips over the internet (not measured in run 1).

**3. On a phone the gallery takes 15.4 s to open: it downloads 960 KB of stock twice for 6 cards.**
- *Step:* Paula, Continue to the Released cars gallery. Desktop 1.16 s [1.13-1.23]; phone 15.45 s
  [15.38-15.80], with a 119 ms long task.
- *Measurement:* `GET /api/gcsp/manual/stock` returns 960,384 bytes (185 to 280 ms on the server) and is
  fetched **twice** while the gallery opens, so 1.96 MB in that step. Resume fetches it again (the step moves
  1.2 MB). The gallery shows 6 cards.
- *Cause:* not isolated in run 1. The payload is far larger than 6 cards need, and the duplicate fetch comes from
  the gallery mount. Run 2 covers stock pulls and should name what fills the 960 KB.
- *Change:* dedupe the fetch, return only the card fields for the cars the gallery shows, and compress JSON (see
  finding 2). *Effort:* M. *Risk:* low to medium (the review and claim paths read the same stock).
  *Expected gain:* phone gallery from 15 s to about 2 s (an estimate, not measured).

**4. Tick, Reset and Next release hold the server for up to 1.8 s, during which nothing else is answered.**
- *Step:* presenter controls throughout the demo.
- *Measurement:* desktop server time and the largest event-loop delay in each step: Tick 0.85 s (fresh run),
  1.12 s (after the reset) and 1.82 s (when the second offer is made), with largest delays of 0.65, 0.71 and
  1.50 s. Next release took 1.24 s (0.75 s delay), Reset to Decline then change 2.13 s (one 1.82 s block) and
  Switch principal 1.32 s. On the phone these are 1.3 to 3.6 s for a tick and 7.6 to 8.9 s for a reset with its
  page reload. The controls readback grows over the run: 17.9 KB fresh, 50 KB after the release, 84 KB in the
  offer flow, and 160 KB after the third tick, when the tick response alone is 158 KB.
- *Cause:* partly finding 1 (each transaction deep-copies the state), plus the tick's handler work inside one
  synchronous stretch. Why the readback grows wasn't isolated: the scripted ticks in `api-floor-profile.mjs`
  were refused with 400, so the size breakdown covers only a fresh run.
- *Change:* profile one tick and one reset (`--cpu-prof`), split the long synchronous stretch, and cap the
  readback (a summary of the last tick, with the details on demand). *Effort:* M. *Risk:* medium (tick ordering
  is a state machine). *Expected gain:* ticks under 0.5 s, and a second tab (outbox, offer) stays responsive
  during a tick. Both are estimates.

**5. Each screen change re-reads the presenter strip as a two-step waterfall, repeating the same calls up to 4 times.**
- *Step:* in-workspace screen changes (setup, gallery, review, Resume, order review) and the activity page.
- *Measurement:* Resume makes 22 calls, including three identical sets of `presenter/controls` (50 KB),
  `manual/account`, `context`, `presenter/scenarios` (18 KB), `scenarios/faults` and `manual/claim`. The
  activity page fetches `presenter/controls` 4 times (84 KB each) in one load.
- *Cause (likely):* the workspace re-mounts the portal shell for each screen (`blocks/gcsp/presenter-controls/workspace.js:55`,
  `blocks/gcsp/shell/portal-shell.js:211`). Each mount runs `refreshState()` (`blocks/gcsp/presenter-controls/controls.js:344`),
  which reads the controls first and only then reads the context, scenarios and faults (`controls.js:229-250`).
- *Change:* keep the strip mounted, or reuse its last readback across screen changes in the same page. Read the
  four in parallel, and fetch the scenario catalogue once per page. *Effort:* S to M. *Risk:* low (the strip
  must still refresh after its own actions). *Expected gain:* about 5 fewer calls and one fewer round trip per
  screen change. Each call costs 22 to 156 ms of serialised server time (finding 1).

**6. Start-up takes 20 s, with the event loop blocked for up to 1.35 s; memory is fine.**
- *Measurement:* `startup-{1,2,3}.json`: the server is listening at 10.7 s [10.7-10.8] and
  `/health/vehicle-evidence` returns 200 at 20.1 s [19.9-20.2], after 20.7 s of CPU. The largest event-loop
  delay is 1.24 to 1.35 s. On the hosted demo, every push to `gcsp-poc` restarts the service, so the demo is
  down for at least this long, plus Render's slower CPU. The freeze before the demo mitigates it.
- *Change:* none needed for Thursday. Keep the freeze, and warm the demo 30 minutes before it, as the
  walkthrough says.

### Measured and fine

- **Start-up memory (FUCQ-190):** peak RSS (process `maxRSS`) for start-up alone, ready plus 15 s idle, was
  279, 280 and 283 MiB, against FUCQ-190's 350 MiB after its fix. Heap used at ready was 44 to 106 MiB.
- **Memory through the journeys:** whole-run peak RSS was 316 MiB [312-360] desktop and 283 MiB [277-283] phone,
  against FUCQ-190's 441 to 455 MiB through the first journey. The heap peaked at 182 MiB. That leaves about
  150 MiB of headroom under 512 MiB, with no growth trend across the run. Two caveats: this is Node 26 locally,
  not Render's Node 20, and `render.gcsp.yaml` currently sets `plan: standard` (2 GB), not 512 MiB.
- **Browser main thread:** no long tasks on desktop in any step. On the phone (4x CPU), 53 ms on the workspace
  load, 119 ms on the gallery and none elsewhere. The client JS is not the bottleneck.
- **Offer decisions:** reasons 0.23 s, Confirm decline 0.82 s, Confirm this change 0.25 s and Accept 0.69 s on
  desktop; 0.25, 1.34, 0.28 and 1.16 s on the phone.
- **Save choices** (0.22 s) and **Submit order** (0.65 s desktop, 0.80 s phone). The key page is 40 ms desktop
  and 0.41 s phone, and the outbox 0.32 s desktop.
- **Seen in passing:** the only 4xx responses were the designed ones: 404s for `manual/draft`, `manual/order`
  and `manual/claim` before they exist, and one 400 on `manual/stock` after Next release moves the collection
  window (the FUCQ-70 walkthrough notes it as designed). No 5xx. The outbox and order progress were loaded only
  as part of this flow; their own timing is run 2's.

### Not measured in run 1

- **Hosted Render timing:** the authenticated journeys need the demo key, which this review may not use. Render
  CPU is likely slower than this Mac, so the server-bound steps (findings 1 and 4) should be re-timed there once
  the key-holder runs `perf-run1.mjs` against a local copy of Render's settings, or adds hosted timing. Run 2
  covers unauthenticated hosted timing.
- **Node 20:** memory and CPU were measured on Node 26 only. Render runs Node 20.
- **Real devices and networks:** the phone figures are Chrome emulation (4x CPU, 150 ms RTT, 1.6 Mbit/s), not a
  real handset.
- **Causes left open:** what fills the 960 KB stock payload, why the controls readback grows, and the CPU
  breakdown of a tick or a reset. Each needs one targeted profile, named in finding 3 or 4.
- **Excluded:** PostgreSQL mode (not used by the demo), Brevo email delivery (offline), and everything in run 2's
  scope.

### Recommended tickets (for the dispatcher to raise)

1. Bug, M: hosted memory repository deep-copies the whole state on every API call (91% of server CPU), so use shallow or copy-on-write snapshots.
2. Story, S: gzip or brotli for GCSP static files and JSON responses in `host.js` and the API.
3. Story, S: make GCSP static assets revalidatable (ETag and `no-cache`) instead of `no-store`, keeping pages `no-store`.
4. Story, M: the gallery fetches the 960 KB `manual/stock` twice for 6 cards, so dedupe it and send card fields only.
5. Story, M: profile and shorten the Tick and Reset event-loop blocks (up to 1.8 s), and cap the controls readback growth (18 to 160 KB).
6. Story, S to M: keep the presenter strip's readback across in-workspace screen changes, and read controls, context and scenarios in parallel.
7. Story, M: trim each GCSP page's CSS and JS graph (retail CSS 168 KB, Greg panels on Paula's screens) and lazy-load per screen.
8. Task, S: re-measure start-up and journey memory on Node 20 (Render) before changing the plan from standard (2 GB) to 512 MiB.
