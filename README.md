# Vehicle Matcher

A consumer-facing car-matcher for the UK market: answer a few quick questions
about your budget, lifestyle and driving, and get matched with the approved-used
cars your retailer actually has — with a plain-English explanation of *why* each
one suits you.

The matcher is **brand-agnostic**: the brand (BMW, MINI, Ford, Honda, BMW
Motorrad, Ferrari) is authored config, not baked in, and the same engine serves
every brand — calibrated per brand by config, never by forking the scorers. The UI is a **portable
Adobe Edge Delivery Services (EDS) block** — vanilla JS + CSS, no framework, no
build step — built around interchangeable interface **modes** (see
`blocks/vehicle-matcher/modes/`) so one page can showcase several matching
approaches over the shared engine. The scoring engine and car dataset run behind
a small **backend API** you host outside EDS, so the dataset and weights are
never shipped to the browser.

> Unofficial tool. Not affiliated with or endorsed by the brands it matches.
> Prices and specs are indicative — always check with a retailer.

> **New here, or coming back to it?** Read
> **[docs/how-it-works.md](docs/how-it-works.md)** — the whole system on one
> page. The rest of `docs/` is the record of *why* each decision was made.

## Architecture: UI block + backend

Two deployables:

- **`blocks/vehicle-matcher/`** — the EDS block (quiz UI, results, share links). It
  holds no dataset or weights; it calls the API for the quiz definition and for
  match results. Ports into a live EDS site by copy-paste; point it at your
  backend with a `data-api` attribute.
- **`server/`** — a zero-dependency Node HTTP API that runs the matching engine
  against the retailer's **live stock feed** (`stock.js` + `mapping.js`), scored
  with the retail policy in `server/scenarios/retail/used-retail-v1.js`
  (`engine.js` is its compatibility facade). All of it stays server-side. Deploy it to
  any Node host.

Why the split: the tuned weights (and the live-stock request flow) are the
interesting IP, and a purely client-side block would ship all of it in plain
sight. Moving the engine
behind an API keeps `matchCars()` (and everything it reads) off the client — the
browser only ever sees the display fields of your top matches.

Trade-off: the tool now needs the backend to be reachable. If the API is down,
the block shows a friendly error rather than falling back to a client-side engine
(which would defeat the point of hiding the dataset).

## Run it locally

Two processes — the API and a static server for the block:

```sh
# 1. Start the matching API (http://localhost:8787)
cd server && npm start

# 2. In another terminal, serve the block and open the printed URL
npm run serve          # http://localhost:3000  (zero-dep Node static server)

# Tests (Node 18+, zero deps) — run from the server folder:
cd server && npm test
```

`block.html` is a standalone harness that mounts the block exactly the way EDS
would; its `data-api` points at `http://localhost:8787`. Open it via the local
server — ES modules don't load from `file://`. (The site root `/` — `index.html` —
is the branded demo homepage/picker.)

> `npm run preview` (Python `http.server`) is kept as an alternative static
> server, but `npm run serve` (Node) works in more environments.

## Deploy it free

The two pieces host free on separate services: the backend on **Render**, the
static block on **GitHub Pages**. The block learns the backend URL at runtime via
a `?api=` query param, so nothing is hardcoded or rebuilt.

**1. Backend → Render.** [`render.yaml`](render.yaml) is a Blueprint Render reads
automatically. In the Render dashboard: **New → Blueprint**, connect this repo,
**Apply**. It builds `server/` and starts `node index.js`; Render injects `PORT`
and the server binds to it. Copy the service URL (e.g.
`https://bmw-matcher-api.onrender.com`).

> Free-plan services spin down after ~15 min idle, so the first request after a
> lull cold-starts (~30–50s). And `POST /api/match` proxies the **live** retailer
> stock feed — matches depend on that upstream being reachable.

**2. Frontend → GitHub Pages.** The [Pages workflow](.github/workflows/pages.yml)
publishes the repo root on every push to `main`. One-time setup: repo
**Settings → Pages → Source: "GitHub Actions"**.

