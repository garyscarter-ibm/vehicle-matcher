/*
 * BMW Matcher API — zero-dependency Node HTTP server.
 *
 * Runs the matching engine server-side so the scoring weights (engine.js)
 * never reach the browser, and fetches live used-car stock from a real BMW
 * retailer (stock.js) so matches are cars you can actually buy today. The
 * EDS block calls:
 *
 *   GET  /api/questions  → quiz definition (showIf functions stripped)
 *   POST /api/match      → { answers } → { matches } from the configured
 *                          retailer's own stock (fast path). Display-only car
 *                          fields (no tags/specs the engine uses internally,
 *                          so the dataset can't be rebuilt).
 *   POST /api/preview    → { answers } → { matches }: the top few from the
 *                          configured retailer's stock for the quiz's live
 *                          "best guess" drawer. Same scoring + cache as
 *                          /api/match, just a wider slice — served hot from the
 *                          warmed cache so mid-quiz refreshes are cheap.
 *   POST /api/nearby     → { answers } → { nearby }: the best matches at
 *                          *other* retailers close by, each carrying a real
 *                          distance in miles. Split from /api/match so its
 *                          slow national search never blocks the hero matches;
 *                          degrades to [] on any failure (HTTP 200).
 *   GET  /health         → { ok: true }
 *
 * Portable: no framework, no build step. Deploy behind any host; set PORT.
 */

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

import {
  matchCars, rankCars, groupListings, budgetRange, unmetWants, TOP_MATCHES,
} from './engine.js';
import {
  fetchRetailerStock, fetchNearbyStock, startStockWarmer, StockUnavailableError, enrichColours,
  normalizeScope,
  startColourWarmer,
} from './stock.js';
import {
  QUESTIONS, BUDGET_BANDS, questionsForBrand, applyBespokeAnswers,
} from './questions.js';
import { normalizeBrand, brandTuning } from './brands.js';
import { fetchDealerDirectory } from './dealers.js';
import { geocodePostcode } from './geocode.js';

const PORT = Number(process.env.PORT) || 8787;
const MAX_BODY_BYTES = 16 * 1024; // quiz answers are tiny; reject anything bigger

// A shared secret that gates the /api/* surface, set only in the host's env
// (e.g. Render dashboard) so it's never committed. When it's unset or empty,
// auth is OFF — local dev and the whole test suite run open, unchanged. When
// it's set, every /api/* call must carry a matching X-Access-Key header (see
// isAuthorized). /health stays open either way for the platform health check.
// Rotate by changing this one env var; the frontend needs no redeploy because
// the password is entered at runtime, not baked in. Read per-request (not
// cached at load) so a rotation takes effect on the next call, and so tests can
// toggle it around a single server instance.
function accessKey() {
  return process.env.DEMO_ACCESS_KEY || '';
}

// How many matches the quiz's live "best guess" drawer shows. Wider than the
// results page's TOP_MATCHES (3) — it's a browse-the-shortlist glance, not the
// final recommendation. The retailer may hold fewer that survive the filters;
// the block renders however many come back.
const PREVIEW_COUNT = 9;

// The game modes (swipe deck, knockout bracket) ask /api/field for a *roster* of
// real stock, not a shortlist — a bracket wants a full field. This is the ceiling
// on that roster (a Round-of-16 bracket, or a deck): a brand with a big feed like
// BMW fills it; a thinner feed like MINI returns fewer and the mode adapts down.
// It does NOT change what the engine scores (still the whole feed via rankCars) —
// only how many of the ranked cars enter the game. Kept separate from
// PREVIEW_COUNT so the questions drawer's tuned top-9 is untouched.
const FIELD_MAX = 16;

/** Clamp a client-supplied roster size into [2, FIELD_MAX]; default to the cap
 * when it's absent or not a positive number. Two is the smallest playable field
 * (a single final); above the cap we just return the cap rather than error. */
function clampFieldSize(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 2) return FIELD_MAX;
  return Math.min(n, FIELD_MAX);
}

/** Flatten lists breadth-first: one item from each, then the next from each.
 * For work queues that get cut off by a budget, this shares the spend across
 * every list instead of finishing the first and starving the rest. */
function interleave(lists) {
  const out = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i += 1) {
    for (const list of lists) if (i < list.length) out.push(list[i]);
  }
  return out;
}

