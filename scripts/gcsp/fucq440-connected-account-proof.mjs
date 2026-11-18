#!/usr/bin/env node
// FUCQ-440 connected proof: built Angular account -> started Java API (OIDC, repository accounts, native PG17), headless Chrome.
// Derived from fucq435-cross-origin-proof.mjs. Never builds; the parent supplies SCRATCH, the database, the jar and the compiled web.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:https';
import https from 'node:https';
import net from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
// The parent verifies and pins the source revision; this script never runs git.
const SOURCE_REVISION = process.env.PROOF_SOURCE_REVISION ?? '';
if (!/^[0-9a-f]{40}$/.test(SOURCE_REVISION)) refuse('PROOF_SOURCE_REVISION must be the parent-verified 40-hex source commit');
const DB_SOURCE = process.env.GCSP_TEST_DATABASE_URL ? 'GCSP_TEST_DATABASE_URL' : process.env.GCSP_TEST_RUNNING_DATABASE_URL ? 'GCSP_TEST_RUNNING_DATABASE_URL' : null;
if (!DB_SOURCE) refuse('GCSP_TEST_DATABASE_URL (or GCSP_TEST_RUNNING_DATABASE_URL) is not set; supply an owned throwaway PostgreSQL 17 database');
const DB_URL = process.env[DB_SOURCE];
const DB = /^jdbc:postgresql:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?\/([A-Za-z0-9_]+)(?:\?.*)?$/.exec(DB_URL);
if (!DB) refuse(`${DB_SOURCE} must be a jdbc:postgresql URL on localhost naming one database; hosted databases are never used`);
const DB_NAME = DB[3];
const PROOF = path.join(SCRATCH, `fucq440-connected-${RUN_TOKEN}`);
if (existsSync(PROOF)) refuse(`${PROOF} already exists; each run needs a fresh token`);
const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const JAR = path.resolve(process.env.PROOF_API_JAR ?? path.join(ROOT, 'services/gcsp-api/target/quarkus-app/quarkus-run.jar'));
const WEB_BROWSER = path.resolve(process.env.PROOF_WEB_BROWSER ?? path.join(ROOT, 'apps/gcsp-web/dist/gcsp-web/browser'));
for (const [label, file] of [['API jar (prebuilt)', JAR], ['compiled web index (prebuilt)', path.join(WEB_BROWSER, 'index.html')], ['java', path.join(JAVA_HOME, 'bin/java')], ['keytool', path.join(JAVA_HOME, 'bin/keytool')], ['Chrome', CHROME]]) {
  if (/CloudStorage|OneDrive/i.test(file)) refuse(`${label} points into a forbidden synced folder`);
  if (!existsSync(file)) refuse(`${label} not found at ${file}`);
}
const port = (name, fallback) => { const v = Number(process.env[name] ?? fallback); if (!Number.isInteger(v) || v < 1024 || v > 65535) refuse(`${name} must be a port number`); return v; };
const PORTS = { web: port('PROOF_WEB_PORT', 7543), api: port('PROOF_API_PORT', 8543), idp: port('PROOF_IDP_PORT', 9543) };
const DEADLINE_MS = Number(process.env.PROOF_DEADLINE_SEC ?? 600) * 1000;

const ORIGINS = { web: `https://gcsp-web.localhost:${PORTS.web}`, api: `https://gcsp-api.localhost:${PORTS.api}`, idp: `https://gcsp-idp.localhost:${PORTS.idp}` };
const ISSUER = `${ORIGINS.idp}/realms/gcsp-local`;
const API_PATH = '/api/gcsp/v1';
const API_BASE = `${ORIGINS.api}${API_PATH}`;
const KID = 'gcsp-local-test-1';
const TRUST_PASS = 'proof-local-trust';
// The four existing demo-preparation employees share EnvironmentGuard.FIRST_RUN_ID.
const SUBJECT = 'sub-paula';
const EMPLOYEE = 'employee-paula';
const ENVIRONMENT_ID = `f440-connected-${RUN_TOKEN}`;
const RUN_ID = 'run-1';
const POLICY = 'gcsp-policy-v1';
const PEOPLE = ['paula', 'alex', 'sam', 'jordan'];
const PSQL = path.resolve(process.env.PROOF_PSQL_BIN ?? '/opt/homebrew/opt/postgresql@17/bin/psql');
const MEDIA_ROOT = path.resolve(process.env.PROOF_MEDIA_ROOT ?? path.join(ROOT, 'assets/gcsp-vehicle-evidence'));
const MEDIA_FILES = ['07c269dd7f55fad0a56bbad65ae72f7c35defc5e8883a8290a82972e1defb427.webp', 'ed60cefd049e7293423575b5f0fcee802dbab14083dea2480211ab272896281a.webp',
  'bd89864616f3f34813cb66230e93f5e39d6a25168331ea47e84da60fbf31a735.webp', 'c1a3b0f2df9a6c3834cd04fc8f65455e6daa8fda9e7bf0f7a9c9e5e437ec8318.webp'];
for (const file of [PSQL, MEDIA_ROOT, JAR, WEB_BROWSER, JAVA_HOME, CHROME]) if (/CloudStorage|OneDrive/i.test(file)) refuse('An input path points into a forbidden synced folder');
if (!existsSync(PSQL)) refuse('PROOF_PSQL_BIN must name the parent-pinned native PostgreSQL 17 psql');
for (const name of MEDIA_FILES) if (!existsSync(path.join(MEDIA_ROOT, name))) refuse(`Missing parent-pinned actual media ${name}`);
if (!Number.isFinite(DEADLINE_MS) || DEADLINE_MS <= 0 || DEADLINE_MS > 600000) refuse('PROOF_DEADLINE_SEC must be in (0, 600]');
const SCHEMA = `gcsp_s_f440c_${RUN_TOKEN.replace(/-/g, '_')}`;
const dirs = { logs: path.join(PROOF, 'logs'), tmp: path.join(PROOF, 'tmp'), certs: path.join(PROOF, 'certs'), static: path.join(PROOF, 'static'), browser: path.join(PROOF, 'browser'), evidence: path.join(PROOF, 'evidence') };

const receipt = { schema: 'fucq440-connected-account-proof/1', story: 'DEV-2026-11-13-008 / FUCQ-440', startedAt: new Date().toISOString(), deadlineSeconds: DEADLINE_MS / 1000, cleanupReserveSeconds: 45, runToken: RUN_TOKEN, origins: ORIGINS,
  localTestIssuer: `LOCAL TEST OIDC ISSUER ${ISSUER}: harness only, not the real provider`, composition: null, inputs: null, tools: {}, processes: [], scenarios: {}, originalAcceptance: null, failureLogs: {},
  limitations: [
    'The jar and compiled web are prebuilt by the parent; hashes are recorded but this script cannot prove they were built from PROOF_SOURCE_REVISION.',
    'Unavailable is a stopped API process (browser network failure), not a 503 body from a running server; Java account refusals have separate golden coverage.',
    'The per-run schema override mirrors BriefJourneyProfiles and is passed as JVM system properties; the database itself is the parent\'s throwaway PG17.',
    'Direct API reads use test tokens signed for the respective subject and verified by the same OIDC configuration; they only GET.',
    'Missing account and incomplete media/terms are explicit reversible fixture changes in this run-owned PostgreSQL schema, not mocked HTTP success.',
    'Loading is a paused real browser account request, released without fulfilling a replacement response.',
    'Chrome uses fresh isolated browser contexts. Safari, complete accessibility and hosted CSP behavior remain unrun.'] };
