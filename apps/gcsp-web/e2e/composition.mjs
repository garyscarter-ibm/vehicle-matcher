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
import { captureNodeReplay } from './node-replay.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FROZEN = 'e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const canonical = (value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);

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

export async function startComposition() {
  const scratch = local(process.env.SCRATCH ?? '');
  assert.ok(scratch.startsWith('/private/tmp/'), 'The supervisor must own /private/tmp scratch');
  const output = local(process.env.GCSP_E2E_OUTPUT ?? '');
  const work = path.join(scratch, 'browser-suite');
  const dirs = Object.fromEntries(['certs', 'static', 'logs', 'tmp'].map((name) => [name, path.join(work, name)]));
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  const envId = 'e2e-' + randomUUID().slice(0, 12);
  const bootstrapRunId = 'run-1';
  const runId = 'frozen-main-replay';
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
  let closed = false;
  const receipt = { schema: 'gcsp-notification-browser/1', sourceRevision: process.env.PROOF_SOURCE_REVISION,
    reference: input.reference, composition: { origins, issuer, environmentId: envId, runId, database: database[3],
      identity: 'started Java demo issuer, code/PKCE and signed bearer validation', supply: 'tranche-plan over exact retained Node input' },
    input: { stockPlan: input.stockPlan, scenario: input.scenario, clock: input.clock },
    setupDifferences: ['Java named Main reset availability is recorded separately (FUCQ-562); no successful reset is claimed.',
      'A bootstrap run migrates the owned database, then is legally retired. A fresh replay run receives the exact initial clock before Java restarts; no clock guard is bypassed.',
      'The exact initial Main brief and consent are fixture inputs in the owned test database; public editor validation is unchanged.',
      'The frozen Node stock instance enters Java through its existing tranche-plan provider; release, allocation, holds and offers are actual services.'],
    requests: [], screenshots: [], checks: {}, browsers: {}, consoleErrors: [], processes };
  const journal = () => writeFileSync(path.join(output, 'processes.json'), JSON.stringify({ ownerPid: process.pid, processes }, null, 2));
  const schema = 'gcsp_e2e_' + randomUUID().replaceAll('-', '');
  function sql(statement) {
    return execFileSync(psql, ['-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-h', database[1], '-p', database[2] ?? '5432',
      '-U', process.env.PROOF_DB_USER ?? 'gcsp', '-d', database[3]], { env: { ...nodeEnv, PGPASSWORD: '', PGCONNECT_TIMEOUT: '10' },
      input: `SET search_path TO ${schema};\n${statement}\n`, encoding: 'utf8', timeout: 10000 }).trim();
  }
  const recordProcess = (name, child) => {
    const record = { name, ...identity(child.pid), parentPid: process.pid, ended: false };
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
    for (const action of [() => browser?.close(), () => browserServer?.close(), () => stop(api), () => server && new Promise((resolve) => {
      server.closeAllConnections?.(); server.close(resolve);
    })]) {
      try { await action(); } catch (error) { errors.push(error.message); }
    }
    receipt.cleanupErrors = errors;
    receipt.finishedAt = new Date().toISOString();
    writeFileSync(path.join(output, 'browser-receipt.json'), JSON.stringify(receipt, null, 2));
    for (const name of ['api-bootstrap.log', 'api.log']) {
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
    server = createServer({ key: readFileSync(cert('leaf.key')), cert: readFileSync(cert('leaf.pem')) }, (req, res) => {
      const requested = decodeURIComponent(new URL(req.url, origins.web).pathname);
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
      GCSP_SCENARIO_PROVIDER: 'demo', GCSP_ACCOUNT_PROVIDER: 'repository', GCSP_ORDERING_PROVIDER: 'synthetic', GCSP_RESET_ALLOWED: 'true',
      GCSP_SUPPLY_PROVIDER: 'tranche-plan', GCSP_SUPPLY_TRANCHE_PLAN_FILE: planFile,
      GCSP_CLAIMS_SWEEP_INTERVAL: '10m', GCSP_NOTIFY_DRAIN_INTERVAL: '10m', GCSP_PUBLIC_BASE_URL: 'https://gcsp-proof.example.test',
    };
    api = start('api-bootstrap', path.join(javaHome, 'bin/java'), apiArgs, apiEnv);
    // Playwright's isolated request context verifies readiness without printing issuer responses or tokens.
    const { request } = await import('playwright-core');
    const ready = await request.newContext({ ignoreHTTPSErrors: true });
    async function waitForApi() {
      let available = false;
      for (let i = 0; i < 180; i++) {
        if (api.exitCode !== null || api.signalCode) throw new Error('Java exited during startup; inspect the retained bounded API log');
        try { available = (await ready.get(`${apiBase}/context`, { timeout: 1000 })).status() === 401; } catch { /* bounded startup */ }
        if (available) break;
        await delay(500);
      }
      assert.ok(available, 'The real Java API must start');
    }
    try {
      await waitForApi();
      await stop(api);
      const initial = input.initialBrief.brief;
      const content = Object.fromEntries(['schemaVersion', 'preferences', 'essentials', 'knownFacts'].map((key) => [key, initial[key]]));
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
      receipt.initialFixture = { bootstrapRunId, replayRunId: runId, identifierMapping: { environment: envId,
        fromRun: input.reference.runId, toRun: runId }, source: 'Exact captured Main input; parent-authorized BuddyJourneySeed pattern' };
      api = start('api', path.join(javaHome, 'bin/java'), apiArgs, { ...apiEnv, GCSP_RUN_ID: runId });
      await waitForApi();
    } finally { await ready.dispose(); }
    const type = process.env.GCSP_E2E_BROWSER === 'webkit' ? webkit : chromium;
    receipt.browsers.requested = type.name();
    const executablePath = process.env.GCSP_E2E_BROWSER_PATH;
    browserServer = await type.launchServer({ headless: true, ...(executablePath ? { executablePath: local(executablePath) } : {}),
      downloadsPath: path.join(dirs.tmp, 'downloads'), timeout: 30000 });
    recordProcess('browser', browserServer.process());
    browser = await type.connect(browserServer.wsEndpoint());
    receipt.browsers.actual = browser.version();
    receipt.browsers.webkit = type.name() === 'webkit' ? 'run' : 'unrun: WebKit is not installed on this machine';
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
      const [read, accountRead, contextRead, clockRead] = await Promise.all([
        call(employeePage, 'GET', '/brief'), call(employeePage, 'GET', '/manual/account'),
        call(employeePage, 'GET', '/context'), call(presenterPage, 'GET', '/presenter/controls'),
      ]);
      for (const response of [read, accountRead, contextRead, clockRead]) assert.equal(response.status, 200);
      const expected = input.initialBrief.brief;
      const actual = read.body.value.brief;
      const project = (value, keys) => Object.fromEntries(keys.map((key) => [key, value[key]]));
      const storedPredecessorIsNull = sql(`SELECT previous_brief_version IS NULL FROM briefs WHERE environment_id=${literal(envId)}
        AND run_id=${literal(runId)} AND employee_id=${literal(expected.employeeId)} AND brief_version=1;`).split('\n').at(-1) === 't';
      assert.equal(storedPredecessorIsNull, true, 'The immutable first brief still stores its exact NULL predecessor');
      assert.ok(actual.previousBriefVersion === null || actual.previousBriefVersion === 0,
        'Only the observed first-version null/0 read discrepancy is outside this bell comparison');
      receipt.predecessorRead = { frozen: expected.previousBriefVersion, publicJava: actual.previousBriefVersion,
        storedPredecessorIsNull, difference: expected.previousBriefVersion !== actual.previousBriefVersion,
        scope: 'Only previousBriefVersion is excluded from semantic input equality; the stored value/source is unchanged.',
        derivationEvidence: [
          'Java allocation/Prepare.java:237-242 selects current brief_version/content/buddy/semantic_digest; Claim.java:130-141 checks current version and consent.',
          'Java ActivityService.java:93-101 reads the stored nullable predecessor directly with wasNull; lines204-228 use it only for state-change event consistency, independently from the offer query at113 onward.',
          'Angular activity/notification.model.ts:11-41 derives rows/count from currentOffer/offers/display; notification.source.ts does not consume brief lineage.',
          'Frozen blocks/gcsp/activity/notification-source.js:18-61 derives rows/count from currentOffer/offers/display; server/gcsp/allocation and offers contain no previousBriefVersion access.',
        ] };
      const contentKeys = ['schemaVersion', 'preferences', 'essentials', 'knownFacts', 'buddy', 'briefVersion',
        'status', 'policyVersion', 'confirmedBy'];
      assert.deepEqual(project(actual, contentKeys), project(expected, contentKeys), 'Actual Java brief/consent equals captured Node initial content');
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
    async function compareFrozenNode(expected) {
      receipt.nodeReplay = await captureNodeReplay({ browser, input, plan, cert: cert('leaf.pem'), key: cert('leaf.key'), output, expected });
      return receipt.nodeReplay;
    }
    return { context, receipt, origins, apiBase, input, plan, newPage, call, prepareInitialBrief, screenshot, compareFrozenNode, close };
  } catch (error) {
    receipt.failure = { name: error.name, message: error.message.slice(0, 1000) };
    await close();
    throw error;
  }
}
