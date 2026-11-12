/*
 * Taste-to-answers helpers left over from the removed swipe and head-to-head modes.
 * Only ageInYears/registrationDate are still used (server/test/age.test.js).
 */

import { el, gbp } from '../ui.js';

/*
 * Below this the engine stops calling its leader a match at all — the client's
 * "we don't really have this" threshold. Mirror of WEAK_SCORE in
 * ../vehicle-matcher.js and scripts/persona-check.mjs; kept client-side because
 * it's a presentation decision, not a server value. When a result's leader
 * crosses it, the celebration still fires but adds one honest note.
 */
export const WEAK_SCORE = 68;

/*
 * Colour shade → swatch hex, for the card colour bar/tint and the "Colour" taste
 * bar (§11.4). Brand-neutral and keyed by the NORMALISED shade the feed returns
 * (car.colour.colour), not marketing names — so it survives "Chili Red" vs
 * "Rooftop Grey" naming. Unknown shades fall back to a neutral swatch. This is a
 * small display table, deliberately not the prototype's five hard-coded hexes.
 */
export const SHADE_HEX = {
  red: '#c0392b', orange: '#d35400', yellow: '#e2b100', green: '#1e8449',
  blue: '#2563a8', purple: '#6c3483', pink: '#c0536a', brown: '#7b5033',
  beige: '#c9b79c', white: '#f4f4f4', silver: '#c8ccce', grey: '#8a8f93',
  gray: '#8a8f93', black: '#2a2a2a',
};
export const NEUTRAL_SWATCH = '#c8ccce';

/**
 * Budget tiles for the seed step, derived from the engine's `budget` question
 * so the range is per-brand (MINI caps ~£50k where BMW reaches £150k+). The
 * quiz uses a dual-thumb slider; the games want a few tap targets, so we
 * quantise the engine's `max` into round "up to £Xk" bands plus an open-top
 * "£Xk plus". Each band is the [min, max] pair the engine expects (see
 * budgetRange in server/engine.js), so no answer shape changes — only the
 * control does. Falls back to a sane MINI-ish ladder if the question is missing.
 *
 * Returns [{ label, range: [min, max] }]. The last band is open-topped at the
 * slider max, so a MINI player never sees a £70k tile and a BMW player does.
 */
export function budgetBandsFromQuestion(budgetQ) {
  const max = Number(budgetQ?.max) || 50000;
  // Round ceilings up to `max`. Steps scale with the range so BMW doesn't get
  // eight tiles and MINI two: ~£10k steps under £50k, ~£25k above.
  const step = max <= 50000 ? 10000 : 25000;
  const tops = [];
  for (let top = step; top < max; top += step) tops.push(top);
  const bands = tops.map((top, i) => ({
    label: i === 0 ? `Under ${gbpShort(top)}` : `Up to ${gbpShort(top)}`,
    range: [0, top],
  }));
  // Open-topped final band, from the last ceiling to the engine's max.
  const floor = tops.length ? tops[tops.length - 1] : 0;
  bands.push({ label: `${gbpShort(floor)} plus`, range: [floor, max] });
  return bands;
}

/** "£20k", "£150k" — compact money for the budget tiles. */
export const gbpShort = (n) => (n % 1000 === 0 ? `£${n / 1000}k` : gbp(n));

/**
 * The `primaryUse` options as the seed's "what's it for" tiles, taken straight
 * from the engine so the labels/subs are the brand's own (MINI's "Nipping round
 * town", BMW's "City driving") and any brand-excluded option is already gone.
 * Returns [{ value, label, sub }]. Falls back to an empty list if the question
 * is missing — the caller guards on that.
 */
export function useTilesFromQuestion(useQ) {
  return (useQ?.options || []).map((o) => ({ value: o.value, label: o.label, sub: o.sub }));
}

/** In-place Fisher–Yates. Math.random is fine — this is the game surface, not
 * the reproducible engine (§4.2 build note). */
