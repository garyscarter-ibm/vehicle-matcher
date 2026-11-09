// FUCQ-126 / FUCQ-140: a presenter switch or reset must leave the acting employee with a ready account.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { buildServer } from '../index.js';

const origin = 'https://demo.invalid';
const good = (result) => { assert.equal(result.status, 'ok', JSON.stringify(result)); return result.value; };
const cookie = (value) => [value].flat().map((v) => v.split(';')[0]).join('; ');
async function request(server, path, { body, session } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { url: path, method: body === undefined ? 'GET' : 'POST',
    headers: { host: 'demo.invalid', origin, ...(session ? { cookie: session } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) } });
  const response = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(status, values) { this.status = status; for (const [k, v] of Object.entries(values)) this.setHeader(k, v); },
    end(text) { this.body = text; } };
  await server.listeners('request')[0](req, response);
  return { ...response, json: response.body ? JSON.parse(response.body) : null };
}

test('presenter switch and reset prepare each employee account from the server-issued context only', async (t) => {
  const opened = good(await createGcspRuntime({ mode: 'memory', environmentId: 'presenter-principal-account',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  t.after(() => opened.close());
  const server = buildServer({ ...opened.dependencies, gcspAllowedOrigins: [origin] });
  good(await server.gcspStartup);
  const presenter = good(await opened.identity.createPresenterSession('principal-account-presenter'));
  let presenterCookie = cookie(presenter.setCookie);
  const account = (session) => request(server, '/api/gcsp/manual/account', { session });
  const ready = async (session) => {
    const reply = await account(session);
    assert.equal(reply.status, 200, reply.body); assert.equal(reply.json.status, 'ok');
    assert.notEqual(reply.json.value.state, 'absent-hr-account', reply.body); assert.ok(reply.json.value.account, reply.body);
    return reply;
  };
  const switchTo = async (principalId, commandId) => {
    const reply = await request(server, '/api/gcsp/session/switch', { session: presenterCookie, body: { principalId, commandId } });
    return { reply, session: reply.headers['set-cookie'] ? cookie(reply.headers['set-cookie']) : null };
  };

  const alex = await switchTo('demo-alex', 'switch-alex-1');
  assert.equal(alex.reply.status, 200, alex.reply.body);
  const alexAccount = await ready(alex.session);
  // A repeated command is refused by identity (no new cookie) and the first session still reads the same account.
  const replay = await switchTo('demo-alex', 'switch-alex-1');
  assert.equal(replay.reply.status, 409); assert.equal(replay.session, null);
  assert.deepEqual((await account(alex.session)).json, alexAccount.json);
  // A fresh switch back re-runs preparation as a replay no-op and leaves the account untouched.
  const alexAgain = await switchTo('demo-alex', 'switch-alex-2');
  assert.deepEqual((await account(alexAgain.session)).json, alexAccount.json);

  const greg = await switchTo('demo-greg', 'switch-greg-1');
  assert.equal(greg.reply.status, 200);
  assert.equal((await account(greg.session)).status, 403);

  // Browser-supplied identity is still refused on both the switch body and the account query.
  const forged = await request(server, '/api/gcsp/session/switch', { session: presenterCookie,
    body: { principalId: 'demo-sam', commandId: 'forged', employeeId: 'demo-sam' } });
  assert.equal(forged.status, 400); assert.equal(forged.json.code, 'browser-context-forbidden');
  const query = await request(server, '/api/gcsp/manual/account?employeeId=demo-sam', { session: alex.session });
  assert.equal(query.status, 400); assert.equal(query.json.code, 'browser-context-forbidden');
  // The refused attempt prepared nothing for Sam: Sam is only prepared by a real switch.
  const samRow = good(await opened.repository.query(presenter.context, 'employees')).find((row) => row.employeeId.includes('sam'));
  assert.equal(samRow.contract?.manualContext, undefined);

  const catalogue = good(await opened.scenarios.readCatalogue(presenter.context));
  const scenario = catalogue.scenarios.find((s) => s.kind === 'mechanics');
  const state = good(await opened.scenarios.readState(presenter.context));
  const reset = await request(server, '/api/gcsp/presenter/scenarios/reset', { session: presenterCookie, body: { commandId: 'principal-reset',
    expectedRunId: state.runId, expectedRunVersion: state.runVersion, scenarioId: scenario.scenarioId,
    scenarioVersion: scenario.scenarioVersion, fixtureVersion: scenario.fixtureVersion, policyVersion: scenario.policyVersion } });
  assert.equal(reset.status, 200, reset.body); assert.notEqual(reset.json.value.runId, state.runId);
  assert.equal((await account(alex.session)).status, 409);
  presenterCookie = cookie(reset.headers['set-cookie']);

  for (const [name, principalId] of [['paula', 'demo-paula'], ['sam', 'demo-sam']]) {
    const next = await switchTo(principalId, `switch-${name}-new-run`);
    assert.equal(next.reply.status, 200, next.reply.body);
    assert.equal(next.reply.json.value.runId, reset.json.value.runId);
    await ready(next.session);
  }
  // FUCQ-224: Jordan has no current car, so the account offers a new order and no replacement.
  const jordan = await switchTo('demo-jordan', 'switch-jordan-new-run');
  assert.equal(jordan.reply.status, 200, jordan.reply.body);
  const fresh = (await ready(jordan.session)).json.value;
  assert.equal(fresh.currentContract, null); assert.equal(fresh.contractState, 'no-contract');
  assert.deepEqual(fresh.actions.map((a) => a.action), ['order']);
  const rows = good(await opened.repository.query({ ...presenter.context, runId: reset.json.value.runId }, 'employees'));
  assert.equal(rows.filter((row) => row.contract?.manualContext).length, 3);
});
