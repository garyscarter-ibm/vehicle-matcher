# GCSP demo performance review, 9 Nov 2026 (FUCQ-247)

Story DEV-2026-11-09-GC-030. Two runs. Run 1 covers start-up memory, the presenter controls, Paula's employee
journey and her offer decisions. Run 2 covers Greg's dashboard, the 1,000-employee comparison and its worker heap,
stock pulls, the outbox, order progress, the tick's CPU and readback, and hosted unauthenticated timing.

Nothing in product code, policy, fixtures or config was changed. The story names `docs/gcsp/reviews/`; this
file sits where the dispatcher asked.

## Summary across runs

Ranked by what the presenter or Paula would notice first. Figures are local medians (desktop 1280x900 / phone
375x812 with 4x CPU and a 1.6 Mbit/s, 150 ms network) unless marked hosted. "R1-n" and "R2-n" are the tickets
at the end of each run.

| # | What they notice | Evidence | Cause | Ticket |
|---|---|---|---|---|
| 1 | Every click waits 0.2 to 2.4 s on the server, longer as the demo goes on | Run 1 finding 1; run 2: Greg's dashboard 1.31 s of server time for 12 calls, a tick 0.63 to 0.71 s on a fresh run | Each API call deep-copies the whole demo state: 91% of read CPU and 90% of tick CPU is `cloneJson` | R1-1 |
| 2 | On a phone, every page takes 2.2 to 6.3 s to first paint, and Greg's dashboard 7.6 s to settle | Run 1 finding 2; run 2 finding 2 (Greg FCP 6.2 s, order progress 3.7 s, outbox 2.2 s) | 140-plus uncacheable static requests per page (`no-store`). Hosted, Render already serves Brotli, so caching and trimming are the levers there, not compression | R1-3, R1-7 (R1-2 for local only) |
| 3 | Paula's gallery takes 15.5 s to open on a phone | Run 1 finding 3; run 2 finding 3 | 960 KB of stock JSON for 6 cards, fetched twice: 71% of it is repeated copies, 40% one 12 KB version map copied into all 32 records | R1-4, now with the fields to drop |
| 4 | The default 1,000-employee comparison always fails, after about 3 minutes | Run 2 finding 1: 3 of 3 runs out of memory at 174 to 189 s, step 1 of 6 | The buddy-route replay keeps about 1 GB live; with 2 GB it finishes in 27.6 min, 92% of the 30-minute limit | R2-1, R2-2 |
| 5 | Tick, Reset and switching principal freeze the demo for 1 to 2.7 s | Run 1 finding 4; run 2 findings 2 and 4 (Greg tick 2.14 s with a 1.06 s event-loop block) | Finding 1's copying, plus a controls readback that grows to 108 KB because it echoes the buddy-allocation outcome (85.5 KB) | R1-5, R2-3 |
| 6 | Greg's "Next order plan" says it is unavailable after Paula's order | Run 2 finding 2: `greg/order-plan` 503 in 7 of 7 runs; 1.08 s when it answers | Not isolated (functional) | R2-4 |
| 7 | Each screen change re-reads the presenter strip | Run 1 finding 5; order progress and Greg's page repeat `manual/account`, `context`, `orders/progress/all` | Strip re-mount per screen | R1-6 |
| 8 | A redeploy takes the demo down for 20 s or more | Run 1 finding 6 | Start-up CPU | none (keep the freeze) |

Memory is fine for the demo on the 2 GB plan: whole-run peak RSS was 277 to 416 MiB, and 393 to 410 MiB while a
comparison job ran. Raising the comparison worker's heap to the 1.5 GB it needs would take the process close to
2 GB, so a bigger heap alone is not the fix for item 4.

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

## Run 2

### How it was measured

