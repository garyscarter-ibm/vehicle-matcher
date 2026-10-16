/*
 * Engine client for the vehicle-matcher block — the HTTP surface every
 * interface "mode" (see modes/) shares.
 *
 * The scoring engine and car dataset live behind an API (see server/) so they
 * never reach the browser. These four functions are the whole contract: they
 * take a resolved base URL plus the request shape and return parsed JSON. They
 * hold no UI state and know nothing about the quiz, so any future mode can
 * drive the same engine without re-implementing transport.
 *
 * Failure policy differs by call on purpose: questions is load-bearing and
 * THROWS (the mode can't render without it); nearby/preview are enhancements
 * and resolve to an empty result rather than break the surface around them.
 */

/**
 * sessionStorage key holding the shared demo password the login overlay
 * captured (see index.html / block.html). It's the whole client side of the auth: the real
 * gate is the server's X-Access-Key check, and this is just where we stash the
 * value so every call can carry it.
 */
export const ACCESS_KEY_STORAGE = 'vmAccessKey';

/** Auth headers for every API call: the stored shared password as X-Access-Key,
 * or nothing when none is set (local dev against an ungated server, and the
 * jsdom render tests, both send no header and the open server accepts them). */
function authHeaders() {
  const key = (typeof sessionStorage !== 'undefined')
    ? sessionStorage.getItem(ACCESS_KEY_STORAGE)
    : null;
  return key ? { 'X-Access-Key': key } : {};
}

/**
 * A 401 means the shared password was wrong or has been rotated. Drop the stale
 * value and tell the host page (index.html / block.html) to re-show its login overlay, then let
 * the caller's own error handling run. Only apiGetQuestions acts on this — it's
 * the load-bearing call that throws; the others degrade to empty, so a bad key
 * simply yields an empty shell, which is the intended "useless without the API".
 */
function onUnauthorized() {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(ACCESS_KEY_STORAGE);
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('vm-auth-failed'));
  }
}

/** The quiz definition for a brand/retailer. Throws on failure — the caller
 * can't render an interface without it. */
export async function apiGetQuestions(base, retailer, brandKey) {
  const url = new URL(`${base}/api/questions`);
  if (retailer) url.searchParams.set('retailer', retailer);
  if (brandKey) url.searchParams.set('brand', brandKey);
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401) onUnauthorized();
  if (!res.ok) throw new Error(`Questions request failed (${res.status})`);
  const data = await res.json();
  return { questions: data.questions };
}

/** The configured retailer's ranked matches for a set of answers. Throws on
 * failure — this is the primary result, not an enhancement. */
export async function apiMatch(base, answers, retailer, brandKey, scope) {
  const res = await fetch(`${base}/api/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      answers, retailer, brand: brandKey, scope,
    }),
  });
  if (!res.ok) throw new Error(`Match request failed (${res.status})`);
  return res.json();
}

/**
 * Cars at other nearby retailers — a separate, slower request than /api/match
 * (a national distance-sorted search) so the hero matches can render first.
 * The section is a bonus, so any failure resolves to an empty list rather than
 * throwing: the caller just omits the "Worth the drive" section.
 *
 * Returns `{ nearby, unmet }`. `unmet` is the wants this pool had nothing
 * behind (see the unmet note in modes/questionnaire.js) and is `null` whenever we
 * didn't get a usable answer — a failed lookup, or an older API that doesn't
 * send the field. An empty list of cars is a finding; a failed lookup is not,
 * and the two must not be confused before telling a user something doesn't exist.
 */
export async function apiNearby(base, answers, retailer, brandKey) {
  const noAnswer = { nearby: [], unmet: null };
  try {
    const res = await fetch(`${base}/api/nearby`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ answers, retailer, brand: brandKey }),
    });
    if (!res.ok) return noAnswer;
    const data = await res.json();
    return {
      nearby: Array.isArray(data.nearby) ? data.nearby : [],
      unmet: (data.unmet && typeof data.unmet === 'object') ? data.unmet : null,
    };
  } catch {
    return noAnswer;
  }
}

/**
 * The configured retailer's current top matches for a live "best guess" —
 * a wider slice than /api/match, refetched as answers change. Like apiNearby
 * it NEVER throws: a failed preview must never break the surface around it, so
 * any error/non-ok resolves to an empty list and the caller keeps its last state.
 *
 * `group` collapses repeat listings of the same model into one result, and is
 * opt-in for the same reason apiField's `enrich` is: what counts as a duplicate
 * depends on the interface reading the list. The questions drawer scrolls a
 * strip of nine, where two Countrymans side by side read as stock depth, so it
 * omits the flag and keeps today's listing-level results. A podium cannot
 * afford that: first, second and third are three distinct verdicts, and
 * awarding all three to one model in three colours says nothing, so a podium
 * passes true.
 */
export async function apiPreview(base, answers, retailer, brandKey, scope, group = false, { suggest = false } = {}) {
  try {
    const res = await fetch(`${base}/api/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        answers, retailer, brand: brandKey, scope, group, ...(suggest && { suggest }),
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.matches) ? data.matches : [];
  } catch {
    return [];
  }
}