**3. Wire them together.** Open the Pages URL with the backend passed in `?api=`:

```
https://<user>.github.io/<repo>/?api=https://bmw-matcher-api.onrender.com
```

Without `?api=`, the page falls back to `http://localhost:8787` (local-dev
default), so bookmark/share the URL *with* the param.

## GCSP static package (separate release)

Build the GCSP Render static site from `gcsp-poc` with the reusable assembler:

```sh
node scripts/assemble-site.mjs --output _site-gcsp --environment deployed --api https://YOUR-GCSP-API --revision YOUR-COMMIT
```

The output directory must be empty. For local development, omit `--environment`
and `--api` to use `http://localhost:8787`. Add `--employee-disabled` to keep the
complete retail launcher available while the employee route is unavailable.
`--require-demo-pages` additionally enforces the offer/Greg/outbox walkthrough
release gate and names any absent page. Ordinary assembly packages existing
blocks and discovers later blocks without adding a story dependency.
`site-manifest.json` records discovered GCSP blocks, exact file digests, API,
revision and employee availability. The assembler checks local dependencies and
required images before publication, and extracts the standalone script into an
external module for the package's script CSP.

The existing retail Pages workflow, Render blueprint and EDS sync are unchanged.
No site is provisioned or deployed by this command. Follow the
[GCSP revision, configuration and deployed-smoke checklist](docs/gcsp/evidence/fucq-12/fucq36-release.md)
before a separately authorised release.

## GCSP backend email

GCSP notifications default to the captured outbox. Real sending uses one optional
Brevo HTTP adapter with built-in `fetch`; it adds no runtime dependency. Configure
these settings privately on the GCSP backend, never in frontend assets or source:

| Setting | Meaning |
|---|---|
| `GCSP_MAIL_TRANSPORT` | Set exactly `brevo` to opt in. Absent keeps capture only. |
| `GCSP_BREVO_API_KEY` | Existing suitable Brevo API key, supplied as a backend secret. |
| `GCSP_MAIL_FROM` | Sender address already verified in that account. |
| `GCSP_MAIL_FROM_NAME` | Configured sender display name. |
| `GCSP_MAIL_RECIPIENTS` | JSON object mapping fictional employee IDs to explicitly approved demo inboxes. Its values form the allow-list. |
| `GCSP_PUBLIC_BASE_URL` | Absolute HTTPS frontend base, including the deployed project path. Existing offer links retain their token, query and run binding. |

Partial or invalid real-send configuration records a safe failure; it does not
fall back to a claim of real delivery. Every rendered message is captured,
including refused and failed provider attempts. A Brevo HTTP 201 with a message
ID records provider acceptance, which does not prove inbox delivery. The UUID
provider key and confirmed acknowledgement persist in the existing outbox row;
uncertain attempts are refused once the provider's 30-minute wall-time window
expires. DemoClock still controls retry scheduling through `notify.delivery.v1`.

The trusted GCSP runtime supplies notification and presenter-outbox dependencies
to `buildServer`; selecting a transport does not create an offer or a public
landing page. Before one deliberate real send, verify the existing backend key
and sender, the approved recipient mapping and an actual reachable offer route.
See [the transport and live-setup contract](docs/gcsp/email-transport.md). Automated
tests use provider stubs and send no real mail.

## Project layout