const owned = [];
let finished = false;
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
const SUPERVISOR_MARKERS = ['F440_LOCAL_TOKEN', 'TEST_RESOURCE_PARENT_RESERVATION', 'PROOF_RUN_TOKEN'];
function childEnv(env) {
  const markers = Object.fromEntries(SUPERVISOR_MARKERS.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
  return { ...env, ...markers, TMPDIR: dirs.tmp, TMP: dirs.tmp, TEMP: dirs.tmp };
}
function spawnOwned(name, cmd, args, env, portNumber = null) {
  const logFile = path.join(dirs.logs, `${name}.log`); const out = createWriteStream(logFile);
  const child = spawn(cmd, args, { cwd: ROOT, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.stdout.pipe(out); child.stderr.pipe(out);
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

// ---------- local test OIDC issuer (as fucq435, four employee subjects) ----------
const idp = { codes: new Map(), txns: new Map(), subjects: Object.fromEntries(PEOPLE.map((person) => [`sub-${person}`, ['employee']])), keys: null, server: null };
function newKeys() { const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }); return { privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' } }; }
function signJwt(payload, key) {
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID })); const body = b64u(JSON.stringify(payload));
  return `${head}.${body}.${b64u(createSign('RSA-SHA256').update(`${head}.${body}`).sign(key))}`;
}
function accessClaims(sub, roles) {
  const now = Math.floor(Date.now() / 1000);
  return { iss: ISSUER, aud: ['gcsp-api'], azp: 'gcsp-web', scope: 'openid profile gcsp-api', sub, realm_access: { roles }, iat: now, exp: now + 3600, jti: randomBytes(8).toString('hex') };
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
      const now = Math.floor(Date.now() / 1000);
      const idToken = signJwt({ iss: ISSUER, sub: c.subject, aud: 'gcsp-web', azp: 'gcsp-web', iat: now, exp: now + 300, auth_time: now, ...(c.nonce ? { nonce: c.nonce } : {}) }, idp.keys.privateKey);
      return json(req, res, 200, { access_token: signJwt(accessClaims(c.subject, idp.subjects[c.subject]), idp.keys.privateKey), token_type: 'Bearer', expires_in: 3600, scope: 'openid profile gcsp-api', id_token: idToken });
    }
    if (url.pathname === `${base}/protocol/openid-connect/logout`) { res.writeHead(302, { Location: `${ORIGINS.web}/gcsp/` }); return res.end(); }
    return text(res, 404, 'not found');
  });
  return new Promise((r) => idp.server.listen(PORTS.idp, '127.0.0.1', r));
}

// ---------- static web (as fucq435) ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.gif': 'image/gif', '.avif': 'image/avif' };
let webServer;
function startWeb(tls, fixedRoutes) {
  const fixed = new Set(fixedRoutes.map((r) => r.replace(/\/$/, '') || '/'));
  const root = path.join(dirs.static, 'gcsp');
  webServer = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const p = decodeURIComponent(new URL(req.url, ORIGINS.web).pathname);
    if (p === '/' || p === '/gcsp') { res.writeHead(302, { Location: '/gcsp/' }); return res.end(); }
    if (p.startsWith('/assets/gcsp-vehicle-evidence/')) {
      const name = p.slice('/assets/gcsp-vehicle-evidence/'.length);
      if (!MEDIA_FILES.includes(name)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'no-store' });
      return res.end(readFileSync(path.join(MEDIA_ROOT, name)));
    }
    if (!p.startsWith('/gcsp/') || p.includes('..')) { res.writeHead(404); return res.end('not found'); }
    const norm = p.replace(/\/$/, '');
    let file = path.join(root, p.slice('/gcsp/'.length));
    if (fixed.has(norm) || /^\/gcsp\/offers\/[^/]+$/.test(norm) || p.endsWith('/')) file = path.join(root, 'index.html');
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': ext === '.html' || ext === '.json' ? 'no-store' : 'public, max-age=31536000, immutable' });
    res.end(readFileSync(file));
  });
  return new Promise((r) => webServer.listen(PORTS.web, '127.0.0.1', r));
}
const closeServer = (s) => (s ? new Promise((r) => { s.closeAllConnections?.(); s.close(() => r()); }) : Promise.resolve());

// ---------- Java API (the real jar, repository accounts, native PG) ----------
let tls;
function apiEnv() {
  return { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp, JAVA_HOME, LANG: 'en_GB.UTF-8',
    QUARKUS_HTTP_SSL_PORT: String(PORTS.api), QUARKUS_HTTP_INSECURE_REQUESTS: 'disabled', QUARKUS_HTTP_SSL_CERTIFICATE_FILES: path.join(dirs.certs, 'fullchain.pem'), QUARKUS_HTTP_SSL_CERTIFICATE_KEY_FILES: path.join(dirs.certs, 'leaf.key'),
    QUARKUS_HTTP_ACCESS_LOG_ENABLED: 'true', QUARKUS_HTTP_ACCESS_LOG_PATTERN: 'ACCESSLOG %m %U %s',
    GCSP_ALLOWED_ORIGINS: ORIGINS.web, GCSP_IDENTITY_PROVIDER: 'oidc', GCSP_OIDC_ISSUER: ISSUER, GCSP_OIDC_JWKS_URI: `https://127.0.0.1:${PORTS.idp}/realms/gcsp-local/protocol/openid-connect/certs`,
    GCSP_OIDC_AUDIENCE: 'gcsp-api', GCSP_OIDC_AUTHORIZED_PARTY: 'gcsp-web', GCSP_OIDC_REQUIRED_SCOPES: 'gcsp-api',
    GCSP_OIDC_ACCOUNTS: JSON.stringify(PEOPLE.map((person) => ({ subject: `sub-${person}`, roles: ['employee'], employeeId: `employee-${person}` }))),
    GCSP_ENVIRONMENT_ID: ENVIRONMENT_ID, GCSP_RUN_ID: RUN_ID, GCSP_POLICY_VERSION: POLICY,
    GCSP_ACCOUNT_PROVIDER: 'repository', GCSP_SCENARIO_PROVIDER: 'demo', GCSP_ORDERING_PROVIDER: 'synthetic', GCSP_RESET_ALLOWED: 'true',
    GCSP_DATABASE_URL: DB_URL, GCSP_DATABASE_USER: process.env.PROOF_DB_USER ?? 'gcsp', GCSP_EXPECTED_DATABASE: DB_NAME };
}
let api = null; let apiStarts = 0;
async function startApi() {
  apiStarts++;
  const name = `api-${apiStarts}`;
  const props = [`-Dquarkus.datasource.jdbc.additional-jdbc-properties.currentSchema=${SCHEMA}`, `-Dquarkus.flyway.schemas=${SCHEMA}`, `-Dquarkus.flyway.default-schema=${SCHEMA}`];
  api = spawnOwned(name, path.join(JAVA_HOME, 'bin/java'), [`-Djavax.net.ssl.trustStore=${tls.trust}`, `-Djavax.net.ssl.trustStorePassword=${TRUST_PASS}`, `-Djava.io.tmpdir=${dirs.tmp}`, ...props, '-jar', JAR], apiEnv(), PORTS.api);
  for (let i = 0; ; i++) {
    if (api.done) { receipt.failureLogs[name] = tail(api.logFile); throw new Error(`${name} exited during startup`); }
    try { const r = await request('GET', '/context'); if (r.status === 401) break; } catch { /* not up yet */ }
    if (i > 240) { receipt.failureLogs[name] = tail(api.logFile); throw new Error(`${name} did not become ready`); }
    await sleep(500);
  }
  log(`${name} ready on ${ORIGINS.api}`);
}
async function stopApi() { await api.stop(); log(`api-${apiStarts} stopped (exit ${api.exitCode ?? api.signalCode})`); }

