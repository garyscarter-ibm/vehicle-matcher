/*
 * Live retailer-stock client for usedcars.bmw.co.uk.
 *
 * Grassick's BMW (Perth) used stock is served by usedcars.bmw.co.uk — an
 * Auto Trader-powered platform shared by all BMW UK retailers. This module
 * fetches that stock on demand and returns it mapped to the engine's car
 * schema (see mapping.js). The matcher scores against real, buyable cars
 * instead of the static curated dataset.
 *
 * Two wrinkles the implementation has to handle:
 *  1. The list endpoint is CSRF-gated even for GET — a naked request gets
 *     403. We bootstrap a csrftoken cookie from the site root, then send it
 *     back as both a Cookie and an X-CSRFToken header (+ a Referer).
 *  2. Local dev runs on Node 16, which has no global fetch — so this uses
 *     node:https directly (zero-dep, works on every Node version).
 *
 * The token can rotate/expire, so any 403 triggers a single re-bootstrap.
 * Mapped results are cached in-memory for a short TTL so /api/match doesn't
 * refetch the whole retailer on every quiz submission.
 */

import { request } from 'node:https';
import {
  readFileSync, writeFileSync, renameSync, mkdirSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { lookupDealer } from './dealers.js';
import { mapVehicle, mapMotorradRaw, mapHondaRaw, mapFerrariRaw, mapRRMCRaw } from './mapping.js';
import { RRMC_FEED_URL, RRMC_FEED_ORIGIN, rrmcFeedBody, parseRRMCPage, projectRRMCListing } from './rrmc-listing.js';
import { brandConfig, normalizeBrand } from './brands.js';
import { parseListingHtml, listingUrl } from './honda-listing.js';
import { parseResTable } from './motorrad-listing.js';
import {
  parseListingHtml as parseFerrariHtml,
  listingUrl as ferrariListingUrl,
  paginationOf as ferrariPaginationOf,
  extractNextData as extractFerrariNextData,
} from './ferrari-listing.js';

// Repo root, from this module's location (server/ → ..). Used to resolve the
// fixtures directory for fixtures-backed brands without depending on cwd.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The stock platform is shared by BMW and MINI; only the origin and the
// default retailer differ per brand (see brands.js). Everything below is
// brand-parameterised: origin comes from brandConfig(brand), and caches/CSRF
// are keyed by brand so the two feeds never collide.
const STOCK_TTL_MS = Number(process.env.STOCK_TTL_MS) || 5 * 60 * 1000; // 5 min

// The main pool for BMW/MINI is the whole national feed, not one retailer's
// forecourt (see byNationalQuery) — matches scripts/dump-stock.js's own
// constants, since it's walking the exact same pagination. 200 is a generous
// ceiling above the observed ~120 pages, not a real cap in practice.
//
// The delay is the load-bearing constant here, and it is NOT over-caution:
// measured 2026-09-02 against usedcars.bmw.co.uk, the list endpoint is throttled
// server-side (DRF-style, `Retry-After: 20`, body "Request was throttled").
//   - no delay, sequential:  first 429 at request #27
//   - concurrency 4:         85 of 120 pages 429'd
//   - 400ms delay:           40/40 pages clean
// So ~2.5 req/s is the sustainable ceiling and concurrency makes things WORSE,
// not better. A full 120-page walk therefore costs ~60s and cannot be made
// fast — which is exactly why the result is persisted (see NATIONAL_INDEX_DIR)
// and served stale-while-revalidate rather than fetched on the request path.
const NATIONAL_PAGE_SIZE = 100; // the platform's max page size (size=500 still yields 100)
const NATIONAL_PAGE_LIMIT = Number(process.env.NATIONAL_PAGE_LIMIT) || 200;
// A dealer-scoped walk. The biggest UK BMW retailer is a few hundred cars, so 8
// pages is generous headroom; the cap only exists so a feed bug can't turn one
// forecourt into an unbounded walk.
const RETAILER_PAGE_LIMIT = Number(process.env.RETAILER_PAGE_LIMIT) || 8;
const NATIONAL_PAGE_DELAY_MS = Number(process.env.NATIONAL_PAGE_DELAY_MS) || 400;
const RATE_LIMIT_MAX_RETRIES = 5; // per page, when 429'd (honours Retry-After)

// Nearby search depth. 4 pages × 100 reaches the 5 nearest retailers from
// Perth (~31 miles out) — ample for a top-3 carousel, and nowhere near the
// ~132-page national list. Lower this first if cold-cache latency bites.
const NEARBY_PAGES = Number(process.env.NEARBY_PAGES) || 4;
const NEARBY_PAGE_SIZE = Number(process.env.NEARBY_PAGE_SIZE) || 100; // API caps at 100

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// A real browser UA — the platform serves bot-y clients differently.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Error tag so index.js can distinguish "live stock down" from other faults. */
export class StockUnavailableError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'StockUnavailableError';
    this.statusCode = 502;
    if (cause) this.cause = cause;
  }
}

/* --------------------------- low-level HTTPS --------------------------- */

/** GET a URL over node:https. Resolves { status, headers, body }. */
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: 'GET', headers: { 'User-Agent': USER_AGENT, ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('Request timed out')));
    req.end();
  });
}

/** POST a JSON body over node:https. Resolves { status, headers, body }.
 *  Used by the Motorrad live adapter, whose feed is a POST endpoint (the BMW/
 *  MINI feed is GET-only and never touches this). */
function httpsPostJson(url, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Content-Length': payload.length,
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('Request timed out')));
    req.write(payload);
    req.end();
  });
}

/** Pull the csrftoken value out of a set-cookie header array. */
function csrfFromSetCookie(setCookie) {
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean);
  for (const c of cookies) {
    const m = /(?:^|;\s*)csrftoken=([^;]+)/.exec(c);
    if (m) return m[1];
  }
  return null;
}

/* ------------------------------ CSRF cache ---------------------------- */

// The csrftoken is scoped to the origin (not the retailer), so cache one per
// brand origin. BMW and MINI are different origins → different tokens.
const csrfByOrigin = new Map(); // origin -> token

/** Fetch a brand's site root and capture its csrftoken cookie. */
async function bootstrap(origin) {
  const res = await httpsGet(`${origin}/`, { Accept: 'text/html' });
  const token = csrfFromSetCookie(res.headers['set-cookie']);
  if (!token) {
    throw new StockUnavailableError('CSRF bootstrap failed: no csrftoken cookie');
  }
  csrfByOrigin.set(origin, token);
  return token;
}

/** One page of the list endpoint for a brand's origin, CSRF handshake applied.
 *  `query` is everything but `page` — see byRetailerQuery / byDistanceQuery. */
async function fetchPage(origin, query, page) {
  const token = csrfByOrigin.get(origin);
  const url = `${origin}/vehicle/api/list/?${query}&page=${page}`;
  return httpsGet(url, {
    Accept: 'application/json',
    Cookie: `csrftoken=${token}`,
    'X-CSRFToken': token,
    Referer: `${origin}/`,
  });
}

/**
 * Fetch a page, transparently re-bootstrapping once if the token was rejected.
 * Any 403 (even mid-pagination) rotates the token and retries that page. The
 * CSRF token is scoped to the origin, so it's shared across every retailer of
 * the same brand this server proxies.
 */
async function fetchPageWithRetry(origin, query, page) {
  if (!csrfByOrigin.has(origin)) await bootstrap(origin);
  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt += 1) {
    let res = await fetchPage(origin, query, page);
    if (res.status === 403) {
      await bootstrap(origin); // token likely rotated/expired
      res = await fetchPage(origin, query, page);
    }
    // The feed rate-limits a fast burst — a small retailer-scoped fetch rarely
    // trips it, but a national walk reliably does. The throttle states its own
    // window in Retry-After (observed: 20s), so obey that rather than guessing;
    // a linear 2s/4s/6s backoff under-waits and just earns another 429.
    if (res.status === 429) {
      if (attempt === RATE_LIMIT_MAX_RETRIES) {
        throw new StockUnavailableError(`list/ still rate-limited on page ${page} after ${RATE_LIMIT_MAX_RETRIES} retries`);
      }
      const retryAfter = Number(res.headers['retry-after']);
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0
        ? (retryAfter + 1) * 1000 // +1s of slack so we don't race the window's edge
        : 2000 * (attempt + 1));
      continue;
    }
    if (res.status !== 200) {
      throw new StockUnavailableError(`list/ returned HTTP ${res.status} on page ${page}`);
    }
    try {
      return JSON.parse(res.body);
    } catch (cause) {
      throw new StockUnavailableError('list/ returned non-JSON', { cause });
    }
  }
  // Unreachable: the loop above always returns or throws.
  throw new StockUnavailableError(`list/ page ${page} failed after retries`);
}

/** All of one retailer's stock, unsorted, no distances. Still used to resolve
 * a retailer's postcode (see resolveRetailerPostcode) for the nearby carousel
 * — the main pool itself no longer scopes to a single retailer_site, see
 * byNationalQuery. */
const byRetailerQuery = (retailerSite) => `retailer_site=${encodeURIComponent(retailerSite)}`;

/** The whole national feed, unfiltered — retailer_site omitted entirely, the
 * same query scripts/dump-stock.js walks offline. This is the main pool for
 * every retailer of a feed brand, not one dealer's forecourt: a single
 * catchment is far smaller than the question set is designed against. */
const byNationalQuery = () => `size=${NATIONAL_PAGE_SIZE}`;

/**
 * Stock nationwide, nearest-first from `postcode`, with a `distance` on every
 * vehicle's retailer_site.
 *
 * The parameter is `location` — NOT `postcode`. `?postcode=…&distance=…` is
 * accepted and then *silently ignored*: it returns the same unsorted national
 * list for any input, which looks like it works until you compare two towns.
 * `payment_type` and `source` mirror the site's own home-page search.
 */
