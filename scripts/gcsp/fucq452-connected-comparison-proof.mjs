#!/usr/bin/env node
// FUCQ-452 connected proof: prebuilt Angular comparison -> Java API (local signed test OIDC, owned PostgreSQL 17), headless Chrome.
// Reuses the FUCQ-447 connected harness mechanics. Never builds or seeds comparison success; parent supplies the isolated database, jar and web bundle.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:https';
import https from 'node:https';
import net from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync, createWriteStream, lstatSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { apiJvmArgs, jvmLimitsReceipt } from './proof-jvm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const T0 = Date.now();
const MONO_T0 = process.hrtime.bigint();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const refuse = (why) => { console.error(`REFUSED: ${why}`); process.exit(2); };
const PROOF_MODE = process.env.PROOF_MODE ?? 'lifecycle';
if (!['lifecycle', 'completed-experiment'].includes(PROOF_MODE)) refuse('PROOF_MODE must be lifecycle or completed-experiment');
const MAX_PROOF_DEADLINE_SEC = PROOF_MODE === 'completed-experiment' ? 11400 : 600;
const DEFAULT_PROOF_DEADLINE_SEC = PROOF_MODE === 'completed-experiment' ? 11400 : 600;
const REQUESTED_PROOF_DEADLINE_SEC = process.env.PROOF_DEADLINE_SEC === undefined
  ? DEFAULT_PROOF_DEADLINE_SEC : Number(process.env.PROOF_DEADLINE_SEC);
if (!Number.isFinite(REQUESTED_PROOF_DEADLINE_SEC) || REQUESTED_PROOF_DEADLINE_SEC <= 0
  || REQUESTED_PROOF_DEADLINE_SEC > MAX_PROOF_DEADLINE_SEC) {
  refuse(`PROOF_DEADLINE_SEC must be finite and in (0, ${MAX_PROOF_DEADLINE_SEC}] for ${PROOF_MODE} mode`);
}
const ABSOLUTE_DEADLINE_MS = process.env.PROOF_ABSOLUTE_DEADLINE_MS === undefined
  ? null : Number(process.env.PROOF_ABSOLUTE_DEADLINE_MS);
if (ABSOLUTE_DEADLINE_MS !== null && (!Number.isFinite(ABSOLUTE_DEADLINE_MS) || ABSOLUTE_DEADLINE_MS <= T0)) {
  refuse('PROOF_ABSOLUTE_DEADLINE_MS must be a finite future wall-clock deadline');
}
const monoElapsedMs = () => Number(process.hrtime.bigint() - MONO_T0) / 1e6;
const FORBIDDEN_PATH = /CloudStorage|OneDrive/i;
function rejectForbiddenRaw(value, label) {
  if (FORBIDDEN_PATH.test(String(value ?? ''))) refuse(`${label} contains a forbidden synced-location path`);
}
function localInput(input, label = 'Input') {
  rejectForbiddenRaw(input, label);
  let pending = path.resolve(input).split(path.sep).filter(Boolean); let resolved = path.sep; let links = 0;
  while (pending.length) {
    const next = path.join(resolved, pending.shift());
    if (FORBIDDEN_PATH.test(next)) refuse(`${label} resolves into a forbidden synced location`);
    let item; try { item = lstatSync(next); } catch (e) { if (e.code === 'ENOENT') return path.join(next, ...pending); throw e; }
    if (item.isSymbolicLink()) {
      if (++links > 32) refuse(`${label} has too many symbolic links`);
      const target = path.resolve(path.dirname(next), readlinkSync(next));
      if (FORBIDDEN_PATH.test(target)) refuse(`${label} link targets a forbidden synced location`);
      pending = [...target.split(path.sep).filter(Boolean), ...pending]; resolved = path.sep;
    } else resolved = next;
  }
  return resolved;
}

// Required inputs are checked as raw strings before any filesystem resolution.
const RAW_SCRATCH = process.env.SCRATCH ?? '';
if (!RAW_SCRATCH) refuse('SCRATCH is not set; the parent must supply an owned local scratch directory');
rejectForbiddenRaw(RAW_SCRATCH, 'SCRATCH');
if (!path.isAbsolute(RAW_SCRATCH)) refuse('SCRATCH must be absolute');
const SCRATCH = localInput(RAW_SCRATCH, 'SCRATCH');
if (!SCRATCH.startsWith('/private/tmp/')) refuse('SCRATCH must be a parent-owned directory under /private/tmp');
if (SCRATCH === ROOT || SCRATCH.startsWith(`${ROOT}${path.sep}`)) refuse('SCRATCH must be outside the repository');
if (!existsSync(SCRATCH) || !statSync(SCRATCH).isDirectory()) refuse('SCRATCH must already exist and be owned by the parent run');

const RUN_TOKEN = process.env.PROOF_RUN_TOKEN ?? '';
if (!/^[a-z0-9][a-z0-9-]{5,39}$/.test(RUN_TOKEN)) refuse('PROOF_RUN_TOKEN must be 6-40 lowercase letters, digits or hyphens');
const SOURCE_REVISION = process.env.PROOF_SOURCE_REVISION ?? '';
if (!/^[0-9a-f]{40}$/.test(SOURCE_REVISION)) refuse('PROOF_SOURCE_REVISION must be the parent-verified 40-hex source commit');

const DB_SOURCE = process.env.GCSP_TEST_DATABASE_URL ? 'GCSP_TEST_DATABASE_URL' : process.env.GCSP_TEST_RUNNING_DATABASE_URL ? 'GCSP_TEST_RUNNING_DATABASE_URL' : null;
if (!DB_SOURCE) refuse('GCSP_TEST_DATABASE_URL (or GCSP_TEST_RUNNING_DATABASE_URL) is required');
const DB_URL = process.env[DB_SOURCE];
const DB = /^jdbc:postgresql:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?\/([A-Za-z0-9_]+)(?:\?([^#]*))?$/.exec(DB_URL);
if (!DB) refuse(`${DB_SOURCE} must be a JDBC URL for one database on localhost; hosted databases are not used`);
const DB_HOST = DB[1].replace(/[\[\]]/g, '');
const DB_PORT = DB[2] ?? '5432';
const DB_NAME = DB[3];
const DB_OPTIONS = new URLSearchParams(DB[4] ?? '');
const DB_USER = process.env.GCSP_DATABASE_USER || DB_OPTIONS.get('user') || 'gcsp';
const DB_PASSWORD = process.env.GCSP_DATABASE_PASSWORD ?? DB_OPTIONS.get('password') ?? '';

const PROOF = path.join(SCRATCH, `fucq452-connected-${RUN_TOKEN}`);
if (existsSync(PROOF)) refuse('The proof directory already exists; the parent must supply a fresh run token');
const JAVA_HOME = localInput(process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home', 'JAVA_HOME');
const CHROME = localInput(process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'Chrome');
const JAR = localInput(process.env.PROOF_API_JAR ?? path.join(ROOT, 'services/gcsp-api/target/quarkus-app/quarkus-run.jar'), 'API jar');
const WEB_BROWSER = localInput(process.env.PROOF_WEB_BROWSER ?? path.join(ROOT, 'apps/gcsp-web/dist/gcsp-web/browser'), 'Web browser directory');
const PSQL = localInput(process.env.PROOF_PSQL_BIN ?? '/opt/homebrew/opt/postgresql@17/bin/psql', 'PostgreSQL client');
for (const [label, file] of [['API jar', JAR], ['compiled web index', path.join(WEB_BROWSER, 'index.html')], ['java', path.join(JAVA_HOME, 'bin/java')], ['keytool', path.join(JAVA_HOME, 'bin/keytool')], ['Chrome', CHROME], ['PostgreSQL client', PSQL]]) {
  rejectForbiddenRaw(file, label);
  if (!existsSync(file)) refuse(`${label} was not found`);
}
const port = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) refuse(`${name} must be a port number`);
  return value;
};
const PORTS = { web: port('PROOF_WEB_PORT', 7643), api: port('PROOF_API_PORT', 8643), idp: port('PROOF_IDP_PORT', 9643) };
if (new Set(Object.values(PORTS)).size !== 3) refuse('Proof ports must be distinct');
const DEADLINE_MS = Math.min(REQUESTED_PROOF_DEADLINE_SEC * 1000,
  ABSOLUTE_DEADLINE_MS === null ? Infinity : ABSOLUTE_DEADLINE_MS - T0);
if (!Number.isFinite(DEADLINE_MS) || DEADLINE_MS <= 90000 || DEADLINE_MS > MAX_PROOF_DEADLINE_SEC * 1000) {
  refuse(`Remaining proof deadline must be in (90, ${MAX_PROOF_DEADLINE_SEC}] seconds`);
}
const PROOF_DEADLINE_WALL_MS = T0 + DEADLINE_MS;
const PROOF_DEADLINE_MONO_MS = DEADLINE_MS;
const COMPLETED_JOB_TIMEOUT_MS = 10800000;
const COMPLETED_RESULT_RESERVE_MS = 300000;
const COMPLETED_API_JVM_ARGS = ['-Xms128m', '-Xmx3g', '-XX:MaxMetaspaceSize=256m', '-XX:ReservedCodeCacheSize=128m'];
const API_JVM_ARGS = PROOF_MODE === 'completed-experiment' ? COMPLETED_API_JVM_ARGS : apiJvmArgs({ heap: '1g' });
const JVM_LOG_ROTATION_BYTES = 1024 * 1024;
const FIRST_BROWSER_STEP_WINDOW_MS = 180000;
const HOLD_SWEEP_BASIS = 'Check the effect of a 3,600-second hold against the actual current setting; keep this as a what-if, not a policy change.';
const EXPECTED_SEEDS = ['comparison-a', 'comparison-b', 'comparison-c'];

const PUBLIC_BASE_URL = process.env.PROOF_PUBLIC_BASE_URL ?? '';
let publicBase;
try { publicBase = new URL(PUBLIC_BASE_URL); } catch { refuse('PROOF_PUBLIC_BASE_URL must be a valid public HTTPS URL'); }
if (!/^https:\/\//.test(PUBLIC_BASE_URL) || /[\s\u0000-\u001f\u007f\\]/.test(PUBLIC_BASE_URL)
  || publicBase.username || publicBase.password || publicBase.search || publicBase.hash
  || !publicBase.hostname.includes('.') || /^[\d.]+$/.test(publicBase.hostname)
  || /[:\[\]]/.test(publicBase.hostname) || /(?:^|\.)localhost$|\.local$/.test(publicBase.hostname)) {
  refuse('PROOF_PUBLIC_BASE_URL must match the Java public-mail-base HTTPS contract');
}

const ORIGINS = { web: `https://gcsp-web.localhost:${PORTS.web}`, api: `https://gcsp-api.localhost:${PORTS.api}`, idp: `https://gcsp-idp.localhost:${PORTS.idp}` };
const ISSUER = `${ORIGINS.idp}/realms/gcsp-local`;
const API_PATH = '/api/gcsp/v1';
const API_BASE = `${ORIGINS.api}${API_PATH}`;
const KID = 'gcsp-local-test-1';
const TRUST_PASS = 'proof-local-trust';
const ENVIRONMENT_ID = `fucq452-connected-${RUN_TOKEN}`;
const RUN_ID = 'run-1';
const POLICY_VERSION = 'gcsp-policy-v1';
const SUBJECTS = { greg: ['greg'], presenter: ['presenter'], employee: ['employee'] };
const OIDC_SUBJECTS = Object.fromEntries(Object.entries(SUBJECTS).map(([name, roles]) => [`sub-${name}`, roles]));
const SCHEMA = `gcsp_s_fucq452_${RUN_TOKEN.replace(/-/g, '_')}`;
const dirs = { logs: path.join(PROOF, 'logs'), tmp: path.join(PROOF, 'tmp'), certs: path.join(PROOF, 'certs'),
  static: path.join(PROOF, 'static'), browser: path.join(PROOF, 'browser'), evidence: path.join(PROOF, 'evidence') };
const receipt = {
  schema: 'fucq452-connected-comparison-proof/1', story: 'DEV-2026-11-13-020 / FUCQ-452',
  proofMode: PROOF_MODE,
  deadline: { requestedSeconds: REQUESTED_PROOF_DEADLINE_SEC, maxSeconds: MAX_PROOF_DEADLINE_SEC,
    remainingSecondsAtStart: DEADLINE_MS / 1000, absoluteDeadlineSupplied: ABSOLUTE_DEADLINE_MS !== null,
    absoluteDeadlineMs: ABSOLUTE_DEADLINE_MS },
  executionPlan: PROOF_MODE === 'completed-experiment' ? {
    expectedSteps: 12, expectedSeeds: 3, canonicalJobTimeoutSeconds: COMPLETED_JOB_TIMEOUT_MS / 1000,
    estimate: '100–200 minutes, based on historical 913–1,918 seconds per seed',
    timeoutRisk: 'The Java job timeout is 180 minutes; a slower replay can fail at that limit.',
    apiJvmArgs: COMPLETED_API_JVM_ARGS, apiHeapLimit: '3 GiB maximum heap',
    resourceBasis: 'Historical FUCQ-507 completed the full three-seed process job at -Xmx3g. This current hold-sweep variant remains unproven and does not diagnose the prior 2 GiB OOM.',
    browserLifetime: 'Initial Greg start/progress chunk, no live Chrome during signed-API polling, then fresh Chrome after the post-completion ordinary API restart.',
  } : { expectedSteps: 6, scenario: 'original bounded lifecycle proof' },
  startedAt: new Date().toISOString(), sourceRevision: { value: SOURCE_REVISION, provenance: 'Supplied and verified by the parent; this script does not read git.' },
  inputs: null, tools: {}, scenarios: {}, actualBaseline: null, processes: [], signals: [],
  originalAcceptance: {
    AC1: { text: 'Retained/new actual results, measures, assumptions and experiments display actual data; supported start/rerun/progress and interrupted-job states work for Greg.', evidence: 'incomplete', closure: PROOF_MODE === 'completed-experiment'
      ? 'OPEN: this mode covers one real completed hold-sweep start, progress and result readback; it does not re-exercise rerun/interruption. Existing lifecycle evidence is separate; the covering batch, current-browser and hosted evidence remain outstanding.'
      : 'OPEN: short connected proof does not produce a completed new result or close Story acceptance' },
    AC2: { text: 'Presenter inspection is read-only and errors/interruption remain honest. Retain seeds and current workload sizes without promising improvement.', evidence: 'incomplete', closure: PROOF_MODE === 'completed-experiment'
      ? 'OPEN: this mode covers presenter read-only inspection of the same completed result; existing error/interruption evidence is separate, and current-browser, hosted and final acceptance remain outstanding.'
      : 'OPEN: hosted/WebKit and final acceptance remain separate' },
  },
  limitations: PROOF_MODE === 'completed-experiment' ? [
    'This mode starts exactly one real hold-sweep job through Greg’s Angular form, using the server-owned three seeds and unchanged current workload; it does not seed or edit successful job/result rows.',
    'The only trial value is 3,600 seconds against the current policy baseline. The basis is shown in the command form, the experiment remains a what-if and no trial value is published as policy.',
    'The expected plan is baseline plus one variant across three seeds and two routes (12 steps). Full-size completion is estimated at 100–200 minutes from historical 913–1,918 seconds per seed; the Java job timeout is 180 minutes, so slower execution can fail.',
    'The initial Greg context and Chrome stop after the bounded initial progress observation; signed API reads then monitor the durable job until terminal state. Fresh Chrome/sign-in inspect the result after an ordinary API restart. There is no continuous DOM observation during the remaining run.',
    'The outer supervisor owns the database, resource manifest, aggregate limits, scratch/output audit and teardown. This script leaves its per-run schema and files for that finalizer.',
    'CDP browser contexts approximate fresh private sessions. Safari/WebKit, actual private-browser behaviour and hosted deployment were not run by this local Chromium proof.',
    'No access tokens, database credentials, OIDC codes, private keys or run-token values are written to receipts.',
  ] : [
    'Local test OIDC uses real signed RS256 tokens and Java bearer validation; this is not the hosted identity provider.',
    'Only the bundled retained actual process-only baseline is read. No comparison result, success job, fixture success or scenario data is seeded by this runner.',
    'Greg starts two normal process-only jobs through the Angular DOM. The first API is stopped after one actual replay step; the rerun API is stopped after the new job is confirmed running. Neither run is treated as a completed result.',
    'The full-size replay has separate historical F507 evidence and takes about an hour; this short proof does not rerender a new completed result.',
    'The outer supervisor owns the database, resource manifest, aggregate limits, scratch/output audit and teardown. This script leaves its per-run schema and files for that finalizer.',
    'CDP browser contexts approximate fresh private sessions. Safari/WebKit and hosted deployment were not run by this local Chromium proof.',
    'No access tokens, database credentials, OIDC codes, private keys or run-token values are written to receipts.',
  ],
};
const owned = [];
const baselineProcessStarts = new Map();
const CHILD_LOG_LIMIT = 1024 * 1024;
const LOG_LIMIT_MARKER = Buffer.from('\nPROOF FAILURE: shared 1MiB child log budget exhausted; remaining child output discarded.\n');
const SCREENSHOT_BUDGET = 1536 * 1024;
let childLogBytes = 0;
let screenshotBytes = 0;
let logLimitFailure = false;
let finished = false;
let teardownPromise;
let tls;
let api = null;
let apiStarts = 0;
let browserStarts = 0;
let browserProcess = null;
let activeCdp = null;
let webServer = null;
const idp = { codes: new Map(), txns: new Map(), subjects: OIDC_SUBJECTS, keys: null, server: null };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256b64u = (value) => createHash('sha256').update(value).digest('base64url');
const sha256File = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const cap = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 60000, env: childEnv(process.env), ...opts }).trim();

