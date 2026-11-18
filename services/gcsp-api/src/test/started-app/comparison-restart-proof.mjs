// Started-app proof for FUCQ-480 AC2: the packaged jar, documented env, real RS256 JWTs, native PostgreSQL, a crash and a
// graceful stop. Usage: node comparison-restart-proof.mjs --jar <quarkus-run.jar> --db-url <jdbc> --db-name <name> --scratch <dir> --out <summary.json>
// The only non-env override is -Dgcsp.mail.brevo.endpoint (the fake Brevo is loopback https); everything else is documented env.
import { spawn, execFileSync, execFile } from 'node:child_process';
import { createServer as httpsServer } from 'node:https';
import { createServer as netServer } from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
for (const k of ['jar', 'db-url', 'db-name', 'scratch', 'out']) if (!args[k]) { console.error(`missing --${k}`); process.exit(2); }
const JAVA = process.env.JAVA_BIN || '/opt/homebrew/opt/openjdk@21/bin/java';
const KEYTOOL = process.env.KEYTOOL_BIN || '/opt/homebrew/opt/openjdk@21/bin/keytool';
const PSQL = process.env.PSQL_BIN || '/opt/homebrew/opt/postgresql@17/bin/psql';
const dbUrl = new URL(args['db-url'].replace(/^jdbc:/, ''));
const dbPort = dbUrl.port, dbUser = dbUrl.searchParams.get('user');
const ISSUER = 'https://proof.invalid/realms/gcsp', AUDIENCE = 'gcsp-api', AZP = 'gcsp-proof', SCOPE = 'gcsp', KID = 'proof-key-1';
const TRUST_PW = 'proof-trust';
const RETAINED_ID = 'process-comparison-94c7760154fa5a05d5d6dc9b7c768fa0';
const INTERRUPTED_RESTART = 'The backend restarted before the comparison finished.';
const INTERRUPTED_STOP = 'The backend stopped before the comparison finished.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const summary = { ok: false, phases: {}, checks: [], mailCalls: null, outboxRows: null, jobs: null, leftoverScratchSchemas: null,
  appStartSeconds: {}, javaFlags: [], envKeys: [], note: 'brevo endpoint is the only non-env override (-Dgcsp.mail.brevo.endpoint); fake JWKS and Brevo share one loopback https server' };
const children = new Set();
let mailCalls = 0, jwksCalls = 0;

function check(name, expected, actual, pass) {
  const ok = pass === undefined ? JSON.stringify(expected) === JSON.stringify(actual) : pass;
  summary.checks.push({ name, expected, actual, pass: !!ok });
  if (!ok) console.error(`FAIL ${name}: expected ${JSON.stringify(expected)} actual ${JSON.stringify(actual)}`);
  return !!ok;
}
function writeSummary() {
  summary.mailCalls = mailCalls; summary.jwksCalls = jwksCalls;
  summary.ok = summary.checks.length > 0 && summary.checks.every((c) => c.pass);
  summary.failingChecks = summary.checks.filter((c) => !c.pass).map((c) => c.name);
  fs.writeFileSync(args.out, JSON.stringify(summary, null, 2));
}
function killAll() { for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } } }
process.on('exit', killAll);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { killAll(); process.exit(130); });

// ---- TLS material, fake JWKS + Brevo ----
const scratch = path.resolve(args.scratch);
fs.mkdirSync(scratch, { recursive: true });
const certPem = path.join(scratch, 'cert.pem'), keyPem = path.join(scratch, 'key.pem'), trustP12 = path.join(scratch, 'trust.p12');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPem, '-out', certPem, '-days', '2',
  '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
fs.rmSync(trustP12, { force: true });
execFileSync(KEYTOOL, ['-importcert', '-alias', 'proof', '-file', certPem, '-keystore', trustP12, '-storetype', 'PKCS12',
  '-storepass', TRUST_PW, '-noprompt'], { stdio: 'ignore' });
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

