/*
 * Test harness for the HTTP API layer (api.test.js).
 *
 * The engine's pure functions are covered by engine.test.js / brand.test.js.
 * This layer is about the *server*: routing, validation, response shape and
 * the size/enrich controls the game modes depend on. To test those without a
 * live feed we drive real HTTP against a `buildServer({...fakeStock})` instance
 * bound to port 0 (an ephemeral port — no collisions, no PORT), injecting an
 * in-memory stock source. Node 26's `mock.module` is unavailable and the
 * handlers bind the stock functions via a direct ESM import, so a real
 * injection seam (not monkeypatching) is the only way to keep tests hermetic.
 *
 * Fixtures are built the same way brand.test.js builds them: feed-shaped
 * objects run through the real `mapVehicle`, so the cars the fake feed serves
 * are engine-ready and indistinguishable from live stock — the tests exercise
 * the true code path, only the network is faked.
 */

import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildServer } from '../index.js';
import { mapVehicle } from '../mapping.js';

/*
 * The two location deps, stubbed out by default rather than left to buildServer's
 * real ones.
 *
 * Both call a third party: fetchDealerDirectory pulls a ~2MB directory and
 * geocodePostcode hits postcodes.io. /api/pool asks for the directory on every
 * request, so a suite that didn't stub this would quietly make a live 2MB fetch
 * per pool test — hermetic in its assertions, but not in its behaviour, and
 * failing on a plane. An empty Map is a real answer, not an error: the pool ships
 * null site coordinates and the client's distance filter self-suppresses, which
 * is exactly the state of a brand whose stock cache predates dealer_number.
 *
 * A test that wants to exercise either one passes its own, as with any other dep.
 */
const INERT_LOCATION = {
  fetchDealerDirectory: async () => new Map(),
  geocodePostcode: async () => null,
};

/**
 * Spin up a server with injected stock on an ephemeral port. Returns the base
 * URL and a close() that resolves when the socket is fully shut. Every fake
 * defaults to a no-op empty result, so a test only supplies the deps it cares
 * about.
 *
 * The fakes mirror stock.js's real signatures — `fetchRetailerStock(brand,
 * retailer)`, `fetchNearbyStock(brand, retailer)`, `enrichColours(brand,
 * cars)` — so a passing test proves the handlers call them the way production
 * does.
 */
export async function startTestServer(deps = {}) {
  const server = buildServer({ ...INERT_LOCATION, ...deps });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    async close() {
      server.close();
      await once(server, 'close');
    },
  };
}

/** POST JSON and return { status, json, text } — json is null if the body
 * wasn't JSON, so a test can assert on either without a try/catch. */
export async function post(base, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Passing a pre-serialised string lets a test send deliberately malformed
    // JSON; anything else is stringified normally.
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return readResponse(res);
}

/** GET and return { status, json, text }. */
export async function get(base, path) {
  const res = await fetch(`${base}${path}`);
  return readResponse(res);
}

/** Raw request with a caller-chosen method — for exercising route dispatch
 * (wrong method, OPTIONS preflight) where fetch's helpers would get in the way.
 * `headers` adds request headers. */
export async function request(base, path, { method = 'GET', headers } = {}) {
  const res = await fetch(`${base}${path}`, { method, headers });
  const out = await readResponse(res);
  out.headers = res.headers;
  return out;
}

async function readResponse(res) {
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Non-JSON body (shouldn't happen — the server always sends JSON — but a
    // test asserting that is legitimate).
  }
  return { status: res.status, json, text };
}

/* ------------------------------------------------------------------ *
 * Fixtures: feed-shaped vehicles → real mapVehicle → engine-ready cars
 * ------------------------------------------------------------------ */

let advertSeq = 202500100;

/**
 * Build one feed-shaped BMW vehicle. Only the fields mapVehicle reads matter;
 * `overrides` let a test tweak price/fuel/etc. Each gets a unique advert_id so
 * grouping (which folds identical listings) doesn't collapse distinct fixtures
 * into one card and throw off the count-based assertions.
 */
export function bmwFeedVehicle(overrides = {}) {
  const id = overrides.advert_id ?? advertSeq++;
  return {
    advert_id: id,
    title: 'BMW X3',
    derivative: 'X3 xDrive20d M Sport',
    fuel: 'Diesel',
    cash_price: { value: 42000 },
    mileage: 15000,
    identification: { plate: '72' },
    // Real per-listing figures mapVehicle now surfaces (engine cc + reg year).
    engine: { cc: 1995, litres: 2 },
    registration: { date: '2022-09-30T00:00:00Z' },
    consumption: { fuel: { values: { combined: 48.0 } } },
    media: { items: [{ type: 'image', url: `https://img/bmw-${id}.jpg` }] },
    retailer_site: { id: 96, name: 'Grassicks BMW', dealer_number: '11107' },
    ...overrides,
  };
}

/** Build one feed-shaped MINI vehicle (petrol Countryman by default). */
export function miniFeedVehicle(overrides = {}) {
  const id = overrides.advert_id ?? advertSeq++;
  return {
    advert_id: id,
    title: 'MINI Countryman',
    derivative: 'Countryman C',
    fuel: 'Petrol',
    cash_price: { value: 27000 },
    mileage: 12000,
    identification: { plate: '73' },
    // Real per-listing figures mapVehicle now surfaces (engine cc + reg year).
    engine: { cc: 1499, litres: 1.5 },
    registration: { date: '2023-03-01T00:00:00Z' },
    consumption: { fuel: { values: { combined: 44.0 } } },
    media: { items: [{ type: 'image', url: `https://img/mini-${id}.jpg` }] },
    retailer_site: { id: 92, name: 'Sytner Luton MINI', dealer_number: '15127' },
    ...overrides,
  };
}

