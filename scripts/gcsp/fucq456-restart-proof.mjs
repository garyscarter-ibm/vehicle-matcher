#!/usr/bin/env node
// FUCQ-456 restart proof: the BUILT gcsp-api jar as a real process on isolated PostgreSQL databases. Zero dependencies.
// One JVM at a time. Scratch is owned by this run and removed on exit; only the small receipt is kept.
import { spawn, execFileSync } from 'node:child_process';
import { createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer as createHttps } from 'node:https';
import { request as httpRequest } from 'node:http';
import net from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, rmSync, openSync, closeSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRATCH = '/tmp/vm-poller-DEV-2026-11-13-024/s5';
const FAIL_RECEIPT = '/tmp/vm-poller-DEV-2026-11-13-024/s5-receipt-fail.json';
const RECEIPT = path.join(ROOT, 'docs/gcsp/evidence/fucq456/restart-proof-2026-11-17.json');
const JAR = path.join(ROOT, 'services/gcsp-api/target/quarkus-app/quarkus-run.jar');
const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@21';
const PG_BIN = '/opt/homebrew/opt/postgresql@17/bin';
const PG = ['-h', '127.0.0.1', '-p', '55491', '-U', 'gcsp'];
const DB_APP = 'gcsp_dev20261113024_app';
const DB_POC = 'gcsp_dev20261113024_poc';
const ISSUER = 'https://issuer.test/realms/gcsp';
const KID = 'proof-key-1';
const TRUST_PASS = 'proof-local-trust';
const DEADLINE_MS = Number(process.env.PROOF_DEADLINE_SEC ?? 540) * 1000;
const T0 = Date.now();
const dirs = { logs: path.join(SCRATCH, 'logs'), tmp: path.join(SCRATCH, 'tmp'), certs: path.join(SCRATCH, 'certs') };
const receipt = { schema: 'fucq456-restart-proof/1', story: 'DEV-2026-11-13-024 / FUCQ-456', startedAt: new Date().toISOString(), phases: {}, failureLogs: {}, deviations: [], gaps: ["Hosted Render dev (Gary's environment) not proven here"] };
const cleanups = [];
let current = null;
let finalized = false;
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (b) => Buffer.from(b).toString('base64url');
const tailOf = (file, n = 30) => { try { return readFileSync(file, 'utf8').split('\n').slice(-n).join('\n').slice(-3500); } catch { return ''; } };
const logHas = (file, re) => { try { return readFileSync(file, 'utf8').split('\n').filter((l) => re.test(l)).map((l) => l.slice(0, 220)); } catch { return []; } };

// ---------- SQL ----------
const psql = (db, sql) => execFileSync(path.join(PG_BIN, 'psql'), [...PG, '-d', db, '-Atc', sql], { encoding: 'utf8', timeout: 60000, env: { PATH: process.env.PATH, HOME: process.env.HOME, PGOPTIONS: '-c search_path=gcsp_app' } }).trim();
const num = (db, sql) => Number(psql(db, sql));
const activeRun = (db) => psql(db, "select run_id from runs where status = 'active'");
const digestSql = "select md5(string_agg(table_name || ':' || (xpath('/row/c/text()', query_to_xml(format('select md5(coalesce(string_agg(t::text, ''|'' order by t::text), '''')) as c from gcsp_app.%I t', table_name), false, true, '')))[1]::text, ',' order by table_name)) from information_schema.tables where table_schema = 'gcsp_app' and table_type = 'BASE TABLE'";
const digest = (db) => psql(db, digestSql);
const receiptsFor = (db, commandId) => num(db, `select count(*) from command_receipts where command_id = '${commandId}'`);
const runReceipts = (db, run) => num(db, `select count(*) from command_receipts where run_id = '${run}' and command_type not like 'clock.tick.%'`);
const tickReceipts = (db, run) => num(db, `select count(*) from command_receipts where run_id = '${run}' and command_type like 'clock.tick.%'`);
const revisionOf = (db) => num(db, "select revision from runs where status = 'active'");
// Business state: non-tick receipts, clock instant and version (tick metadata moves each start), employees and entitlements; the startup tick legitimately adds tick receipts per start.
const stateDigest = (db) => psql(db, "select md5(coalesce((select string_agg(x::text, '|' order by x::text) from command_receipts x where command_type not like 'clock.tick.%'), '') || coalesce((select string_agg(c.run_id || c.clock_instant::text || c.clock_version::text, '|' order by c.run_id) from run_clocks c), '') || coalesce((select string_agg(e::text, '|' order by e::text) from employees e), ''))");
const runReceiptDigest = (db, run) => psql(db, `select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from command_receipts x where x.run_id = '${run}'`);

