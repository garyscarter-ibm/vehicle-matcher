import { OFFER_ACCESS_COOKIE } from './access.js';

const statusCode = (status) => ({ ok: 200, invalid: 400, 'missing-session': 401, 'unknown-session': 401,
  'expired-session': 401, forbidden: 403, 'unknown-principal': 404, 'not-found': 404,
  'stale-run': 409, conflict: 409, unavailable: 503 })[status] || 503;
const outcome = (status, reason) => ({ status, reason, contractVersion: '1.0.0' });
const invalid = () => outcome('invalid', 'Supply only the exact offer coordinates and a bounded JSON body.');

async function bodyOf(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw Error('Invalid body');
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    const data = Buffer.from(chunk); bytes += data.length;
    if (bytes > 16384) throw Error('Invalid body');
    chunks.push(data);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Invalid body');
  return body;
}

// Trusted host composition dispatches only these paths here, behind the shared gate.
// This boundary accepts a one-offer cookie, independently of the acting employee cookie.
export function createOfferAccessHandler({ service, identity, allowedOrigins = [] } = {}) {
  const configured = new Set(allowedOrigins.filter((origin) => {
    try { return /^https?:$/.test(new URL(origin).protocol) && new URL(origin).origin === origin; } catch { return false; }
  }));
  return async ({ req, res, pathname, searchParams = new URLSearchParams(), sendJson, gateAuthorized = true }) => {
    const origin = req.headers.origin;
    const originAllowed = origin ? configured.has(origin) : ['GET', 'HEAD'].includes(req.method);
    const headers = { 'Access-Control-Allow-Origin': originAllowed && origin ? origin : 'null',
      'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' };
    const send = (value) => {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
      return sendJson(res, statusCode(value.status), value, headers);
    };
    if (!originAllowed) return send(outcome('forbidden', 'This origin is not allowed to use GCSP.'));
    if (req.method === 'OPTIONS') {
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Demo-Key' }); return res.end();
    }
    if (!gateAuthorized) {
      res.setHeader('Cache-Control', 'no-store');
      return sendJson(res, 401, { error: 'Unauthorized' }, headers);
    }
    if (!service || !identity) return send(outcome('unavailable', 'Offer access has not been configured.'));
    try {
      if (req.method === 'POST' && pathname === '/api/gcsp/offers/access') {
        if ([...searchParams].length) return send(invalid());
        let body; try { body = await bodyOf(req); } catch { return send(invalid()); }
        if (Object.keys(body).some((key) => !['runId', 'offerId', 'token'].includes(key))) return send(invalid());
        const exchanged = await service.exchange(body);
        if (exchanged.status !== 'ok') return send(exchanged);
        res.setHeader('Set-Cookie', exchanged.value.setCookie);
        return send({ status: 'ok', value: exchanged.value.offer, contractVersion: exchanged.contractVersion });
      }
      const match = /^\/api\/gcsp\/offers\/([^/]+)$/.exec(pathname);
      if (req.method !== 'GET' || !match || match[1] === 'access') return send(outcome('not-found', 'Offer not found.'));
      if ([...searchParams.keys()].some((key) => key !== 'runId') || searchParams.getAll('runId').length > 1) return send(invalid());
      const selector = { offerId: decodeURIComponent(match[1]), ...(searchParams.has('runId') ? { runId: searchParams.get('runId') } : {}) };
      const hasCookie = typeof req.headers.cookie === 'string' && req.headers.cookie.split(';').some((part) => part.trim().startsWith(`${OFFER_ACCESS_COOKIE}=`));
      let read;
      if (hasCookie) read = await service.fromSession(selector, req.headers.cookie);
      else {
        const resolved = await identity.resolveSession({ authorized: true, cookie: req.headers.cookie });
        if (resolved.status !== 'ok') return send(resolved);
        read = await service.fromAccount(resolved.value, selector);
      }
      return send(read.status === 'ok' ? { status: 'ok', value: read.value.offer, contractVersion: read.contractVersion } : read);
    } catch {
      // Deliberately discard URL/body/parser/provider exception text and credentials.
      return send(outcome('unavailable', 'Offer access is unavailable.'));
    }
  };
}