- **Where and when:** locally on the same Mac (Node v26.5.0, Chrome 157 headless), 9 Nov 2026 16:07 to 16:58 UTC,
  branch `dev/DEV-2026-11-09-GC-030` at `e0cef26a` (run 1's head with the latest `gcsp-poc` merged). The host ran
  as in run 1 (`GCSP_RUNTIME=1`, memory repository, `GCSP_OFFLINE=1`, a random local key), ports 9281 to 9284.
  Hosted figures come from `https://gcsp-api.onrender.com` (the `GCSP_PUBLIC_ORIGIN` in `render.gcsp.yaml`),
  23 unauthenticated requests, one at a time, at 16:14 UTC. No demo key was used, asked for or typed.
- **Browser journeys** (`perf-run2.mjs`, run 1's helpers): a cold host per run, sign-in, Paula's manual journey
  to a placed order (not re-reported; run 1 has it, but it is what gives order progress something to show and
  captures the stock payload), then order progress, a tick, order progress again, Switch principal to Greg,
  Greg's page load, Refresh queue, comparison Reload, a tick from Greg's page, Reset to Decline then change, the
  outbox, a tick, the outbox again, and warm reloads. 4 desktop runs and 3 phone runs (same throttling as run 1).
  A step ends when its main region has real content, no loading copy and no change for 400 ms. Medians with the
  min to max range in brackets; ranges were within 10% except where shown.
- **Comparison job** (`comparison-job.mjs`): 3 cold hosts; Greg's session starts the default job
  (`experimentId: process-only`, the policy's 3 seeds over a 1,000-employee cohort) through
  `POST /api/gcsp/comparison/jobs` and polls `jobs/latest` every 2 s as the panel does. `server-probe-run2.mjs`
  samples the worker's own heap (`worker.getHeapStatistics()`) every 250 ms, and `/health` is pinged every 200 ms to
  test the main event loop.
- **Comparison heap cause** (`comparison-worker-heap.mjs`, `comparison-heap-wrapper.mjs`): the real
  `server/gcsp/comparison/worker.js` alone in a worker under V8's sampling heap profiler, once at the policy's
  128/16 MB limits and once at 2,048/16 MB with a forced full GC before each capture, so each capture shows what a
  step keeps. Captures are taken at each progress step.
- **Tick** (`tick-profile.mjs`): a fresh host under `--cpu-prof`, 8 Ticks (mode `step`) through the API, with the
  controls readback after each. The largest controls readback in the browser journey was also taken apart.
- **Noise:** a UI review drove another Chrome on this Mac during the window; its browser was idle (3.6% CPU) when
  sampled at 16:30. My own jobs overlapped: comparison jobs 2 and 3 ran alongside desktop runs 1 to 3, and the
  2 GB worker run alongside the phone runs and the tick profile. Load average was 7.6 to 9.7 on 10 CPUs. Desktop
  timings agree across runs that did and did not overlap (desktop run 4 ran alone), so the overlap is within the
  spread. The 2 GB worker's duration is the figure most affected.
- **Evidence:** `docs/gcsp/evidence/fucq-247/`: `results2-{desktop-1..4,phone-1..3}.json`, `summary-run2.json`
  (medians, ranges, stock and controls payload anatomy), `comparison-job-{1,2,3}.json`,
  `comparison-worker-128-16-profile.json`, `comparison-worker-2048-16-profile-gc.json`, `tick-profile.json`,
  `hosted-timing.jsonl`, and the scripts named above plus `hosted-timing.sh`. CPU profiles and probe logs stayed in
  scratch and were deleted.

### Journeys at a glance (cold host, median)

| Step (demo order) | Desktop | Phone | Server in step (desktop) |
|---|---|---|---|
| Greg: Switch principal to Greg, dashboard settled | 2.48 s | 9.34 s (FCP 6.24 s) | 1.93 s, 20 calls, 276 KB |
| Greg: page load, every region settled | 1.38 s | 7.57 s (FCP 6.24 s) | 1.31 s, 12 calls, 169 KB; 146 requests, 1.19 MB |
| Greg: Renewal cases, Refresh queue | 0.13 s | 0.26 s | 57 ms, 1 call |
| Greg: Route comparison, Reload | 0.13 s | 0.25 s | 94 ms, 2 calls |
| Greg: Tick from the dashboard, all regions refreshed | 2.14 s | 3.29 s | 2.05 s, 8 calls; event loop blocked 1.06 s |
| Comparison: default job, start to failure | 178 s [174-189] | n/a | worker heap 123 MiB of 128; RSS 393-410 MiB |
| Stock: Continue to the gallery (run 1's step, re-timed) | 1.24 s | 15.50 s | 1.02 s; `manual/stock` 960 KB, twice |
| Order progress: page load | 1.10 s | 4.83 s (FCP 3.66 s) | 0.92 s, 14 calls, 138 KB |
| Order progress: Tick with an order placed | 1.45 s | 2.67 s | 1.34 s |
| Order progress: reload after the tick | 1.12 s | 4.84 s (FCP 3.42 s) | 1.05 s, 14 calls |
| Presenter: Reset to Decline then change (from Greg) | 2.73 s | 9.79 s | 2.38 s; the reset call alone 2.02 s [2.00-2.53] |
| Outbox: load, open the offer email | 0.45 s | 2.45 s (FCP 2.17 s) | 0.44 s, 6 calls; 45 requests, 490 KB |
| Outbox: after a tick | 0.54 s [0.43-0.64] | 2.44 s | 0.44 s |
| Warm reload: order progress / outbox | 0.61 / 0.47 s | 3.30 / 2.38 s | 0.58 / 0.47 s |

All steps passed in every run except the planned warm reload of Greg's page, which failed in all 7 runs by
design of the order: the reset before the outbox makes the presenter page open as Paula, not Greg. Greg's page
load above is already on a warm host (it follows the switch). The order plan Preview step was skipped in every
run because the plan was unavailable (finding 2). No browser long tasks anywhere except the gallery on the phone
(116 ms), as in run 1.

### Findings, ranked by demo impact

**1. The default 1,000-employee comparison fails every time, after about 3 minutes; it needs about 1.5 GB and 28 minutes to finish.**
- *Step:* Greg's route comparison, when a run is started live. The panel's own button runs the hold sweep (not
  measured, see gaps); the default `process-only` job is what the presenter API starts.
- *Measurement (local, cold host, 3 runs):* the job failed in 3 of 3 runs with "The comparison used more than its
  128 MB memory allowance and was stopped." after 178 s [174-189]. It had finished 1 of 6 steps (the current route
  for seed a, at 150 to 161 s) and died in the buddy route for the same seed. Worker heap peaked at 123 MiB used
  (V8 limit 152 MiB with the 16 MB young generation). Process RSS went from 152-269 MiB before to 393-410 MiB
  during the job (max RSS 395 to 415 MiB), against FUCQ-175's 428 MB.
- *Main event loop stays responsive:* `/health` every 200 ms answered in 2.1 ms at the median and 6.4 to 13.3 ms at
  p95 during the job, max 20 to 193 ms (5 of 922 pings over 100 ms in one run). The panel's 2 s poll of
  `jobs/latest` took 38 to 42 ms. The worker thread does keep the demo usable while it runs.
- *What it needs (worker alone, 2,048 MB heap):* the job succeeded in 1,656 s (27.6 min, 92% of its 1,800 s
  limit), with a peak worker heap of 1,461 MiB and process RSS of 1,692 MiB. The three current-route steps took
  160 to 180 s each, the three buddy-route steps 358 to 404 s each. This run had the sampling profiler and forced
  GCs on and overlapped the phone runs, so its time is an upper estimate.
- *Cause (heap profile):* after a full GC at each step boundary, the worker keeps 58 MiB after the first current
  route, but 986 MiB after the first buddy route and 495 MiB after the last. The sampled live heap at the buddy
  boundary is 554 MiB: 402 MiB (73%) allocated by `cloneJson` (`server/gcsp/repository/core.js:7`), 91 MiB by
  `structuredClone`, with `evaluateRecommendation` (`server/gcsp/recommendation/index.js:58`) the largest calling
  site at 76 MiB. In the replay's shallow memory repository (`server/gcsp/comparison/harness.js:188`), the
  long-lived `cloneJson` copies are the stored rows (`core.js:201`, `core.js:229`) and the deep copy of every
  committed transaction's outcome, which `event_receipts` keeps for the run's life (`core.js:399-401`). The
  buddy route's outcomes carry recommendation evaluations per employee, so the receipts are the likely bulk. The
  sampling profile does not separate rows from receipts; a heap snapshot's retainer path at the buddy boundary
  would.
- *Change:* (a) For Thursday, don't start the default comparison live: show a stored result prepared offline
  (the panel already says "prepare it offline"). (b) Stop the replay keeping full outcomes in its receipts (a
  digest is enough for an in-memory replay that never retries), let each route's repository go before the next
  starts, then size `comparison.jobs.v1` from a measured peak. (c) Profile the replay's CPU: 28 minutes is too
  long for a live run even with the memory.
- *Effort:* M to L. *Risk:* medium: the replay's idempotency and its result digests (FUCQ-242) must not change.
  *Expected gain:* a job that fits the 128 MB allowance, or one that is sized honestly. Not measured.

**2. Greg's dashboard: switching to Greg takes 2.5 s (9.3 s on a phone), and his "Next order plan" is unavailable.**
- *Measurement:* above. On desktop, the page load's 12 calls take 1.31 s of server time. The slowest:
  `greg/order-plan` 245 to 274 ms, `greg/orders` 217 to 234 ms, `greg/demand` 196 to 230 ms, `greg/policy` 186
  to 198 ms (68 KB), `presenter/controls` 120 to 149 ms (77 to 106 KB). A tick from Greg's page is 2.14 s:
  the tick call itself 1.06 s [1.05-1.32] with a 91 KB answer, then the strip and the three
  regions re-read (`presenter/controls` at 106 KB, `greg/order-plan`, `greg/orders`, `greg/demand`), about 1 s more. The phone page is dominated by statics: 146 requests, 1.19 MB, FCP 6.24 s.
- *The order plan:* `GET /api/gcsp/greg/order-plan` answered 503 in every browser run (4 desktop, 3 phone), and
  the region shows "The order plan is unavailable". Those runs had Paula place a manual order first. On a fresh
  run with 8 ticks and no journey (`tick-profile.json`) it answered 200, in 1,080 ms. Why it fails after a manual
  order was not isolated; it looks functional, not a performance cause.
- *Cause:* run 1's findings 1 (each call deep-copies the state, one at a time) and 2 (uncacheable statics). Nothing
  new beyond the order plan.
- *Change:* covered by R1-1, R1-3 and R1-7 for the speed. Raise the order plan's 503 as a Bug (R2-4), and keep its
  1.08 s answer in mind when R1-1 is measured.

**3. The 960 KB stock payload behind the gallery is 71% repeated copies (run 1 finding 3's cause).**
- *Measurement:* the largest `manual/stock` answer (gallery open, every run) is 960,384 bytes: `decisions` 20
  records (577 KB) and `cars` 12 records (346 KB), for a gallery of 6 cards. The gallery fetches it twice (1.96 MB),
  and Resume once more. Phone gallery: 15.50 s [15.48-15.50], desktop 1.24 s.
- *What fills it (`summary-run2.json`, `stockPayload`):*
  - Each record carries `versions.stock`, a 12 KB version map of the whole stock source: 240 KB across the
    decisions and 144 KB across the cars, 40% of the payload, for a value that is also at the top level.
  - `evidence` (assumptions and eligibility provenance) is 261 KB, and `snapshot.facts` 157 KB.
  - `cars` repeats whole decision records: identical 28.9 KB records appear in both arrays.
  - Subtrees of 512 bytes or more that repeat account for 682 KB (71%).
- *Change:* send `versions` once at the top level; send `cars` as ids into `decisions` (or drop it); send the card
  fields for the gallery, with evidence and provenance on the review page that shows them; dedupe the fetch. This
  sharpens R1-4. On hosted, Render's Brotli would shrink the transfer (finding 6), but the server still builds and
  serialises it, and the phone still parses it.
- *Effort:* M. *Risk:* low to medium (review and claim read the same DTO). *Expected gain:* the payload to under
  100 KB and the phone gallery from 15.5 s to about 2 s. Estimates.

**4. A tick spends 90% of its CPU copying state, and the controls readback grows because it echoes the buddy allocation (run 1 finding 4's open causes).**
- *Tick CPU (fresh run, 8 ticks):* 627 to 715 ms per tick, rising slowly; max event-loop delay 716 ms. 90.1% of
  the CPU inside the tick requests is `cloneJson` (`core.js:7`), 4.2% GC; the handlers' own work is under 1%. The
  profile cannot charge the copies to a handler (async frames), but on a fresh run the tick's cost is run 1's
  finding 1. With journey state, a tick costs 1.45 s with an order placed and 2.14 s from Greg's page.
- *Readback growth:* on a fresh run the readback stays at 17.9 to 18.8 KB through 8 ticks. In the journey it reaches
  108 KB (desktop run 4). Of that, 91 KB is `lastTick.outcomes`, and one handler's outcome, `buddy-allocation`
  (its `allocations` list), is 85.5 KB; the other 11 handlers are 0.1 to 2.3 KB each. `versions.stockGeneration`
  adds 12.8 KB. This readback is read on every screen change, up to 4 times a page (run 1 finding 5): in run 2 it
  was 49 KB on each order progress load, 82 KB on each outbox load and 77 to 106 KB on Greg's page.
- *Change:* return a per-handler summary (counts) in `lastTick`, with the allocation detail on demand. *Effort:* S.
  *Risk:* low; check what the strip shows from `allocations`. *Expected gain:* the readback back to about 20 KB at
  every point of the demo, so 30 to 90 KB less per read. Measured sizes, estimated effect.

**5. Order progress takes 1.1 s on desktop and 4.8 s on a phone, with duplicated reads.**
- *Measurement:* 14 calls, 0.92 s of server time: `manual/account` twice, `orders/progress/all` twice and
  `context` twice, `return-plan` 155 ms, `presenter/controls` 105 ms (49 KB). Phone FCP 3.66 s, 71 requests,
  665 KB. The warm reload is 0.61 s desktop and 3.30 s phone.
- *Cause:* run 1's findings 1, 2 and 5. Nothing new. *Change:* R1-1, R1-3, R1-6.

**6. Hosted: Render already compresses with Brotli over HTTP/2, but nothing is cached, and each request costs about 0.1 s.**
- *Measurement (hosted, unauthenticated, 16:14 UTC, one request at a time, new connection each):* `/health` TTFB
  0.10 to 0.14 s (0.50 s for the first, with DNS and TLS); `/health/vehicle-evidence` 0.12 and 0.16 s; the access
  page 0.11 to 0.13 s; the presenter page 303 in 0.10 s; the offer page shell 0.08 to 0.23 s. The 171,833-byte
  retail CSS came back as 47,356 bytes Brotli (0.28) when the request offered `gzip, br`, in 0.14 to 0.18 s.
  Every response, static or not, was `Cache-Control: no-store`. HTTP/2 throughout.
- *What it means:* run 1's compression change (R1-2) only matters for the local host; browsers on the hosted demo
  already get Brotli from Render's edge. Caching (R1-3) and trimming the module graph (R1-7) are what remain: a
  page of 140-plus modules re-fetched on every load, each a round trip of about 0.1 s from the UK to Frankfurt,
  in as many waves as the import graph is deep.
- *Not measured hosted:* the authenticated journeys (see gaps).

### Measured and fine

- **Outbox:** 0.45 s desktop and 2.45 s phone, after a reset and after a tick; `presenter/outbox` itself 62 to
  65 ms and 3 KB. The strip's readback (finding 4) is the biggest call on the page.
- **Greg's Refresh queue and comparison Reload:** 0.13 s desktop, 0.25 s phone.
- **The main event loop during a comparison:** responsive (finding 1), so a running job does not slow the demo.
- **Memory:** whole-run peak RSS 381 MiB [285-416] desktop and 320 MiB [313-321] phone, heap 208 and 166 MiB; with a
  comparison running, 393 to 410 MiB. Comfortable on the 2 GB `standard` plan in `render.gcsp.yaml`. Node 26 only.
- **Browser main thread:** no long tasks in any run 2 step on either profile, except the phone gallery (116 ms).

### Not measured in run 2

- **Hosted authenticated timing:** Greg's dashboard, the comparison and every journey on Render need the demo key,
  which this review may not use. Render's CPU is likely slower than this Mac, so the 3-minute failure and the
  server-bound steps would be slower there. The key-holder can run `perf-run2.mjs` and `comparison-job.mjs`
  against a local copy of Render's settings, or time the hosted pages by hand.
- **The hold sweep:** the panel's "Run the hold comparison" button starts `hold-sweep`, which has more arms than
  the default job. Not run: it would hold this Mac for longer than this run allowed, and the default job's failure
  already shows the limit. Expect it to fail at 128 MB too, after the same first step.
- **CPU profile of the comparison replay:** why a step takes 160 to 400 s was not profiled. The shallow snapshot
  still copies every table array on each read (`server/gcsp/repository/memory.js:8`), which grows with the
  cohort; that is a lead, not a measurement.
- **Retainer path for the replay's heap:** the sampling profile names the allocating function, not the holder
  (rows or receipts). One heap snapshot at the buddy boundary, at about 1 GB, would settle it.
- **Greg's order plan Preview and Submit, and policy publish:** the plan was unavailable in every browser run, and
  publishing changes policy, which a timing run should not do.
- **Renewal cases with cases in them:** the queue had 0 cases in these runs; FUCQ-262's capture covers a case.
- **Phone settle check:** the first phone runs settled on an empty order progress element while its modules
  downloaded; the check was tightened (60 characters of content) and the phone runs repeated. The desktop runs
  used the first check; their step times agree with their server times, so they stand.
- **Node 20 and real devices:** as in run 1.

### Recommended tickets from run 2 (for the dispatcher to raise)

1. Bug, M to L: the default 1,000-employee comparison fails at its 128 MB worker heap in 3 of 3 runs after about 3 minutes; the buddy replay keeps about 1 GB (`cloneJson` copies, likely the per-command receipt outcomes), and at 2 GB it takes 27.6 min. Stop retaining full outcomes, free each route's repository, then size `comparison.jobs.v1` from a measured peak.
2. Task, S: for the demo, show Greg a stored comparison prepared offline, and don't start the default job live, until R2-1 lands.
3. Story, S: the presenter controls readback echoes the last tick's full handler outcomes (buddy-allocation 85.5 KB of 108 KB); return a summary, with details on demand.
4. Bug, S to M: `GET /api/gcsp/greg/order-plan` answers 503 ("The order plan is unavailable") after Paula places a manual order on a fresh local run (7 of 7 runs); it takes 1.08 s when it answers.

Changes to run 1's tickets: R1-4 should name the fields in finding 3 (`versions` once, `cars` as ids, card fields
only). R1-2 (compression in `host.js`) matters only for the local host, because Render already serves Brotli;
R1-3 (caching) is the hosted lever.