/** A pool of `n` distinct, engine-ready BMW cars spread across a price range
 * so a budget answer keeps them all eligible. Big enough (default 20) to prove
 * FIELD_MAX (16) slicing and clamping are observable. */
export function bmwPool(n = 20) {
  return Array.from({ length: n }, (_, i) => mapVehicle(
    bmwFeedVehicle({ cash_price: { value: 30000 + i * 500 } }),
    'bmw',
  ));
}

/** A smaller MINI pool (default 6) — a thin feed, to drive the field's
 * "returns fewer than asked, mode adapts down" path. */
export function miniPool(n = 6) {
  return Array.from({ length: n }, (_, i) => mapVehicle(
    miniFeedVehicle({ cash_price: { value: 24000 + i * 500 } }),
    'mini',
  ));
}

/**
 * A pool of `n` real Honda cars, read from the same `fixtures/honda-cars.json`
 * the fixtures stock source serves in production. Unlike bmw/mini, Honda has no
 * live feed shape — its fixtures ARE the mapped output of mapHondaRaw — so the
 * render test loads the real file rather than synthesising one, exercising the
 * exact cars a browser would see. Sampled from the front of the pool (which the
 * build script writes in file order) for a deterministic, em-dash-free slice.
 */
export function hondaPool(n = 20) {
  const path = fileURLToPath(new URL('../../fixtures/honda-cars.json', import.meta.url));
  const all = JSON.parse(readFileSync(path, 'utf8'));
  return all.slice(0, n);
}

/**
 * A pool of `n` real Ford cars from `fixtures/ford-cars.json` — the curated,
 * mapFordRaw-projected file the fixtures stock source serves for Ford. Same
 * rationale as hondaPool: Ford has no replayable live feed here (Akamai edge),
 * so the render test uses the real fixtures, exercising the exact cars a browser
 * sees, including the ST/GT halo and the EV/PHEV split.
 */
export function fordPool(n = 20) {
  const path = fileURLToPath(new URL('../../fixtures/ford-cars.json', import.meta.url));
  const all = JSON.parse(readFileSync(path, 'utf8'));
  return all.slice(0, n);
}

/**
 * A pool of `n` real Motorrad BIKES from `fixtures/motorrad-bikes.json` — the
 * curated, mapMotorradRaw-projected file the fixtures stock source serves for
 * Motorrad. Same rationale as ford/honda: no replayable live feed here (a
 * session-gated SPA), so the render test uses the real fixtures, exercising the
 * exact bikes a browser sees across every category (GS adventure, RT/K tourers,
 * S/M sport, naked/roadster, R heritage, the electric CE 04). These are bikes,
 * not cars, but the shape mapMotorradRaw produces is the same engine schema, so
 * every downstream consumer treats them identically.
 */
export function motorradPool(n = 20) {
  const path = fileURLToPath(new URL('../../fixtures/motorrad-bikes.json', import.meta.url));
  const all = JSON.parse(readFileSync(path, 'utf8'));
  return all.slice(0, n);
}

/**
 * A pool of `n` real Ferrari cars from `fixtures/ferrari-cars.json` — the baked,
 * mapFerrariRaw-projected snapshot the fixtures stock source serves for Ferrari.
 * Same rationale as ford/honda: the CARS are cold-fetchable (public __NEXT_DATA__
 * JSON, no token) but the PHOTOS are Thron-gallery-gated, so the brand ships a
 * real 148-car snapshot and the render test exercises the exact cars a browser
 * sees across every body (coupé, Spider, the Purosangue) and both fuels (petrol
 * and the 296/SF90 plug-in hybrids). Identical engine schema to every car brand.
 */
export function ferrariPool(n = 20) {
  const path = fileURLToPath(new URL('../../fixtures/ferrari-cars.json', import.meta.url));
  const all = JSON.parse(readFileSync(path, 'utf8'));
  return all.slice(0, n);
}

/**
 * A fake fetchRetailerStock that serves a per-brand pool and records every
 * call's (brand, retailer, scope) so a test can assert the handler threaded them
 * through. Unknown brands fall back to the bmw pool (matching normalizeBrand's
 * default). `.calls` is the audit log.
 *
 * The pool served is the same whatever the scope: what the scope tests assert is
 * that the handler PASSED it on, which is the only part of the decision that
 * lives in the request path. Which cars a scope yields is stock.js's business.
 */
export function fakeStock({ bmw = bmwPool(), mini = miniPool() } = {}) {
  const fn = async (brand, retailer, scope) => {
    fn.calls.push({ brand, retailer, scope });
    return brand === 'mini' ? mini : bmw;
  };
  fn.calls = [];
  return fn;
}

/**
 * A fake enrichColours that tags each car with a colour and counts calls, so
 * `enrich` behaviour is assertable without a PDP fetch. The knockout's
 * cost-saving contract ("don't enrich unless asked") is tested by the call
 * count staying at 0.
 */
export function fakeEnrich() {
  const fn = async (brand, cars = []) => {
    fn.calls += 1;
    for (const car of cars) {
      car.colour = { colour: 'Blue', manufacturerColour: 'Portimao Blue' };
    }
    return cars;
  };
  fn.calls = 0;
  return fn;
}

/** A fetchRetailerStock/fetchNearbyStock that always throws the given error —
 * for the 502 (StockUnavailableError) and 500 (generic) / nearby-degrades
 * paths. */
export function throwingStock(error) {
  return async () => { throw error; };
}