// ---------- tokens and JWKS (https: the built app allows http JWKS only in test launch mode) ----------
const keys = (() => { const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }); return { privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' } }; })();
function signJwt(payload) {
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID }));
  const body = b64u(JSON.stringify(payload));
  return `${head}.${body}.${b64u(createSign('RSA-SHA256').update(`${head}.${body}`).sign(keys.privateKey))}`;
}
function token(sub, role) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ iss: ISSUER, aud: 'gcsp-api', sub, azp: 'gcsp-web', scope: 'openid gcsp-api', realm_access: { roles: [role] }, iat: now, exp: now + 600, jti: randomBytes(6).toString('hex') });
}
const TOKENS = { presenter: () => token('sub-presenter', 'presenter'), greg: () => token('sub-greg', 'greg'), paula: () => token('sub-paula', 'employee') };
const ACCOUNTS = JSON.stringify([{ subject: 'sub-presenter', roles: ['presenter'] }, { subject: 'sub-greg', roles: ['greg'] }, { subject: 'sub-paula', roles: ['employee'], employeeId: 'employee-paula' }]);

function makeTls() {
  const c = (f) => path.join(dirs.certs, f);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', c('jwks.key'), '-out', c('jwks.pem'), '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE'], { stdio: 'pipe', timeout: 60000 });
  execFileSync(path.join(JAVA_HOME, 'bin/keytool'), ['-importcert', '-alias', 'proof-jwks', '-file', c('jwks.pem'), '-keystore', c('truststore.p12'), '-storetype', 'PKCS12', '-storepass', TRUST_PASS, '-noprompt'], { stdio: 'pipe', timeout: 60000 });
  return { key: readFileSync(c('jwks.key')), cert: readFileSync(c('jwks.pem')), trust: c('truststore.p12') };
}
async function startJwks(tls) {
  const body = JSON.stringify({ keys: [keys.jwk] });
  const server = createHttps({ key: tls.key, cert: tls.cert }, (req, res) => {
    if (req.url === '/jwks') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(body); } else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); setTimeout(r, 1000); }));
  return `https://127.0.0.1:${server.address().port}/jwks`;
}

// ---------- the app as a process ----------
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const killGroup = (app, sig) => { try { process.kill(-app.child.pid, sig); } catch { try { app.child.kill(sig); } catch { /* gone */ } } };

function composition(kind, jwksUri, over = {}) {
  const dev = kind === 'dev';
  const env = {
    GCSP_IDENTITY_PROVIDER: 'oidc', GCSP_OIDC_ISSUER: ISSUER, GCSP_OIDC_JWKS_URI: jwksUri, GCSP_OIDC_AUDIENCE: 'gcsp-api', GCSP_OIDC_AUTHORIZED_PARTY: 'gcsp-web',
    GCSP_OIDC_REQUIRED_SCOPES: 'gcsp-api', GCSP_OIDC_ACCOUNTS: ACCOUNTS, GCSP_ENVIRONMENT_ID: dev ? 'isolated-dev' : 'gcsp-poc', GCSP_RUN_ID: 'run-1',
    GCSP_POLICY_VERSION: 'gcsp-policy-v1', GCSP_SUPPLY_PROVIDER: 'demo', GCSP_ALLOCATION_CANDIDATES_PROVIDER: 'recommendation', GCSP_ORDERING_PROVIDER: 'synthetic',
    GCSP_APPROVALS_PROVIDER: 'synthetic', GCSP_DOCUMENTS_PROVIDER: 'synthetic', GCSP_APPOINTMENTS_PROVIDER: 'synthetic', GCSP_RETURNS_PROVIDER: 'synthetic',
    GCSP_ALLOWED_ORIGINS: 'http://127.0.0.1:1', GCSP_SHUTDOWN_TIMEOUT: '10s', GCSP_DATABASE_USER: 'gcsp', GCSP_DATABASE_PASSWORD: '',
    GCSP_DATABASE_URL: `jdbc:postgresql://127.0.0.1:55491/${dev ? DB_APP : DB_POC}`, GCSP_EXPECTED_DATABASE: dev ? DB_APP : DB_POC,
    ...(dev ? { GCSP_ACCOUNT_PROVIDER: 'repository', GCSP_SCENARIO_PROVIDER: 'demo', GCSP_RESET_ALLOWED: 'true' } : {}),
  };
  return { ...env, ...over };
}