export function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/*
 * Sink the cars that don't show a real photo. Both games look better — and read
 * more like the dating / head-to-head games they're pretending to be — when every
 * card shows a genuine picture; a picture-less (or placeholder-picture) contender
 * next to a photographed one is a weak matchup (user feedback: "I'm not matching
 * with anyone who can't be arsed to upload their photo"). So order the field into
 * three tiers, best first, each tier keeping its incoming (already-shuffled)
 * order:
 *
 *   2  real photo   — car.photo is set AND unique to this car in the field
 *   1  placeholder  — car.photo is set but SHARED by several cars in the field
 *                     (a generic "image coming soon" graphic the feed hands out
 *                     in place of a real shot reads as a photo to the renderer,
 *                     but it isn't one — the user flagged exactly this)
 *   0  no photo     — car.photo absent
 *
 * This is a STABLE re-order, not a filter: when the deck/bracket then slices to
 * its target size, the weak-image cars fall off the end if there's enough supply,
 * but still act as filler for a thin/photo-poor feed rather than starving the
 * game. The placeholder tier is a within-field frequency signal (no server flag
 * exists for "this URL is a placeholder"): a URL shared across cars can't be a
 * per-car photo, and when every URL is unique — the common case — the middle tier
 * is simply empty and this degrades to a plain photo/no-photo split.
 *
 * `photoOf` reads the photo URL off whatever the list holds — the swipe deck
 * carries match objects ({ car }), the knockout field carries bare cars — so the
 * caller passes the right accessor.
 */
export function photosFirst(list, photoOf) {
  // Count each non-empty photo URL across the whole field, so a URL used by more
  // than one car can be recognised as a shared placeholder rather than a photo.
  const urlCounts = new Map();
  for (const item of list) {
    const url = photoOf(item);
    if (url) urlCounts.set(url, (urlCounts.get(url) || 0) + 1);
  }
  const rank = (item) => {
    const url = photoOf(item);
    if (!url) return 0;
    return urlCounts.get(url) > 1 ? 1 : 2;
  };
  // Stable partition into the three tiers, best (real photo) first. A plain
  // filter into three arrays preserves each tier's incoming order.
  const tiers = [[], [], []];
  for (const item of list) tiers[rank(item)].push(item);
  return [...tiers[2], ...tiers[1], ...tiers[0]];
}

/** The normalised shade for a car, or null. Prefers the structured shade the
 * enrichment set; falls back to lower-casing a marketing name's last word. */
export function shadeOf(car) {
  const shade = car.colour?.colour;
  if (shade && SHADE_HEX[shade.toLowerCase()]) return shade.toLowerCase();
  const name = car.colour?.manufacturerColour || (car.colours && car.colours[0]);
  if (!name) return null;
  // Marketing names end in the shade more often than not ("Chili Red").
  const last = String(name).trim().split(/\s+/).pop().toLowerCase();
  return SHADE_HEX[last] ? last : null;
}

/** Swatch hex for a card (neutral when the shade is unknown/unenriched). */
export const swatchFor = (car) => SHADE_HEX[shadeOf(car)] || NEUTRAL_SWATCH;

/** Price line for a card: single used price, or a grouped range. */
export function priceLabel(car) {
  if (car.listingCount > 1 && car.priceFrom !== car.priceTo) return `from ${gbp(car.priceFrom)}`;
  if (car.priceMin === car.priceMax) return gbp(car.priceMin);
  return `${gbp(car.priceMin)}–${gbp(car.priceMax)}`;
}

/** Cap-first a value for display ("electric" → "Electric"). */
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/*
 * The approximate registration date of a car, as a Date, from whatever the feed
 * gives us — brand-neutral because the `plate` field arrives in three shapes and
 * some brands surface a date instead:
 *   1. `firstReg` "dd/mm/yyyy" (Honda/Motorrad listings) — the exact date.
 *   2. `year` (a plain number, same brands) — 1 March of that year, a fair midpoint.
 *   3. `plate` — the DVLA age identifier, embedded differently per brand:
 *        BMW/MINI  bare code            "23", "72"
 *        Ford      code + dealer tag    "23 FRD"      (first token)
 *        Honda     full VRM             "AU19MVG"     (chars 3-4)
 *      Code 1-50  = March of 2000+code (23 → Mar 2023).
 *      Code 51-99 = September of 2000+(code-50) (72 → Sep 2022).
 * Returns null when nothing usable is present (never guess an age).
 */
