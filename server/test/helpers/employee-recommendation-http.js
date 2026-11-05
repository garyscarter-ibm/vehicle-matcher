import assert from 'node:assert/strict';
import { once } from 'node:events';
import { buildServer } from '../../index.js';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../../gcsp/repository/index.js';
import { createPolicyService } from '../../gcsp/policy/index.js';
import { DemoIdentityAdapter } from '../../gcsp/identity/index.js';

export const EMPLOYEE_ORIGIN = 'https://employee.test';
export const EMPLOYEE_INSTANT = '2026-11-05T12:00:00.000Z';
const initialRunId = 'employee-api-run-1';
const baseContext = (runId = initialRunId) => ({ environmentId: 'employee-api-test', runId,
  principalId: 'trusted-bootstrap', roles: [] });
const command = (commandId, value = {}) => ({ commandId, inputDigest: inputDigest(value) });

export function cookieOf(session) {
  return [session.value.setCookie].flat().map((cookie) => cookie.split(';')[0]).join('; ');
}

export async function startHttpServer(dependencies = {}, allowedOrigins = [EMPLOYEE_ORIGIN]) {
  const previousAccessKey = process.env.DEMO_ACCESS_KEY;
  delete process.env.DEMO_ACCESS_KEY;
  const server = buildServer({ gcspAllowedOrigins: allowedOrigins, ...dependencies });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const request = async (path, options = {}) => {
    const { body, headers = {}, session = null, origin = EMPLOYEE_ORIGIN,
      method = body === undefined ? 'GET' : 'POST' } = options;
    const requestHeaders = { ...(origin ? { Origin: origin } : {}),
      ...(session ? { cookie: cookieOf(session) } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers };
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: requestHeaders,
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    return { status: response.status, headers: response.headers,
      json: response.status === 204 ? null : await response.json() };
  };
  return {
    server,
    request,
    async close() {
      await new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      });
      if (previousAccessKey === undefined) delete process.env.DEMO_ACCESS_KEY;
      else process.env.DEMO_ACCESS_KEY = previousAccessKey;
    },
  };
}

export async function createEmployeeHttpFixture({ gcspRecommendations, gcspRoutes = [], retailDependencies = {} } = {}) {
  const store = createMemoryStore();
  let current = baseContext();
  let instant = EMPLOYEE_INSTANT;
  const policy = createPolicyService();
  const repository = createMemoryRepository({ store, now: () => instant });
  assert.equal((await repository.open()).status, 'ok');
  const active = await policy.getActiveVersion({ runId: current.runId, asOf: instant });
  assert.equal(active.status, 'ok');
  const addRun = async (runId) => {
    const scope = baseContext(runId);
    const result = await repository.transaction(scope, command(`run:${runId}`), (tx) => tx.insert('runs', {
      runId, environmentId: scope.environmentId, current: true, status: 'active', policyVersion: active.policyVersion,
    }));
    assert.equal(result.status, 'ok');
  };
  await addRun(current.runId);
  const identity = new DemoIdentityAdapter({ repository, policy,
    currentRun: () => ({ environmentId: current.environmentId, runId: current.runId }), sessionNow: () => instant });
  assert.equal((await identity.seedPrincipals()).status, 'ok');
  const presenter = await identity.createPresenterSession('employee-api-presenter');
  assert.equal(presenter.status, 'ok');
  let switchCount = 0;
  const acting = async (principalId) => {
    const session = await identity.switchPrincipal(presenter.value.context, principalId, `employee-api-switch-${++switchCount}`);
    assert.equal(session.status, 'ok');
    return session;
  };
  const paula = await acting('demo-paula');
  const greg = await acting('demo-greg');
  const http = await startHttpServer({ ...retailDependencies, gcspIdentity: identity,
    gcspRecommendations, gcspRoutes }, [EMPLOYEE_ORIGIN]);
  const request = (path, options = {}) => http.request(path, { session: paula, ...options });

  return {
    ...http, request, store, repository, policy, identity, presenter, paula, greg, acting,
    current: () => ({ environmentId: current.environmentId, runId: current.runId }),
    async resetRun() {
      const previous = current;
      const run = await repository.read(previous, { table: 'runs', key: { runId: previous.runId } });
      assert.equal(run.status, 'ok');
      const changed = await repository.transaction(previous, command(`historical:${previous.runId}`), (tx) => tx.compareAndSwap(
        { table: 'runs', key: { runId: previous.runId } }, run.value.version, { current: false, status: 'historical' }));
      assert.equal(changed.status, 'ok');
      current = baseContext(`${initialRunId}-2`);
      await addRun(current.runId);
    },
    async close() {
      await http.close();
      await repository.close();
    },
  };
}
