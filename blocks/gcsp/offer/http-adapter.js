// FUCQ-102 transport proposal 9c124e7. Nested DTO projection is deliberately injected until reviewed.
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
          return await call('/api/gcsp/offers/access', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body, signal });
        } finally { token = null; body = null; }
      }
      const query = reference.runId ? `?runId=${encodeURIComponent(reference.runId)}` : '';
      return call(`/api/gcsp/offers/${encodeURIComponent(reference.offerId)}${query}`, { method: 'GET', headers: { Accept: 'application/json' }, signal });
    } };
}

/** Binding a safe display DTO needs the separately reviewed nested projection. No inferred success. */
export function createOfferHttpAdapter({ project, ...options } = {}) {
  const transport = createOfferHttpTransport(options);
  return { async read(input) {
    const outcome = await transport.read(input);
    if (outcome.status !== 'ok') return outcome;
    if (typeof project !== 'function') return unavailable();
    try { return project(outcome); } catch { return unavailable(); }
  } };
}
