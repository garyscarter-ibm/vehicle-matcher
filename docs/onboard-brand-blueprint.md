# Onboarding a brand into the vehicle-matcher

**How to add a new marque (or a whole new vehicle domain) to the block, end to end.**

| | |
|---|---|
| Status | Living blueprint |
| Companion | the `/onboard-brand` skill (`.claude/skills/onboard-brand/`), which walks these steps interactively |
| Proven on | BMW + MINI (original), then Ford + Honda (cars) and BMW Motorrad (bikes) |

---

## 1. The one idea

The block is **one engine, one shell, many brands**. A brand is *data and dressing*,
never logic: the scoring engine (`server/engine.js`) and the interface modes
(`blocks/vehicle-matcher/modes/`) do not know which marque they are serving. Adding a
brand means teaching five layers about it and touching nothing else:

```
feed  →  mapping  →  tuning  →  theme  →  copy
(where       (raw vehicle    (how the       (how it     (what it
 stock        → engine        engine         looks)      says)
 comes         schema)        weighs it)
 from)
```

If you find yourself editing `server/engine.js` or a mode's `.js` to fit a brand, stop:
the brand-agnostic seam has sprung a leak, and the fix belongs in one of the five layers
or in a new per-brand hook, not in the shared core. (Section 8 lists the two hooks that
already exist for exactly this reason.)

## 2. Before you write anything: is the data reachable?

The engine scores real, buyable stock. So the first question for any brand is *can we
get its inventory, and in what shape?* Three outcomes, all supported:

1. **Same platform as BMW/MINI** (Auto Trader / Django `/vehicle/api/list/` with the
   CSRF handshake). Then `server/stock.js` already does the fetch; you only add the
   brand's `origin` + `defaultRetailer` to the registry. Cheapest path.
2. **A different live API.** Write a small per-brand fetch adapter (Section 4b) that
   returns raw vehicles for `mapVehicle` to project. Wire it behind the registry's
   `source`/`fetch` hook so the shared cache/warmer still apply.
3. **Not reachable from your environment** (bot-walled, or an SPA whose API you can't
   replay). Then seed a **fixtures file** (`fixtures/<brand>-cars.json`) from a scrape or
   from public spec data, set the registry `source: 'fixtures'`, and wire the real
   adapter anyway so it goes live the day the feed is reachable. Document the gap in
   `DECISIONS.md`.

**How to probe an endpoint quickly** (do this before committing to a shape):
```
curl -s -m 25 -A "<a real browser UA>" -H 'Accept: application/json' \
  -o /tmp/probe.json -w "HTTP %{http_code} type=%{content_type} size=%{size_download}\n" "<url>"
```
HTTP 000 with a completed TLS handshake = an edge bot-wall (Akamai et al.) dropping the
stream; curl cannot pass it, so fall to outcome 3. A 405 on GET often means it wants POST
with a JSON filter body. A server-rendered listing page is scrapeable even with no API.

## 3. The five layers, file by file

### Layer 1 — Feed (`server/stock.js`, `server/brands.js`)
Where the raw stock comes from. For a same-platform brand this is just `origin` +
`defaultRetailer` in the registry. For a different source, add a `source` field and a
fetch adapter (Section 4b). The result is always an array of raw vehicles handed to
`mapVehicle`.

### Layer 2 — Mapping (`server/mapping.js`, `BRAND_MAPPERS[brand]`)
Projects one raw vehicle to the engine's car schema. The feed rarely carries everything
the engine scores (0-62, boot litres, seats), so a per-brand **model-line spec table**
fills the gaps, keyed by a normalised model line. A mapper is a bundle of pure functions:

> **Detect fuel from a spec property, never a hard-coded model name.** When a range has an
> electric minority, gate `ev` on a spec fact that is true for *every* electric variant
> (`cc === 0`, an `electric` flag, or a positive `evRange`) rather than `line === '<one
> model>'`. A name check silently mis-maps the next EV in the range to petrol, which zeroes
> its economy-axis range and buries it. (This bit Motorrad: `line === 'CE 04'` mapped the
> equally-electric CE 02 to petrol.) After writing the mapper, list every EV in the spec
> table and assert each one resolves to `ev` in `brand.test.js` — the same guard Honda's
> EV lines carry.