const CORS_HEADERS = {
  // Read-only tool. Origin stays '*' on purpose: the block is driven by a
  // runtime ?api=<url> from arbitrary origins (and file:// locally), and the
  // real gate is the X-Access-Key header check (origin-independent), not the
  // origin. X-Access-Key must be advertised here or the browser preflight
  // blocks the custom header before the request reaches the handler.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Access-Key',
  'Access-Control-Max-Age': '86400',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Is this request allowed to reach the /api/* surface?
 *
 * When ACCESS_KEY is unset, auth is OFF and every request passes — this is what
 * keeps local dev and the test suite running open with no env var set. When it's
 * set, the request must carry an X-Access-Key header that matches. The compare is
 * constant-time (timingSafeEqual), which needs equal-length buffers and throws
 * otherwise, so we bail early on a missing header or a length mismatch (the
 * length of a shared demo password isn't a secret worth protecting).
 */
function isAuthorized(req) {
  const expected = accessKey();
  if (!expected) return true;
  const provided = req.headers['x-access-key'];
  if (typeof provided !== 'string' || provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

/**
 * Quiz definition for the client, for a given brand. Options the brand doesn't
 * sell are filtered out (questionsForBrand); `showIf` predicates can't cross
 * JSON, so we drop them and mark conditional questions — the block applies the
 * matching predicate from quiz-meta.js by question id.
 */
function publicQuestions(brand) {
  return questionsForBrand(brand)
    .map(({ showIf, ...q }) => (showIf ? { ...q, conditional: true } : q));
}

/**
 * Project a car down to only the fields the result cards render (see
 * matchCard() in vehicle-matcher.js). Internal scoring fields — tags, sizeClass,
 * id — are omitted so responses can't be used to reconstruct the dataset. The
 * real display fields (mileage, plate, photo, retailerName, link) come from the
 * live feed and are passed through where present.
 *
 * `seats` and `boot` used to be withheld with the rest of the scoring fields.
 * They are printed on the card now (Priya walks away from "a boot claim she
 * cannot picture", and we were not even giving her the number), and a field the
 * card prints is public by definition.
 *
 * `retailerId` is deliberately absent: it exists only so fetchNearbyStock can
 * drop the anchor retailer's own cars, and the block has no use for it.
 */
function publicCar(car) {
  return {
    // The advert id — already public in `link` (/vehicle/{advert_id}), and the
    // only stable identity the page has for a car. Refinement state needs it:
    // without it every card compares equal to every other, so "not this one"
    // would rule out the lot.
    id: car.id,
    name: car.name,
    line: car.line,
    body: car.body,
    fuel: car.fuel,
    priceMin: car.priceMin,
    priceMax: car.priceMax,
    poa: car.poa || undefined,
    zeroTo62: car.zeroTo62,
    mpg: car.mpg,
    evRange: car.evRange,
    // The two practicality facts the engine hard-filters on. Both come from
    // MODEL_SPECS (mapping.js), so they describe the model rather than the
    // individual listing, and the card says so ("seats up") rather than
    // implying a measured figure for this exact car.
    seats: car.seats,
    boot: car.boot,
    blurb: car.blurb,
    // Live retailer detail (present when sourced from the live feed).
    mileage: car.mileage,
    // Mileage on application (RRMC): no reading was published, so cards print "MOA".
    moa: car.moa || undefined,
    plate: car.plate,
    // Age source for the swipe card's dating frame ("3 years old" instead of a
    // reg plate). The plate encodes the age code for plated brands, but bikes
    // (Motorrad) carry no plate in the feed, so the registration year/date are
    // surfaced here too. Both describe the listing, so a card that prints an age
    // is fair game (see ageInYears in match-signal.js for the derivation order).
    year: car.year,
    firstReg: car.firstReg,
    // RRMC's own question facts, so "Why this one?" can say where the car sits against them.
    handDrive: car.handDrive,
    region: car.region,
    photo: car.photo,
    // Granular facts the life-fit questions never ask about, for the
    // refinement step: equipment concepts (mapping.js FEATURE_CONCEPTS),
    // gearbox, and paint — the last fetched per shown car from the PDP, so
    // it's present on match results and absent elsewhere.
    features: car.features,
    transmission: car.transmission,
    colour: car.colour,
    // Per-listing detail recovered from the raw feeds, for the card layer.
    // cc/power are real for Honda (bhp), Motorrad (kW) and Ferrari (bhp), and now
    // BMW/MINI (cc, from the feed's engine block); topSpeed is real per-listing
    // for Ferrari (mph); fullServiceHistory and previousOwners are real per-
    // listing for Ford. Each describes the individual car (not the model), so a
    // card may state them as the listing's own.
    cc: car.cc,
    power: car.power,
    topSpeed: car.topSpeed,
    fullServiceHistory: car.fullServiceHistory,
    previousOwners: car.previousOwners,
    // Set when repeat listings of the same car were grouped (see
    // groupListings): how many the retailer has, the price spread and the
    // colours they come in, so one card can speak for all of them.
    listingCount: car.listingCount,
    priceFrom: car.priceFrom,
    priceTo: car.priceTo,
    colours: car.colours,
    retailerName: car.retailerName,
    // The retailer's own homepage (RRMC only today), for the "Presented by" link.
    retailerUrl: car.retailerUrl,
    link: car.link,
    // Miles from the configured retailer. Only set on `nearby` cars — the
    // hero matches are the configured retailer's own stock.
    distance: car.distance,
  };
}

/* ------------------------- the whole-pool wire format ------------------ *
 * Every other endpoint here sends a handful of cars, richly described. This one
 * sends the ENTIRE national pool, because the Guess Who mode is a hard filter
 * over all of it: the user watches twelve thousand cars become nine, so the
 * client has to hold twelve thousand cars.
 *
 * Sent as columns with dictionaries rather than an array of objects, which is
 * not premature cleverness — it is the difference between viable and not.
 * Measured on the real BMW pool (12,084 cars):
 *
 *   full mapped pool, as-is        865 KB gzip
 *   object per car, filter fields  452 KB gzip
 *   these columns, card-complete   377 KB gzip
 *
 * The saving comes from how little actual variety there is: 553 distinct model
 * names across 12,084 cars, 22 distinct features, one link prefix. Dictionaries
 * turn each of those into an index, and `link` stops being sent at all.
 *
 * Two consequences worth stating, because they are the whole point:
 *  1. ONE request serves the entire mode. There is no hydrate-on-demand tier and
 *     no pagination, so no filter interaction can ever wait on the network.
 *  2. Filtering is then a pass over parallel arrays — measured at 0.035 ms for
 *     eight predicates over 12,012 cars. That is why the mode can re-filter on
 *     every pointer move instead of debouncing.
 *
 * `features` is a BITMASK, not a list: both brands have fewer than 31 distinct
 * feature concepts, so a car's whole equipment set fits in one integer and a
 * must-have test is `(car & wanted) === wanted`.
 * --------------------------------------------------------------------- */

/** Dictionary-encode a column: returns [distinctValues, indexPerCar]. */
function dictionary(values) {
  const distinct = [];
  const index = new Map();
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] ?? null;
    let at = index.get(v);
    if (at === undefined) {
      at = distinct.length;
      distinct.push(v);
      index.set(v, at);
    }
    out[i] = at;
  }
  return [distinct, out];
}

/**
 * The national pool as columns, for the hard-filter mode.
 *
 * Thumbnails, not full photos. Both CDNs the feed uses expose a small variant,
 * and at ~5 KB against ~165 KB it is a 31× saving — which matters when a first
 * paint is hundreds of cards rather than five. Neither CDN is the throttled
 * used-car origin, so thumbnails cost nothing against that rate limit. The
 * client swaps up to the full image once cards are big enough to show one.
 */
function thumbnail(url) {
  if (!url) return null;
  // eu.cdn.autosonshow.tv/…/e01_md.jpg → _sm.jpg (160×90)
  if (url.includes('autosonshow')) return url.replace('_md.jpg', '_sm.jpg');
  // m.atcdn.co.uk/a/media/{resize}/<hash>.jpg — the feed leaves {resize}
  // unsubstituted, and the CDN then redirects it to the full-size original, so
  // filling it in is both smaller AND one redirect cheaper.
  return url.replace('{resize}', 'w160');
}

/**
 * Where each retailer in the `retailers` dictionary is, as two arrays aligned
 * with THAT dictionary rather than with the cars: `lat[retailer[i]]` is car i's
 * site. One entry per retailer (130 for BMW, 121 for MINI) instead of one per
 * car is the whole reason it is shaped this way — a per-car coordinate pair
 * would be 12,000 of each for 130 distinct values.
 *
 * Hung off `retailers` and not `retailerId` deliberately. For BMW and MINI the
 * two are interchangeable (measured: 130 ids to 130 names, and 121 to 121), but
 * every other brand carries a single brand-wide id string against real
 * per-listing names — Ferrari has 1 id and 15 names — so keying on the id would
 * collapse fifteen dealers into one place and make the filter lie.
 *
 * `directory` is the dealer directory (dealers.js), or null when it could not be
 * fetched. Null coordinates are an ordinary outcome, not a failure: they mean
 * this retailer's site could not be located, and the client drops those cars
 * from the proximity filter exactly as it drops colourless cars from the colour
 * filter. Notably every car is in that state until a national walk has run since
 * `dealerNumber` was added to mapVehicle, because the cached and committed pools
 * predate the field.
 *
 * Rounded to 4 decimal places — about 11 metres, against a filter whose
 * narrowest band is ten miles. It halves the bytes for precision no-one could
 * act on.
 */
function siteCoords(cars, retailers, retailer, directory) {
  const lat = new Array(retailers.length).fill(null);
  const lon = new Array(retailers.length).fill(null);
  if (!directory) return { lat, lon };

  const round = (n) => Math.round(n * 1e4) / 1e4;
  for (let i = 0; i < cars.length; i += 1) {
    const at = retailer[i];
    // First car that locates this retailer wins. Not simply the first car of the
    // retailer: the feed omits dealer_number on some rows (see mapVehicle), so
    // an unlocated slot has to stay open to the next car that might fill it.
    if (lat[at] !== null) continue;
    const site = directory.get(String(cars[i].dealerNumber ?? ''));
    if (!Number.isFinite(site?.latitude) || !Number.isFinite(site?.longitude)) continue;
    lat[at] = round(site.latitude);
    lon[at] = round(site.longitude);
  }
  return { lat, lon };
}

function publicPool(brand, cars, directory = null) {
  // Only the concepts this pool actually contains, so the bitmask stays as
  // narrow as possible and the client's filter list has no dead options.
  const featureKeys = [...new Set(cars.flatMap((c) => c.features || []))].sort();
  const featureBit = new Map(featureKeys.map((k, i) => [k, i]));

  const [names, name] = dictionary(cars.map((c) => c.name));
  const [lines, line] = dictionary(cars.map((c) => c.line));
  const [bodies, body] = dictionary(cars.map((c) => c.body));
  const [fuels, fuel] = dictionary(cars.map((c) => c.fuel));
  const [transmissions, transmission] = dictionary(cars.map((c) => c.transmission));
  const [retailers, retailer] = dictionary(cars.map((c) => c.retailerName));
  // Paint, in both forms the UI needs: the normalised basic name the filter
  // groups by ("Grey") and the marketing name a card prints ("Brooklyn Grey").
  // Absent for any car the colour warm pass hasn't reached yet — those are
  // silently excluded from the colour filter rather than shown with a caveat.
  const [shades, shade] = dictionary(cars.map((c) => c.colour?.colour ?? null));
  const [paints, paint] = dictionary(cars.map((c) => (
    c.colour?.manufacturerColour ?? c.colour?.colour ?? null)));

  // `link` is always the same prefix plus the advert id, for every car of a
  // brand, so send the prefix once instead of 12,000 near-identical URLs.
  const linkPrefix = cars.find((c) => c.link)?.link?.replace(/[^/]+$/, '') || null;
  // RRMC's addresses carry a slug after the id, so they ship whole; prefix+id brands send none.
  const links = cars.some((c) => c.link && c.link !== `${linkPrefix}${c.id}`)
    ? cars.map((c) => c.link ?? null) : undefined;

  // RRMC's own facts, each sent only when some car carries it, so other brands' payloads don't grow.
  // Option labels and the price range come from the brand's questions, which own that copy.
  const extras = {};
  const qs = questionsForBrand(brand);
  if (cars.some((c) => c.poa)) extras.poa = cars.map((c) => (c.poa ? 1 : 0));
  for (const [col, dict, qid] of [['handDrive', 'handDrives', 'handDrive'], ['region', 'regions', 'regions']]) {
    if (!cars.some((c) => c[col])) continue;
    [extras[dict], extras[col]] = dictionary(cars.map((c) => c[col] ?? null));
    const opts = qs.find((q) => q.id === qid)?.options || [];
    extras.labels = { ...extras.labels, [col]: Object.fromEntries(opts.map((o) => [o.value, o.label])) };
  }
  const budgetQ = qs.find((q) => q.id === 'budget');
  if (budgetQ?.openTop) {
    extras.priceRange = {
      min: budgetQ.min, max: budgetQ.max, step: budgetQ.step, minGap: budgetQ.minGap || 0,
    };
  }

  return {
    brand,
    n: cars.length,
    linkPrefix,
    ...(links && { links }),
    // Dictionaries. Each pairs with the same-named column below.
    names, lines, bodies, fuels, transmissions, retailers, shades, paints,
    featureKeys,
    // Pairs with `retailers`: each retailer's homepage, or null where the feed has none.
    retailerUrls: retailers.map((r) => cars.find((c) => c.retailerName === r && c.retailerUrl)?.retailerUrl ?? null),
    // The one table that is not per-car: it pairs with `retailers` above, not
    // with a column. See siteCoords.
    sites: siteCoords(cars, retailers, retailer, directory),
    // Columns — every one exactly `n` long and index-aligned.
    id: cars.map((c) => c.id),
    name, line, body, fuel, transmission, retailer, shade, paint,
    retailerId: cars.map((c) => c.retailerId ?? null),
    price: cars.map((c) => c.priceMin ?? null),
    mileage: cars.map((c) => c.mileage ?? null),
    // Only sent when some car has no published reading (RRMC's "MOA").
    ...(cars.some((c) => c.moa) && { moa: cars.map((c) => (c.moa ? 1 : 0)) }),
    year: cars.map((c) => c.year ?? null),
    plate: cars.map((c) => c.plate ?? null),
    seats: cars.map((c) => c.seats ?? null),
    boot: cars.map((c) => c.boot ?? null),
    zeroTo62: cars.map((c) => c.zeroTo62 ?? null),
    mpg: cars.map((c) => c.mpg ?? null),
    features: cars.map((c) => (c.features || [])
      .reduce((mask, k) => mask | (1 << featureBit.get(k)), 0)),
    photo: cars.map((c) => thumbnail(c.photo)),
    ...extras,
  };
}

function publicMatch({
  car, score, stretch, reasons, tradeOffs, listings,
}) {
  return {
    car: publicCar(car),
    score,
    stretch,
    reasons,
    tradeOffs,
    // The individual cars behind a grouped card. Sent for EVERY match, not
    // just multi-listing ones, because the page's refine/reject layer filters
    // listings and rebuilds the card from the survivors — a one-listing group
    // is just the degenerate case of that, and special-casing it in the client
    // is how the two paths drift apart.
    //
    // The field list is "whatever a filter can test": colour and shade for the
    // colour chips, price and mileage for the reject reasons, transmission and
    // features for the gearbox and equipment chips. `shade` is the normalised
    // name ("Blue") the chips group by; `colour` is the marketing one
    // ("Portimao Blue") the buyer reads.
    listings: (listings?.length ? listings : [car]).map((c) => ({
      id: c.id,
      // Each listing is a real car with its own photographs, so the card can
      // show the one the buyer picked rather than the one that ranked first.
      // Colour is the reason this choice exists; a picture of a different
      // colour undoes it.
      photo: c.photo,
      colour: c.colour?.manufacturerColour || c.colour?.colour,
      shade: c.colour?.colour,
      priceMin: c.priceMin,
      poa: c.poa || undefined,
      mileage: c.mileage,
      moa: c.moa || undefined,
      transmission: c.transmission,
      features: c.features,
      link: c.link,
      // For RRMC's "View Options" tiles, which name each version and where it is.
      year: c.year,
      retailerName: c.retailerName,
    })),
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Stop reading, but DON'T destroy the socket: a reset reaches the
        // client as a generic "connection closed", indistinguishable from a
        // network drop. Pausing lets the handler's 413 response flush first, so
        // the block can actually see it's the payload that was refused. Ignore
        // any further body — we've decided.
        req.pause();
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Parse + validate the { answers, retailer } POST body shared by /api/match,
 * /api/nearby and /api/field. Returns { answers, retailer, brand, scope, size,
 * enrich, group } on success, or { error, status } for the caller to send. One
 * place so every endpoint validates identically. `size`/`enrich` are only
 * meaningful to /api/field (the game-mode roster) and `group` only to
 * /api/preview; the match/nearby handlers ignore them.
 */
async function readMatchRequest(req) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return { error: err.message, status: err.statusCode || 400 };
  }
  const answers = body && body.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return { error: 'Missing "answers" object', status: 400 };
  }
  // Budget validation is deferred to the callers that require it (/api/match).
  // Preview works with partial answer sets, so no budget check here.
  const retailer = typeof body.retailer === 'string' && body.retailer ? body.retailer : undefined;
  // Which pool to score against: this retailer's own forecourt (default) or the
  // brand's whole national feed. normalizeScope defaults absent/garbage to
  // 'dealer', so an old client that sends no scope keeps the original behaviour.
  const scope = normalizeScope(body.scope);
  // Brand selects the feed (BMW vs MINI). normalizeBrand defaults unknown/absent
  // to BMW, so old clients that don't send a brand keep working.
  const brand = normalizeBrand(body.brand);
  // Game-mode roster controls (see handleField). A client asking for a bigger
  // field than FIELD_MAX is clamped, not rejected; absent/garbage falls back to
  // the cap. `enrich` opts a caller into per-card paint (swipe wants it; the
  // knockout doesn't pay for 16 PDP fetches on round-one losers).
  const size = clampFieldSize(body.size);
  const enrich = body.enrich === true;
  // `group` opts a caller into one-card-per-model results (see handlePreview).
  // Opt-in rather than default, and strict `=== true` like `enrich`, because the
  // questions drawer's top-9 is tuned around listings and must not shift under
  // it: an absent or garbage flag has to leave that response untouched.
  const group = body.group === true;
  // `suggest` marks a suggestion row (see handlePreview), the one place price may lead.
  const suggest = body.suggest === true;
  return {
    answers, retailer, brand, scope, size, enrich, group, suggest,
  };
}