```
blocks/vehicle-matcher/
  vehicle-matcher.js  # EDS block SHELL: decorate(block) — config, brand theme,
                      #   mode switcher + stage; picks which interface to mount
  vehicle-matcher.css # scoped styles (.vm), mobile-first, auto-loaded by EDS
  engine.js           # shared engine client (apiMatch/apiNearby/… over HTTP)
  ui.js               # shared UI primitives (el, cardinal, gbp)
  quiz-meta.js        # client-only: conditional-question predicates + budget bands
  tokens.css          # all --vm-* design tokens (imported first by the block CSS)
  demo-chrome.css     # styles the demo homepage / brand picker only
  modes/              # interchangeable interfaces over the shared engine:
    index.js          #   mode registry — { key, label, mount(root, ctx) }[]
    questionnaire.js  #   the question-by-question interface (default)
    mingle.js         #   'swipe' — a swipe game
    knockout.js       #   'head-to-head' — pick between two cars
    podium.js         #   'podium' — a live-narrowing results podium
server/
  index.js          # zero-dep Node API: /api/questions, /api/match, /health
  engine.js         # retail compatibility facade: re-exports the used-retail-v1 engine API
  recommendation/   # shared pure decision core (weights, blend, percent, stable ordering)
  scenarios/retail/ # used-retail-v1 policy (dimensions, weights, rounding); server/index.js binds it
  brands.js         # brand registry: origin/retailer + per-brand engine tuning
  questions.js      # quiz definition + budget bands        (source of truth)
  stock.js          # live retailer-stock client (per-brand feeds)
  mapping.js        # maps live vehicles -> engine schema; MODEL_SPECS lookup
  {honda,ferrari,motorrad}-listing.js  # bespoke parsers for non-JSON feeds
  data.js           # test fixture cars                     (server/test only)
  test/             # node --test suite (engine, brand, api, render, …)
  package.json      # server: start / test scripts
index.html          # site root: branded demo homepage / picker (?brand=bmw|mini|ford|honda|motorrad|ferrari)
block.html          # standalone preview harness (brand-agnostic; same ?brand= keys)
scripts/serve.js    # zero-dep static server for the block (npm run serve)
scripts/dump-stock.js         # national stock snapshot -> fixtures/ (--remap: no network)
scripts/audit-questions.mjs   # do the QUESTIONS earn their screen? (npm run audit)
scripts/audit-refinement.mjs  # do the RESULTS pick a real winner? (npm run audit:refine)
```

Both audits replay the real engine over the fixture dumps and are written up in
`docs/` — [question-stock-audit.md](docs/question-stock-audit.md) and
[refinement-audit.md](docs/refinement-audit.md), the latter feeding the phase-2
design in [refinement-plan.md](docs/refinement-plan.md) and the results-page
restructure proposed in [results-page-states.md](docs/results-page-states.md).

The block folder is the EDS deliverable; the `server/` folder is what you host.

## Porting to Adobe EDS

The block follows EDS conventions (`decorate(block)` default export, CSS named
after the block, self-contained folder), so porting is a copy-paste:

1. Copy `blocks/vehicle-matcher/` into your EDS project's `blocks/` directory.
2. In the document that drives the page, add a block table named
   **Vehicle Matcher** (a one-cell table containing `vehicle-matcher` works too).