```
BRAND_MAPPERS.<brand> = {
  defaultTitle, specs: MODEL_SPECS_<BRAND>, fallbackSpec,
  line(title, derivative),        // normalise to a spec-table key
  body(line, derivative),         // engine body vocabulary
  zeroTo62(base, line, derivative),
  tags(line, body, fuel, derivative),
  displayName(title, derivative),
  blurb(line, body, fuel, retailerName),
  styleLine(derivative) | () => null,   // optional extra taste axis
  doors(body, derivative)   | () => null,
}
```
The engine consumes the identical output shape for every brand. The card-facing fields
(`name`, `photo`, `mileage`, `plate`, `link`, `price`) are the same too.

### Layer 3 — Tuning (`server/brands.js`, `BRANDS[brand].tuning`)
How the engine weighs this brand's cars, via `mergeTuning(overrides)` onto `BMW_TUNING`.
Override only what must differ (a small quick MINI needs a different 0-62 curve and boot
scale than a big fast BMW; a mainstream brand leans on economy/practicality over image).
Every field maps to a specific scorer — see the commentary in `brands.js`. Also set
`budget: { max, default }` to the brand's real price range.

### Layer 4 — Theme (`blocks/vehicle-matcher/tokens.css` + `vehicle-matcher.css`, `.vm.vm-<brand>`)
The `--vm-*` design tokens live in **`blocks/vehicle-matcher/tokens.css`**, which
`vehicle-matcher.css` pulls in with `@import url('./tokens.css')` as its first rule — that
import is the only thing that carries the tokens onto a real EDS page (EDS auto-loads *only*
the block's own `vehicle-matcher.css`; nothing else pulls in a sibling). So a brand's
**`.vm.vm-<brand>` token block goes in `tokens.css`**, while its brand-scoped **component
rules**, the `@font-face` run, and the base `.vm` layout stay in `vehicle-matcher.css`. Only
brand-**invariant** tokens (the `--vm-space-*` / `--vm-text-*` scales, `--vm-radius-soft`,
`--vm-border-width`, `--vm-surface-alt-2`) sit on `:root` in `tokens.css` — that `:root`
promotion is what lets the marque-neutral brand picker (which renders outside `.vm`) reuse
the spacing scale. Never move a brand-overridden token to `:root`, or every brand collapses
to BMW's palette.

A token override block. The **contract a theme must define** (see the `.vm.vm-mini` block in
`tokens.css` for a worked example):
- Colour: `--vm-ink`, `--vm-ink-strong`, `--vm-ink-muted`, `--vm-accent`,
  `--vm-accent-ink`, `--vm-accent-spot`, `--vm-accent-secondary`, `--vm-accent-soft`,
  `--vm-line`.
- Fonts: `--vm-font-heading`, `--vm-font-body`, `--vm-font-bold`. **Package the brand's
  real typeface** (`@font-face` at the top of `vehicle-matcher.css` — the font declarations
  stay there, since their `./fonts/` paths are relative to that file, not `tokens.css`; files
  under `blocks/vehicle-matcher/fonts/`) and name that packaged family *first* in the stack, so
  the block renders in the brand face everywhere — inside an EDS host AND in the standalone
  harness, which has no host typography to inherit. BMW, MINI, Honda and Ford are all
  packaged this way; a sub-brand reuses its parent's files (BMW Motorrad points at the same
  `'BMW Type Next'` @font-face as BMW cars). Rules for the packaged @font-face:
  - **One family name per typeface, with real `font-weight`s** (100/300/400/700). Never
    declare a separate family per weight (`'BrandFont-Bold'`): if any consumer names a
    weight-family the CSS didn't declare, the whole stack silently falls through to
    Helvetica. Let `font-weight` do the work. (This was the original BMW bug.)
  - **Check each file's internal `usWeightClass` and map it to the weight the CSS requests**
    — a "regular" file can be a 500 Medium and a "bold" a 900 Black (MINI's are), so declare
    each `@font-face` at the weight the CSS asks for, not the file's design weight, or the
    browser synthesises the wrong thing. `python3 -c "from fontTools.ttLib import TTFont; ..."`
    reads the name/OS/2 tables.
  - Keep `var(--heading-font-family, …)` after the packaged family only as a host bridge,
    then a real system stack (`'Helvetica Neue', arial, sans-serif`) as the last resort.
  - Never name a plausible-looking family you didn't package or verify (a "BMWMotorrad"
    family resolves to nothing). If you truly can't source a brand's files, leave it
    host-first and say so in the theme comment + `DECISIONS.md`.
  - **Licence:** these are proprietary faces. Packaging + serving them publicly needs a
    licence that permits self-hosting; record the decision in `DECISIONS.md`. **Check whether
    the face is brand-owned or a licensed third-party retail face first** — BMW Type Next,
    FordF1 and MINI's faces are brand-owned; Honda's is **Proxima Nova**, a commercial Mark
    Simonson retail typeface Honda merely licenses (and serves with scrambled internal name
    tables to deter reuse). Self-hosting a licensed retail face is on much weaker footing than
    a brand-owned one; flag it to the owner before packaging (we did, and it was an explicit
    "package anyway" call — see `[fonts-honda-proxima-caveat]`), and note the clean fallback:
    a freely-licensed near-match under the same family names, `@font-face src` only.
    Don't assume the brand's font is its own; verify the actual `font-family` the live site
    loads (it may not be the "<Brand> Sans" you'd guess — Honda's placeholder was exactly that).
