import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:https';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, lstatSync, readlinkSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { chromium, webkit } from 'playwright-core';
import { assembleGcspStatic, GCSP_FIXED_ROUTES } from '../../../scripts/build-gcsp-static.mjs';
import { runtimeConfigFromEnv } from '../../../scripts/gcsp-runtime-config.mjs';
import { apiJvmArgs } from '../../../scripts/gcsp/proof-jvm.mjs';
import { captureNodeReplay, withNodeReplay, observeImageResponses, NODE_REPLAY_IDENTITY } from './node-replay.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FROZEN = 'e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await delay(100); }
  assert.fail(message);
}
const sha = (value) => createHash('sha256').update(value).digest('hex');
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const canonical = (value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
const sanitizeReadback = (value) => {
  if (Array.isArray(value)) return value.map(sanitizeReadback);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, /authorization|cookie|token|password|secret|api[-_]?key/i.test(key) ? '[redacted]' : sanitizeReadback(item)]));
  return value;
};

function local(value) {
  assert.ok(path.isAbsolute(value), 'Composition paths must be absolute');
  assert.ok(!/CloudStorage|OneDrive/i.test(value), 'Synced paths are forbidden before any filesystem inspection');
  let pending = path.resolve(value).split(path.sep).filter(Boolean);
  let resolved = path.sep; let links = 0;
  while (pending.length) {
    resolved = path.join(resolved, pending.shift());
    assert.ok(!/CloudStorage|OneDrive/i.test(resolved));
    let item;
    try { item = lstatSync(resolved); } catch (error) {
      if (error.code === 'ENOENT') return path.join(resolved, ...pending);
      throw error;
    }
    if (item.isSymbolicLink()) {
      assert.ok(++links <= 32);
      const target = path.resolve(path.dirname(resolved), readlinkSync(resolved));
      assert.ok(!/CloudStorage|OneDrive/i.test(target), 'Reject the link target before following it');
      pending = [...target.split(path.sep).filter(Boolean), ...pending]; resolved = path.sep;
    }
  }
  return resolved;
}

function identity(pid) {
  const read = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'pid=', '-o', 'pgid=', '-o', 'lstart=', '-o', 'comm='], { encoding: 'utf8', timeout: 3000 });
  const parts = read.stdout.trim().split(/\s+/);
  return read.status === 0 && parts.length >= 8
    ? { pid: Number(parts[0]), pgid: Number(parts[1]), start: parts.slice(2, 7).join(' '), executable: parts.slice(7).join(' ') } : null;
}