/**
 * The retailer's own matches — the fast path. Scores against just the
 * retailer's live stock (one feed, ~3 pages), so the results page can render
 * the hero + "More at" tier without waiting on the slower national nearby
 * search, which the block now fetches separately via /api/nearby.
 */
async function handleMatch(req, res, deps) {
  const {
    answers, retailer, brand, scope, error, status,
  } = await readMatchRequest(req);
  if (error) return sendJson(res, status, { error });

  // Final match requires a resolved budget unless the brand treats a missing
  // budgetGate as "no limit" (RRMC: unanswered gate = no parameters).
  if (!budgetRange(answers) && answers.budgetGate !== 'no'
      && (brand !== 'rrmc' || answers.budgetGate != null)) {
    return sendJson(res, 400, { error: 'Invalid or missing budget' });
  }

  // Live proxy: score against the retailer's real stock, not a static file.
  // If the live feed can't be reached, return a friendly 5xx — the block's
  // retry UI handles it. No static fallback (this tool is honestly live-only).
  let cars;
  try {
    cars = await deps.fetchRetailerStock(brand, retailer, scope);
  } catch (err) {
    if (err instanceof StockUnavailableError) {
      return sendJson(res, 502, { error: 'Live stock is temporarily unavailable' });
    }
    return sendJson(res, 500, { error: 'Something went wrong finding matches' });
  }

  // Fold any bespoke per-brand question answers into the standard fields the
  // engine scores (see applyBespokeAnswers) before ranking.
  const scored = applyBespokeAnswers(brand, answers);
  const {
    matches, alternatives, decisive, clusterSize, tasteLead, searched,
  } = matchCars(scored, cars, brandTuning(brand));

  // Paint only exists on the vehicle detail page, so it's fetched for the
  // handful of cars we're about to show rather than the whole pool (see
  // enrichColours). Enriches the cached car objects in place, so a second
  // session at the same retailer gets them for free.
  // Enrich the grouped card AND the listings behind it: a card that says "4
  // available in Portimao Blue, Brooklyn Grey or Alpine White" needs every
  // listing's paint, not just the one that ranked first.
  // Shown cards get their listings enriched too (the picker needs every
  // colour); the held-back alternatives only need their own paint, since they
  // aren't on screen yet.
  // Grouping copies the representative into a fresh `car` object and keeps the
  // originals in `listings`, so enriching one does NOT enrich the other. Both
  // have to be enriched, or a grouped card gets paint on its headline and none
  // on the listings behind it.
  //
  // Only the headline cars are waited on. Against a national pool the full
  // queue (cards + every sampled listing + alternatives) runs to a few hundred
  // PDPs, which cannot drain inside any budget a user should sit through — so
  // the request blocks on just the paint that is actually on screen, and the
  // rest is warmed behind the response. The colour cache is permanent, so the
  // picker is populated by the time anyone opens it, and a repeat visit is
  // complete and instant.
  await deps.enrichColours(brand, matches.map((m) => m.car));
  const warmRest = deps.enrichColours(brand, [
    // Round-robin, not card-by-card: the budget runs out long before this queue
    // does, and taken depth-first the first card's 24 listings consume all of it
    // — leaving five pickers able to name a single colour. One listing from each
    // card, then a second from each, spreads the same spend so every picker has
    // something real to offer.
    ...interleave(matches.map((m) => m.listings || [])),
    ...alternatives.map((m) => m.car),
    ...interleave(alternatives.map((m) => m.listings || [])),
  ]);
  // Detached: a slow or failing PDP must not hold up (or reject) this response.
  if (warmRest?.catch) warmRest.catch(() => {});
  // Paint is only known after that call, so the group's colour list is filled
  // in here rather than at grouping time. Alternatives get the same treatment:
  // a rejection promotes one into view, and it should arrive able to say what
  // colours it comes in rather than repairing itself on the next request.
  for (const m of [...matches, ...alternatives]) {
    if (m.listings?.length > 1) {
      m.car.colours = [...new Set(m.listings
        .map((c) => c.colour?.manufacturerColour || c.colour?.colour)
        .filter(Boolean))];
    }
  }
  // What this retailer couldn't offer, so the page can say so instead of
  // quietly serving the closest thing (see unmetWants). Reported against the
  // folded answers — those are the wants actually searched for. Half the
  // picture: the block waits for /api/nearby to agree before telling the user
  // a want is genuinely unavailable.
  return sendJson(res, 200, {
    matches: matches.map(publicMatch),
    // Held back for "not this one" to fall through to (see matchCars).
    alternatives: alternatives.map(publicMatch),
    // Whether naming a single winner is honest, and how big the tie really is
    // (it can exceed matches.length — see matchCars). The page decides between
    // "your perfect BMW is…" and "any of these would suit you" on this.
    decisive,
    clusterSize,
    // Fit couldn't separate the leaders but the buyer's stated preferences
    // could, so the page may name one honestly (see matchCars).
    tasteLead,
    // How much stock was searched, how much survived the hard filters, and how
    // far clear the winner is. The page uses it to show its working (see the
    // working note in the block) rather than presenting a verdict with no
    // evidence behind it.
    searched,
    unmet: unmetWants(scored, cars),
  });
}

