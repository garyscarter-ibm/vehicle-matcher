# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Conventions

### Comments
- **Keep code comments to 2 lines max**, unless a longer note is genuinely unavoidable
  (e.g. a subtle gotcha that will bite the next person). Prefer explaining *why*, not *what*.
- **When you touch code near a verbose comment, tighten it** to fit the 2-line rule as part
  of the change — don't leave old sprawling comments in place.

This applies to every file and every contributor (human or agent).

### User-facing copy
No em dashes in any on-screen string (house style) — enforced by a test in
`server/test/render.test.js`. This rule is for user-facing copy only, not comments.

### GCSP demo quality and context

For every GCSP task, read `docs/gcsp/README.md` and `docs/gcsp/experience-quality.md`. Apply that contract
to story authoring, UI and user-visible service changes, every child-agent brief and final review.

## Commands

Zero runtime dependencies on both sides; Node 18+. The only dev dependency is `jsdom` (for tests).

```sh
cd server && npm start        # matching API on http://localhost:8787
npm run serve                 # static server for the block on http://localhost:3000 (run from repo root)
npm test                      # full suite: node --test server/test/**/*.test.js
node --test server/test/engine.test.js   # a single test file
node --test --test-name-pattern "city driver" server/test/engine.test.js   # a single test by name
npm run audit                 # do the QUESTIONS earn their screen? (replays engine over fixtures)
npm run audit:refine          # do the RESULTS pick a real winner?
npm run personas              # persona sweep over the engine
```

Both processes must run for the app to work locally. Open `block.html` (bare EDS harness) or
`/` (`index.html`, the branded demo picker) through the static server — ES modules won't load
from `file://`.

**Test note:** `api.test.js` and `render.test.js` bind a localhost port. In a sandbox that
blocks `listen` they fail with `EPERM` — that's the environment, not the code. The pure-logic
tests (engine, age, brand tuning) run anywhere.

## Architecture

Two independently-deployed halves, split so the tuned weights and dataset never reach the browser:

- **`blocks/vehicle-matcher/`** — a portable Adobe EDS block (vanilla JS + CSS, **no build step**).
  EDS auto-loads only `vehicle-matcher.js` (default export `decorate(block)`) and its
  same-named `.css`. Everything else is pulled in by ES `import` or CSS `@import`.
- **`server/`** — a zero-dependency Node HTTP API that runs the engine against the retailer's
  **live stock feed**. `matchCars()` and all scoring stay server-side; responses carry only
  display fields of the top matches.

See `README.md` for deploy (Render + GitHub Pages), the full API contract, and the EDS
authoring/config-row model. `docs/how-it-works.md` is the whole system on one page; the rest of
`docs/` records *why* each decision was made.

### The block is a shell + interchangeable "modes"
`vehicle-matcher.js` is only a shell: it reads authored config, applies the brand theme class,
and mounts one **mode** into a stage (with a switcher when unlocked). A mode is a plain object
`{ key, label, mount(root, ctx) }` registered in `blocks/vehicle-matcher/modes/index.js`
(currently `questionnaire`, `swipe`, `head-to-head`, `podium`, `guess-who`; first is the
default). **Two keys differ from their filenames**: `swipe` lives in `mingle.js` and
`head-to-head` in `knockout.js`. The old `?mode=mingle` / `?mode=knockout` are retired — the
key is what `?mode=` matches, not the file. Modes share
`engine.js` (HTTP client), `ui.js` (primitives), `question-ui.js`, `result-card.js`, and
`brand-copy.js`. **Add an interface** = a new `modes/<key>.js` + one import/array entry; the
shell needs no change.

### Brand-agnostic, driven by a registry
Brand is authored config, not baked in. `server/brands.js` is the **source of truth**: per-brand
origin/retailer, and per-brand engine tuning (`BMW_TUNING` is the baseline; other brands override
only what must differ). Supported brands: bmw, mini, ford, honda, motorrad, ferrari. Adding a
brand = a tuning block in `brands.js` + a `MODEL_SPECS`/derivation entry in `mapping.js`; the
engine itself never changes. See `docs/onboard-brand-blueprint.md` and the `onboard-brand` skill.

### Live stock → engine schema
`/api/match` fetches the retailer's live used-stock feed (`stock.js`) and maps each vehicle into
the engine schema via `mapping.js`. BMW/MINI share one Auto Trader/Django platform; Honda,
Ferrari and Motorrad each have a bespoke parser (`honda-listing.js`, `ferrari-listing.js`,
`motorrad-listing.js`) because their stock isn't a JSON API. The feed can't supply 0–62, boot
litres or seat count — those come from `MODEL_SPECS` in `mapping.js`, keyed by model line.
`server/data.js` is **fixture data for tests only**, not a product dataset.

### CSS design tokens
`blocks/vehicle-matcher/tokens.css` holds all `--vm-*` design tokens (brand-invariant on `:root`,
brand-specific on `.vm`/`.vm.vm-<brand>`). It's the first `@import` in `vehicle-matcher.css`, so a
real EDS page gets it transitively. `demo-chrome.css` styles the demo homepage/picker only.

## Cross-file invariants (easy to break)
- **Client mirrors server, both must stay in step:** the block's `KNOWN_BRANDS`
  (`vehicle-matcher.js`) mirrors the `brands.js` registry; conditional-question predicates in
  `blocks/vehicle-matcher/quiz-meta.js` mirror the questions defined in `server/questions.js`
  (predicates can't cross JSON, so `/api/questions` strips them and the client re-applies).
- **Counts are server-owned:** `TOP_MATCHES` and the question set ship via `/api/questions` so
  intro copy states numbers without a block rebuild — don't hardcode them client-side.
- **`?scope=` and the Retailer Name row must agree.** `?scope=dealer|national` (default
  **dealer**) chooses the pool: one branch's forecourt, or every retailer of the brand.
  Only BMW and MINI have two pools (`source: 'feed'` in `brands.js`); the other four run a
  single national programme feed each, so both scopes search the same cars for them and the
  programme name is the true label either way. The authored **Retailer Name** row is only a
  label, so nothing stops it naming a pool that wasn't searched — and both ways of getting it
  wrong are visible on screen ("Nothing at Sytner Luton is close…" above a card reading "At
  Group 1 Lincoln", or a 41-car forecourt labelled "BMW Approved Used"). Both harnesses
  re-derive it from brand + scope rather than trusting the authored value; a real retailer page
  authors one scope and one matching name. `resolveScope` narrows anything unrecognised *down*
  to dealer, so a typo'd embed can never widen a pool the page has already named.