export async function startComposition({ caseId = 'f548', ordering = 'synthetic' } = {}) {
  assert.ok(['f548', 'f552', 'f555-pending', 'f555-accept', 'f555-decline', 'f555-rejected', 'f555-uncertain'].includes(caseId));
  assert.ok(['synthetic', 'rejected', 'unknown-then-rejected'].includes(ordering));
  const scratch = local(process.env.SCRATCH ?? '');
  assert.ok(scratch.startsWith('/private/tmp/'), 'The supervisor must own /private/tmp scratch');
  const runOutput = local(process.env.GCSP_E2E_OUTPUT ?? '');
  const output = caseId === 'f548' ? runOutput : path.join(runOutput, caseId);
  mkdirSync(output, { recursive: true });
  const work = path.join(scratch, 'browser-suite', caseId);
  const dirs = Object.fromEntries(['certs', 'static', 'logs', 'tmp'].map((name) => [name, path.join(work, name)]));
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  const envId = 'e2e-' + randomUUID().slice(0, 12);
  const bootstrapRunId = 'run-1';
  const runId = NODE_REPLAY_IDENTITY.runId;
  const ports = { web: Number(process.env.PROOF_WEB_PORT ?? 7548), api: Number(process.env.PROOF_API_PORT ?? 8548) };
  assert.ok(Object.values(ports).every((port) => Number.isInteger(port) && port > 1023 && port < 65536) && ports.web !== ports.api);
  const origins = { web: `https://gcsp-web.localhost:${ports.web}`, api: `https://gcsp-api.localhost:${ports.api}` };
  const issuer = `${origins.api}/demo-idp`;
  const apiBase = `${origins.api}/api/gcsp/v1`;
  const database = /^jdbc:postgresql:\/\/(127\.0\.0\.1|localhost)(?::(\d+))?\/([a-zA-Z0-9_]+)(?:\?.*)?$/.exec(process.env.GCSP_TEST_DATABASE_URL ?? '');
  assert.ok(database, 'A fresh owned local PostgreSQL database is required');
  const javaHome = local(process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home');
  const jar = local(process.env.PROOF_API_JAR ?? '');
  const browserBuild = local(process.env.PROOF_WEB_BROWSER ?? '');
  const psql = local(process.env.PROOF_PSQL_BIN ?? '/opt/homebrew/opt/postgresql@17/bin/psql');
  const nodeEnv = { ...process.env, TMPDIR: dirs.tmp, TMP: dirs.tmp, TEMP: dirs.tmp };
  const inputFile = path.join(HERE, 'fixtures/main-inputs.json');
  const input = JSON.parse(readFileSync(inputFile, 'utf8'));
  const compressedPlan = readFileSync(path.join(HERE, 'fixtures', input.stockPlan.file));
  assert.ok(compressedPlan.length <= 8 * 1024 * 1024);
  assert.equal(compressedPlan.length, input.stockPlan.compressedBytes);
  assert.equal(sha(compressedPlan), input.stockPlan.compressedSha256, 'The compressed source instance must match its provenance');
  const planBytes = gunzipSync(compressedPlan, { maxOutputLength: 256 * 1024 * 1024 });
  assert.equal(input.reference.commit, FROZEN);
  assert.equal(sha(planBytes), input.stockPlan.sha256, 'The exact retained Node stock input must match its provenance');
  const plan = JSON.parse(planBytes);
  assert.equal(planBytes.length, input.stockPlan.bytes);
  assert.equal(plan.windows.length, input.stockPlan.windowCount);
  assert.equal(plan.windows.reduce((total, window) => total + window.stock.length, 0), input.stockPlan.stockCount);
  assert.ok(plan.windows.length <= 100 && input.stockPlan.stockCount <= 10000, 'Bound retained input windows/cars');
  const planFile = path.join(dirs.tmp, 'main-stock-plan.json');
  writeFileSync(planFile, planBytes);
  assert.ok(plan.windows.length && plan.windows.every((window) => window.stock.length));
  const preparationFile = path.join(ROOT, 'services/gcsp-api/src/main/resources/gcsp/scenario/demo-preparation-v1.json');
  const preparation = JSON.parse(readFileSync(preparationFile, 'utf8'));
  const scenario = preparation.catalogue.scenarios.find((item) => item.scenarioId === 'main-successful-journey');
  assert.deepEqual(scenario.inputs, input.scenario.inputs, 'The retained Main inputs and generated Java definitions must agree');
  const directory = preparation.catalogue.directory;
  const employee = directory.find((person) => person.principalId === 'demo-paula');
  assert.ok(employee?.employeeId);
  const processes = [];
  let api;
  let server;
  let browser;
  let browserServer;
  const imageObservers = new Map();
  let closed = false;
  const orderingToken = randomUUID();
  const orderingReplies = new Map();
  const orderingRequests = [];
  let rejectPending = false;
  const receipt = { schema: 'gcsp-notification-browser/1', sourceRevision: process.env.PROOF_SOURCE_REVISION,
    reference: input.reference, caseId, composition: { origins, issuer, environmentId: envId, runId, database: database[3], ordering,
      identity: 'started Java demo issuer, code/PKCE and signed bearer validation', supply: 'tranche-plan over exact retained Node input' },
    input: { stockPlan: input.stockPlan, scenario: input.scenario, clock: input.clock },
    setupDifferences: ['Java named Main reset availability is recorded separately (FUCQ-562); no successful reset is claimed.',
      'A bootstrap run migrates the owned database, then is legally retired. A fresh replay run receives the exact initial clock before Java restarts; no clock guard is bypassed.',
      'The exact initial Main brief and consent are fixture inputs in the owned test database; public editor validation is unchanged.',
      'The frozen Node stock instance enters Java through its existing tranche-plan provider; release, allocation, holds and offers are actual services.'],
    requests: [], screenshots: [], checks: {}, browsers: {}, consoleErrors: [], imageResponses: [], processes };
  const journalPath = path.join(runOutput, 'processes.json');
  const journal = () => {
    const prior = existsSync(journalPath) ? JSON.parse(readFileSync(journalPath, 'utf8')).processes : [];
    const others = prior.filter((record) => record.caseId !== caseId);
    writeFileSync(journalPath, JSON.stringify({ ownerPid: process.pid, processes: [...others, ...processes] }, null, 2));
  };
  const schema = 'gcsp_e2e_' + randomUUID().replaceAll('-', '');
  function sql(statement) {
    return execFileSync(psql, ['-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-h', database[1], '-p', database[2] ?? '5432',
      '-U', process.env.PROOF_DB_USER ?? 'gcsp', '-d', database[3]], { env: { ...nodeEnv, PGPASSWORD: '', PGCONNECT_TIMEOUT: '10' },
      input: `SET search_path TO ${schema};\n${statement}\n`, encoding: 'utf8', timeout: 10000 }).trim();
  }
  const recordProcess = (name, child) => {
    const record = { name, caseId, ...identity(child.pid), parentPid: process.pid, ended: false };
    assert.equal(record.pid, child.pid, `Positive process identity for ${name}`);
    processes.push(record); journal();
    child.once('exit', () => { record.ended = true; journal(); });
    return record;
  };
  const start = (name, executable, args, env) => {
    const log = createWriteStream(path.join(dirs.logs, `${name}.log`));
    const child = spawn(executable, args, { cwd: ROOT, env: { ...env, TMPDIR: dirs.tmp, TMP: dirs.tmp, TEMP: dirs.tmp },
      stdio: ['ignore', 'pipe', 'pipe'], detached: false });
    let kept = 0;
    const capture = (chunk) => { const bytes = chunk.subarray(0, Math.max(0, 262144 - kept)); kept += bytes.length; if (bytes.length) log.write(bytes); };
    child.stdout.on('data', capture); child.stderr.on('data', capture); child.once('close', () => log.end());
    child.joined = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    child.ownedIdentity = recordProcess(name, child);
    return child;
  };
  const stop = async (child) => {
    if (!child || child.exitCode !== null || child.signalCode) return;
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      assert.deepEqual(identity(child.pid), (({ pid, pgid, start, executable }) => ({ pid, pgid, start, executable }))(child.ownedIdentity), 'Signal only the unchanged owned child');
      child.kill(signal);
      await Promise.race([child.joined, delay(signal === 'SIGTERM' ? 5000 : 2000)]);
      if (child.exitCode !== null || child.signalCode) return;
    }
    throw new Error('Owned Java child did not stop and join');
  };
  async function close() {
    if (closed) return;
    closed = true;
    const errors = [];
    for (const action of [() => browser?.close(), () => Promise.all([...imageObservers.values()].map((observer) => observer.stop())),
      () => browserServer?.close(), () => stop(api), () => server && new Promise((resolve) => {
      server.closeAllConnections?.(); server.close(resolve);
    })]) {
      try { await action(); } catch (error) { errors.push(error.message); }
    }
    receipt.cleanupErrors = errors;
    receipt.orderingSubstitute = { variant: ordering, requests: orderingRequests };
    receipt.finishedAt = new Date().toISOString();
    writeFileSync(path.join(output, 'browser-receipt.json'), JSON.stringify(receipt, null, 2));
    for (const name of ['api-bootstrap.log', 'api.log', 'api-active-offer-restart.log']) {
      const file = path.join(dirs.logs, name);
      if (existsSync(file)) writeFileSync(path.join(output, name), readFileSync(file).subarray(-65536));
    }
    assert.deepEqual(errors, [], 'Composition teardown must complete');
  }
  const onSignal = () => { close().finally(() => { process.exitCode = 1; }); };
  process.once('SIGTERM', onSignal); process.once('SIGINT', onSignal);
  try {
    const cert = (name) => path.join(dirs.certs, name);
    const ssl = (args) => execFileSync('openssl', args, { env: nodeEnv, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
    ssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', cert('leaf.key'), '-out', cert('leaf.pem'), '-days', '2',
      '-subj', '/CN=gcsp-web.localhost', '-addext', 'subjectAltName=DNS:gcsp-web.localhost,DNS:gcsp-api.localhost,DNS:localhost,IP:127.0.0.1']);
    execFileSync(path.join(javaHome, 'bin/keytool'), ['-importcert', '-alias', 'local-browser-suite', '-file', cert('leaf.pem'),
      '-keystore', cert('trust.p12'), '-storetype', 'PKCS12', '-storepass', 'local-test-trust', '-noprompt'], { env: nodeEnv, stdio: 'pipe', timeout: 30000 });
    const config = runtimeConfigFromEnv({ GCSP_PUBLIC_ENVIRONMENT_ID: envId, GCSP_PUBLIC_API_BASE_URL: apiBase,
      GCSP_PUBLIC_OIDC_AUTHORITY: issuer, GCSP_PUBLIC_OIDC_CLIENT_ID: 'gcsp-web', GCSP_PUBLIC_OIDC_SCOPE: 'openid profile gcsp-api',
      GCSP_PUBLIC_OIDC_REDIRECT_URI: `${origins.web}/gcsp/auth/callback`, GCSP_PUBLIC_OIDC_POST_LOGOUT_REDIRECT_URI: `${origins.web}/gcsp/` });
    await assembleGcspStatic({ browser: browserBuild, output: dirs.static, config, environment: 'deployed', revision: process.env.PROOF_SOURCE_REVISION,
      appRoot: path.join(ROOT, 'apps/gcsp-web'), compilerTools: { node: process.version, npm: '11.19.1' } });
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
      '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
    server = createServer({ key: readFileSync(cert('leaf.key')), cert: readFileSync(cert('leaf.pem')) }, async (req, res) => {
      const requested = decodeURIComponent(new URL(req.url, origins.web).pathname);
      if (requested.startsWith('/proof-ordering/')) {
        const answer = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
        if (ordering === 'synthetic' || req.headers.authorization !== `Bearer ${orderingToken}` || orderingRequests.length >= 64) return answer(403, {});
        let input;
        if (req.method === 'POST' && requested === '/proof-ordering/execute') {
          const chunks = []; let bytes = 0;
          for await (const chunk of req) { bytes += chunk.length; if (bytes > 65536) return answer(413, {}); chunks.push(chunk); }
          try { input = JSON.parse(Buffer.concat(chunks).toString()); } catch { return answer(400, {}); }
        } else if (req.method === 'GET' && requested === '/proof-ordering/reconcile') input = Object.fromEntries(new URL(req.url, origins.web).searchParams);
        else return answer(405, {});
        if (!['operationId', 'runId', 'orderUuid'].every((key) => typeof input?.[key] === 'string' && input[key])) return answer(400, {});
        const ids = Object.fromEntries(['operationId', 'runId', 'orderUuid'].map((key) => [key, input[key]]));
        const operation = JSON.stringify(ids); const previous = orderingReplies.get(operation);
        let reply;
        if (req.method === 'POST') {
          if (req.headers['idempotency-key'] !== ids.operationId || input.idempotencyKey !== ids.operationId) return answer(400, {});
          reply = previous ?? { status: ordering === 'rejected' ? 'rejected' : 'unknown', ...ids, fictional: true };
          orderingReplies.set(operation, reply);
        } else reply = previous ? (rejectPending ? { ...previous, status: 'rejected' } : previous) : { status: 'not-found', ...ids, fictional: true };
        orderingRequests.push({ method: req.method, path: requested, authenticated: true, ...ids,
          idempotencyKey: req.headers['idempotency-key'] ?? null, reply });
        return answer(200, reply);
      }
      if (requested.includes('..')) { res.writeHead(404).end(); return; }
      let file;
      if (requested.startsWith('/assets/gcsp-vehicle-evidence/')) file = path.join(ROOT, requested.slice(1));
      else if (GCSP_FIXED_ROUTES.includes(requested) || /^\/gcsp\/offers\/[^/]+$/.test(requested)) file = path.join(dirs.static, 'gcsp/index.html');
      else if (requested.startsWith('/gcsp/')) file = path.join(dirs.static, requested.slice(1));
      if (!file || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(readFileSync(file));
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(ports.web, '127.0.0.1', resolve); });
    const apiArgs = [...apiJvmArgs(), `-Djavax.net.ssl.trustStore=${cert('trust.p12')}`,
      '-Djavax.net.ssl.trustStorePassword=local-test-trust', `-Djava.io.tmpdir=${dirs.tmp}`,
      `-Dquarkus.datasource.jdbc.additional-jdbc-properties.currentSchema=${schema}`, `-Dquarkus.flyway.schemas=${schema}`,
      `-Dquarkus.flyway.default-schema=${schema}`, '-jar', jar];
    const apiEnv = {
      PATH: process.env.PATH, HOME: process.env.HOME, JAVA_HOME: javaHome, LANG: 'en_GB.UTF-8',
      QUARKUS_HTTP_SSL_PORT: String(ports.api), QUARKUS_HTTP_INSECURE_REQUESTS: 'disabled',
      QUARKUS_HTTP_SSL_CERTIFICATE_FILES: cert('leaf.pem'), QUARKUS_HTTP_SSL_CERTIFICATE_KEY_FILES: cert('leaf.key'),
      GCSP_DATABASE_URL: process.env.GCSP_TEST_DATABASE_URL, GCSP_DATABASE_USER: process.env.PROOF_DB_USER ?? 'gcsp', GCSP_DATABASE_PASSWORD: '',
      GCSP_EXPECTED_DATABASE: database[3], GCSP_ALLOWED_ORIGINS: origins.web, GCSP_IDENTITY_PROVIDER: 'oidc',
      GCSP_OIDC_ISSUER: issuer, GCSP_OIDC_JWKS_URI: `${issuer}/jwks`, GCSP_OIDC_AUDIENCE: 'gcsp-api',
      GCSP_OIDC_AUTHORIZED_PARTY: 'gcsp-web', GCSP_OIDC_REQUIRED_SCOPES: 'gcsp-api',
      GCSP_OIDC_ACCOUNTS: JSON.stringify(directory.map((person) => ({ subject: person.principalId, roles: person.roles,
        ...(person.roles.includes('employee') ? { employeeId: person.employeeId } : {}) }))),
      GCSP_DEMO_IDP_ENABLED: 'true', GCSP_DEMO_IDP_REDIRECT_URIS: `${origins.web}/gcsp/auth/callback`,
      GCSP_DEMO_IDP_POST_LOGOUT_REDIRECT_URIS: `${origins.web}/gcsp/`, GCSP_DEMO_IDP_ACCESS_TOKEN_LIFETIME: '1h',
      GCSP_ENVIRONMENT_ID: envId, GCSP_RUN_ID: bootstrapRunId, GCSP_POLICY_VERSION: input.clock.policyVersion,
      GCSP_SCENARIO_PROVIDER: 'demo', GCSP_ACCOUNT_PROVIDER: 'repository', GCSP_ORDERING_PROVIDER: ordering === 'synthetic' ? 'synthetic' : 'remote', GCSP_RESET_ALLOWED: 'true',
      ...(ordering === 'synthetic' ? {} : { GCSP_ORDERING_EXECUTE_URL: `${origins.web}/proof-ordering/execute`,
        GCSP_ORDERING_RECONCILE_URL: `${origins.web}/proof-ordering/reconcile`, GCSP_ORDERING_TOKEN: orderingToken, GCSP_ORDERING_TIMEOUT: '5s' }),
      GCSP_SUPPLY_PROVIDER: 'tranche-plan', GCSP_SUPPLY_TRANCHE_PLAN_FILE: planFile,
      GCSP_ALLOCATION_CANDIDATES_PROVIDER: 'recommendation',
      GCSP_CLAIMS_SWEEP_INTERVAL: '10m', GCSP_NOTIFY_DRAIN_INTERVAL: '10m', GCSP_PUBLIC_BASE_URL: 'https://gcsp-proof.example.test',
    };
    const replayApiEnv = { ...apiEnv, GCSP_RUN_ID: runId };
    api = start('api-bootstrap', path.join(javaHome, 'bin/java'), apiArgs, apiEnv);
    // Playwright's isolated request context verifies readiness without printing issuer responses or tokens.
    const { request } = await import('playwright-core');
    const ready = await request.newContext({ ignoreHTTPSErrors: true });
    async function waitForApi(readiness = ready) {
      let available = false;
      for (let i = 0; i < 180; i++) {
        if (api.exitCode !== null || api.signalCode) throw new Error('Java exited during startup; inspect the retained bounded API log');
        try { available = (await readiness.get(`${apiBase}/context`, { timeout: 1000 })).status() === 401; } catch { /* bounded startup */ }
        if (available) break;
        await delay(500);
      }
      assert.ok(available, 'The real Java API must start');
    }
    try {
      await waitForApi();
      await stop(api);
      const initial = input.initialBrief.brief;
      // BriefContent owns editable values; account/provider facts stay in their canonical source rows.
      const editableKeys = ['schemaVersion', 'preferences', 'essentials', 'currentCarFeedback', 'currentCarRating', 'sameAgain'];
      const content = Object.fromEntries(editableKeys.filter((key) => Object.hasOwn(initial, key)).map((key) => [key, initial[key]]));
      receipt.canonicalBriefFixture = { rawNodeKnownFacts: initial.knownFacts, editableKeys: Object.keys(content),
        absentOptionalNodeFields: editableKeys.slice(3).filter((key) => !Object.hasOwn(initial, key)),
        nodeFieldsOutsideEditableContent: Object.fromEntries(Object.entries(initial).filter(([key]) => !editableKeys.includes(key))),
        authority: 'BriefContent.java:41 editable whitelist; BuddyJourneySeed.java:137. Source facts are read back and proven through /manual/account and /brief/editor.' };
      const account = input.account;
      const record = initial.knownFacts.contract.value.manualContext;
      const membership = { name: account.account.name, companyId: account.account.companyId, schemeId: account.account.schemeId,
        gradeId: account.account.gradeId, entitlementSlotId: initial.entitlementSlotId };
      const slotStatements = account.slots.map((slot) => {
        const attributes = Object.fromEntries(Object.entries(slot).filter(([key]) => !['employeeId', 'entitlementSlotId', 'capacity', 'runId', 'version', 'createdAt', 'updatedAt', 'ordering'].includes(key)));
        return `INSERT INTO entitlement_slots(environment_id,run_id,slot_id,employee_id,capacity,attributes,version,created_at,updated_at)
          VALUES(${literal(envId)},${literal(runId)},${literal(slot.entitlementSlotId)},${literal(slot.employeeId)},${slot.capacity},
          ${literal(JSON.stringify(attributes))}::jsonb,${slot.version},${literal(slot.createdAt)}::timestamptz,${literal(slot.updatedAt)}::timestamptz);`;
      });
      // Initial source/consent fixtures only. Startup and public controls create all derived lifecycle state.
      sql(`BEGIN;
        UPDATE runs SET status='retired',retired_at=now() WHERE environment_id=${literal(envId)} AND run_id=${literal(bootstrapRunId)} AND status='active';
        INSERT INTO runs(environment_id,run_id,status) VALUES(${literal(envId)},${literal(runId)},'active');
        INSERT INTO run_clocks(environment_id,run_id,clock_instant,clock_version,scenario_version,fixture_version,starts_at,named_times)
          SELECT environment_id,${literal(runId)},${literal(input.clock.now)}::timestamptz,${Number(input.clock.clockVersion)},scenario_version,fixture_version,
          ${literal(input.clock.startsAt)}::timestamptz,${literal(JSON.stringify(input.clock.namedTimes))}::jsonb FROM run_clocks
          WHERE environment_id=${literal(envId)} AND run_id=${literal(bootstrapRunId)};
        INSERT INTO employees(environment_id,run_id,employee_id,attributes,version) VALUES(${literal(envId)},${literal(runId)},
          ${literal(initial.employeeId)},${literal(JSON.stringify(membership))}::jsonb,${account.versions.employee});
        INSERT INTO employee_account_records(environment_id,run_id,employee_id,record_set_id,record,version)
          VALUES(${literal(envId)},${literal(runId)},${literal(initial.employeeId)},${literal(record.recordSetId)},${literal(JSON.stringify(record))}::jsonb,${account.versions.employee});
        ${slotStatements.join('\n')}
        INSERT INTO brief_heads(environment_id,run_id,employee_id,brief_version) VALUES(${literal(envId)},${literal(runId)},${literal(initial.employeeId)},1);
        INSERT INTO briefs(environment_id,run_id,employee_id,brief_version,previous_brief_version,operation,content,buddy,semantic_digest,
          policy_version,confirmed_by,confirmed_at,command_id) VALUES(${literal(envId)},${literal(runId)},${literal(initial.employeeId)},1,NULL,'confirmed',
          ${literal(JSON.stringify(content))}::jsonb,${literal(JSON.stringify(initial.buddy))}::jsonb,${literal(sha(canonical(content)))},
          ${literal(initial.policyVersion)},${literal(initial.confirmedBy)},${literal(initial.confirmedAt)}::timestamptz,'frozen-main-initial-input');
        COMMIT;`);
      receipt.initialFixture = { bootstrapRunId, replayRunId: runId, replayIdentity: NODE_REPLAY_IDENTITY, identifierMapping: { environment: envId,
        fromRun: input.reference.runId, toRun: runId }, source: 'Exact captured Main input; parent-authorized BuddyJourneySeed pattern' };
      api = start('api', path.join(javaHome, 'bin/java'), apiArgs, replayApiEnv);
      await waitForApi();
    } finally { await ready.dispose(); }
    async function restartApi() {
      assert.equal(caseId, 'f555-pending', 'Only the active-offer persistence proof restarts Java');
      assert.equal(receipt.activeOfferRestart?.lifecycle, undefined, 'One literal active-offer restart per composition');
      const previous = api;
      const before = identity(previous.pid);
      assert.ok(before?.start, 'The active-offer JVM has an observed PID/start');
      assert.deepEqual(before, (({ pid, pgid, start, executable }) => ({ pid, pgid, start, executable }))(previous.ownedIdentity));
      const lifecycle = { before, binding: { database: database[3], schema, environmentId: envId, runId,
        policyVersion: replayApiEnv.GCSP_POLICY_VERSION }, startedAt: new Date().toISOString() };
      receipt.activeOfferRestart ??= {};
      receipt.activeOfferRestart.lifecycle = lifecycle;
      await stop(previous);
      await previous.joined;
      lifecycle.previousExit = { code: previous.exitCode, signal: previous.signalCode };
      lifecycle.oldAfterStop = identity(before.pid);
      assert.equal(lifecycle.oldAfterStop, null, 'The old active-offer JVM is gone before relaunch');
      api = start('api-active-offer-restart', path.join(javaHome, 'bin/java'), apiArgs, replayApiEnv);
      const readiness = await request.newContext({ ignoreHTTPSErrors: true });
      try { await waitForApi(readiness); } finally { await readiness.dispose(); }
      lifecycle.after = identity(api.pid);
      assert.ok(lifecycle.after?.start, 'The replacement JVM has an observed PID/start after readiness');
      assert.notDeepEqual([lifecycle.after.pid, lifecycle.after.start], [before.pid, before.start], 'A new JVM identity is required');
      assert.equal(lifecycle.after.executable, before.executable, 'Relaunch the same Java executable');
      lifecycle.readyAt = new Date().toISOString();
      return lifecycle;
    }
    const type = process.env.GCSP_E2E_BROWSER === 'webkit' ? webkit : chromium;
    receipt.browsers.requested = type.name();
    const executablePath = process.env.GCSP_E2E_BROWSER_PATH;
    browserServer = await type.launchServer({ headless: true, ...(executablePath ? { executablePath: local(executablePath) } : {}),
      downloadsPath: path.join(dirs.tmp, 'downloads'), timeout: 30000 });
    recordProcess('browser', browserServer.process());
    browser = await type.connect(browserServer.wsEndpoint());
    receipt.browsers.actual = browser.version();
    receipt.browsers.webkit = type.name() === 'webkit' ? 'run' : 'unrun: not selected';
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 },
      reducedMotion: 'reduce', locale: 'en-GB', timezoneId: 'Europe/London' });
    receipt.browsers.context = 'fresh non-persistent private context; employee and presenter use independent tab sessionStorage';
    function observe(page, label) {
      page.on('pageerror', (error) => receipt.consoleErrors.push({ page: label, message: error.message.slice(0, 300) }));
      page.on('response', (response) => {
        const url = new URL(response.url());
        if (url.origin === origins.api && url.pathname.startsWith('/api/gcsp/v1/')) receipt.requests.push({ page: label,
          at: Date.now(), method: response.request().method(), path: url.pathname.slice('/api/gcsp/v1'.length), status: response.status() });
      });
    }
    async function newPage(label, subject, route) {
      const page = await context.newPage(); observe(page, label);
      imageObservers.set(page, observeImageResponses(page, { origins: [origins.web, origins.api], records: receipt.imageResponses, label }));
      await page.goto(`${origins.web}/gcsp/${route}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
      await page.locator(`button[data-subject="${subject}"]`).click();
      await page.waitForURL((url) => url.origin === origins.web && url.pathname !== '/gcsp/auth/callback');
      await page.getByRole('banner').waitFor();
      return page;
    }
    async function call(page, method, suffix, body) {
      // The app's OIDC user is tab-scoped. Read the access token only inside this ephemeral page closure;
      // it never crosses the process/tool boundary or appears in a receipt, screenshot or request journal.
      return page.evaluate(async ({ apiBase, method, suffix, body }) => {
        const key = Object.keys(sessionStorage).find((item) => item.startsWith('gcsp:oidc:user:'));
        const token = key ? JSON.parse(sessionStorage.getItem(key)).access_token : null;
        if (!token) throw new Error('The real browser sign-in has no current access token');
        const response = await fetch(apiBase + suffix, { method, cache: 'no-store', headers: {
          Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}),
        }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() };
      }, { apiBase, method, suffix, body });
    }
    async function prepareInitialBrief(employeePage, presenterPage) {
      const [read, accountRead, contextRead, clockRead, editorRead] = await Promise.all([
        call(employeePage, 'GET', '/brief'), call(employeePage, 'GET', '/manual/account'),
        call(employeePage, 'GET', '/context'), call(presenterPage, 'GET', '/presenter/controls'),
        call(employeePage, 'GET', '/brief/editor'),
      ]);
      // Persist actual boundary responses before any status/equality assertion can stop setup.
      // These fictional-data bodies exclude headers and session storage; credential-named fields are redacted.
      const readbacks = { capturedAt: new Date().toISOString(),
        sanitization: 'Response bodies only; credential-named fields redacted recursively; no headers or session storage.',
        responses: Object.fromEntries([
          ['/brief', read], ['/manual/account', accountRead], ['/context', contextRead], ['/presenter/controls', clockRead], ['/brief/editor', editorRead],
        ].map(([endpoint, response]) => [endpoint, { method: 'GET', status: response.status, body: sanitizeReadback(response.body) }])) };
      const readbacksFile = path.join(output, 'initial-readbacks.json');
      const readbacksJson = JSON.stringify(readbacks, null, 2);
      writeFileSync(readbacksFile, readbacksJson, { mode: 0o600 });
      receipt.initialReadbacks = { path: readbacksFile, sha256: sha(readbacksJson), capturedAt: readbacks.capturedAt };
      for (const response of [read, accountRead, contextRead, clockRead, editorRead]) assert.equal(response.status, 200);
      const expected = input.initialBrief.brief;
      const actual = read.body.value.brief;
      const project = (value, keys) => Object.fromEntries(keys.map((key) => [key, value[key]]));
      const storedPredecessorIsNull = sql(`SELECT previous_brief_version IS NULL FROM briefs WHERE environment_id=${literal(envId)}
        AND run_id=${literal(runId)} AND employee_id=${literal(expected.employeeId)} AND brief_version=1;`).split('\n').at(-1) === 't';
      assert.equal(storedPredecessorIsNull, true, 'The immutable first brief still stores its exact NULL predecessor');
      assert.ok(actual.previousBriefVersion === null || actual.previousBriefVersion === 0,
        'Only the observed first-version null/0 read discrepancy is outside this bell comparison');
      receipt.predecessorRead = { frozen: expected.previousBriefVersion, publicJava: actual.previousBriefVersion,
        storedPredecessorIsNull, difference: expected.previousBriefVersion !== actual.previousBriefVersion, bug: 'FUCQ-563',
        scope: 'Only previousBriefVersion is excluded from semantic input equality; the stored value/source is unchanged.',
        derivationEvidence: [
          'Java allocation/Prepare.java:237-242 selects current brief_version/content/buddy/semantic_digest; Claim.java:130-141 checks current version and consent.',
          'Java ActivityService.java:93-101 reads the stored nullable predecessor directly with wasNull; lines204-228 use it only for state-change event consistency, independently from the offer query at113 onward.',
          'Angular activity/notification.model.ts:11-41 derives rows/count from currentOffer/offers/display; notification.source.ts does not consume brief lineage.',
          'Frozen blocks/gcsp/activity/notification-source.js:18-61 derives rows/count from currentOffer/offers/display; server/gcsp/allocation and offers contain no previousBriefVersion access.',
        ] };
      const contentKeys = ['schemaVersion', 'preferences', 'essentials', 'buddy', 'briefVersion',
        'status', 'policyVersion', 'confirmedBy'];
      assert.deepEqual(project(actual, contentKeys), project(expected, contentKeys), 'Actual Java brief/consent equals captured Node initial content');
      for (const key of ['currentCarFeedback', 'currentCarRating', 'sameAgain']) {
        assert.equal(Object.hasOwn(actual, key), Object.hasOwn(expected, key), `Optional Node editable field ${key} presence is exact`);
        if (Object.hasOwn(expected, key)) assert.deepEqual(actual[key], expected[key]);
      }
      assert.equal(Object.hasOwn(actual, 'knownFacts'), false, 'Read-only facts are not editable brief content');
      assert.equal(Date.parse(actual.confirmedAt), Date.parse(expected.confirmedAt));
      const contextExpected = { subject: 'demo-paula', roles: ['employee'], environmentId: envId, runId,
        employeeId: expected.employeeId, policyVersion: expected.policyVersion };
      assert.deepEqual(project(contextRead.body.value, Object.keys(contextExpected)), contextExpected,
        'Actual signed context maps only the owned environment/run identifiers');
      const mapIds = (value) => {
        if (Array.isArray(value)) return value.map(mapIds);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
          [key, key === 'runId' ? runId : key === 'environmentId' ? envId : mapIds(item)]));
        return value;
      };
      const accountKeys = ['state', 'asOf', 'account', 'drivers', 'contracts', 'slots', 'currentContract', 'contractState',
        'choices', 'allowance', 'versions'];
      assert.deepEqual(project(accountRead.body.value, accountKeys), mapIds(project(input.account, accountKeys)),
        'Actual Java account, relationships and source versions equal captured Node inputs');
      const storedSource = JSON.parse(sql(`SELECT json_build_object('environmentId',environment_id,'runId',run_id,
        'employeeId',employee_id,'recordSetId',record_set_id,'version',version,'record',record) FROM employee_account_records
        WHERE environment_id=${literal(envId)} AND run_id=${literal(runId)} AND employee_id=${literal(expected.employeeId)};`).split('\n').at(-1));
      const storedContent = JSON.parse(sql(`SELECT content FROM briefs WHERE environment_id=${literal(envId)}
        AND run_id=${literal(runId)} AND employee_id=${literal(expected.employeeId)} AND brief_version=1;`).split('\n').at(-1));
      const sourceRecord = expected.knownFacts.contract.value.manualContext;
      const editor = editorRead.body.value; const known = editor.context.knownFacts; const actualAccount = accountRead.body.value;
      receipt.knownFactAuthority = { frozenNodeKnownFacts: expected.knownFacts, actualStoredSourceRow: storedSource,
        actualStoredEditableContent: storedContent, actualAccount, actualEditor: editor,
        authority: 'BriefAccountAdapter.facts/known -> BriefAccountPort.Known -> AccountEditor.context; raw source and actual observation timestamps remain unchanged.' };
      assert.deepEqual(storedSource.record, sourceRecord, 'The actual stored source row retains every captured account fact');
      assert.equal(storedSource.recordSetId, sourceRecord.recordSetId); assert.equal(storedSource.version, actualAccount.versions.employee);
      assert.equal(storedSource.environmentId, envId); assert.equal(storedSource.runId, runId); assert.equal(storedSource.employeeId, expected.employeeId);
      assert.deepEqual(Object.keys(expected.knownFacts).sort(), ['name', 'companyId', 'schemeId', 'gradeId', 'contract'].sort(), 'Every captured Node known-fact field is accounted for');
      for (const key of ['name', 'companyId', 'schemeId', 'gradeId']) {
        assert.equal(expected.knownFacts[key].value, actualAccount.account[key], `Actual account retains Node ${key}`);
        assert.equal(expected.knownFacts[key].sourceVersion, actualAccount.versions.employee);
      }
      assert.equal(expected.knownFacts.contract.sourceVersion, storedSource.version);
      assert.deepEqual(storedContent, Object.fromEntries(receipt.canonicalBriefFixture.editableKeys.map((key) => [key, expected[key]])),
        'The complete stored editable content equals the exact captured canonical fields');
      const providerKeys = Object.keys(sourceRecord.employeeFacts).filter((key) => key !== 'essentials');
      assert.deepEqual(Object.keys(known).sort(), ['account', 'currentContract', 'drivers', ...providerKeys].sort(), 'Every actual projected known-fact field is accounted for');
      for (const key of ['account', 'currentContract', 'drivers']) {
        assert.deepEqual(known[key].value, actualAccount[key], `AccountEditor projects actual ${key}`);
        assert.equal(known[key].source, 'manual-account'); assert.equal(known[key].editable, false);
        assert.deepEqual(known[key].sourceVersion, actualAccount.versions);
      }
      for (const key of providerKeys) {
        assert.deepEqual(known[key].value, sourceRecord.employeeFacts[key], `AccountEditor projects exact captured provider ${key}`);
        assert.equal(known[key].source, 'employee-provider'); assert.equal(known[key].editable, false);
        assert.equal(known[key].sourceVersion, editor.versions.facts);
      }
      assert.equal(editor.versions.clock, input.clock.clockVersion);
      const clock = clockRead.body.value;
      assert.equal(clock.runId, runId);
      assert.equal(clock.now, input.clock.now);
      assert.equal(clock.startsAt, input.clock.startsAt);
      assert.equal(String(clock.clockVersion), input.clock.clockVersion);
      assert.deepEqual(clock.namedTimes, input.clock.namedTimes);
      assert.equal(clock.controls.policyVersion, input.clock.policyVersion);
      const derivedTables = ['buddy_offers', 'custody_holds', 'allocation_runs'];
      const derivedCounts = Object.fromEntries(derivedTables.map((table) => [table, Number(sql(
        `SELECT count(*) FROM ${table} WHERE environment_id=${literal(envId)} AND run_id=${literal(runId)};`).split('\n').at(-1))]));
      assert.ok(Object.values(derivedCounts).every((count) => count === 0), 'No offer/hold/allocation exists before public actions');
      receipt.initialInputComparison = { actualBrief: project(actual, contentKeys), actualAccount: project(accountRead.body.value, accountKeys),
        actualContext: contextRead.body.value, actualClock: clock, identifierMapping: receipt.initialFixture.identifierMapping,
        exactPreferences: true, exactEssentials: true, exactConsent: true, exactAccount: true, exactClock: true,
        contextVersion: { frozen: input.account.contextVersion, java: accountRead.body.value.contextVersion,
          comparison: 'Opaque hashes are not equated across mapped run IDs; their account/source/slot/version inputs above are asserted.' },
        derivedCounts, stockPlan: input.stockPlan,
        fixtureAuthority: 'BuddyJourneySeed initial input pattern; explicit FUCQ-548 parent authorization; no derived state seeded' };
      return actual;
    }
    async function screenshot(page, name) {
      const destination = path.join(output, `${name}.png`);
      await page.screenshot({ path: destination, fullPage: false });
      receipt.screenshots.push({ name, path: destination, viewport: page.viewportSize() });
      return destination;
    }
    function readActualHold(offer) {
      assert.ok(offer.holdId);
      const actual = JSON.parse(sql(`SELECT json_build_object('environmentId',environment_id,'runId',run_id,'holdId',hold_id,
        'orderUuid',order_uuid,'employeeId',employee_id,'entitlementSlotId',slot_id,'type',hold_type,'state',state,
        'expiresAt',expires_at,'version',version) FROM custody_holds WHERE environment_id=${literal(envId)}
        AND run_id=${literal(runId)} AND hold_id=${literal(offer.holdId)};`).split('\n').at(-1));
      const semantic = Object.fromEntries(['orderUuid', 'employeeId', 'entitlementSlotId', 'type', 'state'].map((key) => [key, actual[key]]));
      semantic.expiresAt = new Date(actual.expiresAt).toISOString();
      assert.deepEqual(semantic, { orderUuid: offer.orderUuid, employeeId: input.initialBrief.brief.employeeId,
        entitlementSlotId: input.initialBrief.brief.entitlementSlotId, type: 'buddy-offer', state: 'active',
        expiresAt: new Date(offer.expiresAt).toISOString() }, 'The real offer has its matching active owned Buddy hold');
      receipt.actualHold = { row: actual, semantic };
      return semantic;
    }
    function readOfferPersistence(offer) {
      assert.ok(offer.offerRef.offerId && offer.holdId);
      // All three lookups use their existing environment/run primary keys; the immutable quote has no version column.
      const actual = JSON.parse(sql(`SELECT json_build_object('database',current_database(),'schema',current_schema(),
        'offer',to_jsonb(o),'quote',to_jsonb(q),'hold',to_jsonb(h)) FROM buddy_offers o
        JOIN buddy_quotes q ON q.environment_id=o.environment_id AND q.run_id=o.run_id AND q.quote_id=o.quote_id
        JOIN custody_holds h ON h.environment_id=o.environment_id AND h.run_id=o.run_id AND h.hold_id=o.hold_id
        WHERE o.environment_id=${literal(envId)} AND o.run_id=${literal(runId)}
        AND o.offer_id=${literal(offer.offerRef.offerId)} AND o.hold_id=${literal(offer.holdId)};`).split('\n').at(-1));
      assert.equal(actual.database, database[3]); assert.equal(actual.schema, schema);
      return actual;
    }
    async function releaseMainOffer(employeePage, presenterPage) {
      const catalogue = await call(presenterPage, 'GET', '/presenter/scenarios');
      assert.equal(catalogue.status, 200);
      const main = catalogue.body.value.scenarios.find((item) => item.scenarioId === 'main-successful-journey');
      assert.ok(main);
      receipt.namedReset = { observedAvailability: main.availability.available, missingCapabilities: main.availability.missingCapabilities,
        bug: 'FUCQ-562', used: false, setup: 'Authorized immutable initial-input fixture; no successful named reset claimed' };
      await prepareInitialBrief(employeePage, presenterPage);
      let clock = (await call(presenterPage, 'GET', '/presenter/controls')).body.value;
      const initialVersion = clock.clockVersion;
      await presenterPage.getByRole('button', { name: 'Next release', exact: true }).click();
      await until(async () => {
        clock = (await call(presenterPage, 'GET', '/presenter/controls')).body.value;
        return clock.clockVersion > initialVersion;
      }, 'The public Next release must complete');
      const actions = [{ action: 'Next release', observedNow: clock.now, clockVersion: clock.clockVersion }];
      const target = input.clock.nextRelease.at;
      if (Date.parse(clock.now) < Date.parse(target)) {
        const step = clock.controls.step.value;
        const seconds = (Date.parse(target) - Date.parse(clock.now)) / 1000 - step;
        assert.ok(Number.isSafeInteger(seconds) && seconds > 0);
        await presenterPage.getByText('Advanced clock controls', { exact: true }).click();
        await presenterPage.getByLabel('Seconds', { exact: true }).fill(String(seconds));
        await presenterPage.getByRole('button', { name: 'Advance clock', exact: true }).click();
        await until(async () => {
          clock = (await call(presenterPage, 'GET', '/presenter/controls')).body.value;
          return Date.parse(clock.now) === Date.parse(target) - step * 1000;
        }, 'The public advance must reach the generated window minus a step');
        await presenterPage.getByRole('button', { name: /^Step \d+ seconds$/ }).click();
        await until(async () => {
          clock = (await call(presenterPage, 'GET', '/presenter/controls')).body.value;
          return clock.now === target;
        }, 'The public tick must reach the exact captured generated release');
        actions.push({ action: 'Advanced clock advance', seconds }, { action: 'Step and tick', seconds: step });
      }
      receipt.actualReleaseClock = { now: clock.now, clockVersion: clock.clockVersion, actions };
      assert.equal(clock.now, target);
      let activity;
      await until(async () => {
        activity = await call(employeePage, 'GET', '/activity');
        return activity.status === 200 && activity.body.value.currentOffer?.state === 'active';
      }, 'Actual allocation must produce an active offer');
      const offer = activity.body.value.currentOffer;
      const projection = await call(employeePage, 'GET', `/offers/${encodeURIComponent(offer.offerRef.offerId)}`);
      const account = await call(employeePage, 'GET', '/manual/account');
      receipt.releaseReadbacks = sanitizeReadback({ activity, projection, account, clock });
      assert.equal(projection.status, 200); assert.equal(account.status, 200);
      assert.equal(account.body.value.asOf, clock.now);
      assert.equal(String(account.body.value.versions.clock), String(clock.clockVersion));
      assert.equal(projection.body.value.serverNow, clock.now);
      assert.ok(plan.windows.flatMap((window) => window.stock).some((car) => car.orderUuid === offer.orderUuid));
      const hold = readActualHold(offer);
      receipt.offer = { orderUuid: offer.orderUuid, offerId: offer.offerRef.offerId, state: offer.state, expiresAt: offer.expiresAt };
      return { offer, projection: projection.body.value, clock: receipt.actualReleaseClock, hold, account: account.body.value };
    }
    async function compareFrozenNode(expected) {
      receipt.nodeReplay = await captureNodeReplay({ browser, input, plan, cert: cert('leaf.pem'), key: cert('leaf.key'), output,
        expected: { ...expected, runId } });
      return receipt.nodeReplay;
    }
    async function visitFrozenNode(expected, visit) {
      receipt.nodeReplay = await withNodeReplay({ browser, input, plan, cert: cert('leaf.pem'), key: cert('leaf.key'), output,
        expected: { ...expected, runId } }, visit);
      return receipt.nodeReplay;
    }
    return { context, receipt, origins, apiBase, input, plan, newPage, call, prepareInitialBrief, releaseMainOffer,
      readImage: (page, locator) => imageObservers.get(page).read(locator),
      readActualHold, readOfferPersistence, restartApi, screenshot, compareFrozenNode, visitFrozenNode,
      ordering: { requests: orderingRequests, rejectPending() { assert.equal(ordering, 'unknown-then-rejected'); rejectPending = true; } }, close };
  } catch (error) {
    receipt.failure = { name: error.name, message: error.message.slice(0, 1000) };
    await close();
    throw error;
  }
}