// ---------- direct HTTPS reads (server truth, GET only) ----------
function request(method, p, headers = {}) {
  const u = new URL(ORIGINS.api);
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port: Number(u.port), path: `${API_PATH}${p}`, method, servername: u.hostname, headers: { Host: u.host, Accept: 'application/json', ...headers }, ca: tls.ca, timeout: 15000 }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* not json */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('timeout', () => req.destroy(new Error('request timeout'))); req.on('error', reject); req.end();
  });
}
async function serverRead(suffix, person = 'paula') {
  return request('GET', suffix, { Authorization: `Bearer ${signJwt(accessClaims(`sub-${person}`, ['employee']), idp.keys.privateKey)}` });
}
async function serverAccount(person = 'paula') {
  const r = await serverRead('/manual/account', person);
  if (r.status !== 200 || r.json?.status !== 'ok') throw new Error(`server account read failed: ${r.status} ${r.json?.code ?? ''}`);
  return r.json.value;
}
async function serverEmail(person = 'paula') {
  const r = await serverRead('/manual/notification-email', person);
  if (r.status !== 200 || r.json?.status !== 'ok') throw new Error(`server email read failed: ${r.status} ${r.json?.code ?? ''}`);
  return r.json.value;
}
let sqlCount = 0;
async function sql(statement) {
  await runOnce(`fixture-${++sqlCount}`, PSQL, ['-X', '-v', 'ON_ERROR_STOP=1', '-h', DB[1].replace(/[\[\]]/g, ''), '-p', DB[2] ?? '5432', '-U', process.env.PROOF_DB_USER ?? 'gcsp', '-d', DB_NAME, '-c', `SET search_path TO ${SCHEMA}; ${statement}`],
    { PATH: process.env.PATH, HOME: process.env.HOME, PGCONNECT_TIMEOUT: '10' }, 30000);
}
const ACCOUNT_KEY = `environment_id = '${ENVIRONMENT_ID}' AND run_id = '${RUN_ID}'`;
let backedUp = false;
async function backupRecords() {
  await sql(`CREATE TABLE proof_account_backup AS SELECT * FROM employee_account_records WHERE ${ACCOUNT_KEY}`); backedUp = true;
}
async function restoreRecords() {
  if (!backedUp) return;
  await sql(`BEGIN; DELETE FROM employee_account_records WHERE ${ACCOUNT_KEY}; INSERT INTO employee_account_records SELECT * FROM proof_account_backup; COMMIT;`);
}