/**
 * The quiz's live "best guess" — the same scoring as /api/match against the
 * same (cached) retailer stock, just a wider PREVIEW_COUNT slice for the
 * drawer that re-ranks as each question is answered. Shares fetchRetailerStock's
 * cache key with /api/match, so a quiz's stream of refreshes hits the warmed
 * cache and adds no upstream traffic. Requires a budget (readMatchRequest
 * enforces it) — the block only calls this once budget is set.
 *
 * Collapsing repeat listings into one card per model is opt-in (`group: true`),
 * following the same precedent as /api/field's `enrich`. The drawer is a
 * horizontal strip where the same model appearing twice in nine reads as stock
 * depth, so it takes the raw listings and is deliberately unchanged. A podium
 * cannot: three medals awarded to the same Countryman in three colours is not a
 * result, it's a rounding error, so that caller asks for grouping.
 */
async function handlePreview(req, res, deps) {
  const {
    answers, retailer, brand, scope, group, suggest, error, status,
  } = await readMatchRequest(req);
  if (error) return sendJson(res, status, { error });

  let cars;
  try {
    cars = await deps.fetchRetailerStock(brand, retailer, scope);
  } catch (err) {
    if (err instanceof StockUnavailableError) {
      return sendJson(res, 502, { error: 'Live stock is temporarily unavailable' });
    }
    return sendJson(res, 500, { error: 'Something went wrong finding matches' });
  }

  // The preview scores partial answer sets (only budget is guaranteed), so
  // guard the ranking too: a scorer that trips on an unanswered question must
  // degrade to "no guess yet" (empty list, HTTP 200 — the drawer is a bonus),
  // never take the process down with an uncaught throw.
  let matches = [];
  try {
    // A suggestion row may lean towards the high end where no price is set; the ranking itself never does.
    const base = brandTuning(brand);
    const tuning = suggest && base.suggestionPriceLean != null
      ? { ...base, noBudgetPriceLean: base.suggestionPriceLean } : base;
    const ranked = rankCars(applyBespokeAnswers(brand, answers), cars, tuning);
    // Group the WHOLE ranking before slicing. Slicing first would hand
    // groupListings nine listings that might be three cars, and the caller
    // would get three cards where it asked for nine — the shortfall growing
    // with exactly the stock depth that made grouping worth asking for.
    matches = (group ? groupListings(ranked) : ranked).slice(0, PREVIEW_COUNT);
  } catch (err) {
    console.warn('[preview] ranking failed:', err?.message);
  }

  // Paint the preview cards. The questions-mode drawer never needed colour, but
  // the swipe mode (MINI Mingle) treats it as a first-class taste signal — a
  // card's paint and the "Colour" bar both read car.colour, which only exists
  // after a per-car PDP fetch (see enrichColours). Enrich the slice we're about
  // to return, exactly as handleMatch does for its hero cars. Paint is cached
  // permanently AND preview shares the stock cache with /api/match, so this is
  // paid once per car ever and also warms the eventual match's colour — no
  // wasted fetches. It's best-effort under a wall-clock budget: a card whose
  // paint didn't land in time simply renders without colour (the client falls
  // back to a neutral swatch), and enrichment never throws, so a slow PDP can't
  // turn the "bonus" drawer into an error.
  try {
    await deps.enrichColours(brand, [
      ...matches.map((m) => m.car),
      ...matches.flatMap((m) => m.listings || []),
    ]);
    // Fill in each grouped card's colour list now that its listings are painted
    // (mirror handleMatch): a card standing for several listings can name the
    // colours they come in.
    for (const m of matches) {
      if (m.listings?.length > 1) {
        m.car.colours = [...new Set(m.listings
          .map((c) => c.colour?.manufacturerColour || c.colour?.colour)
          .filter(Boolean))];
      }
    }
  } catch (err) {
    console.warn('[preview] colour enrichment failed:', err?.message);
  }

  return sendJson(res, 200, { matches: matches.map(publicMatch) });
}

