import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createMemoryRepository, createMemoryStore, inputDigest, ok, result } from '../gcsp/repository/index.js';
import { createPolicyService, PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { BriefService } from '../gcsp/brief/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { NotificationDispatcher } from '../gcsp/notify/index.js';
import { createGcspHandler } from '../gcsp/identity/http.js';
import { preference, essential, stock, providerValue, fact } from './helpers/employee-recommendation.js';
const implementation = await import('../gcsp/cases/index.js').catch(() => ({}));
const routes = await import('../gcsp/cases/http.js').catch(() => ({}));
test('RenewalCaseService provides the owned repository-backed service and routes', () => {
  assert.equal(typeof implementation.RenewalCaseService, 'function');
  assert.equal(typeof routes.createCaseRoutes, 'function');
});
const caseTest = (name, work) => test(name, { skip: !implementation.RenewalCaseService, timeout: 5000 }, work);
const cmd = (commandId) => ({ commandId, inputDigest: inputDigest(commandId) });
async function setup(t, { policy = createPolicyService(), failQueue = false } = {}) {
  const store = createMemoryStore();
  const repository = createMemoryRepository({ store }); await repository.open();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'case-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const paula = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const alex = await identity.switchPrincipal(presenter.value.context, 'demo-alex', 'alex');
  const greg = await identity.switchPrincipal(presenter.value.context, 'demo-greg', 'greg');
  const context = paula.value.context;
  assert.equal((await seedManualDemoContext({ repository, identity, clock, context })).status, 'ok');
  assert.equal((await seedManualDemoContext({ repository, identity, clock, context: alex.value.context })).status, 'ok');
  const port = failQueue ? { ...repository, transaction(c, command, work) { return repository.transaction(c, command,
    (tx) => work({ ...tx, enqueueNotification: async () => result('unavailable', { reason: 'synthetic-queue-failure' }) })); } } : repository;
  const brief = new BriefService({ repository, policy, clock, identity });
  const service = new implementation.RenewalCaseService({ repository: port, policy, clock, identity, brief });
  t.after(() => repository.close());
  return { repository, store, policy, clock, identity, presenter, paula, alex, greg, context, brief, service };
}
async function employee(f, patch) {
  return f.repository.transaction(f.context, cmd('employee:'+inputDigest(patch)), async (tx) => {
    const ref = { table: 'employees', key: { runId: f.context.runId, employeeId: f.context.employeeId } };
    const found = await tx.get(ref); return tx.compareAndSwap(ref, found.value.version, patch);
  });
}
const request = (f, commandId = 'help', reason = 'My replacement may miss my contract end.') => f.service.requestHelp(f.context, { commandId, reason });
const update = (f, c, status, extra = {}) => f.service.update(f.greg.value.context, { commandId: `update-${c.version}-${status}`,
  caseId: c.caseId, expectedVersion: c.version, status, reason: 'Scheme team reviewed the renewal.', nextAction: 'Review options with Paula.', dueAt: '2026-11-06T12:00:00.000Z', ...extra });
async function event(f, id, type, extra = {}) {
  const employeeId = f.context.employeeId;
  return f.repository.transaction(f.context, cmd('event:'+id), (tx) => tx.recordReceipt({ consumerId: 'fixture:lifecycle', eventId: id,
    eventType: type, inputDigest: inputDigest(id), state: 'completed', outcome: ok({ employeeId, renewalId: `renewal:${employeeId}`,
      orderUuid: 'order-fixture', occurredAt: '2026-11-05T08:00:00.000Z', ...extra }) }));
}
const tick = (f, eventId) => f.clock.tick(f.presenter.value.context, { eventId, expectedClockVersion: '1', inputDigest: inputDigest(eventId) });
async function withPolicy(changes) {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  for (const [key, value] of Object.entries(changes)) { const row = seed.assumptions.find((a) => a.key === key); assert.ok(row, key); row.value = value; }
  return new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
}
async function confirmedBrief(f) {
  const data = { schemaVersion: 1, preferences: { body: preference('estate'), comfort: preference(75, 0) },
    essentials: { seats: essential(5), charging: { value: null, operator: 'equals', unit: null, state: 'needs-confirmation', source: 'employee' } } };
  assert.equal((await f.brief.saveDraft(f.context, { commandId: 'draft', expectedBriefVersion: 0, expectedDraftVersion: 0, brief: data })).status, 'ok');
  const confirmed = await f.brief.confirm(f.context, { commandId: 'confirm', expectedBriefVersion: 0, expectedDraftVersion: 1, consent: { search: true, hold: true } });
  assert.equal(confirmed.status, 'ok'); return confirmed.value.brief;
}
caseTest('reading help and the employee case read model creates no case or audit write', async (t) => {
  const f = await setup(t); const before = structuredClone(f.store.state);
  const help = await f.service.readHelp(f.context); assert.equal(help.status, 'ok', JSON.stringify(help));
  assert.equal(help.value.opensCase, false); assert.equal(help.value.extensionPermitted, false);
  assert.deepEqual((await f.service.readOwn(f.context)).value.cases, []);
  assert.deepEqual(f.store.state, before);
});
caseTest('request opens an owned dated case; repeat appends to it; replay and concurrent requests duplicate nothing', async (t) => {
  const f = await setup(t); const first = await request(f); assert.equal(first.status, 'ok', JSON.stringify(first));
  const c = first.value.case;
  assert.equal(c.owner.role, 'scheme-team'); assert.equal(c.status, 'open'); assert.equal(c.renewalId, `renewal:${f.context.employeeId}`);
  assert.equal(c.dueAt, '2026-11-06T09:00:00.000Z'); assert.equal(c.history[0].at, '2026-11-05T09:00:00.000Z');
  assert.equal(c.history[0].actorId, f.context.principalId); assert.match(c.history[0].reason, /contract/);
  assert.deepEqual(await request(f), first);
  const other = await Promise.all([request(f, 'second'), request(f, 'third')]);
  assert.ok(other.every((o) => o.status === 'ok')); assert.ok(other.every((o) => o.value.case.caseId === c.caseId));
  assert.equal((await f.service.readOwn(f.context)).value.cases[0].history.length, 3);
  assert.equal((await f.repository.query(f.context, 'notification_outbox')).value.length, 3);
  assert.equal((await request(f, 'help', 'Changed replay input.')).status, 'conflict');
});
caseTest('deadline trigger is policy keyed, acknowledged selection suppresses it, and tick replay is idempotent', async (t) => {
  const f = await setup(t); await employee(f, { contract: { contractEndDate: '2026-11-12' } });
  assert.equal((await f.service.start()).status, 'ok'); const first = await tick(f, 'deadline');
  assert.equal(first.status, 'ok', JSON.stringify(first)); assert.ok(first.value.handlerOrder.some((h) => h.handlerId === 'renewal-risk-cases'));
  const cases = (await f.service.readOwn(f.context)).value.cases; assert.equal(cases.length, 1); assert.equal(cases[0].trigger.type, 'renewal-deadline');
  const snapshot = structuredClone(f.store.state); assert.deepEqual(await tick(f, 'deadline'), first); assert.deepEqual(f.store.state, snapshot);
  await tick(f, 'different-tick'); assert.equal((await f.service.readOwn(f.context)).value.cases[0].history.length, 1);
  const g = await setup(t); await employee(g, { contract: { contractEndDate: '2026-11-12' } }); await event(g, 'selected', 'selection-acknowledged');
  await g.service.start(); await tick(g, 'selected'); assert.equal((await g.service.readOwn(g.context)).value.cases.length, 0);
  const h = await setup(t, { policy: await withPolicy({ 'renewalCase.deadline.withinDays': 2 }) });
  await employee(h, { contract: { contractEndDate: '2026-11-12' } }); await h.service.start(); await tick(h, 'too-early');
  assert.equal((await h.service.readOwn(h.context)).value.cases.length, 0);
});
caseTest('keyed lifecycle event types open once, reject foreign renewal/employee events, and ignore invented producers', async (t) => {
  const f = await setup(t); await event(f, 'declined', 'approval-declined'); await event(f, 'foreign', 'appointment-no-show', { employeeId: 'another' });
  await event(f, 'wrong-renewal', 'appointment-no-show', { renewalId: 'previous' }); await event(f, 'unconfigured', 'made-up-exception');
  await f.service.start(); assert.equal((await tick(f, 'exceptions')).status, 'ok');
  assert.equal((await f.service.readOwn(f.context)).value.cases[0].history.length, 1);
  await tick(f, 'again'); assert.equal((await f.service.readOwn(f.context)).value.cases[0].history.length, 1);
  const g = await setup(t, { policy: await withPolicy({ 'renewalCase.lifecycle.eventTypes': ['custom-reviewed-event'] }) });
  await event(g, 'old', 'approval-declined'); await g.service.start(); await tick(g, 'old');
  assert.equal((await g.service.readOwn(g.context)).value.cases.length, 0);
  await event(g, 'custom', 'custom-reviewed-event'); await tick(g, 'custom');
  assert.equal((await g.service.readOwn(g.context)).value.cases.length, 1);
});
caseTest('unknown actual contract dates stay unknown and no deadline case is invented', async (t) => {
  const f = await setup(t); await employee(f, { contract: {} }); await f.service.start(); await tick(f, 'unknown');
  assert.equal((await f.service.readOwn(f.context)).value.cases.length, 0);
  const c = (await request(f)).value.case; assert.equal(c.renewalDeadline, null); assert.equal(c.renewalDeadlineState, 'needs-confirmation');
});
caseTest('scheme-team validates transitions, actor history, due dates and stale writes; employees cannot record remedies', async (t) => {
  const f = await setup(t); const c = (await request(f)).value.case;
  assert.equal((await f.service.update(f.context, { caseId: c.caseId })).status, 'forbidden');
  assert.equal((await update(f, c, 'resolved')).status, 'invalid');
  const progress = await update(f, c, 'in-progress'); assert.equal(progress.status, 'ok', JSON.stringify(progress));
  assert.equal(progress.value.case.history.at(-1).actorId, f.greg.value.context.principalId);
  assert.equal((await update(f, c, 'in-progress', { commandId: 'stale' })).status, 'stale-version');
  assert.equal((await update(f, progress.value.case, 'remedy-proposed', { dueAt: '2020-01-01T00:00:00.000Z' })).status, 'invalid');
  const proposed = await update(f, progress.value.case, 'remedy-proposed', { remedy: { type: 'manual-decision', decision: 'Arrange a scheme-team call.' } });
  assert.equal(proposed.status, 'ok', JSON.stringify(proposed));
  const resolved = await update(f, proposed.value.case, 'resolved'); assert.equal(resolved.status, 'ok');
  const closed = await update(f, resolved.value.case, 'closed'); assert.equal(closed.status, 'ok');
  assert.equal((await update(f, closed.value.case, 'in-progress')).status, 'invalid');
});
caseTest('extension is gated by its canonical permission and later release needs an actual future date', async (t) => {
  const f = await setup(t); let c = (await request(f)).value.case; c = (await update(f, c, 'in-progress')).value.case;
  assert.equal((await update(f, c, 'remedy-proposed', { remedy: { type: 'contract-extension', until: '2027-01-01' } })).status, 'forbidden');
  assert.equal((await update(f, c, 'remedy-proposed', { remedy: { type: 'later-release', releaseAt: null } })).status, 'invalid');
  assert.equal((await update(f, c, 'remedy-proposed', { remedy: { type: 'later-release', releaseAt: '2026-10-01T00:00:00.000Z' } })).status, 'invalid');
  assert.equal((await update(f, c, 'remedy-proposed', { remedy: { type: 'later-release', releaseAt: '2026-12-04T09:00:00.000Z', source: 'synthetic reviewed release plan' } })).status, 'ok');
  const g = await setup(t, { policy: await withPolicy({ 'renewalCase.extension.permitted': true }) });
  let gc = (await request(g)).value.case; gc = (await update(g, gc, 'in-progress')).value.case;
  assert.equal((await update(g, gc, 'remedy-proposed', { remedy: { type: 'contract-extension', until: '2027-01-01' } })).status, 'ok');
});
caseTest('preference remedy waits for an actual persisted FUCQ-91 single-change employee confirmation', async (t) => {
  const f = await setup(t); const initial = await confirmedBrief(f);
  await f.repository.transaction(f.context, cmd('decline'), (tx) => tx.insert('decisions', { runId: f.context.runId, decisionId: 'decline',
    offerId: 'offer-old', employeeId: f.context.employeeId, decision: 'decline', versions: { brief: 1 } }));
  let c = (await request(f)).value.case; c = (await update(f, c, 'in-progress')).value.case;
  const remedy = { type: 'preference-relaxation', decisionId: 'decline', expectedBriefVersion: 1, path: 'preferences.body.value', value: 'suv' };
  const proposed = await update(f, c, 'remedy-proposed', { remedy }); assert.equal(proposed.status, 'ok', JSON.stringify(proposed));
  assert.equal(proposed.value.case.remedy.confirmationState, 'employee-confirmation-required');
  assert.equal((await update(f, proposed.value.case, 'resolved')).code, 'employee-confirmation-required');
  assert.deepEqual((await f.brief.readCurrent(f.context)).value.brief, initial);
  assert.equal((await f.brief.changeAfterDecline(f.context, { commandId: 'employee-change', decisionId: 'decline', expectedBriefVersion: 1,
    change: { path: remedy.path, value: remedy.value } })).status, 'ok');
  const resolved = await update(f, proposed.value.case, 'resolved'); assert.equal(resolved.status, 'ok', JSON.stringify(resolved));
  assert.equal(resolved.value.case.remedy.confirmedBy, f.context.principalId);
  assert.deepEqual((await f.brief.readCurrent(f.context)).value.brief.essentials, initial.essentials);
});
caseTest('opening and resolving cases never change allocation inputs, holds, eligibility, points or essential constraints', async (t) => {
  const f = await setup(t); await confirmedBrief(f);
  const input = () => Object.fromEntries(['employees','entitlement_slots','briefs','stock','holds','claims','quotes','offers','decisions'].map((key) => [key, structuredClone(f.store.state.tables[key])]));
  const before = input(); let c = (await request(f)).value.case; c = (await update(f, c, 'in-progress')).value.case;
  c = (await update(f, c, 'remedy-proposed', { remedy: { type: 'manual-decision', decision: 'Review with scheme team.' } })).value.case;
  assert.equal((await update(f, c, 'resolved')).status, 'ok'); assert.deepEqual(input(), before);
});
caseTest('employee case ownership and current-run scope are checked independently of supplied browser IDs', async (t) => {
  const f = await setup(t); const c = (await request(f)).value.case;
  assert.equal((await f.service.readOwn(f.alex.value.context, { caseId: c.caseId })).status, 'forbidden');
  assert.equal((await f.service.list(f.context)).status, 'forbidden'); assert.equal((await f.service.list(f.greg.value.context)).value.cases.length, 1);
  assert.equal((await f.service.readOwn({ ...f.context, runId: 'forged' }, { caseId: c.caseId })).status, 'forbidden');
  assert.equal((await f.service.readOwn(f.context, { caseId: c.caseId })).status, 'ok');
});
caseTest('outbox failures roll back case/history and replay never enqueues a duplicate update', async (t) => {
  const f = await setup(t, { failQueue: true }); const before = structuredClone(f.store.state);
  assert.equal((await request(f)).status, 'unavailable'); assert.deepEqual(f.store.state, before);
  const g = await setup(t); const c = (await request(g)).value.case; await request(g);
  assert.equal((await g.repository.query(g.context, 'notification_outbox')).value.length, 1);
  assert.equal((await g.service.readOwn(g.context)).value.cases[0].caseId, c.caseId);
});
caseTest('actual captured dispatcher consumes case updates after commit, retries safely and preserves account state', async (t) => {
  const f = await setup(t); const dispatcher = new NotificationDispatcher({ repository: f.repository, policy: f.policy, clock: f.clock, environmentId: 'case-test' });
  t.after(() => dispatcher.close()); await f.service.start(); assert.equal((await dispatcher.start()).status, 'ok');
  const first = await request(f); assert.equal(first.status, 'ok');
  let jobs = (await f.repository.query(f.context, 'notification_outbox')).value;
  assert.equal(jobs[0].state, 'sent'); assert.equal(jobs[0].messageKind, 'renewal-case-update');
  assert.match(jobs[0].outcome.message.textBody, /Scheme team|scheme team/i); assert.match(jobs[0].outcome.message.textBody, /No email has been sent/);
  await request(f); jobs = (await f.repository.query(f.context, 'notification_outbox')).value; assert.equal(jobs.length, 1); assert.equal(jobs[0].attempts, 1);
  assert.equal((await f.service.readOwn(f.context)).value.cases[0].status, 'open');
});

caseTest('alternative car uses current eligibility, points, essentials and availability; unresolved charging stays unknown', async (t) => {
  const f = await setup(t); await confirmedBrief(f);
  await f.clock.advance(f.presenter.value.context, { commandId: 'noon', expectedClockVersion: '1', bySeconds: 10800 });
  const employeeRow = (await f.repository.query(f.context, 'employees', { employeeId: f.context.employeeId })).value[0];
  await employee(f, { contract: { ...employeeRow.contract, manualContext: { ...employeeRow.contract.manualContext, employeeFacts: providerValue().employeeFacts } } });
  const candidate = stock(771);
  const seedCar = (candidate) => f.repository.transaction(f.context, cmd('candidate:'+candidate.orderUuid), (tx) => tx.insert('stock', {
    runId: f.context.runId, orderUuid: candidate.orderUuid, orderNumber: '9876'+candidate.orderUuid.slice(-3), configurationId: candidate.configurationId,
    state: 'available', available: true, facts: { recommendationCandidate: candidate } }));
  await seedCar(candidate);
  let c = (await request(f)).value.case; c = (await update(f, c, 'in-progress')).value.case;
  const petrol = await update(f, c, 'remedy-proposed', { commandId: 'petrol', remedy: { type: 'alternative-car', orderUuid: candidate.orderUuid } });
  assert.equal(petrol.status, 'ok', JSON.stringify(petrol));
  c = (await update(f, petrol.value.case, 'in-progress', { commandId: 'review-plugin' })).value.case;
  const plugIn = stock(772, { fuel: fact('phev') }); await seedCar(plugIn);
  assert.equal((await update(f, c, 'remedy-proposed', { commandId: 'unresolved-charging', remedy: { type: 'alternative-car', orderUuid: plugIn.orderUuid } })).status, 'invalid');
});

caseTest('actual HTTP composition ignores identity overrides and refuses cross-employee, scheme-role and stale-run access', async (t) => {
  const f = await setup(t); const { buildServer } = await import('../index.js');
  const server = buildServer({ gcspIdentity: f.identity, gcspClock: f.clock, gcspCases: f.service, gcspAllowedOrigins: ['https://case.test'] });
  assert.equal((await server.gcspStartup).status, 'ok'); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const cookie = (session) => [session.value.setCookie].flat().map((c) => c.split(';')[0]).join('; ');
  const call = async (path, { body, session = f.paula } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/gcsp${path}`, { method: body ? 'POST' : 'GET',
      headers: { Origin: 'https://case.test', Cookie: cookie(session), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, value: await response.json(), cache: response.headers.get('cache-control') };
  };
  const state = structuredClone(f.store.state); assert.equal((await call('/help')).status, 200); assert.deepEqual(f.store.state,state);
  const opened = await call('/cases', { body: { commandId: 'http-help', reason: 'Please review my renewal.', employeeId: f.alex.value.context.employeeId,
    runId: 'another-run', roles: ['presenter'], principalId: 'demo-greg' } });
  assert.equal(opened.status,200,JSON.stringify(opened)); assert.equal(opened.cache,'no-store');
  assert.equal(opened.value.value.case.employeeId,f.context.employeeId); assert.equal(opened.value.value.case.runId,f.context.runId);
  const id=opened.value.value.case.caseId;
  assert.equal((await call('/cases?caseId='+id+'&employeeId=other&runId=other')).status,200);
  assert.equal((await call('/cases?caseId='+id,{session:f.alex})).status,403);
  assert.equal((await call('/scheme-team/cases')).status,403);
  assert.equal((await call('/scheme-team/cases',{session:f.greg})).value.value.cases.length,1);
  assert.equal((await call('/scheme-team/cases/update',{body:{commandId:'forged',caseId:id,status:'resolved',roles:['greg']}})).status,403);
  const prior=(await f.clock.readState(f.presenter.value.context)).value;
  assert.equal((await f.clock.reset(f.presenter.value.context,{commandId:'reset-http',expectedRunId:prior.runId,expectedRunVersion:prior.runVersion,
    scenarioVersion:prior.versions.scenario,fixtureVersion:prior.versions.fixture})).status,'ok');
  assert.equal((await call('/cases?caseId='+id)).status,409);
  assert.equal((await request(f,'old-command')).status,'stale-run');
});

caseTest('case notification retries reuse the committed job and historical jobs are stale on reset', async (t) => {
  const f=await setup(t); let calls=0;
  const dispatcher=new NotificationDispatcher({repository:f.repository,policy:f.policy,clock:f.clock,environmentId:'case-test',
    transport:{async send(){calls+=1;return calls===1?result('unavailable',{retryable:true}):ok({accepted:true});}}});
  t.after(()=>dispatcher.close()); await f.service.start(); await dispatcher.start(); await request(f);
  let jobs=(await f.repository.query(f.context,'notification_outbox')).value;
  assert.equal(jobs[0].state,'retrying'); assert.equal(jobs[0].attempts,1);
  const id=jobs[0].jobId; assert.equal((await f.service.readOwn(f.context)).value.cases[0].status,'open');
  const now=(await f.clock.readState(f.presenter.value.context)).value;
  await f.clock.advance(f.presenter.value.context,{commandId:'retry-time',expectedClockVersion:now.clockVersion,to:jobs[0].outcome.nextAttemptAt});
  await dispatcher.dispatchPending(f.context); jobs=(await f.repository.query(f.context,'notification_outbox')).value;
  assert.equal(jobs[0].state,'sent');assert.equal(jobs[0].jobId,id);assert.equal(jobs[0].attempts,2);assert.equal(calls,2);
  dispatcher.close();await request(f,'not-yet-dispatched');
  const state=(await f.clock.readState(f.presenter.value.context)).value;
  await f.clock.reset(f.presenter.value.context,{commandId:'reset-notification',expectedRunId:state.runId,expectedRunVersion:state.runVersion,
    scenarioVersion:state.versions.scenario,fixtureVersion:state.versions.fixture});
  const historical=(await f.repository.query(f.context,'notification_outbox')).value;
  assert.equal(historical.find((j)=>j.jobId!==id).state,'stale');
  assert.equal((await dispatcher.dispatchPending(f.context)).status,'stale-run');assert.equal(calls,2);
});

caseTest('repository enforces one active renewal case and migration carries matching scoped SQL constraint', async (t) => {
  const f=await setup(t);const c=(await request(f)).value.case;
  const duplicate=await f.repository.transaction(f.context,cmd('duplicate'),(tx)=>tx.insert('renewal_cases',{...c,caseId:'duplicate',version:1}));
  assert.equal(duplicate.status,'conflict');assert.equal(duplicate.reason,'active-renewal-case-exists');
  const sql=await readFile(new URL('../gcsp/migrations/0003_renewal_cases.sql',import.meta.url),'utf8');
  assert.match(sql,/UNIQUE INDEX renewal_cases_active_renewal/);assert.match(sql,/\(run_id,employee_id,renewal_id\)/);
  assert.match(sql,/WHERE data->>'status' IN \('open','in-progress','remedy-proposed'\)/);
  await f.repository.close();await f.repository.open();
  const reopened=new implementation.RenewalCaseService({repository:f.repository,policy:f.policy,clock:f.clock,identity:f.identity});
  assert.deepEqual((await reopened.readOwn(f.context)).value.cases,[c]);
});

caseTest('response fixtures retain ownership, units, actual/unknown dates, fictional assumptions and actionable refusal states', async (t) => {
  const fixture=JSON.parse(await readFile(new URL('./fixtures/gcsp-renewal-case-outcomes.json',import.meta.url),'utf8'));
  const project=(value,shape)=>Object.fromEntries(Object.keys(shape).map((key)=>[key,value[key]]));
  const f=await setup(t);const opened=(await request(f)).value.case;
  assert.deepEqual(project(opened,fixture.openCase),fixture.openCase);
  const changed=await update(f,opened,'in-progress');assert.deepEqual(project(changed.value.case,fixture.updateCase),fixture.updateCase);
  assert.deepEqual(await f.service.update(f.context,{}),fixture.employeeUpdateRefusal);
  const help=await f.service.readHelp(f.context);
  assert.deepEqual(help.value.assumptions.map((a)=>project(a,fixture.assumptions.find((s)=>s.key===a.key))),fixture.assumptions);
  const g=await setup(t);await employee(g,{contract:{}});const noDate=(await request(g)).value.case;
  assert.deepEqual(project(noDate,fixture.unknownDeadline),fixture.unknownDeadline);
  const slot=(await g.repository.query(g.context,'entitlement_slots',{employeeId:g.context.employeeId})).value[0];
  await g.repository.transaction(g.context,cmd('missing-renewal'),(tx)=>tx.compareAndSwap({table:'entitlement_slots',key:{runId:g.context.runId,entitlementSlotId:slot.entitlementSlotId}},slot.version,{renewalId:null}));
  assert.deepEqual(await request(g,'missing-renewal'),fixture.missingRenewalRefusal);
  assert.ok(fixture.units.dueAt.includes('demonstration clock'));assert.equal(fixture.fictional,true);
});

caseTest('forged scheme-team confirmation fields and essential changes cannot approve a preference remedy', async (t) => {
  const f=await setup(t);await confirmedBrief(f);
  await f.repository.transaction(f.context,cmd('decline'),(tx)=>tx.insert('decisions',{runId:f.context.runId,decisionId:'decline',offerId:'old-offer',employeeId:f.context.employeeId,decision:'decline',versions:{brief:1}}));
  let c=(await request(f)).value.case;c=(await update(f,c,'in-progress')).value.case;
  const remedy={type:'preference-relaxation',decisionId:'decline',expectedBriefVersion:1,path:'preferences.body.value',value:'suv',confirmationState:'employee-confirmed',confirmedBy:f.context.principalId,confirmedAt:'2026-11-05T09:00:00.000Z',briefVersion:2};
  const proposed=await update(f,c,'remedy-proposed',{remedy});assert.equal(proposed.status,'ok');
  assert.equal(proposed.value.case.remedy.confirmationState,'employee-confirmation-required');
  assert.equal((await update(f,proposed.value.case,'resolved')).code,'employee-confirmation-required');
  c=(await update(f,proposed.value.case,'in-progress')).value.case;
  const essentialChange=await update(f,c,'remedy-proposed',{commandId:'essential',remedy:{...remedy,path:'essentials.seats',value:4}});
  assert.equal(essentialChange.status,'invalid');assert.equal(essentialChange.reasons[0].field,'remedy');
});

caseTest('a case update and its history roll back when the required same-transaction outbox port fails', async (t) => {
  const f=await setup(t);const c=(await request(f)).value.case;const before=structuredClone(f.store.state);
  const repository={...f.repository,transaction(context,command,work){return f.repository.transaction(context,command,(tx)=>work({...tx,enqueueNotification:async()=>result('unavailable',{reason:'synthetic-queue-failure'})}));}};
  const service=new implementation.RenewalCaseService({repository,policy:f.policy,clock:f.clock,identity:f.identity});
  const outcome=await service.update(f.greg.value.context,{commandId:'rollback-update',caseId:c.caseId,expectedVersion:c.version,status:'in-progress',
    reason:'Team review started.',nextAction:'Check suitable replacements.',dueAt:'2026-11-06T12:00:00.000Z'});
  assert.equal(outcome.status,'unavailable');assert.deepEqual(f.store.state,before);
});