const byDistanceQuery = (postcode) => `location=${encodeURIComponent(postcode)}`
  + `&payment_type=cash&size=${NEARBY_PAGE_SIZE}&sort=distance&source=home`;

/* ------------------------------ TTL cache ----------------------------- */

// Keyed by "brand:retailerSite" — each brand+retailer this server proxies gets
// its own cache entry so BMW and MINI (and different retailers) never clobber
// each other's stock. `inflight` holds the in-progress fetch promise so
// concurrent callers (and the background warmer) share one request instead of
// each triggering their own cold fetch.
const cacheByRetailer = new Map(); // "brand:retailerSite" -> { at, cars, inflight }
const cacheNearby = new Map(); // "brand:retailerSite" -> { at, cars, inflight }

// Every brand+retailer we've been asked about, so the warmer knows what to keep
// hot. Stored as { brand, retailerSite } objects keyed by "brand:retailer".
// Feed brands' MAIN pool no longer belongs here — it's brand-wide, not
// retailer-scoped — see seenNationalBrands; this still tracks the per-retailer
// nearby-carousel anchor for those brands, and the whole pool for every other
// source type (fixtures/live-honda/live-motorrad/live-ferrari).
const seenRetailers = new Map(); // "brand:retailer" -> { brand, retailerSite }

// Feed brands (BMW, MINI) whose national pool has been requested at least
// once, so the warmer keeps it hot. A Set, not a Map keyed by retailer: the
// pool is the same regardless of which retailer_site a visitor was configured
// with, so every request for a feed brand collapses onto one warm entry.
const seenNationalBrands = new Set(); // brand

// Feed brands whose DEALER-scoped pool has been requested, so the warmer keeps
// that forecourt hot too. Deliberately separate from seenRetailers, which also
// tracks the nearby-carousel anchor for every brand: a national visitor's
// nearby request must not cause their dealer pool to be warmed as well.
const seenDealerPools = new Map(); // "brand:retailerSite" -> { brand, retailerSite }

/** Cache/seen key for a brand+retailer pair. */
const keyFor = (brand, retailerSite) => `${brand}:${retailerSite}`;

/*
 * Which pool a feed brand should serve. Only BMW/MINI have two (see
 * fetchRetailerStock); every other source type has one and ignores this.
 *
 * Unrecognised or absent values resolve to 'dealer'. That's the safe direction
 * for a typo: `?scope=nationl` shows one forecourt rather than silently
 * answering for the whole country on a retailer's own page. /api/pool echoes
 * the resolved scope so a misconfigured embed is visible rather than guessed at.
 */
export const SCOPES = ['dealer', 'national'];
export const DEFAULT_SCOPE = 'dealer';
export const normalizeScope = (value) => {
  const v = String(value ?? '').trim().toLowerCase();
  return SCOPES.includes(v) ? v : DEFAULT_SCOPE;
};

/** node:https has no argless Date.now ban — this is server runtime, fine to use. */
function fresh(entry) {
  return entry && entry.cars && Date.now() - entry.at < STOCK_TTL_MS;
}

/**
 * Read-through cache with single-flight: returns fresh cached cars, joins an
 * in-flight fetch if one is running, else starts one. `load()` does the actual
 * network work and returns the mapped cars. On success the entry is refreshed;
 * on failure a stale-but-usable entry is kept (the warmer will retry) and the
 * error propagates to any caller that was waiting on this fetch.
 *
 * @param {Map} cache the per-retailer cache map
 * @param {string} key retailer site ID
 * @param {() => Promise<Array>} load the network fetch
 */
function cachedFetch(cache, key, load) {
  const entry = cache.get(key);
  if (fresh(entry)) return Promise.resolve(entry.cars);
  if (entry?.inflight) return entry.inflight;

  const inflight = load().then(
    (cars) => {
      cache.set(key, { at: Date.now(), cars });
      return cars;
    },
    (err) => {
      // Drop only the in-flight marker; keep any stale cars so a transient
      // failure degrades to serving slightly old stock rather than nothing.
      const prev = cache.get(key);
      if (prev) delete prev.inflight;
      throw err;
    },
  );
  // Preserve stale cars (if any) alongside the in-flight promise.
  cache.set(key, { ...(entry || {}), inflight });
  return inflight;
}

/* --------------------- persisted national index ----------------------- *
 * A feed brand's national pool costs ~60s to walk and the upstream throttle
 * makes that irreducible (see NATIONAL_PAGE_DELAY_MS). Paying it on a user's
 * request is not an option, and paying it again on every process restart is
 * barely better — so the walk's result is written to disk and re-read on boot.
 *
 * That turns the cost model from "~60s per restart" into "~60s once, ever",
 * and lets a cold process serve a full national pool immediately. The snapshot
 * is a machine-local cache, never a source of truth: if it's missing or
 * unreadable we simply walk the feed, and it is always allowed to be stale
 * (the refresh happens behind whatever we just served — see nationalStock).
 * --------------------------------------------------------------------- */

const NATIONAL_INDEX_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache');
const nationalIndexPath = (brand) => join(NATIONAL_INDEX_DIR, `national-${brand}.json`);

/**
 * The on-disk national index for a brand, or null if there isn't a usable one.
 * Never throws: a missing, truncated or half-written file is just a cache miss.
 *
 * @returns {{ at: number, cars: Array }|null}
 */
function readNationalIndex(brand) {
  try {
    const snap = JSON.parse(readFileSync(nationalIndexPath(brand), 'utf8'));
    if (!Array.isArray(snap?.cars) || snap.cars.length === 0) return null;
    return { at: Number(snap.at) || 0, cars: snap.cars };
  } catch {
    // No usable snapshot. Rather than make the first visitor on a clean machine
    // sit through the walk (~170s measured for BMW), fall back to the committed
    // fixture — which is itself a national dump in the same mapped shape
    // (scripts/dump-stock.js wrote it: 13k BMW cars across 131 retailers). It's
    // weeks stale, so it's dated `at: 0` to guarantee an immediate refresh, but
    // it means a fresh clone serves a real national pool from the first request.
    try {
      const cars = loadFixtures(brand);
      return cars?.length ? { at: 0, cars } : null;
    } catch {
      return null; // no fixture either — nothing for it but to walk the feed
    }
  }
}

/**
 * Persist a brand's national index. Written to a temp file and renamed, so a
 * crash (or a concurrent reader) can never observe a half-written snapshot —
 * rename is atomic within a filesystem. Failures are logged, not thrown: this
 * is a cache, and the cars are already in memory and being served.
 */