export function registrationDate(car) {
  if (!car) return null;
  // 1. Exact first-registration date, if the feed parsed one.
  if (typeof car.firstReg === 'string' && car.firstReg.includes('/')) {
    const [d, m, y] = car.firstReg.split('/').map((n) => parseInt(n, 10));
    if (y > 1990 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return new Date(y, m - 1, d);
  }
  // 2. A plain registration year.
  if (Number.isFinite(car.year) && car.year > 1990) return new Date(car.year, 2, 1);
  // 3. Decode the DVLA age identifier out of the plate.
  const code = plateAgeCode(car.plate);
  if (code != null) {
    if (code >= 1 && code <= 50) return new Date(2000 + code, 2, 1); // March
    if (code >= 51 && code <= 99) return new Date(2000 + code - 50, 8, 1); // September
  }
  return null;
}

/*
 * Age of a car in whole years from its registration date to `now` (defaults to
 * today). Floored, so a car registered 3y 10m ago is "3", matching how a person
 * states an age. Returns null when the date is unknown. `now` is injectable so
 * the pure function is testable without the clock.
 */
export function ageInYears(car, now = new Date()) {
  const reg = registrationDate(car);
  if (!reg) return null;
  let years = now.getFullYear() - reg.getFullYear();
  // Not yet reached this year's registration anniversary → one fewer.
  const beforeAnniversary = now.getMonth() < reg.getMonth()
    || (now.getMonth() === reg.getMonth() && now.getDate() < reg.getDate());
  if (beforeAnniversary) years -= 1;
  return years < 0 ? 0 : years;
}

/*
 * Pull the two-digit DVLA age identifier out of a plate, whatever the brand's
 * plate shape (see registrationDate). Current-style plates are "AB12 CDE": two
 * letters, the age code, then three letters. We take the first run of letters,
 * then the two digits that follow. A bare "23" or "23 FRD" has no leading
 * letters, so the digits are just the front of the string. Returns 1-99 or null.
 */
function plateAgeCode(plate) {
  if (typeof plate !== 'string') return null;
  const s = plate.trim().toUpperCase();
  // Leading letters (0-2 for a modern VRM, 0 for a bare code), then two digits.
  const m = s.match(/^[A-Z]*?(\d{2})/);
  if (!m) return null;
  const code = parseInt(m[1], 10);
  return code >= 1 && code <= 99 ? code : null;
}

/*
 * The modal value in a list, with its share of the total. Used for the taste
 * bars: {value, count, share} where share is 0–1. Ties break to first seen.
 */
export function modal(values) {
  const counts = new Map();
  for (const v of values) {
    if (v == null) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) { best = v; bestCount = c; }
  }
  return best == null ? null : { value: best, count: bestCount, share: bestCount / values.length };
}

/** Distinct values ranked by frequency: [{value, count}], most-kept first. */
export function rankByFrequency(values) {
  const counts = new Map();
  for (const v of values) {
    if (v == null) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count }));
}

/*
 * Turn a WEIGHTED bag of liked cars (plus the seed answers) into the engine's
 * answer object — the whole point of the game modes. The result is the SAME shape
 * the questionnaire mode builds; it goes straight to /api/match.
 *
 * `liked` is a flat list of cars where a car appears once per unit of preference:
 * the swipe game passes each kept car once; the knockout passes each car `weight`
 * times (how far it advanced), so a crowned car speaks louder than a first-round
 * exit. Either way the reading below is just frequency over that bag.
 *
 * Principle: infer only the *taste* keys, and err toward OMITTING a key over
 * guessing it — an omitted key lets the engine use its own default, which is
 * safer than a wrong inference. budget + primaryUse come from the seed and are
 * never touched here.
 *
 * Brand safety: MINI has no saloon/coupe/mpv body or diesel fuel (those options
 * are brands:['bmw'] in server/questions.js). We only ever emit values we
 * actually observed on real cards, so we can't emit a value the engine rejects.
 */
