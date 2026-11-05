import { vehicleEvidenceFailure, vehicleEvidenceHttpStatus } from './vehicle-details-contract.js';

const PREFIX = '/api/gcsp/vehicle-evidence';
const kinds = { configurations: 'configuration', stock: 'stock', vins: 'vin' };
const rawPathOf = (url) => typeof url === 'string' ? url.split('?', 1)[0] : '';
export const isVehicleEvidencePath = (url) => rawPathOf(url) === PREFIX || rawPathOf(url).startsWith(`${PREFIX}/`);

/** Split the raw path first: standard Base64 may contain an encoded slash or plus. */
export function parseVehicleEvidencePath(url) {
  if (!isVehicleEvidencePath(url)) return { status: 'not-found', kind: null };
  const segments = rawPathOf(url).slice(PREFIX.length + 1).split('/');
  if (!Object.hasOwn(kinds, segments[0])) return { status: 'not-found', kind: null };
  const kind = kinds[segments[0]];
  if (segments.length !== 2 || !segments[1]) return { status: 'invalid-input', kind };
  try { return { status: 'ok', kind, id: decodeURIComponent(segments[1]) }; }
  catch { return { status: 'invalid-input', kind }; }
}

/** The caller supplies the existing shared gate result; stock also resolves trusted run context. */
export function createVehicleEvidenceHandler({ lookup, identity, resolveContext, allowedOrigins = [] } = {}) {
  const origins = new Set(allowedOrigins);
  return async ({ req, res, sendJson, corsHeaders = {}, gateAuthorized = true }) => {
    if (!isVehicleEvidencePath(req.url)) return false;
    const origin = req.headers.origin;
    const headers = { ...corsHeaders, 'Cache-Control': 'no-store', Vary: 'Origin',
      'Access-Control-Allow-Origin': origin && origins.has(origin) ? origin : 'null',
      ...(origin && origins.has(origin) ? { 'Access-Control-Allow-Credentials': 'true' } : {}) };
    const send = (code, body, extra = {}) => {
      sendJson(res, code, body, { ...headers, ...extra }); return true;
    };
    if (origin && !origins.has(origin)) return send(403, { error: 'Forbidden', reason: 'This origin is not allowed to use GCSP vehicle evidence.' });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS' }); res.end(); return true;
    }
    if (!gateAuthorized) return send(401, { error: 'Unauthorized' });
    const parsed = parseVehicleEvidencePath(req.url);
    if (parsed.status !== 'ok') return send(vehicleEvidenceHttpStatus(parsed), vehicleEvidenceFailure(parsed.status, parsed.kind));
    if (req.method !== 'GET') return send(405, { error: 'Method not allowed', allowedMethods: ['GET'] }, { Allow: 'GET' });
    // No query contract exists. In particular, browser flags cannot choose provider, identity kind, dataset or run.
    if (req.url.includes('?') && req.url.slice(req.url.indexOf('?') + 1)) {
      return send(400, vehicleEvidenceFailure('invalid-input', parsed.kind));
    }
    try {
      let context;
      if (parsed.kind === 'stock') {
        if (resolveContext) {
          const resolved = await resolveContext(req);
          if (resolved?.status !== 'ok') return send(503, vehicleEvidenceFailure('source-unavailable', parsed.kind));
          context = resolved.value;
        } else if (identity?.resolveSession) {
          const resolved = await identity.resolveSession({ authorized: true, cookie: req.headers.cookie, purpose: 'acting' });
          if (resolved?.status !== 'ok') {
            const code = ['missing-session', 'unknown-session', 'expired-session'].includes(resolved?.status) ? 401
              : ['stale-run', 'stale-version'].includes(resolved?.status) ? 409 : resolved?.status === 'forbidden' ? 403 : 503;
            return send(code, code === 401 ? { error: 'Unauthorized' } : vehicleEvidenceFailure(code === 409 ? 'identity-mismatch' : 'source-unavailable', parsed.kind));
          }
          context = resolved.value;
        }
      }
      const outcome = lookup?.resolve
        ? await lookup.resolve({ kind: parsed.kind, id: parsed.id }, { context })
        : vehicleEvidenceFailure('source-unavailable', parsed.kind);
      return send(vehicleEvidenceHttpStatus(outcome), outcome);
    } catch {
      return send(503, vehicleEvidenceFailure('source-unavailable', parsed.kind));
    }
  };
}