// ---------- CDP (as fucq435, with request/response summaries for /brief) ----------
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else this.listeners.forEach((f) => f(m)); }); }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', () => j(new Error('CDP websocket failed'))); }); return new Cdp(ws); }
  send(method, params = {}, sessionId) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
}
const hdr = (h = {}, name) => Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1];
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
function requestSummary(b) {
  if (!b || typeof b !== 'object') return null;
  return { commandId: typeof b.commandId === 'string', expectedVersion: b.expectedVersion, deliveryEmail: b.deliveryEmail,
    carriesIdentity: /"(employeeId|runId|environmentId|principalId|subject)"/.test(JSON.stringify(b)) };
}
function responseSummary(j) {
  if (!j || typeof j !== 'object') return null;
  return { status: j.status, code: j.code, value: j.value };
}
class Page {
  constructor(cdp, sessionId, ctxId, label) { this.cdp = cdp; this.sid = sessionId; this.ctxId = ctxId; this.label = label; this.log = []; this.byId = new Map(); this.waits = []; this.mainFrame = null; this.mainLoader = null; this.docs = 0; this.paused = []; this.pauseEvents = []; this.accountGate = false; this.errors = []; cdp.listeners.push((m) => m.sessionId === sessionId && this.event(m)); }
  send(method, params) { return this.cdp.send(method, params, this.sid); }
  event(m) {
    const p = m.params ?? {};
    if (m.method === 'Fetch.requestPaused') {
      const paused = { requestId: p.requestId, networkId: p.networkId ?? null, method: p.request.method, url: p.request.url, doc: this.docs, at: new Date().toISOString() };
      this.pauseEvents.push(paused);
      // Fetch patterns match URLs, including CORS preflights. Hold only the real account GET.
      if (this.accountGate && paused.method === 'GET' && paused.url === `${API_BASE}/manual/account`) this.paused.push(paused);
      else this.waits.push(this.send('Fetch.continueRequest', { requestId: paused.requestId }).catch((e) => { this.errors.push(`Fetch continue: ${e.message}`); }));
      return;
    }
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
      if (e && e.method !== 'OPTIONS') this.waits.push(this.send('Network.getResponseBody', { requestId: p.requestId }).then((r) => { e.response = responseSummary(parse(r.body)); }).catch(() => {}));
    }
  }
  async settle() { await sleep(300); await Promise.allSettled(this.waits.splice(0)); }
  calls(from = 0) { return this.log.slice(from).filter((e) => e.method !== 'OPTIONS'); }
  async eval(expression) { const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.text}`); return r.result.value; }
  // Runs a statement body with the DOM helpers in scope and returns its value.
  act(body) { return this.eval(`(() => { ${HELPERS}\n${body} })()`); }
  async until(body, timeout = 30000, what = body) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { try { if (await this.act(body)) return true; } catch { /* navigating */ } await sleep(250); }
    const text = await this.eval(`document.body.innerText.replace(/\\s+/g,' ').slice(0,300)`).catch(() => '?');
    throw new Error(`${this.label}: timed out waiting for ${what}; page text: ${text}`);
  }
  async shot(name) {
    const metrics = await this.send('Page.getLayoutMetrics'); const size = metrics.cssContentSize ?? metrics.contentSize;
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.width, height: Math.min(size.height, 10000), scale: 1 } });
    writeFileSync(path.join(dirs.evidence, name), Buffer.from(r.data, 'base64')); return path.join(dirs.evidence, name);
  }
}
// Selectors follow the actual AccountComponent and shared shell templates.
const HELPERS = `
const main = document.querySelector('#gcsp-main') ?? document;
const $ = (s) => main.querySelector(s);
const button = (text) => [...main.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const press = (text) => { const b = button(text); if (!b || b.disabled) return false; b.click(); return true; };
const text = () => main.innerText.replace(/\\s+/g, ' ').trim();
const emailStatus = () => $('.notification-settings [role=status]')?.textContent.trim() ?? '';
const value = (s) => $(s)?.value ?? null;
const openEmail = () => { const el = $('.notification-settings'); if (el) el.open = true; return !!el; };
const setEmail = (v) => { const el = $('#notification-email'); if (!el || el.disabled) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); return true; };
`;
async function newPage(cdp, label) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, sessionId, browserContextId, label);
  await page.send('Page.enable'); await page.send('Emulation.setFocusEmulationEnabled', { enabled: true }); await page.send('Network.enable'); await page.send('Network.setCacheDisabled', { cacheDisabled: true }); await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  return page;
}
async function signIn(page, person = 'paula') {
  const subject = `sub-${person}`;
  await page.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/` });
  await page.until(`return location.origin === '${ORIGINS.web}' && !!button('Sign in');`, 30000, 'sign-in page');
  await page.act(`return press('Sign in');`);
  await page.until(`return location.origin === '${ORIGINS.idp}' && !!document.querySelector('button[data-subject="${subject}"]');`, 30000, 'issuer login form');
  await page.eval(`document.querySelector('button[data-subject="${subject}"]').click()`);
  await page.until(`return location.origin === '${ORIGINS.web}' && /^\\/gcsp\\/(account|preferences)/.test(location.pathname);`, 30000, 'signed-in employee landing');
  return page.eval('location.pathname');
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
  return read;
}
const ACCOUNT_READY = `return !!$('.account-screen') && !/Loading your account/.test(text()) && !$('.notification-settings form[aria-busy=\"true\"]') && !$('.account-previews[aria-busy=\"true\"]');`;
async function openAccount(page) {
  await freshDocument(page, `${ORIGINS.web}/gcsp/account`, { ready: ACCOUNT_READY, what: 'account projection' });
}
async function key(page, name, code) {
  // Enter needs its character text for Chromium's native button activation. The Windows key code is not a macOS native key code.
  await page.send('Page.bringToFront');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code, ...(name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code });
}
async function snapshot(page) {
  await page.until(`return !$('.account-details') || (!!$('#notification-email') && !$('#notification-email').disabled);`, 10000, 'actual saved email read settled');
  await page.until(`return [...main.querySelectorAll('.current-car img')].every((img) => img.complete);`, 10000, 'actual car media settled');
  return page.act(`return { text: text(), name: $('.account-details strong')?.textContent.trim() ?? null, email: value('#notification-email'),
    details: !!$('.account-details'), cars: [...main.querySelectorAll('.current-car:not(.delivered-car)')].map((c) => ({ name: c.querySelector('h2')?.textContent.trim(),
      terms: c.querySelector('.car-facts dd')?.textContent.trim(), src: c.querySelector('img')?.getAttribute('src') ?? null,
      alt: c.querySelector('img')?.getAttribute('alt') ?? null, loaded: !!c.querySelector('img')?.naturalWidth, placeholder: !!c.querySelector('.image-placeholder') })),
    actions: [...main.querySelectorAll('button')].filter((b) => ['Choose a replacement', 'Start a new order'].includes(b.textContent.trim())).map((b) => ({ label: b.textContent.trim(), disabled: b.disabled })),
    historyRows: main.querySelectorAll('.account-history tbody tr').length, overflow: document.documentElement.scrollWidth > innerWidth };`);
}
const number = (v) => typeof v === 'number' ? v.toLocaleString('en-GB') : v?.value != null ? `${number(v.value)}${v.unit ? ` ${v.unit}` : ''}` : null;
function expectedTerms(car, account) {
  const source = car.terms;
  if (source?.kind === 'purchase-money') return source.currency === 'GBP' && typeof source.value === 'number' ? `£${number(source.value)}` : null;
  const cost = number(source && Object.hasOwn(source, 'value') ? source.value : car.vehicle?.points);
  const allowance = number(source && Object.hasOwn(source, 'allowance') ? source.allowance : car.schemeId === account.choices?.schemeId && account.allowance?.status !== 'unknown' ? account.allowance?.monthlyPoints ?? account.allowance?.value : null);
  return cost && allowance ? `${cost} / ${allowance}` : cost ? `${cost} · budget not supplied` : allowance ? `Cost not supplied · ${allowance} budget` : 'Not supplied';
}
function compareAccount(s, prefix, shown, account) {
  const cars = account.contracts ?? (account.currentContract ? [account.currentContract] : []);
  s.checks[`${prefix}Identity`] = shown.name === (account.account?.name ?? null) && (!account.account?.employeeNumber || shown.text.includes(account.account.employeeNumber));
  s.checks[`${prefix}CarsAndTerms`] = shown.cars.length === cars.length && cars.every((car, i) => shown.cars[i].name === (car.model ?? 'Your current car') && shown.cars[i].terms === expectedTerms(car, account));
  s.checks[`${prefix}Media`] = cars.every((car, i) => shown.cars[i].src === (car.media?.src ?? null) && (car.media?.src ? shown.cars[i].loaded && shown.cars[i].alt === (car.media.alt || car.model || 'Current car') : shown.cars[i].placeholder));
  const actions = account.state === 'ready' ? (account.actions ?? []).filter((a) => a.enabled).map((a) => a.action === 'replace' ? 'Choose a replacement' : 'Start a new order') : [];
  s.checks[`${prefix}Actions`] = shown.actions.length === actions.length && shown.actions.every((a) => actions.includes(a.label) && !a.disabled);
  s.checks[`${prefix}History`] = shown.historyRows === (account.histories ?? []).reduce((n, h) => n + h.entries.length, 0);
  s.checks[`${prefix}Drivers`] = (account.drivers ?? []).every((d) => !d.name || shown.text.includes(d.name));
}