/**
 * The game modes' roster — the field a swipe deck or a knockout bracket plays.
 * Same engine, same (cached) retailer stock as /api/match and /api/preview, but
 * a different *read* of it: a wider slice (up to `size`, capped at FIELD_MAX)
 * because a bracket wants a full field, not a top-few shortlist. This is the
 * server half of the client's "one engine, many interfaces" seam — a sibling to
 * /api/preview, not a replacement: /api/preview stays tuned to the questions
 * drawer's top-9-with-paint, this serves the games.
 *
 * Colour paint is opt-in (`enrich: true`). The swipe deck reads car.colour as a
 * taste signal so it asks for it (its deck is small — ~10 PDP fetches). The
 * knockout doesn't: painting all 16 entrants would fetch a PDP for cars that
 * lose in round one, so it takes the field unpainted and the face-off falls back
 * to a neutral swatch. Enrichment is best-effort and never throws, exactly as in
 * handlePreview.
 */
async function handleField(req, res, deps) {
  const {
    answers, retailer, brand, scope, size, enrich, error, status,
  } = await readMatchRequest(req);
  if (error) return sendJson(res, status, { error });

  let cars;
  try {
    cars = await deps.fetchRetailerStock(brand, retailer, scope);
  } catch (err) {
    if (err instanceof StockUnavailableError) {
      return sendJson(res, 502, { error: 'Live stock is temporarily unavailable' });
    }
    return sendJson(res, 500, { error: 'Something went wrong finding matches' });
  }

  // Score the whole feed, then take the roster off the top. Guarded like the
  // preview: a partial answer set must degrade to "no field yet" (empty, 200),
  // never take the process down.
  let matches = [];
  try {
    matches = rankCars(applyBespokeAnswers(brand, answers), cars, brandTuning(brand)).slice(0, size);
  } catch (err) {
    console.warn('[field] ranking failed:', err?.message);
  }

  if (enrich) {
    try {
      await deps.enrichColours(brand, [
        ...matches.map((m) => m.car),
        ...matches.flatMap((m) => m.listings || []),
      ]);
      for (const m of matches) {
        if (m.listings?.length > 1) {
          m.car.colours = [...new Set(m.listings
            .map((c) => c.colour?.manufacturerColour || c.colour?.colour)
            .filter(Boolean))];
        }
      }
    } catch (err) {
      console.warn('[field] colour enrichment failed:', err?.message);
    }
  }

  return sendJson(res, 200, { matches: matches.map(publicMatch) });
}

