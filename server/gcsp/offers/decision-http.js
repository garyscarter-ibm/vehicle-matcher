import { result } from '../repository/index.js';

const code = (status) => ({ ok: 200, pending: 202, invalid: 400,
  'missing-session': 401, 'unknown-session': 401, 'expired-session': 401,
  forbidden: 403, 'not-found': 404, 'unknown-principal': 404,
  conflict: 409, 'stale-version': 409, 'stale-run': 409, unavailable: 503 })[status] ?? 503;
const invalid = () => result('invalid', { code: 'invalid-offer-decision-request',
  reasons: [{ field: 'request', reason: 'Supply the exact offer coordinates and a bounded JSON body.' }] });
const unavailable = () => result('unavailable', { code: 'offer-decision-unavailable',
  reason: 'Offer decisions are temporarily unavailable.', retryable: true });
const fields = ['commandId', 'runId', 'decision', 'reasonCode',
  'expectedOfferVersion', 'expectedHoldVersion', 'expectedQuoteVersion'];

async function bodyOf(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw Error('Invalid body');
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    const value = Buffer.from(chunk); bytes += value.length;
    if (bytes > 16384) throw Error('Invalid body');
    chunks.push(value);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !fields.includes(key))) throw Error('Invalid body');
  return body;
}

// Trusted composition supplies the actual FUCQ-102 resolver. It must fail closed
// on a presented invalid offer cookie before considering account access.
export function createOfferDecisionHandler({ service, resolveAccess, allowedOrigins = [] } = {}) {
  const origins = new Set(allowedOrigins.filter((origin) => {
    try { return /^https?:$/.test(new URL(origin).protocol) && new URL(origin).origin === origin; } catch { return false; }
  }));
  return async ({ req, res, pathname, searchParams = new URLSearchParams(), sendJson, gateAuthorized = false }) => {
    const origin = req.headers.origin;
    const allowed = origin ? origins.has(origin) : req.method === 'GET';
    const headers = { 'Access-Control-Allow-Origin': allowed && origin ? origin : 'null',
      'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' };
    const send = (value) => {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
      return sendJson(res, code(value.status), value, headers);
    };
    if (!allowed) return send(result('forbidden', { reason: 'This origin is not allowed to use GCSP.' }));
    if (req.method === 'OPTIONS') {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
      res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Access-Key' }); return res.end();
    }
    if (gateAuthorized !== true) {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
      return sendJson(res, 401, { error: 'Unauthorized' }, headers);
    }
    if (!service || typeof resolveAccess !== 'function') return send(unavailable());
    try {
      const match = /^\/api\/gcsp\/offers\/([^/]+)\/(decision|decision-reasons)$/.exec(pathname);
      if (!match || match[1] === 'access') return send(result('not-found', { resourceType: 'offer-decision' }));
      const offerId = decodeURIComponent(match[1]);
      if (!offerId || offerId.length > 128 || offerId.includes('/') || offerId.includes('\\')) return send(invalid());
      const deciding = match[2] === 'decision';
      if (req.method !== (deciding ? 'POST' : 'GET')) return send(result('not-found', { resourceType: 'offer-decision' }));
      let input;
      if (deciding) {
        if ([...searchParams].length) return send(invalid());
        try { input = { ...await bodyOf(req), offerId }; } catch { return send(invalid()); }
      } else {
        if ([...searchParams.keys()].some((k) => k !== 'runId') || searchParams.getAll('runId').length !== 1) return send(invalid());
        input = { runId: searchParams.get('runId'), offerId };
      }
      if (typeof input.runId !== 'string' || !input.runId.trim() || input.runId.length > 128) return send(invalid());
      const selector = { runId: input.runId, offerId };
      const access = await resolveAccess({ selector, cookie: req.headers.cookie, action: deciding ? 'decide' : 'read' });
      if (access?.status !== 'ok') return send(access ?? unavailable());
      return send(await service[deciding ? 'decide' : 'readReasons'](access.value.context, input));
    } catch {
      // Never return parser/provider text, cookie values or internal employee data.
      return send(unavailable());
    }
  };
}