/**
 * The WHOLE pool for a brand, columnar, in one request — the hard-filter mode's
 * only data call.
 *
 * Every other function here asks the engine to choose; this one asks for the
 * unranked lot, because Guess Who eliminates rather than recommends and the user
 * watches twelve thousand cars become nine. That has two consequences worth
 * stating: the payload is columns with dictionaries rather than objects (377 KB
 * gzip for BMW's 12,084 cars — see publicPool in server/index.js), and there is
 * no second tier, so no filter interaction ever waits on the network.
 *
 * The mode's premise is "every car we have", so what `scope` narrows is what
 * "we" means — this retailer's forecourt, or the brand's whole network. It is
 * the block's scope either way, never a pre-applied filter of the mode's own:
 * at national scope the board's Distance filter is doing that job, and at dealer
 * scope there is only one place to be near.
 *
 * THROWS on failure, like apiGetQuestions and for the same reason — there is no
 * degraded version of this mode. No pool, no board.
 */
export async function apiPool(base, brandKey, retailer, scope) {
  const url = new URL(`${base}/api/pool`);
  if (brandKey) url.searchParams.set('brand', brandKey);
  if (retailer) url.searchParams.set('retailer', retailer);
  if (scope) url.searchParams.set('scope', scope);
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401) onUnauthorized();
  if (!res.ok) throw new Error(`Pool request failed (${res.status})`);
  return res.json();
}

/**
 * One postcode to one point on the map, for the hard-filter mode's proximity
 * axis. Takes a full postcode or just the outward code ("NG1"), and echoes back
 * the canonical spelling so the UI can show it understood.
 *
 * The two failure modes are deliberately different values rather than one, because
 * the buyer needs to be told different things: `null` is "no such postcode", which
 * is about what they typed, and a THROW is "we couldn't ask", which is not their
 * fault and shouldn't be phrased as though it were. The pool is already loaded by
 * the time anyone types here, so neither ends the mode.
 *
 * @returns {Promise<{postcode, latitude, longitude} | null>}
 */
export async function apiGeocode(base, postcode) {
  const url = new URL(`${base}/api/geocode`);
  url.searchParams.set('postcode', postcode);
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401) onUnauthorized();
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Postcode lookup failed (${res.status})`);
  return res.json();
}

/**
 * The game modes' field — the roster a swipe deck or a knockout bracket plays.
 * Sibling to apiPreview, not a replacement: it reads the SAME engine over the
 * SAME retailer stock, but asks for a wider slice (`size`, up to the server's
 * FIELD_MAX) because a bracket wants a full field, not a top-few shortlist.
 * That's why the games use this and the questions drawer keeps apiPreview — one
 * engine, an interface-shaped read each.
 *
 * `size` is the roster the caller wants (the server clamps it to [2, FIELD_MAX]).
 * `enrich` opts into per-card colour paint: the swipe deck reads car.colour as a
 * taste signal so it passes true; the knockout omits it so a 16-car field doesn't
 * fetch a PDP for every round-one loser. Like apiPreview it NEVER throws — a
 * failed field must not break the game around it, so any error resolves to [].
 */
export async function apiField(base, answers, retailer, brandKey, scope, size, enrich = false) {
  try {
    const res = await fetch(`${base}/api/field`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        answers, retailer, brand: brandKey, scope, size, enrich,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.matches) ? data.matches : [];
  } catch {
    return [];
  }
}
