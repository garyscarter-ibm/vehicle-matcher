/*
 * HTTP API-layer tests for the matcher engine.
 *
 * The engine's scoring is covered by engine.test.js / brand.test.js (pure
 * functions against fixtures). This suite covers the *server contract* every
 * interface mode depends on: route dispatch, request validation, response
 * shape and status codes, brand/retailer plumbing, and the size/enrich field
 * controls the game modes (swipe deck, knockout bracket) rely on.
 *
 * All of it runs against a real buildServer() instance on an ephemeral port
 * with an injected in-memory stock source (see helpers.js) — the true handler
 * code path, no live feed, no network. This is the layer whose absence let the
 * /api/field incident ship (a mode calling an endpoint the deployed backend
 * didn't serve); the contract-guard test below is the direct regression for it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildServer, FIELD_MAX, PREVIEW_COUNT, clampFieldSize,
} from '../index.js';
import { TOP_MATCHES, MAX_SHOWN } from '../engine.js';
import { StockUnavailableError, normalizeScope, DEFAULT_SCOPE } from '../stock.js';
import {
  startTestServer, post, get, request,
  fakeStock, fakeEnrich, throwingStock, bmwPool, miniPool, bmwFeedVehicle,
} from './helpers.js';
import { mapVehicle, mapRRMCRaw } from '../mapping.js';

/* A budget that keeps every fixture car eligible (fixtures sit 24k–40k). */
const OPEN_BRIEF = { budget: [10000, 60000] };

/* A fuller brief for /api/match — enough to produce reasons/trade-offs. */
const FULL_BRIEF = {
  budget: [10000, 60000],
  bodyStyles: ['suv'],
  fuel: ['open'],
  charging: 'none',
  primaryUse: 'family',
  people: 'family',
  priorities: ['comfort'],
};

/** Spin a server up with the standard fakes, run `fn`, always tear it down.
 * Returns whatever `fn` returns. Each test gets a fresh server + fresh fakes. */
async function withServer(deps, fn) {
  const srv = await startTestServer(deps);
  try {
    return await fn(srv.base, deps);
  } finally {
    await srv.close();
  }
}

/* ------------------------------------------------------------------ *
 * Route dispatch & methods
 * ------------------------------------------------------------------ */

test('GET /health → 200 { ok: true }', async () => {
  await withServer({}, async (base) => {
    const { status, json } = await get(base, '/health');
    assert.equal(status, 200);
    assert.deepEqual(json, { ok: true });
  });
});

test('unknown path → 404 { error }', async () => {
  await withServer({}, async (base) => {
    const { status, json } = await get(base, '/api/nope');
    assert.equal(status, 404);
    assert.equal(typeof json.error, 'string');
  });
});

test('right path but wrong method → 404 (POST-only route via GET)', async () => {
  await withServer({}, async (base) => {
    // /api/match is POST-only; a GET must not fall through to it.
    const { status } = await request(base, '/api/match', { method: 'GET' });
    assert.equal(status, 404);
  });
});

test('OPTIONS preflight → 204 with CORS headers', async () => {
  await withServer({}, async (base) => {
    const { status, headers } = await request(base, '/api/match', { method: 'OPTIONS' });
    assert.equal(status, 204);
    assert.equal(headers.get('access-control-allow-origin'), '*');
    assert.match(headers.get('access-control-allow-methods'), /POST/);
    assert.match(headers.get('access-control-allow-headers'), /Content-Type/i);
    // The shared-password header must be advertised or the browser preflight
    // blocks it before the request reaches the handler.
    assert.match(headers.get('access-control-allow-headers'), /X-Access-Key/i);
  });
});

/* ------------------------------------------------------------------ *
 * Shared-password gate (DEMO_ACCESS_KEY)
 *
 * When the env var is unset, auth is off and the whole suite above runs open.
 * These tests set it around a single server instance (isAuthorized reads it
 * per-request) and restore it in a finally so it never leaks to sibling tests
 * — node --test runs them all in one process.
 * ------------------------------------------------------------------ */

/** Run `fn` with DEMO_ACCESS_KEY set to `key`, restoring the prior value after. */
async function withAccessKey(key, fn) {
  const prev = process.env.DEMO_ACCESS_KEY;
  process.env.DEMO_ACCESS_KEY = key;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.DEMO_ACCESS_KEY;
    else process.env.DEMO_ACCESS_KEY = prev;
  }
}

test('auth off (no key set) → /api/questions open with no header', async () => {
  // Explicit guard that the unset-key path stays open (the suite above relies
  // on it implicitly). Belt-and-braces: force it unset for this test.
  const prev = process.env.DEMO_ACCESS_KEY;
  delete process.env.DEMO_ACCESS_KEY;
  try {
    await withServer({}, async (base) => {
      const { status } = await get(base, '/api/questions?brand=bmw');
      assert.equal(status, 200);
    });
  } finally {
    if (prev !== undefined) process.env.DEMO_ACCESS_KEY = prev;
  }
});