3. Add config rows below the block name — first cell the key, second the value.
   All are read with a `readBlockConfig()` helper, the standard `aem-boilerplate`
   convention:
   - **Brand** — one of `BMW`, `MINI`, `Ford`, `Honda`, `Motorrad`, `Ferrari`
     (defaults to BMW). The block is brand-agnostic; this row is the only thing
     that themes it and picks which live feed it sources from.
   - **Mode** — which interface to show, and whether visitors can switch. Set it
     to a mode key to **lock** the page to that one interface and hide the
     switcher — the production case. Keys: `questionnaire` (default), `swipe`,
     `head-to-head`, `podium`. Leave it blank/absent to show every registered
     mode with a switcher (the showcase). Mode keys live in
     `blocks/vehicle-matcher/modes/index.js`.
   - **Retailer ID** — the retailer's `retailer_site` ID (e.g. `96`); omit to
     fall back to the brand's default (`defaultRetailer` in `server/brands.js`).
     It does two jobs: at dealer **Scope** it is the pool, and at either scope it
     is the address the "other retailers nearby" carousel measures distance from.
   - **Scope** — `dealer` (default) or `national`: whether the block searches this
     retailer's own forecourt or every retailer of the brand. Only BMW and MINI
     have both — the other brands' feeds are a single national programme, so the
     row does nothing there. Dealer scope is the default because a block authored
     onto one retailer's page should answer for that retailer; national scope is
     the group/programme case, and turns on Guess Who's Distance filter (with one
     forecourt there is nothing to sort by distance, so it hides itself).
   - **Retailer Name** — the display name shown in copy, for the pool that was
     searched. Author it to match **Scope**: at dealer scope that is the branch
     (`Grassicks Garage`), at national scope the programme (`BMW Approved Used`).
     Getting it the wrong way round makes the copy lie about what it searched —
     either claiming a pool of 12,000 when it looked at 41, or naming one branch
     over cards from 130 of them. The dealer actually holding each car is always
     named on the card itself.
   - **API** — your deployed backend's base URL. **This is how you point an
     EDS-authored block at its backend**: authored content can set config rows
     but not HTML attributes, so the block reads the API base from this row
     (falling back to a `data-api` attribute for the local harness, then
     `http://localhost:8787`). Without it, a published block would try to reach
     localhost.
   - **Title**, **Kicker**, **Disclaimer** — optional copy overrides. Author a
     value to replace the default; leave the value cell **blank** (or write
     `none`) to remove that line entirely. Blanking **Title** is how you place
     the block under the page's own section heading without repeating it;
     blanking **Kicker** and **Disclaimer** drops the "unofficial matchmaker"
     framing, which suits a demo but not a retailer's own site.
4. Publish. EDS auto-loads `vehicle-matcher.css` and calls the block's
   `decorate()` — no other wiring needed.

Example authored table:

| vehicle-matcher |  |
|---|---|
| Brand | MINI |
| Mode | questionnaire |
| Retailer ID | 92 |
| Scope | dealer |
| Retailer Name | Sytner Luton |
| API | https://your-backend.onrender.com |
| Title |  |

(The blank **Title** row above suppresses the block's own headline, for when it
sits under the page's own "FIND YOUR MINI." section heading. The **Mode** row
locks the page to the questionnaire interface with no switcher. **Scope** and
**Retailer Name** agree, so the copy names the forecourt it actually searched.)

The block ships **no font files**: it names the host site's licensed families
first (`--heading-font-family` / `--body-font-family` on BMW, MINI's own faces
on MINI), so it inherits the site's typeface and falls back to a neutral stack
when run standalone.

The standalone `block.html` harness uses a `data-api` attribute + `?api=`
override instead (no DA needed); `?retailer=<id>` tries a different retailer
without editing the file. Both paths resolve through the same `apiBase()`.

`?mode=<key>` and `?scope=dealer|national` are read straight from the query
string by the block, so they override an authored row and need none of their own.
That is what lets one deployed page demo both scopes: compare
`?brand=mini&retailer=92&scope=dealer` with `?brand=mini&scope=national`. The
harness re-derives **Retailer Name** from whichever brand and scope are in the
URL, so its label always matches its pool; a real authored page sets the row by
hand instead.

Notes:
- The block itself ships no dataset or weights — those stay behind the API.
- Styles are scoped under `.vm` and won't fight your site's global CSS.
- Questionnaire share links use the existing answer hash (`#m=…`) plus an
  explicit public context allowlist: `experience=used-cars`, supported brand and
  mode, retailer ID/name, dealer/national scope and the configured API base.
  Effective authored settings are included even when absent from the original
  query. Completing or starting over preserves that context; starting over
  removes the answer hash. Direct `block.html` links and all six retail brands
  and five modes remain supported.
- Links rerun those answers against **current stock**. They do not freeze a
  listing, reserve a car, or save the local refinement/rejection history.
  Legacy band, numeric and range budgets and single/multiple fuel answers still
  reopen. Only public question answers are encoded; unrelated query fields,
  shared passwords, access tokens, employee identity and private briefs are
  excluded. API bases identify the environment; embedded credentials and API
  query/hash parameters are removed. Recipients authenticate separately if the
  selected environment requires access.
