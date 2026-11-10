import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { inputDigest } from '../gcsp/repository/index.js';
import { preference, essential } from './helpers/employee-recommendation.js';

const connectionString = process.env.FUCQ322_TEST_DATABASE_URL;
const good = (reply) => { assert.equal(reply.status, 'ok', JSON.stringify(reply)); return reply.value; };
const cookieOf = (reply) => reply.value.setCookie.filter((c) => !c.includes('Max-Age=0')).map((c) => c.split(';')[0]).join('; ');

test('native PostgreSQL retains user records and revoked sessions across database and application restart', {
  skip: !connectionString, timeout: 120000,
}, async (t) => {
  const schema = `fucq322_${process.pid}_${Date.now()}`;
  const options = { mode: 'postgres', repositoryOptions: { connectionString, schema },
    environmentId: 'fucq322-restart', policyAsOf: '2026-11-10T12:00:00.000Z', commandId: 'restart-proof',
    sessionNow: () => '2026-11-10T12:00:00.000Z' };
  let runtime;
  t.after(async () => {
    await runtime?.close();
    const cleanup = new pg.Pool({ connectionString, max: 1 });
    try { await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await cleanup.end(); }
  });
  const setup = new pg.Pool({ connectionString, max: 1 });
  try { await setup.query(`CREATE SCHEMA "${schema}"`); } finally { await setup.end(); }
  runtime = good(await createGcspRuntime(options));
  const paulaLogin = await runtime.identity.signIn({ email: 'paula.mason@gcsp-demo.com', password: 'fucq' }, 'paula-first');
  const paula = good(paulaLogin).context;
  const alexLogin = await runtime.identity.signIn({ email: 'alex.brennan@gcsp-demo.com', password: 'fucq' }, 'alex-first');
  const alex = good(alexLogin).context;
  good(await runtime.dependencies.gcspPrepareEmployee(paula));
  good(await runtime.dependencies.gcspPrepareEmployee(alex));
  const beforeAccount = good(await runtime.account.readAccount(paula));
  const alexAccount = good(await runtime.account.readAccount(alex));
  assert.notEqual(beforeAccount.allowance.monthlyPoints, alexAccount.allowance.monthlyPoints);
  const savedBrief = { schemaVersion: 1, preferences: { body: preference('estate'), comfort: preference(75, 0) },
    essentials: { seats: essential(5) }, currentCarFeedback: { preserve: ['comfort'], change: ['body'], state: 'draft', source: 'employee' } };
  good(await runtime.brief.saveDraft(paula, { commandId: 'saved-preferences', expectedDraftVersion: 0, expectedBriefVersion: 0, brief: savedBrief }));
  const ref = { table: 'employees', key: { runId: paula.runId, employeeId: paula.employeeId } };
  const stored = good(await runtime.repository.read(paula, ref));
  const manual = structuredClone(stored.contract.manualContext);
  manual.contracts[0].currentOdometer.value = 8765;
  good(await runtime.repository.transaction(paula, { commandId: 'save-current-car', inputDigest: inputDigest(manual) },
    (tx) => tx.compareAndSwap(ref, stored.version, { contract: { ...stored.contract, manualContext: manual } })));
  const draft = good(await runtime.brief.readDraft(paula));
  assert.equal((await runtime.brief.readDraft(alex)).status, 'not-found');
  good(await runtime.identity.signOut({ cookie: cookieOf(paulaLogin) }));
  await runtime.close(); runtime = null;
  const restart = process.env.FUCQ322_PG_CTL;
  assert.ok(restart && process.env.FUCQ322_PG_DATA && process.env.FUCQ322_PG_LOG, 'native proof must restart PostgreSQL as well as the application');
  await promisify(execFile)(restart, ['-D', process.env.FUCQ322_PG_DATA, '-l', process.env.FUCQ322_PG_LOG, '-m', 'fast', '-w', 'restart'], { timeout: 30000 });
  runtime = good(await createGcspRuntime(options));
  assert.equal((await runtime.identity.resolveSession({ authorized: true, cookie: cookieOf(paulaLogin) })).status, 'unknown-session');
  const restoredAlex = good(await runtime.identity.resolveSession({ authorized: true, cookie: cookieOf(alexLogin) }));
  assert.equal(restoredAlex.employeeId, alex.employeeId);
  const later = good(await runtime.identity.signIn({ email: 'paula.mason@gcsp-demo.com', password: 'fucq' }, 'paula-later')).context;
  assert.equal(later.runId, paula.runId);
  assert.equal(later.employeeId, paula.employeeId);
  assert.equal(later.email, paula.email);
  good(await runtime.dependencies.gcspPrepareEmployee(later));
  assert.deepEqual(good(await runtime.brief.readDraft(later)), draft);
  const afterAccount = good(await runtime.account.readAccount(later));
  assert.equal(afterAccount.currentContract.currentOdometer.value, 8765);
  assert.deepEqual(afterAccount.allowance, beforeAccount.allowance);
  assert.equal(afterAccount.account.contact.email, paula.email);
  assert.equal(good(await runtime.account.readAccount(restoredAlex)).currentContract.currentOdometer.value, 5200);
  assert.equal((await runtime.brief.readDraft(restoredAlex)).status, 'not-found');
  // A separate driver connection observes durable profile fields in native JSONB.
  const proof = new pg.Pool({ connectionString, max: 1 });
  try {
    const rows = await proof.query(`SELECT data->>'email' AS email, data->>'lastName' AS surname FROM "${schema}".employees WHERE data->>'employeeId' = $1`, [paula.employeeId]);
    assert.deepEqual(rows.rows, [{ email: paula.email, surname: 'Mason' }]);
  } finally { await proof.end(); }
});