test('gated: /api/questions with no key → 401', async () => {
  await withAccessKey('s3cret', async () => {
    await withServer({}, async (base) => {
      const { status, json } = await get(base, '/api/questions?brand=bmw');
      assert.equal(status, 401);
      assert.equal(typeof json.error, 'string');
    });
  });
});

test('gated: wrong key → 401', async () => {
  await withAccessKey('s3cret', async () => {
    await withServer({}, async (base) => {
      const { status } = await request(base, '/api/questions?brand=bmw', {
        headers: { 'X-Access-Key': 'nope' },
      });
      assert.equal(status, 401);
    });
  });
});

test('gated: correct key → 200 with the normal questions shape', async () => {
  await withAccessKey('s3cret', async () => {
    await withServer({}, async (base) => {
      const { status, json } = await request(base, '/api/questions?brand=bmw', {
        headers: { 'X-Access-Key': 's3cret' },
      });
      assert.equal(status, 200);
      assert.ok(Array.isArray(json.questions));
    });
  });
});

test('gated: POST /api/match without the key → 401 (POST routes are gated too)', async () => {
  await withAccessKey('s3cret', async () => {
    await withServer({ fetchRetailerStock: fakeStock() }, async (base) => {
      const { status } = await post(base, '/api/match', { answers: FULL_BRIEF });
      assert.equal(status, 401);
    });
  });
});

test('gated: /health stays open with no key (platform health check must not break)', async () => {
  await withAccessKey('s3cret', async () => {
    await withServer({}, async (base) => {
      const { status, json } = await get(base, '/health');
      assert.equal(status, 200);
      assert.deepEqual(json, { ok: true });
    });
  });
});

test('every endpoint the client calls exists (contract guard for the /api/field-class bug)', async () => {
  // Enumerate exactly what blocks/vehicle-matcher/engine.js talks to. If a mode
  // depends on an endpoint the server doesn't serve, one of these 404s — which
  // is precisely the failure that shipped when /api/field went live before the
  // backend served it. A valid request to each must NOT come back 404.
  const enrich = fakeEnrich();
  await withServer(
    {
      fetchRetailerStock: fakeStock(),
      fetchNearbyStock: fakeStock(),
      enrichColours: enrich,
      // The harness's default geocoder answers "no such postcode", which is a
      // 404 from the HANDLER — indistinguishable from the 404 this test is
      // looking for, so the route would look missing when it isn't. One that
      // resolves keeps the guard about routing.
      geocodePostcode: async () => ({ postcode: 'NG1', latitude: 52.95, longitude: -1.15 }),
    },
    async (base) => {
      const calls = [
        () => get(base, '/api/questions'),
        () => post(base, '/api/match', { answers: FULL_BRIEF }),
        () => post(base, '/api/preview', { answers: OPEN_BRIEF }),
        () => post(base, '/api/field', { answers: OPEN_BRIEF, size: 8 }),
        () => post(base, '/api/nearby', { answers: FULL_BRIEF }),
        // Guess Who's two. The pool is its only data call; the geocode is the
        // distance filter's, and 'NG1' is a real outward code so a valid request
        // here means a 200 rather than the 404 an unknown postcode earns.
        () => get(base, '/api/pool'),
        () => get(base, '/api/geocode?postcode=NG1'),
      ];
      for (const call of calls) {
        const { status } = await call();
        assert.notEqual(status, 404, 'a client endpoint returned 404 — the server does not serve it');
        assert.ok(status < 500, `a client endpoint 5xx'd on a valid request (got ${status})`);
      }
    },
  );
});

/* ------------------------------------------------------------------ *
 * /api/questions — brand filtering
 * ------------------------------------------------------------------ */

test('GET /api/questions ships questions + budgetBands + topMatches', async () => {
  await withServer({}, async (base) => {
    const { status, json } = await get(base, '/api/questions');
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.questions) && json.questions.length > 0);
    assert.ok(json.budgetBands && typeof json.budgetBands === 'object');
    assert.equal(json.topMatches, TOP_MATCHES);
    // showIf predicates can't cross JSON — they must be stripped, not serialised.
    for (const q of json.questions) assert.equal(typeof q.showIf, 'undefined');
  });
});

test('GET /api/questions?brand=mini filters options MINI does not sell', async () => {
  await withServer({}, async (base) => {
    const bmw = (await get(base, '/api/questions')).json;
    const mini = (await get(base, '/api/questions?brand=mini')).json;
    const fuelOf = (set) => set.questions.find((q) => q.id === 'fuel').options.map((o) => o.value);
    assert.ok(fuelOf(bmw).includes('diesel'), 'BMW offers diesel');
    assert.ok(!fuelOf(mini).includes('diesel'), 'MINI drops diesel');
  });
});

test('GET /api/questions with a garbage brand defaults to BMW', async () => {
  await withServer({}, async (base) => {
    const bmw = (await get(base, '/api/questions')).json;
    const junk = (await get(base, '/api/questions?brand=zzz')).json;
    assert.deepEqual(
      junk.questions.map((q) => q.id),
      bmw.questions.map((q) => q.id),
      'unknown brand yields the BMW question set',
    );
  });
});