// ---------- scenarios ----------
async function scenario(id, title, ac, fn) {
  const s = { title, ac, pass: false, checks: {}, observations: {} };
  receipt.scenarios[id] = s; log(`scenario ${id}: ${title}`);
  try { await fn(s); } catch (e) { s.checks.noException = false; s.error = e.message; }
  s.pass = Object.keys(s.checks).length > 0 && Object.values(s.checks).every((v) => v === true);
  log(`scenario ${id}: ${s.pass ? 'PASS' : 'FAIL'}${s.error ? ` (${s.error.slice(0, 200)})` : ''}`);
}
const posts = (calls, p) => calls.filter((e) => e.method === 'POST' && e.path === p);
const ownedCalls = (calls) => calls.length > 0 && calls.every((e) => e.auth && !PEOPLE.some((p) => e.path.includes(`employee-${p}`)) && !/[?&](employeeId|subject|principalId)=/.test(e.query) && !e.request?.carriesIdentity);

// AC1: source facts and existing actions, saved notification setting and real restart readback.
async function scenarioA(cdp, s, pages) {
  const page = await newPage(cdp, 'account-paula'); pages.one = page;
  await signIn(page); await openAccount(page); await backupRecords();
  const account = await serverAccount(); const shown = await snapshot(page);
  s.observations.initial = { server: account, shown };
  compareAccount(s, 'populated', shown, account);
  const golden = JSON.parse(readFileSync(path.join(ROOT, 'services/gcsp-api/src/test/resources/account/node-baseline/paula.json'))).expected.value;
  s.checks.seedMatchesFrozenAccountFacts = account.account?.name === golden.account.name && account.account?.employeeNumber === golden.account.employeeNumber
    && account.currentContract?.model === golden.currentContract.model && account.currentContract?.media?.src === golden.currentContract.media.src
    && account.currentContract?.months === golden.currentContract.months && account.currentContract?.annualMileage === golden.currentContract.annualMileage;
  s.checks.desktopFits = !shown.overflow;
  s.observations.screenshotDesktop = await page.shot('a1-populated-account-desktop.png');
  s.observations.keyboardBefore = await page.act(`const b = button('View car record'); b.focus(); return { focused: document.activeElement === b, documentFocused: document.hasFocus(), tag: document.activeElement?.tagName, text: document.activeElement?.textContent.trim() };`);
  s.checks.recordOpenerFocused = s.observations.keyboardBefore.focused && s.observations.keyboardBefore.documentFocused;
  if (!s.checks.recordOpenerFocused) throw new Error('Car-record opener did not receive focus before real Enter input');
  await page.eval(`window.__f440Keyboard = []; for (const type of ['keydown', 'keypress', 'keyup', 'click']) document.addEventListener(type, (event) => window.__f440Keyboard.push({ type: event.type, key: event.key ?? null, trusted: event.isTrusted, target: event.target?.textContent?.trim().slice(0, 100) ?? null }), { capture: true });`);
  await key(page, 'Enter', 13);
  s.observations.keyboardInput = await page.eval('window.__f440Keyboard');
  s.checks.realEnterReachedOpener = s.observations.keyboardInput.some((e) => e.type === 'keydown' && e.key === 'Enter' && e.trusted && e.target === 'View car record');
  await page.until(`return !!$('dialog[open]');`, 5000, 'keyboard-opened car record');
  const drawer = await page.act(`return { text: $('dialog').innerText, focusedInside: $('dialog').contains(document.activeElement) };`);
  s.observations.drawer = drawer;
  s.checks.keyboardOpensAuthoritativeContract = drawer.focusedInside && drawer.text.includes(account.currentContract.model)
    && drawer.text.includes(`${account.currentContract.months} months`) && drawer.text.includes(number(account.currentContract.annualMileage));
  s.observations.screenshotDrawer = await page.shot('a2-contract-record-keyboard.png');
  await key(page, 'Escape', 27); await page.until(`return !$('dialog[open]');`, 5000, 'closed car record');
  s.checks.escapeRestoresOpener = await page.act(`return document.activeElement === button('View car record');`);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await page.settle(); const narrow = await snapshot(page); s.observations.narrow = narrow;
  s.checks.narrowFits = !narrow.overflow;
  s.observations.screenshotNarrow = await page.shot('a3-populated-account-narrow.png');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const before = await serverEmail(); const savedEmail = `account-${RUN_TOKEN}@example.invalid`;
  const mark = page.log.length;
  s.observations.savePressed = await page.act(`openEmail(); return setEmail(${JSON.stringify(savedEmail)}) && press('Save email');`);
  await page.until(`return emailStatus() === 'Saved.';`, 15000, 'notification email save'); await page.settle();
  const saved = await serverEmail(); s.observations.email = { before, saved, calls: posts(page.calls(mark), '/manual/notification-email') };
  s.checks.oneDurableOwnedCommand = s.observations.savePressed && posts(page.calls(mark), '/manual/notification-email').length === 1
    && posts(page.calls(mark), '/manual/notification-email')[0].status === 200 && saved.deliveryEmail === savedEmail && saved.version === before.version + 1;
  await freshDocument(page, 'reload', { ready: ACCOUNT_READY, what: 'saved account after reload' });
  s.checks.reloadKeepsSavedEmail = await page.act(`return value('#notification-email') === ${JSON.stringify(savedEmail)};`);
  await stopApi(); await startApi();
  const restarted = await serverEmail(); const afterAccount = await serverAccount();
  s.observations.afterRestart = { email: restarted, account: afterAccount };
  s.checks.restartKeepsDurableSetting = restarted.deliveryEmail === savedEmail && restarted.version === saved.version;
  await freshDocument(page, 'reload', { ready: ACCOUNT_READY, what: 'account after actual API restart' });
  const after = await snapshot(page); compareAccount(s, 'restart', after, afterAccount);
  s.checks.restartReloadKeepsSavedEmail = after.email === savedEmail;
  s.checks.requestsCarryOnlyTheBearer = ownedCalls(page.calls());
  await page.act('return openEmail();');
  s.observations.screenshotSaved = await page.shot('a4-email-after-reload-restart.png');
  pages.savedEmail = savedEmail;
}

