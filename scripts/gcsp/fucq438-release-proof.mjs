#!/usr/bin/env node
// FUCQ-438 local proof: separate frontend/API releases stay compatible and keep retained inputs, state and links.
// Usage: SCRATCH=/private/tmp/<owned> PROOF_RUN_TOKEN=<unique> PROOF_SOURCE_REVISION=<40hex> PROOF_BUILD_A_REVISION=<40hex>
// PROOF_API_JAR_A/B=<prebuilt jars> PROOF_WEB_BROWSER_A/B=<prebuilt browser dirs> GCSP_TEST_DATABASE_URL=<owned db> PROOF_DB_USER=<role>
// PROOF_PUBLIC_BASE_URL=https://gcsp.example.test [PROOF_COMPACT_RECEIPT=<abs path>] node scripts/gcsp/fucq438-release-proof.mjs
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:https';
import https from 'node:https';
import net from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { apiJvmArgs, jvmLimitsReceipt } from './proof-jvm.mjs';

const API_JVM_ARGS = apiJvmArgs({ heap: '320m' });

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const refuse = (why) => { console.error(`REFUSED: ${why}`); process.exit(2); };

// ---------- required inputs (refuse rather than invent) ----------
const RAW_SCRATCH = process.env.SCRATCH ?? '';
if (!RAW_SCRATCH) refuse('SCRATCH is not set; the parent must supply an owned local scratch directory');
if (/CloudStorage|OneDrive/i.test(RAW_SCRATCH)) refuse('SCRATCH points into a cloud-synced folder; never used');
if (!path.isAbsolute(RAW_SCRATCH)) refuse('SCRATCH must be an absolute path');
const SCRATCH = path.resolve(RAW_SCRATCH);
if (!SCRATCH.startsWith('/private/tmp/')) refuse('SCRATCH must be a parent-owned directory under /private/tmp');
if (SCRATCH === ROOT || SCRATCH.startsWith(`${ROOT}${path.sep}`)) refuse('SCRATCH must be outside the repository');
if (!existsSync(SCRATCH) || !statSync(SCRATCH).isDirectory()) refuse('SCRATCH must be an existing directory owned by the parent run');
const RUN_TOKEN = process.env.PROOF_RUN_TOKEN ?? '';
if (!/^[a-z0-9][a-z0-9-]{5,39}$/.test(RUN_TOKEN)) refuse('PROOF_RUN_TOKEN must be the parent run token ([a-z0-9-], 6-40 characters)');
// The parent verifies and pins both revisions; this script never runs git.
const SOURCE_REVISION = process.env.PROOF_SOURCE_REVISION ?? '';
if (!/^[0-9a-f]{40}$/.test(SOURCE_REVISION)) refuse('PROOF_SOURCE_REVISION must be the parent-verified 40-hex source commit');
const BUILD_A_REVISION = process.env.PROOF_BUILD_A_REVISION ?? '';
if (!/^[0-9a-f]{40}$/.test(BUILD_A_REVISION)) refuse('PROOF_BUILD_A_REVISION must be the parent-verified 40-hex commit of the previous build');
if (BUILD_A_REVISION === SOURCE_REVISION) refuse('PROOF_BUILD_A_REVISION must differ from PROOF_SOURCE_REVISION');
const DB_SOURCE = process.env.GCSP_TEST_DATABASE_URL ? 'GCSP_TEST_DATABASE_URL' : process.env.GCSP_TEST_RUNNING_DATABASE_URL ? 'GCSP_TEST_RUNNING_DATABASE_URL' : null;
if (!DB_SOURCE) refuse('GCSP_TEST_DATABASE_URL (or GCSP_TEST_RUNNING_DATABASE_URL) is not set; supply an owned throwaway PostgreSQL 17 database');
const DB_URL = process.env[DB_SOURCE];
const DB = /^jdbc:postgresql:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?\/([A-Za-z0-9_]+)(?:\?.*)?$/.exec(DB_URL);
if (!DB) refuse(`${DB_SOURCE} must be a jdbc:postgresql URL on localhost naming one database; hosted databases are never used`);
const DB_NAME = DB[3];
const PROOF = path.join(SCRATCH, `fucq438-release-${RUN_TOKEN}`);
if (existsSync(PROOF)) refuse(`${PROOF} already exists; each run needs a fresh token`);
const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const need = (name) => { const v = process.env[name] ?? ''; if (!v) refuse(`${name} is not set`); return path.resolve(v); };
const JARS = { a: need('PROOF_API_JAR_A'), b: need('PROOF_API_JAR_B') };
const WEB_BROWSERS = { a: need('PROOF_WEB_BROWSER_A'), b: need('PROOF_WEB_BROWSER_B') };
for (const [label, file] of [['API jar A', JARS.a], ['API jar B', JARS.b], ['web A index', path.join(WEB_BROWSERS.a, 'index.html')], ['web B index', path.join(WEB_BROWSERS.b, 'index.html')], ['java', path.join(JAVA_HOME, 'bin/java')], ['keytool', path.join(JAVA_HOME, 'bin/keytool')], ['Chrome', CHROME]]) {
  if (/CloudStorage|OneDrive/i.test(file)) refuse(`${label} points into a forbidden synced folder`);
  if (!existsSync(file)) refuse(`${label} not found at ${file}`);
}
if (JARS.a === JARS.b || WEB_BROWSERS.a === WEB_BROWSERS.b) refuse('Builds A and B must be distinct inputs');
const COMPACT_RECEIPT = process.env.PROOF_COMPACT_RECEIPT ? path.resolve(process.env.PROOF_COMPACT_RECEIPT) : null;
if (COMPACT_RECEIPT && (/CloudStorage|OneDrive/i.test(COMPACT_RECEIPT) || !COMPACT_RECEIPT.startsWith('/private/tmp/'))) refuse('PROOF_COMPACT_RECEIPT must be an absolute path under /private/tmp');
const port = (name, fallback) => { const v = Number(process.env[name] ?? fallback); if (!Number.isInteger(v) || v < 1024 || v > 65535) refuse(`${name} must be a port number`); return v; };
const PORTS = { web: port('PROOF_WEB_PORT', 7638), api: port('PROOF_API_PORT', 8638), idp: port('PROOF_IDP_PORT', 9638) };
if (new Set(Object.values(PORTS)).size !== 3) refuse('Proof web/API/issuer ports must be distinct');
const DEADLINE_MS = Math.min(Number(process.env.PROOF_DEADLINE_SEC ?? 600) * 1000, process.env.PROOF_ABSOLUTE_DEADLINE_MS ? Number(process.env.PROOF_ABSOLUTE_DEADLINE_MS) - T0 : Infinity);
const PUBLIC_BASE_URL = process.env.PROOF_PUBLIC_BASE_URL ?? '';
let publicBase;
try { publicBase = new URL(PUBLIC_BASE_URL); } catch { refuse('PROOF_PUBLIC_BASE_URL must be a valid public https URL'); }
if (!/^https:\/\//.test(PUBLIC_BASE_URL) || /[\s\u0000-\u001f\u007f\\]/.test(PUBLIC_BASE_URL)
  || publicBase.username || publicBase.password || publicBase.search || publicBase.hash
  || !publicBase.hostname.includes('.') || /^[\d.]+$/.test(publicBase.hostname)
  || /[:\[\]]/.test(publicBase.hostname) || /(?:^|\.)localhost$|\.local$/.test(publicBase.hostname)) {
  refuse('PROOF_PUBLIC_BASE_URL must match the Java public-mail-base https contract');
}

const ORIGINS = { web: `https://gcsp-web.localhost:${PORTS.web}`, api: `https://gcsp-api.localhost:${PORTS.api}`, idp: `https://gcsp-idp.localhost:${PORTS.idp}` };
const ISSUER = `${ORIGINS.idp}/realms/gcsp-local`;
const API_PATH = '/api/gcsp/v1';
const API_BASE = `${ORIGINS.api}${API_PATH}`;
const KID = 'gcsp-local-test-1';
const TRUST_PASS = 'proof-local-trust';
// EnvironmentGuard's first active run; employees are explicit upstream scenario records.
const ENVIRONMENT_ID = `f438-release-${RUN_TOKEN}`;
const RUN_ID = 'run-1';
const POLICY = 'gcsp-policy-v1+offer-journey-v1';
const PEOPLE = ['paula', 'carla', 'bruno'];
const CONTROL_ROLES = { presenter: ['presenter'], greg: ['greg'] };
const TRANCHE_PLAN = path.join(PROOF, 'tranche-plan.json');
const SUPPLY_POLICY = path.join(ROOT, 'services/gcsp-api/src/test/resources/supply/policy.json');
const PSQL = path.resolve(process.env.PROOF_PSQL_BIN ?? '/opt/homebrew/opt/postgresql@17/bin/psql');
const MEDIA_ROOT = path.resolve(process.env.PROOF_MEDIA_ROOT ?? path.join(ROOT, 'assets/gcsp-vehicle-evidence'));
const MEDIA_FILES = ['07c269dd7f55fad0a56bbad65ae72f7c35defc5e8883a8290a82972e1defb427.webp', 'ed60cefd049e7293423575b5f0fcee802dbab14083dea2480211ab272896281a.webp',
  'bd89864616f3f34813cb66230e93f5e39d6a25168331ea47e84da60fbf31a735.webp', 'c1a3b0f2df9a6c3834cd04fc8f65455e6daa8fda9e7bf0f7a9c9e5e437ec8318.webp'];
for (const file of [PSQL, MEDIA_ROOT, JAVA_HOME, CHROME]) if (/CloudStorage|OneDrive/i.test(file)) refuse('An input path points into a forbidden synced folder');
if (!existsSync(PSQL)) refuse('PROOF_PSQL_BIN must name the parent-pinned native PostgreSQL 17 psql');
for (const name of MEDIA_FILES) if (!existsSync(path.join(MEDIA_ROOT, name))) refuse(`Missing parent-pinned actual media ${name}`);
if (!Number.isFinite(DEADLINE_MS) || DEADLINE_MS <= 0 || DEADLINE_MS > 600000) refuse('PROOF_DEADLINE_SEC must be in (0, 600]');
const SCHEMA = `gcsp_s_f438_${RUN_TOKEN.replace(/-/g, '_')}`;
const dirs = { logs: path.join(PROOF, 'logs'), tmp: path.join(PROOF, 'tmp'), certs: path.join(PROOF, 'certs'), staticA: path.join(PROOF, 'static-a'), staticB: path.join(PROOF, 'static-b'), browser: path.join(PROOF, 'browser'), evidence: path.join(PROOF, 'evidence') };

