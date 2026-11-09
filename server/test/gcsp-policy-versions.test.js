import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { PolicyService, FilePolicyProvider, MemoryPolicyProvider, PostgresPolicyProvider, createMemoryPolicyStore, createPolicyService } from '../gcsp/policy/index.js';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { loadMigrations } from '../gcsp/migrations/index.js';
import { POLICY_TABLES } from '../gcsp/policy/publish.js';

const fixtures = JSON.parse(await readFile(new URL('./fixtures/gcsp-policy-version-outcomes.json', import.meta.url), 'utf8'));
const initialVersion = 'gcsp-policy-v1';
const nextDate = '2026-11-05T10:00:00.000Z';
const changedKey = 'hold.cart.durationSeconds';
const provenance = { basis: 'Explicit synthetic regression input, revised centrally.', source: 'server/test/gcsp-policy-versions.test.js', sourceDate: '2026-11-05', status: 'assumed' };
const change = (overrides = {}) => ({ commandId: 'publish-v2', expectedActiveVersion: initialVersion, policyVersion: 'policy-test-v2', effectiveFrom: nextDate,
  changes: [{ table: 'assumptions', key: changedKey, patch: { value: 180, ...provenance } }], ...overrides });

async function setup(provider) {
  const readPolicy = new PolicyService({ provider });
  const repository = createMemoryRepository({ store: createMemoryStore() });
  assert.equal((await repository.open()).status, 'ok');
  const runtime = await createDemoRuntime({ repository, policy: readPolicy, environmentId: 'policy-version-contract', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'policy-bootstrap', sessionNow: () => '2026-11-05T09:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = (await identity.createPresenterSession('presenter')).value.context;
  const greg = (await identity.switchPrincipal(presenter, 'demo-greg', 'greg')).value.context;
  const employee = (await identity.switchPrincipal(presenter, 'demo-paula', 'employee')).value.context;
  const policy = new PolicyService({ provider, clock, identity });
  const read = async (pin) => ({ runId: greg.runId, asOf: (await clock.now(greg)).value.now, ...(pin ? { policyVersion: pin } : {}) });
  return { provider, repository, policy, readPolicy, clock, identity, presenter, greg, employee, read };
}

async function memoryFixture() {
  const store = createMemoryPolicyStore();
  return { provider: new MemoryPolicyProvider({ store }), reopen: () => new MemoryPolicyProvider({ store }), cleanup: async () => {} };
}

let nativeSerial = 0;
async function nativeFixture() {
  try {
    assert.ok(['postgres:', 'postgresql:'].includes(new URL(process.env.GCSP_DATABASE_URL).protocol));
  } catch { assert.fail('Configured PostgreSQL policy target is invalid; no alternate connection is attempted.'); }
  const schema = `gcsp_policy_${process.pid}_${++nativeSerial}`;
  const pool = new pg.Pool({ connectionString: process.env.GCSP_DATABASE_URL, max: 2, connectionTimeoutMillis: 5000,
    statement_timeout: 10000, query_timeout: 15000 });
  pool.on('error', () => {});
  try { await pool.query(`CREATE SCHEMA "${schema}"`); }
  catch { await pool.end(); assert.fail('Configured PostgreSQL policy target is unavailable.'); }
  const options = { pool, schema };
  let cleaned = false;
  return { provider: new PostgresPolicyProvider(options), pool, schema,
    reopen: () => new PostgresPolicyProvider({ connectionString: process.env.GCSP_DATABASE_URL, schema }),
    cleanup: async () => {
      if (cleaned) return;
      try {
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        const absent = await pool.query('SELECT count(*)::integer AS count FROM pg_namespace WHERE nspname = $1', [schema]);
        assert.equal(absent.rows[0].count, 0, 'The exact owned synthetic policy schema must be absent.');
      } finally { cleaned = true; await pool.end(); }
    } };
}

function providerContract(name, factory) {
  test(`${name}: immutable policy publication and dated/pinned reads`, async (t) => {
    const withFixture = async (work) => {
      const fixture = await factory();
      let f;
      try { f = await setup(fixture.provider); await work(f, fixture); }
      finally { await fixture.provider.close(); await f?.repository.close(); await fixture.cleanup(); }
    };
    await t.test('reviewed seed is idempotent and all existing typed reads/provenance agree', () => withFixture(async (f, fixture) => {
      const read = await f.read();
      const expected = await new FilePolicyProvider().loadVersions(read);
      assert.deepEqual(await f.provider.loadVersions(read), expected);
      assert.deepEqual(await f.provider.loadVersions(read), expected);
      await f.provider.close();
      const reopened = fixture.reopen();
      try { assert.deepEqual(await reopened.loadVersions(read), expected); } finally { await reopened.close(); }
      const file = new PolicyService({ provider: new FilePolicyProvider() });
      const mapping = (await file.getAssumption('eligibility.context.mapping', read)).value.value[0];
      const context = { runId: read.runId, companyId: mapping.companyId, schemeId: mapping.schemeId, gradeId: mapping.gradeIds[0] };
      for (const [method, args] of [['getActiveVersion', [read]], ['getAssumption', [changedKey, read]], ['getAllowance', [context, read]],
        ['getEligibility', [context, { eligibilityModelKey: 'G20 Saloon|320i' }, read]], ['getPointsCost', [context, { eligibilityModelKey: 'G20 Saloon|320i' }, read]]]) {
        assert.deepEqual(await f.policy[method](...args), await file[method](...args));
      }
    }));
    await t.test('one entry changes new work at the injected clock boundary while held terms and history remain pinned', () => withFixture(async (f) => {
      const before = await f.provider.loadVersions(await f.read());
      const held = structuredClone(await f.policy.getAssumption(changedKey, await f.read(initialVersion)));
      const published = await f.policy.publishPolicyVersion(f.greg, change());
      assert.deepEqual(published, fixtures.accepted);
      assert.equal((await f.policy.getAssumption(changedKey, await f.read())).value.value, held.value.value);
      assert.equal((await f.clock.advance(f.presenter, { commandId: 'before-effective', expectedClockVersion: '1', to: '2026-11-05T09:59:59.999Z' })).status, 'ok');
      assert.equal((await f.policy.getActiveVersion(await f.read())).policyVersion, initialVersion);
      assert.equal((await f.clock.advance(f.presenter, { commandId: 'at-effective', expectedClockVersion: '2', to: nextDate })).status, 'ok');
      const current = await f.policy.getAssumption(changedKey, await f.read());
      assert.equal(current.policyVersion, 'policy-test-v2'); assert.equal(current.value.value, 180);
      assert.deepEqual(await f.policy.getAssumption(changedKey, await f.read(initialVersion)), held);
      assert.deepEqual((await f.provider.loadVersions(await f.read()))[0], before[0]);
      const other = await f.provider.loadVersions({ runId: 'separate-policy-run', asOf: nextDate });
      assert.equal(other.length, 1); assert.equal(other[0].policyVersion, initialVersion);
    }));
    await t.test('invalid complete changes are rejected without writing a partial version', () => withFixture(async (f) => {
      const before = await f.provider.loadVersions(await f.read());
      const cases = [change({ changes: [] }), change({ changes: [{ table: 'assumptions', key: 'unknown', patch: { value: 1, ...provenance } }] }),
        change({ changes: [{ table: 'assumptions', key: changedKey, patch: { value: -1, ...provenance } }] }),
        change({ changes: [{ table: 'assumptions', key: changedKey, patch: { value: '180', ...provenance } }] }),
        change({ changes: [{ table: 'assumptions', key: changedKey, patch: { value: Infinity, ...provenance } }] }),
        change({ changes: [{ table: 'assumptions', key: changedKey, patch: { value: 1 } }] }),
        change({ changes: [{ table: 'pricePlans', key: before[0].pricePlans[0].key, patch: { value: -1, monthlyPoints: -1, ...provenance } }] }),
        change({ changes: [{ table: 'assumptions', key: changedKey, patch: { value: 180, ...provenance } }, { table: 'allowances', key: 'missing', patch: { value: 3, ...provenance } }] }),
        change({ effectiveFrom: '2026-11-05T08:59:59.000Z' }), change({ policyVersion: initialVersion }),
        change({ changes: [{ table: 'assumptions', key: changedKey, patch: { value: 1, policyVersion: 'forged', ...provenance } }] })];
      for (const input of cases) {
        const result = await f.policy.publishPolicyVersion(f.greg, input);
        assert.equal(result.status, 'invalid', JSON.stringify(result)); assert.equal(result.accepted, false);
        assert.ok(result.reasons.length); assert.deepEqual(await f.provider.loadVersions(await f.read()), before);
      }
      assert.deepEqual(await f.policy.publishPolicyVersion(f.greg, change({ changes: [] })), fixtures.invalid);
    }));
    await t.test('real identity guards reject employee, presenter and copied Greg contexts, including stale runs', () => withFixture(async (f) => {
      for (const context of [f.employee, f.presenter, { ...f.greg }, { ...f.employee, roles: ['greg'] }]) {
        assert.deepEqual(await f.policy.publishPolicyVersion(context, change()), fixtures.forbidden);
      }
      const state = (await f.clock.readState(f.presenter)).value;
      assert.equal((await f.clock.reset(f.presenter, { commandId: 'reset', expectedRunId: state.runId, expectedRunVersion: state.runVersion,
        scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture })).status, 'ok');
      assert.equal((await f.policy.publishPolicyVersion(f.greg, change())).status, 'stale-run');
    }));
    await t.test('command replay, conflicting input and stale active versions are atomic across reopen', () => withFixture(async (f, fixture) => {
      const input = change();
      const first = await f.policy.publishPolicyVersion(f.greg, input);
      assert.equal(first.status, 'ok');
      const reopened = fixture.reopen();
      try {
        const policy = new PolicyService({ provider: reopened, identity: f.identity, clock: f.clock });
        assert.deepEqual(await policy.publishPolicyVersion(f.greg, input), first);
        assert.equal((await policy.publishPolicyVersion(f.greg, { ...input, policyVersion: 'different' })).status, 'conflict');
        assert.deepEqual(await policy.publishPolicyVersion(f.greg, change({ commandId: 'stale', expectedActiveVersion: 'old' })), fixtures.stale);
        assert.equal((await reopened.loadVersions(await f.read())).length, 2);
      } finally { await reopened.close(); }
    }));
    await t.test('independent-session same-date publishers have one accepted immutable successor', () => withFixture(async (f, fixture) => {
      const reopened = fixture.reopen();
      try {
        const competing = new PolicyService({ provider: reopened, identity: f.identity, clock: f.clock });
        const outcomes = await Promise.all([f.policy.publishPolicyVersion(f.greg, change()),
          competing.publishPolicyVersion(f.greg, change({ commandId: 'competing', policyVersion: 'competing-v2' }))]);
        assert.equal(outcomes.filter(({ status }) => status === 'ok').length, 1);
        assert.equal((await f.provider.loadVersions(await f.read())).length, 2);
      } finally { await reopened.close(); }
    }));
    await t.test('later scheduled versions retain distinct changes already scheduled before them', () => withFixture(async (f) => {
      assert.equal((await f.policy.publishPolicyVersion(f.greg, change())).status, 'ok');
      const scheduled = await f.provider.loadVersions(await f.read());
      assert.equal((await f.policy.publishPolicyVersion(f.greg, change({ commandId: 'publish-v3', policyVersion: 'policy-test-v3',
        effectiveFrom: '2026-11-05T11:00:00.000Z', changes: [{ table: 'assumptions', key: 'hold.cart.orderReview.durationSeconds',
          patch: { value: 900, ...provenance } }] }))).status, 'ok');
      assert.equal((await f.clock.advance(f.presenter, { commandId: 'after-both', expectedClockVersion: '1', to: '2026-11-05T11:00:00.000Z' })).status, 'ok');
      assert.equal((await f.policy.getAssumption(changedKey, await f.read())).value.value, 180);
      assert.equal((await f.policy.getAssumption('hold.cart.orderReview.durationSeconds', await f.read())).value.value, 900);
      assert.deepEqual((await f.provider.loadVersions(await f.read())).slice(0, 2), scheduled);
    }));
  });
}

providerContract('in-memory (explicit test provider)', memoryFixture);
const configured = Object.hasOwn(process.env, 'GCSP_DATABASE_URL');
if (configured) providerContract('PostgreSQL (configured native target)', nativeFixture);
else test('PostgreSQL native parity: NOT RUN; GCSP_DATABASE_URL unset, Render integration gate remains blocked', { skip: true }, () => {});

test('memory provider returns one stable snapshot per run until a publish (FUCQ-226)', async () => {
  const provider = new MemoryPolicyProvider();
  const first = await provider.loadVersions({ runId: 'fucq226-r1' });
  const second = await provider.loadVersions({ runId: 'fucq226-r1' });
  assert.equal(first, second);
  const other = await provider.loadVersions({ runId: 'fucq226-r2' });
  assert.notEqual(other, first); assert.deepEqual(other, first);
  const retag = (value) => JSON.parse(JSON.stringify(value, (key, item) => (key === 'policyVersion' ? 'fucq226-v2' : item)));
  const outcome = await provider.publish({ runId: 'fucq226-r1' }, async (records) => ({
    record: { ...records[0], seed: { ...retag(records[0].seed), effectiveFrom: nextDate } }, outcome: 'done' }));
  assert.equal(outcome, 'done');
  assert.notEqual(await provider.loadVersions({ runId: 'fucq226-r1' }), first);
});

test('additive migration discovery retains existing 0001 and 0003 and includes dated policy tables', async () => {
  const migrations = await loadMigrations();
  // 0004 is FUCQ-104's supply records, 0005 FUCQ-136's comparison results, 0006 FUCQ-220's order reference index, 0007 FUCQ-78's observed aggregate status.
  assert.deepEqual(migrations.map(({ version }) => version), ['0001', '0002', '0003', '0004', '0005', '0006', '0007']);
  const sql = migrations.find(({ version }) => version === '0002').sql;
  for (const table of ['policy_versions', ...Object.values(POLICY_TABLES)]) assert.ok(sql.includes(`CREATE TABLE ${table} (`));
  // Unexercised natively here; this pins the text only.
  assert.match(migrations.find(({ version }) => version === '0007').sql, /^-- FUCQ-78.*\n[\s\S]*ADD CONSTRAINT policy_assumptions_status_check\s+CHECK \(data->>'status' IN \('assumed', 'verified', 'observed aggregate'\)\)/);
});

test('configured database errors never fall back to file values or expose driver diagnostics', async () => {
  const policy = createPolicyService({ connectionString: '' });
  try {
    const result = await policy.getActiveVersion({ runId: 'configured-failure', asOf: nextDate });
    assert.equal(result.status, 'unavailable'); assert.equal(result.policyVersion, null);
    assert.doesNotMatch(JSON.stringify(result), /password|postgres:|connectionString/i);
  } finally { await policy.close(); }
  const explicit = createPolicyService({ connectionString: '', filePath: new URL('../gcsp/policy/seed-v1.json', import.meta.url) });
  assert.equal((await explicit.getActiveVersion({ runId: 'explicit-file', asOf: nextDate })).status, 'ok');
});

test('PostgreSQL driver double round-trips complete typed rows and rolls back failed publication (not native SQL proof)', async () => {
  const migrations = await loadMigrations();
  let tables = Object.fromEntries(['policy_versions', ...Object.values(POLICY_TABLES)].map((table) => [table, []]));
  let previous; let failTable; let releases = 0; let queryCount = 0;
  const client = { release() { releases += 1; }, async query(sql, values = []) {
    queryCount += 1;
    if (sql === 'BEGIN') { previous = structuredClone(tables); return { rows: [] }; }
    if (sql === 'ROLLBACK') { tables = previous; return { rows: [] }; }
    if (sql === 'COMMIT' || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes('to_regclass')) return { rows: [{ name: 'unit.schema_migrations' }] };
    if (sql.includes('schema_migrations')) return { rows: migrations.map(({ version, filename, checksum }) => ({ version, filename, checksum })) };
    const table = sql.match(/"unit"\."([a-z_]+)"/)?.[1];
    assert.ok(table && Object.hasOwn(tables, table), sql);
    if (sql.startsWith('SELECT data')) {
      const found = tables[table].filter(({ data }) => data.runId === values[0]).sort((a, b) => a.ordinal - b.ordinal);
      if (sql.includes('AS "seedDigest"')) return { rows: found.map(({ data }) => ({ policyVersion: data.seed.policyVersion, seedDigest: data.seedDigest })) };
      return { rows: found.map(({ data }) => ({ data: structuredClone(data) })) };
    }
    if (sql.startsWith('INSERT')) {
      if (table === failTable) { failTable = undefined; throw new Error('private driver password must never escape'); }
      if (table === 'policy_versions') tables[table].push({ data: JSON.parse(values[0]), ordinal: tables[table].length });
      else tables[table].push(...JSON.parse(values[0]).map(({ data, ordinal }) => ({ data, ordinal })));
      return { rows: [] };
    }
    assert.fail(sql);
  } };
  const provider = new PostgresPolicyProvider({ pool: { async connect() { return client; } }, schema: 'unit', migrate: false });
  let f;
  try {
    f = await setup(provider);
    const seed = await new FilePolicyProvider().loadVersions(await f.read());
    assert.deepEqual(await provider.loadVersions(await f.read()), seed);
    const warm = await provider.loadVersions(await f.read()); const counted = queryCount;
    assert.equal(await provider.loadVersions(await f.read()), warm);
    assert.equal(queryCount - counted, 1, 'a cached policy read is one header query');
    failTable = 'price_plans';
    const failed = await f.policy.publishPolicyVersion(f.greg, change());
    assert.equal(failed.status, 'unavailable'); assert.doesNotMatch(JSON.stringify(failed), /private|password/);
    assert.deepEqual(await provider.loadVersions(await f.read()), seed);
    assert.deepEqual(await f.policy.publishPolicyVersion(f.greg, change()), fixtures.accepted);
    assert.deepEqual((await provider.loadVersions(await f.read()))[0], seed[0]);
    assert.equal((await provider.loadVersions(await f.read())).length, 2);
    assert.equal((await f.policy.getAssumption(changedKey, { ...await f.read(), asOf: nextDate })).value.value, 180);
    assert.ok(releases > 0);
  } finally { await provider.close(); await f?.repository.close(); }
});

test('native PostgreSQL rows/dates, seed replay, immutable SQL and reopen agree with memory', { skip: !configured }, async () => {
  const fixture = await nativeFixture();
  const memory = await memoryFixture();
  let f; let m;
  try {
    f = await setup(fixture.provider); m = await setup(memory.provider);
    assert.equal((await fixture.provider.open()).value.migrationStatus.current, true);
    const read = await f.read();
    const a = await fixture.provider.loadVersions(read); const b = await fixture.provider.loadVersions(read);
    assert.deepEqual(a, b); assert.deepEqual(a, await memory.provider.loadVersions(await m.read()));
    assert.deepEqual(await f.policy.publishPolicyVersion(f.greg, change()), await m.policy.publishPolicyVersion(m.greg, change()));
    assert.deepEqual(await fixture.provider.loadVersions(read), await memory.provider.loadVersions(await m.read()));
    const audit = await fixture.pool.query(`SELECT data, effective_from FROM "${fixture.schema}".policy_versions WHERE run_id = $1 AND policy_version = $2`, [read.runId, 'policy-test-v2']);
    assert.equal(audit.rows[0].data.publisher, f.greg.principalId);
    assert.equal(audit.rows[0].data.publishedAt, '2026-11-05T09:00:00.000Z');
    assert.equal(audit.rows[0].effective_from.toISOString(), nextDate);
    const reopened = fixture.reopen();
    try { assert.deepEqual(await reopened.loadVersions(read), await fixture.provider.loadVersions(read)); }
    finally { await reopened.close(); }
    const configuredService = createPolicyService({ schema: fixture.schema });
    try {
      const activeRead = { ...read, asOf: nextDate };
      assert.equal((await configuredService.getActiveVersion(activeRead)).policyVersion, 'policy-test-v2');
      assert.equal((await configuredService.getAssumption(changedKey, activeRead)).value.value, 180);
    } finally { await configuredService.close(); }
    for (const table of ['policy_versions', ...Object.values(POLICY_TABLES)]) {
      const count = await fixture.pool.query(`SELECT count(*)::integer AS count FROM "${fixture.schema}"."${table}" WHERE run_id = $1`, [read.runId]);
      assert.equal(count.rows[0].count, table === 'policy_versions' ? 2 : a[0][Object.keys(POLICY_TABLES).find((key) => POLICY_TABLES[key] === table)].length * 2);
      await assert.rejects(fixture.pool.query(`UPDATE "${fixture.schema}"."${table}" SET data = data WHERE run_id = $1`, [read.runId]), { code: '55000' });
      await assert.rejects(fixture.pool.query(`DELETE FROM "${fixture.schema}"."${table}" WHERE run_id = $1`, [read.runId]), { code: '55000' });
      const dates = await fixture.pool.query(`SELECT count(*)::integer AS count FROM "${fixture.schema}"."${table}" WHERE effective_from IS NULL`);
      assert.equal(dates.rows[0].count, 0);
    }
  } finally { await fixture.provider.close(); await memory.provider.close(); await f?.repository.close(); await m?.repository.close(); await fixture.cleanup(); }
});

test('native PostgreSQL mid-publication SQL failure rolls back every typed row and permits a valid retry', { skip: !configured }, async () => {
  const fixture = await nativeFixture();
  let f;
  try {
    f = await setup(fixture.provider);
    const read = await f.read();
    const before = await fixture.provider.loadVersions(read);
    const tables = ['policy_versions', ...Object.values(POLICY_TABLES)];
    const counts = async () => Promise.all(tables.map(async (table) => {
      const result = await fixture.pool.query(`SELECT count(*)::integer AS count FROM "${fixture.schema}"."${table}" WHERE run_id = $1`, [read.runId]);
      return result.rows[0].count;
    }));
    const previousCounts = await counts();
    await fixture.pool.query(`CREATE FUNCTION "${fixture.schema}".fail_policy_publication() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.data->>'policyVersion' = 'policy-test-v2' THEN
          RAISE EXCEPTION 'Synthetic policy rollback checkpoint';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER synthetic_publication_failure BEFORE INSERT ON "${fixture.schema}".policy_assumptions
        FOR EACH ROW EXECUTE FUNCTION "${fixture.schema}".fail_policy_publication()`);
    try {
      const rejected = await f.policy.publishPolicyVersion(f.greg, change());
      assert.equal(rejected.status, 'unavailable');
      assert.doesNotMatch(JSON.stringify(rejected), /Synthetic policy rollback checkpoint|postgres:/);
      assert.deepEqual(await counts(), previousCounts);
      assert.deepEqual(await fixture.provider.loadVersions(read), before);
    } finally {
      await fixture.pool.query(`DROP TRIGGER synthetic_publication_failure ON "${fixture.schema}".policy_assumptions;
        DROP FUNCTION "${fixture.schema}".fail_policy_publication()`);
    }
    assert.deepEqual(await f.policy.publishPolicyVersion(f.greg, change()), fixtures.accepted);
    assert.deepEqual((await fixture.provider.loadVersions(read))[0], before[0]);
    const invalid = await fixture.provider.publish({ ...read, runId: 'owned-empty-invalid-run' }, async () => ({ outcome: fixtures.invalid }));
    assert.deepEqual(invalid, fixtures.invalid);
    for (const table of tables) {
      const rows = await fixture.pool.query(`SELECT count(*)::integer AS count FROM "${fixture.schema}"."${table}" WHERE run_id = $1`, ['owned-empty-invalid-run']);
      assert.equal(rows.rows[0].count, 0, 'First-use rejection must roll back its seed as well.');
    }
  } finally { await fixture.provider.close(); await f?.repository.close(); await fixture.cleanup(); }
});