export function likesToAnswers(liked, seed) {
  const answers = { ...seed };
  if (liked.length === 0) return answers;

  // Body / fuel: the distinct values seen among liked cars, most-liked first. Only
  // keep a preference once at least two "votes" agree, so a single stray like
  // isn't read as a want (thin data → omit).
  const bodyByFreq = rankByFrequency(liked.map((c) => c.body));
  const fuelByFreq = rankByFrequency(liked.map((c) => c.fuel));
  if (liked.length >= 2) {
    const bodies = bodyByFreq.filter((b) => b.count >= 2).map((b) => b.value);
    const fuels = fuelByFreq.filter((f) => f.count >= 2).map((f) => f.value);
    if (bodies.length) answers.bodyStyles = bodies;
    if (fuels.length) answers.fuel = fuels;
  }

  // Style (1–5, sent as a STRING per server/questions.js). Sporty skew → 4/5 if
  // liked cars lean to sporty bodies or hot trims; else leave the engine's
  // default rather than asserting "balanced".
  const sportyBodies = liked.filter((c) => /coupe|convertible|roadster/i.test(c.body || '')).length;
  const sportyTrims = liked.filter((c) => /\b(jcw|cooper s|m\d|competition|gts?)\b/i.test(
    `${c.name || ''} ${c.line || ''}`,
  )).length;
  const sportyShare = (sportyBodies + sportyTrims) / liked.length;
  if (sportyShare >= 0.5) answers.style = '5';
  else if (sportyShare >= 0.25) answers.style = '4';

  // Priorities (max 2). Derive from the pattern, not from a form:
  //  - consistent colour/body → they're buying with their eyes → image
  //  - economical fuel liked → economy
  //  - sporty skew → performance
  const priorities = [];
  const colourModal = modal(liked.map((c) => shadeOf(c)).filter(Boolean));
  const bodyModal = bodyByFreq[0];
  const looksLed = (colourModal && colourModal.share >= 0.5)
    || (bodyModal && bodyModal.count / liked.length >= 0.6);
  if (looksLed) priorities.push('image');
  const economical = liked.filter((c) => c.fuel === 'ev' || c.fuel === 'phev').length;
  if (economical / liked.length >= 0.5) priorities.push('economy');
  if (sportyShare >= 0.5 && !priorities.includes('performance')) priorities.push('performance');
  if (priorities.length) answers.priorities = priorities.slice(0, 2);

  // Charging is only a real question if the inferred fuel leans electric — and
  // then we say "open to it" rather than guessing where they'd charge.
  const fuels = answers.fuel || [];
  if (fuels.includes('ev') || fuels.includes('phev')) answers.charging = 'either';

  // people: derived from the seed use case, not from taste (a player can fancy a
  // two-seater and still need to seat a family — §4.1).
  if (seed.primaryUse === 'family') answers.people = 'family';

  // mileage is deliberately omitted — the game can't read annual miles; the
  // engine's own default stands.
  return answers;
}

/*
 * Swipe game's inference (§5.3): each KEPT car is one unit of preference. A thin
 * wrapper over likesToAnswers so the swipe mode keeps its familiar name.
 */
export function swipesToAnswers(kept, seed) {
  return likesToAnswers(kept, seed);
}

/*
 * Knockout championship's inference: advancement-weighted taste → engine answers.
 *
 * Same discipline as the swipe game (err toward OMITTING; only emit observed,
 * brand-safe values), but a car's voice scales with how far it advanced. We
 * express that by REPEATING each car `weight` times into the liked bag, where
 * weight = the number of rounds the car survived (a first-round loser = 1, a
 * semi-finalist = 2, the champion = the round count). Feeding that weighted bag
 * through the SAME likesToAnswers machinery means there is one inference idiom,
 * not two — the knockout just votes with heavier ballots for cars the player kept
 * choosing.
 *
 * `rounds` is the bracket log: an array (indexed by round, 0 = first round) of
 * matchups { winner, loser } — the mode records one per head-to-head. The
 * champion is the winner of the last round.
 */
export function bracketToAnswers(rounds, seed) {
  const totalRounds = rounds.length ? Math.max(...rounds.map((r) => r.roundIndex)) + 1 : 0;
  // survived[carId] = how many rounds this car won (0 if it lost its first).
  const survived = new Map();
  const carById = new Map();
  for (const m of rounds) {
    carById.set(idOf(m.winner), m.winner);
    carById.set(idOf(m.loser), m.loser);
    survived.set(idOf(m.winner), (survived.get(idOf(m.winner)) || 0) + 1);
    // A loser that never appears as a winner keeps weight 1 (see below).
    if (!survived.has(idOf(m.loser))) survived.set(idOf(m.loser), 0);
  }
  // Weight = wins + 1, so every car that played gets at least one ballot and the
  // champion (won `totalRounds` matchups) gets the heaviest. Clamp defensively.
  const liked = [];
  for (const [id, wins] of survived) {
    const car = carById.get(id);
    const weight = Math.max(1, Math.min(wins + 1, totalRounds + 1));
    for (let i = 0; i < weight; i += 1) liked.push(car);
  }
  return likesToAnswers(liked, seed);
}