const receipt = { schema: 'fucq438-release-proof/1', story: 'DEV-2026-11-13-006 / FUCQ-438', startedAt: new Date().toISOString(), deadlineSeconds: DEADLINE_MS / 1000, cleanupReserveSeconds: 45, runToken: RUN_TOKEN, origins: ORIGINS,
  localTestIssuer: `LOCAL TEST OIDC ISSUER ${ISSUER}: harness only, not the real provider`, composition: null, inputs: null, tools: {}, processes: [], scenarios: {}, failureLogs: {},
  limitations: [
    'Local proof only: real prebuilt jars and compiled web bundles, native PostgreSQL 17, headless Chrome; the hosted Render checks remain Gary\'s end-of-build review.',
    'The web emulator mirrors the explicit Render fixed/named-placeholder rewrites; a frontend release is a close and restart of that server on the same origin.',
    'Local labelled OIDC issuer exercises real code/PKCE, signed JWTs and Java verification; the hosted identity provider is unrun.',
    'No email transport is configured; the captured outbox link is the producer output and opening it proves deep-link login return only.',
    'Offer decisions are never submitted; the offer stays pending throughout.',
    'Parent owns resource reservation, scratch supervision, aggregate deadline and final schema/scratch audit.' ] };

const owned = [];
const CHILD_LOG_LIMIT = 1024 * 1024;
const LOG_LIMIT_MARKER = Buffer.from('\nPROOF FAILURE: shared 1MiB child log budget exhausted; remaining child output discarded.\n');
let childLogBytes = 0; let logLimitFailure = false;
let finished = false; let teardownPromise;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256b64u = (s) => createHash('sha256').update(s).digest('base64url');
const sha256File = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const tail = (file, n = 40) => { try { return readFileSync(file, 'utf8').split('\n').slice(-n).join('\n'); } catch { return ''; } };
const cap = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 60000, env: childEnv(process.env), ...opts }).trim();

// ---------- owned child processes ----------
function processIdentity(pid) {
  if (!pid) return null;
  const r = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'pid=', '-o', 'pgid=', '-o', 'lstart=', '-o', 'comm='], { encoding: 'utf8', timeout: 1000, env: childEnv(process.env) });
  const parts = (r.stdout ?? '').trim().split(/\s+/);
  return r.status === 0 && parts.length >= 8 ? { pid: Number(parts[0]), pgid: Number(parts[1]), start: parts.slice(2, 7).join(' '), executable: parts.slice(7).join(' ') } : null;
}
function killGroup(child, sig) {
  if (child.done) return;
  const current = processIdentity(child.pid);
  if (!current) return;
  if (!child.identity || JSON.stringify(current) !== JSON.stringify(child.identity) || current.pgid !== child.pid) throw new Error(`Refused signal: owned identity changed for ${child.pid}`);
  process.kill(-child.pid, sig);
}
// The outer supervisor identifies owned children by these markers, so every child keeps them and the owned temp dirs.
const SUPERVISOR_MARKERS = ['F437_LOCAL_TOKEN', 'F438_LOCAL_TOKEN', 'TEST_RESOURCE_PARENT_RESERVATION', 'PROOF_RUN_TOKEN'];
function childEnv(env) {
  const markers = Object.fromEntries(SUPERVISOR_MARKERS.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
  return { ...env, ...markers, TMPDIR: dirs.tmp, TMP: dirs.tmp, TEMP: dirs.tmp };
}
function spawnOwned(name, cmd, args, env, portNumber = null) {
  const logFile = path.join(dirs.logs, `${name}.log`); const out = createWriteStream(logFile);
  const child = spawn(cmd, args, { cwd: ROOT, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const writeLog = (chunk) => {
    if (logLimitFailure) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = CHILD_LOG_LIMIT - LOG_LIMIT_MARKER.length - childLogBytes;
    if (bytes.length <= remaining) { childLogBytes += bytes.length; out.write(bytes); return; }
    if (remaining > 0) { out.write(bytes.subarray(0, remaining)); childLogBytes += remaining; }
    out.write(LOG_LIMIT_MARKER); childLogBytes += LOG_LIMIT_MARKER.length; logLimitFailure = true;
    receipt.logBudget = { limitBytes: CHILD_LOG_LIMIT, writtenBytes: childLogBytes, exhausted: true, triggeringProcess: name };
    void (async () => { await teardown(); finish('shared child log budget exhausted'); process.exit(1); })();
  };
  child.stdout.on('data', writeLog); child.stderr.on('data', writeLog);
  child.logClosed = new Promise(resolve => out.once('finish', resolve));
  child.once('close', () => out.end());
  child.identity = processIdentity(child.pid);
  const record = { name, pid: child.pid, identity: child.identity, executable: cmd, port: portNumber, startedAt: new Date().toISOString(), exit: null };
  receipt.processes.push(record);
  child.logFile = logFile;
  child.exited = new Promise((r) => {
    child.on('error', (e) => { child.done = true; record.exit = `spawn-error: ${e.message}`; record.endedAt = new Date().toISOString(); r(-1); });
    child.on('exit', (code, signal) => { child.done = true; record.exit = code ?? signal; record.endedAt = new Date().toISOString(); r(code); });
  });
  child.stop = async () => { if (child.done) return; killGroup(child, 'SIGTERM'); await Promise.race([child.exited, sleep(10000)]); if (!child.done) { killGroup(child, 'SIGKILL'); await Promise.race([child.exited, sleep(5000)]); } if (!child.done) throw new Error(`Owned child ${name} did not join`); };
  owned.push(child);
  return child;
}
function runOnce(name, cmd, args, env, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawnOwned(name, cmd, args, env);
    const timer = setTimeout(() => { child.stop().then(() => reject(new Error(`${name} timed out`)), reject); }, timeout);
    child.exited.then((code) => { clearTimeout(timer); if (code === 0) resolve(); else { receipt.failureLogs[name] = tail(child.logFile); reject(new Error(`${name} exited ${code}`)); } });
  });
}
const portFree = (p) => new Promise((r) => { const s = net.createServer(); s.once('error', () => r(false)); s.listen(p, '127.0.0.1', () => s.close(() => r(true))); });

// ---------- certificates (as fucq435) ----------
function makeCerts() {
  const c = (f) => path.join(dirs.certs, f);
  const ssl = (args, opts) => execFileSync('openssl', args, { cwd: dirs.certs, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, env: childEnv(process.env), ...opts });
  ssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', c('ca.key')]);
  ssl(['req', '-x509', '-new', '-key', c('ca.key'), '-sha256', '-days', '3', '-subj', '/CN=GCSP local proof CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', c('ca.pem')]);
  ssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', c('leaf.key')]);
  ssl(['req', '-new', '-key', c('leaf.key'), '-subj', '/CN=gcsp-web.localhost', '-out', c('leaf.csr')]);
  writeFileSync(c('leaf.ext'), 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:gcsp-web.localhost,DNS:gcsp-api.localhost,DNS:gcsp-idp.localhost,DNS:localhost,IP:127.0.0.1\n');
  ssl(['x509', '-req', '-in', c('leaf.csr'), '-CA', c('ca.pem'), '-CAkey', c('ca.key'), '-CAcreateserial', '-days', '3', '-sha256', '-extfile', c('leaf.ext'), '-out', c('leaf.pem')]);
  writeFileSync(c('fullchain.pem'), readFileSync(c('leaf.pem'), 'utf8') + readFileSync(c('ca.pem'), 'utf8'));
  const pub = ssl(['x509', '-in', c('leaf.pem'), '-pubkey', '-noout']);
  const der = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'der'], { input: pub, env: childEnv(process.env) });
  const spki = createHash('sha256').update(der).digest('base64');
  execFileSync(path.join(JAVA_HOME, 'bin/keytool'), ['-importcert', '-alias', 'gcsp-local-ca', '-file', c('ca.pem'), '-keystore', c('truststore.p12'), '-storetype', 'PKCS12', '-storepass', TRUST_PASS, '-noprompt'], { stdio: 'pipe', timeout: 60000, env: childEnv(process.env) });
  return { ca: readFileSync(c('ca.pem'), 'utf8'), cert: readFileSync(c('fullchain.pem')), key: readFileSync(c('leaf.key')), spki, trust: c('truststore.p12') };
}