// ---------- owned child processes (the parent retains the outer resource supervisor) ----------
function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return null;
  const result = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'pid=', '-o', 'ppid=', '-o', 'pgid=', '-o', 'lstart=', '-o', 'comm='],
    { encoding: 'utf8', timeout: 1000, env: childEnv(process.env) });
  const parts = (result.stdout ?? '').trim().split(/\s+/);
  if (result.status !== 0 || result.stderr || parts.length < 9
    || !parts.slice(0, 3).every((value) => /^\d+$/.test(value) && Number(value) > 0)
    || Number(parts[0]) !== pid || !parts.slice(3, 8).every(Boolean)) return null;
  return { pid: Number(parts[0]), ppid: Number(parts[1]), pgid: Number(parts[2]),
    start: parts.slice(3, 8).join(' '), executable: parts.slice(8).join(' ') };
}
function captureProcessBaseline() {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,lstart='], { encoding: 'utf8', timeout: 1000, env: childEnv(process.env) });
  if (result.status !== 0 || result.stderr || !result.stdout?.trim()) throw new Error('Complete process baseline is unavailable');
  for (const line of result.stdout.trim().split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 6 || !/^\d+$/.test(parts[0]) || Number(parts[0]) <= 0) throw new Error('Process baseline contains an incomplete identity');
    baselineProcessStarts.set(Number(parts[0]), parts.slice(1).join(' '));
  }
  receipt.processBaseline = { identities: baselineProcessStarts.size, capturedAt: new Date().toISOString() };
}
function persistSignalJournal() {
  const file = path.join(dirs.evidence, 'owned-signal-journal.json');
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(receipt.signals, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
}
function killGroup(child, signal) {
  if (child.done) return;
  const current = processIdentity(child.pid);
  const entry = { at: new Date().toISOString(), signal, target: 'owned-direct-child-process-group',
    expected: child.identity, observed: current, result: 'intent' };
  receipt.signals.push(entry);
  persistSignalJournal();
  if (!current || !child.identity || child.identity.ppid !== process.pid
    || baselineProcessStarts.get(child.pid) === child.identity.start
    || JSON.stringify(current) !== JSON.stringify(child.identity) || current.pgid !== child.pid) {
    entry.result = 'refused-unverified-or-changed-identity'; persistSignalJournal();
    throw new Error(`Refused signal: owned identity is unavailable or changed for ${child.pid}`);
  }
  try { process.kill(-child.pid, signal); entry.result = 'sent'; }
  catch (error) { entry.result = 'error'; entry.error = `${error.code ?? error.name}: ${error.message}`; throw error; }
  finally { persistSignalJournal(); }
}
const SUPERVISOR_MARKERS = ['F452_LOCAL_TOKEN', 'TEST_RESOURCE_PARENT_RESERVATION', 'PROOF_RUN_TOKEN', 'PROOF_ABSOLUTE_DEADLINE_MS'];
function childEnv(env) {
  const markers = Object.fromEntries(SUPERVISOR_MARKERS.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  return { ...env, ...markers, TMPDIR: dirs.tmp, TMP: dirs.tmp, TEMP: dirs.tmp };
}
function spawnOwned(name, cmd, args, env, portNumber = null) {
  const logFile = path.join(dirs.logs, `${name}.log`);
  const output = createWriteStream(logFile);
  const child = spawn(cmd, args, { cwd: ROOT, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const writeLog = (chunk) => {
    if (logLimitFailure) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = CHILD_LOG_LIMIT - LOG_LIMIT_MARKER.length - childLogBytes;
    if (bytes.length <= remaining) { childLogBytes += bytes.length; output.write(bytes); return; }
    if (remaining > 0) { output.write(bytes.subarray(0, remaining)); childLogBytes += remaining; }
    output.write(LOG_LIMIT_MARKER); childLogBytes += LOG_LIMIT_MARKER.length; logLimitFailure = true;
    receipt.logBudget = { limitBytes: CHILD_LOG_LIMIT, writtenBytes: childLogBytes, exhausted: true, triggeringProcess: name };
    void (async () => { await teardown(); finish('shared child log budget exhausted'); process.exit(1); })();
  };
  child.stdout.on('data', writeLog); child.stderr.on('data', writeLog);
  child.logClosed = new Promise((resolve) => output.once('finish', resolve));
  child.once('close', () => output.end());
  child.identity = processIdentity(child.pid);
  if (child.identity && (child.identity.ppid !== process.pid || child.identity.pgid !== child.pid
    || baselineProcessStarts.get(child.pid) === child.identity.start)) child.identity = null;
  const record = { name, pid: child.pid, identity: child.identity, executable: path.basename(cmd), port: portNumber,
    startedAt: new Date().toISOString(), exit: null };
  receipt.processes.push(record);
  child.logFile = logFile;
  child.exited = new Promise((resolve) => {
    child.on('error', (error) => { child.done = true; record.exit = `spawn-error: ${error.message}`; record.endedAt = new Date().toISOString(); resolve(-1); });
    child.on('exit', (code, signal) => { child.done = true; child.exitCode = code; child.signalCode = signal; record.exit = code ?? signal; record.endedAt = new Date().toISOString(); resolve(code); });
  });
  child.stop = async () => {
    if (child.done) return;
    killGroup(child, 'SIGTERM');
    await Promise.race([child.exited, sleep(10000)]);
    if (!child.done) { killGroup(child, 'SIGKILL'); await Promise.race([child.exited, sleep(5000)]); }
    if (!child.done) throw new Error(`Owned child ${name} did not join`);
  };
  owned.push(child);
  return child;
}
function runOnce(name, cmd, args, env, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawnOwned(name, cmd, args, env);
    const timer = setTimeout(() => { child.stop().then(() => reject(new Error(`${name} timed out`)), reject); }, timeout);
    child.exited.then((code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${name} exited ${code}`));
    });
  });
}
const portFree = (number) => new Promise((resolve) => {
  const server = net.createServer(); server.once('error', () => resolve(false));
  server.listen(number, '127.0.0.1', () => server.close(() => resolve(true)));
});

// ---------- localhost TLS, PKCE issuer, static Angular bundle ----------
function makeCerts() {
  const file = (name) => path.join(dirs.certs, name);
  const ssl = (args, opts) => execFileSync('openssl', args, { cwd: dirs.certs, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, env: childEnv(process.env), ...opts });
  ssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', file('ca.key')]);
  ssl(['req', '-x509', '-new', '-key', file('ca.key'), '-sha256', '-days', '3', '-subj', '/CN=GCSP local proof CA',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', file('ca.pem')]);
  ssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', file('leaf.key')]);
  ssl(['req', '-new', '-key', file('leaf.key'), '-subj', '/CN=gcsp-web.localhost', '-out', file('leaf.csr')]);
  writeFileSync(file('leaf.ext'), 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:gcsp-web.localhost,DNS:gcsp-api.localhost,DNS:gcsp-idp.localhost,DNS:localhost,IP:127.0.0.1\n');
  ssl(['x509', '-req', '-in', file('leaf.csr'), '-CA', file('ca.pem'), '-CAkey', file('ca.key'), '-CAcreateserial',
    '-days', '3', '-sha256', '-extfile', file('leaf.ext'), '-out', file('leaf.pem')]);
  writeFileSync(file('fullchain.pem'), readFileSync(file('leaf.pem'), 'utf8') + readFileSync(file('ca.pem'), 'utf8'));
  const publicKey = ssl(['x509', '-in', file('leaf.pem'), '-pubkey', '-noout']);
  const der = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'der'], { input: publicKey, env: childEnv(process.env) });
  const spki = createHash('sha256').update(der).digest('base64');
  execFileSync(path.join(JAVA_HOME, 'bin/keytool'), ['-importcert', '-alias', 'gcsp-local-ca', '-file', file('ca.pem'),
    '-keystore', file('truststore.p12'), '-storetype', 'PKCS12', '-storepass', TRUST_PASS, '-noprompt'],
    { stdio: 'pipe', timeout: 60000, env: childEnv(process.env) });
  return { ca: readFileSync(file('ca.pem'), 'utf8'), cert: readFileSync(file('fullchain.pem')), key: readFileSync(file('leaf.key')),
    spki, trust: file('truststore.p12') };
}
function newKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' } };
}
function signJwt(payload, key) {
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID }));
  const body = b64u(JSON.stringify(payload));
  return `${head}.${body}.${b64u(createSign('RSA-SHA256').update(`${head}.${body}`).sign(key))}`;
}
function accessClaims(subject, roles) {
  const now = Math.floor(Date.now() / 1000);
  return { iss: ISSUER, aud: ['gcsp-api'], azp: 'gcsp-web', scope: 'openid profile gcsp-api', sub: subject,
    realm_access: { roles }, iat: now, exp: now + 3600, jti: randomBytes(8).toString('hex') };
}
function startIdp() {
  idp.keys = newKeys();
  const base = '/realms/gcsp-local';
  const metadata = { issuer: ISSUER, authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
    token_endpoint: `${ISSUER}/protocol/openid-connect/token`, jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
    end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`, response_types_supported: ['code'], subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'], grant_types_supported: ['authorization_code'], scopes_supported: ['openid', 'profile', 'gcsp-api'] };
  const cors = (req, res) => { if (req.headers.origin === ORIGINS.web) { res.setHeader('Access-Control-Allow-Origin', ORIGINS.web); res.setHeader('Vary', 'Origin'); } };
  const json = (req, res, status, body) => { cors(req, res); res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const text = (res, status, body, type = 'text/plain') => { res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(body); };
  idp.server = createServer({ key: tls.key, cert: tls.cert }, async (req, res) => {
    const url = new URL(req.url, ISSUER);
    const form = async () => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return new URLSearchParams(Buffer.concat(chunks).toString()); };
    if (req.method === 'OPTIONS') { cors(req, res); res.writeHead(204, req.headers.origin === ORIGINS.web
      ? { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Accept', 'Access-Control-Max-Age': '600' } : {}); return res.end(); }
    if (url.pathname === `${base}/.well-known/openid-configuration`) return json(req, res, 200, metadata);
    if (url.pathname === `${base}/protocol/openid-connect/certs`) return json(req, res, 200, { keys: [idp.keys.jwk] });
    if (url.pathname === `${base}/protocol/openid-connect/auth` && req.method === 'GET') {
      const q = url.searchParams;
      if (q.get('client_id') !== 'gcsp-web' || q.get('redirect_uri') !== `${ORIGINS.web}/gcsp/auth/callback`
        || q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || !q.get('state')) return text(res, 400, 'invalid_request');
      const txn = randomBytes(12).toString('hex');
      idp.txns.set(txn, { redirectUri: q.get('redirect_uri'), challenge: q.get('code_challenge'), state: q.get('state'), nonce: q.get('nonce') });
      const buttons = Object.keys(idp.subjects).map((subject) => `<p><button type="submit" name="subject" value="${subject}" data-subject="${subject}">Sign in as ${subject}</button></p>`).join('');
      return text(res, 200, `<!doctype html><title>Local test issuer</title><h1>LOCAL TEST ISSUER (not the real provider)</h1><form method="post" action="${base}/protocol/openid-connect/auth"><input type="hidden" name="txn" value="${txn}">${buttons}</form>`, 'text/html');
    }
    if (url.pathname === `${base}/protocol/openid-connect/auth` && req.method === 'POST') {
      const fields = await form(); const transaction = idp.txns.get(fields.get('txn')); idp.txns.delete(fields.get('txn'));
      if (!transaction || !idp.subjects[fields.get('subject')]) return text(res, 400, 'invalid_request');
      const code = randomBytes(16).toString('hex'); idp.codes.set(code, { ...transaction, subject: fields.get('subject') });
      const target = new URL(transaction.redirectUri); target.searchParams.set('code', code); target.searchParams.set('state', transaction.state);
      res.writeHead(302, { Location: target.href, 'Cache-Control': 'no-store' }); return res.end();
    }
    if (url.pathname === `${base}/protocol/openid-connect/token` && req.method === 'POST') {
      const fields = await form(); const code = idp.codes.get(fields.get('code')); idp.codes.delete(fields.get('code'));
      if (fields.get('grant_type') !== 'authorization_code' || !code || fields.get('client_id') !== 'gcsp-web'
        || fields.get('redirect_uri') !== code.redirectUri || sha256b64u(fields.get('code_verifier') ?? '') !== code.challenge) {
        return json(req, res, 400, { error: 'invalid_grant' });
      }
      const now = Math.floor(Date.now() / 1000);
      const idToken = signJwt({ iss: ISSUER, sub: code.subject, aud: 'gcsp-web', azp: 'gcsp-web', iat: now, exp: now + 300, auth_time: now,
        ...(code.nonce ? { nonce: code.nonce } : {}) }, idp.keys.privateKey);
      return json(req, res, 200, { access_token: signJwt(accessClaims(code.subject, idp.subjects[code.subject]), idp.keys.privateKey),
        token_type: 'Bearer', expires_in: 3600, scope: 'openid profile gcsp-api', id_token: idToken });
    }
    if (url.pathname === `${base}/protocol/openid-connect/logout`) { res.writeHead(302, { Location: `${ORIGINS.web}/gcsp/` }); return res.end(); }
    return text(res, 404, 'not found');
  });
  return new Promise((resolve) => idp.server.listen(PORTS.idp, '127.0.0.1', resolve));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.gif': 'image/gif', '.avif': 'image/avif' };
function startWeb(fixedRoutes) {
  const fixed = new Set(fixedRoutes.map((route) => route.replace(/\/$/, '') || '/'));
  const root = path.join(dirs.static, 'gcsp');
  webServer = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, ORIGINS.web).pathname);
    if (pathname === '/' || pathname === '/gcsp') { res.writeHead(302, { Location: '/gcsp/' }); return res.end(); }
    if (!pathname.startsWith('/gcsp/') || pathname.includes('..')) { res.writeHead(404); return res.end('not found'); }
    const normalized = pathname.replace(/\/$/, '');
    let file = path.join(root, pathname.slice('/gcsp/'.length));
    if (fixed.has(normalized) || pathname.endsWith('/')) file = path.join(root, 'index.html');
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': ext === '.html' || ext === '.json' ? 'no-store' : 'public, max-age=31536000, immutable' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => webServer.listen(PORTS.web, '127.0.0.1', resolve));
}
const closeServer = (server) => server ? new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }) : Promise.resolve();

// ---------- Java API and explicitly labelled API probes ----------
function apiEnv() {
  return {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp, JAVA_HOME, LANG: 'en_GB.UTF-8',
    QUARKUS_HTTP_SSL_PORT: String(PORTS.api), QUARKUS_HTTP_INSECURE_REQUESTS: 'disabled',
    QUARKUS_HTTP_SSL_CERTIFICATE_FILES: path.join(dirs.certs, 'fullchain.pem'),
    QUARKUS_HTTP_SSL_CERTIFICATE_KEY_FILES: path.join(dirs.certs, 'leaf.key'),
    QUARKUS_HTTP_ACCESS_LOG_ENABLED: 'true', QUARKUS_HTTP_ACCESS_LOG_PATTERN: 'ACCESSLOG %m %U %s',
    GCSP_ALLOWED_ORIGINS: ORIGINS.web, GCSP_IDENTITY_PROVIDER: 'oidc', GCSP_OIDC_ISSUER: ISSUER,
    GCSP_OIDC_JWKS_URI: `https://127.0.0.1:${PORTS.idp}/realms/gcsp-local/protocol/openid-connect/certs`,
    GCSP_OIDC_AUDIENCE: 'gcsp-api', GCSP_OIDC_AUTHORIZED_PARTY: 'gcsp-web', GCSP_OIDC_REQUIRED_SCOPES: 'gcsp-api',
    GCSP_OIDC_ACCOUNTS: JSON.stringify(Object.entries(SUBJECTS).map(([name, roles]) => ({ subject: `sub-${name}`, roles,
      ...(roles.includes('employee') ? { employeeId: 'employee-probe' } : {}) }))),
    GCSP_ENVIRONMENT_ID: ENVIRONMENT_ID, GCSP_RUN_ID: RUN_ID, GCSP_POLICY_VERSION: POLICY_VERSION,
    GCSP_DATABASE_URL: DB_URL, GCSP_DATABASE_USER: DB_USER, GCSP_DATABASE_PASSWORD: DB_PASSWORD, GCSP_EXPECTED_DATABASE: DB_NAME,
    GCSP_RESET_ALLOWED: 'false', GCSP_PUBLIC_BASE_URL: PUBLIC_BASE_URL, GCSP_COMPARISON_RERUNS: 'true',
    GCSP_CODE_REVISION: SOURCE_REVISION, GCSP_COMPARISON_RESULT_FILES: '',
    GCSP_ACCOUNT_PROVIDER: 'none', GCSP_SCENARIO_PROVIDER: 'none', GCSP_BUDDY_PROVIDER: 'local-synthetic',
    GCSP_CLAIM_STOCK_PROVIDER: 'local', GCSP_SUPPLY_PROVIDER: 'none', GCSP_ORDERING_PROVIDER: 'none',
    GCSP_APPOINTMENTS_PROVIDER: 'none', GCSP_DOCUMENTS_PROVIDER: 'none', GCSP_APPROVALS_PROVIDER: 'none',
    GCSP_RETURNS_PROVIDER: 'none', GCSP_PRODUCTION_PROVIDER: 'none',
    GCSP_CLAIMS_SWEEP_INTERVAL: '10m', GCSP_NOTIFY_DRAIN_INTERVAL: '10m',
  };
}
function request(method, suffix, token = null, body = null) {
  const origin = new URL(ORIGINS.api);
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port: Number(origin.port), path: `${API_PATH}${suffix}`, method,
      servername: origin.hostname, ca: tls.ca, timeout: 15000,
      headers: { Host: origin.host, Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === null ? {} : { 'Content-Type': 'application/json' }) } }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (chunk) => { size += chunk.length; if (size > 2 * 1024 * 1024) return req.destroy(new Error('API response exceeded 2MiB')); chunks.push(chunk); });
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* non-JSON error page */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('timeout', () => req.destroy(new Error('API request timed out'))); req.on('error', reject);
    req.end(body === null ? undefined : JSON.stringify(body));
  });
}
function call(person, suffix, body) {
  const roles = SUBJECTS[person];
  const token = signJwt(accessClaims(`sub-${person}`, roles), idp.keys.privateKey);
  return request(body === undefined ? 'GET' : 'POST', suffix, token, body ?? null);
}
async function expectApi(person, suffix) {
  const response = await call(person, suffix);
  if (response.status !== 200 || response.json?.status !== 'ok') throw new Error(`${person} ${suffix} did not return an authorized read`);
  return response.json.value;
}
async function startApi() {
  apiStarts++;
  const name = `api-${apiStarts}`;
  const jvmLimits = API_JVM_ARGS;
  const jvmTelemetry = PROOF_MODE === 'completed-experiment' ? [
    `-Xlog:exceptions=info:file=${path.join(dirs.logs, `${name}-exceptions.log`)}:utctime,uptime,pid,tid,level,tags:filecount=1,filesize=1m`,
    `-Xlog:gc*=info:file=${path.join(dirs.logs, `${name}-gc.log`)}:utctime,uptime,pid,tid,level,tags:filecount=1,filesize=1m`,
  ] : [];
  if (PROOF_MODE === 'completed-experiment') receipt.executionPlan.apiLaunch = {
    arguments: [...jvmLimits, ...jvmTelemetry.map((argument) => argument.replace(`${dirs.logs}${path.sep}`, '<owned-proof-logs>/'))],
    maximumHeapBytes: 3221225472, maximumMetaspaceBytes: 268435456,
    maximumReservedCodeCacheBytes: 134217728, initialHeapBytes: 134217728,
    telemetry: { selections: ['exceptions=info', 'gc*=info'], bytesPerFile: JVM_LOG_ROTATION_BYTES,
      rotatedFilesPerSelection: 1, nominalTotalBytes: JVM_LOG_ROTATION_BYTES * 4,
      qualification: 'JVM rotation occurs at record boundaries; the outer aggregate scratch/output caps remain binding. No heap dump.' },
  };
  const properties = [
    `-Dquarkus.datasource.jdbc.additional-jdbc-properties.currentSchema=${SCHEMA}`,
    `-Dquarkus.flyway.schemas=${SCHEMA}`, `-Dquarkus.flyway.default-schema=${SCHEMA}`,
  ];
  api = spawnOwned(name, path.join(JAVA_HOME, 'bin/java'),
    [...jvmLimits, ...jvmTelemetry, `-Djavax.net.ssl.trustStore=${tls.trust}`, `-Djavax.net.ssl.trustStorePassword=${TRUST_PASS}`,
      `-Djava.io.tmpdir=${dirs.tmp}`, ...properties, '-jar', JAR], apiEnv(), PORTS.api);
  for (let i = 0; ; i++) {
    if (api.done) throw new Error(`${name} exited during startup`);
    try { const response = await request('GET', '/comparison/results/latest'); if (response.status === 401) break; } catch { /* starting */ }
    if (i > 240) throw new Error(`${name} did not become ready for signed comparison reads`);
    await sleep(500);
  }
  log(`${name} ready`);
}
async function stopApi() {
  if (!api) return;
  const stopped = api;
  await stopped.stop();
  await stopped.logClosed;
  api = null;
  log(`api process ${stopped.pid} stopped`);
}

// ---------- CDP page and browser observations ----------
class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id); this.pending.delete(message.id);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      } else this.listeners.forEach((listener) => listener(message));
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', () => reject(new Error('CDP websocket failed'))); });
    return new Cdp(ws);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  }
}
async function startBrowser() {
  if (browserProcess && !browserProcess.done) throw new Error('An owned browser is already running');
  browserStarts++;
  const profile = path.join(dirs.browser, `profile-${browserStarts}`);
  browserProcess = spawnOwned(`chrome-${browserStarts}`, CHROME, ['--headless=new', `--user-data-dir=${profile}`,
    '--remote-debugging-port=0', '--remote-allow-origins=*',
    `--ignore-certificate-errors-spki-list=${tls.spki}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--window-size=1440,1000', 'about:blank'],
    { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp });
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    if (browserProcess.done) throw new Error('Chrome exited during startup');
    try { const [debugPort, wsPath] = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n'); wsUrl = `ws://127.0.0.1:${debugPort}${wsPath}`; }
    catch { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Chrome DevTools endpoint was not found');
  activeCdp = await Cdp.connect(wsUrl);
  receipt.browser = { engine: 'Chromium headless via CDP', contextsAreIsolated: true, starts: browserStarts };
  return activeCdp;
}
async function stopBrowser() {
  try { activeCdp?.ws.close(); } catch { /* child exit is independently joined below */ }
  activeCdp = null;
  if (browserProcess) {
    const stopped = browserProcess;
    await stopped.stop();
    await stopped.logClosed;
    if (!stopped.identity || stopped.identity.pgid !== stopped.pid) throw new Error('Chrome private group identity is unavailable for exit audit');
    const groupAudit = { pgid: stopped.identity.pgid, snapshots: [], absent: false };
    receipt.executionPlan.browserStops ??= [];
    receipt.executionPlan.browserStops.push({ at: new Date().toISOString(), pid: stopped.pid,
      exited: stopped.done, groupAudit, reason: 'Owned browser chunk complete; no session state is replayed.' });
    const joinDeadline = Date.now() + 10000;
    do {
      const result = spawnSync('/bin/ps', ['-axo', 'pid=,pgid=,stat='],
        { encoding: 'utf8', timeout: 1000, env: childEnv(process.env) });
      if (result.status !== 0 || result.stderr || !result.stdout?.trim()) throw new Error('Chrome group exit snapshot is unavailable');
      const members = [];
      for (const line of result.stdout.trim().split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length !== 3 || !parts.slice(0, 2).every((value) => /^\d+$/.test(value) && Number(value) > 0)
          || !parts[2]) throw new Error('Chrome group exit snapshot has an incomplete identity');
        if (Number(parts[1]) === groupAudit.pgid) members.push({ pid: Number(parts[0]), pgid: Number(parts[1]), state: parts[2] });
      }
      groupAudit.snapshots.push({ at: new Date().toISOString(), members });
      if (members.length === 0) { groupAudit.absent = true; break; }
      if (Date.now() < joinDeadline) await sleep(250);
    } while (Date.now() < joinDeadline);
    if (!groupAudit.absent) throw new Error('Chrome private group remains after its main child joined');
    // Detached descendants remain within the outer supervisor's retained identity audit.
    browserProcess = null;
  }
}
const hdr = (headers = {}, name) => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
const parse = (value) => { try { return JSON.parse(value); } catch { return null; } };
function requestSummary(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return { keys: Object.keys(body).sort(), experimentId: body.experimentId ?? null,
    hasCommandId: typeof body.commandId === 'string' && body.commandId.length > 0, change: body.change ?? null };
}
class Page {
  constructor(cdp, sessionId, contextId, label) {
    this.cdp = cdp; this.sid = sessionId; this.ctxId = contextId; this.label = label;
    this.log = []; this.byId = new Map(); this.waits = []; this.errors = []; this.csp = [];
    cdp.listeners.push((message) => message.sessionId === sessionId && this.event(message));
  }
  send(method, params = {}) { return this.cdp.send(method, params, this.sid); }
  event(message) {
    const p = message.params ?? {};
    if (message.method === 'Runtime.exceptionThrown') { this.errors.push(p.exceptionDetails?.text ?? 'runtime exception'); return; }
    if (message.method === 'Log.entryAdded') {
      if (p.entry?.level === 'error' && /content.security|content-security|\bcsp\b/i.test(p.entry?.text ?? '')) this.csp.push(p.entry.text);
      return;
    }
    if (message.method === 'Network.requestWillBeSent') {
      if (!p.request.url.startsWith(ORIGINS.api)) return;
      const url = new URL(p.request.url);
      const entry = { id: p.requestId, method: p.request.method, path: url.pathname.replace(API_PATH, ''), query: url.search,
        auth: !!hdr(p.request.headers, 'authorization'), status: null, failed: null, request: requestSummary(parse(p.request.postData)) };
      if (!p.request.postData && p.request.hasPostData) this.waits.push(this.send('Network.getRequestPostData', { requestId: p.requestId })
        .then((result) => { entry.request = requestSummary(parse(result.postData)); }).catch(() => {}));
      this.log.push(entry); this.byId.set(p.requestId, entry);
    } else if (message.method === 'Network.requestWillBeSentExtraInfo') {
      const entry = this.byId.get(p.requestId); if (entry && hdr(p.headers, 'authorization')) entry.auth = true;
    } else if (message.method === 'Network.responseReceived') {
      const entry = this.byId.get(p.requestId); if (entry) entry.status = p.response.status;
    } else if (message.method === 'Network.loadingFailed') {
      const entry = this.byId.get(p.requestId); if (entry) entry.failed = p.errorText;
    } else if (message.method === 'Network.loadingFinished') {
      const entry = this.byId.get(p.requestId);
      if (entry && entry.method !== 'OPTIONS') this.waits.push(this.send('Network.getResponseBody', { requestId: p.requestId })
        .then((result) => { entry.response = parse(result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body); }).catch(() => {}));
    }
  }
  calls(from = 0) { return this.log.slice(from).filter((entry) => entry.method !== 'OPTIONS'); }
  async settle() { await sleep(250); await Promise.allSettled(this.waits.splice(0)); }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(`DOM evaluation failed on ${this.label}`);
    return result.result.value;
  }
  act(body) { return this.eval(`(() => { ${HELPERS}\n${body} })()`); }
  async until(body, timeout = 30000, what = body) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { try { if (await this.act(body)) return true; } catch { /* document navigating */ } await sleep(250); }
    const text = await this.eval("document.body.innerText.replace(/\\s+/g,' ').slice(0,240)").catch(() => '?');
    throw new Error(`${this.label}: timed out waiting for ${what}; page text: ${text}`);
  }
  async shot(name, quality = 72, maxBytes = 512 * 1024) {
    const result = await this.send('Page.captureScreenshot', { format: 'jpeg', quality, captureBeyondViewport: false });
    const bytes = Buffer.from(result.data, 'base64');
    if (bytes.length > maxBytes || screenshotBytes + bytes.length > SCREENSHOT_BUDGET) throw new Error('Screenshot evidence exceeded its bounded output budget');
    const file = path.join(dirs.evidence, name);
    writeFileSync(file, bytes); screenshotBytes += bytes.length;
    return { path: `evidence/${name}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
}
const HELPERS = `
const main = document.querySelector('#gcsp-main') ?? document;
const $ = (selector) => main.querySelector(selector);
const button = (label) => [...main.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
const press = (label) => { const item = button(label); if (!item || item.disabled) return false; item.click(); return true; };
const text = () => main.textContent.replace(/\\s+/g, ' ').trim();
const setValue = (selector, value) => {
  const element = $(selector); if (!element || element.disabled) return false;
  const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true;
};
`;
async function newPage(cdp, label, width = 1440, height = 1000) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, sessionId, browserContextId, label);
  await page.send('Page.enable'); await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.send('Network.enable'); await page.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.send('Runtime.enable'); await page.send('Log.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  return page;
}
async function signIn(page, person, target = '/gcsp/comparison') {
  await page.send('Page.navigate', { url: `${ORIGINS.web}${target}` });
  await page.until(`return location.origin === '${ORIGINS.web}' && !!button('Sign in');`, 30000, 'unauthenticated sign-in page');
  const preSignIn = await page.act("return ({path:location.pathname, signInVisible:!!button('Sign in')});");
  await page.act("return press('Sign in');");
  await page.until(`return location.origin === '${ORIGINS.idp}' && !!document.querySelector('button[data-subject="sub-${person}"]');`, 30000, 'local OIDC login');
  await page.eval(`document.querySelector('button[data-subject="sub-${person}"]').click()`);
  await page.until(`return location.origin === '${ORIGINS.web}' && location.pathname === '${target}';`, 30000, 'safe return to comparison');
  return { preSignIn, pathAfterLogin: await page.eval('location.pathname') };
}
async function waitPost(page, from, endpoint) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    await page.settle();
    const rows = page.calls(from).filter((entry) => entry.method === 'POST' && entry.path === endpoint);
    if (rows.length && rows.every((entry) => entry.status !== null && (entry.response !== undefined || entry.failed))) return rows;
    await sleep(100);
  }
  throw new Error(`No completed browser POST ${endpoint}`);
}
const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const check = (scenario, name, passed, detail = undefined) => {
  scenario.checks[name] = passed === true;
  if (detail !== undefined) scenario.observations[name] = detail;
  if (!passed) throw new Error(name);
};
async function scenario(name, title, fn) {
  const out = { title, pass: false, checks: {}, observations: {} };
  receipt.scenarios[name] = out;
  log(`scenario ${name}: ${title}`);
  try { await fn(out); } catch (error) { out.error = error.message; out.checks.noException = false; }
  out.pass = Object.keys(out.checks).length > 0 && Object.values(out.checks).every((value) => value === true);
  writeFileSync(path.join(dirs.evidence, `checkpoint-${name}.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
function ensureScenario(result, label) { if (!result.pass) throw new Error(`${label} scenario did not pass`); }
async function viewport(page, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
}
async function domFacts(page) {
  return page.act(`return { text:text(), overflow:document.documentElement.scrollWidth > innerWidth + 1,
    headings:[...main.querySelectorAll('h1,h2,h3,h4')].map(h=>h.textContent.trim()),
    buttons:[...main.querySelectorAll('button')].map(b=>b.textContent.trim()),
    job:$('.comparison-job')?.innerText ?? '', result:$('.comparison-result')?.innerText ?? '',
    active:document.activeElement?.tagName, width:innerWidth };`);
}

// The UI's display-only mapping is mirrored only to compare each actual API fact with what was painted.
const MEASURES = { acceptableCoverage: 'Covered before renewal', carsNeverAllocated: 'Cars never allocated',
  heldNotTakenCarDays: 'Car time held but not taken', declinedOffers: 'Offers declined', expiredOffers: 'Offers expired',
  failedClaims: 'Holds that expired untaken', retries: 'Retries after a lost claim', meanAcceptedFit: 'Calculated fit of accepted cars' };
const VERDICTS = { 'buddy-better': 'Buddy route better', 'current-better': "Today's release route better",
  'variant-better': 'Tried value better', 'baseline-better': "Today's value better", 'no-clear-difference': 'No clear difference', 'insufficient-seeds': 'Too few seeds to compare' };
function words(value) { return String(value).replace(/[-_]/g, ' ').replace(/^./, (letter) => letter.toUpperCase()); }
function plain(value) {
  const replacements = [
    [/^People, cars and behaviour are fictional and assumed; .*$/, 'People, cars and behaviour are modelled, not BMW records.'],
    [/^Fictional cohort and assumed behaviour; /, 'Modelled cohort and assumed behaviour; '],
    [/^Fictional facts for mechanics; /, 'Vehicle and driver facts are assumed; '],
    [/^Underlying needs are synthetic latent inputs, not a real employee confirmation\.$/, 'Underlying needs are modelled inputs, not an employee confirmation.'],
    [/ Not a verified BMW amount\.$/, ''], [/\bin demo brief\/Q15\b/, 'in the brief (Q15)'],
    [/\b(?:synthetic|fictional|demonstration|demo)\b(?:[- ]clock)?[- ]?(?=\w)/gi, ''],
  ];
  const input = String(value ?? '');
  const output = replacements.reduce((text, [pattern, substitute]) => text.replace(pattern, substitute), input);
  return /^(?:synthetic|fictional|demo)/i.test(input) && output !== input ? output.charAt(0).toUpperCase() + output.slice(1) : output;
}
function jsonDisplay(value) {
  if (value === undefined) return 'Not supplied';
  if (typeof value === 'string') return plain(value);
  return JSON.stringify(value, (_key, item) => typeof item === 'string' ? plain(item) : item, 2);
}
function measureLabel(key) { return MEASURES[key] ?? (key.startsWith('accessGroupCoverage:') ? `Covered before renewal: ${key.slice(20).replace(/-/g, ' ')}` : words(key)); }
function numberDisplay(key, value, difference = false) {
  if (value === null) return 'Not observed';
  const share = key === 'acceptableCoverage' || key.startsWith('accessGroupCoverage:');
  const amount = Math.round(value * (share ? 1000 : 10)) / 10;
  return `${difference && amount > 0 ? '+' : ''}${amount}${share ? difference ? ' pts' : '%' : key === 'heldNotTakenCarDays' ? ' days' : ''}`;
}
function statsDisplay(key, stats, difference = false) {
  return `${numberDisplay(key, stats.mean, difference)} (${numberDisplay(key, stats.min, difference)} to ${numberDisplay(key, stats.max, difference)})`;
}
async function compareBaselineDom(page, stored, activePolicy) {
  const dom = await domFacts(page);
  const section = normalize(dom.result);
  const checks = { dom, measures: [], assumptions: [] };
  checks.resultId = section.includes(stored.resultId);
  checks.digest = section.includes(stored.resultDigest);
  checks.storedAt = section.includes(stored.storedAt);
  checks.origin = stored.origin === 'retained' && section.includes('Retained baseline');
  checks.policy = section.includes(stored.policyVersion) && normalize(dom.text).includes(normalize(activePolicy));
  checks.completedAt = section.includes(stored.result.completedAt);
  checks.seeds = stored.result.manifest.seeds.every((seed) => section.includes(seed));
  if (stored.result.manifest.codeRevision) checks.codeRevision = section.includes(stored.result.manifest.codeRevision);
  for (const row of stored.result.differences ?? []) {
    const rowChecks = {
      measure: section.includes(measureLabel(row.measure)),
      verdict: section.includes(VERDICTS[row.verdict] ?? words(row.verdict)),
      current: section.includes(statsDisplay(row.measure, row.current)),
      buddy: section.includes(statsDisplay(row.measure, row.buddy)),
      difference: section.includes(statsDisplay(row.measure, row.difference, true)),
    };
    checks.measures.push({ key: row.measure, actual: { current: row.current, buddy: row.buddy, difference: row.difference, verdict: row.verdict },
      checks: rowChecks, pass: Object.values(rowChecks).every(Boolean) });
  }
  for (const assumption of stored.result.assumptions) {
    const rowChecks = {
      key: section.includes(assumption.key), value: section.includes(normalize(jsonDisplay(assumption.value))),
      unit: section.includes(normalize(plain(assumption.unit))), status: section.includes(words(assumption.status)),
      basis: section.includes(normalize(plain(assumption.basis))),
      ...(assumption.source === undefined ? {} : { source: section.includes(normalize(jsonDisplay(assumption.source))) }),
      ...(assumption.policyVersion ? { policyVersion: section.includes(assumption.policyVersion) } : {}),
    };
    checks.assumptions.push({ key: assumption.key, actual: assumption, checks: rowChecks, pass: Object.values(rowChecks).every(Boolean) });
  }
  return { ...checks, pass: Object.entries(checks).filter(([key]) => !['dom', 'measures', 'assumptions'].includes(key)).every(([, value]) => value === true)
    && checks.measures.every((row) => row.pass) && checks.assumptions.every((row) => row.pass) };
}
async function experimentDomFacts(page) {
  return page.act([
    "const result = $('.comparison-result');",
    "const arms = result ? [...result.children].filter(node => node.matches('section.comparison-measure')) : [];",
    "const fold = result?.querySelector('details.comparison-fold');",
    "const headings = fold ? [...fold.querySelectorAll('h3')] : [];",
    "const nextPre = (label) => headings.find(node => node.textContent.trim() === label)?.nextElementSibling?.textContent ?? '';",
    "const measurementHeading = headings.find(node => node.textContent.trim() === 'Measurements and per-seed results');",
    "const effectDetails = result ? [...result.querySelectorAll('details')].find(node => node.querySelector('summary')?.textContent.includes('Effects of tried values against today’s value, by route')) : null;",
    "return { text: text(), overflow: document.documentElement.scrollWidth > innerWidth + 1, width: innerWidth,",
    "  resultHeading: result?.querySelector(':scope > h2')?.textContent.trim() ?? '',",
    "  arms: arms.map(section => ({ heading: section.querySelector('h3')?.textContent.trim() ?? '', text: section.innerText.replace(/\\s+/g, ' ').trim(), presets: [...section.querySelectorAll('details pre')].map(pre => pre.textContent),",
    "    measureRows: [...section.querySelectorAll('h4')].map(title => {",
    "      const verdict = title.nextElementSibling; const comparison = verdict?.nextElementSibling;",
    "      const cells = [...(comparison?.querySelectorAll('div') ?? [])];",
    "      const cell = label => cells.find(item => item.querySelector('dt')?.textContent.trim() === label);",
    "      const current = cell(\"Today's release route\"); const buddy = cell('Buddy route'); const difference = comparison?.nextElementSibling;",
    "      return { measure: title.textContent.trim(), verdict: verdict?.textContent.trim() ?? '',",
    "        currentLabel: current?.querySelector('dt')?.textContent.trim() ?? '', current: current?.querySelector('dd')?.textContent.trim() ?? '',",
    "        buddyLabel: buddy?.querySelector('dt')?.textContent.trim() ?? '', buddy: buddy?.querySelector('dd')?.textContent.trim() ?? '',",
    "        difference: difference?.textContent.trim() ?? '' };",
    "    }) })),",
    "  assumptions: fold ? [...fold.querySelectorAll('tbody tr')].map(row => {",
    "    const cells = [...row.querySelectorAll('th,td')]; const value = cells[1];",
    "    const source = [...(value?.querySelectorAll('p') ?? [])].find(item => item.textContent.trim().startsWith('Source:'));",
    "    const policy = [...(value?.querySelectorAll('p') ?? [])].find(item => item.textContent.trim().startsWith('Policy:'));",
    "    return { key: cells[0]?.innerText.trim() ?? '', value: value?.querySelector('pre')?.textContent ?? '',",
    "      source: source?.textContent.trim().replace(/^Source:\\s*/, '') ?? null, policy: policy?.textContent.trim().replace(/^Policy:\\s*/, '') ?? null,",
    "      unit: cells[2]?.innerText.trim() ?? '', status: cells[3]?.innerText.trim() ?? '', basis: cells[4]?.innerText.trim() ?? '' };",
    "  }) : [], manifest: nextPre('Manifest and unchanged workload'), rule: nextPre('Comparison rule'),",
    "  measures: measurementHeading?.nextElementSibling?.textContent ?? '',",
    "  perSeed: measurementHeading?.nextElementSibling?.nextElementSibling?.textContent ?? '',",
    "  effects: effectDetails?.querySelector('pre')?.textContent ?? '' };",
  ].join('\n'));
}
function sameJson(left, right) {
  const sorted = (value) => Array.isArray(value) ? value.map(sorted)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])])) : value;
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}
function assumptionByKey(result, key) { return result?.assumptions?.find((row) => row.key === key) ?? null; }
function auditCompletedHoldSweep(stored, baseline, activePolicy, job) {
  const result = stored.result ?? {};
  const manifest = result.manifest ?? {};
  const baselineHold = assumptionByKey(baseline.result, 'hold.buddy.durationSeconds');
  const actualHold = assumptionByKey(result, 'hold.buddy.durationSeconds');
  const hashes = baseline.result?.manifest?.inputHashes;
  const hashShape = !!hashes && typeof hashes === 'object' && !Array.isArray(hashes)
    && same(Object.keys(hashes).sort(), EXPECTED_SEEDS.slice().sort())
    && EXPECTED_SEEDS.every((seed) => typeof hashes[seed] === 'string' && /^[0-9a-f]{64}$/.test(hashes[seed]));
  const armManifests = manifest.arms ?? [];
  const arms = result.arms ?? [];
  const armIds = ['baseline', 'hold-3600'];
  const routeTotals = [];
  for (const arm of arms) {
    for (const row of arm.perSeed ?? []) {
      for (const route of ['current', 'buddy']) {
        const totals = row.routes?.[route]?.totals ?? null;
        const carTotal = totals ? totals.carsAllocated + totals.carsHeldNotTaken + totals.carsUnused : NaN;
        routeTotals.push({ armId: arm.armId, seed: row.seed, route,
          employees: totals?.employees ?? null, carsAllocated: totals?.carsAllocated ?? null,
          carsHeldNotTaken: totals?.carsHeldNotTaken ?? null, carsUnused: totals?.carsUnused ?? null,
          carsTotal: carTotal, pass: totals?.employees === 1000 && carTotal === 850 });
      }
    }
  }
  const change = manifest.change ?? {};
  const checks = {
    jobSucceeded: job?.status === 'succeeded' && job.resultId === stored.resultId && !!job.finishedAt && job.reason === null
      && job.progress?.stepsDone === 12 && job.progress?.stepsTotal === 12
      && job.progress?.seedsDone === 3 && job.progress?.seedsTotal === 3,
    storedRunIdentity: stored.origin === 'run' && stored.resultId === job?.resultId
      && typeof stored.resultDigest === 'string' && /^[0-9a-f]{64}$/.test(stored.resultDigest)
      && stored.resultDigest !== baseline.resultDigest && !!stored.storedAt && !!result.completedAt,
    experimentKind: result.kind === 'experiment-comparison' && result.experimentId === 'hold-sweep'
      && manifest.experimentId === 'hold-sweep',
    canonicalSeeds: same(manifest.seeds, EXPECTED_SEEDS) && same(baseline.result.manifest.seeds, EXPECTED_SEEDS),
    canonicalHoldBaseline: baselineHold?.value === 7200 && baselineHold?.unit === 'seconds'
      && actualHold?.value === 7200 && actualHold?.unit === 'seconds',
    unchangedPolicy: stored.policyVersion === activePolicy && stored.activePolicyVersion === activePolicy && stored.policyCurrent === true
      && baseline.policyVersion === activePolicy && baseline.activePolicyVersion === activePolicy && baseline.policyCurrent === true,
    exactSourceRevision: manifest.codeRevision === SOURCE_REVISION,
    onlyHoldWhatIf: change.key === 'hold.buddy.durationSeconds' && change.unit === 'seconds'
      && change.status === 'what-if' && change.basis === HOLD_SWEEP_BASIS && change.baselineValue === 7200
      && change.definitionKey === 'comparison.experiments.v1' && same(change.values, [3600])
      && manifest.overlays && typeof manifest.overlays === 'object' && !Array.isArray(manifest.overlays)
      && Object.keys(manifest.overlays).length === 0
      && result.limitations?.includes('What-if experiment: the changed values were never published as live policy.'),
    arms: arms.length === 2 && same(arms.map((arm) => arm.armId), armIds)
      && arms[0]?.value === 7200 && arms[1]?.value === 3600
      && armManifests.length === 2 && same(armManifests.map((arm) => arm.armId), armIds)
      && armManifests[0]?.value === 7200 && armManifests[1]?.value === 3600
      && same(armManifests[0]?.overlay, {}) && same(armManifests[1]?.overlay, { 'hold.buddy.durationSeconds': 3600 }),
    unchangedInputHashes: hashShape && armManifests.length === 2
      && armManifests.every((arm) => sameJson(arm.inputHashes, hashes))
      && sameJson(armManifests[0]?.inputHashes, armManifests[1]?.inputHashes),
    armSeedMeasures: arms.length === 2 && arms.every((arm) => same((arm.perSeed ?? []).map((row) => row.seed), EXPECTED_SEEDS)
      && (arm.differences?.length ?? 0) > 0 && !!arm.measures && !!arm.perSeed),
    actualWorkloadCounts: routeTotals.length === 12 && routeTotals.every((row) => row.pass),
    oneTriedEffect: result.effects?.length === 1 && result.effects[0]?.armId === 'hold-3600'
      && result.effects[0]?.value === 3600,
  };
  return {
    checks, pass: Object.values(checks).every(Boolean),
    workload: { employeesObservedPerRoute: routeTotals.every((row) => row.employees === 1000) ? 1000 : null,
      carsObservedPerRoute: routeTotals.every((row) => row.carsTotal === 850) ? 850 : null,
      seedsObserved: manifest.seeds ?? null, baselineHoldSeconds: actualHold?.value ?? null, trialHoldSeconds: change.values?.[0] ?? null,
      contractDays: 90, contractReleasesPerSeed: 9,
      contractSource: 'docs/gcsp/fucq452-process-comparisons-2026-11-16.md, Full-workload completion increment',
      retainedWorkloadSource: 'FUCQ-507 actual workload record at source 8d989318b; historical source only, not current result evidence',
      currentResultExposure: 'The Java comparison response exposes per-seed input hashes, not raw release schedules or generator counts.' },
    generatorSource: { sourceRevision: SOURCE_REVISION,
      comparisonInputs: { path: 'services/gcsp-api/src/main/java/gcsp/api/comparison/ComparisonInputs.java' },
      comparisonRunner: { path: 'services/gcsp-api/src/main/java/gcsp/api/comparison/ComparisonRunner.java' },
      observedInputIdentity: 'Both actual hold-sweep arm hashes must equal the pinned retained process-result hashes for each canonical seed.' },
    rowCounts: { arms: arms.length, manifestArms: armManifests.length, assumptions: result.assumptions?.length ?? 0,
      differencesPerArm: arms.map((arm) => arm.differences?.length ?? 0),
      perSeedRowsPerArm: arms.map((arm) => arm.perSeed?.length ?? 0),
      routeTotals: routeTotals.length, effects: result.effects?.length ?? 0 },
    routeTotals,
    inputHashes: hashShape ? hashes : null,
  };
}
function compareExperimentDomFacts(dom, stored) {
  const result = stored.result;
  const checks = { arms: [], assumptions: [] };
  checks.resultHeading = dom.resultHeading === 'New result: Hold duration';
  checks.manifest = normalize(dom.manifest) === normalize(jsonDisplay(result.manifest));
  checks.rule = normalize(dom.rule) === normalize(jsonDisplay(result.rule));
  checks.resultMeasures = normalize(dom.measures) === normalize(jsonDisplay(result.measures));
  checks.resultPerSeed = normalize(dom.perSeed) === normalize(jsonDisplay(result.perSeed));
  checks.effects = normalize(dom.effects) === normalize(jsonDisplay(result.effects));
  checks.armCount = dom.arms.length === (result.arms?.length ?? -1) && dom.arms.length === 2;
  for (const arm of result.arms ?? []) {
    const section = dom.arms.find((candidate) => candidate.text.includes('Arm ' + arm.armId + ' ·'));
    const armLabel = arm.armId === 'baseline' ? 'Today’s value:' : 'Tried value:';
    const armChecks = {
      value: !!section && section.heading.includes(armLabel) && section.heading.includes(normalize(jsonDisplay(arm.value))),
      label: !!section && section.text.includes('Arm ' + arm.armId + ' ·'),
      currentRoute: !!section && section.text.includes("Today's release route"),
      buddyRoute: !!section && section.text.includes('Buddy route'),
      measureRowCount: !!section && section.measureRows.length === (arm.differences?.length ?? 0),
      measuresJson: !!section && section.presets.length === 2 && normalize(section.presets[0]) === normalize(jsonDisplay(arm.measures)),
      perSeedJson: !!section && section.presets.length === 2 && normalize(section.presets[1]) === normalize(jsonDisplay(arm.perSeed)),
      differences: [],
    };
    for (const row of arm.differences ?? []) {
      const rendered = section?.measureRows.find((candidate) => candidate.measure === measureLabel(row.measure));
      const rowChecks = {
        measure: !!rendered && rendered.measure === measureLabel(row.measure),
        verdict: !!rendered && normalize(rendered.verdict) === normalize(VERDICTS[row.verdict] ?? words(row.verdict)),
        currentLabel: !!rendered && rendered.currentLabel === "Today's release route",
        current: !!rendered && normalize(rendered.current) === normalize(statsDisplay(row.measure, row.current)),
        buddyLabel: !!rendered && rendered.buddyLabel === 'Buddy route',
        buddy: !!rendered && normalize(rendered.buddy) === normalize(statsDisplay(row.measure, row.buddy)),
        difference: !!rendered && normalize(rendered.difference) === normalize('Difference (buddy minus today): ' + statsDisplay(row.measure, row.difference, true)),
      };
      armChecks.differences.push({ measure: row.measure, actual: { current: row.current, buddy: row.buddy,
        difference: row.difference, verdict: row.verdict }, checks: rowChecks, pass: Object.values(rowChecks).every(Boolean) });
    }
    armChecks.pass = Object.entries(armChecks).filter(([key]) => key !== 'differences' && key !== 'pass')
      .every(([, value]) => value === true) && armChecks.differences.length > 0 && armChecks.differences.every((row) => row.pass);
    checks.arms.push({ armId: arm.armId, value: arm.value, checks: armChecks, pass: armChecks.pass });
  }
  for (const assumption of result.assumptions ?? []) {
    const row = dom.assumptions.find((candidate) => candidate.key === assumption.key);
    const rowChecks = {
      present: !!row,
      value: !!row && normalize(row.value) === normalize(jsonDisplay(assumption.value)),
      unit: !!row && normalize(row.unit) === normalize(plain(assumption.unit)),
      status: !!row && normalize(row.status) === words(assumption.status),
      basis: !!row && normalize(row.basis) === normalize(plain(assumption.basis)),
      ...(assumption.source === undefined ? {} : { source: !!row && normalize(row.source) === normalize(jsonDisplay(assumption.source)) }),
      ...(assumption.policyVersion ? { policyVersion: !!row && row.policy === assumption.policyVersion } : {}),
    };
    checks.assumptions.push({ key: assumption.key, actual: assumption, checks: rowChecks,
      pass: Object.values(rowChecks).every(Boolean) });
  }
  checks.assumptionCount = checks.assumptions.length === result.assumptions.length && dom.assumptions.length === result.assumptions.length;
  checks.pass = Object.entries(checks).filter(([key]) => !['arms', 'assumptions', 'pass'].includes(key)).every(([, value]) => value === true)
    && checks.arms.every((arm) => arm.pass) && checks.assumptions.length > 0 && checks.assumptions.every((row) => row.pass);
  return checks;
}
function writeProgressCheckpoint(progress) {
  const file = path.join(dirs.evidence, 'completed-hold-sweep-progress.json');
  const temporary = file + '.tmp';
  const serialized = JSON.stringify(progress) + '\n';
  if (Buffer.byteLength(serialized) > 16 * 1024) throw new Error('Hold-sweep progress checkpoint exceeded 16KiB');
  writeFileSync(temporary, serialized);
  renameSync(temporary, file);
}
function jobFrom(response) {
  return response.json?.status === 'ok' && typeof response.json?.value?.jobId === 'string' ? response.json.value : null;
}
async function latestJob(person = 'greg', jobId = undefined) {
  const suffix = `/comparison/jobs/latest${jobId ? `?jobId=${encodeURIComponent(jobId)}` : ''}`;
  const response = await call(person, suffix);
  if (![200, 404].includes(response.status) || typeof response.json?.reruns !== 'boolean') throw new Error('Comparison job read did not return its actual status contract');
  return { response, job: jobFrom(response), reruns: response.json.reruns };
}
async function startThroughDom(page) {
  const before = page.log.length;
  const facts = await domFacts(page);
  if (!facts.buttons.includes('Start comparison')) throw new Error('Greg start button is not available in the DOM');
  const selected = await page.eval("document.querySelector('#comparison-experiment')?.value");
  if (selected !== 'process-only') throw new Error('The process-only experiment is not selected');
  if (!await page.act("return press('Start comparison');")) throw new Error('Greg start button could not be activated');
  const posts = await waitPost(page, before, '/comparison/jobs');
  if (posts.length !== 1 || !posts[0].auth || posts[0].status !== 202 || posts[0].failed || posts[0].response?.status !== 'pending') {
    throw new Error('The Angular start did not receive one signed pending response');
  }
  const body = posts[0].request;
  if (!body || !same(body.keys, ['commandId', 'experimentId']) || !body.hasCommandId || body.experimentId !== 'process-only' || body.change !== null) {
    throw new Error('The DOM start changed the server-owned process-only workload or command shape');
  }
  const job = posts[0].response.value;
  if (!job || job.status !== 'running' || job.experimentId !== 'process-only') throw new Error('The server did not create a real running process-only job');
  return { jobId: job.jobId, initial: job, browserRequest: body, status: posts[0].status };
}
async function startHoldSweepThroughDom(page) {
  const initial = await domFacts(page);
  if (!initial.buttons.includes('Start comparison')) throw new Error('Greg hold-sweep start button is not available in the DOM');
  if (!await page.act("return setValue('#comparison-experiment', 'hold-sweep');")) throw new Error('Could not select hold sweep in the DOM');
  if (!await page.act("return setValue('#comparison-values', '3600') && setValue('#comparison-basis', " + JSON.stringify(HOLD_SWEEP_BASIS) + ");")) {
    throw new Error('Could not enter the hold-sweep trial and basis in the DOM');
  }
  const form = await page.eval("({experiment:document.querySelector('#comparison-experiment')?.value, values:document.querySelector('#comparison-values')?.value, basis:document.querySelector('#comparison-basis')?.value, note:document.querySelector('.comparison-command')?.innerText ?? ''})");
  if (form.experiment !== 'hold-sweep' || form.values.trim() !== '3600' || form.basis.trim() !== HOLD_SWEEP_BASIS
    || !form.note.includes('Seeds and workload sizes stay unchanged.')
    || !form.note.includes('A tried value is never published as live policy.')) {
    throw new Error('The visible command form did not retain the exact hold-sweep trial and unchanged-workload note');
  }
  const before = page.log.length;
  if (!await page.act("return press('Start comparison');")) throw new Error('The hold-sweep start button could not be activated');
  const posts = await waitPost(page, before, '/comparison/jobs');
  const allPosts = page.calls(before).filter((entry) => entry.method === 'POST' && entry.path === '/comparison/jobs');
  if (posts.length !== 1 || allPosts.length !== 1 || !posts[0].auth || posts[0].status !== 202 || posts[0].failed
    || posts[0].response?.status !== 'pending') {
    throw new Error('The DOM did not send exactly one signed 202 hold-sweep command');
  }
  const body = posts[0].request;
  const expectedChange = { values: [3600], basis: HOLD_SWEEP_BASIS };
  if (!body || !same(body.keys, ['change', 'commandId', 'experimentId']) || !body.hasCommandId
    || body.experimentId !== 'hold-sweep' || !sameJson(body.change, expectedChange)) {
    throw new Error('The DOM request changed the hold trial, seeds, overlay or server-owned workload shape');
  }
  const job = posts[0].response.value;
  if (!job || job.status !== 'running' || job.experimentId !== 'hold-sweep'
    || !sameJson(job.request, { experimentId: 'hold-sweep', change: expectedChange })
    || job.progress?.seedsTotal !== EXPECTED_SEEDS.length || job.progress?.stepsTotal !== 12
    || !Number.isInteger(job.progress?.stepsDone) || job.progress.stepsDone < 0
    || job.resultId !== null || job.finishedAt !== null || job.reason !== null) {
    throw new Error('The Java service did not create the expected real 3-seed/12-step hold-sweep job');
  }
  return { jobId: job.jobId, initial: job, browserRequest: body, form, status: posts[0].status };
}
async function readStoredComparison(person = 'greg') {
  const response = await call(person, '/comparison/results/latest?experimentId=hold-sweep');
  if (response.status !== 200 || response.json?.status !== 'ok' || !response.json?.value?.result) {
    throw new Error('The actual hold-sweep result read failed: HTTP ' + response.status + ' (' + (response.json?.code ?? 'no result') + ')');
  }
  return { response, stored: response.json.value };
}
function browserComparisonFrom(page, experimentId) {
  const reads = page.calls().filter((entry) => entry.method === 'GET' && entry.path === '/comparison/results/latest'
    && entry.status === 200 && entry.auth && entry.response?.status === 'ok' && Array.isArray(entry.response?.value?.experiments));
  const catalogue = reads.at(-1)?.response?.value;
  return catalogue?.experiments?.find((entry) => entry.experimentId === experimentId)?.latest ?? null;
}
function browserJobFrom(page, jobId) {
  const reads = page.calls().filter((entry) => entry.method === 'GET' && entry.path === '/comparison/jobs/latest'
    && entry.status === 200 && entry.auth && entry.response?.status === 'ok' && entry.response?.value?.jobId === jobId);
  return reads.at(-1)?.response?.value ?? null;
}
function validateHoldJob(job, jobId, previous = null) {
  if (!job || job.jobId !== jobId || job.experimentId !== 'hold-sweep') throw new Error('The hold-sweep job identity changed or disappeared');
  const progress = job.progress;
  if (!progress || progress.seedsTotal !== EXPECTED_SEEDS.length || progress.stepsTotal !== 12
    || !Number.isInteger(progress.seedsDone) || !Number.isInteger(progress.stepsDone)
    || progress.seedsDone < 0 || progress.seedsDone > EXPECTED_SEEDS.length || progress.stepsDone < 0 || progress.stepsDone > 12) {
    throw new Error('The real hold-sweep job returned invalid 3-seed/12-step progress');
  }
  if (previous && (progress.stepsDone < previous.progress.stepsDone || progress.seedsDone < previous.progress.seedsDone
    || progress.stepsTotal !== previous.progress.stepsTotal || progress.seedsTotal !== previous.progress.seedsTotal)) {
    throw new Error('The actual hold-sweep job progress moved backwards or changed its totals');
  }
  if (!sameJson(job.request, { experimentId: 'hold-sweep', change: { values: [3600], basis: HOLD_SWEEP_BASIS } })) {
    throw new Error('The persisted job request no longer matches the single hold-sweep command');
  }
  if (job.status === 'running' && (job.resultId !== null || job.finishedAt !== null || job.reason !== null)) {
    throw new Error('The running hold-sweep job reported a premature result or terminal field');
  }
  return job;
}
async function disposeBrowserPage(page) {
  if (!page) return false;
  await page.cdp.send('Target.disposeBrowserContext', { browserContextId: page.ctxId });
  return true;
}
async function waitForActualStep(jobId, page) {
  const hardEnd = Date.now() + Math.min(240000, Math.max(0, DEADLINE_MS - (Date.now() - T0) - 120000));
  if (hardEnd <= Date.now()) throw new Error('Insufficient bounded time remains to observe a real comparison step');
  while (Date.now() < hardEnd) {
    const read = await latestJob('greg', jobId);
    if (read.job?.jobId !== jobId) throw new Error('The started job identity was not returned by the API');
    if (read.job.status !== 'running') return read.job;
    if (read.job.progress.stepsDone >= 1) {
      await page.until("return /Steps:\\s*[1-6]\\s+of\\s+6/i.test(text()) && !!$('.comparison-job');", 10000, 'actual progress in the comparison DOM');
      return read.job;
    }
    await sleep(1500);
  }
  throw new Error('No actual Java progress step was recorded within the 4-minute bounded observation');
}