/**
 * Cars at OTHER nearby retailers — the slow path (a national, distance-sorted
 * search over several extra pages). Split out from /api/match so its latency
 * never blocks the hero matches. This section is a bonus, so any failure
 * degrades to an empty list (HTTP 200) rather than an error the block must
 * surface — the block simply omits the "Worth the drive" section.
 *
 * `unmet` reports the wants this pool couldn't offer (see unmetWants), and is
 * deliberately `null` — not `{}` — when the lookup failed. The block only
 * tells a user a want is unavailable once both halves agree it is, so it has
 * to tell "nearby found nothing that fits" (a fact) apart from "we never
 * heard back from nearby" (an absence of facts, which claims nothing).
 */
async function handleNearby(req, res, deps) {
  const {
    answers, retailer, brand, error, status,
  } = await readMatchRequest(req);
  if (error) return sendJson(res, status, { error });

  let nearby = [];
  let unmet = null;
  try {
    const cars = await deps.fetchNearbyStock(brand, retailer);
    const scored = applyBespokeAnswers(brand, answers);
    const ranked = rankCars(scored, cars, brandTuning(brand));
    nearby = ranked.slice(0, TOP_MATCHES);
    unmet = unmetWants(scored, cars);

    // Rescue slots. The top slice is ranked on the whole blend, which can
    // squeeze out the very want this tier exists to honour: every MINI
    // plug-in hybrid is a Countryman, so for a PHEV-hatchback ask the body
    // penalty ranks all of them below the cut — and the response then claims
    // the want is met (unmet says so, measured against the pool) while
    // showing no car that meets it. "Never let the anchor retailer's
    // inventory hide a preference the nearby tier could honour" has to hold
    // for the SLICE, not just the pool: for each stated fuel/body value with
    // no representative in the slice, append the best-ranked car that has it.
    const stated = [
      ...(Array.isArray(scored.fuel) ? scored.fuel : [])
        .filter((v) => v !== 'open').map((v) => [(c) => c.fuel === v]),
      ...(scored.bodyStyles || [])
        .filter((v) => v !== 'any').map((v) => [(c) => c.body === v]),
    ];
    for (const [has] of stated) {
      if (!nearby.some((m) => has(m.car))) {
        const best = ranked.find((m) => has(m.car));
        if (best) nearby.push(best);
      }
    }
  } catch (err) {
    console.warn('[nearby] stock unavailable:', err?.message);
  }

  return sendJson(res, 200, { nearby: nearby.map(publicMatch), unmet });
}