// ---------- local labelled test OIDC issuer ----------
const idp = { observed: { pkceAuthorizations: 0, verifiedExchanges: 0 }, codes: new Map(), txns: new Map(), subjects: { ...Object.fromEntries(PEOPLE.map((person) => [`sub-${person}`, ['employee']])), ...Object.fromEntries(Object.entries(CONTROL_ROLES).map(([person, roles]) => [`sub-${person}`, roles])) }, keys: null, server: null };
function newKeys() { const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }); return { privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' } }; }
function signJwt(payload, key) {
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID })); const body = b64u(JSON.stringify(payload));
  return `${head}.${body}.${b64u(createSign('RSA-SHA256').update(`${head}.${body}`).sign(key))}`;
}
function accessClaims(sub, roles) {
  const now = Math.floor(Date.now() / 1000);
  return { iss: ISSUER, aud: ['gcsp-api'], azp: 'gcsp-web', scope: 'openid profile gcsp-api', sub, realm_access: { roles }, ...(roles.includes('employee') ? { employeeId: `employee-${sub.replace(/^sub-/, '')}` } : {}), iat: now, exp: now + 3600, jti: randomBytes(8).toString('hex') };
}
function startIdp(tls) {
  idp.keys = newKeys();
  const base = '/realms/gcsp-local';
  const meta = { issuer: ISSUER, authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`, token_endpoint: `${ISSUER}/protocol/openid-connect/token`, jwks_uri: `${ISSUER}/protocol/openid-connect/certs`, end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`, response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], grant_types_supported: ['authorization_code'], scopes_supported: ['openid', 'profile', 'gcsp-api'] };
  const cors = (req, res) => { if (req.headers.origin === ORIGINS.web) { res.setHeader('Access-Control-Allow-Origin', ORIGINS.web); res.setHeader('Vary', 'Origin'); } };
  const json = (req, res, code, obj) => { cors(req, res); res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const text = (res, code, body, type = 'text/plain') => { res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(body); };
  idp.server = createServer({ key: tls.key, cert: tls.cert }, async (req, res) => {
    const url = new URL(req.url, ISSUER);
    const form = async () => { const chunks = []; for await (const ch of req) chunks.push(ch); return new URLSearchParams(Buffer.concat(chunks).toString()); };
    if (req.method === 'OPTIONS') { cors(req, res); res.writeHead(204, req.headers.origin === ORIGINS.web ? { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Accept', 'Access-Control-Max-Age': '600' } : {}); return res.end(); }
    if (url.pathname === `${base}/.well-known/openid-configuration`) return json(req, res, 200, meta);
    if (url.pathname === `${base}/protocol/openid-connect/certs`) return json(req, res, 200, { keys: [idp.keys.jwk] });
    if (url.pathname === `${base}/protocol/openid-connect/auth` && req.method === 'GET') {
      const q = url.searchParams;
      if (q.get('client_id') !== 'gcsp-web' || q.get('redirect_uri') !== `${ORIGINS.web}/gcsp/auth/callback` || q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || !q.get('state')) return text(res, 400, 'invalid_request');
      idp.observed.pkceAuthorizations++;
      const txn = randomBytes(12).toString('hex');
      idp.txns.set(txn, { redirectUri: q.get('redirect_uri'), challenge: q.get('code_challenge'), state: q.get('state'), nonce: q.get('nonce') });
      const buttons = Object.keys(idp.subjects).map((s) => `<p><button type="submit" name="subject" value="${s}" data-subject="${s}">Sign in as ${s}</button></p>`).join('');
      return text(res, 200, `<!doctype html><title>Local test issuer</title><h1>LOCAL TEST ISSUER (not the real provider)</h1><form method="post" action="${base}/protocol/openid-connect/auth"><input type="hidden" name="txn" value="${txn}">${buttons}</form>`, 'text/html');
    }
    if (url.pathname === `${base}/protocol/openid-connect/auth` && req.method === 'POST') {
      const f = await form(); const t = idp.txns.get(f.get('txn')); idp.txns.delete(f.get('txn'));
      if (!t || !idp.subjects[f.get('subject')]) return text(res, 400, 'invalid_request');
      const code = randomBytes(16).toString('hex'); idp.codes.set(code, { ...t, subject: f.get('subject') });
      const target = new URL(t.redirectUri); target.searchParams.set('code', code); target.searchParams.set('state', t.state);
      res.writeHead(302, { Location: target.href, 'Cache-Control': 'no-store' }); return res.end();
    }
    if (url.pathname === `${base}/protocol/openid-connect/token` && req.method === 'POST') {
      const f = await form(); const c = idp.codes.get(f.get('code')); idp.codes.delete(f.get('code'));
      if (f.get('grant_type') !== 'authorization_code' || !c || f.get('client_id') !== 'gcsp-web' || f.get('redirect_uri') !== c.redirectUri || sha256b64u(f.get('code_verifier') ?? '') !== c.challenge) return json(req, res, 400, { error: 'invalid_grant' });
      idp.observed.verifiedExchanges++;
      const now = Math.floor(Date.now() / 1000);
      const idToken = signJwt({ iss: ISSUER, sub: c.subject, aud: 'gcsp-web', azp: 'gcsp-web', iat: now, exp: now + 300, auth_time: now, ...(c.nonce ? { nonce: c.nonce } : {}) }, idp.keys.privateKey);
      return json(req, res, 200, { access_token: signJwt(accessClaims(c.subject, idp.subjects[c.subject]), idp.keys.privateKey), token_type: 'Bearer', expires_in: 3600, scope: 'openid profile gcsp-api', id_token: idToken });
    }
    if (url.pathname === `${base}/protocol/openid-connect/logout`) { res.writeHead(302, { Location: `${ORIGINS.web}/gcsp/` }); return res.end(); }
    return text(res, 404, 'not found');
  });
  return new Promise((r) => idp.server.listen(PORTS.idp, '127.0.0.1', r));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.gif': 'image/gif', '.avif': 'image/avif' };

// ---------- static web: one emulator, two assembled releases served on the same origin ----------
const MIME_TYPES = MIME;
let webServer = null; let webWhich = null;
const WEB = {}; // per release: assembled root, main bundle name and hashes
function startWeb(tls, which, fixedRoutes, dynamicRoutes) {
  if (!Array.isArray(dynamicRoutes) || !dynamicRoutes.includes('/gcsp/offers/:offerId')) throw new Error('Builder must export explicit GCSP_DYNAMIC_ROUTES offer metadata');
  const fixed = new Set(fixedRoutes.map(r => r.replace(/\/$/, '') || '/'));
  const root = path.join(which === 'a' ? dirs.staticA : dirs.staticB, 'gcsp');
  const dynamicMatch = pathname => dynamicRoutes.some(route => { const parts = pathname.replace(/\/$/, '').split('/'); const expected = route.split('/'); return parts.length === expected.length && expected.every((segment, i) => segment.startsWith(':') ? parts[i].length > 0 : parts[i] === segment); });
  receipt.staticHost = { mode: 'Local emulator of explicit Render fixed/named-placeholder rewrites; no generic SPA fallback', fixedRoutes, dynamicRoutes, hosted: false };
  webServer = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, ORIGINS.web).pathname); } catch { res.writeHead(400); return res.end('invalid path'); }
    if (p === '/' || p === '/gcsp') { res.writeHead(302, { Location: '/gcsp/' }); return res.end(); }
    if (p.startsWith('/assets/gcsp-vehicle-evidence/')) {
      const name = p.slice('/assets/gcsp-vehicle-evidence/'.length);
      if (!MEDIA_FILES.includes(name)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'no-store' }); return res.end(readFileSync(path.join(MEDIA_ROOT, name)));
    }
    if (!p.startsWith('/gcsp/') || p.includes('..')) { res.writeHead(404); return res.end('not found'); }
    const norm = p.replace(/\/$/, '');
    let file = path.join(root, p.slice('/gcsp/'.length));
    if (fixed.has(norm) || dynamicMatch(p)) file = path.join(root, 'index.html');
    if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end('Not Found'); }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': ext === '.html' || ext === '.json' ? 'no-store' : 'public, max-age=31536000, immutable' }); res.end(readFileSync(file));
  });
  webWhich = which;
  return new Promise(r => webServer.listen(PORTS.web, '127.0.0.1', r));
}
const closeServer = (s) => (s ? new Promise((r) => { s.closeAllConnections?.(); s.close(() => r()); }) : Promise.resolve());
let routes = null;
// A frontend release closes the web server and starts the other assembled build on the same port.
async function releaseWeb(which) {
  const t = Date.now(); await closeServer(webServer); webServer = null;
  await startWeb(tls, which, routes.fixed, routes.dynamic);
  log(`web release ${which.toUpperCase()} serving ${WEB[which].mainJs}`);
  return Date.now() - t;
}
function staticRead(p) {
  return new Promise((resolve, reject) => {
    const req = https.get({ host: '127.0.0.1', port: PORTS.web, path: p, servername: new URL(ORIGINS.web).hostname, ca: tls.ca, agent: false }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) req.destroy(new Error('static response too large')); else chunks.push(chunk); });
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(10000, () => req.destroy(new Error('static request timeout'))); req.on('error', reject);
  });
}
// Reads what the running web server actually serves: the index's main bundle name and that bundle's bytes.
async function servedMain() {
  const index = await staticRead('/gcsp/');
  const name = /main-[A-Za-z0-9]+\.js/.exec(index.body.toString())?.[0] ?? null;
  const js = name ? await staticRead(`/gcsp/${name}`) : null;
  return { indexStatus: index.status, name, jsStatus: js?.status ?? null, sha256: js ? createHash('sha256').update(js.body).digest('hex') : null };
}