/** Stable-ish identity for a preview car: the PDP link is unique per listing;
 * fall back to name+price so a feed without links still de-dupes sanely. */
export function idOf(car) {
  return car?.link || `${car?.name || ''}|${car?.priceMin ?? ''}`;
}

/* ------------------------------ reveal ------------------------------ */

/*
 * Per-brand celebration character. The JS owns one dial only — particle COUNT,
 * i.e. how exuberant the burst is; colour and easing are the stylesheet's job
 * via each brand's .vm-<brand> scope (--vm-ease / --vm-accent-spot). This map is
 * the single place a brand's exuberance lives, so onboarding a brand is one
 * entry here (plus its CSS token block), never an edit to celebrate() itself.
 *
 *   - restrained (BMW, Ford): measured, fewer plainer bits.
 *   - lively (MINI, Honda): warm and playful, denser burst.
 *   - punchy (Motorrad): a denser burst too, but the energy is sporting, not
 *     cutesy — the sharpness comes from the theme (motorsport-red spot + crisp,
 *     unbouncy --vm-ease), so the count just turns the exuberance up. Finding
 *     your bike is a high-adrenaline moment; the burst should match it.
 *
 * A brand not listed falls back to the restrained default, so a new brand is
 * never broken here — it just starts understated until it opts into warmth.
 */
const BRAND_CELEBRATION = {
  bmw: { count: 26 },
  ford: { count: 26 },
  mini: { count: 40 },
  honda: { count: 36 },
  motorrad: { count: 36 },
  // Ferrari: a measured, slightly-raised burst. Finding one is a genuine event,
  // so a touch above BMW's restraint, but the brand is understated luxury, not
  // confetti-cannon exuberance — the sparkle comes from the red spot and the
  // composed --vm-ease, so the count stays dignified.
  ferrari: { count: 30 },
  // Rolls-Royce: measured and dignified, a touch above Ferrari's. Finding one
  // is a genuine occasion but the brand moves calmly, never with confetti-cannon
  // energy. Count sits between Ferrari's 30 and MINI's 40.
  rrmc: { count: 32 },
};
const DEFAULT_CELEBRATION = { count: 26 };

/*
 * The shared celebration burst on a result reveal — one implementation for both
 * games (the swipe match and the knockout champion), so the crescendo can't
 * drift between them. Was a 24-bit copy in each mode; extracted and enriched
 * here into a denser, staggered burst with per-brand character (BRAND_CELEBRATION).
 *
 * The bits are plain confetti — no glyphs (the earlier hearts were pulled with
 * the rest of the Valentine's iconography). Character is carried by a
 * `.vm-<brand>`-scoped CSS + the token (--vm-ease / --vm-accent-spot), so the JS
 * just varies the particle COUNT; colour and easing are the stylesheet's job. The
 * caller gates this on prefers-reduced-motion (the CSS also hides it as a belt-
 * and-braces second guard). `host` should be position:relative so the absolutely
 * positioned layer fills it.
 */
export function celebrate(host, { brand } = {}) {
  const { count } = BRAND_CELEBRATION[brand] || DEFAULT_CELEBRATION;
  const layer = el('div', 'vm-mingle-confetti');
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i += 1) {
    // Plain confetti bits — no glyphs (the hearts went with the rest of the
    // Valentine's iconography). Character is the count + the stylesheet's colour.
    const bit = el('span', 'vm-mingle-confetti-bit');
    bit.style.left = `${(i / count) * 100}%`;
    // Stagger across a wider window than the old 6-step cycle, so the burst
    // rains rather than dropping in one sheet.
    bit.style.animationDelay = `${(i % 10) * 0.05}s`;
    layer.append(bit);
  }
  host.append(layer);
}