async function runCompletedExperimentMode(cdp, catalogue, baseline) {
  let storedIdentity = null;
  const completedScenario = await scenario('completed-hold-sweep', 'One full-size hold-sweep completes and its stored result is read back', async (s) => {
    const priorJob = await latestJob('greg');
    const holdEntry = catalogue.experiments?.find((entry) => entry.experimentId === 'hold-sweep');
    check(s, 'The isolated run starts with an empty hold-sweep result and no comparison job',
      holdEntry?.latest === null && priorJob.response.status === 404 && priorJob.job === null && priorJob.reruns === true,
      { holdSweepLatest: holdEntry?.latest ?? null, priorJobHttp: priorJob.response.status, noPriorJob: priorJob.job === null,
        reruns: priorJob.reruns });
    if (holdEntry?.latest !== null) throw new Error('The hold-sweep experiment already has a stored result in this isolated run');
    if (priorJob.response.status !== 404 || priorJob.job !== null) throw new Error('The isolated run already has a comparison job');

    let gregPage = await newPage(cdp, 'Greg completed hold-sweep start');
    const login = await signIn(gregPage, 'greg');
    check(s, 'Fresh Greg OIDC login returns safely to the comparison route',
      login.preSignIn.signInVisible === true && login.pathAfterLogin === '/gcsp/comparison',
      { browserContext: 'fresh CDP context', signedOutBeforeLogin: login.preSignIn.signInVisible, pathAfterLogin: login.pathAfterLogin });
    await gregPage.until("return !!$('#comparison-experiment') && !!$('.comparison-result') && text().includes(" + JSON.stringify(baseline.resultId) + ");",
      30000, 'retained baseline loaded before the hold-sweep start');
    check(s, 'The signed browser reads use bearer requests', gregPage.calls().filter((row) => row.path.startsWith('/comparison/')).length > 0
      && gregPage.calls().filter((row) => row.path.startsWith('/comparison/')).every((row) => row.auth));
    const reserveWall = PROOF_DEADLINE_WALL_MS - Date.now() - COMPLETED_RESULT_RESERVE_MS;
    const reserveMono = PROOF_DEADLINE_MONO_MS - monoElapsedMs() - COMPLETED_RESULT_RESERVE_MS;
    const effectiveWindowMs = Math.min(COMPLETED_JOB_TIMEOUT_MS, reserveWall, reserveMono);
    if (!Number.isFinite(effectiveWindowMs) || effectiveWindowMs <= 90000) {
      throw new Error('Insufficient remaining absolute proof deadline to start and inspect one bounded completed experiment');
    }
    const jobStartedWallMs = Date.now();
    const jobStartedMonotonicMs = monoElapsedMs();
    const jobDeadlineWallMs = jobStartedWallMs + effectiveWindowMs;
    const jobDeadlineMonotonicMs = jobStartedMonotonicMs + effectiveWindowMs;
    receipt.executionPlan.job = { canonicalTimeoutSeconds: COMPLETED_JOB_TIMEOUT_MS / 1000,
      effectiveTimeoutSeconds: effectiveWindowMs / 1000, startedAt: new Date(jobStartedWallMs).toISOString(),
      startedWallMs: jobStartedWallMs, startedMonotonicElapsedMs: jobStartedMonotonicMs,
      deadlineWallMs: jobDeadlineWallMs, deadlineMonotonicElapsedMs: jobDeadlineMonotonicMs,
      afterCompletionReserveSeconds: COMPLETED_RESULT_RESERVE_MS / 1000, pollingIntervalSeconds: 30,
      firstStepObservationWindowSeconds: FIRST_BROWSER_STEP_WINDOW_MS / 1000 };
    const started = await startHoldSweepThroughDom(gregPage);
    const jobId = started.jobId;
    let latest = validateHoldJob(started.initial, jobId);
    s.observations.visibleCommandForm = started.form;
    s.observations.browserStart = { channel: 'Angular DOM click', httpStatus: started.status, jobId,
      request: started.browserRequest, initialStatus: latest.status, progress: latest.progress,
      exactExperiment: latest.experimentId === 'hold-sweep', noResult: latest.resultId === null };
    check(s, 'One signed Greg DOM command starts a running 3-seed/12-step job with no result',
      started.status === 202 && latest.status === 'running' && latest.progress.seedsTotal === 3
        && latest.progress.stepsTotal === 12 && latest.progress.stepsDone === 0 && latest.resultId === null);
    let lastProgressKey = '';
    const recordProgress = (job, phase) => {
      const key = JSON.stringify({ status: job.status, progress: job.progress });
      if (key === lastProgressKey) return false;
      lastProgressKey = key;
      const snapshot = { phase, at: new Date().toISOString(), wallElapsedMs: Date.now() - T0,
        monotonicElapsedMs: monoElapsedMs(), jobElapsedWallMs: Date.now() - jobStartedWallMs,
        jobElapsedMonotonicMs: monoElapsedMs() - jobStartedMonotonicMs,
        job: { jobId: job.jobId, status: job.status, progress: job.progress, resultId: job.resultId,
          finishedAt: job.finishedAt, reason: job.reason } };
      writeProgressCheckpoint(snapshot);
      (s.observations.progressChanges ??= []).push(snapshot);
      log('hold-sweep progress', job.progress.stepsDone + '/12 steps', job.progress.seedsDone + '/3 seeds', job.status);
      return true;
    };
    recordProgress(latest, 'start-response');
    const pollJob = async () => {
      const read = await latestJob('greg', jobId);
      if (read.response.status !== 200 || !read.job) {
        throw new Error('The signed Java API stopped returning the exact hold-sweep job: HTTP ' + read.response.status);
      }
      latest = validateHoldJob(read.job, jobId, latest);
      recordProgress(latest, 'signed-api-poll');
      if (latest.status === 'failed' || latest.status === 'interrupted') {
        s.observations.terminalFailure = { status: latest.status, reason: latest.reason,
          progress: latest.progress, finishedAt: latest.finishedAt };
        throw new Error('The hold-sweep job ended ' + latest.status + ': ' + (latest.reason ?? 'no terminal reason was returned'));
      }
      if (!['running', 'succeeded'].includes(latest.status)) throw new Error('The hold-sweep job returned unknown status ' + latest.status);
      return latest;
    };
    const hasJobTime = () => Date.now() < jobDeadlineWallMs && monoElapsedMs() < jobDeadlineMonotonicMs;
    const sleepForPoll = async () => {
      const remainingWall = jobDeadlineWallMs - Date.now();
      const remainingMono = jobDeadlineMonotonicMs - monoElapsedMs();
      const wait = Math.min(30000, remainingWall, remainingMono);
      if (wait > 0) await sleep(wait);
    };
    let firstStepObserved = false;
    const firstStepDeadlineWall = Math.min(jobStartedWallMs + FIRST_BROWSER_STEP_WINDOW_MS, jobDeadlineWallMs);
    const firstStepDeadlineMonotonic = Math.min(jobStartedMonotonicMs + FIRST_BROWSER_STEP_WINDOW_MS, jobDeadlineMonotonicMs);
    while (latest.status === 'running' && latest.progress.stepsDone < 1 && hasJobTime()
      && Date.now() < firstStepDeadlineWall && monoElapsedMs() < firstStepDeadlineMonotonic) {
      await sleepForPoll();
      if (!hasJobTime()) break;
      await pollJob();
    }
    if (latest.progress.stepsDone >= 1 && latest.status === 'running') {
      await gregPage.act("const details=document.querySelector('.comparison-job details'); if(!details)return false; details.open=true; return true;");
      await gregPage.until("return /Steps:\\s*[1-9]\\d*\\s+of\\s+12/i.test(text()) && !!$('.comparison-job');",
        30000, 'the first actual hold-sweep step in the Angular job strip');
      const runningFacts = await domFacts(gregPage);
      const shownSteps = Number(/Steps:\s*(\d+)\s+of\s+12/i.exec(runningFacts.job)?.[1] ?? 0);
      firstStepObserved = runningFacts.job.includes(jobId) && shownSteps >= 1 && shownSteps <= latest.progress.stepsDone
        && latest.resultId === null;
      s.observations.runningDom = { status: latest.status, jobId, apiProgress: latest.progress,
        shownSteps, jobText: runningFacts.job, resultVisible: !!runningFacts.result,
        browserErrors: gregPage.errors, screenshot: null,
        note: 'This is the last DOM observation before the context is disposed; remaining progress is read from the signed Java API.' };
      check(s, 'The first actual 12-step job progress is rendered in Greg’s running DOM', firstStepObserved,
        { apiProgress: latest.progress, shownSteps, jobText: runningFacts.job });
      if (firstStepObserved) s.observations.runningDom.screenshot =
        await gregPage.shot('comparison-hold-sweep-running.jpg', 48, 256 * 1024);
    } else {
      const runningFacts = await domFacts(gregPage);
      s.observations.runningDom = { status: latest.status, progress: latest.progress, firstStepObserved: false,
        observationDeadlineSeconds: FIRST_BROWSER_STEP_WINDOW_MS / 1000,
        jobText: runningFacts.job, resultVisible: !!runningFacts.result,
        note: 'No completed step was observed in the initial Greg context before its bounded observation window ended.' };
    }
    const disposed = await disposeBrowserPage(gregPage);
    s.observations.initialGregContextDisposed = { disposed, browserContextId: gregPage.ctxId,
      firstStepObserved, observation: 'No DOM polling continues; each subsequent API call mints a fresh signed token.' };
    gregPage = null;
    await stopBrowser();
    s.observations.initialBrowserStopped = { stoppedAt: new Date().toISOString(), noContinuousDom: true,
      observation: 'Only signed Java API polling continues; a fresh browser and real sign-in are required for result inspection.' };

    while (latest.status === 'running' && hasJobTime()) {
      await sleepForPoll();
      if (!hasJobTime()) break;
      await pollJob();
    }
    if (latest.status === 'running') {
      s.observations.timeout = { status: latest.status, reason: latest.reason, progress: latest.progress,
        wallElapsedMs: Date.now() - T0, monotonicElapsedMs: monoElapsedMs(),
        wallJobElapsedMs: Date.now() - jobStartedWallMs, monotonicJobElapsedMs: monoElapsedMs() - jobStartedMonotonicMs,
        wallDeadlineReached: Date.now() >= jobDeadlineWallMs, monotonicDeadlineReached: monoElapsedMs() >= jobDeadlineMonotonicMs };
      throw new Error('The hold-sweep job did not finish before its one-time bounded deadline; last status running at '
        + latest.progress.stepsDone + '/12 steps and ' + latest.progress.seedsDone + '/3 seeds. No retry was attempted.');
    }
    if (latest.status !== 'succeeded') throw new Error('The actual hold-sweep job did not succeed; terminal status was ' + latest.status);
    check(s, 'The completed Java job has 12/12 steps, 3/3 seeds and a stored result identity',
      latest.progress.stepsDone === 12 && latest.progress.stepsTotal === 12 && latest.progress.seedsDone === 3
        && latest.progress.seedsTotal === 3 && !!latest.resultId && !!latest.finishedAt && latest.reason === null,
      { jobId, status: latest.status, finishedAt: latest.finishedAt, resultId: latest.resultId, progress: latest.progress,
        reason: latest.reason });

    const storedRead = await readStoredComparison('greg');
    const stored = storedRead.stored;
    const resultJson = JSON.stringify(stored, null, 2) + '\n';
    const resultJsonBytes = Buffer.byteLength(resultJson);
    if (resultJsonBytes > 2 * 1024 * 1024) throw new Error('Actual hold-sweep result JSON exceeded its 2MiB evidence bound');
    const resultFile = path.join(dirs.evidence, 'completed-hold-sweep-result.json');
    writeFileSync(resultFile, resultJson);
    receipt.completedResultArtifact = { path: 'evidence/completed-hold-sweep-result.json', bytes: resultJsonBytes,
      sha256: createHash('sha256').update(resultJson).digest('hex'), source: 'signed Java GET /comparison/results/latest?experimentId=hold-sweep' };
    const audit = auditCompletedHoldSweep(stored, baseline, catalogue.activePolicyVersion, latest);
    s.observations.completedResultAudit = audit;
    check(s, 'Actual result, canonical workload, unchanged input hashes and both route totals match the real run', audit.pass, audit);
    s.observations.resultIdentity = { resultId: stored.resultId, resultDigest: stored.resultDigest, origin: stored.origin,
      experimentId: stored.result.experimentId, kind: stored.result.kind, codeRevision: stored.result.manifest.codeRevision,
      policyVersion: stored.policyVersion, activePolicyVersion: stored.activePolicyVersion,
      completedAt: stored.result.completedAt, storedAt: stored.storedAt };
    storedIdentity = { stored, jobId, resultId: stored.resultId, resultDigest: stored.resultDigest };

    await stopApi();
    await startApi();
    const restartedJobRead = await latestJob('greg', jobId);
    const restartedResultRead = await readStoredComparison('greg');
    const persistence = { jobHttp: restartedJobRead.response.status,
      sameJob: sameJson(restartedJobRead.job, latest), storedHttp: restartedResultRead.response.status,
      sameStoredResult: sameJson(restartedResultRead.stored, stored),
      jobId: restartedJobRead.job?.jobId ?? null, status: restartedJobRead.job?.status ?? null,
      resultId: restartedResultRead.stored.resultId ?? null, resultDigest: restartedResultRead.stored.resultDigest ?? null };
    receipt.executionPlan.persistenceRestart = persistence;
    check(s, 'One ordinary API restart preserves the exact succeeded job and stored result identity',
      persistence.jobHttp === 200 && persistence.sameJob && persistence.storedHttp === 200 && persistence.sameStoredResult
        && persistence.jobId === jobId && persistence.status === 'succeeded' && persistence.resultId === latest.resultId
        && persistence.resultDigest === stored.resultDigest, persistence);

    cdp = await startBrowser();
    let readbackPage = await newPage(cdp, 'Greg completed hold-sweep result', 1440, 1000);
    try {
      const readbackLogin = await signIn(readbackPage, 'greg');
      await readbackPage.until("return !!$('#comparison-experiment') && !!$('.comparison-result');", 30000, 'fresh Greg comparison load after API restart');
      if (!await readbackPage.act("return setValue('#comparison-experiment', 'hold-sweep');")) throw new Error('Fresh Greg could not select the completed hold-sweep result');
      await readbackPage.act("document.querySelectorAll('.comparison-result details, .comparison-job details').forEach(detail => detail.open = true); return true;");
      await readbackPage.until("return text().includes(" + JSON.stringify(stored.resultId) + ") && text().includes(" + JSON.stringify(stored.resultDigest)
        + ") && text().includes('New result stored and read back.');", 30000, 'fresh Greg actual completed result readback');
      await readbackPage.settle();
      const browserStored = browserComparisonFrom(readbackPage, 'hold-sweep');
      const browserJob = browserJobFrom(readbackPage, jobId);
      const facts = await domFacts(readbackPage);
      const experimentDom = compareExperimentDomFacts(await experimentDomFacts(readbackPage), stored);
      const readCalls = readbackPage.calls().filter((row) => row.path.startsWith('/comparison/'));
      const newResultHeader = facts.job.includes('New result stored and read back.')
        && facts.job.includes(jobId) && facts.job.includes(stored.resultId);
      const exactBrowserIdentity = !!browserStored && sameJson(browserStored, stored)
        && browserStored.resultId === stored.resultId && browserStored.resultDigest === stored.resultDigest && browserStored.origin === 'run';
      check(s, 'Fresh signed Greg browser reads the same result and durable job as the Java API', exactBrowserIdentity
        && browserJob?.jobId === jobId && browserJob.status === 'succeeded'
        && readCalls.length > 0 && readCalls.every((row) => row.auth),
        { resultRead: !!browserStored, exactResult: exactBrowserIdentity, jobRead: browserJob,
          signedReadCalls: readCalls.map((row) => ({ method: row.method, path: row.path, status: row.status, auth: row.auth })) });
      check(s, 'The new result identity is visible in Greg’s completed job header', newResultHeader,
        { jobText: facts.job, resultId: stored.resultId, jobId });
      check(s, 'Every actual hold-sweep arm, measure, assumption and JSON disclosure matches its own DOM section',
        experimentDom.pass, experimentDom);
      check(s, 'Greg sees the unchanged-workload and what-if boundary without an improvement promise',
        facts.text.includes('Seeds and workload sizes stay unchanged.')
          && facts.text.includes('A tried value is never published as live policy.')
          && !/will improve|guaranteed(?:ly)? improve|guarantees? improvement/i.test(facts.text),
        { unchangedWorkloadNote: facts.text.includes('Seeds and workload sizes stay unchanged.'),
          whatIfNote: facts.text.includes('A tried value is never published as live policy.') });
      check(s, 'Greg completed result has no browser runtime exception', readbackPage.errors.length === 0, readbackPage.errors);
      await readbackPage.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await readbackPage.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      const focus = await readbackPage.eval("({tag:document.activeElement?.tagName,id:document.activeElement?.id ?? '',outline:getComputedStyle(document.activeElement).outlineStyle,outlineWidth:getComputedStyle(document.activeElement).outlineWidth,focusVisible:document.activeElement?.matches(':focus-visible') ?? false,visible:document.activeElement?.getBoundingClientRect().width>0 && document.activeElement?.getBoundingClientRect().height>0})");
      s.observations.keyboardFocus = focus;
      check(s, 'Keyboard reaches a visible completed-result control with visible focus',
        ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(focus.tag)
          && focus.outline !== 'none' && focus.outlineWidth !== '0px' && focus.focusVisible && focus.visible, focus);
      await readbackPage.act("document.querySelector('.comparison-result details.comparison-fold')?.removeAttribute('open'); document.querySelectorAll('.comparison-result details:not(.comparison-fold)').forEach(detail => detail.removeAttribute('open')); document.querySelector('.comparison-job details')?.setAttribute('open',''); document.querySelector('.comparison-job')?.scrollIntoView({block:'start'}); return true;");
      const headerFacts = await domFacts(readbackPage);
      check(s, '1440px completed header view has no horizontal overflow', !headerFacts.overflow, { width: headerFacts.width });
      s.observations.completedHeaderCapture = await readbackPage.shot('comparison-hold-sweep-completed-header.jpg', 52, 400 * 1024);
      await readbackPage.act("const arm=document.querySelector('.comparison-result > section.comparison-measure'); if(!arm)return false; arm.scrollIntoView({block:'start'}); return true;");
      const armFacts = await experimentDomFacts(readbackPage);
      check(s, 'Desktop view is scrolled to a populated actual arm and has no horizontal overflow',
        !armFacts.overflow && armFacts.arms.length === 2 && armFacts.arms[0].measureRows.length > 0,
        { width: armFacts.width, armHeading: armFacts.arms[0]?.heading,
          actualMeasure: armFacts.arms[0]?.measureRows[0] });
      s.observations.desktopArmCapture = await readbackPage.shot('comparison-hold-sweep-arm-desktop.jpg', 52, 400 * 1024);
      await viewport(readbackPage, 390, 844);
      await readbackPage.act("const arm=document.querySelector('.comparison-result > section.comparison-measure'); if(!arm)return false; arm.scrollIntoView({block:'start'}); return true;");
      const narrowFacts = await experimentDomFacts(readbackPage);
      check(s, '390px view is scrolled to populated actual arm data with no horizontal overflow',
        !narrowFacts.overflow && narrowFacts.arms.length === 2 && narrowFacts.arms[0].measureRows.length > 0,
        { width: narrowFacts.width, armHeading: narrowFacts.arms[0]?.heading,
          actualMeasure: narrowFacts.arms[0]?.measureRows[0] });
      s.observations.narrowArmCapture = await readbackPage.shot('comparison-hold-sweep-arm-narrow.jpg', 52, 400 * 1024);
      s.observations.readback = { login: readbackLogin.pathAfterLogin, selectedExperiment: 'hold-sweep',
        displayedArms: experimentDom.arms.length, assumptions: experimentDom.assumptions.length,
        differenceRowsPerArm: experimentDom.arms.map((arm) => arm.checks.differences.length),
        screenshots: [s.observations.completedHeaderCapture, s.observations.desktopArmCapture, s.observations.narrowArmCapture] };
      check(s, 'A first actual running step was captured before disposing the initial Greg context', firstStepObserved,
        { firstStepObserved, observation: s.observations.runningDom, pageDisposedAfterObservation: disposed });
    } finally {
      const disposedReadback = await disposeBrowserPage(readbackPage);
      s.observations.gregReadbackContextDisposed = { disposed: !!disposedReadback, browserContextId: readbackPage.ctxId };
      readbackPage = null;
    }
  });
  ensureScenario(completedScenario, 'Completed hold-sweep');

  const presenterScenario = await scenario('completed-presenter-inspection', 'Presenter freshly reads the same completed result without command access', async (s) => {
    let presenterPage = await newPage(cdp, 'Presenter completed hold-sweep');
    try {
      const login = await signIn(presenterPage, 'presenter');
      await presenterPage.until("return !!$('#comparison-experiment') && !!$('.comparison-result');",
        30000, 'fresh presenter comparison load after API restart');
      if (!await presenterPage.act("return setValue('#comparison-experiment', 'hold-sweep');")) throw new Error('Presenter could not select the completed hold-sweep result');
      await presenterPage.act("document.querySelectorAll('.comparison-result details, .comparison-job details').forEach(detail => detail.open = true); return true;");
      await presenterPage.until("return text().includes(" + JSON.stringify(storedIdentity.resultId) + ") && text().includes(" + JSON.stringify(storedIdentity.resultDigest)
        + ");", 30000, 'presenter actual completed result readback');
      await presenterPage.settle();
      const facts = await domFacts(presenterPage);
      const browserStored = browserComparisonFrom(presenterPage, 'hold-sweep');
      const browserJob = browserJobFrom(presenterPage, storedIdentity.jobId);
      const reads = presenterPage.calls().filter((row) => row.path.startsWith('/comparison/'));
      const writes = reads.filter((row) => row.method !== 'GET');
      const forbiddenButtons = facts.buttons.filter((label) => /start comparison|retry same command|rerun|cancel|restart/i.test(label));
      const commandSection = await presenterPage.eval("!!document.querySelector('.comparison-command')");
      const resultIdentity = !!browserStored && browserStored.resultId === storedIdentity.resultId
        && browserStored.resultDigest === storedIdentity.resultDigest && browserStored.origin === 'run'
        && sameJson(browserStored, storedIdentity.stored);
      const noWriteSurface = commandSection === false && forbiddenButtons.length === 0 && writes.length === 0
        && reads.every((row) => row.auth);
      check(s, 'Fresh presenter OIDC session reads the exact same stored result and succeeded job',
        login.preSignIn.signInVisible === true && login.pathAfterLogin === '/gcsp/comparison'
          && resultIdentity && browserJob?.jobId === storedIdentity.jobId && browserJob.status === 'succeeded',
        { login: login.pathAfterLogin, resultIdentity, resultId: browserStored?.resultId ?? null,
          digest: browserStored?.resultDigest ?? null, origin: browserStored?.origin ?? null,
          job: browserJob, signedReadCalls: reads.map((row) => ({ method: row.method, path: row.path, status: row.status, auth: row.auth })) });
      check(s, 'Presenter DOM has no command section or write call', noWriteSurface,
        { commandSection, forbiddenButtons, writes: writes.map((row) => ({ method: row.method, path: row.path, status: row.status })) });
      check(s, 'Presenter visibly identifies the completed result and its stored digest',
        facts.result.includes(storedIdentity.resultId) && facts.result.includes(storedIdentity.resultDigest)
          && facts.result.includes('Run result'),
        { resultHeading: facts.result.slice(0, 240), resultId: storedIdentity.resultId, digest: storedIdentity.resultDigest });
      check(s, 'Presenter completed result has no browser runtime exception', presenterPage.errors.length === 0, presenterPage.errors);
      s.observations.presenter = { readOnly: noWriteSurface, resultId: storedIdentity.resultId,
        resultDigest: storedIdentity.resultDigest, origin: browserStored?.origin ?? null, resultJsonMatches: resultIdentity };
    } finally {
      const disposedPresenter = await disposeBrowserPage(presenterPage);
      s.observations.presenterContextDisposed = { disposed: !!disposedPresenter, browserContextId: presenterPage.ctxId };
      presenterPage = null;
    }
  });
  ensureScenario(presenterScenario, 'Presenter completed inspection');
  await stopApi();
}