- The block makes requests to your API's origin. If your site enforces CSP, allow
  that origin in `connect-src`; the API sends permissive CORS headers by default.

## API contract

The backend exposes two endpoints (plus `GET /health` → `{ ok: true }`):

- **`GET /api/questions`** → `{ questions, budgetBands, topMatches }`. The
  question set, with the conditional-visibility functions stripped (they can't
  cross JSON); conditional questions are marked `conditional: true` and the
  block applies the matching predicate from `quiz-meta.js`. `topMatches` is
  `TOP_MATCHES` — how many results `/api/match` returns — sent so the intro copy
  can state the number without hardcoding it. Both counts are server-owned: a
  brand gaining a question, or `TOP_MATCHES` changing, updates the intro copy on
  the next page load with no block rebuild.
- **`POST /api/match`** with body `{ answers, retailer?, brand?, scope? }` →
  `{ matches, unmet }`. `retailer` is the retailer_site ID to match against; omit
  it for the brand's `defaultRetailer` (`server/brands.js` — `96` for BMW, `92`
  for MINI). `scope` is `dealer` (the default) or `national`: that retailer's own
  stock, or every retailer of the brand. Anything unrecognised resolves to
  `dealer`, deliberately — a mistyped scope must never widen a pool the page has
  already named. `/api/preview`, `/api/field` and `/api/pool` take the same two
  (`/api/pool` on the query string, and it echoes back the `scope` it used).
  Each match is `{ car, score, stretch, reasons }`, where `car` carries **only
  display fields** (name, line, body, fuel, price range, 0–62, mpg/range, blurb).
  Internal scoring fields (tags, size class, seats, boot…) are omitted, so the
  dataset can't be reconstructed from responses.
  `unmet` is the stated wants — fuel and body style — with no car behind them
  in the stock searched (e.g. `{ fuel: ['ev'] }`), so the results page can say
  so plainly instead of quietly serving the closest thing. `/api/nearby`
  reports the same for its own pool, and sends `unmet: null` when the lookup
  failed: the block only tells the user something is unavailable once both
  halves agree, and "we didn't hear back" is not agreement.

## Deploy the backend

`server/` is a plain Node HTTP server with **no dependencies** — nothing to
build, nothing to install.

```sh
cd server && PORT=8787 node index.js
```

Run it behind any Node host (Render, Railway, Fly, a VPS, a container). Set
`PORT` from the environment. Then set the block's `data-api` to the public URL.
CORS defaults to `*`; tighten `Access-Control-Allow-Origin` in `index.js` to your
EDS origin to lock it down.

## How the matching works

Deterministic weighted scoring — transparent and unit-tested, no black box.

1. **Hard filters** remove cars clearly outside the brief: more than 15% over
   budget (`STRETCH_FACTOR`), or too few seats/boot for a full crew. Cars
   *within* the 15% stretch survive but are flagged as "a stretch".
2. **Eight soft dimensions** are scored 0–1 per car: budget fit, body style,
   fuel type (EVs are heavily penalised without charging access), practicality,
   performance, running costs, size vs. usage, and character (tag matching).
3. **Weights** combine the dimensions into a 0–100 match score. The engine is
   brand-agnostic: every calibration constant lives in a per-brand `tuning`
   object in `server/brands.js` (BMW's is the baseline; other brands override
   only what must differ). The user's two stated priorities reweight the engine,
   and high mileage / sporty-style answers nudge economy and performance weights.
4. **Reasons** are generated from the actual score components: the top 3–4
   highest-contributing dimensions that scored ≥ 0.7 produce the "why this
   suits you" bullets — no canned per-car marketing text.
5. Ties break deterministically: score, then lower price, then name.

### Tuning

