const unavailable = () => ({ status: 'unavailable', reason: 'Order requests are unavailable. Retry the same action.' });

export function createGregOrdersHttpAdapter({ base = '', fetchImpl = globalThis.fetch } = {}) {
  async function call(path, method, body, { signal } = {}) {
    try {
      const response = await fetchImpl(`${base}${path}`, { method, credentials: 'include', signal,
        headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
      const out = await response.json();
      return ['ok', 'invalid', 'unavailable', 'conflict', 'stale-version', 'stale-run', 'forbidden',
        'missing-session', 'unknown-session', 'expired-session', 'not-found'].includes(out?.status) ? out : unavailable();
    } catch (error) { if (signal?.aborted) throw error; return unavailable(); }
  }
  return Object.freeze({
    loadTracking: (options) => call('/api/gcsp/greg/orders', 'GET', null, options),
    submit: (input, options) => call('/api/gcsp/greg/orders', 'POST', input, options),
    stepProduction: (input, options) => call('/api/gcsp/presenter/production', 'POST', input, options),
    queueConfirmed: (input, options) => call('/api/gcsp/greg/orders/queue', 'POST', input, options),
  });
}