// AC1+AC2: separate logins read their own account; missing records/media are real repository facts.
async function scenarioB(cdp, s, pages) {
  const page = pages.one;
  const other = await newPage(cdp, 'account-other-employees');
  try {
    // Separation must compare a real nonempty saved value even when scenario A failed before its save.
    await openAccount(page);
    const separationEmail = pages.savedEmail ?? `account-${RUN_TOKEN}@example.invalid`;
    const beforeEmail = await serverEmail();
    if (beforeEmail.deliveryEmail !== separationEmail) {
      const mark = page.log.length;
      const pressed = await page.act(`openEmail(); return setEmail(${JSON.stringify(separationEmail)}) && press('Save email');`);
      if (!pressed) throw new Error('Could not submit Paula saved-state prerequisite through account UI');
      await page.until(`return emailStatus() === 'Saved.';`, 5000, 'Paula saved-state prerequisite'); await page.settle();
      s.observations.separationSave = { before: beforeEmail, calls: posts(page.calls(mark), '/manual/notification-email') };
    }
    const paulaSaved = await serverEmail();
    await freshDocument(page, 'reload', { ready: ACCOUNT_READY, what: 'Paula saved-state prerequisite readback' });
    const savedShown = await snapshot(page);
    const emailReads = () => page.calls().filter((e) => e.doc === page.docs && e.method === 'GET' && e.path === '/manual/notification-email');
    const emailReadDeadline = Date.now() + 5000;
    while (!emailReads().some((e) => e.status === 200 && e.response?.value?.deliveryEmail === separationEmail) && Date.now() < emailReadDeadline) await sleep(50);
    s.observations.separationPrerequisite = { server: paulaSaved, shown: savedShown, reads: emailReads() };
    s.checks.separationUsesDurableSavedValue = paulaSaved.deliveryEmail === separationEmail && s.observations.separationPrerequisite.shown.email === separationEmail
      && s.observations.separationPrerequisite.reads.some((e) => e.status === 200 && e.response?.value?.deliveryEmail === separationEmail);
    if (!s.checks.separationUsesDurableSavedValue) throw new Error('Paula saved-state prerequisite was not read back from the real API');
    pages.savedEmail = separationEmail;
    s.observations.employees = {};
    for (const person of ['alex', 'sam', 'jordan']) {
      if (person !== 'alex') await signOut(other);
      await signIn(other, person); await openAccount(other);
      const server = await serverAccount(person); const shown = await snapshot(other);
      s.observations.employees[person] = { server, shown }; compareAccount(s, person, shown, server);
      s.checks[`${person}NoPaulaState`] = shown.name !== 'Paula Mason' && !shown.text.includes('E749057') && shown.email !== pages.savedEmail;
      if (person === 'sam') s.checks.unsupportedSchemeHonest = server.state === 'unsupported-scheme' && shown.text.includes('Ordering is not supported for this scheme') && shown.actions.length === 0;
      if (person === 'jordan') s.checks.noCurrentCarHonest = !server.currentContract && !shown.cars.length && shown.text.includes('No current car');
      s.observations.employees[person].screenshot = await other.shot(`b-${person}-account.png`);
    }
    const named = await serverRead('/manual/account?employeeId=employee-alex');
    const headerNamed = await request('GET', '/manual/account', { Authorization: `Bearer ${signJwt(accessClaims(SUBJECT, ['employee']), idp.keys.privateKey)}`, 'X-Employee-Id': 'employee-alex' });
    s.observations.foreignNameAttempts = { query: named, header: headerNamed };
    s.checks.employeeQueryDenied = named.status === 400 && named.json?.code === 'unsupported-query' && !named.json?.value;
    s.checks.employeeHeaderCannotSwitchAccount = headerNamed.status === 200 && headerNamed.json?.value?.account?.employeeId === EMPLOYEE;
    await sql(`DELETE FROM employee_account_records WHERE ${ACCOUNT_KEY} AND employee_id = 'employee-jordan'`);
    const missing = await serverAccount('jordan');
    await freshDocument(other, 'reload', { ready: ACCOUNT_READY, what: 'actual missing repository account' });
    const missingShown = await snapshot(other); s.observations.missingAccount = { server: missing, shown: missingShown };
    s.checks.missingAccountHonest = missing.state === 'absent-hr-account' && missing.account === null && !missingShown.details && !missingShown.cars.length
      && !missingShown.actions.length && missingShown.text.includes('Your HR account is missing');
    s.observations.screenshotMissingAccount = await other.shot('b-missing-account.png');
    await restoreRecords();
    await sql(`UPDATE employee_account_records SET record = jsonb_set(record, '{contracts}', COALESCE((SELECT jsonb_agg(c - 'media' - 'months' - 'annualMileage' - 'currentOdometer' - 'contractEndDate' #- '{vehicle,points}') FROM jsonb_array_elements(record->'contracts') c), '[]'::jsonb)) WHERE ${ACCOUNT_KEY} AND employee_id = '${EMPLOYEE}'`);
    const incomplete = await serverAccount(); await freshDocument(page, 'reload', { ready: ACCOUNT_READY, what: 'actual incomplete repository car facts' });
    const incompleteShown = await snapshot(page); s.observations.incomplete = { server: incomplete, shown: incompleteShown };
    compareAccount(s, 'incomplete', incompleteShown, incomplete);
    s.checks.missingMediaAndTermsHonest = incompleteShown.cars.length > 0 && incompleteShown.cars.every((c) => c.placeholder && !c.src && /Cost not supplied|Not supplied/.test(c.terms));
    s.observations.screenshotIncomplete = await page.shot('b-incomplete-car-media-terms.png');
    await restoreRecords(); await freshDocument(page, 'reload', { ready: ACCOUNT_READY, what: 'restored account' });
    const restored = await serverAccount(); const restoredShown = await snapshot(page); compareAccount(s, 'restored', restoredShown, restored);
    s.checks.restoredActualMedia = restoredShown.cars.some((c) => c.loaded);
    const paulaEmail = await serverEmail();
    await signOut(page);
    const signedOut = await page.act(`return { text: text(), details: !!$('.account-details'), cars: !!$('.current-car'), email: value('#notification-email') };`);
    s.observations.signedOut = signedOut;
    s.checks.signOutClearsPrivateAccount = !signedOut.details && !signedOut.cars && signedOut.email === null && !signedOut.text.includes('Paula Mason');
    await signIn(page, 'alex'); await openAccount(page);
    const switched = await snapshot(page); const alex = await serverAccount('alex'); compareAccount(s, 'switched', switched, alex);
    const alexEmail = await serverEmail('alex');
    s.observations.switched = { ...switched, serverEmail: alexEmail };
    s.checks.sameContextSwitchSeparatesSavedState = switched.name === alex.account.name && switched.email === (alexEmail.deliveryEmail ?? '') && switched.email !== paulaEmail.deliveryEmail;
    await signOut(page); await signIn(page); await openAccount(page);
    const returned = await snapshot(page); const returnedEmail = await serverEmail();
    s.observations.returnedToPaula = { shown: returned, serverEmail: returnedEmail };
    s.checks.returnToPaulaKeepsOnlyPaulaSavedState = returned.email === (returnedEmail.deliveryEmail ?? '') && returnedEmail.deliveryEmail === separationEmail;
    s.checks.requestsCarryOnlyTheBearer = ownedCalls(page.calls()) && ownedCalls(other.calls());
  } finally {
    await restoreRecords(); await other.settle();
    await cdp.send('Target.disposeBrowserContext', { browserContextId: other.ctxId }).catch(() => {});
  }
}
async function signOut(page) {
  await page.eval(`(() => { const d = document.querySelector('.gcsp-account-details'); if (d) d.open = true; const b = document.querySelector('.gcsp-account-signout'); if (!b || b.disabled) throw new Error('Sign out not available'); b.click(); })()`);
  await page.until(`return location.origin === '${ORIGINS.web}' && !!button('Sign in') && !$('.account-details');`, 15000, 'signed-out document');
}