| What you want to change | Where |
|---|---|
| Per-brand weights, priority boosts, stretch tolerance, hard-filter floors | that brand's `tuning` block in `server/brands.js` |
| The BMW baseline / engine defaults | `WEIGHTS` / `PRIORITY_BOOSTS` / `STRETCH_FACTOR` in `server/scenarios/retail/dimensions.js`, re-exported by `server/engine.js` (tuning sourced from `brandTuning('bmw')`) |
| Add a brand | new `tuning` block in `server/brands.js` + `MODEL_SPECS`/derivation in `server/mapping.js` — see `docs/onboard-brand-blueprint.md` |
| New/updated model specs (0–62, boot, seats) | `MODEL_SPECS` in `server/mapping.js` — see [Updating the dataset](#updating-the-dataset) |
| Test fixture cars | `server/data.js` (see field docs at top; used by `server/test/` only) |
| Questions, options, budget bands | `server/questions.js` (mirror any conditional-question predicate in `blocks/vehicle-matcher/quiz-meta.js`) |

Tuning lives entirely server-side, so you can retune weights or add new model
specs and redeploy the backend **without touching the EDS block**.

Run `npm test` after tuning — the tests assert persona-level outcomes
(city driver gets something compact, enthusiast gets a drivers' car, family
crew never gets a two-seater…), so they catch weight changes that break the
product, not just the code.

### Updating the dataset

Since [e6c8635] the matcher no longer scores a curated, static list — every
`/api/match` call fetches the retailer's **live used-stock feed**
(`server/stock.js`) and maps each vehicle through `server/mapping.js` into the
engine's schema. New models, discontinued lines and day-to-day price changes
all show up automatically as stock turns over; there's no dataset file to
hand-edit or keep "current".

`server/data.js` still exists, but only as **fixture data for the test
suite** (`server/test/engine.test.js` imports `CARS` from it to test
`matchCars()` in isolation from the live feed). It is not read by `index.js`
or `stock.js` and does not need to be kept in sync with any brand's real range —
treat it as a small, stable set of test cases, not a product dataset.

What the live feed *can't* tell us is three specs it doesn't carry: 0–62 time,
boot litres and seat count. Those come from `MODEL_SPECS` in
`server/mapping.js`, a per-brand lookup table keyed by model line (e.g. BMW's
`X3`, `3 Series`, `iX1`) with derivative-based overrides for quicker trims (M
badges, `xDrive50e`, etc.). **This table is what needs updating when a brand
releases a new model line**:

1. Add an entry to `MODEL_SPECS` keyed by the line name the feed will use in
   its `title` (see `lineFromTitle()` for how the title is normalized — pure-M
   models collapse to the `"M"` key; everything else is the title with the
   leading "BMW" stripped).
2. Fill in `boot`, `seats`, `zeroTo62` (base/slowest trim for the line) and
   `sizeClass` (1 smallest – 5 largest), following the pattern of neighbouring
   entries.
3. If the new line has a distinctly quicker performance trim, extend
   `trimZeroTo62()` so that trim gets a faster figure than the base line.
4. If you skip a line, `mapVehicle()` falls back to `DEFAULT_SPEC` and logs a
   one-time `[mapping] no MODEL_SPECS for line "…"` warning — watch the server
   logs after a new model launches to catch anything missing.

Retiring a model needs no action — once the retailer stops stocking it, it
simply stops appearing in the live feed.

[e6c8635]: https://github.com/garyscarter-ibm/bmw-matcher-poc/commit/e6c8635

## Extending

- **Swap in an ML ranker later:** `matchCars(answers, cars)` is the whole
  engine interface — anything that returns `{ matches, contenders }` with
  scores and reasons can replace it.
- **LLM-written explanations:** keep the deterministic scores, feed the top
  matches + answers to an LLM for prose. The backend already exists, so this is
  a natural next step — add it inside `/api/match` and return the prose alongside
  the scores.
- **Real images:** each card has a media slot (`.vm-card-media`) ready for
  licensed imagery.

## Conventions

- **Comments: 2 lines max.** Keep code comments to two lines unless a longer note is
  genuinely unavoidable, and explain *why* rather than *what*. When you edit code near a
  verbose comment, tighten it as part of the change. Applies to every file and contributor.
