#!/usr/bin/env node
// FUCQ-449 connected proof: prebuilt Angular Greg planning -> Java API (local signed test OIDC, owned PostgreSQL 17), headless Chrome.
// Reuses the FUCQ-452 harness. Seeds no plan or Production data; records what the actual Java API answers and what the page shows.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:https';
import https from 'node:https';
import net from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, createWriteStream, lstatSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const refuse = (why) => { console.error(`REFUSED: ${why}`); process.exit(2); };
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

const SCENARIO_PROVIDER = process.env.PROOF_SCENARIO_PROVIDER ?? 'none';
if (!['none', 'demo'].includes(SCENARIO_PROVIDER)) refuse('PROOF_SCENARIO_PROVIDER must be none or demo');
const SUPPLY_PROVIDER = process.env.PROOF_SUPPLY_PROVIDER ?? 'none';
if (!['none', 'demo'].includes(SUPPLY_PROVIDER)) refuse('PROOF_SUPPLY_PROVIDER must be none or demo');
const PRESENTER_TICK = process.env.PROOF_PRESENTER_TICK === '1';
const PROOF = path.join(SCRATCH, 'proof', `run-${RUN_TOKEN}`);
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
const DEADLINE_MS = Math.min(Number(process.env.PROOF_DEADLINE_SEC ?? 840) * 1000,
  process.env.PROOF_ABSOLUTE_DEADLINE_MS ? Number(process.env.PROOF_ABSOLUTE_DEADLINE_MS) - T0 : Infinity);
if (!Number.isFinite(DEADLINE_MS) || DEADLINE_MS <= 90000 || DEADLINE_MS > 900000) refuse('Remaining proof deadline must be in (90, 900] seconds');

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
const ENVIRONMENT_ID = `fucq449-connected-${RUN_TOKEN}`;
const RUN_ID = 'run-1';
const POLICY_VERSION = 'gcsp-policy-v1';
const SUBJECTS = { greg: ['greg'], presenter: ['presenter'], employee: ['employee'] };
const OIDC_SUBJECTS = Object.fromEntries(Object.entries(SUBJECTS).map(([name, roles]) => [`sub-${name}`, roles]));
const SCHEMA = `gcsp_s_fucq449_${RUN_TOKEN.replace(/-/g, '_')}`;
const dirs = { logs: path.join(PROOF, 'logs'), tmp: path.join(PROOF, 'tmp'), certs: path.join(PROOF, 'certs'),
  static: path.join(PROOF, 'static'), browser: path.join(PROOF, 'browser'), evidence: path.join(PROOF, 'evidence') };
const receipt = {
  schema: 'fucq449-connected-planning-proof/1', story: 'DEV-2026-11-13-017 / FUCQ-449',
  startedAt: new Date().toISOString(), sourceRevision: { value: SOURCE_REVISION, provenance: 'Supplied by the parent; this script does not read git.' },
  inputs: null, tools: {}, processes: [], resources: { peakRssKiB: 0, peakScratchKiB: 0, samples: 0 },
  limitations: [
    'Local test OIDC uses real signed RS256 tokens and Java bearer validation; this is not the hosted identity provider.',
    'The planner demand and supply ports are unbound on this Java base (FUCQ-475/477), so no feasible, infeasible or stale plan can be produced; none is seeded or faked here.',
    'GCSP_PRODUCTION_PROVIDER=synthetic is a labelled local substitute; no real Production system is involved and no request is submitted.',
    'CDP browser contexts approximate fresh private sessions. Safari/WebKit and hosted deployment were not run.',
    'No access tokens, database credentials, OIDC codes or private keys are written to receipts.',
  ],
};
const owned = [];
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
let webServer = null;
const idp = { codes: new Map(), txns: new Map(), subjects: OIDC_SUBJECTS, keys: null, server: null };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256b64u = (value) => createHash('sha256').update(value).digest('base64url');
const sha256File = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const cap = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 60000, env: childEnv(process.env), ...opts }).trim();