// AC2: delay only the real account request, then stop the API to prove truthful failure and recovery.
async function scenarioC(cdp, s, pages) {
  const page = pages.one;
  const reader = await newPage(cdp, 'account-unavailable-reader');
  try {
    await signIn(reader); await openAccount(reader);
    reader.accountGate = true;
    await reader.send('Fetch.enable', { patterns: [{ urlPattern: `${API_BASE}/manual/account`, requestStage: 'Request' }] });
    const beforeDoc = reader.docs; const gateMark = reader.log.length; const gateStart = Date.now();
    await reader.send('Page.reload', { ignoreCache: true });
    while (!reader.paused.length && Date.now() - gateStart < 5000) await sleep(50);
    s.observations.loadingGate = { beforeDoc, currentDoc: reader.docs, paused: [...reader.paused], events: reader.pauseEvents, calls: reader.calls(gateMark) };
    if (!reader.paused.length) throw new Error('No actual account GET paused within 5 seconds; see loadingGate events and calls');
    // Read heading textContent (unaffected by presentation case), and require the semantic busy state.
    await reader.until(`return [...main.querySelectorAll('.gcsp-status[aria-busy="true"] h1')].some((h) => /^Loading your account$/i.test(h.textContent.trim())) && !$('.account-details') && !$('.current-car');`, 2000, 'truthful loading state while actual account GET is gated');
    s.checks.loadingIsARealPendingRequest = reader.docs > beforeDoc && reader.paused.some((r) => r.doc === reader.docs && r.method === 'GET' && r.url === `${API_BASE}/manual/account`);
    s.observations.loadingGate.shown = await reader.act(`return { text: text(), busy: !!$('.gcsp-status[aria-busy="true"]'), details: !!$('.account-details'), car: !!$('.current-car') };`);
    s.observations.screenshotLoading = await reader.shot('c1-real-account-request-delayed.png');
    for (const { requestId } of reader.paused.splice(0)) await reader.send('Fetch.continueRequest', { requestId });
    reader.accountGate = false; await reader.send('Fetch.disable'); await reader.until(ACCOUNT_READY, 15000, 'real account response after gate release');
    s.checks.gateRecoveredRealResponse = (await snapshot(reader)).name === (await serverAccount()).account.name;
    const saved = await serverEmail(); await stopApi();
    const mark = page.log.length; const attempted = `unsaved-${RUN_TOKEN}@example.invalid`;
    s.observations.saveWhileStoppedPressed = await page.act(`openEmail(); return setEmail(${JSON.stringify(attempted)}) && press('Save email');`);
    await page.until(`return emailStatus() === 'Could not save your notification email. Try again.';`, 15000, 'truthful save failure while API stopped'); await page.settle();
    const calls = posts(page.calls(mark), '/manual/notification-email');
    s.observations.failedSave = { calls, status: await page.act('return emailStatus();') };
    s.checks.noInventedSave = s.observations.saveWhileStoppedPressed && calls.length === 1 && !!calls[0].failed && !calls[0].status;
    s.checks.unsavedInputKept = await page.act(`return value('#notification-email') === ${JSON.stringify(attempted)};`);
    s.observations.screenshotUnsaved = await page.shot('c2-email-unsaved-api-stopped.png');
    const read = await freshDocument(reader, 'reload', { readPath: '/context', readOk: false,
      ready: `return /could not be loaded|unavailable/i.test(text()) && !$('.account-details') && !$('.current-car');`, what: 'fresh authentication failure with API stopped' });
    s.observations.failedRead = { status: read.status ?? null, failed: read.failed ?? null, shown: await snapshot(reader) };
    s.checks.failedFreshReadInventsNoAccount = !!read.failed && read.status === undefined && !s.observations.failedRead.shown.details && s.observations.failedRead.shown.cars.length === 0;
    s.observations.screenshotUnavailable = await reader.shot('c3-account-unavailable-api-stopped.png');
    await startApi(); const restarted = await serverEmail();
    s.observations.persistedAfterFailedSave = restarted;
    s.checks.failedSaveWroteNothing = restarted.version === saved.version && restarted.deliveryEmail === saved.deliveryEmail;
    await freshDocument(reader, 'reload', { ready: ACCOUNT_READY, what: 'account recovered after API restart' });
    const shown = await snapshot(reader); compareAccount(s, 'recovered', shown, await serverAccount());
    s.checks.recoveryReadsSavedValue = shown.email === (saved.deliveryEmail ?? '') && shown.email !== attempted;
    s.checks.requestsCarryOnlyTheBearer = ownedCalls(page.calls()) && ownedCalls(reader.calls());
    s.observations.screenshotRecovered = await reader.shot('c4-account-recovered.png');
    s.observations.browserRuntimeErrors = [...page.errors, ...reader.errors];
    s.checks.noBrowserRuntimeExceptions = s.observations.browserRuntimeErrors.length === 0;
  } finally {
    s.observations.readerDiagnostics = { docs: reader.docs, pausedEvents: reader.pauseEvents, calls: reader.calls(), text: await reader.act('return text();').catch(() => null) };
    reader.accountGate = false;
    for (const { requestId } of reader.paused.splice(0)) await reader.send('Fetch.continueRequest', { requestId }).catch(() => {});
    await reader.send('Fetch.disable').catch(() => {}); await reader.settle();
    await cdp.send('Target.disposeBrowserContext', { browserContextId: reader.ctxId }).catch(() => {});
  }
}