async function startApp(name, trust, env) {
  if (current && !current.exited) throw new Error(`refusing to start ${name}: ${current.name} is still running (one JVM at a time)`);
  const port = await freePort();
  const logFile = path.join(dirs.logs, `${name}.log`);
  const fd = openSync(logFile, 'a');
  const child = spawn(path.join(JAVA_HOME, 'bin/java'), ['-Xmx384m', `-Djavax.net.ssl.trustStore=${trust}`, `-Djavax.net.ssl.trustStorePassword=${TRUST_PASS}`, `-Djava.io.tmpdir=${dirs.tmp}`, '-jar', JAR],
    { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, JAVA_HOME, TMPDIR: dirs.tmp, TMP: dirs.tmp, TEMP: dirs.tmp, PORT: String(port), ...env }, stdio: ['ignore', fd, fd], detached: true });
  closeSync(fd);
  const app = { name, port, child, logFile, exited: false, exitCode: null, signal: null };
  app.done = new Promise((r) => child.on('exit', (code, signal) => { app.exited = true; app.exitCode = code; app.signal = signal; r(); }));
  current = app;
  cleanups.push(async () => { if (!app.exited) { killGroup(app, 'SIGKILL'); await Promise.race([app.done, sleep(5000)]); } });
  log(`start ${name} on port ${port}`);
  return app;
}
async function waitReady(app) {
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    if (app.exited) throw new Error(`${app.name} exited during startup (code ${app.exitCode} signal ${app.signal})`);
    try { const r = await call(app, 'GET', '/q/health/ready'); if (r.status === 200) return persistenceCheck(r.json); } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`${app.name} not ready within 90 s`);
}
const persistenceCheck = (j) => { const c = (j?.checks ?? []).find((x) => x.name === 'persistence'); return { status: j?.status, state: c?.data?.state, environmentId: c?.data?.environmentId, runId: c?.data?.runId }; };
async function stopApp(app) {
  if (app.exited) return { exitCode: app.exitCode, signal: app.signal, forced: false };
  killGroup(app, 'SIGTERM');
  await Promise.race([app.done, sleep(15000)]);
  let forced = false;
  if (!app.exited) { forced = true; killGroup(app, 'SIGKILL'); await Promise.race([app.done, sleep(5000)]); }
  const clean = logHas(app.logFile, /stopped in|Shutting down/i);
  return { exitCode: app.exitCode, signal: app.signal, forced, shutdownLog: clean.slice(-2) };
}