// ---------- owned child processes (the parent retains the outer resource supervisor) ----------
function processIdentity(pid) {
  if (!pid) return null;
  const result = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'pid=', '-o', 'pgid=', '-o', 'lstart=', '-o', 'comm='],
    { encoding: 'utf8', timeout: 1000, env: childEnv(process.env) });
  const parts = (result.stdout ?? '').trim().split(/\s+/);
  return result.status === 0 && parts.length >= 8
    ? { pid: Number(parts[0]), pgid: Number(parts[1]), start: parts.slice(2, 7).join(' '), executable: parts.slice(7).join(' ') } : null;
}
function killGroup(child, signal) {
  if (child.done) return;
  const current = processIdentity(child.pid);
  if (!current) return;
  if (!child.identity || JSON.stringify(current) !== JSON.stringify(child.identity) || current.pgid !== child.pid) {
    throw new Error(`Refused signal: owned identity changed for ${child.pid}`);
  }
  process.kill(-child.pid, signal);
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
    GCSP_RESET_ALLOWED: SCENARIO_PROVIDER === 'demo' ? 'true' : 'false', GCSP_PUBLIC_BASE_URL: PUBLIC_BASE_URL, 
    GCSP_CODE_REVISION: SOURCE_REVISION,
    GCSP_ACCOUNT_PROVIDER: 'none', GCSP_SCENARIO_PROVIDER: SCENARIO_PROVIDER, GCSP_BUDDY_PROVIDER: 'local-synthetic',
    GCSP_CLAIM_STOCK_PROVIDER: 'local', GCSP_SUPPLY_PROVIDER: SUPPLY_PROVIDER, GCSP_ORDERING_PROVIDER: 'none',
    GCSP_APPOINTMENTS_PROVIDER: 'none', GCSP_DOCUMENTS_PROVIDER: 'none', GCSP_APPROVALS_PROVIDER: 'none',
    GCSP_RETURNS_PROVIDER: 'none', GCSP_PRODUCTION_PROVIDER: 'synthetic',
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
  const properties = [
    `-Dquarkus.datasource.jdbc.additional-jdbc-properties.currentSchema=${SCHEMA}`,
    `-Dquarkus.flyway.schemas=${SCHEMA}`, `-Dquarkus.flyway.default-schema=${SCHEMA}`,
  ];
  api = spawnOwned(name, path.join(JAVA_HOME, 'bin/java'),
    [`-Djavax.net.ssl.trustStore=${tls.trust}`, `-Djavax.net.ssl.trustStorePassword=${TRUST_PASS}`,
      `-Djava.io.tmpdir=${dirs.tmp}`, ...properties, '-jar', JAR], apiEnv(), PORTS.api);
  for (let i = 0; ; i++) {
    if (api.done) throw new Error(`${name} exited during startup`);
    try { const response = await request('GET', '/context'); if (response.status === 401) break; } catch { /* starting */ }
    if (i > 240) throw new Error(`${name} did not become ready for signed reads`);
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
    this.log = []; this.byId = new Map(); this.waits = []; this.errors = []; this.csp = []; this.consoleErrors = []; this.httpErrors = [];
    cdp.listeners.push((message) => message.sessionId === sessionId && this.event(message));
  }
  send(method, params = {}) { return this.cdp.send(method, params, this.sid); }
  event(message) {
    const p = message.params ?? {};
    if (message.method === 'Runtime.exceptionThrown') { this.errors.push(p.exceptionDetails?.text ?? 'runtime exception'); return; }
    if (message.method === 'Runtime.consoleAPICalled') { if (p.type === 'error') this.consoleErrors.push((p.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')); return; }
    if (message.method === 'Log.entryAdded') {
      if (p.entry?.level === 'error') (/content.security|content-security|\bcsp\b/i.test(p.entry?.text ?? '') ? this.csp : this.consoleErrors).push(p.entry.text);
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
      else if (p.response.status >= 400) this.httpErrors.push({ status: p.response.status, path: new URL(p.response.url).pathname, origin: new URL(p.response.url).origin });
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
  async shot(name) {
    const result = await this.send('Page.captureScreenshot', { format: 'jpeg', quality: 72, captureBeyondViewport: false });
    const bytes = Buffer.from(result.data, 'base64');
    if (bytes.length > 512 * 1024 || screenshotBytes + bytes.length > SCREENSHOT_BUDGET) throw new Error('Screenshot evidence exceeded its bounded output budget');
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
async function signIn(page, person, target = '/gcsp/greg/plan') {
  await page.send('Page.navigate', { url: `${ORIGINS.web}${target}` });
  await page.until(`return location.origin === '${ORIGINS.web}' && !!button('Sign in');`, 30000, 'unauthenticated sign-in page');
  const preSignIn = await page.act("return ({path:location.pathname, signInVisible:!!button('Sign in')});");
  await page.act("return press('Sign in');");
  await page.until(`return location.origin === '${ORIGINS.idp}' && !!document.querySelector('button[data-subject="sub-${person}"]');`, 30000, 'local OIDC login');
  await page.eval(`document.querySelector('button[data-subject="sub-${person}"]').click()`);
  await page.until(`return location.origin === '${ORIGINS.web}' && location.pathname === '${target}';`, 30000, 'safe return to the planning route');
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
let sampler = null;
function sampleResources() {
  try {
    const pgids = new Set(owned.filter((c) => !c.done).map((c) => c.pid));
    const rows = execFileSync('/bin/ps', ['-axo', 'pgid=,rss='], { encoding: 'utf8', timeout: 5000 }).trim().split('\n');
    const rss = rows.map((r) => r.trim().split(/\s+/).map(Number)).filter(([g]) => pgids.has(g)).reduce((sum, [, r]) => sum + r, 0);
    const scratch = Number(execFileSync('/usr/bin/du', ['-sk', path.join(SCRATCH, 'proof')], { encoding: 'utf8', timeout: 20000 }).split(/\s+/)[0]);
    receipt.resources.peakRssKiB = Math.max(receipt.resources.peakRssKiB, rss);
    receipt.resources.peakScratchKiB = Math.max(receipt.resources.peakScratchKiB, scratch); receipt.resources.samples++;
  } catch { /* sampling is best effort */ }
}
// ---------- FUCQ-449 scenarios: Greg planning and Production against the actual Java responses ----------
const checks = [];
const rec = (id, name, pass, observed = undefined) => {
  checks.push({ id, name, pass: pass === true, ...(observed === undefined ? {} : { observed }) });
  log(`${pass === true ? 'PASS' : 'FAIL'} ${id} ${name}`);
  return pass === true;
};
const PNG_BUDGET = 8 * 1024 * 1024;
let pngBytes = 0;
async function png(page, name, fullPage) {
  let clip;
  if (fullPage) {
    const metrics = await page.send('Page.getLayoutMetrics');
    const size = metrics.cssContentSize ?? metrics.contentSize;
    clip = { x: 0, y: 0, width: Math.ceil(size.width), height: Math.min(Math.ceil(size.height), 6000), scale: 1 };
  }
  const result = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!fullPage, ...(clip ? { clip } : {}) });
  const bytes = Buffer.from(result.data, 'base64');
  if (bytes.length > 3 * 1024 * 1024 || pngBytes + bytes.length > PNG_BUDGET) throw new Error('PNG evidence exceeded its bounded output budget');
  writeFileSync(path.join(dirs.evidence, name), bytes); pngBytes += bytes.length;
  return { file: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), fullPage: !!fullPage, clip: clip ?? null };
}
async function key(page, name) {
  const keys = { Tab: { code: 'Tab', vk: 9 }, Enter: { code: 'Enter', vk: 13, text: '\r' } };
  const k = keys[name];
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, ...(k.text ? { text: k.text } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk });
}
const FOCUS = `(() => { const e = document.activeElement; if (!e) return null; const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
  return { tag: e.tagName.toLowerCase(), id: e.id || null, name: (e.getAttribute('aria-label') || e.innerText || e.value || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
    inMain: !!e.closest('#gcsp-main'), outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: cs.outlineColor,
    outlineOffset: cs.outlineOffset, boxShadow: cs.boxShadow, focusVisible: e.matches(':focus-visible'), inViewport: r.top >= 0 && r.bottom <= innerHeight + 1 }; })()`;
async function tabFromTop(page, stopWhen, max = 30) {
  await page.send('Page.bringToFront');
  await page.eval("(() => { document.activeElement?.blur(); window.scrollTo(0, 0); const b = document.body; b.tabIndex = -1; b.focus(); b.removeAttribute('tabindex'); getSelection().removeAllRanges(); })()");
  const stops = [];
  for (let i = 0; i < max; i++) {
    await key(page, 'Tab'); await sleep(80);
    const stop = await page.eval(FOCUS); stops.push(stop);
    if (stop && stopWhen(stop)) return { stops, found: stop };
  }
  return { stops, found: null };
}
const outlineVisible = (f) => !!f && (f.outlineStyle !== 'none' && parseFloat(f.outlineWidth) > 0 || (f.boxShadow && f.boxShadow !== 'none'));
const FACTS = `return { path: location.pathname, search: location.search, hash: location.hash, text: text(),
  screens: [...main.querySelectorAll('gcsp-status-screen')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim()),
  planResult: $('[data-plan-result]')?.textContent.trim() ?? null, planTables: main.querySelectorAll('.plan-table').length,
  forecastSection: !!main.querySelector('#forecast-source'), metrics: !!main.querySelector('.plan-metrics'),
  alternatives: !!main.querySelector('#alternative-plans'), unmet: !!main.querySelector('#unmet-needs'),
  previewNotice: [...main.querySelectorAll('.plan-notice strong')].some((s) => s.textContent.trim() === 'Preview'),
  submit: (() => { const b = button('Request from Production'); return b ? { present: true, disabled: b.disabled } : { present: false }; })(),
  buttons: [...main.querySelectorAll('button')].map((b) => ({ label: b.textContent.trim(), disabled: b.disabled })),
  busy: !!main.querySelector('[aria-busy="true"]'), prodRequests: main.querySelectorAll('.production-request').length,
  prodEmpty: $('.production-empty')?.textContent.trim() ?? null, prodHeadings: [...main.querySelectorAll('.production-request h3')].map((h) => h.textContent.trim()),
  prodStages: [...main.querySelectorAll('.production-request .request-heading strong')].map((h) => h.textContent.trim()),
  prodText: $('.production-page')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
  overflow: document.documentElement.scrollWidth > innerWidth, scrollWidth: document.documentElement.scrollWidth, innerWidth,
  cspMeta: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? null, cspViolations: window.__cspViolations ?? [] };`;
const SETTLED = `return !main.querySelector('[aria-busy="true"]') && !!($('[data-plan-result]') || /Order plan unavailable|Replan needed|Ordering lead access required|No plan meets|Sign in/.test(text()))
  && (!!$('.production-empty') || !!$('.production-request') || /Production status unavailable|access required|Sign in/i.test(text()));`;
const apiCalls = (page, from = 0) => page.calls(from);
const isPlanGet = (e) => e.method === 'GET' && e.path === '/greg/order-plan';
const brief = (e) => ({ method: e.method, path: e.path, status: e.status, auth: e.auth, failed: e.failed });
async function probe(person, suffix) {
  const r = await call(person, suffix);
  return { status: r.status, body: r.json };
}
async function addCspProbe(page) {
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__cspViolations = []; document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push({ directive: e.violatedDirective, blocked: e.blockedURI }));" });
}

async function main() {
  for (const directory of Object.values(dirs)) mkdirSync(directory, { recursive: true });
  for (const [name, number] of Object.entries(PORTS)) if (!(await portFree(number))) throw new Error(`Port ${number} (${name}) is in use`);
  receipt.inputs = {
    scratch: 'parent-owned local scratch under /private/tmp; not a synced location',
    database: { source: DB_SOURCE, host: DB_HOST, port: DB_PORT, name: DB_NAME }, schema: SCHEMA, ports: PORTS,
    jar: { path: path.relative(ROOT, JAR), sha256: sha256File(JAR) },
    webBrowser: { indexSha256: sha256File(path.join(WEB_BROWSER, 'index.html')) }, sourceRevision: SOURCE_REVISION,
    scenarioProvider: SCENARIO_PROVIDER, supplyProvider: SUPPLY_PROVIDER, presenterTick: PRESENTER_TICK, productionProvider: 'synthetic (labelled local substitute; no real Production system)',
  };
  const psqlVersion = cap(PSQL, ['--version']);
  const serverVersion = Number(cap(PSQL, ['-X', '-A', '-t', '-h', DB_HOST, '-p', DB_PORT, '-U', DB_USER, '-d', DB_NAME,
    '-c', 'SHOW server_version_num'], { env: childEnv({ PATH: process.env.PATH, HOME: process.env.HOME, PGCONNECT_TIMEOUT: '10', PGPASSWORD: DB_PASSWORD }) }));
  if (!/PostgreSQL\) 17\./.test(psqlVersion) || serverVersion < 170000 || serverVersion >= 180000) throw new Error('Proof requires a native PostgreSQL 17 client and server');
  receipt.tools = { harnessNode: process.version, openssl: cap('openssl', ['version']), chrome: cap(CHROME, ['--version']),
    java: (spawnSync(path.join(JAVA_HOME, 'bin/java'), ['-version'], { encoding: 'utf8', env: childEnv(process.env) }).stderr ?? '').split('\n')[0],
    postgresqlClient: psqlVersion, postgresqlServerVersionNum: serverVersion };
  sampler = setInterval(sampleResources, 5000); sampler.unref(); sampleResources();

  tls = makeCerts();
  const assemble = await import(pathToFileURL(path.join(ROOT, 'scripts/build-gcsp-static.mjs')).href);
  await runOnce('assemble', process.execPath, ['scripts/build-gcsp-static.mjs', '--browser', WEB_BROWSER, '--output', dirs.static,
    '--environment', 'deployed', '--revision', SOURCE_REVISION],
    { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp,
      GCSP_PUBLIC_ENVIRONMENT_ID: ENVIRONMENT_ID, GCSP_PUBLIC_API_BASE_URL: API_BASE,
      GCSP_PUBLIC_OIDC_AUTHORITY: ISSUER, GCSP_PUBLIC_OIDC_CLIENT_ID: 'gcsp-web',
      GCSP_PUBLIC_OIDC_SCOPE: 'openid profile gcsp-api', GCSP_PUBLIC_OIDC_REDIRECT_URI: `${ORIGINS.web}/gcsp/auth/callback`,
      GCSP_PUBLIC_OIDC_POST_LOGOUT_REDIRECT_URI: `${ORIGINS.web}/gcsp/` });
  const PLAN_ROUTE = '/gcsp/greg/plan';
  const listed = assemble.GCSP_FIXED_ROUTES.includes(PLAN_ROUTE);
  rec('S0', 'Static host direct-entry route list (GCSP_FIXED_ROUTES) includes /gcsp/greg/plan', listed,
    { listed, note: listed ? undefined : 'Not listed: a hosted refresh or deep link to the planning route would not be rewritten to index.html. This proof adds the route to its local static server only so the browser scenarios can run.' });
  await startIdp();
  await startWeb(listed ? [...assemble.GCSP_FIXED_ROUTES] : [...assemble.GCSP_FIXED_ROUTES, PLAN_ROUTE]);
  await startApi();

  if (PRESENTER_TICK) {
    // Exactly one signed presenter tick, so the Production clock can read a release tick; the answer is recorded as-is.
    const before = await probe('presenter', '/presenter/clock');
    const version = before.body?.value?.clockVersion;
    const tick = await call('presenter', '/presenter/clock/tick', { tickId: `proof-449-${RUN_TOKEN}`, expectedClockVersion: version });
    rec('S3.tick', 'Informational: one signed presenter clock tick issued before the browser scenarios; actual answer recorded', true,
      { clockBefore: { status: before.status, clockVersion: version }, tickStatus: tick.status, tickBody: tick.json, supplyProvider: SUPPLY_PROVIDER });
  }
  const chrome = spawnOwned('chrome', CHROME, ['--headless=new', `--user-data-dir=${path.join(dirs.browser, 'profile')}`,
    '--remote-debugging-port=0', '--remote-allow-origins=*',
    `--ignore-certificate-errors-spki-list=${tls.spki}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--window-size=1280,900', 'about:blank'],
    { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp });
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    if (chrome.done) throw new Error('Chrome exited during startup');
    try { const [debugPort, wsPath] = readFileSync(path.join(dirs.browser, 'profile', 'DevToolsActivePort'), 'utf8').trim().split('\n'); wsUrl = `ws://127.0.0.1:${debugPort}${wsPath}`; }
    catch { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Chrome DevTools endpoint was not found');
  const cdp = await Cdp.connect(wsUrl); receipt.cdp = cdp;
  receipt.browser = { engine: 'Chromium headless via CDP', contextsAreIsolated: true };

  // ----- S1: signed-out entry and real OIDC return -----
  const greg = await newPage(cdp, 'Greg planning', 1280, 900);
  await addCspProbe(greg);
  const gregCall = {};
  try {
    const signed = await signIn(greg, 'greg', PLAN_ROUTE);
    const preCalls = apiCalls(greg).map(brief);
    gregCall.land = signed;
    rec('S1', 'Signed-out visit to /gcsp/greg/plan is sent to sign-in, completes local OIDC code/PKCE as Greg and returns to exactly /gcsp/greg/plan',
      signed.preSignIn.signInVisible === true && signed.pathAfterLogin === PLAN_ROUTE,
      { entryPathBeforeSignIn: signed.preSignIn.path, signInShown: signed.preSignIn.signInVisible, pathAfterLogin: signed.pathAfterLogin,
        searchAfterLogin: await greg.eval('location.search'), hashAfterLogin: await greg.eval('location.hash'), apiCallsBeforeLogin: preCalls });
  } catch (error) { rec('S1', 'Signed-out visit returns to /gcsp/greg/plan after real OIDC login', false, { error: error.message }); }

  // ----- S2 / S6: plan section against the actual Java response, keyboard and retry -----
  let settleError = null;
  try { await greg.until(SETTLED, 30000, 'planning page settled'); } catch (error) { settleError = error.message; }
  await greg.settle();
  const planApi = await probe('greg', '/greg/order-plan');
  const prodApi = await probe('greg', '/greg/production');
  const f1 = await greg.act(FACTS);
  const entryCalls = apiCalls(greg).map(brief);
  const planOk = planApi.status === 200 && planApi.body?.status === 'ok';
  const planGets = apiCalls(greg).filter(isPlanGet);
  const apiReason = typeof planApi.body?.reason === 'string' ? planApi.body.reason : null;
  const expectedMessage = apiReason ?? 'This information is unavailable. Try again.';
  const unavailableShown = f1.screens.some((s) => s.includes('Order plan unavailable') && s.includes(expectedMessage));
  rec('S2.api', 'Signed direct GET /greg/order-plan as Greg records the actual Java status and body', planApi.status !== undefined,
    { status: planApi.status, body: planApi.body, settleError });
  rec('S2.dom', 'Planning section reflects that actual response (unavailable state, no plan table, forecast, alternatives, preview or enabled submit)',
    planOk ? !!f1.planResult
      : unavailableShown && !f1.planResult && f1.planTables === 0 && !f1.forecastSection && !f1.metrics && !f1.alternatives && !f1.previewNotice
        && (!f1.submit.present || f1.submit.disabled),
    { apiStatus: planApi.status, apiCode: planApi.body?.code, apiRetryable: planApi.body?.retryable, apiReason, domScreens: f1.screens, planResult: f1.planResult,
      planTables: f1.planTables, forecastSection: f1.forecastSection, alternatives: f1.alternatives, previewNotice: f1.previewNotice, submit: f1.submit, buttons: f1.buttons });
  rec('S2.net', 'Browser sent GET /greg/order-plan with a Bearer token, saw the same status as the direct probe, and sent no preview or production-requests POST on entry',
    planGets.length >= 1 && planGets.every((e) => e.auth === true) && planGets.every((e) => e.status === planApi.status)
      && apiCalls(greg).every((e) => e.method !== 'POST'),
    { planGets: planGets.map(brief), allCalls: entryCalls });

  // S6 keyboard from top; S2 retry through the same traversal
  let traversal = null; let retryFound = null;
  try {
    traversal = await tabFromTop(greg, (s) => s.name === 'Retry plan' && s.inMain, 30);
    retryFound = traversal.found;
    const first = traversal.stops.find((s) => s.inMain) ?? null;
    rec('S6', 'Tab from page top reaches the first actionable control in the planning content with a visible focus indicator',
      !!first && outlineVisible(first) && first.inViewport !== undefined,
      { firstInMain: first, stopsFromTop: traversal.stops.map((s) => ({ tag: s.tag, name: s.name, inMain: s.inMain })), focusVisible: first?.focusVisible,
        computed: first ? { outlineStyle: first.outlineStyle, outlineWidth: first.outlineWidth, outlineColor: first.outlineColor, outlineOffset: first.outlineOffset, boxShadow: first.boxShadow } : null });
  } catch (error) { rec('S6', 'Keyboard traversal from page top', false, { error: error.message }); }

  const retryExpected = !planOk && f1.screens.some((s) => s.includes('Order plan unavailable'));
  if (retryExpected || retryFound) {
    try {
      const before = apiCalls(greg).filter(isPlanGet).length; const mark = apiCalls(greg).length;
      let enteredWithKeyboard = false;
      if (retryFound) { await key(greg, 'Enter'); enteredWithKeyboard = true; }
      const end = Date.now() + 20000; let after = before;
      while (Date.now() < end && after <= before) { await sleep(200); after = apiCalls(greg).filter(isPlanGet).length; }
      try { await greg.until(SETTLED, 20000, 'retry settled'); } catch { /* recorded through facts */ }
      await greg.settle();
      const planApi2 = await probe('greg', '/greg/order-plan');
      const f2 = await greg.act(FACTS);
      const newCalls = apiCalls(greg, mark).map(brief);
      const reason2 = typeof planApi2.body?.reason === 'string' ? planApi2.body.reason : 'This information is unavailable. Try again.';
      const stillTruthful = planApi2.status === 200 ? !!f2.planResult
        : f2.screens.some((s) => s.includes('Order plan unavailable') && s.includes(reason2)) && !f2.planResult && f2.planTables === 0 && (!f2.submit.present || f2.submit.disabled);
      rec('S2.retry', 'Retry plan reached by Tab and activated with Enter sends a second GET /greg/order-plan and the state stays truthful',
        enteredWithKeyboard && after > before && stillTruthful && newCalls.every((e) => e.method === 'GET' && e.auth === true),
        { reachedByTab: !!retryFound, retryStop: retryFound ? { name: retryFound.name, outlineWidth: retryFound.outlineWidth, boxShadow: retryFound.boxShadow } : null,
          planGetsBefore: before, planGetsAfter: after, apiStatusAfter: planApi2.status, domScreens: f2.screens, newCalls });
    } catch (error) { rec('S2.retry', 'Retry plan by keyboard', false, { error: error.message }); }
  } else {
    rec('S2.retry', 'No retry control is expected because the plan section is not in a failure state', planOk, { apiStatus: planApi.status, buttons: f1.buttons });
  }

  // ----- S3: Production against the actual Java response -----
  const f3 = await greg.act(FACTS);
  const prodOk = prodApi.status === 200 && prodApi.body?.status === 'ok';
  const reqs = prodOk && Array.isArray(prodApi.body.value?.requests) ? prodApi.body.value.requests : [];
  const prodMatches = prodOk
    ? (reqs.length === 0 ? f3.prodRequests === 0 && /No Production requests yet\./.test(f3.prodEmpty ?? '')
      : f3.prodRequests === reqs.length && reqs.every((r) => f3.prodText.includes(String(r.requestId)) && f3.prodText.includes(`${r.model} ${r.derivative}`)
        && f3.prodText.includes(String(r.quantity))))
      && f3.prodText.includes(String(prodApi.body.value.asOf))
    : /Production status unavailable/.test(f3.prodText) || f3.screens.some((s) => s.includes('Production status unavailable'));
  const clockApi = await probe('presenter', '/presenter/clock');
  rec('S3.clock', 'Informational: the presenter clock read the synthetic Production provider depends on', true,
    { status: clockApi.status, body: clockApi.body, why: 'Production reads answer 503 clock-not-set until the run clock exists.' });
  rec('S3.api', 'Signed direct GET /greg/production as Greg (synthetic provider) records the actual status and value', prodApi.status !== undefined,
    { status: prodApi.status, status_field: prodApi.body?.status, requestCount: reqs.length, asOf: prodApi.body?.value?.asOf, provider: prodApi.body?.value?.provider, body: prodApi.body });
  rec('S3.dom', 'Production section matches the actual API value (empty state when no requests; any shown rows equal the API)', prodMatches,
    { prodRequests: f3.prodRequests, prodEmpty: f3.prodEmpty, prodHeadings: f3.prodHeadings, prodStages: f3.prodStages, prodTextExcerpt: f3.prodText.slice(0, 600) });
  const prodGets = apiCalls(greg).filter((e) => e.method === 'GET' && e.path === '/greg/production');
  rec('S3.net', 'Browser read /greg/production with a Bearer token and the status matches the direct probe', prodGets.length >= 1
    && prodGets.every((e) => e.auth === true && e.status === prodApi.status), { prodGets: prodGets.map(brief) });

  // ----- S5: rendered captures and no-overflow at 375 -----
  const captures = {};
  try {
    await viewport(greg, 1280, 900); await sleep(500);
    const d = await greg.act(FACTS);
    captures.desktop = await png(greg, 'greg-plan-1280x900.png', true);
    await viewport(greg, 375, 812); await sleep(700);
    const m = await greg.act(FACTS);
    captures.mobile = await png(greg, 'greg-plan-375x812.png', true);
    rec('S5.overflow', 'No horizontal overflow at 375px (scrollWidth <= innerWidth)', !m.overflow && m.scrollWidth <= m.innerWidth,
      { desktop: { scrollWidth: d.scrollWidth, innerWidth: d.innerWidth }, mobile: { scrollWidth: m.scrollWidth, innerWidth: m.innerWidth } });
    rec('S5.captures', 'Greg page captured as full-page PNG at 1280x900 and 375x812', captures.desktop.bytes > 5000 && captures.mobile.bytes > 5000, captures);
  } catch (error) { rec('S5.captures', 'Greg page captures', false, { error: error.message }); }

  // ----- S4: role denial (presenter and employee) -----
  const denied = {};
  for (const person of ['presenter', 'employee']) {
    const page = await newPage(cdp, `${person} planning`, 1280, 900);
    await addCspProbe(page);
    try {
      await page.send('Page.navigate', { url: `${ORIGINS.web}${PLAN_ROUTE}` });
      await page.until(`return location.origin === '${ORIGINS.web}' && !!button('Sign in');`, 30000, 'sign-in');
      await page.act("return press('Sign in');");
      await page.until(`return location.origin === '${ORIGINS.idp}' && !!document.querySelector('button[data-subject="sub-${person}"]');`, 30000, 'local OIDC login');
      await page.eval(`document.querySelector('button[data-subject="sub-${person}"]').click()`);
      await page.until(`return location.origin === '${ORIGINS.web}' && !location.pathname.startsWith('/gcsp/auth/') && !location.pathname.startsWith('/gcsp/sign-in')
        && !!document.querySelector('#gcsp-main') && document.querySelector('#gcsp-main').innerText.trim().length > 0;`, 30000, `${person} landing`);
      await sleep(1500); await page.settle();
      const facts = await page.act(FACTS);
      const calls = apiCalls(page).map(brief);
      const planningCalls = calls.filter((e) => /\/greg\/(order-plan|production)/.test(e.path));
      const deniedShown = facts.path === '/gcsp/access-denied' || /access required|not available to your|cannot use|access denied/i.test(facts.text)
        || facts.screens.some((s) => /access/i.test(s));
      denied[person] = { path: facts.path, screens: facts.screens, textExcerpt: facts.text.slice(0, 300), calls, planningCalls,
        planRendered: !!facts.planResult, errors: page.errors, csp: page.csp };
      if (person === 'presenter') denied.capture = await png(page, 'presenter-denied-1280x900.png', true);
      rec(`S4.${person}.dom`, `${person} opening /gcsp/greg/plan gets the access-denied state with no plan or Production content`,
        deniedShown && !facts.planResult && facts.prodRequests === 0 && !facts.submit.present && planningCalls.length === 0,
        { path: facts.path, screens: facts.screens, textExcerpt: facts.text.slice(0, 300), planningCalls, allApiCalls: calls });
    } catch (error) { rec(`S4.${person}.dom`, `${person} opening /gcsp/greg/plan gets access-denied`, false, { error: error.message, page: await page.eval("document.body.innerText.replace(/\\s+/g,' ').slice(0,300)").catch(() => '?') }); }
  }
  const empPlan = await probe('employee', '/greg/order-plan');
  const empProd = await probe('employee', '/greg/production');
  const anonPlan = await request('GET', '/greg/order-plan'); const anonProd = await request('GET', '/greg/production');
  const presPlan = await probe('presenter', '/greg/order-plan'); const presProd = await probe('presenter', '/greg/production');
  rec('S4.api', 'Direct API: employee gets 403 on both GETs; no token gets 401 on both', empPlan.status === 403 && empProd.status === 403 && anonPlan.status === 401 && anonProd.status === 401,
    { employee: { orderPlan: empPlan.status, production: empProd.status }, noToken: { orderPlan: anonPlan.status, production: anonProd.status },
      presenterObserved: { orderPlan: presPlan.status, production: presProd.status } });
  if (denied.capture) rec('S4.capture', 'Denial state captured as PNG', denied.capture.bytes > 5000, denied.capture);

  // ----- S7 and global no-POST rule -----
  const allCalls = apiCalls(greg).map(brief);
  const exceptions = greg.errors.slice();
  const resourceLoad = []; const otherConsole = [];
  for (const entry of greg.consoleErrors) (/Failed to load resource/i.test(entry) ? resourceLoad : otherConsole).push(entry);
  const violations = await greg.eval('window.__cspViolations ?? []').catch(() => null);
  rec('S7', 'Greg page: no CSP violation reports, no console errors besides the browser echo of the API HTTP status, no uncaught exceptions',
    greg.csp.length === 0 && (violations ?? []).length === 0 && otherConsole.length === 0 && exceptions.length === 0,
    { cspLogEntries: greg.csp, cspViolationEvents: violations, uncaughtExceptions: exceptions, consoleErrorsOther: otherConsole,
      browserEchoedResourceLoadErrors: resourceLoad, nonApiHttpErrors: greg.httpErrors, note: 'Chrome logs a console line for any HTTP error response; those are listed separately and are the expected echo of the actual API status.' });
  const everyPost = [...apiCalls(greg), ...Object.values(denied).flatMap((d) => d.calls ?? [])].filter((e) => e.method === 'POST');
  rec('S3.nopost', 'No POST (preview or production/requests) was sent by any browser context at any point', everyPost.length === 0, { posts: everyPost, gregCalls: allCalls });
  receipt.networkGreg = allCalls;
}



function teardown() {
  if (teardownPromise) return teardownPromise;
  teardownPromise = (async () => {
    try { receipt.cdp?.ws.close(); } catch { /* already closed */ }
    delete receipt.cdp;
    for (const child of owned.slice().reverse()) {
      try { await child.stop(); await child.logClosed; } catch (error) { log('owned child stop error', child.pid, error.message); }
    }
    await closeServer(webServer);
    await closeServer(idp.server);
    receipt.teardown = { ownedProcesses: receipt.processes.map((run) => ({ name: run.name, pid: run.pid, exit: run.exit })),
      allOwnedExited: owned.every((child) => child.done), serversClosed: true,
      schemaLeftForParent: true, scratchLeftForParent: true, screenshotBytes,
      note: 'Parent owns the per-run database schema, scratch/output roots and final audit.' };
  })();
  return teardownPromise;
}
function finish(runError) {
  if (finished) return;
  finished = true;
  if (sampler) clearInterval(sampler);
  receipt.endedAt = new Date().toISOString();
  if (runError) receipt.runError = runError;
  receipt.logBudget ??= { limitBytes: CHILD_LOG_LIMIT, writtenBytes: childLogBytes, exhausted: false };
  receipt.pngBytes = pngBytes;
  receipt.checks = checks;
  const required = ['S1', 'S2.dom', 'S2.net', 'S3.dom', 'S4.presenter.dom', 'S4.employee.dom', 'S4.api', 'S5.overflow', 'S6', 'S7'];
  const failed = checks.filter((c) => !c.pass).map((c) => c.id);
  receipt.failedChecks = failed;
  receipt.overall = required.every((id) => checks.find((c) => c.id === id)?.pass === true) && failed.length === 0 && !runError
    && !logLimitFailure && receipt.teardown?.allOwnedExited === true ? 'PASS' : 'FAIL';
  const file = path.join(dirs.evidence, 'connected-planning-proof.json');
  try { writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`); } catch (error) { console.error('receipt write failed', error.message); }
  for (const c of checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'} ${c.id} ${c.name}`);
  console.log(`overall ${receipt.overall}; failed: ${failed.join(', ') || 'none'}; receipt evidence/connected-planning-proof.json; owned processes exited: ${receipt.teardown?.allOwnedExited}`);
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