const fake = httpsServer({ key: fs.readFileSync(keyPem), cert: fs.readFileSync(certPem) }, (req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    if (req.url === '/jwks') { jwksCalls++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ keys: [jwk] })); return; }
    if (req.url === '/v3/smtp/email') { mailCalls++; res.writeHead(201, { 'content-type': 'application/json' }); res.end('{"messageId":"x"}'); return; }
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const fakePort = fake.address().port;

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function token(sub, role) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT', kid: KID });
  const body = b64({ iss: ISSUER, aud: AUDIENCE, azp: AZP, scope: SCOPE, sub, iat: now, exp: now + 600, realm_access: { roles: [role] } });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}
const WHO = { greg: () => token('sub-greg', 'greg'), presenter: () => token('sub-presenter', 'presenter'), employee: () => token('sub-employee', 'employee'), none: () => null };

async function freePort() {
  return new Promise((resolve) => { const s = netServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

// ---- app process ----
let appPort = 0;
function appEnv(extra) {
  return {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || scratch, PORT: String(appPort),
    GCSP_IDENTITY_PROVIDER: 'oidc', GCSP_OIDC_ISSUER: ISSUER, GCSP_OIDC_JWKS_URI: `https://127.0.0.1:${fakePort}/jwks`,
    GCSP_OIDC_AUDIENCE: AUDIENCE, GCSP_OIDC_AUTHORIZED_PARTY: AZP, GCSP_OIDC_REQUIRED_SCOPES: SCOPE,
    GCSP_OIDC_ACCOUNTS: JSON.stringify([{ subject: 'sub-greg', roles: ['greg'] }, { subject: 'sub-presenter', roles: ['presenter'] },
      { subject: 'sub-employee', roles: ['employee'], employeeId: 'emp-proof-1' }]),
    GCSP_ENVIRONMENT_ID: 'proof-env', GCSP_RUN_ID: 'run-1', GCSP_POLICY_VERSION: 'gcsp-policy-v1',
    GCSP_DATABASE_URL: args['db-url'], GCSP_EXPECTED_DATABASE: args['db-name'], GCSP_RESET_ALLOWED: 'true',
    GCSP_MAIL_TRANSPORT: 'brevo', GCSP_BREVO_API_KEY: 'proof-fake-key', GCSP_MAIL_FROM: 'noreply@proof.invalid',
    GCSP_MAIL_FROM_NAME: 'GCSP Proof', GCSP_PUBLIC_BASE_URL: 'https://proof.invalid', ...extra,
  };
}
const javaFlags = () => ['-Xmx2g', `-Djavax.net.ssl.trustStore=${trustP12}`, '-Djavax.net.ssl.trustStorePassword=<redacted>',
  `-Dgcsp.mail.brevo.endpoint=https://127.0.0.1:${fakePort}/v3/smtp/email`];
async function api(who, method, p, body) {
  const headers = { accept: 'application/json' };
  const t = WHO[who](); if (t) headers.authorization = `Bearer ${t}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`http://127.0.0.1:${appPort}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { http: res.status, json, text: text.slice(0, 300) };
}
async function startApp(label, extra) {
  appPort = await freePort();
  const env = appEnv(extra);
  summary.envKeys = [...new Set([...summary.envKeys, ...Object.keys(env)])].sort();
  const flags = javaFlags(); summary.javaFlags = flags;
  const realFlags = flags.map((f) => f.replace('<redacted>', TRUST_PW));
  const logPath = path.join(scratch, `app-${label}.log`);
  const fd = fs.openSync(logPath, 'w');
  const t0 = Date.now();
  const child = spawn(JAVA, [...realFlags, '-jar', args.jar], { env, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  children.add(child);
  const proc = { child, label, logPath, exited: null };
  proc.exit = new Promise((resolve) => child.on('exit', (code, signal) => { proc.exited = { code, signal }; children.delete(child); resolve(proc.exited); }));
  for (;;) {
    if (proc.exited) throw new Error(`app ${label} exited during startup: ${JSON.stringify(proc.exited)}`);
    if (Date.now() - t0 > 120000) throw new Error(`app ${label} not ready in 120 s`);
    try { const r = await fetch(`http://127.0.0.1:${appPort}/q/health/ready`, { signal: AbortSignal.timeout(2000) }); if (r.status === 200) break; } catch { /* not up */ }
    await sleep(500);
  }
  const secs = +((Date.now() - t0) / 1000).toFixed(1);
  summary.appStartSeconds[label] = secs;
  return proc;
}
async function stop(proc, signal, waitMs) {
  const t0 = Date.now();
  proc.child.kill(signal);
  const r = await Promise.race([proc.exit, sleep(waitMs).then(() => null)]);
  if (!r) { proc.child.kill('SIGKILL'); await proc.exit; }
  return { signal, exit: proc.exited, forced: !r, seconds: +((Date.now() - t0) / 1000).toFixed(1) };
}
async function pollJob(jobId, until, timeoutMs) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const [g, p] = [await api('greg', 'GET', `/api/gcsp/v1/comparison/jobs/latest?jobId=${jobId}`), await api('presenter', 'GET', `/api/gcsp/v1/comparison/jobs/latest?jobId=${jobId}`)];
    last = { greg: g, presenter: p };
    const v = g.json?.value;
    if (v && until(v)) return { ...last, value: v, waitedSeconds: +((Date.now() - t0) / 1000).toFixed(1) };
    if (v && v.status !== 'running') return { ...last, value: v, ended: true };
    await sleep(2000);
  }
  return { ...last, value: last?.greg?.json?.value, timedOut: true };
}
const slim = (v) => v && { jobId: v.jobId, status: v.status, progress: v.progress, startedAt: v.startedAt, finishedAt: v.finishedAt, resultId: v.resultId, reason: v.reason };
const JOBS = '/api/gcsp/v1/comparison/jobs';

async function readResults(label) {
  const out = {};
  for (const who of ['greg', 'presenter', 'employee', 'none']) {
    const r = await api(who, 'GET', '/api/gcsp/v1/comparison/results/latest');
    const p = await api(who, 'GET', '/api/gcsp/v1/comparison/process/latest');
    out[who] = { results: r.http, process: p.http, processResultId: p.json?.value?.resultId, processOrigin: p.json?.value?.origin,
      origins: r.json?.value?.experiments?.map((e) => [e.experimentId, e.latest?.origin ?? null]) };
  }
  summary.phases[label] = { ...(summary.phases[label] || {}), reads: out };
  return out;
}

async function main() {
  let app;
  // Phase A: reruns at their default
  app = await startApp('A', {});
  const A = (summary.phases.A = { start: { seconds: summary.appStartSeconds.A } });
  const ra = await readResults('A');
  for (const who of ['greg', 'presenter']) {
    check(`A ${who} results/latest 200`, 200, ra[who].results);
    check(`A ${who} process/latest 200`, 200, ra[who].process);
    check(`A ${who} process resultId`, RETAINED_ID, ra[who].processResultId);
    check(`A ${who} process origin retained`, 'retained', ra[who].processOrigin);
  }
  check('A employee results/latest 403', 403, ra.employee.results);
  check('A employee process/latest 403', 403, ra.employee.process);
  check('A no token results/latest 401', 401, ra.none.results);
  check('A no token process/latest 401', 401, ra.none.process);
  const off = await api('greg', 'POST', JOBS, { experimentId: 'process-only', commandId: 'proof-off' });
  A.startOff = { http: off.http, code: off.json?.code };
  check('A greg start 403', 403, off.http);
  check('A greg start code', 'comparison-reruns-off', off.json?.code);
  const offPresenter = await api('presenter', 'POST', JOBS, { experimentId: 'process-only', commandId: 'proof-off-p' });
  check('A presenter start 403', 403, offPresenter.http);
  A.stop = await stop(app, 'SIGTERM', 60000);

  // Phase B: reruns on, then a crash mid-run
  const env = { GCSP_COMPARISON_RERUNS: 'true', GCSP_CODE_REVISION: 'proof' };
  app = await startApp('B', env);
  const B = (summary.phases.B = { start: { seconds: summary.appStartSeconds.B } });
  const s1 = await api('greg', 'POST', JOBS, { experimentId: 'process-only', commandId: 'proof-1' });
  const v1 = s1.json?.value; const job1 = v1?.jobId;
  B.start1 = { http: s1.http, status: s1.json?.status, job: slim(v1) };
  check('B start proof-1 202', 202, s1.http);
  check('B start proof-1 running', 'running', v1?.status);
  check('B start proof-1 3 seeds 6 steps', [3, 6], [v1?.progress?.seedsTotal, v1?.progress?.stepsTotal]);
  if (!job1) throw new Error('no job id from proof-1');
  const pb = await pollJob(job1, (v) => v.progress.stepsDone >= 1, 300000);
  B.polled = { waitedSeconds: pb.waitedSeconds, greg: pb.greg?.http, presenter: pb.presenter?.http, job: slim(pb.value), timedOut: !!pb.timedOut };
  check('B presenter reads running job 200', 200, pb.presenter?.http);
  check('B progress stepsDone >= 1 while running', true, !!pb.value && pb.value.status === 'running' && pb.value.progress.stepsDone >= 1);
  const busy = await api('greg', 'POST', JOBS, { experimentId: 'process-only', commandId: 'proof-1b' });
  B.busy = { http: busy.http, code: busy.json?.code, jobId: busy.json?.jobId };
  check('B second start 409', 409, busy.http);
  check('B second start code job-running', 'job-running', busy.json?.code);
  check('B second start names job', job1, busy.json?.jobId);
  const beforeKill = (await api('greg', 'GET', `${JOBS}/latest?jobId=${job1}`)).json?.value;
  B.beforeKill = slim(beforeKill);
  B.stop = await stop(app, 'SIGKILL', 30000);
  check('B app killed by SIGKILL', 'SIGKILL', B.stop.exit?.signal);

  // Phase C: restart after the crash
  app = await startApp('C', env);
  const C = (summary.phases.C = { start: { seconds: summary.appStartSeconds.C } });
  const rc = await api('greg', 'GET', `${JOBS}/latest?jobId=${job1}`);
  const rcp = await api('presenter', 'GET', `${JOBS}/latest?jobId=${job1}`);
  const c1 = rc.json?.value;
  C.job1 = slim(c1); C.job1Presenter = slim(rcp.json?.value);
  check('C proof-1 status interrupted', 'interrupted', c1?.status);
  check('C proof-1 reason restarted', INTERRUPTED_RESTART, c1?.reason);
  check('C proof-1 progress preserved', true, !!c1 && c1.progress.stepsDone >= Math.max(1, beforeKill?.progress?.stepsDone ?? 1));
  check('C proof-1 finishedAt set', true, !!c1?.finishedAt);
  check('C proof-1 presenter sees the same status', 'interrupted', rcp.json?.value?.status);
  const again = await api('greg', 'POST', JOBS, { experimentId: 'process-only', commandId: 'proof-1' });
  C.repost = { http: again.http, job: slim(again.json?.value) };
  check('C re-POST proof-1 same job back', job1, again.json?.value?.jobId);
  check('C re-POST proof-1 stays interrupted', 'interrupted', again.json?.value?.status);
  check('C re-POST proof-1 no restart (progress and finishedAt unchanged)', [c1?.progress, c1?.finishedAt], [again.json?.value?.progress, again.json?.value?.finishedAt]);
  C.noRoutes = [];
  for (const sub of ['/cancel', '/restart', '']) {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const r = await api('greg', method, `${JOBS}/${job1}${sub}`, method === 'DELETE' ? undefined : {});
      C.noRoutes.push({ method, path: `${JOBS}/<jobId>${sub}`, http: r.http });
      check(`C ${method} jobs/<id>${sub} is 404 or 405`, true, [404, 405].includes(r.http), [404, 405].includes(r.http));
    }
  }
  const after = (await api('greg', 'GET', `${JOBS}/latest?jobId=${job1}`)).json?.value;
  check('C proof-1 unchanged after cancel/restart attempts', 'interrupted', after?.status);
  const s2 = await api('greg', 'POST', JOBS, { experimentId: 'process-only', commandId: 'proof-2' });
  const job2 = s2.json?.value?.jobId;
  C.start2 = { http: s2.http, job: slim(s2.json?.value) };
  check('C start proof-2 202 (slot freed)', 202, s2.http);
  if (!job2) throw new Error('no job id from proof-2');
  const pc = await pollJob(job2, (v) => v.progress.stepsDone >= 1, 300000);
  C.polled = { waitedSeconds: pc.waitedSeconds, job: slim(pc.value), timedOut: !!pc.timedOut };
  check('C proof-2 stepsDone >= 1 while running', true, !!pc.value && pc.value.status === 'running' && pc.value.progress.stepsDone >= 1);
  const beforeTerm = slim((await api('greg', 'GET', `${JOBS}/latest?jobId=${job2}`)).json?.value);
  C.beforeTerm = beforeTerm;
  C.stop = await stop(app, 'SIGTERM', 60000);
  check('C app exited on SIGTERM within 60 s', true, !C.stop.forced && C.stop.exit?.signal == null, !C.stop.forced);

  // Phase D: restart again after a graceful stop
  app = await startApp('D', env);
  const D = (summary.phases.D = { start: { seconds: summary.appStartSeconds.D } });
  const d2 = (await api('greg', 'GET', `${JOBS}/latest?jobId=${job2}`)).json?.value;
  D.job2 = slim(d2);
  check('D proof-2 status interrupted', 'interrupted', d2?.status);
  check('D proof-2 reason (graceful stop wrote it)', INTERRUPTED_STOP, d2?.reason);
  check('D proof-2 progress preserved', true, !!d2 && d2.progress.stepsDone >= (beforeTerm?.progress?.stepsDone ?? 1));
  check('D proof-2 finishedAt set', true, !!d2?.finishedAt);
  const latest = await api('greg', 'GET', `${JOBS}/latest`);
  D.latest = { http: latest.http, jobId: latest.json?.value?.jobId, reruns: latest.json?.reruns };
  check('D jobs/latest (no jobId) is proof-2', job2, latest.json?.value?.jobId);
  const j1 = (await api('greg', 'GET', `${JOBS}/latest?jobId=${job1}`)).json?.value;
  check('D proof-1 still interrupted with the restart reason', [ 'interrupted', INTERRUPTED_RESTART ], [j1?.status, j1?.reason]);
  const rd = await readResults('D');
  check('D results/latest still 200 for greg', 200, rd.greg.results);
  check('D process resultId retained', RETAINED_ID, rd.greg.processResultId);
  check('D process origin retained', 'retained', rd.greg.processOrigin);
  const processOnly = rd.greg.origins?.find(([id]) => id === 'process-only');
  check('D no origin=run result for process-only', 'retained', processOnly?.[1] ?? null);
  D.stop = await stop(app, 'SIGTERM', 60000);
}

async function psql(sql) {
  const { stdout } = await execFileP(PSQL, ['-p', dbPort, '-U', dbUser, '-d', args['db-name'], '-At', '-F', '|', '-c', sql], { timeout: 30000 });
  return stdout.trim();
}
async function afterCounts() {
  summary.outboxRows = Number(await psql('select count(*) from gcsp_app.outbox_events'));
  summary.jobs = Object.fromEntries((await psql('select status, count(*) from gcsp_app.comparison_jobs group by status order by status')).split('\n').filter(Boolean).map((l) => l.split('|')).map(([s, n]) => [s, Number(n)]));
  summary.leftoverScratchSchemas = Number(await psql("select count(*) from information_schema.schemata where schema_name like 'cmp\\_%'"));
  check('after: no outbox rows from comparison', 0, summary.outboxRows);
  check('after: fake Brevo called zero times', 0, mailCalls);
  check('after: job rows interrupted only', { interrupted: 2 }, summary.jobs);
}

try {
  await main();
} catch (e) {
  check('script completed without error', 'no error', String(e && e.stack || e).slice(0, 400));
} finally {
  killAll();
  try { await afterCounts(); } catch (e) { check('after: psql counts', 'ok', String(e).slice(0, 200)); }
  fake.close();
  writeSummary();
  console.log(`ok=${summary.ok} checks=${summary.checks.length} failing=${JSON.stringify(summary.failingChecks)}`);
  process.exit(summary.ok ? 0 : 1);
}
