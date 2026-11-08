// FUCQ-102 HTTP and safe display contract reviewed at ec70522.
import { toOfferPresentation } from './offer-projection.js';
const unavailable = () => ({ status: 'unavailable', retryable: true });
const statuses = new Set(['ok', 'not-found', 'stale-run', 'forbidden', 'unavailable', 'invalid', 'conflict', 'pending', 'stale-version']);
const locator = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\s\u0000-\u001f\u007f]/u.test(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const object = (value) => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const hasOnlyKeys = (value, keys) => object(value) && Reflect.ownKeys(value).every((key) => keys.includes(key));

/** Copy only the server's fixed reason registry; there is no consumer fallback list. */
function reasons(outcome) {
  const value = outcome?.value;
  if (outcome?.status !== 'ok') return { status: statuses.has(outcome?.status) ? outcome.status : 'unavailable' };
  if (!object(value) || value.schemaVersion !== 1 || value.key !== 'offer.declineReasons.v1' || !text(value.policyVersion)
    || !Array.isArray(value.reasons) || !value.reasons.length || value.reasons.length > 128
    || value.reasons.some((row) => !object(row) || !['code', 'label', 'attribute'].every((key) => text(row[key])))
    || new Set(value.reasons.map((row) => row.code)).size !== value.reasons.length) return unavailable();
  return { status: 'ok', value: { schemaVersion: 1, key: value.key, policyVersion: value.policyVersion,
    reasons: value.reasons.map(({ code, label, attribute }) => ({ code, label, attribute })) } };
}

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

  const bound = (offer) => valid && !token && text(offer?.offerId) && text(offer?.runId)
    && offer.offerId === reference.offerId && (!reference.runId || offer.runId === reference.runId);

  return { reference,
    async readReasons({ offer } = {}, { signal } = {}) {
      if (!bound(offer)) return { status: 'not-found' };
      return reasons(await call(`/api/gcsp/offers/${encodeURIComponent(offer.offerId)}/decision-reasons?runId=${encodeURIComponent(offer.runId)}`,
        { method: 'GET', headers: { Accept: 'application/json' }, signal }));
    },
    async decide(input, { signal } = {}) {
      const offer = input?.offer;
      const ids = input?.kind === 'accept' && object(input.declarations) ? Object.keys(input.declarations) : [];
      if (!hasOnlyKeys(input, ['kind', 'offer', 'commandId', 'reasonCode', 'termsDigest', 'declarations']) || !bound(offer)
        || !hasOnlyKeys(offer, ['offerId', 'runId', 'offerVersion', 'holdVersion', 'quoteVersion'])
        || !['accept', 'decline'].includes(input.kind) || !text(input.commandId)
        || !['offerVersion', 'holdVersion', 'quoteVersion'].every((key) => positive(offer[key]))
        || (input.kind === 'decline' ? !text(input.reasonCode) || Object.hasOwn(input, 'termsDigest') || Object.hasOwn(input, 'declarations')
          : Object.hasOwn(input, 'reasonCode') || !text(input.termsDigest) || !ids.length || !ids.every((id) => text(id) && input.declarations[id] === true))) return { status: 'invalid' };
      const body = { commandId: input.commandId, runId: offer.runId, decision: input.kind,
        expectedOfferVersion: offer.offerVersion, expectedHoldVersion: offer.holdVersion, expectedQuoteVersion: offer.quoteVersion,
        ...(input.kind === 'decline' ? { reasonCode: input.reasonCode } : { termsDigest: input.termsDigest, declarations: { ...input.declarations } }) };
      return call(`/api/gcsp/offers/${encodeURIComponent(offer.offerId)}/decision`, { method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    },
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
  cancel = globalThis.clearTimeout, refreshMs = 5000, enableDecisions = false, ...options } = {}) {
  const transport = createOfferHttpTransport(options);
  if (typeof schedule !== 'function' || typeof cancel !== 'function' || !Number.isInteger(refreshMs)
    || refreshMs <= 0 || refreshMs > 2147483647) throw new TypeError('Supply a bounded refresh scheduler.');
  let busy = 0;
  const decisionPorts = enableDecisions === true ? {
    async readReasons(...args) { ++busy; try { return await transport.readReasons(...args); } finally { --busy; } },
    async decide(...args) { ++busy; try { return await transport.decide(...args); } finally { --busy; } },
  } : {};
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
  ...decisionPorts,
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
