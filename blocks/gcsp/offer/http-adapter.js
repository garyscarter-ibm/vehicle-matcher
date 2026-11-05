// FUCQ-102 HTTP and safe display contract reviewed at ec70522.
import { toOfferPresentation } from './offer-projection.js';
const unavailable = () => ({ status: 'unavailable', retryable: true });
const statuses = new Set(['ok', 'not-found', 'stale-run', 'forbidden', 'unavailable', 'invalid', 'conflict', 'pending', 'stale-version']);
const locator = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\s\u0000-\u001f\u007f]/u.test(value);

/** Capture an email credential once and synchronously remove it from browser history before any request. */
export function createOfferHttpTransport({ fetch: request = globalThis.fetch, location = globalThis.location,
  history = globalThis.history, allowInsecureLocalhost = false } = {}) {
  let entry; let token = null; let valid = false; let exchangeAttempted = false;
  try {
    entry = new URL(location.href);
    const fragment = new URLSearchParams(entry.hash.slice(1));
    const hasFragment = entry.hash.length > 0;
    const tokens = fragment.getAll('token');
    token = tokens.length === 1 ? tokens[0] : null;
    const fragmentValid = !hasFragment || tokens.length === 1 && [...fragment.keys()].length === 1 && locator(token);
    if (hasFragment) history.replaceState(null, '', `${entry.pathname}${entry.search}`);
    const offered = entry.searchParams.getAll('offerId'); const runs = entry.searchParams.getAll('runId');
    const queryValid = [...entry.searchParams.keys()].every((key) => ['offerId', 'runId'].includes(key))
      && offered.length === 1 && locator(offered[0]) && runs.length <= 1 && (!runs.length || locator(runs[0]));
    const secure = entry.protocol === 'https:' || allowInsecureLocalhost && entry.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(entry.hostname);
    valid = typeof request === 'function' && queryValid && fragmentValid && secure && (!token || runs.length === 1);
  } catch { valid = false; }
  if (!valid) token = null;
  const reference = valid ? Object.freeze({ offerId: entry.searchParams.get('offerId'), runId: entry.searchParams.get('runId') }) : null;
  const options = { credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' };

  async function call(path, init) {
    try {
      const response = await request(new URL(path, entry.origin).href, { ...options, ...init });
      const contentType = response.headers?.get('content-type') || '';
      if (!contentType.toLowerCase().includes('application/json')) return unavailable();
      const result = await response.json();
      if (!result || !statuses.has(result.status) || result.status === 'ok' && (!response.ok || !result.value)) return unavailable();
      return result;
    } catch { return unavailable(); }
  }

  return { reference,
    async read({ signal } = {}) {
      if (!valid) return { status: 'not-found' };
      if (token && !exchangeAttempted) {
        exchangeAttempted = true;
        let body;
        try {
          body = JSON.stringify({ ...reference, token });
          token = null;
          const result = await call('/api/gcsp/offers/access', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body, signal });
          return result.status === 'ok' ? result : { ...result, accessExchange: 'failed' };
        } finally { token = null; body = null; }
      }
      const query = reference.runId ? `?runId=${encodeURIComponent(reference.runId)}` : '';
      return call(`/api/gcsp/offers/${encodeURIComponent(reference.offerId)}${query}`, { method: 'GET', headers: { Accept: 'application/json' }, signal });
    } };
}

/** Bind the approved public DTO to the shared card without calculating policy or fabricating decisions. */
export function createOfferHttpAdapter({ project = toOfferPresentation, schedule = globalThis.setTimeout,
  cancel = globalThis.clearTimeout, refreshMs = 5000, ...options } = {}) {
  const transport = createOfferHttpTransport(options);
  if (typeof schedule !== 'function' || typeof cancel !== 'function' || !Number.isInteger(refreshMs)
    || refreshMs <= 0 || refreshMs > 2147483647) throw new TypeError('Supply a bounded refresh scheduler.');
  let busy = 0;
  return { async read(input) {
    ++busy;
    try {
      const outcome = await transport.read(input);
      if (outcome.status !== 'ok') return outcome;
      if (typeof project !== 'function') return unavailable();
      return await project(outcome, { reference: transport.reference });
    } catch { return unavailable(); }
    finally { --busy; }
  },
  subscribeClock(listener) {
    let alive = true; let timer;
    const next = () => {
      if (!alive) return;
      // This schedules a fresh server read; it never moves domain time or declares expiry.
      if (!busy) listener();
      if (alive) timer = schedule(next, refreshMs);
    };
    timer = schedule(next, refreshMs);
    return () => { alive = false; cancel(timer); };
  } };
}