async function main() {
  for (const directory of Object.values(dirs)) mkdirSync(directory, { recursive: true });
  captureProcessBaseline();
  persistSignalJournal();
  for (const [name, number] of Object.entries(PORTS)) if (!(await portFree(number))) throw new Error(`Port ${number} (${name}) is in use`);
  receipt.inputs = {
    scratch: 'parent-owned local scratch; actual per-run path withheld from receipt',
    publicBaseHost: publicBase.host, database: { source: DB_SOURCE, host: DB_HOST, port: DB_PORT, name: DB_NAME },
    schema: 'unique per-run schema; name withheld from receipt', ports: PORTS,
    jar: { path: path.relative(ROOT, JAR), sha256: sha256File(JAR) },
    webBrowser: { path: path.relative(ROOT, WEB_BROWSER), indexSha256: sha256File(path.join(WEB_BROWSER, 'index.html')) },
    postgresqlClient: path.basename(PSQL), sourceRevision: SOURCE_REVISION,
  };
  receipt.parentReservationPresent = process.env.TEST_RESOURCE_PARENT_RESERVATION !== undefined;

  const psqlVersion = cap(PSQL, ['--version']);
  const serverVersion = Number(cap(PSQL, ['-X', '-A', '-t', '-h', DB_HOST, '-p', DB_PORT, '-U', DB_USER, '-d', DB_NAME,
    '-c', 'SHOW server_version_num'], { env: childEnv({ PATH: process.env.PATH, HOME: process.env.HOME,
      PGCONNECT_TIMEOUT: '10', PGPASSWORD: DB_PASSWORD }) }));
  if (!/PostgreSQL\) 17\./.test(psqlVersion) || serverVersion < 170000 || serverVersion >= 180000) throw new Error('Proof requires a native PostgreSQL 17 client and server');
  receipt.inputs.database.serverVersion = serverVersion;
  receipt.tools = { harnessNode: process.version, openssl: cap('openssl', ['version']), chrome: cap(CHROME, ['--version']), apiJvm: jvmLimitsReceipt(API_JVM_ARGS),
    java: (spawnSync(path.join(JAVA_HOME, 'bin/java'), ['-version'], { encoding: 'utf8', env: childEnv(process.env) }).stderr ?? '').split('\n')[0],
    postgresqlClient: psqlVersion };

  tls = makeCerts();
  const assemble = await import(pathToFileURL(path.join(ROOT, 'scripts/build-gcsp-static.mjs')).href);
  await runOnce('assemble', process.execPath, ['scripts/build-gcsp-static.mjs', '--browser', WEB_BROWSER, '--output', dirs.static,
    '--environment', 'deployed', '--revision', SOURCE_REVISION],
    { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp,
      GCSP_PUBLIC_ENVIRONMENT_ID: ENVIRONMENT_ID, GCSP_PUBLIC_API_BASE_URL: API_BASE,
      GCSP_PUBLIC_OIDC_AUTHORITY: ISSUER, GCSP_PUBLIC_OIDC_CLIENT_ID: 'gcsp-web',
      GCSP_PUBLIC_OIDC_SCOPE: 'openid profile gcsp-api', GCSP_PUBLIC_OIDC_REDIRECT_URI: `${ORIGINS.web}/gcsp/auth/callback`,
      GCSP_PUBLIC_OIDC_POST_LOGOUT_REDIRECT_URI: `${ORIGINS.web}/gcsp/` });
  const manifest = path.join(dirs.static, 'gcsp/static-manifest.json');
  receipt.inputs.compiledAssembly = { sha256: sha256File(manifest) };
  await startIdp();
  await startWeb(assemble.GCSP_FIXED_ROUTES);
  await startApi();

  const catalogue = await expectApi('greg', '/comparison/results/latest');
  const processResult = await expectApi('greg', '/comparison/process/latest');
  const processEntry = catalogue.experiments?.find((entry) => entry.experimentId === 'process-only');
  const baseline = processEntry?.latest;
  if (!baseline || baseline.origin !== 'retained') throw new Error('The actual retained process-only result is unavailable');
  if (baseline.resultId !== 'process-comparison-94c7760154fa5a05d5d6dc9b7c768fa0'
    || baseline.resultDigest !== 'd388e3371ea4a7f3c3665102e9452e7ccd0940b685b64fa2d623e7e47a3f3027') {
    throw new Error('The API did not return the pinned retained baseline identity and digest');
  }
  if (!same(processResult.resultId, baseline.resultId) || !same(processResult.resultDigest, baseline.resultDigest)) {
    throw new Error('The process-only route and actual catalogue do not share one stored identity');
  }
  if (!same(baseline.result.manifest.seeds, ['comparison-a', 'comparison-b', 'comparison-c'])) {
    throw new Error('The retained workload seeds do not match the approved three-seed workload');
  }
  const baselineReceipt = {
    apiStatus: 'authorized 200 from Java /comparison/results/latest and /comparison/process/latest',
    resultId: baseline.resultId, resultDigest: baseline.resultDigest, origin: baseline.origin,
    storedAt: baseline.storedAt, completedAt: baseline.result.completedAt, policyVersion: baseline.policyVersion,
    activePolicyVersion: baseline.activePolicyVersion, policyCurrent: baseline.policyCurrent,
    experimentId: baseline.result.experimentId, seeds: baseline.result.manifest.seeds,
    codeRevision: baseline.result.manifest.codeRevision ?? null, measureCount: baseline.result.differences?.length ?? 0,
    measures: (baseline.result.differences ?? []).map((row) => ({ measure: row.measure, current: row.current, buddy: row.buddy, difference: row.difference, verdict: row.verdict })),
    assumptions: baseline.result.assumptions,
    retainedArtifact: { fileSha256: 'c2175ec4fbb762a27c42e94d8e720732c7757062cfb25005739ebae0c26de0a5',
      source: 'services/gcsp-api/README.md FUCQ-480 retained baseline pin' },
  };
  receipt.actualBaseline = baselineReceipt;

  const cdp = await startBrowser();

  if (PROOF_MODE === 'completed-experiment') {
    await runCompletedExperimentMode(cdp, catalogue, baseline);
    return;
  }

  let gregPage;
  const retainedScenario = await scenario('retained-and-experiments', 'Actual retained data, measures, assumptions and empty experiment states', async (s) => {
    gregPage = await newPage(cdp, 'Greg comparison');
    const signInResult = await signIn(gregPage, 'greg');
    check(s, 'Greg returns to the comparison route after signed OIDC login', signInResult.pathAfterLogin === '/gcsp/comparison', signInResult);
    check(s, 'Fresh isolated browser context begins unauthenticated before the safe return', signInResult.preSignIn.signInVisible === true,
      { browserContext: 'new CDP BrowserContext', entryPath: signInResult.preSignIn.path, signedOutBeforeLogin: signInResult.preSignIn.signInVisible });
    await gregPage.until(`return text().includes('Retained baseline') && text().includes('${baseline.resultId}') && !!$('.comparison-result');`, 30000, 'actual retained result');
    await gregPage.act("const details = document.querySelector('.comparison-result details.comparison-fold'); if (details) details.open = true;");
    const compared = await compareBaselineDom(gregPage, baseline, catalogue.activePolicyVersion);
    s.observations.actualApiToDom = compared;
    check(s, 'Retained result id, digest, provenance and policy are visible from the Java response',
      compared.resultId && compared.digest && compared.storedAt && compared.origin && compared.policy && compared.completedAt && compared.seeds
        && (compared.codeRevision === undefined || compared.codeRevision === true));
    check(s, 'Every actual API measure and verdict matches the rendered DOM', compared.measures.length > 0 && compared.measures.every((row) => row.pass));
    check(s, 'Every actual API assumption and provenance field matches the rendered DOM',
      compared.assumptions.length === baseline.result.assumptions.length && compared.assumptions.every((row) => row.pass));
    check(s, 'The Angular browser reads use signed bearer requests', gregPage.calls().filter((row) => row.path.startsWith('/comparison/')).length > 0
      && gregPage.calls().filter((row) => row.path.startsWith('/comparison/')).every((row) => row.auth));
    const initialJob = await latestJob('greg');
    check(s, 'The Java job catalogue exposes reruns without a fabricated job',
      initialJob.reruns === true && initialJob.response.status === 404 && initialJob.job === null,
      { http: initialJob.response.status, status: initialJob.response.json?.status, reruns: initialJob.reruns, noJob: initialJob.job === null });
    const experimentIds = [];
    for (const experimentId of ['order-mix', 'points', 'hold-sweep']) {
      const entry = catalogue.experiments.find((item) => item.experimentId === experimentId);
      check(s, `${experimentId} is an actual empty catalogue state`, entry?.latest === null);
      if (!await gregPage.act(`return setValue('#comparison-experiment', '${experimentId}');`)) throw new Error(`Could not select ${experimentId}`);
      await gregPage.until("return text().includes('No stored result yet') && !$('.comparison-result');", 10000, `${experimentId} empty state`);
      experimentIds.push(experimentId);
    }
    check(s, 'All empty states come from the actual Java catalogue', experimentIds.length === 3, experimentIds);
    await gregPage.act("return setValue('#comparison-experiment', 'process-only');");
    await gregPage.until(`return !!$('.comparison-result') && text().includes('${baseline.resultId}');`, 10000, 'process-only selection restored');
    const desktopFacts = await domFacts(gregPage);
    check(s, '1440px desktop has no horizontal overflow', !desktopFacts.overflow, { width: desktopFacts.width, headings: desktopFacts.headings });
    check(s, 'Greg has no public cancel, restart or impersonation action',
      !desktopFacts.buttons.some((label) => /cancel|restart|impersonat/i.test(label)), desktopFacts.buttons);
    s.observations.desktopCapture = await gregPage.shot('comparison-greg-desktop.jpg');
    await viewport(gregPage, 390, 844);
    const narrowFacts = await domFacts(gregPage);
    check(s, '390px narrow view has no horizontal overflow', !narrowFacts.overflow, { width: narrowFacts.width });
    s.observations.narrowCapture = await gregPage.shot('comparison-greg-narrow.jpg');
    await viewport(gregPage, 1440, 1000);
    await gregPage.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await gregPage.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    const focus = await gregPage.eval("({tag:document.activeElement?.tagName,outline:getComputedStyle(document.activeElement).outlineStyle,outlineWidth:getComputedStyle(document.activeElement).outlineWidth,visible:document.activeElement?.getBoundingClientRect().width>0})");
    s.observations.keyboardFocus = focus;
    check(s, 'Keyboard reaches a visible focusable control with visible focus', ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(focus.tag)
      && focus.outline !== 'none' && focus.outlineWidth !== '0px' && focus.visible, focus);
    check(s, 'No browser runtime exception occurred on the comparison route', gregPage.errors.length === 0, gregPage.errors);
  });
  ensureScenario(retainedScenario, 'Retained comparison');

  const rolesScenario = await scenario('presenter-and-role-refusals', 'Presenter inspection is read-only; API refusals are honest', async (s) => {
    const noToken = await request('GET', '/comparison/results/latest');
    const employee = await call('employee', '/comparison/results/latest');
    const presenterRead = await call('presenter', '/comparison/results/latest');
    const presenterJobRead = await call('presenter', '/comparison/jobs/latest');
    const presenterPost = await call('presenter', '/comparison/jobs', { commandId: `probe-${randomBytes(6).toString('hex')}`, experimentId: 'process-only' });
    s.observations.labelledApiProbes = {
      noToken: { label: 'negative API probe: no bearer token', status: noToken.status },
      employee: { label: 'negative API probe: employee cannot inspect comparisons', status: employee.status },
      presenterRead: { label: 'presenter signed read', status: presenterRead.status, bodyStatus: presenterRead.json?.status },
      presenterJobRead: { label: 'presenter signed job read', status: presenterJobRead.status, bodyStatus: presenterJobRead.json?.status },
      presenterPost: { label: 'presenter signed direct POST; expected role-required refusal and creates no job', status: presenterPost.status, bodyStatus: presenterPost.json?.status, code: presenterPost.json?.code },
    };
    check(s, 'No-token result read receives 401', noToken.status === 401);
    check(s, 'Employee result read receives 403', employee.status === 403);
    check(s, 'Presenter can read actual results and job status', presenterRead.status === 200 && presenterRead.json?.status === 'ok'
      && presenterJobRead.status === 404 && presenterJobRead.json?.reruns === true);
    check(s, 'Signed presenter POST receives 403 and starts no job', presenterPost.status === 403
      && presenterPost.json?.status === 'forbidden' && presenterPost.json?.code === 'role-required');

    const page = await newPage(cdp, 'Presenter comparison');
    const login = await signIn(page, 'presenter');
    check(s, 'Fresh presenter session safely returns to the comparison route', login.pathAfterLogin === '/gcsp/comparison'
      && login.preSignIn.signInVisible === true, { browserContext: 'new CDP BrowserContext', ...login });
    await page.until(`return text().includes('Retained baseline') && text().includes('${baseline.resultId}') && !!$('.comparison-result');`, 30000, 'presenter retained inspection');
    const facts = await domFacts(page);
    const forbiddenActions = facts.buttons.filter((label) => /start comparison|retry same command|rerun|cancel|restart/i.test(label));
    check(s, 'Presenter DOM exposes no start, rerun, retry, cancel or restart command', !facts.buttons.includes('Start comparison')
      && forbiddenActions.length === 0, { buttons: facts.buttons, forbiddenActions, returnPath: login.pathAfterLogin });
    const commandSection = await page.eval("!!document.querySelector('.comparison-command')");
    check(s, 'Presenter has no command section', commandSection === false);
    s.observations.capture = await page.shot('comparison-presenter-desktop.jpg');
    check(s, 'Presenter rendered without runtime exceptions', page.errors.length === 0, page.errors);
  });
  ensureScenario(rolesScenario, 'Presenter role');

  const unavailableScenario = await scenario('transport-unavailable', 'Transport interruption renders an honest unavailable state', async (s) => {
    const page = await newPage(cdp, 'Comparison transport unavailable');
    await signIn(page, 'greg');
    await page.until(`return text().includes('${baseline.resultId}') && !!$('.comparison-result');`, 30000, 'pre-abort actual result');
    const pattern = `${API_BASE}/comparison/results/latest*`;
    let aborted = 0;
    const abort = (message) => {
      if (message.sessionId === page.sid && message.method === 'Fetch.requestPaused'
        && message.params.request.url.startsWith(`${API_BASE}/comparison/results/latest`)) {
        aborted++;
        void page.send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'ConnectionFailed' });
      }
    };
    await page.send('Fetch.enable', { patterns: [{ urlPattern: pattern, requestStage: 'Request' }] });
    cdp.listeners.push(abort);
    try {
      await page.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/comparison` });
      await page.until("return text().includes('Comparisons are unavailable') && text().includes('Comparisons are temporarily unavailable') && !!button('Refresh') && !$('.comparison-result');",
        20000, 'transport-only unavailable UI');
    } finally {
      cdp.listeners = cdp.listeners.filter((listener) => listener !== abort);
      await page.send('Fetch.disable').catch(() => {});
    }
    const facts = await domFacts(page);
    check(s, 'CDP transport abort was applied to the actual result read', aborted > 0,
      { method: 'Fetch.failRequest', errorReason: 'ConnectionFailed', route: 'GET /comparison/results/latest', backendRefusal: false, aborted });
    check(s, 'Unavailable UI gives the client transport message and a deliberate refresh action',
      facts.text.includes('Comparisons are unavailable') && facts.text.includes('Comparisons are temporarily unavailable')
        && facts.buttons.includes('Refresh') && !facts.result);
    s.observations.capture = await page.shot('comparison-transport-unavailable.jpg');
    check(s, 'Unavailable state had no client runtime exception', page.errors.length === 0, page.errors);
  });
  ensureScenario(unavailableScenario, 'Unavailable state');

  const jobScenario = await scenario('greg-job-progress-interruption-rerun', 'Greg starts through the DOM, reads progress, interruption and rerun honestly', async (s) => {
    const started = await startThroughDom(gregPage);
    s.observations.firstStart = { channel: 'Angular DOM click', status: started.status, jobId: started.jobId,
      request: started.browserRequest, initialProgress: started.initial.progress };
    check(s, 'First normal process-only start keeps the exact 3-seed/6-step workload',
      started.initial.progress.seedsTotal === baseline.result.manifest.seeds.length && started.initial.progress.stepsTotal === 6,
      started.initial.progress);
    const firstProgress = await waitForActualStep(started.jobId, gregPage);
    s.observations.actualProgress = { source: 'signed Java read after actual replay callback', jobId: firstProgress.jobId,
      status: firstProgress.status, progress: firstProgress.progress, resultId: firstProgress.resultId, reason: firstProgress.reason };
    check(s, 'Java recorded at least one actual replay step without completing a new result',
      firstProgress.status === 'running' && firstProgress.progress.stepsDone >= 1 && firstProgress.resultId === null);
    await gregPage.act("const details = document.querySelector('.comparison-job details'); if (details) details.open = true;");
    const runningFacts = await domFacts(gregPage);
    const shownSteps = Number(/Steps:\s*(\d+)\s+of\s+6/i.exec(runningFacts.job)?.[1] ?? 0);
    check(s, 'Angular DOM displays the same live Java job and progress', runningFacts.job.includes(started.jobId)
      && shownSteps >= 1 && shownSteps <= firstProgress.progress.stepsDone, { progressText: runningFacts.job, shownSteps, apiProgress: firstProgress.progress });
    check(s, 'New result was not completed or stored by the bounded proof', firstProgress.status === 'running' && firstProgress.resultId === null);
    s.observations.runningCapture = await gregPage.shot('comparison-greg-running.jpg');

    await stopApi();
    await startApi();
    const interrupted = await latestJob('greg', started.jobId);
    const firstInterrupted = interrupted.job;
    check(s, 'Graceful API stop durably interrupted the first job with no result',
      firstInterrupted?.jobId === started.jobId && firstInterrupted.status === 'interrupted'
        && firstInterrupted.resultId === null && /backend (?:stopped|restarted) before the comparison finished/i.test(firstInterrupted.reason ?? ''),
      firstInterrupted);
    check(s, 'Interrupted progress is durable across API restart', firstInterrupted.progress.stepsDone >= firstProgress.progress.stepsDone
      && firstInterrupted.progress.seedsDone >= firstProgress.progress.seedsDone
      && firstInterrupted.progress.stepsTotal === firstProgress.progress.stepsTotal
      && firstInterrupted.progress.seedsTotal === firstProgress.progress.seedsTotal,
      { before: firstProgress.progress, after: firstInterrupted.progress });
    await gregPage.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/comparison` });
    await gregPage.until(`return text().includes('Stopped before it finished') && text().includes('${started.jobId}') && text().includes('${firstInterrupted.reason}');`,
      20000, 'durable interrupted job in the comparison DOM');
    await gregPage.act("const details = document.querySelector('.comparison-job details'); if (details) details.open = true;");
    const interruptedFacts = await domFacts(gregPage);
    check(s, 'DOM shows the interrupted reason, retained progress, and no new result',
      interruptedFacts.job.includes(firstInterrupted.reason) && interruptedFacts.job.includes(`${firstInterrupted.progress.stepsDone} of 6`)
        && interruptedFacts.job.includes('No result was stored.') && interruptedFacts.job.includes('No result'));
    s.observations.firstInterruptedDom = interruptedFacts.job;

    const rerun = await startThroughDom(gregPage);
    check(s, 'The deliberate rerun uses a new browser command and durable job identity', rerun.jobId !== started.jobId,
      { firstJobId: started.jobId, rerunJobId: rerun.jobId, channel: 'Angular DOM click' });
    const rerunLive = await latestJob('greg', rerun.jobId);
    check(s, 'The rerun is a real running Java job with the unchanged workload', rerunLive.job?.status === 'running'
      && rerunLive.job.experimentId === 'process-only'
      && rerunLive.job.progress.seedsTotal === baseline.result.manifest.seeds.length
      && rerunLive.job.progress.stepsTotal === 6 && rerunLive.job.resultId === null, rerunLive.job);
    s.observations.secondStart = { channel: 'Angular DOM click', status: 202, jobId: rerun.jobId,
      progress: rerunLive.job.progress, noResult: rerunLive.job.resultId === null };

    await stopApi();
    await startApi();
    const secondInterrupted = (await latestJob('greg', rerun.jobId)).job;
    check(s, 'Stopping the deliberate rerun leaves a second durable interrupted job with no result',
      secondInterrupted?.jobId === rerun.jobId && secondInterrupted.status === 'interrupted' && secondInterrupted.resultId === null
        && /backend (?:stopped|restarted) before the comparison finished/i.test(secondInterrupted.reason ?? ''), secondInterrupted);
    await gregPage.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/comparison` });
    await gregPage.until(`return text().includes('Stopped before it finished') && text().includes('${rerun.jobId}');`,
      20000, 'deliberate rerun interrupted state');
    await gregPage.act("const details = document.querySelector('.comparison-job details'); if (details) details.open = true;");
    await viewport(gregPage, 390, 844);
    const finalFacts = await domFacts(gregPage);
    check(s, 'Final 390px interrupted state shows the second job and has no overflow',
      !finalFacts.overflow && finalFacts.job.includes(secondInterrupted.reason) && finalFacts.job.includes('No result was stored.'));
    s.observations.finalInterruptedCapture = await gregPage.shot('comparison-rerun-interrupted-narrow.jpg');
    s.observations.finalJob = { jobId: secondInterrupted.jobId, status: secondInterrupted.status, reason: secondInterrupted.reason,
      progress: secondInterrupted.progress, resultId: secondInterrupted.resultId };
    check(s, 'No browser runtime exception occurred during start, progress, recovery or rerun', gregPage.errors.length === 0, gregPage.errors);
    await stopApi();
  });
  ensureScenario(jobScenario, 'Greg job lifecycle');
}

function teardown() {
  if (teardownPromise) return teardownPromise;
  teardownPromise = (async () => {
    try { activeCdp?.ws.close(); } catch { /* already closed */ }
    activeCdp = null;
    const cleanupErrors = [];
    for (const child of owned.slice().reverse()) {
      try { await child.stop(); await child.logClosed; } catch (error) { cleanupErrors.push(`${child.pid}: ${error.message}`); log('owned child stop error', child.pid, error.message); }
    }
    await closeServer(webServer);
    await closeServer(idp.server);
    receipt.teardown = { ownedProcesses: receipt.processes.map((run) => ({ name: run.name, pid: run.pid, exit: run.exit })),
      allOwnedExited: owned.every((child) => child.done), cleanupErrors, serversClosed: true,
      schemaLeftForParent: true, scratchLeftForParent: true, screenshotBytes,
      note: 'Parent owns the per-run database schema, scratch/output roots and final audit.' };
  })();
  return teardownPromise;
}
function finish(runError) {
  if (finished) return;
  finished = true;
  receipt.endedAt = new Date().toISOString();
  if (runError) receipt.runError = runError;
  receipt.logBudget ??= { limitBytes: CHILD_LOG_LIMIT, writtenBytes: childLogBytes, exhausted: false };
  const required = PROOF_MODE === 'completed-experiment'
    ? ['completed-hold-sweep', 'completed-presenter-inspection']
    : ['retained-and-experiments', 'presenter-and-role-refusals', 'transport-unavailable', 'greg-job-progress-interruption-rerun'];
  receipt.overall = required.every((name) => receipt.scenarios[name]?.pass === true) && !runError
    && !logLimitFailure && receipt.teardown?.allOwnedExited === true && receipt.teardown.cleanupErrors.length === 0 ? 'PASS' : 'FAIL';
  if (PROOF_MODE === 'completed-experiment') {
    receipt.originalAcceptance.AC1.evidence = 'incomplete';
    receipt.originalAcceptance.AC1.closure = 'OPEN: this mode covers one actual completed hold-sweep result, rendered measures and assumptions, and progress from the same 12-step job; it does not re-exercise rerun/interruption. Existing matching lifecycle evidence is separate, and the covering batch, current-browser, hosted and final acceptance remain outstanding.';
    receipt.originalAcceptance.AC2.evidence = 'incomplete';
    receipt.originalAcceptance.AC2.closure = 'OPEN: this mode covers presenter read-only inspection of the same completed result; existing error/interruption evidence is separate, and current-browser, hosted and final acceptance remain outstanding.';
  } else {
    receipt.originalAcceptance.AC1.evidence = 'incomplete';
    receipt.originalAcceptance.AC1.closure = 'OPEN: actual retained inspection, running progress, interruption and a started rerun are partial proof; no new completed result was produced.';
    receipt.originalAcceptance.AC2.evidence = 'incomplete';
    receipt.originalAcceptance.AC2.closure = 'OPEN: presenter read-only, role refusals and durable interrupted jobs are partial proof; hosted/WebKit and final acceptance remain separate.';
  }
  const file = path.join(dirs.evidence, 'connected-comparison-proof.json');
  let serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > 2 * 1024 * 1024) {
    receipt.overall = 'FAIL';
    receipt.runError = 'Connected comparison receipt exceeded its explicit 2MiB budget';
    for (const entry of Object.values(receipt.scenarios)) entry.observations = { omitted: 'Evidence exceeded the receipt budget; this run is failed.' };
    serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  }
  try { writeFileSync(file, serialized); } catch (error) { console.error('receipt write failed', error.message); }
  for (const name of Object.keys(receipt.scenarios).sort()) {
    const entry = receipt.scenarios[name];
    console.log(`  ${name}: ${entry.pass ? 'PASS' : 'FAIL'} ${entry.title}${entry.pass ? '' : ` [failed: ${Object.entries(entry.checks).filter(([, value]) => value !== true).map(([key]) => key).join(', ')}]`}`);
  }
  console.log(`overall ${receipt.overall}; receipt evidence/connected-comparison-proof.json; owned processes exited: ${receipt.teardown?.allOwnedExited}`);
}
const deadline = setTimeout(async () => {
  log('global deadline reached');
  await teardown(); finish('global proof deadline reached'); process.exit(1);
}, Math.max(1, DEADLINE_MS - 45000));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  await teardown(); finish(`interrupted by ${signal}`); process.exit(130);
});
let runError;
try { await main(); } catch (error) { runError = error.message; console.error('RUN ERROR:', error.message); }
finally { clearTimeout(deadline); await teardown(); finish(runError); }
process.exit(receipt.overall === 'PASS' ? 0 : 1);