// ---------- main ----------
function accessLog() {
  const rows = [];
  for (const p of receipt.processes.filter((x) => x.name.startsWith('api-'))) {
    for (const l of tail(path.join(dirs.logs, `${p.name}.log`), 100000).split('\n')) { const m = /ACCESSLOG (\S+) (\S+) (\d+)/.exec(l); if (m && (/\/(manual\/account|manual\/notification-email|context)/.test(m[2]))) rows.push(`${p.name} ${m[1]} ${m[2].replace(API_PATH, '')} ${m[3]}`); }
  }
  return rows.slice(-80);
}
async function main() {
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  for (const [k, p] of Object.entries(PORTS)) if (!(await portFree(p))) throw new Error(`port ${p} (${k}) is in use; choose PROOF_${k.toUpperCase()}_PORT`);
  receipt.inputs = { scratch: PROOF, database: { source: DB_SOURCE, host: DB[1], port: DB[2] ?? '5432', name: DB_NAME, schema: SCHEMA }, ports: PORTS, jar: { path: path.relative(ROOT, JAR), sha256: sha256File(JAR) },
    appJars: readdirSync(path.join(path.dirname(JAR), 'app')).filter((f) => f.endsWith('.jar')).map((f) => ({ file: f, sha256: sha256File(path.join(path.dirname(JAR), 'app', f)) })), psql: { path: PSQL, sha256: sha256File(PSQL) }, media: MEDIA_FILES.map((name) => ({ name, sha256: sha256File(path.join(MEDIA_ROOT, name)) })), webBrowser: { path: path.relative(ROOT, WEB_BROWSER), indexSha256: sha256File(path.join(WEB_BROWSER, 'index.html')) } };
  receipt.composition = { identity: 'oidc (local test issuer)', subjects: PEOPLE.map((p) => ({ subject: `sub-${p}`, employeeId: `employee-${p}` })), account: 'repository', scenario: 'demo', ordering: 'synthetic', resetAllowed: true, environmentId: ENVIRONMENT_ID, runId: RUN_ID, policyVersion: POLICY, mirrors: 'existing demo preparation and Java account node-baseline cases; owned schema fixture changes only' };
  receipt.sourceRevision = { value: SOURCE_REVISION, provenance: 'PROOF_SOURCE_REVISION supplied and verified by the parent; not read from git here' };
  receipt.tools = { harnessNode: process.version, openssl: cap('openssl', ['version']), chrome: cap(CHROME, ['--version']), java: (spawnSync(path.join(JAVA_HOME, 'bin/java'), ['-version'], { encoding: 'utf8', env: childEnv(process.env) }).stderr ?? '').split('\n')[0] };
  log('certificates'); tls = makeCerts();
  log('static assembly of the prebuilt web');
  const assemble = await import(pathToFileURL(path.join(ROOT, 'scripts/build-gcsp-static.mjs')).href);
  await runOnce('assemble', process.execPath, ['scripts/build-gcsp-static.mjs', '--browser', WEB_BROWSER, '--output', dirs.static, '--environment', 'deployed', '--revision', SOURCE_REVISION],
    { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp, GCSP_PUBLIC_ENVIRONMENT_ID: ENVIRONMENT_ID, GCSP_PUBLIC_API_BASE_URL: API_BASE, GCSP_PUBLIC_OIDC_AUTHORITY: ISSUER, GCSP_PUBLIC_OIDC_CLIENT_ID: 'gcsp-web',
      GCSP_PUBLIC_OIDC_SCOPE: 'openid profile gcsp-api', GCSP_PUBLIC_OIDC_REDIRECT_URI: `${ORIGINS.web}/gcsp/auth/callback`, GCSP_PUBLIC_OIDC_POST_LOGOUT_REDIRECT_URI: `${ORIGINS.web}/gcsp/` });
  log('issuer and web'); await startIdp(tls); await startWeb(tls, assemble.GCSP_FIXED_ROUTES);
  log('API (repository accounts, native PG)'); await startApi();
  const profile = path.join(dirs.browser, 'profile'); mkdirSync(profile, { recursive: true });
  const chrome = spawnOwned('chrome', CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-allow-origins=*', `--ignore-certificate-errors-spki-list=${tls.spki}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--window-size=1280,900', 'about:blank'], { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp });
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) { if (chrome.done) throw new Error('Chrome exited during startup'); try { const [p, ws] = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n'); wsUrl = `ws://127.0.0.1:${p}${ws}`; } catch { await sleep(250); } }
  if (!wsUrl) throw new Error('Chrome DevTools endpoint not found');
  const cdp = await Cdp.connect(wsUrl); receipt.cdp = cdp;
  const pages = {};
  await scenario('a', 'Authoritative account, media, terms and actions; email save survives reload and API restart', 'AC1+AC2', (s) => scenarioA(cdp, s, pages));
  if (pages.one) await scenario('b', 'Distinct employees, denied identity naming, missing account/media and saved-state separation', 'AC1+AC2', (s) => scenarioB(cdp, s, pages));
  if (pages.one) await scenario('c', 'Real request loading and stopped-API failures stay truthful; restart recovers saved state', 'AC1+AC2', (s) => scenarioC(cdp, s, pages));
}
async function teardown() {
  try { await restoreRecords(); receipt.fixtureRestoredAtTeardown = backedUp; } catch (e) { receipt.fixtureRestoreError = e.message; }
  try { receipt.cdp?.ws.close(); } catch { /* closed */ }
  delete receipt.cdp;
  for (const child of owned.slice().reverse()) { try { await child.stop(); } catch (e) { log('stop error', child.pid, e.message); } }
  await closeServer(webServer); await closeServer(idp.server);
  receipt.teardown = { ownedProcesses: receipt.processes.map((p) => ({ name: p.name, pid: p.pid, exit: p.exit })), allOwnedExited: owned.every((c) => c.done), serversClosed: true,
    scratchLeftForParent: PROOF, note: 'Nothing is deleted here; the parent owns scratch, the throwaway database and teardown audit.' };
}
function finish(runError) {
  if (finished) return; finished = true;
  const sc = receipt.scenarios; const ok = (k) => sc[k]?.pass === true;
  receipt.endedAt = new Date().toISOString();
  if (runError) receipt.runError = runError;
  try { receipt.apiAccessLog = accessLog(); } catch { /* no log */ }
  receipt.originalAcceptance = {
    AC1: { text: 'Account, current car, image, contract/terms and existing account actions reflect authoritative API facts and the signed-in employee.', scenarios: ['a', 'b'], evidence: ok('a') && ok('b') ? 'pass' : 'fail', closure: 'OPEN: parent review decides' },
    AC2: { text: 'Missing/unavailable evidence and loading/error states are truthful. Refresh preserves actual saved state and account separation.', scenarios: ['a', 'b', 'c'], evidence: ok('a') && ok('b') && ok('c') ? 'pass' : 'fail', closure: 'OPEN: parent review decides' } };
  receipt.overall = ['a', 'b', 'c'].every(ok) && !runError && !receipt.fixtureRestoreError && receipt.teardown?.allOwnedExited ? 'PASS' : 'FAIL';
  const file = path.join(dirs.evidence, 'connected-account-proof.json');
  try { writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`); } catch (e) { console.error('receipt write failed', e.message); }
  for (const k of Object.keys(sc).sort()) console.log(`  ${k}: ${sc[k].pass ? 'PASS' : 'FAIL'} ${sc[k].title}${sc[k].pass ? '' : ` [failed: ${Object.entries(sc[k].checks).filter(([, v]) => v !== true).map(([n]) => n).join(', ')}]`}`);
  console.log(`overall ${receipt.overall}; receipt ${file}; all owned processes exited: ${receipt.teardown?.allOwnedExited}`);
}
const deadline = setTimeout(async () => { log('global deadline exceeded'); await teardown(); finish('global deadline exceeded'); process.exit(1); }, Math.max(1, DEADLINE_MS - 45000));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await teardown(); finish(`interrupted by ${sig}`); process.exit(130); });
let runError;
try { await main(); } catch (e) { runError = e.message; console.error('RUN ERROR:', e.message); } finally { clearTimeout(deadline); await teardown(); finish(runError); }
process.exit(receipt.overall === 'PASS' ? 0 : 1);