- Geometry: `--vm-radius`, `--vm-radius-control`.
- Motion character: `--vm-ease`, `--vm-pop` (the game animations read these, so the same
  keyframes feel crisp or springy per brand).

Plus brand-scoped rules for what tokens can't express — and two of those are **brand
signatures you must set deliberately, not inherit**:

- **Primary-button fill is a per-brand decision, not always `--vm-accent`.** The base
  `.vm-btn-primary` fills with `--vm-accent`, which is right for brands that lead with their
  colour on CTAs (BMW blue, Honda red, Ford blue). But some brands reserve the accent for
  links/small chrome and use **black** for the primary button (MINI and BMW Motorrad both
  do; Motorrad's blue is a link colour and its red is spot-only). For those, override
  `.vm.vm-<brand> .vm-btn-primary` to a near-black fill and keep the accent off the button.
  Decide by looking at the real site's CTAs, don't default.
- **Heading weight and text-casing are brand-specific; the base `.vm-title` is BMW-cars-
  specific.** The base title is `font-weight: 300` (Light) + `text-transform: uppercase` —
  BMW's airy editorial register. Every other brand must confirm its own and override:
  MINI is heavy uppercase (700), Honda and Ford un-uppercase to sentence case
  (`text-transform: none`), BMW Motorrad is **bold uppercase** (700, tight) — *not* the base
  Light, or its headlines read like a 7 Series ad instead of a GS one. Override the whole
  heading set together (`.vm-title, .vm-question, .vm-subhead, .vm-preview-heading,
  .vm-nearby-heading`), as MINI/Honda/Ford/Motorrad do.
- **Button-label casing is CSS, never copy.** If a brand shouts its CTAs in caps (Motorrad),
  add `text-transform: uppercase` to `.vm.vm-<brand> .vm-btn` — do not uppercase the label
  strings in JS (that would corrupt share/analytics text and is easy to get wrong).
- **The mode switcher is brand chrome too, and its RESTING state is what betrays a
  half-themed tab bar.** The `.vm-switcher-tab` base is wired to the shared tokens, but only
  the one *active* tab picks up `--vm-accent`; the resting tabs are transparent with a muted
  grey border and grey text for every brand, so the control reads as a generic grey segmented
  strip and a bold brand (Motorrad especially) looks un-themed. Confirm the tab bar wears the
  brand at rest: it now uses `--vm-font-bold` (the brand's shout face, not plain body) and the
  brand `--vm-accent` on hover, and a brand whose CTA signature differs from `--vm-accent`
  must mirror it here exactly as it does on `.vm-btn` — Motorrad overrides
  `.vm.vm-<brand> .vm-switcher-tab` to UPPERCASE and the active tab to the near-black fill, not
  blue. Same rule as the primary-button fill: don't let a brand's identity stop at the stage
  edge. (The tab *labels* stay brand-neutral by design — "Questionnaire"/"Swipe"/"Head to head" —
  the brand name lives in the in-stage wordmark, spec §9; this bullet is about colour/font, not
  copy.)

**The neutral brand picker themes itself from the tokens — no picker edit needed.** The
landing splash shown with no `?brand=` (demo-chrome.css `.demo-picker`) renders *outside*
`.vm`, so it can't see brand tokens; instead index.html's `brandAccent()` reads each
brand's `--vm-accent-spot` off a hidden `.vm.vm-<brand>` probe and sets it as the tile's
`--tile-accent` (hover border), which the picker rules paint. So a new brand gets a branded
tile hover for free — the one requirement is that its **`--vm-accent-spot` is legible on a
dark ground**.
That's why the picker uses spot, not raw `--vm-accent`: MINI's accent is near-black (invisible
on the dark picker), so MINI's spot is British Racing Green. The base `.vm` defaults
`--vm-accent-spot` to `--vm-accent`, so a brand that doesn't set one still resolves a value —
just confirm that value shows up on the dark tile. (Note several brands' spot colours are reds
close enough to be hard to tell apart on hover — Honda `#cc0000`, Motorrad `#e2001a`, Ferrari
`#da291c` — so don't rely on the picker hover alone to distinguish a brand.)

### Layer 5 — Copy (`server/questions.js`, `BRAND_COPY[brand]`; per-brand `questions{}`)
The brand's voice. `BRAND_COPY[brand]` overrides question/option **text only** — ids and
option `value`s are untouched so the engine is unaffected. Per-brand question surgery
(`BRANDS[brand].questions = { drop, add }`) removes near-dead questions and adds ones the
range needs; each added option's `scoresAs` folds into the standard answer fields
(`applyBespokeAnswers`), so **new questions never teach the engine a new id.**

**Rewrite the voice, don't swap the noun.** The single most-read string is the intro
`lede`, and it is the easiest to get lazily wrong: spreading `...BRAND_COPY.bmw` and
changing only "cars"→"Hondas" leaves every brand reading in BMW's register ("N quick
questions about your life, your miles and your budget. We'll match you with the
approved-used ___ that suit you best, and tell you why."). That is a bug, not a shortcut —
it makes four brands sound identical. MINI is the reference for how different it should be
("your money", "the MINIs with your name on them", "tell you exactly why"). For each brand,
write the `lede`, `title`, `cta`, `tasteLede`, `tiedLede`, `working*` and the reject/refine
lines in that brand's own words, grounded in its register (see `docs/tone-style-guide.md`
for BMW/MINI; the per-brand code comment for Honda plain-practical, Ford confident-British,
Motorrad rider-first-technical). Read the finished ledes for all brands side by side: if you
could swap the marque nouns and not tell them apart, the voice work isn't done. Then also do
the lower-value keys — but the lede is the one a reviewer will notice first.

> **Copy rule (permanent): no em dashes in any user-facing string.** Use commas, full
> stops or parentheses. Applies to labels, subs, blurbs, reason strings, CTA + share
> text. Code comments and docs may keep them.

**An option label must not assert an attribute the option's members don't all share.** A
`bodyStyles`/category label that names a fuel, size or capability ("Electric scooter",
"7-seat MPV") lies the moment the category holds a member without it. Motorrad's `scooter`
option was labelled "Electric scooter" while two of its four scooters are petrol (C 400
GT/X) — the label should describe the *shape* ("Scooter / maxi-scooter") and leave fuel to
the fuel question. Same rule for any help text that enumerates specific models ("the CE 04
is electric"): if the range holds more than one, name none, or keep the list correct as
the range grows. Prefer attribute-neutral labels so they survive a data refresh.

**When you add a bespoke question, its options must cover every value the other layers
emit.** A `scoresAs`/answer question that omits a value the mapper or `bodyStyles` can
produce leaves those buyers with no matching answer. Motorrad's added `ridingStyle`
question has no roadster/naked choice though `bodyStyles` offers both categories. Before
finishing, cross-check the added question's option set against the brand's `body`/`tags`
vocabulary. And when a re-titled base question sits next to a bespoke one, make sure their
titles don't read as near-duplicates (Motorrad's `bodyStyles` "What kind of riding calls
to you?" vs `ridingStyle` "What kind of riding is this for?").

## 4. Client wiring

### 4a. Register the brand key + client copy
Three client edits, all one-liners, none optional:
- `KNOWN_BRANDS` in `blocks/vehicle-matcher/vehicle-matcher.js` — add the key, or the shell
  rejects it and falls back to bmw. The block then applies `vm vm-<brand>` classes, which is
  what the theme (Layer 4) hangs off.
- `BRAND_COPY.<brand>` in `blocks/vehicle-matcher/modes/brand-copy.js`. This is the CLIENT
  copy map, separate from the server's `BRAND_COPY` in `questions.js`. It resolves
  **all-or-nothing** (`BRAND_COPY[brand] || BRAND_COPY.bmw`), so a missing entry silently
  serves BMW's words — including the intro lede "the approved-used **cars** at **Grassicks
  BMW**". Spread `...BRAND_COPY.bmw` then override the marque/register lines (`name`, `title`,
  `cta`, `lede`, and for a non-car brand the noun lines that say "car"/"drive").

### 4b. A fetch adapter for a non-shared feed
When a brand's stock is not on the BMW/MINI platform, add its adapter behind the
registry's `source`. Keep it inside `server/stock.js` so the TTL cache, single-flight
and warmer still wrap it. A fixtures-backed source reads `fixtures/<brand>-cars.json`
(already-mapped car objects) and needs no network.

### 4c. The demo harness retailer name
`block.html` (the standalone harness) hardcodes a **"Retailer Name" row = "Grassicks
BMW"**, the BMW default. It is a *separate* row from Brand, so `?brand=<key>` alone does
NOT change it — every non-BMW brand then reads "...at Grassicks BMW" in the intro and
results (Motorrad compounds it: "...bikes at Grassicks BMW"). Add the new brand to
`BRAND_RETAILER_NAMES` in block.html (and the same map in index.html, the demo
homepage) so `?brand=<key>` applies a matching demo retailer
name (a single dealer where the brand has one, else the national programme name, e.g.
"Ford Approved Used"). Precedence is `?retailerName=` > `?retailer=<id>` map > `?brand=`
default. On a real EDS page the author sets the row, so this is a demo-harness fix — but
the demo is where every brand gets eyeballed, so a missed entry looks like a real bug.

## 5. The car-vs-vehicle generalisation (non-car brands)

The domain model is nominally "car" but the engine scores generic axes. To onboard a
non-car brand (e.g. motorcycles), **generalise vocabulary, repurpose axes, do not fork
the engine**:
- User-facing "car" becomes "vehicle"; "test drive" becomes "book a test ride" etc., via
  Layer 5 copy and the modes' brand-neutral strings.
- Map the domain's real specs onto the engine's scored fields as **documented proxies**
  (e.g. a bike's engine cc / weight / seat height / category onto size/practicality/
  performance). Record each proxy in `DECISIONS.md` — this is where honesty matters most.
- Use `questions { drop, add }` + `scoresAs` for domain-native questions (riding style,
  licence class, engine cc) so the engine still only ever reads answer keys it knows.
- Watch the fuel/power minority. A non-car domain that is "nearly all one power type plus a
  couple of EVs" (bikes) is exactly where a name-based fuel check (Layer 2) and a
  fuel-asserting label (Layer 5) go wrong. Gate `ev` on a spec property and keep category
  labels power-neutral, as above.

## 6. Validation (do all of it, per brand)

1. `cd server && npm test` — green, and BMW/MINI output unchanged (no regression).
2. `node --check` every edited `.js`; check CSS brace balance.
3. Local run: `npm run serve`, open `?brand=<key>` — the questionnaire
   paints, populates from the brand's stock, photos de-prioritised, reveal fires,
   reduced-motion safe, re-mount safe.
4. Headless DOM harness (jsdom): mount the questionnaire per brand and assert rendered output.
5. `grep` the user-facing strings for em dashes — zero.
   Also grep for **another brand's retailer name and vocabulary** leaking into this brand's
   screens ("Grassicks", "bikes", "approved-used") — the questions-mode intro and mode
   subheads are the usual offenders. Every visible string must resolve from this brand's
   copy/config, never a hardcoded default.
6. Eyeball the brand at each mode against the real site: primary-button fill (accent vs
   black), heading weight + casing, button-label casing, **and the mode switcher tab bar
   at rest** — open `?brand=<key>` with no `mode` lock so the switcher shows, and confirm the
   inactive tabs carry the brand (accent on hover, brand font, any per-brand casing/fill
   signature), not the generic grey pills (Layer 4). Tests don't catch rendered typography,
   so this is a manual gate.
7. Read every brand's intro `lede` (and `title`/`cta`) side by side. If swapping the marque
   nouns would make them indistinguishable, the voice work isn't done (Layer 5) — rewrite in
   the brand's register, don't leave BMW's sentence with a new noun in it.
8. Parametrise `server/test/brand.test.js` over the new brand (mapping yields valid engine
   schema; budget/tuning sane; questions resolve).

## 7. Checklist (copy this per brand)

- [ ] Data reachable? (Section 2) Decide feed / adapter / fixtures; record in DECISIONS.md.
- [ ] `fixtures/<brand>-cars.json` present (real scrape or curated) if not same-platform.
- [ ] `BRANDS.<brand>`: origin, defaultRetailer, budget, tuning, source, questions.
- [ ] `BRAND_MAPPERS.<brand>` + `MODEL_SPECS_<BRAND>` in mapping.js.
- [ ] `.vm.vm-<brand>` theme block defines the full token contract (Section 3, Layer 4).
- [ ] SERVER `BRAND_COPY.<brand>` (server/questions.js) in the brand's voice, no em dashes.
- [ ] CLIENT copy wired (Section 4a): `KNOWN_BRANDS` includes the key; `BRAND_COPY.<brand>`
      in modes/brand-copy.js spreads the BMW base and overrides
      the marque/register lines — else the intro/results silently show BMW's "cars at
      Grassicks BMW".
- [ ] Intro `lede` (and `title`/`cta`, `tasteLede`/`tiedLede`, `working*`) actually rewritten
      in the brand's voice, not the BMW sentence with the noun swapped. Read all brands' ledes
      side by side (Section 6 step 7): indistinguishable-but-for-the-noun means not done.
- [ ] Demo harness (Section 4c): `BRAND_RETAILER_NAMES[<brand>]` added in block.html and
      index.html so `?brand=<key>` shows the brand's own retailer, not "Grassicks BMW".
- [ ] Fuel detection keys on a spec property, not a model name; every EV in the spec table
      asserted to resolve to `ev` in a test.
- [ ] No option label asserts a fuel/size/capability its members don't all share; help text
      naming specific models is either exhaustive or model-neutral.
- [ ] Each bespoke question's options cover every `body`/`tag` value the mapper can emit;
      re-titled base questions don't clash with bespoke ones.
- [ ] Brand typeface **packaged** (`@font-face` + files in `blocks/vehicle-matcher/fonts/`),
      named first in the token stack; one family per typeface with real `font-weight`s (no
      per-weight family names); each `@font-face` weight matches the file's internal
      `usWeightClass` vs the weight the CSS requests; licence-to-self-host noted in
      DECISIONS.md. (Sub-brands reuse the parent's files.)
- [ ] Primary-button fill chosen deliberately (accent vs black) against the real site, not
      left at the base `--vm-accent` default.
- [ ] Heading weight + casing overridden to the brand's own register (base `.vm-title` is
      BMW-cars Light-300 uppercase); button-label casing done via CSS `text-transform`, never
      by uppercasing copy strings.
- [ ] Mode switcher tabs read as the brand at REST, not just on the active tab — if the
      brand's CTA signature differs from `--vm-accent` (black fill, uppercase), mirror it on
      `.vm.vm-<brand> .vm-switcher-tab` as Motorrad does. Checked with the switcher visible
      (no `mode` lock).
- [ ] Game character registered (Section 8).
- [ ] All of Section 6 passes.

## 8. Per-brand hooks that already exist (use these, don't fork logic)

- **Question surgery**: `BRANDS[brand].questions = { drop, add }` + option `scoresAs`
  (`server/questions.js` `applyBespokeAnswers`). Add/remove questions without an engine change.
- **Game character**: `blocks/vehicle-matcher/modes/match-signal.js` carries a per-brand
  character (confetti density + which CSS-token motion applies). New brands pick a
  character in the map; the default is BMW-restrained. (Colour and easing are the
  stylesheet's job via `--vm-ease` / `--vm-accent-spot`.)

## 9. Known sharp edges

- The feed usually lacks 0-62 / boot / seats — the model-line spec table is not optional.
- Paint colour costs one PDP fetch per shown car (`enrichColours`); only ever enrich the
  handful on screen, never a whole pool.
- A placeholder image is a photo URL shared across several cars; `photosFirst`
  (`match-signal.js`) sinks those. If a brand's feed hands out placeholders differently,
  revisit that heuristic.
- **Latent data bugs hide behind thin fixtures.** A curated fixtures file may not contain
  the very rows that would expose a mapping or label bug (Motorrad ships 5 bikes, none of
  them scooters or EVs, so its CE 02 fuel mis-map and "Electric scooter" label are invisible
  until a real capture lands). Don't take "renders fine today" as "correct" — assert the
  edge cases (every EV, every category) in `brand.test.js` against the spec table, not just
  the shipped fixtures.
- **The base styles are BMW's, and a brand inherits them silently.** `.vm-btn-primary` fills
  with `--vm-accent`; `.vm-title` is Light-300 uppercase. A new brand that only sets tokens
  and writes copy will *look done* while quietly wearing BMW's button-colour logic and BMW
  cars' thin uppercase headlines. This is exactly what happened to Motorrad: blue (accented)
  buttons instead of its signature black, and thin headlines instead of bold — both passed
  every test because tests don't assert rendered typography. Eyeball the real brand site's
  CTAs and headlines and override fill, weight and casing on purpose (see Layer 4).
- **A fixture is a snapshot of the mapper, and it does NOT re-run itself.** Every
  fixtures-source brand ships a *mapped* JSON (`fixtures/<brand>-cars.json`), baked once from
  raw by a builder. Change the mapper (`map<Brand>Raw`) to surface a new field and the served
  fixture is instantly stale — it still holds the old shape, so the field is missing on every
  card even though the mapper is correct and the tests pass. After ANY mapper change, re-run
  that brand's builder to re-bake the fixture, then re-run the suite. (This bit us surfacing
  Honda colour/power/cc and Motorrad real cc/power: the mapper was right, the fixtures were a
  build behind.) Builders: `build-honda-fixtures.mjs` (from `honda-raw.json`),
  `build-ford-fixtures-from-capture.mjs` (from a capture), `fetch-motorrad-all-pages-cold.mjs`.
- **A field only reaches a card if it clears all three gates.** Mapper writes it →
  `publicCar` (`server/index.js`) allowlists it → the card renderer reads it. A value can be
  mapped and baked into the fixture and STILL never appear because `publicCar` drops it — that
  allowlist is a hard projection, not a passthrough. Motorrad's `cc` was mapped for months but
  absent from `publicCar`, so no card ever saw it. When adding display data, edit all three.
- **Motorrad self-issues its session; it does NOT need a browser or a pasted cURL.** The feed
  is GMB-SID gated, but the server embeds a fresh SID in the landing page (`#hfSID`), so the
  whole chain runs cold: GET the landing page, scrape the SID, POST `ShowResults` per page.
  `server/stock.js` (`mintMotorradSid`) does this live, and `fetch-motorrad-all-pages-cold.mjs`
  does it for a full-deck re-bake. Older notes/scripts that say "capture a cURL from the
  browser" predate this and are superseded — reach for the cold self-mint path first.
