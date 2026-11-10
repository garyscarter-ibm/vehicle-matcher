import { PRESENTER_COOKIE } from './index.js';
import { withVehicleDisplayImages } from '../vehicle-evidence/display-projection.js';
import { randomUUID } from 'node:crypto';
const protectedFields = new Set(['principalId', 'employeeId', 'roles', 'role', 'grade', 'gradeId', 'scheme', 'schemeId', 'companyId', 'runId', 'context', 'entitlementSlotId', 'token', 'session', 'sessionId']);
const hasCookie = (header, name) => typeof header === 'string' && header.split(';').some((part) => part.trim().startsWith(`${name}=`));
const statusCode = (status) => ({
  ok: 200, pending: 202, invalid: 400, 'missing-session': 401, 'unknown-session': 401,
  'expired-session': 401, 'invalid-credentials': 401, 'unknown-principal': 404, forbidden: 403,
  'stale-run': 409, 'stale-version': 409, conflict: 409, 'not-found': 404, unavailable: 503,
})[status] || 500;

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new Error('body-too-large');
    chunks.push(chunk);
  }
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid-body');
  return body;
}

// All registered GCSP consumers enter through this context boundary, behind the shared gate.
export function createGcspHandler({ identity, routes = [], allowedOrigins = [], prepareEmployee } = {}) {
  const configured = new Set(allowedOrigins.filter((origin) => {
    try { return /^https?:$/.test(new URL(origin).protocol) && new URL(origin).origin === origin; } catch { return false; }
  }));
  return async ({ req, res, pathname, searchParams, sendJson, corsHeaders, gateAuthorized = true }) => {
    const origin = req.headers.origin;
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const originAllowed = origin ? configured.has(origin) : !unsafe;
    const credentialHeaders = {
      'Access-Control-Allow-Origin': originAllowed && origin ? origin : 'null',
      'Access-Control-Allow-Credentials': 'true', Vary: 'Origin',
    };
    const send = async (outcome, code = statusCode(outcome.status)) => {
      res.setHeader('Cache-Control', 'no-store');
      return sendJson(res, code, await withVehicleDisplayImages(outcome), credentialHeaders);
    };
    if (!originAllowed) return send({ status: 'forbidden', reason: 'This origin is not allowed to use GCSP.', contractVersion: '1.0.0' });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...corsHeaders, ...credentialHeaders });
      return res.end();
    }
    if (!gateAuthorized) {
      res.setHeader('Cache-Control', 'no-store');
      return sendJson(res, 401, { error: 'Unauthorized' }, credentialHeaders);
    }
    if (!identity) return send({ status: 'unavailable', reason: 'GCSP identity has not been configured.', retryable: true, contractVersion: '1.0.0' });
    try {
      if (req.method === 'POST' && ['/api/gcsp/session/login', '/api/gcsp/session/logout'].includes(pathname)) {
        const login = pathname.endsWith('/login');
        let body;
        try { body = await readBody(req); } catch {
          return send({ status: 'invalid', code: 'invalid-request', reasons: [{ field: 'body', reason: 'Supply a JSON object of at most 16 KiB.' }], contractVersion: '1.0.0' });
        }
        if (searchParams.size || Object.keys(body).some((key) => !(login ? ['email', 'password'] : []).includes(key))) {
          return send({ status: 'invalid', code: 'unknown-field', reasons: [{ field: 'body', reason: login ? 'Supply only email and password.' : 'Supply an empty object.' }], contractVersion: '1.0.0' });
        }
        const outcome = login ? await identity.signIn(body, randomUUID()) : await identity.signOut({ cookie: req.headers.cookie });
        if (outcome.status !== 'ok') return send(outcome);
        if (login && prepareEmployee && outcome.value.context.roles.includes('employee')) {
          const prepared = await prepareEmployee(outcome.value.context);
          if (prepared.status !== 'ok') return send(prepared);
        }
        res.setHeader('Set-Cookie', outcome.value.setCookie);
        return send({ status: 'ok', ...(login ? { value: { context: outcome.value.context, redirectTo: outcome.value.redirectTo } } : {}), contractVersion: outcome.contractVersion });
      }
      const route = routes.find((entry) => entry.method === req.method && entry.path === pathname);
      const switching = req.method === 'POST' && pathname === '/api/gcsp/session/switch';
      let resolved = await identity.resolveSession({ authorized: true, cookie: req.headers.cookie, purpose: switching ? 'presenter-control' : route?.purpose || 'acting' });
      // Presenter entry has its own control cookie and never grants an employee session.
      if (resolved.status === 'missing-session' && req.method === 'GET' && pathname === '/api/gcsp/context'
        && hasCookie(req.headers.cookie, PRESENTER_COOKIE)) {
        resolved = await identity.resolveSession({ authorized: true, cookie: req.headers.cookie, purpose: 'presenter-control' });
      }
      if (resolved.status === 'stale-run' && route?.resetReplay) {
        resolved = await identity.resolveSession({ authorized: true, cookie: req.headers.cookie, purpose: 'reset-replay' });
      }
      if (resolved.status === 'missing-session' && (switching || route?.purpose === 'presenter-control')) return send({ status: 'forbidden', reason: 'A presenter control session is required.', contractVersion: '1.0.0' });
      if (resolved.status !== 'ok') return send(resolved);
      if (!resolved.value?.principalId || !resolved.value?.runId || !resolved.value?.environmentId
        || !Array.isArray(resolved.value?.roles) || !resolved.value.roles.every((role) => typeof role === 'string')) {
        return send({ status: 'forbidden', reason: 'A server-owned context is required.', contractVersion: '1.0.0' });
      }
      const context = resolved.value;
      let body;
      try { body = req.method === 'POST' ? await readBody(req) : {}; } catch {
        return send({ status: 'invalid', code: 'invalid-request', reasons: [{ field: 'body', reason: 'Supply a JSON object of at most 16 KiB.' }], contractVersion: '1.0.0' });
      }
      // A route may explicitly discard untrusted browser context claims. It still receives
      // only the resolved server context; existing routes retain their strict rejection.
      if (route?.browserContext === 'ignore') {
        body = Object.fromEntries(Object.entries(body).filter(([key]) => !protectedFields.has(key)));
        searchParams = new URLSearchParams([...searchParams].filter(([key]) => !protectedFields.has(key)));
      }
      if ([...searchParams.keys()].some((key) => protectedFields.has(key))
        || Object.keys(body).some((key) => protectedFields.has(key) && !(switching && key === 'principalId'))) {
        return send({ status: 'invalid', code: 'browser-context-forbidden', reasons: [{ field: 'context', reason: 'Identity and run context are server-owned.' }], contractVersion: '1.0.0' });
      }
      // presenterControl says only whether a presenter cookie was sent; presenter routes still check authority.
      if (req.method === 'GET' && pathname === '/api/gcsp/context') return send({ ...resolved, presenterControl: hasCookie(req.headers.cookie, PRESENTER_COOKIE) });
      if (switching) {
        if (Object.keys(body).some((key) => !['principalId', 'commandId'].includes(key))) return send({ status: 'invalid', code: 'unknown-field', reasons: [{ field: 'body', reason: 'Supply only principalId and commandId.' }], contractVersion: '1.0.0' });
        const presenter = await identity.resolveSession({ authorized: true, cookie: req.headers.cookie, purpose: 'presenter-control' });
        if (presenter.status !== 'ok') return send(presenter.status === 'missing-session'
          ? { status: 'forbidden', reason: 'A presenter control session is required.', contractVersion: '1.0.0' } : presenter);
        const switched = await identity.switchPrincipal(presenter.value, body.principalId, body.commandId);
        if (switched.status !== 'ok') return send(switched);
        // Only an employee context the server just issued is prepared; Greg and presenter switches seed nothing.
        if (prepareEmployee && switched.value.context.roles.includes('employee')) {
          const prepared = await prepareEmployee(switched.value.context);
          if (prepared.status !== 'ok') return send(prepared);
        }
        res.setHeader('Set-Cookie', switched.value.setCookie);
        return send({ status: 'ok', value: switched.value.context, contractVersion: switched.contractVersion });
      }
      if (!route) return send({ status: 'not-found', resourceType: 'route', contractVersion: '1.0.0' });
      if (route.role && !(route.resetReplay && resolved.value.roles.includes('presenter'))) {
        const allowed = await identity.requireRole(context, route.role);
        if (allowed.status !== 'ok') return send(allowed);
      }
      if (route.resource) {
        const allowed = await identity.authorizeResource(context, await route.resource({ context, body, searchParams }), route.action || 'read');
        if (allowed.status !== 'ok') return send(allowed);
      }
      const outcome = await route.handle({ context, body, searchParams, identity,
        setCookie: (cookies) => res.setHeader('Set-Cookie', cookies) });
      // A route that reads something not yet created answers 200 with the unchanged not-found envelope.
      return send(outcome, route.absentIs200 && outcome.status === 'not-found' ? 200 : undefined);
    } catch {
      // Never include request URLs, cookies or parser exception text in responses or logs.
      return send({ status: 'unavailable', reason: 'GCSP service is unavailable.', retryable: true, contractVersion: '1.0.0' });
    }
  };
}