/* ------------------------------------------------------------------ *
 * Validation (readMatchRequest, exercised over /api/match)
 * ------------------------------------------------------------------ */

test('missing answers → 400', async () => {
  await withServer({ fetchRetailerStock: fakeStock() }, async (base) => {
    const { status, json } = await post(base, '/api/match', {});
    assert.equal(status, 400);
    assert.match(json.error, /answers/i);
  });
});

test('non-object answers (array / string) → 400', async () => {
  await withServer({ fetchRetailerStock: fakeStock() }, async (base) => {
    assert.equal((await post(base, '/api/match', { answers: [1, 2] })).status, 400);
    assert.equal((await post(base, '/api/match', { answers: 'nope' })).status, 400);
  });
});

test('missing / invalid budget → 400', async () => {
  await withServer({ fetchRetailerStock: fakeStock() }, async (base) => {
    assert.equal((await post(base, '/api/match', { answers: { bodyStyles: ['suv'] } })).status, 400);
    assert.equal((await post(base, '/api/match', { answers: { budget: 'lots' } })).status, 400);
    assert.equal((await post(base, '/api/match', { answers: { budget: [0, 0] } })).status, 400);
  });
});

test('legacy b1–b5 band budget is accepted → not a 400', async () => {
  await withServer({ fetchRetailerStock: fakeStock(), enrichColours: fakeEnrich() }, async (base) => {
    const { status } = await post(base, '/api/match', { answers: { budget: 'b2' } });
    assert.equal(status, 200, 'an old shared link with a band key still resolves');
  });
});

test('malformed JSON body → 400', async () => {
  await withServer({ fetchRetailerStock: fakeStock() }, async (base) => {
    const { status } = await post(base, '/api/match', '{ not json');
    assert.equal(status, 400);
  });
});

test('oversized body → 413', async () => {
  await withServer({ fetchRetailerStock: fakeStock() }, async (base) => {
    // MAX_BODY_BYTES is 16 KiB; a padded answers object blows past it.
    const huge = { answers: { budget: [10000, 60000], pad: 'x'.repeat(20 * 1024) } };
    const { status } = await post(base, '/api/match', huge);
    assert.equal(status, 413);
  });
});

/* ------------------------------------------------------------------ *
 * /api/match — response shape + failure mapping
 * ------------------------------------------------------------------ */