// ---------- HTTP ----------
function call(app, method, urlPath, tok, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) };
    const req = httpRequest({ host: '127.0.0.1', port: app.port, method, path: urlPath, headers, agent: false, timeout: 30000 }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(raw); } catch { /* not json */ } resolve({ status: res.statusCode, json, raw }); });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('request timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}
const API = '/api/gcsp/v1';
const presenter = (app, method, p, body) => call(app, method, `${API}${p}`, TOKENS.presenter(), body);
const clockVersion = async (app) => (await presenter(app, 'GET', '/presenter/clock')).json?.value?.clockVersion;
const advanceBody = (commandId, version, bySeconds) => ({ commandId, expectedClockVersion: version, bySeconds });
const advance = (app, commandId, version, bySeconds) => presenter(app, 'POST', '/presenter/clock/advance', advanceBody(commandId, version, bySeconds));
const brief = (r) => ({ status: r.status, code: r.json?.code, clockVersion: r.json?.value?.clockVersion, now: r.json?.value?.now, currentVersion: r.json?.currentVersion });
async function resetBody(app, commandId, expectedRunId) {
  const c = (await presenter(app, 'GET', '/presenter/scenarios')).json;
  const s = (c?.value?.scenarios ?? []).find((x) => x.scenarioId === 'gcsp-clock-scenario-v1');
  if (!s) throw new Error('clock scenario not in catalogue');
  return { commandId, expectedRunId, scenarioVersion: s.scenarioVersion, fixtureVersion: s.fixtureVersion, policyVersion: s.policyVersion };
}

// ---------- phases ----------
function phase(id, title) {
  const ph = { title, checks: [], observed: {} };
  receipt.phases[id] = ph;
  ph.check = (name, ok, observed) => { ph.checks.push({ name, ok: !!ok, ...(observed === undefined ? {} : { observed }) }); if (!ok) log(`  CHECK FAILED ${id}: ${name} ${JSON.stringify(observed)}`); };
  ph.finish = () => { ph.pass = ph.error === undefined && ph.checks.every((c) => c.ok); log(`${id} ${ph.pass ? 'PASS' : 'FAIL'} ${title}`); return ph.pass; };
  return ph;
}
const shutdownOk = (s) => (s.exitCode === 0 || s.exitCode === 143) && !s.forced && (s.shutdownLog?.length ?? 0) > 0;

async function main() {
  mkdirSync(dirs.logs, { recursive: true }); mkdirSync(dirs.tmp, { recursive: true }); mkdirSync(dirs.certs, { recursive: true });
  const foreign = safePgrep();
  if (foreign) throw new Error(`another quarkus-run.jar process is running; refusing to start: ${foreign}`);
  const tls = makeTls();
  const jwksUri = await startJwks(tls);
  receipt.codeRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  receipt.java = execFileSync(path.join(JAVA_HOME, 'bin/java'), ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) || '';
  receipt.postgres = psql('postgres', 'select version()').slice(0, 60);
  receipt.node = process.version;
  receipt.deviations.push('JWKS is served over https with a local self-signed certificate (trust store passed to the JVM): the built app allows http JWKS only in test launch mode. Local test issuer only, not the real provider.');

  // P0
  let ph = phase('P0', 'Fresh databases (only the two owned ones)');
  for (const db of [DB_APP, DB_POC]) {
    execFileSync(path.join(PG_BIN, 'dropdb'), [...PG, '--if-exists', db], { stdio: 'pipe', timeout: 60000 });
    execFileSync(path.join(PG_BIN, 'createdb'), [...PG, db], { stdio: 'pipe', timeout: 60000 });
  }
  ph.check('both databases created empty', psql(DB_APP, "select count(*) from information_schema.tables where table_schema = 'gcsp_app'") === '0' && psql(DB_POC, "select count(*) from information_schema.tables where table_schema = 'gcsp_app'") === '0', [DB_APP, DB_POC]);
  if (!ph.finish()) return;

  // P1
  ph = phase('P1', 'Running composition (poc stand-in): first start, advance, reset refused, clean stop');
  let app = await startApp('p1-poc', tls.trust, composition('poc', jwksUri));
  const ready1 = await waitReady(app);
  ph.observed.readiness = ready1;
  ph.check('readiness ready, env gcsp-poc, run-1', ready1.state === 'ready' && ready1.environmentId === 'gcsp-poc' && ready1.runId === 'run-1', ready1);
  const migrations = num(DB_POC, 'select count(*) from flyway_schema_history where success');
  ph.observed.migrationsApplied = migrations;
  ph.check('Flyway applied all migrations', migrations > 10 && logHas(app.logFile, /Successfully applied \d+ migration/i).length > 0, { migrations, line: logHas(app.logFile, /Successfully applied \d+ migration/i)[0] });
  ph.check('reset_allowed=false', psql(DB_POC, 'select reset_allowed from environment_identity') === 'f', psql(DB_POC, 'select reset_allowed from environment_identity'));
  const pv = await clockVersion(app);
  const pAdv = await advance(app, 'poc-adv-1', pv, 60);
  ph.observed.advance = brief(pAdv);
  ph.check('presenter advance 200', pAdv.status === 200 && pAdv.json?.value?.clockVersion === pv + 1, brief(pAdv));
  ph.observed.receipt = { 'clock:advance:poc-adv-1': receiptsFor(DB_POC, 'clock:advance:poc-adv-1'), revision: num(DB_POC, "select revision from runs where status = 'active'") };
  ph.check('advance receipt stored', ph.observed.receipt['clock:advance:poc-adv-1'] === 1, ph.observed.receipt);
  const before = digest(DB_POC);
  const refused = await presenter(app, 'POST', '/presenter/clock/reset', await resetBody(app, 'poc-reset-1', 'run-1').catch(() => ({ commandId: 'poc-reset-1', expectedRunId: 'run-1', scenarioVersion: 'v', fixtureVersion: 'v', policyVersion: 'v' })));
  ph.observed.resetAttempt = brief(refused);
  ph.check('presenter reset refused with 403', refused.status === 403, brief(refused));
  ph.check('poc digest unchanged by the refusal', digest(DB_POC) === before);
  let stop = await stopApp(app);
  ph.observed.stop = stop;
  ph.check('SIGTERM stop clean', shutdownOk(stop), stop);
  const D_poc = digest(DB_POC);
  ph.observed.pocDigest = D_poc;
  if (!ph.finish()) return;

  // P2
  ph = phase('P2', 'Dev composition: first start, seed, advance, concurrent writers');
  const devEnv = composition('dev', jwksUri);
  app = await startApp('p2-dev', tls.trust, devEnv);
  const ready2 = await waitReady(app);
  ph.observed.readiness = ready2;
  ph.check('readiness env isolated-dev run-1', ready2.state === 'ready' && ready2.environmentId === 'isolated-dev' && ready2.runId === 'run-1', ready2);
  ph.check('reset_allowed=true', psql(DB_APP, 'select reset_allowed from environment_identity') === 't');
  const employees2 = num(DB_APP, 'select count(*) from employees');
  ph.observed.employees = employees2;
  ph.check('demo people seeded', employees2 > 0, employees2);
  let v0 = await clockVersion(app);
  const rev2 = revisionOf(DB_APP);
  const a1 = await advance(app, 'proof-a1', v0, 60);
  ph.check('A1 advance 200', a1.status === 200 && a1.json?.value?.clockVersion === v0 + 1, brief(a1));
  const a1Result = brief(a1);
  const v1 = v0 + 1;
  const [r1, r2] = await Promise.all([advance(app, 'proof-c1', v1, 30), advance(app, 'proof-c2', v1, 45)]);
  const wins = [r1, r2].filter((r) => r.status === 200), stale = [r1, r2].filter((r) => r.status === 409);
  ph.observed.race = [brief(r1), brief(r2)];
  ph.check('exactly one 200 and one 409 stale-version', wins.length === 1 && stale.length === 1 && stale[0].json?.code === 'stale-version', ph.observed.race);
  const v2 = await clockVersion(app);
  const rec2 = runReceipts(DB_APP, 'run-1');
  const raceReceipts = receiptsFor(DB_APP, 'clock:advance:proof-c1') + receiptsFor(DB_APP, 'clock:advance:proof-c2');
  ph.observed.state = { clockVersion: v2, revision: revisionOf(DB_APP), businessReceipts: rec2, startupTickReceipts: tickReceipts(DB_APP, 'run-1'), raceReceipts };
  ph.check('clock moved by two steps, one race receipt', v2 === v0 + 2 && raceReceipts === 1, ph.observed.state);
  stop = await stopApp(app);
  const digestDev2 = stateDigest(DB_APP);
  ph.observed.devStateDigest = digestDev2;
  ph.check('SIGTERM stop clean', shutdownOk(stop), stop);
  if (!ph.finish()) return;

  // P3
  ph = phase('P3', 'Normal restart: nothing re-seeded, nothing lost, replays are replays');
  app = await startApp('p3-dev', tls.trust, devEnv);
  const ready3 = await waitReady(app);
  ph.observed.readiness = ready3;
  ph.check('readiness same env and run', ready3.state === 'ready' && ready3.environmentId === 'isolated-dev' && ready3.runId === 'run-1', ready3);
  const flyway = logHas(app.logFile, /up to date|No migration necessary/i);
  ph.check('Flyway: schema up to date, nothing applied', flyway.length > 0 && logHas(app.logFile, /Successfully applied \d+ migration/i).length === 0, flyway[0]);
  ph.check('clock version unchanged', (await clockVersion(app)) === v2, v2);
  const rev3 = revisionOf(DB_APP);
  ph.observed.startupTick = { revisionBeforeRestart: rev2, revisionAfterRestart: rev3, note: 'each start runs a documented startup clock tick (tick receipts only)' };
  ph.check('business receipts unchanged by the restart', runReceipts(DB_APP, 'run-1') === rec2, { rec2 });
  const replay = await advance(app, 'proof-a1', v0, 60);
  ph.observed.replayA1 = brief(replay);
  ph.check('replay of a1: 200, same result', replay.status === 200 && replay.json?.value?.clockVersion === a1Result.clockVersion && replay.json?.value?.now === a1Result.now, { first: a1Result, replay: brief(replay) });
  ph.check('replay changed nothing (revision, receipts, clock)', revisionOf(DB_APP) === rev3 && runReceipts(DB_APP, 'run-1') === rec2 && (await clockVersion(app)) === v2, { revision: rev3 });
  const changed = await advance(app, 'proof-a1', v0, 61);
  ph.observed.changedInput = brief(changed);
  ph.check('same id, different bySeconds: 409 command-input-changed', changed.status === 409 && changed.json?.code === 'command-input-changed', brief(changed));
  ph.check('employees not re-seeded', num(DB_APP, 'select count(*) from employees') === employees2, employees2);
  ph.check('business state digest identical across the normal restart, replay and refused edit', stateDigest(DB_APP) === digestDev2);
  if (!ph.finish()) return;

  // P4: the JVM stays up from P3 for this phase.
  ph = phase('P4', 'Interrupted command: SIGKILL right after the request is written, then resend');
  const v3 = await clockVersion(app);
  const recBefore = runReceipts(DB_APP, 'run-1');
  const a2 = advanceBody('proof-a2', v3, 75);
  const interrupted = await sendAndKill(app, `${API}/presenter/clock/advance`, TOKENS.presenter(), JSON.stringify(a2));
  await Promise.race([app.done, sleep(10000)]);
  ph.observed.interrupted = { ...interrupted, jvmExit: { code: app.exitCode, signal: app.signal } };
  ph.check('JVM was killed (SIGKILL)', app.exited && app.signal === 'SIGKILL', ph.observed.interrupted.jvmExit);
  ph.check('caller got no response (does not know the outcome)', interrupted.gotResponse === false, interrupted);
  const committedBeforeResend = receiptsFor(DB_APP, 'clock:advance:proof-a2');
  ph.observed.receiptAfterKill = committedBeforeResend;
  app = await startApp('p4-dev', tls.trust, devEnv);
  const ready4 = await waitReady(app);
  ph.check('restart ready on run-1', ready4.state === 'ready' && ready4.runId === 'run-1', ready4);
  const resend = await advance(app, 'proof-a2', v3, 75);
  ph.observed.resend = brief(resend);
  ph.check('resend with the same body answers 200 at the next version', resend.status === 200 && resend.json?.value?.clockVersion === v3 + 1, brief(resend));
  ph.observed.outcome = committedBeforeResend === 1 ? 'committed before the kill; resend returned the stored result' : 'not committed before the kill; resend committed it for the first time';
  ph.check('exactly one receipt for clock:advance:proof-a2', receiptsFor(DB_APP, 'clock:advance:proof-a2') === 1, receiptsFor(DB_APP, 'clock:advance:proof-a2'));
  ph.check('clock moved by exactly one step overall', (await clockVersion(app)) === v3 + 1 && runReceipts(DB_APP, 'run-1') === recBefore + 1, { clockVersion: v3 + 1, receipts: recBefore + 1 });
  const again = await advance(app, 'proof-a2', v3, 75);
  ph.check('a second resend is still the same single effect', again.status === 200 && again.json?.value?.clockVersion === v3 + 1 && receiptsFor(DB_APP, 'clock:advance:proof-a2') === 1, brief(again));
  if (!ph.finish()) return;

  // P5
  ph = phase('P5', 'Presenter reset on dev: authority survives restart, nothing deleted');
  const oldRun = activeRun(DB_APP);
  const body = await resetBody(app, 'proof-reset-1', oldRun);
  const rs1 = await presenter(app, 'POST', '/presenter/clock/reset', body);
  const newRun = rs1.json?.value?.activatedRunId;
  ph.observed.reset = { status: rs1.status, retiredRunId: rs1.json?.value?.retiredRunId, activatedRunId: newRun, replayed: rs1.json?.value?.replayed };
  ph.check('reset 200: retired run-1, activated a new run', rs1.status === 200 && rs1.json?.value?.retiredRunId === 'run-1' && !!newRun && newRun !== 'run-1' && rs1.json?.value?.replayed === false, ph.observed.reset);
  const rs2 = await presenter(app, 'POST', '/presenter/clock/reset', body);
  ph.observed.resetReplay = { status: rs2.status, retiredRunId: rs2.json?.value?.retiredRunId, activatedRunId: rs2.json?.value?.activatedRunId, replayed: rs2.json?.value?.replayed };
  ph.check('same reset id replays the same pair', rs2.status === 200 && rs2.json?.value?.replayed === true && rs2.json?.value?.retiredRunId === 'run-1' && rs2.json?.value?.activatedRunId === newRun, ph.observed.resetReplay);
  const emp = await call(app, 'POST', `${API}/presenter/clock/reset`, TOKENS.paula(), body);
  ph.observed.employeeReset = brief(emp);
  ph.check('employee token reset: 403', emp.status === 403, brief(emp));
  const oldReceipts = num(DB_APP, `select count(*) from command_receipts where run_id = '${oldRun}'`);
  const oldDigest = runReceiptDigest(DB_APP, oldRun);
  stop = await stopApp(app);
  ph.check('SIGTERM stop clean', shutdownOk(stop), stop);
  app = await startApp('p5-dev', tls.trust, devEnv);
  const ready5 = await waitReady(app);
  ph.observed.readinessAfterRestart = ready5;
  ph.check('readiness shows the NEW run after restart', ready5.state === 'ready' && ready5.runId === newRun, ready5);
  ph.check('presenter clock follows the new run', (await presenter(app, 'GET', '/presenter/clock')).json?.value?.runId === newRun);
  ph.check('exactly one active run, run-1 retired', psql(DB_APP, "select string_agg(run_id || ':' || status, ',' order by run_id) from runs") === [oldRun + ':retired', newRun + ':active'].sort().join(','), psql(DB_APP, "select string_agg(run_id || ':' || status, ',' order by run_id) from runs"));
  const oldAfter = num(DB_APP, `select count(*) from command_receipts where run_id = '${oldRun}'`);
  ph.observed.run1Receipts = { beforeRestart: oldReceipts, afterRestart: oldAfter };
  ph.check('run-1 receipts still present and byte-identical', oldAfter === oldReceipts && runReceiptDigest(DB_APP, oldRun) === oldDigest, ph.observed.run1Receipts);
  stop = await stopApp(app);
  ph.check('SIGTERM stop clean', shutdownOk(stop), stop);
  if (!ph.finish()) return;

  // P6
  ph = phase('P6', 'Isolation: the running database is untouched and guards refuse a wrong pairing');
  const pocNow = digest(DB_POC);
  ph.observed.pocDigest = { before: D_poc, afterDevActivity: pocNow };
  ph.check('poc digest equals D_poc after all dev activity and reset', pocNow === D_poc);
  let g = await startApp('p6-mismatch', tls.trust, composition('dev', jwksUri, { GCSP_DATABASE_URL: `jdbc:postgresql://127.0.0.1:55491/${DB_POC}` }));
  await Promise.race([g.done, sleep(90000)]);
  const mismatchLines = logHas(g.logFile, /EnvironmentMismatch/);
  ph.observed.dbMismatch = { exitCode: g.exitCode, signal: g.signal, line: mismatchLines[0] };
  if (!g.exited) await stopApp(g);
  ph.check('dev env on the poc database exits non-zero in startup with EnvironmentMismatch', g.exited && g.exitCode !== 0 && g.exitCode !== null && mismatchLines.length > 0, ph.observed.dbMismatch);
  g = await startApp('p6-scenario', tls.trust, composition('poc', jwksUri, { GCSP_SCENARIO_PROVIDER: 'demo', GCSP_RESET_ALLOWED: 'true' }));
  let refused6 = null; let started6 = false;
  try { await waitReady(g); started6 = true; } catch (e) { refused6 = e.message; }
  if (started6) {
    const body6 = await resetBody(g, 'poc-reset-6', 'run-1').catch(() => null);
    const r6 = body6 ? await presenter(g, 'POST', '/presenter/clock/reset', body6) : null;
    ph.observed.scenarioDemoOnPoc = { started: true, reset: r6 && brief(r6) };
    ph.check('if started: reset refused 403 reset-not-allowed', r6 && r6.status === 403 && r6.json?.code === 'reset-not-allowed', r6 && brief(r6));
    await stopApp(g);
  } else {
    const lines = logHas(g.logFile, /ERROR|Exception|refus|reset/i).slice(0, 4);
    ph.observed.scenarioDemoOnPoc = { started: false, exitCode: g.exitCode, reason: refused6, lines };
    ph.check('startup refused (non-zero exit)', g.exited && g.exitCode !== 0 && g.exitCode !== null, ph.observed.scenarioDemoOnPoc);
    if (!g.exited) await stopApp(g);
  }
  ph.check('poc digest equals D_poc at the end', digest(DB_POC) === D_poc);
  ph.finish();
}

function sendAndKill(app, urlPath, tok, bodyStr) {
  return new Promise((resolve) => {
    const text = `POST ${urlPath} HTTP/1.1\r\nHost: 127.0.0.1:${app.port}\r\nAuthorization: Bearer ${tok}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(bodyStr)}\r\nConnection: close\r\n\r\n${bodyStr}`;
    const out = { gotResponse: false, socketError: null, bytesWritten: Buffer.byteLength(text) };
    const s = net.connect(app.port, '127.0.0.1');
    const timer = setTimeout(() => { s.destroy(); resolve(out); }, 15000);
    s.on('data', () => { out.gotResponse = true; });
    s.on('error', (e) => { out.socketError = e.code ?? e.message; });
    s.on('close', () => { clearTimeout(timer); resolve(out); });
    s.on('connect', () => s.write(text, () => killGroup(app, 'SIGKILL')));
  });
}
function safePgrep() { try { return execFileSync('pgrep', ['-fl', 'quarkus-run.jar'], { encoding: 'utf8' }).trim(); } catch { return ''; } }

// ---------- finish ----------
async function finalize(exitCode) {
  if (finalized) return; finalized = true;
  for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* best effort */ } }
  const leftover = safePgrep();
  receipt.finishedAt = new Date().toISOString();
  receipt.pass = exitCode === 0 && Object.values(receipt.phases).length === 7 && Object.values(receipt.phases).every((p) => p.pass);
  receipt.jvmsLeft = leftover ? 'present' : 'none';
  if (!receipt.pass) for (const f of ['p1-poc', 'p2-dev', 'p3-dev', 'p4-dev', 'p5-dev', 'p6-mismatch', 'p6-scenario']) { const t = tailOf(path.join(dirs.logs, `${f}.log`), 25); if (t) receipt.failureLogs[f] = t; }
  if (!receipt.pass) receipt.failureLogs = Object.fromEntries(Object.entries(receipt.failureLogs).slice(-3));
  else delete receipt.failureLogs;
  const out = receipt.pass ? RECEIPT : FAIL_RECEIPT;
  mkdirSync(path.dirname(out), { recursive: true });
  const text = JSON.stringify(receipt, null, 2) + '\n';
  writeFileSync(`${out}.tmp`, text); renameSync(`${out}.tmp`, out);
  rmSync(SCRATCH, { recursive: true, force: true });
  log(`receipt ${out} (${text.length} bytes); overall ${receipt.pass ? 'PASS' : 'FAIL'}; scratch removed`);
  process.exit(receipt.pass ? 0 : 1);
}
const deadline = setTimeout(async () => { log('run deadline reached'); receipt.deviations.push('run deadline reached'); await finalize(2); }, DEADLINE_MS);
deadline.unref();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => finalize(2));
main().then(() => finalize(0), (e) => { log('ERROR', e.stack ?? e); const last = Object.values(receipt.phases).at(-1); if (last && last.pass === undefined) { last.error = String(e.message ?? e); last.pass = false; } finalize(1); });