function writeNationalIndex(brand, cars) {
  const path = nationalIndexPath(brand);
  const tmp = `${path}.tmp`;
  try {
    mkdirSync(NATIONAL_INDEX_DIR, { recursive: true });
    writeFileSync(tmp, JSON.stringify({ at: Date.now(), brand, cars }));
    renameSync(tmp, path);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[stock] could not persist ${brand} national index:`, err?.message);
  }
}

/* ---------------------------- fixtures source ------------------------- *
 * Some brands' live feeds aren't reachable yet (a bot-walled edge, or an SPA
 * whose API we can't replay), so their stock is seeded into a committed
 * snapshot at fixtures/<brand>-cars.json — the SAME already-mapped car shape
 * mapVehicle produces, so the engine, modes and every downstream fetcher treat
 * it identically to live stock. A brand opts into this with `source: 'fixtures'`
 * on its registry entry; BMW and MINI stay `source: 'feed'` and never touch
 * this code. The real fetch adapter can be wired later and the brand flipped
 * back to 'feed' with no other change.
 * --------------------------------------------------------------------- */

// brand -> parsed fixtures array. Read once per process (the file is static for
// a run); cars are already mapped so there's no per-request work to cache.
const fixturesByBrand = new Map();

/** Load and cache a brand's fixtures snapshot. The file is `<brand>-cars.json`
 *  by default; a brand whose stock isn't cars (Motorrad's bikes) overrides it
 *  with `fixturesFile` on its registry entry. Throws StockUnavailableError with
 *  a clear message if the file is missing or unusable, so a mis-seeded brand
 *  fails loudly rather than serving an empty pool. */
function loadFixtures(brand) {
  if (fixturesByBrand.has(brand)) return fixturesByBrand.get(brand);
  const { fixturesFile } = brandConfig(brand);
  const path = join(REPO_ROOT, 'fixtures', fixturesFile || `${brand}-cars.json`);
  let cars;
  try {
    cars = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new StockUnavailableError(
      `Fixtures source for "${brand}" could not be read at ${path}`,
      { cause },
    );
  }
  if (!Array.isArray(cars) || cars.length === 0) {
    throw new StockUnavailableError(`Fixtures for "${brand}" are empty or malformed`);
  }
  fixturesByBrand.set(brand, cars);
  return cars;
}

/** All of a fixtures-backed brand's stock for a retailer. The snapshot is a
 *  single retailer's inventory (or a curated set), so we return the whole pool;
 *  if the caller named a specific retailerSite, narrow to it when the cars carry
 *  one, else serve everything (a curated showcase set may not tag a retailer). */
function fixturesRetailerStock(brand, retailerSite) {
  const cars = loadFixtures(brand);
  if (retailerSite == null) return cars;
  const site = String(retailerSite);
  const narrowed = cars.filter((c) => c?.retailerId != null && String(c.retailerId) === site);
  return narrowed.length ? narrowed : cars;
}

/* ---------------------------- live Honda feed ------------------------- *
 * Honda's approved-used stock (usedcars.honda.co.uk) has no JSON API, but its
 * listing pages are fully server-rendered — so "live" here means fetch the real
 * listing HTML and parse it, the same parse that built the snapshot (see
 * honda-listing.js). Unlike BMW/MINI (Auto Trader JSON at /vehicle/api/list/),
 * this is HTML, so it gets its own adapter rather than the feed path.
 *
 * Honda's listing has NO dealer-id filter; it filters by LOCATION (a postcode +
 * a radius in miles — the site's "search near me"). That maps cleanly onto the
 * matcher's existing "near you" concept: fetchRetailerStock pulls the national
 * pool, and a caller can narrow by passing a postcode/radius (see hondaLiveStock
 * opts). Cards carry no stable per-dealer identity in the markup, so every car
 * keeps the single "Honda Approved Used" retailer tag the snapshot uses.
 *
 * Dormant while the registry says `source: 'fixtures'`; flip Honda to
 * `source: 'live-honda'` and it fetches live, degrading to the snapshot on any
 * failure so the deck is never blank. The parse and the mapper are shared with
 * the snapshot path, so a live car is indistinguishable from a fixture car.
 * --------------------------------------------------------------------- */

// How many listing pages to pull. The live inventory is small (a dozen or so
// under the approved-used programme at any time) and pages repeat once exhausted,
// so we stop as soon as a page yields no NEW cars. This is the safety cap.
const HONDA_PAGE_LIMIT = Number(process.env.HONDA_PAGE_LIMIT) || 8;

/**
 * Fetch and map the live Honda pool. Walks listing pages until one adds no new
 * cars (the inventory is small and pages repeat past the end), dedupes by the
 * real PDP link, and maps each raw record through the shared mapHondaRaw — the
 * identical projection the snapshot uses.
 *
 * @param {{zip?: string, radius?: number}} [opts] optional location filter:
 *   a postcode + radius (miles) narrows to stock near that location, which is
 *   how Honda expresses "a dealer near you" (it has no dealer-id filter).
 * @returns {Promise<Array>} mapped Honda cars
 */
async function hondaLiveStock(opts = {}) {
  const seen = new Set();
  const cars = [];
  for (let page = 1; page <= HONDA_PAGE_LIMIT; page += 1) {
    const url = listingUrl(page, opts);
    // eslint-disable-next-line no-await-in-loop
    const res = await httpsGet(url, { Accept: 'text/html' });
    if (res.status !== 200) {
      // A first-page failure is fatal (nothing to serve); a later-page failure
      // just ends pagination with what we have.
      if (page === 1) throw new StockUnavailableError(`Honda listing returned HTTP ${res.status}`);
      break;
    }
    const raw = parseListingHtml(res.body);
    let added = 0;
    for (const rec of raw) {
      if (seen.has(rec.link)) continue;
      seen.add(rec.link);
      const car = mapHondaRaw(rec);
      if (car) { cars.push(car); added += 1; }
    }
    // No new cars on this page → we've walked the whole (small) inventory.
    if (added === 0) break;
  }
  if (cars.length === 0) {
    throw new StockUnavailableError('Honda listing returned no usable cars');
  }
  return cars;
}

/* --------------------------- live Ferrari feed ------------------------ *
 * preowned.ferrari.com is a server-rendered Next.js app: every result page ships
 * the whole result set as PUBLIC JSON in <script id="__NEXT_DATA__"> (see
 * ferrari-listing.js). No token, no session, no forgery — a plain GET of each
 * result page returns the inventory, and pagination is a `?pl=N` query param.
 * So this environment can walk the entire pool cold, exactly as the Motorrad
 * self-issued-session adapter does, and map every ad through the SAME
 * mapFerrariRaw the committed snapshot was built with.
 *
 * Dormant while the registry says `source: 'fixtures'`. BOTH halves of the data
 * are cold-fetchable, no token (verified 2026-08-13): the CAR records come from
 * the public __NEXT_DATA__ blob, and the card COVER PHOTO is a Thron DAM asset on
 * the token-free /delivery/public/ path (the site hardcodes clientId `ferrari`
 * and sessId `3zayf6` as plain public constants, so a gallery id resolves to a
 * real JPEG with no SDK session — see thronCardImage in ferrari-listing.js). The
 * snapshot therefore ships 148/148 real cover photos, not photo-less cards.
 * (The one genuinely session-gated asset is the detail-page multi-image gallery,
 * same client-issued-token class as Ford's x-eusl-k — do not forge it; a card
 * shows one real cover, which reads fine.) It ships fixtures purely to avoid
 * hammering Ferrari's production site with ~15 GETs per cache-miss for data that
 * barely changes hour to hour. Flip Ferrari to `source: 'live-ferrari'` and this
 * fetches live with the identical mapper (a live car is indistinguishable from a
 * fixture car) and the same StockUnavailableError contract as every other live
 * brand. See the Ferrari section of DECISIONS.md.
 * --------------------------------------------------------------------- */

// Safety cap on pagination. The real pool is ~159 cars at ~11/page (~15 pages);
// this bounds a runaway loop well above the real page count. The adapter also
// stops early once it has walked every page the feed's own pagination reports.
const FERRARI_PAGE_LIMIT = Number(process.env.FERRARI_PAGE_LIMIT) || 20;

/**
 * Fetch and map the live Ferrari pool. Reads page 1, learns the real page count
 * from the payload's pagination, walks the rest, dedupes by the ad id, and maps
 * each raw record through the shared mapFerrariRaw — the identical projection the
 * snapshot uses, so a live car is indistinguishable from a fixture car.
 *
 * @returns {Promise<Array>} mapped Ferrari cars
 */
async function ferrariLiveStock() {
  const first = await httpsGet(ferrariListingUrl(1), { Accept: 'text/html' });
  if (first.status !== 200) {
    throw new StockUnavailableError(`Ferrari listing returned HTTP ${first.status}`);
  }
  const seen = new Set();
  const cars = [];
  const addFrom = (html) => {
    for (const rec of parseFerrariHtml(html)) {
      if (seen.has(rec.id)) continue;
      seen.add(rec.id);
      const car = mapFerrariRaw(rec);
      if (car) cars.push(car);
    }
  };
  addFrom(first.body);

  // Learn the true page count from the payload; fall back to the safety cap.
  const pag = ferrariPaginationOf(extractFerrariNextData(first.body));
  const pages = Math.min(pag?.pages || FERRARI_PAGE_LIMIT, FERRARI_PAGE_LIMIT);
  for (let page = 2; page <= pages; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await httpsGet(ferrariListingUrl(page), { Accept: 'text/html' });
    if (res.status !== 200) break; // a later-page failure just ends pagination
    addFrom(res.body);
  }
  if (cars.length === 0) {
    throw new StockUnavailableError('Ferrari listing returned no usable cars');
  }
  return cars;
}

/* --------------------------- live RRMC feed --------------------------- *
 * The Rolls-Royce Provenance feed is served by MTK Connect at
 * api.mtkconnect.io/public/v1/vehicles/rolls-royce/global. It is a public
 * POST JSON endpoint — no token, no session, no CSRF. The response is
 * { contents: [...], total: N } and paginates with `page` / `limit`.
 * --------------------------------------------------------------------- */

const RRMC_PAGE_LIMIT = Number(process.env.RRMC_PAGE_LIMIT) || 30;

/* RRMC dealers price in their own currency (19 of them); this daily public feed, which covers
   every one (the ECB's omits SAR, AED, KWD, QAR, TWD), turns them into pounds. */
const FX_URL = 'https://open.er-api.com/v6/latest/GBP';
const FX_TTL_MS = 6 * 60 * 60 * 1000;
let fxCache = null;

/** Units of each currency per £1: fresh within FX_TTL_MS, else the last good set, else null. */
async function gbpRates() {
  if (fxCache && Date.now() - fxCache.at < FX_TTL_MS) return fxCache.rates;
  try {
    const res = await httpsGet(FX_URL);
    const data = JSON.parse(res.body);
    if (res.status === 200 && data?.result === 'success' && data.rates) {
      fxCache = { at: Date.now(), rates: data.rates };
      console.log(`[fx] GBP rates as of ${data.time_last_update_utc}`);
    }
  } catch (err) {
    console.warn('[fx] rates unavailable, using the feed\'s own GBP figures:', err?.message);
  }
  return fxCache?.rates || null;
}

async function rrmcLiveStock() {
  const rates = await gbpRates();
  const first = await httpsPostJson(RRMC_FEED_URL, rrmcFeedBody(1), {
    Origin: RRMC_FEED_ORIGIN,
    Referer: `${RRMC_FEED_ORIGIN}/`,
  });
  if (first.status !== 200) {
    throw new StockUnavailableError(`RRMC feed returned HTTP ${first.status}`);
  }
  const { total, contents: firstPage } = parseRRMCPage(first.body);
  const seen = new Set();
  const cars = [];
  const addFrom = (items) => {
    for (const v of items) {
      const projected = projectRRMCListing(v, rates);
      if (!projected.id || seen.has(projected.id)) continue;
      seen.add(projected.id);
      const car = mapRRMCRaw(projected);
      if (car) cars.push(car);
    }
  };
  addFrom(firstPage);

  const pages = Math.min(
    Math.ceil(total / (firstPage.length || 50)),
    RRMC_PAGE_LIMIT,
  );
  for (let page = 2; page <= pages; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await httpsPostJson(RRMC_FEED_URL, rrmcFeedBody(page), {
      Origin: RRMC_FEED_ORIGIN,
      Referer: `${RRMC_FEED_ORIGIN}/`,
    });
    if (res.status !== 200) break;
    const { contents } = parseRRMCPage(res.body);
    if (!contents.length) break;
    addFrom(contents);
  }
  if (cars.length === 0) {
    throw new StockUnavailableError('RRMC feed returned no usable cars');
  }
  return cars;
}

/* --------------------------- live Motorrad feed ----------------------- *
 * Motorrad's approved-used stock is served by a session-gated AngularJS app
 * (ng-app="GMBApp") behind POST /api/ResultOverview/ShowResults: it takes a
 * compact filter body and returns a SearchFilter envelope whose `ResTable` is a
 * server-rendered HTML <table> string, one <tr> per bike (see motorrad-listing.js
 * for the parse). The feed authenticates with a `GMB-SID` request header and
 * answers a request without one with a NULL envelope.
 *
 * The breakthrough (confirmed live 2026-08-12): that GMB-SID is NOT minted by JS
 * or a bootstrap endpoint — the server embeds a fresh one in the results landing
 * page as a hidden field <input id="hfSID" value="…"> (base64 of
 * "<caller-ip>;<guid>", UTF-16LE), and the app just reads it with
 * $("#hfSID").val(). So this environment can self-issue a session with no browser:
 * GET the landing page, scrape #hfSID, send it as GMB-SID. Proven cold end to end
 * (scripts/motorrad-live-probe.mjs) and used to build the committed 963-bike
 * snapshot (scripts/fetch-motorrad-all-pages.mjs). See the Motorrad-live section
 * of DECISIONS.md.
 *
 * This adapter walks every page (the feed is 20/page against ~963 bikes),
 * concatenating and de-duping the HTML rows, then maps them through the SAME
 * mapMotorradRaw the committed snapshot was built with. It reuses the same
 * cache/warm/StockUnavailableError contract as the BMW/MINI feed, so a caller
 * can't tell one live brand from another. The live feed is the single source of
 * truth: a fetch failure throws StockUnavailableError (→ 502 at the API), no
 * silent fallback to the snapshot.
 * --------------------------------------------------------------------- */

// The results feed and the landing page that issues the session, relative to the
// brand origin. ShowResults is the working JSON route (the older
// ShowResultsFilterChanged answers but is not what the paged grid calls);
// ergebnisse.cshtml is the results shell that embeds #hfSID. Kept here (not the
// registry) because they're implementation details of this adapter.
const MOTORRAD_FEED_PATH = '/api/ResultOverview/ShowResults';
const MOTORRAD_LANDING_PATH = '/UK/ergebnisse.cshtml';

// An explicit session override. Normally the adapter self-issues a GMB-SID by
// scraping #hfSID from the landing page (mintMotorradSid), so this stays empty;
// set it only to force a specific captured session (e.g. debugging from a fixed
// IP). When set it skips the mint step.
const MOTORRAD_SESSION = process.env.MOTORRAD_SESSION || '';

// Safety cap on pagination. The real deck is ~963 bikes at 20/page (~49 pages);
// this bounds a runaway loop if the feed never runs dry, well above the real
// page count. Lower it to shrink the live deck (and cold-fetch latency).
const MOTORRAD_PAGE_LIMIT = Number(process.env.MOTORRAD_PAGE_LIMIT) || 60;
const MOTORRAD_PAGE_SIZE = 20; // the feed's fixed pagingSize

// Pages fetched at once. Sequential paging over ~49 pages took ~90s cold — far
// too slow for a user on a cold cache. The pages are independent once we hold a
// session, so we fetch them in batches: each batch's pages go out concurrently,
// and we stop requesting batches as soon as one comes back short/dry. 8 keeps us
// a polite guest (not 49 sockets at once) while cutting cold latency ~8x.
const MOTORRAD_PAGE_BATCH = Number(process.env.MOTORRAD_PAGE_BATCH) || 8;

// The filter body the ShowResults endpoint expects — the compact request object
// the app's paged grid posts (captured from a live session). Marke:10 is BMW
// Motorrad and the empty facet arrays mean "no filter" (the whole approved-used
// pool); the matcher does its own scoring downstream, so we pull everything and
// page through it. `selectedPage` is rewritten per request; everything else is
// constant. Extra facets can be merged in later without touching the plumbing.
const MOTORRAD_FILTER_BODY = {
  InitFilter: false, IsFirstCall: false, MarktId: '2', BuNo: '', Culture: 'en-gb',
  Segment: [], FuelType: [], Marke: 10, Modell: [], Fahrzeugart: 0, Antrieb: 0,
  EZV: 0, EZB: 0, PreisVon: '', PreisBis: '', KMVon: '', KMBis: '', KWVon: '', KWBis: '',
  PowerUnit: 'HP', Farbe1Auswahl: [], Merkmale: '', Umkreis: 1, UmkreisPLZ: '',
  AngebotsNo: '', DetailAngebotsNo: '', Sonderausstattung: '', isSondermodell: false,
  Pakete: '', FilterHMFAChanged: false, FilterEZChanged: 0, FilterColorChanged: false,
  ResOverviewData: {
    pagingSize: MOTORRAD_PAGE_SIZE, currResultCountToShow: MOTORRAD_PAGE_SIZE,
    selectedPage: 1, totalItemCount: 0, tableSortColumn: 16, tableSortDirection: 0,
    pageItemsToShow: 9,
  },
  DetailData: { RowNumber: 0 }, currRequest: 1,
};

/**
 * Dig the vehicle rows out of the SearchFilter envelope, as FLAT raw records
 * ready for mapMotorradRaw.
 *
 * The real feed (confirmed against a captured live response) does NOT return a
 * JSON array of vehicle objects — it returns `ResTable` as a server-rendered
 * HTML <table> string, one <tr> per bike, each with a real per-vehicle photo.
 * So we parse that HTML (motorrad-listing.js) rather than reading array fields.
 * `ResTable` may sit at the envelope root or under SearchFilter; accept either.
 *
 * For resilience we still accept a pre-parsed array (a future JSON feed, or a
 * capture already reduced to rows): if `ResTable` is an array we pass it through
 * motorradRowToRaw; if it's an HTML string we parse it. Anything else → empty
 * (a clean StockUnavailableError upstream) rather than a crash.
 */
export function motorradRowsFromEnvelope(env) {
  const sf = env?.SearchFilter ?? env;
  const table = env?.ResTable ?? sf?.ResTable ?? sf?.ResOverviewData?.ResTable;
  if (typeof table === 'string') return parseResTable(table); // the real shape
  const rows = table?.Items ?? table?.items ?? (Array.isArray(table) ? table : []);
  return Array.isArray(rows) ? rows.map(motorradRowToRaw) : [];
}

/**
 * Project one JSON result row into the flat shape mapMotorradRaw consumes.
 *
 * The live feed returns HTML rows (handled by parseResTable), not JSON objects,
 * so this is only reached if the feed ever grows a JSON array variant. It reads
 * a spread of plausible keys and leaves the canonical projection (category, cc,
 * licence band, blurb) to mapMotorradRaw — the same mapper the HTML rows and the
 * fixtures go through. A record already in flat shape (id/title/price/image)
 * passes straight through.
 */
export function motorradRowToRaw(row = {}) {
  // Already a flat parsed record? Pass it through untouched.
  if (row.title !== undefined && row.price !== undefined) return row;
  const firstImage = (v) => (Array.isArray(v) ? v.find(Boolean) : v) || undefined;
  return {
    id: row.Id ?? row.id ?? row.AngebotsNo ?? row.StockNumber ?? row.VehicleId,
    title: row.Title ?? row.Name ?? row.ModelName ?? row.Bezeichnung ?? row.Description,
    price: row.Price ?? row.Preis ?? row.CashPrice ?? row.PriceValue,
    mileage: row.Mileage ?? row.KM ?? row.Odometer ?? row.Miles,
    reg: row.Registration ?? row.Reg ?? row.NumberPlate,
    fuel: row.Fuel ?? row.FuelType ?? row.Antrieb,
    image: firstImage(row.ImageSrc ?? row.sliderImageLinks ?? row.ImageLinks
      ?? row.ThumbnailLinks ?? row.ImageUrl ?? row.Image ?? row.MainImage),
    link: row.DetailUrl ?? row.Url ?? row.Link,
  };
}

/**
 * Read the GMB-SID the server embeds in the results landing page.
 *
 * The page carries `<input id="hfSID" value="<base64>">`; that value IS the
 * session the feed wants as its GMB-SID header (base64 of "<caller-ip>;<guid>").
 * A cold GET of the landing page mints a fresh one bound to this caller, so no
 * browser or out-of-band capture is needed. Returns the raw base64 value, or
 * throws StockUnavailableError if the field is absent (page shape changed).
 */
export function parseMotorradSid(html) {
  return (String(html).match(/id="hfSID"[^>]*value="([^"]*)"/) || [])[1] || null;
}

async function mintMotorradSid(origin) {
  let res;
  try {
    res = await httpsGet(`${origin}${MOTORRAD_LANDING_PATH}`, { Accept: 'text/html' });
  } catch (cause) {
    throw new StockUnavailableError('Motorrad landing page fetch failed', { cause });
  }
  if (res.status !== 200) {
    throw new StockUnavailableError(`Motorrad landing page returned HTTP ${res.status}`);
  }
  const sid = parseMotorradSid(res.body);
  if (!sid) {
    throw new StockUnavailableError('Motorrad landing page had no #hfSID session field');
  }
  return sid;
}

/** The filter body with `selectedPage` set to n (deep-copied so the constant
 *  template is never mutated). */
function motorradBodyForPage(n) {
  return {
    ...MOTORRAD_FILTER_BODY,
    ResOverviewData: { ...MOTORRAD_FILTER_BODY.ResOverviewData, selectedPage: n },
  };
}

/** POST one page of the feed with the session header. Returns the parsed
 *  envelope, or throws StockUnavailableError (non-200, non-JSON, null envelope). */
async function motorradFetchPage(origin, sid, page) {
  const headers = {
    'GMB-SID': sid,
    Origin: origin,
    Referer: `${origin}${MOTORRAD_LANDING_PATH}`,
    Accept: 'application/json, text/plain, */*',
  };
  let res;
  try {
    res = await httpsPostJson(`${origin}${MOTORRAD_FEED_PATH}`, motorradBodyForPage(page), headers);
  } catch (cause) {
    throw new StockUnavailableError(`Motorrad feed request failed on page ${page}`, { cause });
  }
  if (res.status !== 200) {
    throw new StockUnavailableError(`Motorrad feed returned HTTP ${res.status} on page ${page}`);
  }
  let env;
  try {
    env = JSON.parse(res.body);
  } catch (cause) {
    throw new StockUnavailableError('Motorrad feed returned non-JSON', { cause });
  }
  // A null ResTable is the signature of a request with no live session.
  if (env?.ResTable == null) {
    throw new StockUnavailableError(
      `Motorrad feed returned a null envelope on page ${page} (session not accepted)`,
    );
  }
  return env;
}

/**
 * Fetch and map the WHOLE live Motorrad pool.
 *
 * Self-issues a session (mintMotorradSid, unless MOTORRAD_SESSION overrides),
 * then walks the paged feed until it runs dry. Each ResTable is parsed to flat
 * rows and de-duped by offer id, and the rows map through the shared
 * mapMotorradRaw — the identical projection the snapshot uses, so a live bike is
 * indistinguishable from a fixture one.
 *
 * Why walk-until-dry rather than trust a total: the feed does NOT compute
 * totalItemCount server-side — it echoes back whatever the request body sends (a
 * fresh request with totalItemCount:0 gets 0 back), so the count can't drive the
 * loop. Instead we fetch pages in concurrent batches and stop once a batch runs
 * dry — a page comes back short (fewer than a full page of rows) or adds no new
 * bikes (the feed clamps to the last page past the end) — bounded by
 * MOTORRAD_PAGE_LIMIT. Self-correcting: it reads the real number of pages without
 * hardcoding the inventory size, and the batching keeps cold latency low.
 *
 * Throws StockUnavailableError on any failure (no session, non-200, null
 * envelope, empty result) so it drops into the same degrade-to-fixtures path as
 * the BMW/MINI feed. A first-page failure is fatal (nothing to serve); a
 * later-page failure ends pagination with what we have, so a session that
 * expires mid-walk still yields a usable partial deck rather than nothing.
 */
async function motorradLiveStock(origin) {
  const sid = MOTORRAD_SESSION || (await mintMotorradSid(origin));

  const byId = new Map();
  let done = false;
  let firstError = null;

  // Fetch pages in concurrent batches. Within a batch the requests overlap; we
  // fold results in page order so the "short/dry page" stop is deterministic
  // regardless of which request settled first.
  for (let start = 1; start <= MOTORRAD_PAGE_LIMIT && !done; start += MOTORRAD_PAGE_BATCH) {
    const pageNums = [];
    for (let p = start; p < start + MOTORRAD_PAGE_BATCH && p <= MOTORRAD_PAGE_LIMIT; p += 1) {
      pageNums.push(p);
    }
    // eslint-disable-next-line no-await-in-loop
    const settled = await Promise.all(
      pageNums.map((p) =>
        motorradFetchPage(origin, sid, p).then(
          (env) => ({ p, rows: parseResTable(env.ResTable) }),
          (err) => ({ p, err }),
        )),
    );
    for (const { p, rows, err } of settled) {
      if (err) {
        // A first-page failure is fatal; a later-page failure ends the walk with
        // what we have. Record it and stop folding further pages.
        if (p === 1) firstError = err;
        // eslint-disable-next-line no-console
        else console.warn(`[motorrad] page ${p} failed, stopping with ${byId.size} rows: ${err?.message}`);
        done = true;
        break;
      }
      let added = 0;
      for (const row of rows) {
        if (row?.id && !byId.has(row.id)) { byId.set(row.id, row); added += 1; }
      }
      if (rows.length < MOTORRAD_PAGE_SIZE || added === 0) { done = true; break; }
    }
  }

  if (firstError) throw firstError;

  const bikes = [...byId.values()].map(mapMotorradRaw).filter(Boolean);
  if (bikes.length === 0) {
    throw new StockUnavailableError('Motorrad feed returned no usable bikes');
  }
  return bikes;
}

/* ------------------------------ public API ---------------------------- */

/**
 * Fetch a retailer's full stock for a brand, mapped to the engine's car schema.
 * For `source: 'feed'` brands (BMW, MINI) this is the live Auto Trader platform,
 * cached per brand+retailer for STOCK_TTL_MS. For `source: 'fixtures'` brands it
 * reads the committed snapshot (no network). Throws StockUnavailableError if the
 * chosen source can't be reached.
 *
 * @param {string} [brand] brand key (defaults to bmw)
 * @param {string} [retailerSite] retailer_site ID; defaults to the brand's default
 * @param {string} [scope] 'dealer' (default) or 'national' — see normalizeScope
 * @returns {Promise<Array>} mapped car objects (mapping.js shape)
 */
export async function fetchRetailerStock(brand = 'bmw', retailerSite, scope) {
  const b = normalizeBrand(brand);
  const { origin, defaultRetailer, source } = brandConfig(b);
  const site = retailerSite || defaultRetailer;
  const sc = normalizeScope(scope);

  // Fixtures-backed brands never touch the network or the TTL cache — the
  // snapshot is static for the run and the cars are already mapped.
  if (source === 'fixtures') return fixturesRetailerStock(b, site);

  // Honda's live feed, when the registry opts into it. The listing is
  // server-rendered HTML (not JSON), so it has its own adapter; it's cached like
  // the BMW/MINI feed. A fetch failure throws StockUnavailableError, which the
  // API turns into a clean 502 — the live feed is the single source of truth, so
  // we surface its outage rather than paper over it with stale stock. Honda
  // filters by location (postcode + radius), not dealer id — fetchNearbyStock
  // handles the "near you" narrowing; here we pull the pool.
  if (source === 'live-honda') {
    const key = keyFor(b, site);
    seenRetailers.set(key, { brand: b, retailerSite: site });
    return cachedFetch(cacheByRetailer, key, () => hondaLiveStock());
  }

  // Motorrad's live feed, when the registry opts into it. Cached per
  // brand+retailer exactly like the BMW/MINI feed; on any failure it throws
  // StockUnavailableError (→ 502 at the API) rather than serving a stale
  // snapshot. Same source-of-truth rule as Honda and BMW/MINI: one live feed,
  // no silent fallback.
  if (source === 'live-motorrad') {
    const key = keyFor(b, site);
    seenRetailers.set(key, { brand: b, retailerSite: site });
    return cachedFetch(cacheByRetailer, key, () => motorradLiveStock(origin));
  }

  // Ferrari's live feed, when the registry opts into it. The listing is
  // server-rendered JSON (public __NEXT_DATA__, no token), so it has its own
  // cold-walk adapter; cached per brand+retailer exactly like the other live
  // brands. A fetch failure throws StockUnavailableError (→ 502), no silent
  // fallback. Ferrari ships `source: 'fixtures'` today (photos are gallery-gated,
  // see ferrariLiveStock); this case is live the day that flips.
  if (source === 'live-ferrari') {
    const key = keyFor(b, site);
    seenRetailers.set(key, { brand: b, retailerSite: site });
    return cachedFetch(cacheByRetailer, key, () => ferrariLiveStock());
  }

  // RRMC live feed (MTK Connect public JSON API, no auth required).
  if (source === 'live-rrmc') {
    const key = keyFor(b, site);
    seenRetailers.set(key, { brand: b, retailerSite: site });
    return cachedFetch(cacheByRetailer, key, () => rrmcLiveStock());
  }

  /*
   * BMW/MINI are the only brands with two genuinely different pools, so they're
   * the only ones `scope` changes:
   *
   *   dealer   → `site`'s own forecourt (~100 cars, one page). The original
   *              behaviour, and the default: a tool authored onto one
   *              retailer's page must not silently answer for the whole country.
   *   national → every retailer of the brand (~12k BMW / ~3.5k MINI),
   *              stale-while-revalidate because the walk costs ~60s.
   *
   * The two cache under different keys ("bmw:96" vs "bmw:national"), so both
   * stay hot at once and neither clobbers the other. `site` matters to the
   * nearby carousel either way (resolveRetailerPostcode anchors distances to it).
   */
  if (sc === 'national') return nationalStock(b, origin);

  const key = keyFor(b, site);
  seenRetailers.set(key, { brand: b, retailerSite: site });
  seenDealerPools.set(key, { brand: b, retailerSite: site });
  return cachedFetch(cacheByRetailer, key, () => walkRetailerFeed(origin, b, site));
}

/** One retailer's own forecourt → mapped cars. A single dealer is ~100 cars, so
 * this is 1–2 pages and cheap enough to sit on the request path (unlike the
 * national walk). Paginates for the rare large dealer; same politeness delay. */
async function walkRetailerFeed(origin, brand, retailerSite) {
  const query = byRetailerQuery(retailerSite);
  let vehicles;
  try {
    const first = await fetchPageWithRetry(origin, query, 1);
    vehicles = [...(first.results || [])];
    const totalPages = Math.min(first.pagination?.total || 1, RETAILER_PAGE_LIMIT);
    for (let page = 2; page <= totalPages; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(NATIONAL_PAGE_DELAY_MS);
      // eslint-disable-next-line no-await-in-loop
      const next = await fetchPageWithRetry(origin, query, page);
      vehicles.push(...(next.results || []));
    }
  } catch (err) {
    if (err instanceof StockUnavailableError) throw err;
    throw new StockUnavailableError('Live stock fetch failed', { cause: err });
  }

  const cars = vehicles.map((v) => mapVehicle(v, brand)).filter(Boolean);
  if (cars.length === 0) {
    // Names the site, because by far the likeliest cause is a retailer_site ID
    // that doesn't exist — a misconfigured embed, not an outage. The API turns
    // this into a 502 whose message says which ID drew a blank.
    throw new StockUnavailableError(`Live feed returned no usable vehicles for retailer_site=${retailerSite}`);
  }
  return cars;
}

/** One full walk of a brand's national feed → mapped cars. ~60s, throttle-bound
 * (see NATIONAL_PAGE_DELAY_MS); callers should keep it off the request path. */
async function walkNationalFeed(origin, brand) {
  const query = byNationalQuery();
  let vehicles;
  try {
    const first = await fetchPageWithRetry(origin, query, 1);
    vehicles = [...(first.results || [])];
    const totalPages = Math.min(first.pagination?.total || 1, NATIONAL_PAGE_LIMIT);
    for (let page = 2; page <= totalPages; page += 1) {
      // Be polite — the feed throttles a fast burst, and a ~120-page walk is
      // exactly that burst without this (see NATIONAL_PAGE_DELAY_MS).
      // eslint-disable-next-line no-await-in-loop
      await sleep(NATIONAL_PAGE_DELAY_MS);
      // eslint-disable-next-line no-await-in-loop
      const next = await fetchPageWithRetry(origin, query, page);
      vehicles.push(...(next.results || []));
    }
  } catch (err) {
    if (err instanceof StockUnavailableError) throw err;
    throw new StockUnavailableError('Live stock fetch failed', { cause: err });
  }

  const cars = vehicles.map((v) => mapVehicle(v, brand)).filter(Boolean);
  if (cars.length === 0) {
    throw new StockUnavailableError('Live feed returned no usable vehicles');
  }
  return cars;
}

// How long to leave a brand's national feed alone after a failed walk. Without
// this, a persistently broken feed gets re-walked by every request that lands
// while the pool is stale — 120 requests at an upstream we now know throttles.
const NATIONAL_FAIL_COOLDOWN_MS = Number(process.env.NATIONAL_FAIL_COOLDOWN_MS) || 60 * 1000;

/** Start (or join) a national refresh, persisting the result. Single-flight, so
 * a warmer tick that overlaps a request shares the one walk. */
function refreshNational(brand, origin, key) {
  const entry = cacheByRetailer.get(key);
  if (entry?.inflight) return entry.inflight;

  const inflight = walkNationalFeed(origin, brand).then(
    (cars) => {
      cacheByRetailer.set(key, { at: Date.now(), cars });
      writeNationalIndex(brand, cars);
      return cars;
    },
    (err) => {
      // Drop only the in-flight marker; any stale cars keep serving.
      const prev = cacheByRetailer.get(key);
      if (prev) {
        delete prev.inflight;
        prev.failedAt = Date.now();
      }
      throw err;
    },
  );
  cacheByRetailer.set(key, { ...(entry || {}), inflight });
  return inflight;
}

/**
 * A feed brand's national pool, stale-while-revalidate.
 *
 * The walk costs ~60s and the upstream throttle makes that irreducible, so the
 * only way national stock is viable is to never make a user wait for it:
 *
 *   fresh in memory      → serve it
 *   stale in memory/disk → serve it NOW, refresh behind the response
 *   nothing at all       → no choice but to walk (first run on a clean machine)
 *
 * Deliberately serves stale stock rather than blocking or erroring: a pool
 * that's an hour old still ranks essentially the same cars, and a sold car is
 * a far smaller problem than a 60-second wait or a 502. Freshness is the
 * warmer's job, not the request's.
 */
function nationalStock(brand, origin) {
  const key = keyFor(brand, 'national');
  seenNationalBrands.add(brand);

  const cached = cacheByRetailer.get(key);
  if (fresh(cached)) return Promise.resolve(cached.cars);

  // Nothing in memory: try the previous process's index before the network, so
  // a restart doesn't re-pay the walk.
  if (!cached?.cars) {
    const snap = readNationalIndex(brand);
    if (snap) cacheByRetailer.set(key, { ...(cached || {}), at: snap.at, cars: snap.cars });
  }

  const have = cacheByRetailer.get(key);
  if (have?.cars) {
    // Back off after a failure rather than re-walking a throttled feed on every
    // request — we have cars to serve, so there's no urgency.
    const cooling = have.failedAt && Date.now() - have.failedAt < NATIONAL_FAIL_COOLDOWN_MS;
    if (!cooling) {
      // Detach: a failed background refresh must not reject the response we've
      // already served, nor surface as an unhandled rejection. The warmer retries.
      refreshNational(brand, origin, key).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(`[stock] ${brand} national refresh failed (serving stale):`, err?.message);
      });
    }
    return Promise.resolve(have.cars);
  }
  // Nothing to serve — the caller has to wait for the walk (first run only).
  return refreshNational(brand, origin, key);
}

/* ------------------------- nearby-retailer stock ---------------------- */

// "brand:retailerSite" -> postcode. No TTL: a retailer's address doesn't move.
// The dealer directory is a combined BMW+MINI feed, so the dealer_number join
// works identically for both brands.
const postcodeByRetailer = new Map();

/**
 * The configured retailer's own postcode — the anchor every distance is
 * measured from.
 *
 * The used-car feed never states a retailer's location, but it does give us
 * `retailer_site.dealer_number`, and the (combined BMW+MINI) dealer directory
 * is keyed on exactly that (see dealers.js). One hop bridges the two:
 *
 *   retailer_site=96 → dealer_number 11107 → directory → "PH1 3GA"  (BMW)
 *   retailer_site=92 → dealer_number 15127 → directory → "LU4 8QN"  (MINI)
 *
 * @returns {Promise<string>} e.g. "PH1 3GA"
 */
async function resolveRetailerPostcode(origin, brand, retailerSite) {
  const key = keyFor(brand, retailerSite);
  const cached = postcodeByRetailer.get(key);
  if (cached) return cached;

  const first = await fetchPageWithRetry(origin, byRetailerQuery(retailerSite), 1);
  const dealerNumber = (first.results || [])
    .map((v) => v?.retailer_site?.dealer_number)
    .find(Boolean);
  if (!dealerNumber) {
    throw new StockUnavailableError(`Retailer ${retailerSite} reports no dealer_number`);
  }

  const dealer = await lookupDealer(dealerNumber);
  if (!dealer?.postcode) {
    throw new StockUnavailableError(`Dealer ${dealerNumber} is not in the directory`);
  }

  postcodeByRetailer.set(key, dealer.postcode);
  return dealer.postcode;
}

/**
 * Stock at *other* retailers near the configured one, nearest first, each car
 * carrying a real `distance` in miles.
 *
 * The anchor retailer's own cars are dropped: the hero matches are already its
 * stock, so the carousel exists to answer a different question ("what's worth
 * a short drive?"). That also keeps every distance non-zero and honest.
 *
 * Callers should treat a throw as "no carousel", not "no results" — the hero
 * matches don't depend on this.
 *
 * @param {string} [brand] 'bmw' | 'mini' (defaults to bmw)
 * @param {string} [retailerSite] retailer_site ID; defaults to the brand's default
 * @returns {Promise<Array>} mapped car objects, nearest first
 */
export async function fetchNearbyStock(brand = 'bmw', retailerSite) {
  const b = normalizeBrand(brand);
  const { origin, defaultRetailer, source } = brandConfig(b);
  const site = retailerSite || defaultRetailer;

  // Fixtures-backed brands have no distance API and no per-car geo, so there is
  // no honest "near you" pool to build. Return empty: callers treat a throw or
  // empty as "no carousel", and the hero matches never depend on it. (When a
  // real feed is wired and the brand flips to 'feed', this lights up for free.)
  // Motorrad's live feed is a single national pool with no distance facet, so it
  // has no honest "near you" either — same empty result.
  // Honda's live feed CAN filter by location (postcode + radius), but its cards
  // carry no per-car distance and no distinct dealer identity, so it can't build
  // the distance-ranked, other-dealers carousel this returns. The location filter
  // belongs on the main pool fetch instead (hondaLiveStock opts), not here.
  if (source === 'fixtures' || source === 'live-motorrad' || source === 'live-honda' || source === 'live-rrmc') return [];

  const key = keyFor(b, site);
  seenRetailers.set(key, { brand: b, retailerSite: site });
  return cachedFetch(cacheNearby, key, async () => {
    let vehicles;
    try {
      const postcode = await resolveRetailerPostcode(origin, b, site);
      const query = byDistanceQuery(postcode);
      const first = await fetchPageWithRetry(origin, query, 1);
      vehicles = [...(first.results || [])];
      const totalPages = Math.min(first.pagination?.total || 1, NEARBY_PAGES);
      for (let page = 2; page <= totalPages; page += 1) {
        const next = await fetchPageWithRetry(origin, query, page);
        vehicles.push(...(next.results || []));
      }
    } catch (err) {
      if (err instanceof StockUnavailableError) throw err;
      throw new StockUnavailableError('Nearby stock fetch failed', { cause: err });
    }

    // String vs number: the feed's retailer_site.id is a number, the authored
    // config row is a string. Compare as strings so the anchor is really dropped.
    const anchor = String(site);
    const cars = vehicles
      .map((v) => mapVehicle(v, b))
      .filter(Boolean)
      .filter((car) => String(car.retailerId) !== anchor);

    // An empty pool means the search came back with nothing but the anchor's
    // own cars — implausible for 400 nearest vehicles, so treat it as a broken
    // feed rather than caching "no neighbours" for the whole TTL.
    if (cars.length === 0) {
      throw new StockUnavailableError('Nearby search returned no cars from other retailers');
    }

    return cars;
  });
}

/* --------------------------- background warmer ------------------------ */

// How often the warmer wakes. Default is 80% of the TTL, so an entry is
// refreshed before it expires and a user request never lands on a cold cache.
// (A ~15s cold nearby fetch inside a 5-min TTL leaves ample headroom.)
const WARM_INTERVAL_MS = Number(process.env.STOCK_WARM_INTERVAL_MS)
  || Math.round(STOCK_TTL_MS * 0.8);

/**
 * Refresh one pool for one retailer if its cached entry is missing or within a
 * warm-interval of expiring — proactively, off the request path. Reuses the
 * public fetchers, so single-flight de-dup means a warm that overlaps a user
 * request shares the same fetch. Errors are swallowed: the existing (stale)
 * entry keeps serving and the next tick retries.
 */
function warmOne(cache, key, brand, retailerSite, fetcher) {
  const entry = cache.get(key);
  // Skip if a fetch is already running, or the entry is comfortably fresh
  // (more than one warm-interval of life left) — nothing to do yet.
  if (entry?.inflight) return Promise.resolve();
  const ageOk = entry?.cars
    && Date.now() - entry.at < STOCK_TTL_MS - WARM_INTERVAL_MS;
  if (ageOk) return Promise.resolve();
  // Expire the entry so the fetcher's freshness check falls through and
  // actually re-fetches (rather than returning the about-to-expire cars).
  if (entry) entry.at = 0;
  return fetcher(brand, retailerSite).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn(`[warmer] ${key} refresh failed:`, err?.message);
  });
}

let warmTimer = null;

/**
 * Start the background cache warmer. For every retailer we've served, it keeps
 * both stock pools hot so the slow cold fetch (chiefly the nearby distance
 * search) is paid off the request path instead of by a user. Idempotent; the
 * timer is unref'd so it never keeps the process alive on its own. Call once
 * from server boot — NOT on import, so tests and tooling don't fire network.
 *
 * @returns {() => void} a stop function (clears the interval)
 */
export function startStockWarmer() {
  if (warmTimer) return () => stopStockWarmer();

  const tick = () => {
    for (const [key, { brand, retailerSite }] of seenRetailers) {
      // A feed brand's main pool is scope-dependent, so it's warmed from the two
      // loops below (whichever scopes have actually been asked for) rather than
      // from here — warming it under this per-retailer key would otherwise
      // re-fetch the wrong pool, once per distinct retailer ever seen. The
      // nearby carousel is per-retailer for every brand, so that half always
      // applies.
      if (brandConfig(brand).source !== 'feed') {
        warmOne(cacheByRetailer, key, brand, retailerSite, fetchRetailerStock);
      }
      warmOne(cacheNearby, key, brand, retailerSite, fetchNearbyStock);
    }
    for (const [key, { brand, retailerSite }] of seenDealerPools) {
      warmOne(cacheByRetailer, key, brand, retailerSite, (b, s) => fetchRetailerStock(b, s, 'dealer'));
    }
    for (const brand of seenNationalBrands) {
      warmOne(cacheByRetailer, keyFor(brand, 'national'), brand, undefined,
        (b) => fetchRetailerStock(b, undefined, 'national'));
    }
  };

  warmTimer = setInterval(tick, WARM_INTERVAL_MS);
  warmTimer.unref?.();
  return () => stopStockWarmer();
}

/** Stop the warmer (used by the stop function; handy for tests). */
export function stopStockWarmer() {
  if (warmTimer) {
    clearInterval(warmTimer);
    warmTimer = null;
  }
}

/* --------------------------- vehicle colour --------------------------- *
 * Paint colour is the one thing buyers reach for first ("I want the blue
 * one") and the ONLY place the platform serves it is the vehicle detail
 * page — the list endpoint every other field comes from doesn't carry it
 * (verified against a live list response and the national dumps). There is
 * no detail JSON endpoint either; the PDP server-renders the whole vehicle
 * into an inline `UVL.AD = {…}` variable, which is why the network tab shows
 * no request to blame.
 *
 * So colour costs one page fetch per car, which rules it out for a whole
 * retailer's stock and rules it IN for the handful we actually show. Two
 * things make that cheap: it's only ever asked for the cars on screen, and a
 * given advert's paint never changes — so the cache has no TTL. A car fetched
 * once is coloured for the life of the process.
 *
 * Every failure here is silent by design. Colour is a bonus fact like
 * distance or a photo: a card without it is fine, a results page that 502s
 * because a PDP hiccuped is not.
 * ---------------------------------------------------------------------- */

// advert_id -> { colour, finish, manufacturerColour } | null (null = asked and
// couldn't tell, so we don't ask again). No TTL: paint is immutable per advert.
const colourByAdvert = new Map();
const colourInflight = new Map(); // advert_id -> Promise, single-flight

/*
 * A third state, between "known" and "never asked": the fetch itself failed —
 * a timeout, a reset, a 502 — so we learned nothing about this car's paint.
 *
 * It matters because the two failures need opposite treatment. A 200 whose blob
 * carries no colour is a fact: that advert has no paint on record and asking
 * again is waste, so it caches as `null` forever. A transport error is not a
 * fact about the car, and caching it as `null` would let one dropped connection
 * exclude a car from the colour filter permanently — the silent-exclusion rule
 * turns a blip into an invisible, undiagnosable gap in the pool.
 *
 * So a failure caches this sentinel instead. The request path treats it exactly
 * like `null` (don't re-fetch while a user waits), but the warm pass clears it
 * and tries again on its next sweep, where a second attempt costs nothing.
 */
const COLOUR_SOFT_MISS = Symbol('colour-soft-miss');

// How many PDPs to fetch at once. Deliberately small — this runs while a user
// waits, against a site we're a guest on.
const COLOUR_CONCURRENCY = 4;

// Total wall-clock a single request will spend colouring before giving up on
// the stragglers. Raised from 2.5s once grouped cards started naming their
// listings by colour: running out mid-queue left a picker offering "Colour
// n/a". The cache is permanent, so this cost is paid once per car, ever. Generous enough for a cold cluster on a warm connection,
// short enough that the hero never feels stalled behind it.
const COLOUR_BUDGET_MS = Number(process.env.COLOUR_BUDGET_MS) || 4500;

/**
 * Pull the vehicle object out of a PDP's inline `UVL.AD = {…}` and return its
 * colour. Brace-balanced rather than regex-matched: the blob is a full vehicle
 * with nested objects and escaped quotes, and a lazy regex would truncate it.
 */
function colourFromPdp(html) {
  const marker = html.indexOf('UVL.AD = {');
  if (marker < 0) return null;
  const start = html.indexOf('{', marker);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const c = html[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === '"') inString = !inString;
    if (inString) continue;
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth !== 0) continue;
      try {
        const { colour } = JSON.parse(html.slice(start, i + 1));
        if (!colour?.colour) return null;
        return {
          // Normalised basic colour ("Grey") — what a preference matches on.
          colour: colour.colour,
          // "Metallic" / "Non-Metallic".
          finish: colour.finish || undefined,
          // The marketing name ("Brooklyn Grey") — what a card should say.
          manufacturerColour: colour.manufacturer_colour || undefined,
        };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** One advert's colour, cached forever, single-flighted, never throwing.
 *  A fetch that failed rather than answered caches COLOUR_SOFT_MISS, which
 *  reads as "no colour" here but stays retryable for the warm pass. */
function fetchColour(origin, advertId) {
  const id = String(advertId);
  if (colourByAdvert.has(id)) {
    const hit = colourByAdvert.get(id);
    return Promise.resolve(hit === COLOUR_SOFT_MISS ? null : hit);
  }
  if (colourInflight.has(id)) return colourInflight.get(id);

  const p = httpsGet(`${origin}/vehicle/${encodeURIComponent(id)}`, { Accept: 'text/html' })
    // A 200 that parses to nothing is a real answer (no paint on record); any
    // other status is a failure to ask, not an answer — see COLOUR_SOFT_MISS.
    .then((res) => (res.status === 200 ? colourFromPdp(res.body) : COLOUR_SOFT_MISS))
    .catch(() => COLOUR_SOFT_MISS)
    .then((colour) => {
      colourByAdvert.set(id, colour);
      colourInflight.delete(id);
      return colour === COLOUR_SOFT_MISS ? null : colour;
    });
  colourInflight.set(id, p);
  return p;
}

/**
 * Add `colour` to each car that has one, in place of nothing.
 *
 * Call this with the cars about to be SHOWN (the match cluster), never with a
 * whole pool — it's one page fetch per uncached car. Returns the same array
 * either way; a car whose colour couldn't be read simply doesn't gain the
 * field, exactly like a car with no photo.
 *
 * @param {string} brand 'bmw' | 'mini'
 * @param {Array} cars mapped car objects to enrich in place
 */
export async function enrichColours(brand, cars, budgetMs = COLOUR_BUDGET_MS) {
  const { origin, source } = brandConfig(normalizeBrand(brand));
  // Colour comes from the live platform's PDPs. A fixtures-backed brand has no
  // such PDPs to scrape (its links point at the real brand site, not this
  // origin), so any paint it shows must already be baked into the snapshot.
  // Skip the network entirely rather than fetching against the wrong origin.
  // Motorrad's live feed uses the UVL PDP shape too, so its rows carry any paint
  // inline already; there's no separate colour PDP to fetch on this origin.
  // Honda's live listing already carries an "Exterior colour" spec per card, so
  // its cars gain colour at map time — there's no colour PDP to fetch here either.
  if (source === 'fixtures' || source === 'live-motorrad' || source === 'live-honda' || source === 'live-rrmc') return cars;
  const queue = cars.filter((c) => c?.id);
  const deadline = Date.now() + budgetMs;
  for (let i = 0; i < queue.length; i += COLOUR_CONCURRENCY) {
    // A results page must not wait on a slow PDP. Once the budget is spent we
    // stop starting batches: the cars already coloured keep theirs, the rest
    // render without — and because the cache is permanent, the next request
    // for the same cars is instant and complete.
    if (Date.now() > deadline) break;
    const slice = queue.slice(i, i + COLOUR_CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    const colours = await Promise.all(slice.map((c) => fetchColour(origin, c.id)));
    slice.forEach((car, n) => {
      if (colours[n]) car.colour = colours[n];
    });
  }
  return cars;
}

/* --------------------- persisted colour, and the warm pass ------------- *
 * enrichColours above is the request-path story: colour the handful of cars
 * about to be shown, inside a 4.5s budget. That is right for a ranked page
 * showing five cars and useless for the Guess Who mode, which offers colour as
 * a HARD FILTER over the whole national pool — a filter that only knows the
 * paint of cars someone happened to look at is a filter that hides stock.
 *
 * So colour gets acquired up front instead, for every car in the pool, by a
 * background pass slow enough to be a good guest. Two properties make that
 * affordable where it would otherwise be absurd:
 *
 *   - Paint is immutable per advert. A car coloured once is coloured forever,
 *     so the expensive pass runs ONCE and every later sweep is a small delta of
 *     adverts that appeared since — minutes, not hours.
 *   - The cost is per advert, not per pool. Keying the store by advert id means
 *     a car that moves between dealers, or drops out of the feed and returns,
 *     is already known.
 *
 * Deliberately slow: COLOUR_WARM_DELAY_MS is one request per second, serial,
 * no concurrency. That is ~4h20m for the first full BMW+MINI pass (12,012 +
 * 3,537 adverts) and roughly 40× under the burst rate that first drew a 429
 * from this platform. The slowness is the feature — the alternative is looking
 * like a scraper to someone else's infrastructure. Do not "optimise" it.
 *
 * Cars whose colour is still unknown are simply excluded from the colour filter
 * while it is in use, and nothing in the UI says "still cataloguing": a caveat
 * would cost more user confidence than the missing cars cost.
 * ---------------------------------------------------------------------- */

const colourSidecarPath = (brand) => join(NATIONAL_INDEX_DIR, `colours-${brand}.json`);

/*
 * Colour lives in its own file rather than inside the national index, because
 * the two have completely different lifetimes. The index is rewritten wholesale
 * by every feed walk (see refreshNational); colour takes hours to gather. Baked
 * into the index it would be destroyed by the next refresh, so the warm pass
 * could never get ahead of the walker. Keyed separately by advert id, it simply
 * survives.
 */

/** Load a brand's persisted colours into the in-memory map. Never throws — a
 *  missing or corrupt sidecar just means the warm pass has more to do. Returns
 *  how many entries were adopted. */
function readColourSidecar(brand) {
  try {
    const snap = JSON.parse(readFileSync(colourSidecarPath(brand), 'utf8'));
    const entries = Object.entries(snap?.byAdvert || {});
    let n = 0;
    for (const [id, colour] of entries) {
      // Don't clobber anything already learned this process, and don't re-adopt
      // soft misses — they serialise as `false` precisely so a restart retries
      // them rather than inheriting a stale failure.
      if (colourByAdvert.has(id)) continue;
      if (colour === false) continue;
      colourByAdvert.set(id, colour);
      n += 1;
    }
    return n;
  } catch {
    return 0;
  }
}

/**
 * Persist what we know about one brand's colours.
 *
 * Written from the brand's CURRENT pool rather than from the whole in-memory
 * map, which both scopes the file to one brand (the map is shared, keyed by
 * advert id alone) and prunes it: adverts that have left the feed stop being
 * written, so the sidecar stays proportional to the stock instead of growing
 * forever. Temp-file-and-rename, like the index, so a crash can't leave a
 * half-written file for the next boot to adopt.
 */
function writeColourSidecar(brand, cars) {
  const byAdvert = {};
  for (const car of cars) {
    if (!car?.id) continue;
    const id = String(car.id);
    if (!colourByAdvert.has(id)) continue;
    const hit = colourByAdvert.get(id);
    // `false` marks a soft miss: recorded so the file is a complete picture of
    // what was attempted, but read back as "ask again" (see readColourSidecar).
    byAdvert[id] = hit === COLOUR_SOFT_MISS ? false : hit;
  }
  const path = colourSidecarPath(brand);
  const tmp = `${path}.tmp`;
  try {
    mkdirSync(NATIONAL_INDEX_DIR, { recursive: true });
    writeFileSync(tmp, JSON.stringify({ at: Date.now(), brand, byAdvert }));
    renameSync(tmp, path);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[colour] could not persist ${brand} colours:`, err?.message);
  }
}