// ---------- Java API (the real jars, repository accounts, native PG) ----------
let tls;
function apiEnv() {
  return { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp, JAVA_HOME, LANG: 'en_GB.UTF-8',
    QUARKUS_HTTP_SSL_PORT: String(PORTS.api), QUARKUS_HTTP_INSECURE_REQUESTS: 'disabled', QUARKUS_HTTP_SSL_CERTIFICATE_FILES: path.join(dirs.certs, 'fullchain.pem'), QUARKUS_HTTP_SSL_CERTIFICATE_KEY_FILES: path.join(dirs.certs, 'leaf.key'),
    GCSP_ALLOWED_ORIGINS: ORIGINS.web, GCSP_IDENTITY_PROVIDER: 'oidc', GCSP_OIDC_ISSUER: ISSUER, GCSP_OIDC_JWKS_URI: `https://127.0.0.1:${PORTS.idp}/realms/gcsp-local/protocol/openid-connect/certs`,
    GCSP_OIDC_AUDIENCE: 'gcsp-api', GCSP_OIDC_AUTHORIZED_PARTY: 'gcsp-web', GCSP_OIDC_REQUIRED_SCOPES: 'gcsp-api',
    GCSP_OIDC_ACCOUNTS: JSON.stringify([...PEOPLE.map((person) => ({ subject: `sub-${person}`, roles: ['employee'], employeeId: `employee-${person}` })), ...Object.entries(CONTROL_ROLES).map(([person, roles]) => ({ subject: `sub-${person}`, roles }))]),
    GCSP_ENVIRONMENT_ID: ENVIRONMENT_ID, GCSP_RUN_ID: RUN_ID, GCSP_POLICY_VERSION: POLICY,
    GCSP_ACCOUNT_PROVIDER: 'repository', GCSP_SCENARIO_PROVIDER: 'none', GCSP_ORDERING_PROVIDER: 'synthetic', GCSP_RESET_ALLOWED: 'true',
    GCSP_BUDDY_PROVIDER: 'local-synthetic', GCSP_CLAIM_STOCK_PROVIDER: 'local',
    GCSP_SUPPLY_PROVIDER: 'tranche-plan', GCSP_SUPPLY_TRANCHE_PLAN_FILE: TRANCHE_PLAN, GCSP_SUPPLY_POLICY_FILE: SUPPLY_POLICY,
    GCSP_ALLOCATION_CANDIDATES_PROVIDER: 'recommendation',
    GCSP_DATABASE_PASSWORD: process.env.PROOF_DB_PASSWORD ?? '',
    GCSP_CLAIMS_SWEEP_INTERVAL: '10m', GCSP_NOTIFY_DRAIN_INTERVAL: '1s', GCSP_PUBLIC_BASE_URL: PUBLIC_BASE_URL,
    GCSP_DATABASE_URL: DB_URL, GCSP_DATABASE_USER: process.env.PROOF_DB_USER ?? 'gcsp', GCSP_EXPECTED_DATABASE: DB_NAME };
}
let api = null; let apiStarts = 0; let apiWhich = null;
async function startApi(which) {
  apiStarts++;
  const name = `api-${apiStarts}`;
  const props = [`-Dquarkus.datasource.jdbc.additional-jdbc-properties.currentSchema=${SCHEMA}`, `-Dquarkus.flyway.schemas=${SCHEMA}`, `-Dquarkus.flyway.default-schema=${SCHEMA}`];
  api = spawnOwned(name, path.join(JAVA_HOME, 'bin/java'), [...API_JVM_ARGS, `-Djavax.net.ssl.trustStore=${tls.trust}`, `-Djavax.net.ssl.trustStorePassword=${TRUST_PASS}`, `-Djava.io.tmpdir=${dirs.tmp}`, ...props, '-Dgcsp.allocation.candidates.provider=recommendation', '-jar', JARS[which]], apiEnv(), PORTS.api);
  apiWhich = which;
  for (let i = 0; ; i++) {
    if (api.done) { receipt.failureLogs[name] = tail(api.logFile); throw new Error(`${name} exited during startup`); }
    try { const r = await request('GET', '/context'); if (r.status === 401) break; } catch { /* not up yet */ }
    if (i > 240) { receipt.failureLogs[name] = tail(api.logFile); throw new Error(`${name} did not become ready`); }
    await sleep(500);
  }
  log(`${name} (build ${which.toUpperCase()}) ready on ${ORIGINS.api}`);
}
// An API release stops the running process and starts the chosen jar on the same database and schema.
async function releaseApi(which) {
  const t = Date.now(); await api.stop(); log(`api-${apiStarts} stopped (exit ${api.exitCode ?? api.signalCode})`);
  await startApi(which); return Date.now() - t;
}
const apiProcess = () => ({ name: `api-${apiStarts}`, pid: api.pid, start: api.identity?.start ?? null, build: apiWhich.toUpperCase(), jar: processJar(api.pid) });
function processJar(pid) { const r = spawnSync('/bin/ps', ['-ww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 1000, env: childEnv(process.env) }); return /-jar (\S+)\s*$/.exec((r.stdout ?? '').trim())?.[1] ?? null; }

// ---------- direct HTTPS setup, authority controls and current server truth ----------
function request(method, p, headers = {}, body = null) {
  const u = new URL(ORIGINS.api);
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port: Number(u.port), path: `${API_PATH}${p}`, method, servername: u.hostname, headers: { Host: u.host, Accept: 'application/json', ...headers }, ca: tls.ca, agent: false, timeout: 15000 }, (res) => {
      const chunks = []; let size = 0; res.on('data', (c) => { size += c.length; if (size > 2 * 1024 * 1024) { req.destroy(new Error('API response exceeded 2MiB bound')); return; } chunks.push(c); });
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* not json */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('timeout', () => req.destroy(new Error('request timeout'))); req.on('error', reject); req.end(body === null ? undefined : JSON.stringify(body));
  });
}
async function serverRead(suffix, person = 'paula') {
  return request('GET', suffix, { Authorization: `Bearer ${signJwt(accessClaims(`sub-${person}`, CONTROL_ROLES[person] ?? ['employee']), idp.keys.privateKey)}` });
}
async function serverAccount(person = 'paula') {
  const r = await serverRead('/manual/account', person);
  if (r.status !== 200 || r.json?.status !== 'ok') throw new Error(`server account read failed: ${r.status} ${r.json?.code ?? ''}`);
  return r.json.value;
}
let sqlCount = 0;
async function sql(statement) {
  await runOnce(`fixture-${++sqlCount}`, PSQL, ['-X', '-v', 'ON_ERROR_STOP=1', '-h', DB[1].replace(/[\[\]]/g, ''), '-p', DB[2] ?? '5432', '-U', process.env.PROOF_DB_USER ?? 'gcsp', '-d', DB_NAME, '-c', `SET search_path TO ${SCHEMA}; ${statement}`],
    { PATH: process.env.PATH, HOME: process.env.HOME, PGCONNECT_TIMEOUT: '10', PGPASSWORD: process.env.PROOF_DB_PASSWORD ?? '' }, 30000);
}
const ACCOUNT_KEY = `environment_id = '${ENVIRONMENT_ID}' AND run_id = '${RUN_ID}'`;
const quoted = (v) => `'${String(v).replace(/'/g, "''")}'`;
const sourceFile = path.join(ROOT, 'services/gcsp-api/src/test/resources/recommendation-source/source-cases.json');
const accountFile = path.join(ROOT, 'services/gcsp-api/src/test/resources/account/node-baseline/paula.json');
function upstreamRows() { return JSON.parse(readFileSync(sourceFile, 'utf8')).cases.find(c => c.name === 'paula-mixed').rows.slice(0, 2); }
function writePlan() {
  const rows = upstreamRows(); const now = Date.now();
  const plan = { label: 'TEST FIXTURE Buddy journey; not actual stock evidence', version: 'f438-release-v1', windows: [{ windowId: 'f438-w1', availableAt: new Date(now - 86400000).toISOString(), supplyId: null,
    stock: rows.map(row => ({ orderUuid: row.orderUuid, orderNumber: row.orderNumber, configurationId: row.configurationId, availability: { availableUntil: new Date(now + 400 * 86400000).toISOString() } })) }] };
  writeFileSync(TRANCHE_PLAN, JSON.stringify(plan));
  receipt.fixturePlan = { source: path.relative(ROOT, sourceFile), sourceSha256: sha256File(sourceFile), planSha256: sha256File(TRANCHE_PLAN), stockIds: rows.map(r => r.orderUuid) };
}
// Deliberately mirrors BuddyJourneySeed. These are upstream records, never offers, quotes, holds or receipts.
async function seedSources() {
  const golden = JSON.parse(readFileSync(accountFile, 'utf8'));
  const now = (await value('presenter', '/presenter/clock')).now;
  const rows = upstreamRows(); const statements = [];
  for (const row of rows) {
    const attributes = structuredClone(row);
    for (const key of ['orderUuid', 'configurationId', 'state', 'available', 'held', 'allocated', 'version', 'release']) delete attributes[key];
    attributes.facts.display.name = attributes.facts.facts.eligibilityModelKey.value.replace('|', ' ');
    attributes.facts.display.photo = `/assets/gcsp-vehicle-evidence/${MEDIA_FILES[0]}`;
    statements.push(`INSERT INTO stock_cars (environment_id,run_id,order_uuid,configuration_id,state,attributes,version) VALUES (${quoted(ENVIRONMENT_ID)},${quoted(RUN_ID)},${quoted(row.orderUuid)},${quoted(row.configurationId)},'unreleased',${quoted(JSON.stringify(attributes))}::jsonb,1)`);
  }
  for (const [index, key] of PEOPLE.entries()) {
    const employeeId = `employee-${key}`; const grade = key === 'bruno' ? 'G8-10' : 'G7';
    const rename = v => JSON.parse(JSON.stringify(v).replaceAll('employee-paula', employeeId).replaceAll('slot-paula', `slot-${key}`).replaceAll('Paula Mason', `${key[0].toUpperCase() + key.slice(1)} Mason`).replaceAll('paula.mason@', `${key}.mason@`));
    const attributes = { name: `${key[0].toUpperCase() + key.slice(1)} Mason`, companyId: golden.context.companyId, schemeId: golden.context.schemeId, gradeId: grade, entitlementSlotId: `slot-${key}` };
    statements.push(`INSERT INTO employees (environment_id,run_id,employee_id,attributes,version) VALUES (${quoted(ENVIRONMENT_ID)},${quoted(RUN_ID)},${quoted(employeeId)},${quoted(JSON.stringify(attributes))}::jsonb,${golden.input.employeeVersion})`);
    const slot = rename(golden.input.slots[0]); const slotAttributes = structuredClone(slot);
    for (const field of ['employeeId', 'entitlementSlotId', 'capacity', 'runId', 'version', 'createdAt', 'updatedAt']) delete slotAttributes[field];
    statements.push(`INSERT INTO entitlement_slots (environment_id,run_id,slot_id,employee_id,capacity,attributes,version) VALUES (${quoted(ENVIRONMENT_ID)},${quoted(RUN_ID)},${quoted(`slot-${key}`)},${quoted(employeeId)},${slot.capacity},${quoted(JSON.stringify(slotAttributes))}::jsonb,${slot.version})`);
    const account = rename(golden.input.manualContext); account.account.gradeId = grade;
    account.contracts[0].contractEndDate = new Date(Date.parse(now) + [30,45,60][index] * 86400000).toISOString().slice(0, 10);
    account.employeeFacts.requiredBy.value = new Date(Date.parse(now) + 365 * 86400000).toISOString();
    statements.push(`INSERT INTO employee_account_records (environment_id,run_id,employee_id,record_set_id,record,version) VALUES (${quoted(ENVIRONMENT_ID)},${quoted(RUN_ID)},${quoted(employeeId)},${quoted(account.recordSetId)},${quoted(JSON.stringify(account))}::jsonb,${golden.input.employeeVersion})`);
    const brief = { schemaVersion: 1, preferences: { body: { value: 'estate', importance: 100, valueState: 'confirmed', importanceState: 'confirmed', source: 'employee', confirmedAt: now } }, essentials: {} };
    const buddy = { searchConsent: true, holdConsent: true, paused: false, permissionVersion: 1 };
    const digest = createHash('sha256').update(JSON.stringify('journey-brief-v1')).digest('hex');
    statements.push(`INSERT INTO brief_heads (environment_id,run_id,employee_id,brief_version) VALUES (${quoted(ENVIRONMENT_ID)},${quoted(RUN_ID)},${quoted(employeeId)},1)`);
    statements.push(`INSERT INTO briefs (environment_id,run_id,employee_id,brief_version,previous_brief_version,operation,content,buddy,semantic_digest,policy_version,confirmed_by,confirmed_at,command_id) VALUES (${quoted(ENVIRONMENT_ID)},${quoted(RUN_ID)},${quoted(employeeId)},1,NULL,'confirmed',${quoted(JSON.stringify(brief))}::jsonb,${quoted(JSON.stringify(buddy))}::jsonb,${quoted(digest)},'gcsp-policy-v1','journey-seed',${quoted(now)}::timestamptz,'journey-brief-v1')`);
  }
  await sql(`BEGIN; ${statements.join(';\n')}; COMMIT;`);
  receipt.fixture = { kind: 'BuddyJourneySeed-equivalent upstream scenario records', accountSource: path.relative(ROOT, accountFile), accountSha256: sha256File(accountFile), asOf: now, sourceOnly: true };
  for (const person of PEOPLE) await value(person, '/manual/notification-email', { commandId: command(), expectedVersion: 0, deliveryEmail: `${person}@example.test` });
  receipt.allocatingTick = await tick();
  offers.paula = (await currentOffers('paula')).find(o => ['pending', 'active'].includes(o.state))?.offerId;
  offers.bruno = (await currentOffers('bruno')).find(o => ['pending', 'active'].includes(o.state))?.offerId;
  if (!offers.paula || !offers.bruno) throw new Error('Actual allocating tick did not produce expected Paula and Bruno pending offers');
  receipt.producedOffers = { ...offers };
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else this.listeners.forEach((f) => f(m)); }); }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', () => j(new Error('CDP websocket failed'))); }); return new Cdp(ws); }
  send(method, params = {}, sessionId) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
}
const activeContexts = new Set();
const hdr = (h = {}, name) => Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1];
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
function requestSummary(b) {
  if (!b || typeof b !== 'object') return null;
  return { ...b, carriesPrincipal: /"(employeeId|environmentId|principalId|subject)"/.test(JSON.stringify(b)) };
}
const responseSummary = (body) => body;
class Page {
  constructor(cdp, sessionId, ctxId, label) { this.cdp = cdp; this.sid = sessionId; this.ctxId = ctxId; this.label = label; this.log = []; this.byId = new Map(); this.waits = []; this.mainFrame = null; this.mainLoader = null; this.docs = 0; this.errors = []; cdp.listeners.push((m) => m.sessionId === sessionId && this.event(m)); }
  send(method, params) { return this.cdp.send(method, params, this.sid); }
  // Finished scenarios retain their observations, while browser processes and sessions are released.
  async close() { await this.settle(); await this.cdp.send('Target.disposeBrowserContext', { browserContextId: this.ctxId }); activeContexts.delete(this.ctxId); }
  event(m) {
    const p = m.params ?? {};
    if (m.method === 'Runtime.exceptionThrown') { this.errors.push(p.exceptionDetails?.text ?? 'exception'); return; }
    // A new main-frame document bumps docs; API calls are tagged with the document generation that issued them.
    if (m.method === 'Page.frameNavigated' && !p.frame.parentId) { this.mainFrame = p.frame.id; this.mainLoader = p.frame.loaderId; this.docs++; return; }
    if (m.method === 'Network.requestWillBeSent') {
      if (!p.request.url.startsWith(ORIGINS.api)) return;
      const e = { id: p.requestId, method: p.request.method, path: new URL(p.request.url).pathname.replace(API_PATH, ''), query: new URL(p.request.url).search, auth: !!hdr(p.request.headers, 'authorization'),
        doc: p.frameId === this.mainFrame ? this.docs : null, loader: p.loaderId };
      if (p.request.postData) e.request = requestSummary(parse(p.request.postData));
      else if (p.request.hasPostData) this.waits.push(this.send('Network.getRequestPostData', { requestId: p.requestId }).then((r) => { e.request = requestSummary(parse(r.postData)); }).catch(() => {}));
      this.log.push(e); this.byId.set(p.requestId, e);
    } else if (m.method === 'Network.requestWillBeSentExtraInfo') {
      const e = this.byId.get(p.requestId); if (e && hdr(p.headers, 'authorization')) e.auth = true;
    } else if (m.method === 'Network.responseReceived') {
      const e = this.byId.get(p.requestId); if (e) e.status = p.response.status;
    } else if (m.method === 'Network.loadingFailed') {
      const e = this.byId.get(p.requestId); if (e) e.failed = p.errorText;
    } else if (m.method === 'Network.loadingFinished') {
      const e = this.byId.get(p.requestId);
      if (e && e.method !== 'OPTIONS') this.waits.push(this.send('Network.getResponseBody', { requestId: p.requestId }).then((r) => { e.response = responseSummary(parse(r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body)); }).catch(() => {}));
    }
  }
  async settle() { await sleep(300); await Promise.allSettled(this.waits.splice(0)); }
  calls(from = 0) { return this.log.slice(from).filter((e) => e.method !== 'OPTIONS'); }
  async eval(expression) { const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`); return r.result.value; }
  // Runs a statement body with the DOM helpers in scope and returns its value.
  act(body) { return this.eval(`(() => { ${HELPERS}\n${body} })()`); }
  async until(body, timeout = 30000, what = body) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { try { if (await this.act(body)) return true; } catch { /* navigating */ } await sleep(250); }
    const text = await this.eval(`document.body.innerText.replace(/\\s+/g,' ').slice(0,300)`).catch(() => '?');
    const location = await this.eval(`({ origin: location.origin, pathname: location.pathname, queryKeys: [...new URL(location.href).searchParams.keys()], hasFragment: !!location.hash })`).catch(() => null);
    const calls = this.calls().slice(-16).map(({ method, path, query, auth, status, failed }) => ({ method, path, query, auth, status, failed }));
    throw new Error(`${this.label}: timed out waiting for ${what}; page text: ${text}; navigation/API diagnostics: ${JSON.stringify({ location, calls })}`);
  }
}

// DOM-only selectors follow the offer components and shared portal shell.
const HELPERS = `
const main = document.querySelector('#gcsp-main') ?? document.body ?? document;
const $ = (s) => main.querySelector(s);
const button = (label) => [...main.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const press = (label) => { const b = button(label); if (!b || b.disabled) return false; b.click(); return true; };
const text = () => main.textContent.replace(/\\s+/g, ' ').trim();
`;
async function newPage(cdp, label) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext'); activeContexts.add(browserContextId);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, sessionId, browserContextId, label);
  await page.send('Page.enable'); await page.send('Emulation.setFocusEmulationEnabled', { enabled: true }); await page.send('Network.enable'); await page.send('Network.setCacheDisabled', { cacheDisabled: true }); await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  return page;
}

// Navigates or reloads the main frame, then waits for a NEW main-frame document whose own selected GET finished,
// so DOM assertions never read the previous document or a response the old page already had.
async function freshDocument(page, how, { ready, readPath = '/manual/account', readOk = true, timeout = 30000, what = 'fresh document' } = {}) {
  const before = page.docs;
  if (how === 'reload') await page.send('Page.reload', { ignoreCache: true });
  else await page.send('Page.navigate', { url: how });
  const end = Date.now() + timeout;
  let read = null;
  while (Date.now() < end) {
    if (page.docs > before) {
      read = page.log.find((e) => e.doc === page.docs && e.loader === page.mainLoader && e.method === 'GET' && e.path === readPath && (e.status !== undefined || e.failed));
      if (read && (!readOk || read.status === 200)) break;
    }
    await sleep(100);
  }
  if (page.docs <= before) throw new Error(`${page.label}: no new main-frame document for ${what}`);
  if (!read) throw new Error(`${page.label}: the new document made no ${readPath} read for ${what}`);
  if (readOk && read.status !== 200) throw new Error(`${page.label}: ${readPath} answered ${read.status ?? read.failed} for ${what}`);
  await page.until(ready, timeout, what);
  await page.settle();
  // DOM readiness can precede the asynchronous CDP body capture. Require this document's own body.
  const bodyDeadline = Date.now() + 5000;
  while (!read.failed && read.response === undefined && Date.now() < bodyDeadline) { await sleep(100); await page.settle(); }
  if (!read.failed && read.response === undefined) throw new Error(`${page.label}: ${readPath} response body was not captured for ${what}`);
  return read;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rolesFor = (person) => CONTROL_ROLES[person] ?? ['employee'];
const command = () => `f438-${RUN_TOKEN}-${randomBytes(6).toString('hex')}`;
async function call(person, suffix, body) {
  return request(body === undefined ? 'GET' : 'POST', suffix,
    { Authorization: `Bearer ${signJwt(accessClaims(`sub-${person}`, rolesFor(person)), idp.keys.privateKey)}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body ?? null);
}
async function value(person, suffix, body) {
  const r = await call(person, suffix, body);
  if (r.status !== 200 || r.json?.status !== 'ok') throw new Error(`${person} ${suffix}: ${JSON.stringify(r)}`);
  return r.json.value;
}
async function tick(to) {
  let c = await value('presenter', '/presenter/clock');
  if (to !== undefined) {
    await value('presenter', '/presenter/clock/advance', { commandId: command(), expectedClockVersion: c.clockVersion, to });
    c = await value('presenter', '/presenter/clock');
  }
  const t = await value('presenter', '/presenter/clock/tick', { tickId: command(), expectedClockVersion: c.clockVersion });
  if (t.state !== 'completed') throw new Error(`Clock tick did not complete: ${JSON.stringify(t)}`);
  return t;
}
const offers = {};
const offerPath = id => `/offers/${encodeURIComponent(id)}`;
const offerUrl = id => `${ORIGINS.web}/gcsp/offers/${encodeURIComponent(id)}`;
async function currentOffers(person) { return (await value(person, '/offers/current')).offers; }

// Starts from the original offer URL in a fresh isolated context. No token/session injection.
async function deepLinkLogin(page, person, id) {
  await page.send('Page.navigate', { url: offerUrl(id) });
  await page.until(`return location.origin === '${ORIGINS.web}' && !!button('Sign in');`, 30000, 'deep link sign-in guard');
  const before = page.calls().filter(e => e.path === offerPath(id));
  if (before.length) throw new Error('Unauthenticated offer leaked a business read before sign-in');
  await page.act(`return press('Sign in');`);
  await page.until(`return location.origin === '${ORIGINS.idp}' && !!document.querySelector('button[data-subject="sub-${person}"]');`, 30000, 'real PKCE issuer form');
  await page.eval(`document.querySelector('button[data-subject="sub-${person}"]').click()`);
  // Angular may serialize ':' literally after parsing an encoded route segment. Decode only that segment.
  await page.until(`const parts = location.pathname.split('/'); return location.origin === '${ORIGINS.web}' && parts.length === 4 && parts[1] === 'gcsp' && parts[2] === 'offers' && decodeURIComponent(parts[3]) === ${JSON.stringify(id)} && location.search === '' && location.hash === '';`, 30000, 'return to exact offer');
}
async function openOffer(page, id, state, how = offerUrl(id)) {
  return freshDocument(page, how, { readPath: offerPath(id), ready: `return !!$('.offer-page') && !!$('gcsp-screen-intro') && text().includes(${JSON.stringify(({ pending: 'Your offer', accepted: 'Offer accepted', declined: 'Offer declined', expired: 'Offer expired' })[state])}) ${state === 'accepted' ? "|| !!$('.offer-page') && text().includes('Your selection was not sent to ordering')" : ''};`, what: `${state} offer current read` });
}

// ---------- retained-input and server-truth snapshots ----------
const sha = (v) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const stripAsOf = (o) => o && Object.fromEntries(Object.entries(o).filter(([key]) => key !== 'asOf'));
const diffKeys = (a, b) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter((k) => JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k]));
const PGENV = { PATH: process.env.PATH, HOME: process.env.HOME, PGCONNECT_TIMEOUT: '10', PGPASSWORD: process.env.PROOF_DB_PASSWORD ?? '', PGOPTIONS: `-c search_path=${SCHEMA}` };
async function sqlOut(statement) {
  const child = spawnOwned(`query-${++sqlCount}`, PSQL, ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-h', DB[1].replace(/[\[\]]/g, ''), '-p', DB[2] ?? '5432', '-U', process.env.PROOF_DB_USER ?? 'gcsp', '-d', DB_NAME, '-c', statement], PGENV);
  const code = await child.exited; await child.logClosed;
  if (code !== 0) throw new Error(`query failed: ${tail(child.logFile, 5)}`);
  return readFileSync(child.logFile, 'utf8').trim();
}
const SCOPE = `environment_id = '${ENVIRONMENT_ID}' AND run_id = '${RUN_ID}'`;
const rowsHash = (table, order, expr, extra = '') => `SELECT '${table}|' || count(*) || '|' || encode(sha256(convert_to(coalesce(string_agg(${expr}, '#' ORDER BY ${order}), ''), 'UTF8')), 'hex') FROM ${table} WHERE ${SCOPE}${extra}`;
// Hashes the seeded upstream rows by their immutable columns, so allocation state changes cannot move them.
async function retainedSources() {
  const out = await sqlOut([
    rowsHash('stock_cars', 'order_uuid', "order_uuid || '|' || configuration_id || '|' || attributes::text"),
    rowsHash('employees', 'employee_id', "employee_id || '|' || attributes::text"),
    rowsHash('entitlement_slots', 'slot_id', "slot_id || '|' || employee_id || '|' || capacity::text || '|' || attributes::text"),
    rowsHash('employee_account_records', 'employee_id', "employee_id || '|' || record_set_id || '|' || record::text"),
    rowsHash('briefs', 'employee_id', "employee_id || '|' || content::text || '|' || buddy::text || '|' || semantic_digest || '|' || policy_version", ' AND brief_version = 1')].join(' UNION ALL '));
  return Object.fromEntries(out.split('\n').map((line) => { const [table, count, hash] = line.split('|'); return [table, { rows: Number(count), sha256: hash }]; }));
}
async function flywayState() {
  const [count, hash] = (await sqlOut(`SELECT count(*) || '|' || encode(sha256(convert_to(coalesce(string_agg(version || ':' || checksum::text, '#' ORDER BY installed_rank), ''), 'UTF8')), 'hex') FROM flyway_schema_history WHERE success`)).split('|');
  return { successfulRows: Number(count), sha256: hash };
}
async function editorRead() {
  const i = (await value('paula', '/brief/editor')).initial; const comfort = i.brief?.preferences?.comfort;
  return { briefVersion: i.briefVersion, draftVersion: i.draftVersion, rating: i.currentCarRating?.value ?? null, contractId: i.currentCarRating?.contractId ?? null, comfort: comfort ? { value: comfort.value, importance: comfort.importance } : null };
}
async function outboxFor(offerId) {
  const outbox = await value('presenter', '/presenter/outbox');
  return outbox.messages.filter((m) => m.recipient?.employeeId === 'employee-paula' && m.offerLink && decodeURIComponent(new URL(m.offerLink).pathname.split('/').at(-1)) === offerId)
    .map((m) => ({ jobId: m.jobId, url: m.offerLink, transport: m.transport })).sort((x, y) => String(x.jobId).localeCompare(String(y.jobId)));
}
async function takeSnapshot() {
  const offer = await value('paula', offerPath(offers.paula));
  const truth = { account: stripAsOf(await serverAccount('paula')), offer: { offerId: offer.offerId, state: offer.state, quoteId: offer.quote?.quoteId ?? null, quoteSha256: sha(offer.quote ?? null), policyVersion: offer.quote?.policyVersion ?? null }, write: await editorRead(), outbox: await outboxFor(offers.paula) };
  const retained = { sources: await retainedSources(), policyVersion: truth.offer.policyVersion, tranchePlanSha256: sha256File(TRANCHE_PLAN), supplyPolicySha256: sha256File(SUPPLY_POLICY) };
  return { truth, retained };
}
// The one employee write: a real preferences save (comfort preference and current-car rating), never an offer decision.
async function employeeWrite(s) {
  const before = await editorRead();
  const body = { commandId: command(), expectedBriefVersion: before.briefVersion, expectedDraftVersion: before.draftVersion, changes: { comfort: { value: 50 } }, ...(before.contractId ? { currentCarRating: { contractId: before.contractId, value: 4 } } : {}) };
  const r = await call('paula', '/brief/preferences', body);
  const after = await editorRead();
  receipt.employeeWrite = { request: 'POST /brief/preferences (comfort 50, current-car rating 4 when a contract exists)', status: r.status, refusal: r.status === 200 ? undefined : r.json, before, after };
  check(s, 'employee preferences write accepted by Java', r.status === 200 && r.json?.status === 'ok');
  check(s, 'write read-back persisted (draft version advanced, comfort 50)', after.draftVersion > before.draftVersion && after.comfort?.value === 50 && (!before.contractId || after.rating === 4));
}

// ---------- phases ----------
let cdp; let session = null; let base = null; const pids = {};
const POSTS = (page) => page.calls().filter((e) => e.method === 'POST');
// Common compatibility checks for the current (web, API) pair; sessionGated=false only records the reload.
async function verifyPair(s, label, web, apiBuild, { sessionGated = true } = {}) {
  const expected = WEB[web]; const served = await servedMain();
  s.identity = { web: web.toUpperCase(), webMain: expected.mainJs, webMainSha256: expected.mainSha256, api: apiProcess(), apiJarSha256: receipt.builds.api[apiBuild].jarSha256 };
  check(s, `served index references web ${web.toUpperCase()} main bundle`, served.indexStatus === 200 && served.name === expected.mainJs);
  check(s, `served main bundle bytes are web ${web.toUpperCase()}'s`, served.jsStatus === 200 && served.sha256 === expected.mainSha256);
  check(s, `API process runs build ${apiBuild.toUpperCase()} jar`, api.identity?.pid === api.pid && !api.done && apiWhich === apiBuild && apiProcess().jar === JARS[apiBuild]);
  const now = await takeSnapshot();
  s.observations.serverTruthDiffKeys = diffKeys(now.truth, base.truth);
  s.observations.retainedDiffKeys = diffKeys(now.retained, base.retained);
  check(s, 'server truth equals the P1 snapshot (account, offer, write, outbox link)', same(now.truth, base.truth));
  check(s, 'retained inputs equal the P1 snapshot (source rows, policy version, plan and supply-policy files)', same(now.retained, base.retained));
  check(s, 'offer still pending (no decision submitted)', now.truth.offer.state === 'pending');
  const errorsBefore = session.errors.length;
  let reloaded = false;
  try {
    await openOffer(session, offers.paula, 'pending', 'reload');
    const dom = await session.act(`return { signedOut: !!button('Sign in'), accept: !!$('[data-offer-action="accept"]'), scripts: [...document.scripts].map((x) => x.src) };`);
    const read = session.calls().filter((e) => e.path === offerPath(offers.paula) && e.status === 200 && e.auth).at(-1);
    reloaded = !dom.signedOut && dom.accept && dom.scripts.some((x) => x.endsWith(`/${expected.mainJs}`)) && read?.response?.value?.offerId === offers.paula;
  } catch (e) { s.observations.reloadError = e.message.slice(0, 300); }
  if (sessionGated) check(s, 'already signed-in page reload keeps the session and renders the offer on the served bundle', reloaded);
  else s.observations.sessionReloadOnPreviousWeb = { reloaded, note: 'Recorded, not gated: a previous frontend is only required to enter by link.' };
  const fresh = await newPage(cdp, `${label} link entry`);
  try {
    await deepLinkLogin(fresh, 'paula', offers.paula);
    await fresh.until(`return !!$('[data-offer-action="accept"]') && text().includes('Your offer');`, 30000, 'offer rendered after link sign-in');
    await fresh.settle();
    const scripts = await fresh.eval(`[...document.scripts].map((x) => x.src)`);
    check(s, 'fresh page entering by the captured link signs in and renders the offer on the served bundle', scripts.some((x) => x.endsWith(`/${expected.mainJs}`)) && fresh.calls().some((e) => e.path === offerPath(offers.paula) && e.auth && e.status === 200 && e.response?.value?.offerId === offers.paula));
    check(s, 'no JavaScript exception or API write from the browser pages', fresh.errors.length === 0 && session.errors.length === errorsBefore && POSTS(fresh).length === 0 && POSTS(session).length === 0);
  } finally { await fresh.close(); }
}
async function phaseSetup(s) {
  await startWeb(tls, 'a', routes.fixed, routes.dynamic);
  check(s, 'schema starts empty', (await sqlOut(`SELECT count(*) FROM information_schema.tables WHERE table_schema = '${SCHEMA}'`)) === '0');
  await startApi('a');
  check(s, 'unauthenticated /context is 401', (await request('GET', '/context')).status === 401);
  const flyway = await flywayState();
  receipt.flyway = { afterFreshStart: flyway, migrationFiles: MIGRATIONS };
  check(s, 'Flyway created the schema (every migration applied; plus its own schema row)', flyway.successfulRows >= MIGRATIONS && flyway.successfulRows <= MIGRATIONS + 1);
  const served = await servedMain();
  check(s, 'web A serves its own main bundle', served.name === WEB.a.mainJs && served.sha256 === WEB.a.mainSha256);
  s.identity = { web: 'A', webMain: WEB.a.mainJs, api: apiProcess(), flyway };
  pids.p0 = api.pid;
}
async function phaseCreate(s) {
  await seedSources();
  let current;
  for (let i = 0; i < 40 && !current; i++) {
    current = (await outboxFor(offers.paula)).at(0);
    if (!current) await sleep(250);
  }
  check(s, 'producer captured a newly allocated offer link', !!current && current.transport === 'captured' && new URL(current.url).pathname === `/gcsp/offers/${encodeURIComponent(offers.paula)}`);
  receipt.capturedLink = { jobId: current?.jobId, offerId: offers.paula, url: current?.url, deliveredToInbox: false };
  await employeeWrite(s);
  base = await takeSnapshot();
  receipt.p1Snapshot = base;
  check(s, 'P1 snapshot holds a pending offer with a pinned quote and the seeded sources', base.truth.offer.state === 'pending' && !!base.truth.offer.quoteId && !!base.retained.policyVersion && Object.values(base.retained.sources).every((v) => v.rows > 0));
  session = await newPage(cdp, 'signed-in session page');
  await deepLinkLogin(session, 'paula', offers.paula);
  await session.until(`return !!$('[data-offer-action="accept"]') && text().includes('Your offer');`, 30000, 'authorized owned offer on the session page');
  check(s, 'paula signed in through the captured link and the offer renders on web A', await session.eval(`[...document.scripts].some((x) => x.src.endsWith('/${WEB.a.mainJs}'))`) && !POSTS(session).length);
  s.identity = { web: 'A', webMain: WEB.a.mainJs, api: apiProcess(), offerId: offers.paula, link: current?.url };
}
async function phaseWebOnly(s) {
  const before = apiProcess(); s.releaseMs = await releaseWeb('b');
  check(s, 'API process is the same PID and start time throughout', same(before, apiProcess()) && !api.done);
  await verifyPair(s, 'P2', 'b', 'a');
}
async function phaseApiOnly(s) {
  const before = apiProcess(); const web = webWhich; const webIdentity = webServer;
  s.releaseMs = await releaseApi('b');
  check(s, 'API B is a new process on the new jar', api.pid !== before.pid && apiProcess().build === 'B');
  check(s, 'web server untouched by the API release', webWhich === web && webServer === webIdentity && webServer.listening);
  const flyway = await flywayState();
  check(s, 'Flyway history unchanged by the API release', same(flyway, receipt.flyway.afterFreshStart));
  await verifyPair(s, 'P3', 'b', 'b');
}
async function phasePreviousWeb(s) {
  const before = apiProcess(); s.releaseMs = await releaseWeb('a');
  check(s, 'API B process untouched by the frontend release back to web A', same(before, apiProcess()) && !api.done);
  check(s, 'Flyway history unchanged', same(await flywayState(), receipt.flyway.afterFreshStart));
  await verifyPair(s, 'P4', 'a', 'b', { sessionGated: false });
}
async function phaseRestart(s) {
  const before = apiProcess(); const t = Date.now();
  await releaseWeb('b'); await releaseApi('b'); s.releaseMs = Date.now() - t;
  check(s, 'API restarted as a new process on the same jar', api.pid !== before.pid && apiProcess().build === 'B' && apiProcess().jar === JARS.b);
  check(s, 'Flyway history unchanged by the restart', same(await flywayState(), receipt.flyway.afterFreshStart));
  await verifyPair(s, 'P5', 'b', 'b');
}

// ---------- scenarios, main, teardown and receipts ----------
const check = (s, name, passed) => { s.checks[name] = passed === true; };
const PHASES = ['P0-fresh-start', 'P1-create-state', 'P2-frontend-release', 'P3-api-release', 'P4-previous-web', 'P5-restart-both'];
async function scenario(id, title, fn, { fatal = false } = {}) {
  const s = { title, pass: false, checks: {}, observations: {} }; receipt.scenarios[id] = s; log(`scenario ${id}: ${title}`);
  const t = Date.now();
  try { await fn(s); } catch (e) { s.error = e.message; s.checks.noException = false; }
  s.ms = Date.now() - t;
  s.pass = Object.keys(s.checks).length > 0 && Object.values(s.checks).every(v => v === true);
  writeFileSync(path.join(dirs.evidence, `checkpoint-${id}.json`), JSON.stringify(s, null, 2));
  log(`scenario ${id}: ${s.pass ? 'PASS' : 'FAIL'}${s.error ? ` (${s.error.slice(0, 300)})` : ''}`);
  if (!s.pass && fatal) throw new Error(`Phase ${id} failed; later phases depend on it`);
}
const MIGRATIONS = readdirSync(path.join(ROOT, 'services/gcsp-api/src/main/resources/db/migration')).filter((f) => /^V.*\.sql$/.test(f)).length;
const appJarsOf = (jar) => readdirSync(path.join(path.dirname(jar), 'app')).filter((f) => f.endsWith('.jar')).map((f) => ({ file: f, sha256: sha256File(path.join(path.dirname(jar), 'app', f)) }));
async function assembleWeb(which, revision) {
  const out = which === 'a' ? dirs.staticA : dirs.staticB;
  await runOnce(`assemble-${which}`, process.execPath, ['scripts/build-gcsp-static.mjs', '--browser', WEB_BROWSERS[which], '--output', out, '--environment', 'deployed', '--revision', revision],
    { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp, GCSP_PUBLIC_ENVIRONMENT_ID: ENVIRONMENT_ID, GCSP_PUBLIC_API_BASE_URL: API_BASE, GCSP_PUBLIC_OIDC_AUTHORITY: ISSUER, GCSP_PUBLIC_OIDC_CLIENT_ID: 'gcsp-web',
      GCSP_PUBLIC_OIDC_SCOPE: 'openid profile gcsp-api', GCSP_PUBLIC_OIDC_REDIRECT_URI: `${ORIGINS.web}/gcsp/auth/callback`, GCSP_PUBLIC_OIDC_POST_LOGOUT_REDIRECT_URI: `${ORIGINS.web}/gcsp/` });
  const root = path.join(out, 'gcsp');
  const mains = readdirSync(root).filter((f) => /^main-[A-Za-z0-9]+\.js$/.test(f));
  if (mains.length !== 1) throw new Error(`web ${which.toUpperCase()}: expected exactly one main bundle, found ${mains.length}`);
  WEB[which] = { sourceRevision: revision, browser: WEB_BROWSERS[which], mainJs: mains[0], mainSha256: sha256File(path.join(root, mains[0])), indexSha256: sha256File(path.join(root, 'index.html')) };
}
async function main() {
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  for (const [k, p] of Object.entries(PORTS)) if (!(await portFree(p))) throw new Error(`port ${p} (${k}) is in use; choose PROOF_${k.toUpperCase()}_PORT`);
  receipt.builds = { api: { a: { revision: BUILD_A_REVISION, jar: JARS.a, jarSha256: sha256File(JARS.a), appJars: appJarsOf(JARS.a) }, b: { revision: SOURCE_REVISION, jar: JARS.b, jarSha256: sha256File(JARS.b), appJars: appJarsOf(JARS.b) } } };
  const appHash = (b) => b.appJars.find((j) => /^gcsp-api-.*\.jar$/.test(j.file))?.sha256;
  receipt.builds.apiAppJarsDiffer = !!appHash(receipt.builds.api.a) && appHash(receipt.builds.api.a) !== appHash(receipt.builds.api.b);
  receipt.inputs = { scratch: PROOF, publicMailBaseUrl: PUBLIC_BASE_URL, database: { source: DB_SOURCE, host: DB[1], port: DB[2] ?? '5432', name: DB_NAME, schema: SCHEMA }, ports: PORTS, psql: { path: PSQL, sha256: sha256File(PSQL) }, trancheSupplyPolicy: path.relative(ROOT, SUPPLY_POLICY) };
  receipt.composition = { identity: 'oidc (local test issuer)', subjects: PEOPLE.map((p) => ({ subject: `sub-${p}`, employeeId: `employee-${p}` })), account: 'repository', scenario: 'none; explicit BuddyJourneySeed-equivalent source records', ordering: 'synthetic (offer decisions never submitted)', allocation: 'recommendation / local-synthetic Buddy', environmentId: ENVIRONMENT_ID, runId: RUN_ID, policyVersion: POLICY, sameDatabaseAndSchemaAcrossReleases: true };
  receipt.sourceRevision = { value: SOURCE_REVISION, buildA: BUILD_A_REVISION, provenance: 'PROOF_SOURCE_REVISION and PROOF_BUILD_A_REVISION supplied and verified by the parent; not read from git here' };
  receipt.tools = { harnessNode: process.version, openssl: cap('openssl', ['version']), chrome: cap(CHROME, ['--version']), apiJvm: jvmLimitsReceipt(API_JVM_ARGS), java: (spawnSync(path.join(JAVA_HOME, 'bin/java'), ['-version'], { encoding: 'utf8', env: childEnv(process.env) }).stderr ?? '').split('\n')[0] };
  await runOnce('database-version', PSQL, ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-h', DB[1].replace(/[\[\]]/g, ''), '-p', DB[2] ?? '5432', '-U', process.env.PROOF_DB_USER ?? 'gcsp', '-d', DB_NAME, '-c', 'SHOW server_version_num'], { PATH: process.env.PATH, HOME: process.env.HOME, PGCONNECT_TIMEOUT: '10', PGPASSWORD: process.env.PROOF_DB_PASSWORD ?? '' }, 15000);
  await owned.at(-1).logClosed;
  const serverVersion = readFileSync(path.join(dirs.logs, 'database-version.log'), 'utf8').trim();
  if (!/^17[0-9]{4}$/.test(serverVersion)) throw new Error(`Owned database must be native PostgreSQL 17; server_version_num=${serverVersion.slice(0,20)}`);
  receipt.inputs.database.serverVersionNum = serverVersion;
  writePlan();
  log('certificates'); tls = makeCerts();
  log('static assembly of both prebuilt webs with one runtime config');
  const assemble = await import(pathToFileURL(path.join(ROOT, 'scripts/build-gcsp-static.mjs')).href);
  routes = { fixed: assemble.GCSP_FIXED_ROUTES, dynamic: assemble.GCSP_DYNAMIC_ROUTES };
  await assembleWeb('a', BUILD_A_REVISION); await assembleWeb('b', SOURCE_REVISION);
  receipt.builds.web = WEB; receipt.builds.webMainsDiffer = WEB.a.mainJs !== WEB.b.mainJs && WEB.a.mainSha256 !== WEB.b.mainSha256;
  log('issuer'); await startIdp(tls);
  const profile = path.join(dirs.browser, 'profile'); mkdirSync(profile, { recursive: true });
  const chrome = spawnOwned('chrome', CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-allow-origins=*', `--ignore-certificate-errors-spki-list=${tls.spki}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--window-size=1280,900', 'about:blank'], { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp });
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) { if (chrome.done) throw new Error('Chrome exited during startup'); try { const [p, ws] = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n'); wsUrl = `ws://127.0.0.1:${p}${ws}`; } catch { await sleep(250); } }
  if (!wsUrl) throw new Error('Chrome DevTools endpoint not found');
  cdp = await Cdp.connect(wsUrl); receipt.cdp = cdp;
  await scenario(PHASES[0], 'Fresh state: web A and API A start on an empty schema', (s) => { check(s, 'builds A and B differ (API app jar and web main bundle)', receipt.builds.apiAppJarsDiffer && receipt.builds.webMainsDiffer); return phaseSetup(s); }, { fatal: true });
  await scenario(PHASES[1], 'Create state on web A + API A: seeded sources, new offer link, employee write', phaseCreate, { fatal: true });
  await scenario(PHASES[2], 'Frontend-only release to web B + API A (same API process)', phaseWebOnly);
  await scenario(PHASES[3], 'API-only release to web B + API B (web untouched)', phaseApiOnly);
  await scenario(PHASES[4], 'Previous web against the new API: web A + API B', phasePreviousWeb);
  await scenario(PHASES[5], 'Ordinary restart of both, same builds: web B + API B', phaseRestart);
}
function teardown() {
  if (teardownPromise) return teardownPromise;
  teardownPromise = (async () => {
  receipt.fixtureOwnership = 'Only the per-run schema was mutated; parent owns its teardown audit and removal.';
  const errors = [];
  for (const browserContextId of activeContexts) { try { await receipt.cdp?.send('Target.disposeBrowserContext', { browserContextId }); activeContexts.delete(browserContextId); } catch (e) { errors.push(`browser context: ${e.message}`); } }
  try { receipt.cdp?.ws.close(); } catch (e) { errors.push(`CDP close: ${e.message}`); }
  delete receipt.cdp;
  for (const child of owned.slice().reverse()) { try { await child.stop(); await child.logClosed; } catch (e) { errors.push(`process ${child.pid}: ${e.message}`); } }
  for (const [name, server] of [['web', webServer], ['issuer', idp.server]]) { try { await closeServer(server); } catch (e) { errors.push(`${name}: ${e.message}`); } }
  receipt.teardown = { ownedProcesses: receipt.processes.map((p) => ({ name: p.name, pid: p.pid, exit: p.exit })), allOwnedExited: owned.every((c) => c.done), browserContextsClosed: activeContexts.size === 0, serversClosed: [webServer, idp.server].every(server => !server?.listening), errors,
    scratchLeftForParent: PROOF, note: 'Nothing is deleted here; the parent owns scratch, the throwaway database and teardown audit.' };
  })();
  return teardownPromise;
}
function compactReceipt() {
  return { schema: 'fucq438-release-proof-compact/1', story: receipt.story, runToken: RUN_TOKEN, overall: receipt.overall, runError: receipt.runError ?? null, startedAt: receipt.startedAt, endedAt: receipt.endedAt,
    sourceRevision: SOURCE_REVISION, buildARevision: BUILD_A_REVISION, publicMailBaseUrl: PUBLIC_BASE_URL, database: { schema: SCHEMA, serverVersionNum: receipt.inputs?.database?.serverVersionNum },
    builds: { api: Object.fromEntries(Object.entries(receipt.builds?.api ?? {}).map(([k, v]) => [k, { revision: v.revision, jarSha256: v.jarSha256, appJarSha256: v.appJars.find((j) => /^gcsp-api-/.test(j.file))?.sha256 }])),
      web: Object.fromEntries(Object.entries(WEB).map(([k, v]) => [k, { revision: v.sourceRevision, mainJs: v.mainJs, mainSha256: v.mainSha256 }])), apiAppJarsDiffer: receipt.builds?.apiAppJarsDiffer, webMainsDiffer: receipt.builds?.webMainsDiffer },
    employeeWrite: receipt.employeeWrite, capturedLink: receipt.capturedLink, flyway: receipt.flyway, p1Snapshot: receipt.p1Snapshot?.retained ? { offer: receipt.p1Snapshot.truth.offer, write: receipt.p1Snapshot.truth.write, outbox: receipt.p1Snapshot.truth.outbox, retained: receipt.p1Snapshot.retained } : null,
    phases: PHASES.map((id) => { const s = receipt.scenarios[id]; return s ? { id, title: s.title, pass: s.pass, ms: s.ms, releaseMs: s.releaseMs ?? null, checks: s.checks, identity: s.identity ?? null, observations: Object.keys(s.observations).length ? s.observations : undefined, error: s.error } : { id, pass: false, notRun: true }; }),
    oidc: idp.observed, processes: receipt.processes.map((p) => ({ name: p.name, pid: p.pid, exit: p.exit })), teardown: { allOwnedExited: receipt.teardown?.allOwnedExited, serversClosed: receipt.teardown?.serversClosed, browserContextsClosed: receipt.teardown?.browserContextsClosed, errors: receipt.teardown?.errors },
    logBudget: receipt.logBudget, limitations: receipt.limitations };
}
function finish(runError) {
  if (finished) return; finished = true;
  receipt.oidcObserved = idp.observed;
  const sc = receipt.scenarios; const ok = (k) => sc[k]?.pass === true;
  receipt.endedAt = new Date().toISOString();
  if (runError) receipt.runError = runError;
  receipt.logBudget ??= { limitBytes: CHILD_LOG_LIMIT, writtenBytes: childLogBytes, exhausted: false };
  receipt.overall = PHASES.every(ok) && !runError && !logLimitFailure && receipt.teardown?.allOwnedExited && receipt.teardown?.serversClosed && receipt.teardown?.browserContextsClosed && receipt.teardown?.errors.length === 0 ? 'PASS' : 'FAIL';
  const file = path.join(dirs.evidence, 'release-proof.json');
  try { writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`); } catch (e) { receipt.overall = 'FAIL'; console.error('receipt write failed', e.message); }
  if (COMPACT_RECEIPT) {
    try {
      let text = `${JSON.stringify(compactReceipt(), null, 2)}\n`;
      if (Buffer.byteLength(text) > 200 * 1024) { receipt.overall = 'FAIL'; receipt.runError = 'compact receipt exceeded 200 KB'; text = `${JSON.stringify({ ...compactReceipt(), phases: undefined, overall: 'FAIL', runError: receipt.runError }, null, 2)}\n`; }
      writeFileSync(COMPACT_RECEIPT, text);
    } catch (e) { receipt.overall = 'FAIL'; console.error('compact receipt write failed', e.message); }
  }
  for (const k of PHASES) console.log(`  ${k}: ${sc[k] ? (sc[k].pass ? 'PASS' : 'FAIL') : 'NOT RUN'} ${sc[k]?.title ?? ''}${sc[k] && !sc[k].pass ? ` [failed: ${Object.entries(sc[k].checks).filter(([, v]) => v !== true).map(([n]) => n).join(', ')}]` : ''}`);
  console.log(`overall ${receipt.overall}; receipt ${file}; compact ${COMPACT_RECEIPT ?? 'none'}; all owned processes exited: ${receipt.teardown?.allOwnedExited}`);
}
const deadline = setTimeout(async () => { log('global deadline exceeded'); await teardown(); finish('global deadline exceeded'); process.exit(1); }, Math.max(1, DEADLINE_MS - 45000));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await teardown(); finish(`interrupted by ${sig}`); process.exit(130); });
let runError;
try { await main(); } catch (e) { runError = e.message; console.error('RUN ERROR:', e.message); } finally { clearTimeout(deadline); await teardown(); finish(runError); }
process.exit(receipt.overall === 'PASS' ? 0 : 1);