test('POST /api/match returns the full match envelope + publicMatch shape', async () => {
  await withServer(
    { fetchRetailerStock: fakeStock(), enrichColours: fakeEnrich() },
    async (base) => {
      const { status, json } = await post(base, '/api/match', { answers: FULL_BRIEF });
      assert.equal(status, 200);
      for (const key of ['matches', 'alternatives', 'decisive', 'clusterSize', 'tasteLead', 'searched', 'unmet']) {
        assert.ok(key in json, `response is missing ${key}`);
      }
      assert.ok(Array.isArray(json.matches) && json.matches.length > 0);
      // matchCars caps the shown set at MAX_SHOWN (a cluster can exceed TOP_MATCHES).
      assert.ok(json.matches.length <= MAX_SHOWN);
      const m = json.matches[0];
      assert.equal(typeof m.score, 'number');
      assert.ok(Array.isArray(m.reasons));
      assert.ok(Array.isArray(m.tradeOffs));
      assert.ok(Array.isArray(m.listings) && m.listings.length >= 1);
      // publicCar shape: display fields present, internal scoring fields absent.
      assert.equal(typeof m.car.name, 'string');
      assert.equal(typeof m.car.priceMin, 'number');
      assert.match(m.car.link, /^https?:\/\//);
      assert.equal(m.car.tags, undefined, 'internal scoring tags must not leak');
      assert.equal(m.car.sizeClass, undefined, 'internal sizeClass must not leak');
    },
  );
});

test('POST /api/match maps StockUnavailableError → 502', async () => {
  await withServer(
    { fetchRetailerStock: throwingStock(new StockUnavailableError('feed down')) },
    async (base) => {
      const { status, json } = await post(base, '/api/match', { answers: FULL_BRIEF });
      assert.equal(status, 502);
      assert.match(json.error, /unavailable/i);
    },
  );
});

test('POST /api/match maps a generic stock error → 500', async () => {
  await withServer(
    { fetchRetailerStock: throwingStock(new Error('boom')) },
    async (base) => {
      const { status } = await post(base, '/api/match', { answers: FULL_BRIEF });
      assert.equal(status, 500);
    },
  );
});

/* ------------------------------------------------------------------ *
 * /api/preview — the questions drawer
 * ------------------------------------------------------------------ */

test('POST /api/preview returns ≤ PREVIEW_COUNT matches, each painted', async () => {
  const enrich = fakeEnrich();
  await withServer(
    { fetchRetailerStock: fakeStock({ bmw: bmwPool(20) }), enrichColours: enrich },
    async (base) => {
      const { status, json } = await post(base, '/api/preview', { answers: OPEN_BRIEF });
      assert.equal(status, 200);
      assert.ok(json.matches.length <= PREVIEW_COUNT);
      assert.ok(json.matches.length > 0, 'the 20-car pool fills the drawer');
      // Preview always enriches — every card carries the colour the fake tags on.
      assert.ok(enrich.calls > 0, 'preview must enrich');
      assert.ok(json.matches.every((m) => m.car.colour), 'every preview card is painted');
    },
  );
});

test('POST /api/preview accepts a partial brief (budget only) → 200', async () => {
  await withServer(
    { fetchRetailerStock: fakeStock(), enrichColours: fakeEnrich() },
    async (base) => {
      // The drawer re-ranks mid-quiz on incomplete answers; budget is the one
      // guaranteed field. This must be a normal 200, not a validation error.
      const { status, json } = await post(base, '/api/preview', { answers: { budget: [10000, 60000] } });
      assert.equal(status, 200);
      assert.ok(Array.isArray(json.matches));
    },
  );
});

test('POST /api/preview degrades a ranking failure to { matches: [] } 200, never 5xx', async () => {
  // A scorer that trips on a partial answer set must not take the drawer down.
  // Inject a pool whose ranking throws by handing rankCars a car it chokes on:
  // simplest reliable trigger is a stock fn returning a non-array, which makes
  // rankCars throw inside the guarded try. The handler must swallow it.
  await withServer(
    { fetchRetailerStock: async () => ({ not: 'an array' }), enrichColours: fakeEnrich() },
    async (base) => {
      const { status, json } = await post(base, '/api/preview', { answers: OPEN_BRIEF });
      assert.equal(status, 200, 'a ranking throw degrades to 200, not 500');
      assert.deepEqual(json.matches, []);
    },
  );
});

/* ------------------------------------------------------------------ *
 * /api/field — the game-mode roster (the reason this suite is timely)
 * ------------------------------------------------------------------ */

test('POST /api/field returns ≤ FIELD_MAX and respects a size under the cap', async () => {
  await withServer(
    { fetchRetailerStock: fakeStock({ bmw: bmwPool(20) }) },
    async (base) => {
      const { status, json } = await post(base, '/api/field', { answers: OPEN_BRIEF, size: 8 });
      assert.equal(status, 200);
      assert.equal(json.matches.length, 8, 'a size of 8 against a 20-car pool yields exactly 8');
      assert.ok(json.matches.length <= FIELD_MAX);
    },
  );
});

test('POST /api/field clamps an oversized size down to FIELD_MAX', async () => {
  await withServer(
    { fetchRetailerStock: fakeStock({ bmw: bmwPool(20) }) },
    async (base) => {
      const { json } = await post(base, '/api/field', { answers: OPEN_BRIEF, size: 999 });
      assert.equal(json.matches.length, FIELD_MAX, '999 → FIELD_MAX against a big pool');
    },
  );
});

test('POST /api/field treats an under-minimum size as the cap (clampFieldSize)', async () => {
  await withServer(
    { fetchRetailerStock: fakeStock({ bmw: bmwPool(20) }) },
    async (base) => {
      // size 1 is below the 2-car minimum → clampFieldSize returns FIELD_MAX,
      // so the roster fills rather than collapsing to a single car.
      const { json } = await post(base, '/api/field', { answers: OPEN_BRIEF, size: 1 });
      assert.equal(json.matches.length, FIELD_MAX);
    },
  );
});

test('POST /api/field with a thin feed returns fewer than asked (drives the adaptive snap)', async () => {
  await withServer(
    { fetchRetailerStock: fakeStock({ mini: miniPool(6) }) },
    async (base) => {
      const { json } = await post(base, '/api/field', { answers: OPEN_BRIEF, brand: 'mini', size: 16 });
      assert.equal(json.matches.length, 6, 'a 6-car feed yields 6, not padded to 16');
    },
  );
});

test('POST /api/field enrich:true paints the cards', async () => {
  const enrich = fakeEnrich();
  await withServer(
    { fetchRetailerStock: fakeStock({ mini: miniPool(6) }), enrichColours: enrich },
    async (base) => {
      const { json } = await post(base, '/api/field', {
        answers: OPEN_BRIEF, brand: 'mini', size: 6, enrich: true,
      });
      assert.ok(enrich.calls > 0, 'enrich:true must call enrichColours');
      assert.ok(json.matches.every((m) => m.car.colour), 'every card is painted when enrich:true');
    },
  );
});

test('POST /api/field with enrich omitted does NOT enrich (the knockout cost-saving contract)', async () => {
  const enrich = fakeEnrich();
  await withServer(
    { fetchRetailerStock: fakeStock({ bmw: bmwPool(20) }), enrichColours: enrich },
    async (base) => {
      const { json } = await post(base, '/api/field', { answers: OPEN_BRIEF, size: 16 });
      assert.equal(enrich.calls, 0, 'a field without enrich must not fetch a PDP for every entrant');
      assert.ok(json.matches.every((m) => !m.car.colour), 'no card is painted when enrich is omitted');
    },
  );
});

test('POST /api/field degrades a ranking failure to { matches: [] } 200', async () => {
  await withServer(
    { fetchRetailerStock: async () => ({ not: 'an array' }) },
    async (base) => {
      const { status, json } = await post(base, '/api/field', { answers: OPEN_BRIEF, size: 8 });
      assert.equal(status, 200);
      assert.deepEqual(json.matches, []);
    },
  );
});

/* ------------------------------------------------------------------ *
 * Brand / retailer plumbing
 * ------------------------------------------------------------------ */

test('brand routes to the right feed; retailer is threaded to the stock fetch', async () => {
  const stock = fakeStock({ bmw: bmwPool(20), mini: miniPool(6) });
  await withServer({ fetchRetailerStock: stock }, async (base) => {
    await post(base, '/api/field', { answers: OPEN_BRIEF, brand: 'mini', retailer: '92', size: 16 });
    await post(base, '/api/field', { answers: OPEN_BRIEF, brand: 'bmw', retailer: '96', size: 16 });
    const mini = stock.calls.find((c) => c.brand === 'mini');
    const bmw = stock.calls.find((c) => c.brand === 'bmw');
    assert.ok(mini && mini.retailer === '92', 'MINI request threaded retailer 92');
    assert.ok(bmw && bmw.retailer === '96', 'BMW request threaded retailer 96');
  });
});

test('an absent/garbage brand defaults to bmw at the stock layer', async () => {
  const stock = fakeStock();
  await withServer({ fetchRetailerStock: stock }, async (base) => {
    await post(base, '/api/field', { answers: OPEN_BRIEF, brand: 'zzz', size: 8 });
    assert.equal(stock.calls[0].brand, 'bmw', 'unknown brand normalises to bmw');
  });
});

/* ------------------------------------------------------------------ *
 * Scope — WHOSE stock the request is about
 * ------------------------------------------------------------------ *
 *
 * One embed asks about a single forecourt, another about the whole network, and
 * the answers differ by two orders of magnitude (41 cars at Grassicks against
 * 12,143 nationally). Every consequence of getting it wrong is silent: no error,
 * no empty screen, just a pool that isn't the one the page claims. So the scope
 * gets its own section, and the asymmetry below is deliberate — an unrecognised
 * scope must always resolve DOWN to the dealer, never up to the network. Showing
 * a user fewer cars than exist is a disappointment; showing them cars 300 miles
 * away under a branch's own name is a lie.
 */

test('normalizeScope takes the two scopes case-insensitively and defaults everything else to dealer', () => {
  for (const good of ['dealer', 'national', 'NATIONAL', ' Dealer ', 'National']) {
    assert.equal(
      normalizeScope(good),
      good.trim().toLowerCase(),
      `${JSON.stringify(good)} is a scope, however it was typed`,
    );
  }
  for (const bad of ['nationl', 'all', 'everywhere', '', ' ', null, undefined, 0, 42, {}, []]) {
    assert.equal(normalizeScope(bad), 'dealer', `${JSON.stringify(bad)} must fall back to dealer`);
  }
  assert.equal(DEFAULT_SCOPE, 'dealer', 'the default is the narrow pool, by design');
});

test('scope is threaded to the stock fetch by every endpoint that reads the pool', async () => {
  const stock = fakeStock();
  await withServer({ fetchRetailerStock: stock, enrichColours: fakeEnrich() }, async (base) => {
    await post(base, '/api/match', { answers: FULL_BRIEF, scope: 'national' });
    await post(base, '/api/preview', { answers: OPEN_BRIEF, scope: 'national' });
    await post(base, '/api/field', { answers: OPEN_BRIEF, size: 8, scope: 'national' });
    await get(base, '/api/pool?scope=national');
    assert.equal(stock.calls.length, 4, 'all four endpoints read the pool');
    for (const call of stock.calls) {
      assert.equal(call.scope, 'national', 'each endpoint passes the scope it was given');
    }
  });
});

test('a request that names no scope reads the dealer pool, on all four endpoints', async () => {
  const stock = fakeStock();
  await withServer({ fetchRetailerStock: stock, enrichColours: fakeEnrich() }, async (base) => {
    await post(base, '/api/match', { answers: FULL_BRIEF });
    await post(base, '/api/preview', { answers: OPEN_BRIEF });
    await post(base, '/api/field', { answers: OPEN_BRIEF, size: 8 });
    await get(base, '/api/pool');
    assert.equal(stock.calls.length, 4);
    for (const call of stock.calls) {
      assert.equal(call.scope, 'dealer', 'silence means this dealer, never the network');
    }
  });
});

test('GET /api/pool echoes the scope it actually used, so a typo is visible', async () => {
  const stock = fakeStock({ bmw: bmwPool(5) });
  await withServer({ fetchRetailerStock: stock }, async (base) => {
    const wide = await get(base, '/api/pool?scope=national');
    assert.equal(wide.json.scope, 'national', 'a valid scope is echoed back');

    const typo = await get(base, '/api/pool?scope=nationl');
    assert.equal(typo.json.scope, 'dealer', 'a typo is reported as what it became');
    assert.equal(
      stock.calls.at(-1).scope,
      'dealer',
      'and the echo is the scope actually read, not the string sent',
    );
  });
});

test('GET /api/pool threads the retailer too, so a dealer scope has a dealer to scope to', async () => {
  const stock = fakeStock();
  await withServer({ fetchRetailerStock: stock }, async (base) => {
    await get(base, '/api/pool?retailer=96&scope=dealer');
    assert.equal(stock.calls[0].retailer, '96', 'the hard-filter mode names its dealer like every other');
  });
});

/* ------------------------------------------------------------------ *
 * /api/nearby — the honesty distinction
 * ------------------------------------------------------------------ */

test('POST /api/nearby returns { nearby, unmet } on success', async () => {
  await withServer(
    { fetchNearbyStock: fakeStock({ bmw: bmwPool(20) }) },
    async (base) => {
      const { status, json } = await post(base, '/api/nearby', { answers: FULL_BRIEF });
      assert.equal(status, 200);
      assert.ok(Array.isArray(json.nearby));
      // A successful lookup reports unmet as an object (a finding), never null.
      assert.ok(json.unmet && typeof json.unmet === 'object');
    },
  );
});

test('POST /api/nearby degrades a failure to { nearby: [], unmet: null } 200', async () => {
  await withServer(
    { fetchNearbyStock: throwingStock(new StockUnavailableError('down')) },
    async (base) => {
      const { status, json } = await post(base, '/api/nearby', { answers: FULL_BRIEF });
      assert.equal(status, 200, 'nearby is a bonus tier — a failure is never a 5xx');
      assert.deepEqual(json.nearby, []);
      // unmet is null, NOT {}: "we never heard back" must be distinguishable
      // from "nearby found nothing that fits" before telling a user it doesn't exist.
      assert.equal(json.unmet, null);
    },
  );
});

/* ------------------------------------------------------------------ *
 * /api/pool — the whole stock, columnar (Guess Who's only data call)
 * ------------------------------------------------------------------ */

/*
 * The pool's contract is INDEX ALIGNMENT, and nothing else can check it.
 *
 * Every other endpoint ships objects, where a missing field is a missing field.
 * This one ships parallel arrays plus dictionaries of the strings they index
 * into, so a column that is one element short doesn't fail — it silently shifts
 * every car after it onto the wrong price, and the client filters a board of
 * plausible nonsense. That is a bug no assertion about "a 200 with some JSON"
 * would ever catch, so it gets one of its own.
 */
test('GET /api/pool ships every column index-aligned to n', async () => {
  await withServer({ fetchRetailerStock: fakeStock({ bmw: bmwPool(7) }) }, async (base) => {
    const { status, json } = await get(base, '/api/pool');
    assert.equal(status, 200);
    assert.equal(json.n, 7, 'n must be the car count');

    const COLUMNS = [
      'id', 'name', 'line', 'body', 'fuel', 'transmission', 'retailer', 'shade', 'paint',
      'retailerId', 'price', 'mileage', 'year', 'plate', 'seats', 'boot', 'zeroTo62',
      'mpg', 'features', 'photo',
    ];
    for (const col of COLUMNS) {
      assert.ok(Array.isArray(json[col]), `${col} is not an array`);
      assert.equal(json[col].length, json.n, `${col} is not n long — the columns are misaligned`);
    }

    // Each dictionary column indexes a real slot in its dictionary. An index
    // past the end reads undefined on the client, which paints as a blank spec
    // rather than an error.
    const PAIRS = [
      ['name', 'names'], ['line', 'lines'], ['body', 'bodies'], ['fuel', 'fuels'],
      ['transmission', 'transmissions'], ['retailer', 'retailers'],
      ['shade', 'shades'], ['paint', 'paints'],
    ];
    for (const [col, dict] of PAIRS) {
      assert.ok(Array.isArray(json[dict]), `${dict} dictionary missing`);
      for (const at of json[col]) {
        assert.ok(
          Number.isInteger(at) && at >= 0 && at < json[dict].length,
          `${col} holds ${at}, which is not a slot in ${dict}`,
        );
      }
    }

    // The bitmask is a number per car, and every set bit names a real concept.
    assert.ok(Array.isArray(json.featureKeys));
    for (const mask of json.features) {
      assert.equal(typeof mask, 'number');
      assert.ok(mask < 2 ** json.featureKeys.length, 'a feature bit is set past featureKeys');
    }
  });
});

// Guess Who's RRMC cards need POA, drive side and region per car, plus the brand's price range.
test('GET /api/pool ships RRMC poa/handDrive/region columns and price range, and only for RRMC', async () => {
  const rrmc = [
    mapRRMCRaw({ id: 'a', name: 'Cullinan', price: 310000, year: 2021, handDrive: 'rhd', region: 'europe' }),
    mapRRMCRaw({ id: 'b', name: 'Phantom', price: 0, poa: true, year: 2022, handDrive: 'lhd', region: 'mea' }),
    mapRRMCRaw({ id: 'c', name: 'Ghost', price: 190000, year: 2020 }),
  ];
  await withServer({ fetchRetailerStock: fakeStock({ bmw: rrmc }) }, async (base) => {
    const { status, json } = await get(base, '/api/pool?brand=rrmc');
    assert.equal(status, 200);
    assert.deepEqual(json.poa, [0, 1, 0], 'POA rides as its own column, not as the placeholder price');
    for (const [col, dict] of [['handDrive', 'handDrives'], ['region', 'regions']]) {
      assert.equal(json[col].length, json.n, `${col} is not n long`);
      assert.ok(json[col].every((at) => at >= 0 && at < json[dict].length), `${col} indexes past ${dict}`);
    }
    assert.equal(json.handDrives[json.handDrive[0]], 'rhd');
    assert.equal(json.regions[json.region[1]], 'mea');
    assert.equal(json.handDrives[json.handDrive[2]], null, 'an unknown side stays unknown');
    assert.equal(json.labels.handDrive.rhd, 'Right Hand Drive');
    assert.equal(json.labels.region.europe, 'The UK & Europe');
    assert.deepEqual(json.priceRange, { min: 60000, max: 1000000, step: 1000, minGap: 20000 });
  });
  // BMW's 12k-car payload must not grow by a single column.
  await withServer({ fetchRetailerStock: fakeStock({ bmw: bmwPool(3) }) }, async (base) => {
    const { json } = await get(base, '/api/pool');
    for (const key of ['poa', 'handDrive', 'handDrives', 'region', 'regions', 'labels', 'priceRange']) {
      assert.equal(json[key], undefined, `BMW's pool should not carry ${key}`);
    }
  });
});

test('GET /api/pool ships a sites table aligned with retailers, not with the cars', async () => {
  // The one table that is per-RETAILER. Two sites so the alignment claim is
  // falsifiable: if it were car-aligned or dictionary order were ignored, the
  // coordinates would land on the wrong name.
  const cars = [
    ...bmwPool(2),
    ...Array.from({ length: 2 }, (_, i) => mapVehicle(bmwFeedVehicle({
      cash_price: { value: 50000 + i * 500 },
      retailer_site: { id: 97, name: 'Barons BMW', dealer_number: '22208' },
    }), 'bmw')),
  ];
  const directory = new Map([
    ['11107', { name: 'Grassicks BMW', postcode: 'PH1 3GA', latitude: 56.4, longitude: -3.47 }],
    ['22208', { name: 'Barons BMW', postcode: 'GU14 7PA', latitude: 51.28, longitude: -0.77 }],
  ]);
  await withServer(
    { fetchRetailerStock: fakeStock({ bmw: cars }), fetchDealerDirectory: async () => directory },
    async (base) => {
      const { json } = await get(base, '/api/pool');
      assert.equal(json.sites.lat.length, json.retailers.length, 'sites.lat is not retailer-aligned');
      assert.equal(json.sites.lon.length, json.retailers.length, 'sites.lon is not retailer-aligned');
      const grassicks = json.retailers.indexOf('Grassicks BMW');
      const barons = json.retailers.indexOf('Barons BMW');
      assert.ok(grassicks >= 0 && barons >= 0, 'both retailers are in the dictionary');
      // 4 dp, which is ~11m — see siteCoords. The point is which slot, not the
      // precision, so compare on the rounded value the wire actually carries.
      assert.equal(json.sites.lat[grassicks], 56.4);
      assert.equal(json.sites.lat[barons], 51.28);
      assert.notEqual(json.sites.lat[grassicks], json.sites.lat[barons]);
    },
  );
});

test('GET /api/pool still serves the stock when the dealer directory is down', async () => {
  /*
   * The mode's premise is EVERY car, so a third-party directory must never be
   * able to take the board away. What a failure costs is the distance filter, and
   * nothing else: null coordinates, which the client already treats as "this axis
   * has no data" and hides. Same shape as an unmapped dealer_number, which is
   * why one test covers both.
   */
  await withServer(
    {
      fetchRetailerStock: fakeStock({ bmw: bmwPool(4) }),
      fetchDealerDirectory: async () => { throw new Error('directory unavailable'); },
    },
    async (base) => {
      const { status, json } = await get(base, '/api/pool');
      assert.equal(status, 200, 'a directory failure must not fail the pool');
      assert.equal(json.n, 4);
      assert.ok(json.sites, 'the sites table must still be present, just empty');
      assert.equal(json.sites.lat.length, json.retailers.length);
      assert.ok(json.sites.lat.every((v) => v === null), 'no directory means no coordinates');
    },
  );
});

test('GET /api/pool leaves a dealer the directory does not know unlocated', async () => {
  // A directory that answers, but not about this dealer. The slot stays null
  // rather than borrowing another site's position, which would put a car in the
  // wrong county and make the distance filter lie.
  await withServer(
    {
      fetchRetailerStock: fakeStock({ bmw: bmwPool(3) }),
      fetchDealerDirectory: async () => new Map([
        ['99999', { name: 'Somewhere Else BMW', postcode: 'M1 1AA', latitude: 53.48, longitude: -2.24 }],
      ]),
    },
    async (base) => {
      const { status, json } = await get(base, '/api/pool');
      assert.equal(status, 200);
      assert.ok(json.sites.lat.every((v) => v === null), 'an unknown dealer must not be located');
    },
  );
});

test('GET /api/pool 502s when the stock itself is unavailable', async () => {
  // Unlike the directory, the stock IS the pool — there is no degraded version.
  await withServer({ fetchRetailerStock: throwingStock(new StockUnavailableError('feed down')) }, async (base) => {
    const { status, json } = await get(base, '/api/pool');
    assert.equal(status, 502);
    assert.ok(json.error, 'a 502 must say something');
  });
});

/* ------------------------------------------------------------------ *
 * /api/geocode — the buyer's end of the distance filter
 * ------------------------------------------------------------------ */

test('GET /api/geocode returns the coordinates for a postcode', async () => {
  await withServer(
    { geocodePostcode: async () => ({ postcode: 'NG1 2AB', latitude: 52.9548, longitude: -1.1581 }) },
    async (base) => {
      const { status, json } = await get(base, '/api/geocode?postcode=ng12ab');
      assert.equal(status, 200);
      // The canonical spelling comes back, because the client writes it into the
      // box as its confirmation that we understood what was typed.
      assert.equal(json.postcode, 'NG1 2AB');
      assert.equal(typeof json.latitude, 'number');
      assert.equal(typeof json.longitude, 'number');
    },
  );
});

test('GET /api/geocode 404s for a postcode that does not exist', async () => {
  // 404, not 502: the two are different messages to a buyer. "We don't know that
  // postcode" is about what they typed; "we couldn't check" is not their fault,
  // and phrasing one as the other either blames them or excuses a typo.
  await withServer({ geocodePostcode: async () => null }, async (base) => {
    const { status, json } = await get(base, '/api/geocode?postcode=zz99zz');
    assert.equal(status, 404);
    assert.ok(json.error);
  });
});

test('GET /api/geocode 502s when the geocoder cannot be reached', async () => {
  await withServer(
    { geocodePostcode: async () => { throw new Error('postcodes.io timed out'); } },
    async (base) => {
      const { status, json } = await get(base, '/api/geocode?postcode=NG1');
      assert.equal(status, 502);
      assert.ok(json.error);
    },
  );
});

test('GET /api/geocode with no postcode at all is a 404, not a crash', async () => {
  // The real geocodePostcode resolves null for anything that isn't postcode-
  // shaped, and an absent param is the degenerate case of that.
  await withServer({ geocodePostcode: async () => null }, async (base) => {
    const { status } = await get(base, '/api/geocode');
    assert.equal(status, 404);
  });
});

/* ------------------------------------------------------------------ *
 * clampFieldSize — direct unit tests (it's exported; boundaries are cheap)
 * ------------------------------------------------------------------ */

test('clampFieldSize: boundaries and junk resolve as documented', () => {
  assert.equal(clampFieldSize(8), 8, 'a value in range passes through');
  assert.equal(clampFieldSize(2), 2, 'the minimum playable field');
  assert.equal(clampFieldSize(FIELD_MAX), FIELD_MAX, 'the cap passes through');
  assert.equal(clampFieldSize(FIELD_MAX + 1), FIELD_MAX, 'above the cap clamps to the cap');
  assert.equal(clampFieldSize(1), FIELD_MAX, 'below the minimum falls back to the cap');
  assert.equal(clampFieldSize(0), FIELD_MAX);
  assert.equal(clampFieldSize(-5), FIELD_MAX);
  assert.equal(clampFieldSize(NaN), FIELD_MAX);
  assert.equal(clampFieldSize(undefined), FIELD_MAX, 'absent size falls back to the cap');
  assert.equal(clampFieldSize('12'), 12, 'a numeric string is coerced');
  assert.equal(clampFieldSize(8.9), 8, 'a fraction floors');
});

/* ------------------------------------------------------------------ *
 * The seam itself: importing the module is hermetic
 * ------------------------------------------------------------------ */

test('buildServer defaults its deps and is not listening until asked', () => {
  // Importing index.js must not bind a port or hit the feed (the main-module
  // guard). buildServer with no deps returns a server that hasn't listened yet.
  const server = buildServer();
  assert.equal(typeof server.listen, 'function');
  assert.equal(server.listening, false, 'buildServer must not auto-listen');
  server.close();
});