// One request per second, serial. See the block comment above before changing.
const COLOUR_WARM_DELAY_MS = Number(process.env.COLOUR_WARM_DELAY_MS) || 1000;

// Flush the sidecar every N fetches. Small enough that a restart loses seconds
// of work rather than hours; large enough not to rewrite a 12k-entry file every
// second. At 1 req/s this is a write every ~3 minutes.
const COLOUR_FLUSH_EVERY = Number(process.env.COLOUR_FLUSH_EVERY) || 200;

// How long to wait before sweeping a brand again once it's fully coloured.
// Nothing to do but pick up adverts new since the last pass, so this is a
// delta-sized job — cheap, and hourly is ample for used-car stock.
const COLOUR_SWEEP_IDLE_MS = Number(process.env.COLOUR_SWEEP_IDLE_MS) || 60 * 60 * 1000;

let colourWarmRunning = false;
let colourWarmStop = false;

/** Adverts in this pool we still have no definitive answer for, soft misses
 *  included (a soft miss is a failure to ask, so the warmer re-asks). */
function uncolouredIn(cars) {
  return cars.filter((c) => {
    if (!c?.id) return false;
    const id = String(c.id);
    return !colourByAdvert.has(id) || colourByAdvert.get(id) === COLOUR_SOFT_MISS;
  });
}