/**
 * Build the HTTP server. The stock source is injected (defaulting to the live
 * stock.js functions) so tests can drive the whole routing + validation + handler
 * surface against an in-memory fixture — no live feed, no port collisions (bind
 * port 0). Production (see the main-module block below) calls this with the real
 * deps. The handlers read `fetchRetailerStock`/`fetchNearbyStock`/`enrichColours`
 * off this `deps` object rather than the module imports, which is the seam.
 */
export function buildServer(deps = {}) {
  const resolved = {
    fetchRetailerStock,
    fetchNearbyStock,
    enrichColours,
    // The two location dependencies are on the same seam for the same reason as
    // the stock ones: both call a third-party host that is not ours (a 2MB
    // dealer directory, and postcodes.io), so a test that reached either would
    // be neither hermetic nor fast.
    fetchDealerDirectory,
    geocodePostcode,
    ...deps,
  };

  return createServer(async (req, res) => {
    const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      return res.end();
    }

    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    // Shared-password gate for everything below. /health above stays open (the
    // platform health check has no key), OPTIONS is already handled. When
    // DEMO_ACCESS_KEY is unset this is a no-op (see isAuthorized).
    if (!isAuthorized(req)) {
      return sendJson(res, 401, { error: 'Unauthorized' });
    }

    if (req.method === 'GET' && pathname === '/api/questions') {
      // Brand comes on the query string (?brand=mini) for this GET; the question
      // set's option list is filtered to what that brand sells. Defaults to BMW.
      // topMatches ships too so the intro can say how many results it'll return
      // without hardcoding it — see TOP_MATCHES, the value /api/match slices to.
      const brand = normalizeBrand(searchParams.get('brand'));
      return sendJson(res, 200, {
        questions: publicQuestions(brand),
        budgetBands: BUDGET_BANDS,
        topMatches: TOP_MATCHES,
      });
    }

    /*
     * The whole pool, for the hard-filter mode (see publicPool).
     *
     * A GET, unlike the other stock endpoints, because it takes no answers —
     * there is nothing to score, only stock to hand over. That also makes it
     * cacheable, which matters for a payload this size.
     *
     * Serves whatever the pool currently is, including a stale one, exactly as
     * fetchRetailerStock does: a mode whose entire premise is "here is every
     * car" must not 502 because a refresh is mid-flight.
     */
    if (req.method === 'GET' && pathname === '/api/pool') {
      const brand = normalizeBrand(searchParams.get('brand'));
      // Resolved, not raw: a typo'd scope silently becomes 'dealer', and the
      // payload echoes what was actually used so a misconfigured embed shows up
      // as a wrong `scope` in the response rather than a mysteriously small pool.
      const scope = normalizeScope(searchParams.get('scope'));
      try {
        const cars = await resolved.fetchRetailerStock(
          brand, searchParams.get('retailer') || undefined, scope,
        );
        // Retailer coordinates, for the proximity filter. Memoised for the
        // process lifetime and primed at boot, so this awaits nothing in
        // practice; a directory that is down costs the pool nothing but its
        // `sites` table, which is a state the client already handles. Never
        // allowed to fail the request — the mode's premise is every car.
        const directory = await resolved.fetchDealerDirectory().catch((err) => {
          console.warn('[pool] dealer directory unavailable:', err?.message);
          return null;
        });
        return sendJson(res, 200, { ...publicPool(brand, cars, directory), scope });
      } catch (err) {
        console.warn('[pool] stock unavailable:', err?.message);
        return sendJson(res, 502, { error: 'Stock temporarily unavailable' });
      }
    }

    /*
     * One postcode to one coordinate pair, for the proximity filter.
     *
     * A GET with the postcode in the query string, because it is neither a
     * secret nor an answer to score — and because it is then as cacheable as the
     * pool it pairs with. Deliberately NOT folded into /api/pool: the pool is
     * one shared payload for every visitor, and a per-buyer postcode in it would
     * make it uncacheable for the sake of two numbers.
     *
     * 404, not 502, for a postcode that does not exist: the buyer typed
     * something wrong and the honest answer is "no such postcode", not "we are
     * broken". 502 is reserved for the geocoder itself being unreachable, and
     * the client keeps the filter usable either way.
     */
    if (req.method === 'GET' && pathname === '/api/geocode') {
      try {
        const place = await resolved.geocodePostcode(searchParams.get('postcode'));
        if (!place) return sendJson(res, 404, { error: 'No such postcode' });
        return sendJson(res, 200, place);
      } catch (err) {
        console.warn('[geocode] lookup failed:', err?.message);
        return sendJson(res, 502, { error: 'Postcode lookup temporarily unavailable' });
      }
    }

    if (req.method === 'POST' && pathname === '/api/match') {
      return handleMatch(req, res, resolved);
    }

    if (req.method === 'POST' && pathname === '/api/preview') {
      return handlePreview(req, res, resolved);
    }

    if (req.method === 'POST' && pathname === '/api/field') {
      return handleField(req, res, resolved);
    }

    if (req.method === 'POST' && pathname === '/api/nearby') {
      return handleNearby(req, res, resolved);
    }

    return sendJson(res, 404, { error: 'Not found' });
  });
}