/** Progress for one brand: how much of its pool has a known colour. */
export function colourCoverage(brand) {
  const b = normalizeBrand(brand);
  const cars = cacheByRetailer.get(keyFor(b, 'national'))?.cars || [];
  let known = 0;
  for (const car of cars) {
    const hit = car?.id != null ? colourByAdvert.get(String(car.id)) : undefined;
    if (hit && hit !== COLOUR_SOFT_MISS) known += 1;
  }
  return { total: cars.length, known, pending: uncolouredIn(cars).length };
}

/**
 * One pass over a brand's pool, colouring what isn't known yet.
 *
 * Returns when the pool is exhausted or the warmer is stopped. Every failure is
 * swallowed: this is a background nicety and must never take the process down.
 */
async function colourSweep(brand) {
  const { origin, source } = brandConfig(brand);
  // Same exclusions enrichColours makes: these brands have no PDP on this
  // origin to read paint from (fixtures point at the real brand site; Motorrad
  // and Honda already carry colour by the time they're mapped).
  if (source === 'fixtures' || source === 'live-motorrad' || source === 'live-honda' || source === 'live-rrmc') return;

  const cars = cacheByRetailer.get(keyFor(brand, 'national'))?.cars;
  if (!cars?.length) return; // pool not walked yet — try again next tick

  const todo = uncolouredIn(cars);
  if (!todo.length) return;

  // eslint-disable-next-line no-console
  console.log(`[colour] ${brand}: ${todo.length} of ${cars.length} adverts need colour`
    + ` (~${Math.round((todo.length * COLOUR_WARM_DELAY_MS) / 60000)} min at ${COLOUR_WARM_DELAY_MS}ms each)`);

  let done = 0;
  for (const car of todo) {
    if (colourWarmStop) break;
    const id = String(car.id);
    // Clear a previous soft miss so fetchColour actually re-asks rather than
    // returning the cached failure.
    if (colourByAdvert.get(id) === COLOUR_SOFT_MISS) colourByAdvert.delete(id);
    // eslint-disable-next-line no-await-in-loop
    const colour = await fetchColour(origin, id);
    // Paint the in-memory car too, so the pool being served gains colour as the
    // pass proceeds rather than only after the next feed walk.
    if (colour) car.colour = colour;
    done += 1;
    if (done % COLOUR_FLUSH_EVERY === 0) {
      writeColourSidecar(brand, cars);
      // eslint-disable-next-line no-console
      console.log(`[colour] ${brand}: ${done}/${todo.length} fetched`);
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(COLOUR_WARM_DELAY_MS);
  }
  writeColourSidecar(brand, cars);
  const { known, total } = colourCoverage(brand);
  // eslint-disable-next-line no-console
  console.log(`[colour] ${brand}: pass complete — ${known}/${total} coloured`);
}

/**
 * Start the background colour warm pass.
 *
 * Loads whatever previous runs persisted, then sweeps each feed brand in turn,
 * forever, sleeping COLOUR_SWEEP_IDLE_MS between complete rounds. Serial across
 * brands as well as within them, so the one-request-per-second budget is the
 * whole process's, not per brand.
 *
 * Idempotent. Call once from server boot — NOT on import, so tests and tooling
 * never fire thousands of requests at someone else's site.
 *
 * @returns {() => void} a stop function
 */
export function startColourWarmer() {
  if (colourWarmRunning) return () => stopColourWarmer();
  colourWarmRunning = true;
  colourWarmStop = false;

  const brands = ['bmw', 'mini'];
  for (const brand of brands) {
    const n = readColourSidecar(brand);
    if (n) {
      // eslint-disable-next-line no-console
      console.log(`[colour] ${brand}: adopted ${n} known colours from disk`);
    }
  }

  (async () => {
    while (!colourWarmStop) {
      for (const brand of brands) {
        if (colourWarmStop) break;
        try {
          // eslint-disable-next-line no-await-in-loop
          await colourSweep(brand);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[colour] ${brand} sweep failed:`, err?.message);
        }
      }
      if (colourWarmStop) break;
      // eslint-disable-next-line no-await-in-loop
      await sleep(COLOUR_SWEEP_IDLE_MS);
    }
    colourWarmRunning = false;
  })();

  return () => stopColourWarmer();
}

/** Stop the colour warmer after the in-flight fetch settles. */
export function stopColourWarmer() {
  colourWarmStop = true;
}