// Constants worth asserting against in tests without hardcoding the numbers.
export { PREVIEW_COUNT, FIELD_MAX, clampFieldSize };

// Only bind a port + warm the cache when run as the entry point (`node index.js`
// / `npm start`). Importing the module in a test gets buildServer with none of
// these side effects — no socket, no live feed.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = buildServer();
  server.listen(PORT, () => {
    console.log(`Matcher API listening on http://localhost:${PORT}`);

    // Keep live stock hot off the request path so the slow cold fetch (chiefly
    // BMW/MINI's national pagination and the nearby distance search) isn't
    // paid by a user. Prime each brand's main pool now so even the first
    // visitor hits a warm cache; the warmer then keeps every served brand
    // (and, for BMW/MINI, the national pool) fresh. Failures are non-fatal —
    // the request path still fetches on demand.
    startStockWarmer();
    // Prime every brand's main pool, and the nearby carousel for the two feed
    // brands that have one (BMW/MINI). Priming a brand also enrols it in the
    // background warmer (it tracks brands once served), so Motorrad's ~40s live
    // paged fetch and Honda's live scrape are both paid at boot and kept fresh
    // off the request path — the first visitor to any brand hits a warm cache.
    // Ford is fixtures (instant); priming it is harmless and keeps it enrolled.
    // Ferrari runs live too (its cold ~15-page walk is ~50s), so it's primed at
    // boot for the same reason as Motorrad: the first Ferrari visitor must not
    // pay that walk on the request path.
    // The dealer directory, for the same reason and more sharply: it is a ~2MB
    // response from someone else's server that its own module forbids on a
    // request path, and /api/pool needs it to say where each retailer is.
    // Memoised for the process lifetime, so this is the only fetch of it. Kept
    // out of the pool prime below so a directory failure doesn't get counted as
    // a cold pool — it isn't one, and what it costs is the proximity filter.
    fetchDealerDirectory().then(
      (sites) => console.log(`[dealers] directory primed (${sites.size} sites)`),
      (err) => console.warn(`[dealers] directory unavailable (${err?.message}) — proximity filter off`),
    );
    // Feed brands prime BOTH pools: the dealer one because it is now the default
    // an embed gets, and the national one because its on-disk index is what makes
    // ?scope=national answer instantly instead of paying the ~60s walk. Priming
    // only the default would leave the first national visitor on a cold pool.
    Promise.allSettled([
      fetchRetailerStock('bmw', undefined, 'dealer'),
      fetchRetailerStock('bmw', undefined, 'national'), fetchNearbyStock('bmw'),
      fetchRetailerStock('mini', undefined, 'dealer'),
      fetchRetailerStock('mini', undefined, 'national'), fetchNearbyStock('mini'),
      fetchRetailerStock('honda'),
      fetchRetailerStock('ford'),
      fetchRetailerStock('motorrad'),
      fetchRetailerStock('ferrari'),
    ]).then((r) => {
      const failed = r.filter((x) => x.status === 'rejected');
      if (failed.length) {
        console.warn(`[warmer] initial prime: ${failed.length}/${r.length} pools cold (will retry on demand)`);
      } else {
        console.log('[warmer] initial stock primed (BMW + MINI + Honda + Ford + Motorrad + Ferrari)');
      }
      /*
       * Colour last, and only once stock exists, because it needs the pool to
       * know which adverts to ask about (see startColourWarmer).
       *
       * Off by default. It is thousands of requests at someone else's site —
       * a ~4h20m first pass for BMW + MINI at one request per second — so it
       * is opted into with COLOUR_WARM=1 rather than fired by anyone who
       * happens to run the server. Subsequent passes are small deltas, since
       * paint is cached per advert forever and persisted to .cache/.
       */
      if (process.env.COLOUR_WARM === '1') {
        console.log('[colour] warm pass enabled (COLOUR_WARM=1) — see .cache/colours-*.json');
        startColourWarmer();
      }
    });
  });
}
