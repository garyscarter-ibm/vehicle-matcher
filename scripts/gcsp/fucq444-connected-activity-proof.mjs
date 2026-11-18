#!/usr/bin/env node
// FUCQ-444 connected proof: built Angular Buddy activity -> started Java API (OIDC, repository accounts, native PG17), headless Chrome.
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
if (!process.env.TEST_RESOURCE_PARENT_RESERVATION) refuse('TEST_RESOURCE_PARENT_RESERVATION must identify the parent-admitted resource allocation');
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
const PROOF = path.join(SCRATCH, `fucq444-connected-${RUN_TOKEN}`);
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
const ENVIRONMENT_ID = `f444-connected-${RUN_TOKEN}`;
const RUN_ID = 'run-1';
const POLICY = 'gcsp-policy-v1+offer-journey-v1';
const PEOPLE = ['paula', 'alex', 'sam', 'jordan'];
const PSQL = path.resolve(process.env.PROOF_PSQL_BIN ?? '/opt/homebrew/opt/postgresql@17/bin/psql');
const MEDIA_ROOT = path.resolve(process.env.PROOF_MEDIA_ROOT ?? path.join(ROOT, 'assets/gcsp-vehicle-evidence'));
const MEDIA_FILES = ['07c269dd7f55fad0a56bbad65ae72f7c35defc5e8883a8290a82972e1defb427.webp', 'ed60cefd049e7293423575b5f0fcee802dbab14083dea2480211ab272896281a.webp',
  'bd89864616f3f34813cb66230e93f5e39d6a25168331ea47e84da60fbf31a735.webp', 'c1a3b0f2df9a6c3834cd04fc8f65455e6daa8fda9e7bf0f7a9c9e5e437ec8318.webp'];
for (const file of [PSQL, MEDIA_ROOT, JAR, WEB_BROWSER, JAVA_HOME, CHROME]) if (/CloudStorage|OneDrive/i.test(file)) refuse('An input path points into a forbidden synced folder');
if (!existsSync(PSQL)) refuse('PROOF_PSQL_BIN must name the parent-pinned native PostgreSQL 17 psql');
for (const name of MEDIA_FILES) if (!existsSync(path.join(MEDIA_ROOT, name))) refuse(`Missing parent-pinned actual media ${name}`);
if (!Number.isFinite(DEADLINE_MS) || DEADLINE_MS <= 0 || DEADLINE_MS > 600000) refuse('PROOF_DEADLINE_SEC must be in (0, 600]');
const SCHEMA = `gcsp_s_f444c_${RUN_TOKEN.replace(/-/g, '_')}`;
const dirs = { logs: path.join(PROOF, 'logs'), tmp: path.join(PROOF, 'tmp'), certs: path.join(PROOF, 'certs'), static: path.join(PROOF, 'static'), browser: path.join(PROOF, 'browser'), evidence: path.join(PROOF, 'evidence') };

const receipt = { schema: 'fucq444-connected-activity-proof/1', story: 'DEV-2026-11-13-012 / FUCQ-444', startedAt: new Date().toISOString(), deadlineSeconds: DEADLINE_MS / 1000, cleanupReserveSeconds: 45, runToken: RUN_TOKEN, origins: ORIGINS,
  localTestIssuer: `LOCAL TEST OIDC ISSUER ${ISSUER}: harness only, not the real provider`, composition: null, inputs: null, tools: {}, processes: [], scenarios: {}, originalAcceptance: null, failureLogs: {},
  limitations: [
    'The parent supplies prebuilt production web/API; input hashes do not independently establish their source revision.',
    'The issuer is local test OIDC: real code/PKCE and signed bearer/JWKS validation run, not a registered hosted provider.',
    'Public employee/presenter preparation runs only against the parent-owned throwaway native PostgreSQL 17 schema; no mocked success route or SQL offer fixture is used.',
    'Supported decline is an explicit public API preparation action; native Angular acceptance/decline command protocol is outside this Activity proof.',
    'Notification delivery is not exercised by these Activity acceptance items; this run uses the configured captured-mail behavior and claims no delivered email.',
    'Fresh isolated Chrome contexts cover desktop/narrow and private storage; Safari, hosted topology and full accessibility remain unrun.',
    'The outer supervisor owns HostBudget, manifest/finalizer, aggregate output/RSS limits and final process/listener/schema/scratch audit.'
  ] };
receipt.plannedScenarios = ['a', 'b', 'c', 'd', 'e', 'f'];
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
const SUPERVISOR_MARKERS = ['F444_LOCAL_TOKEN', 'TEST_RESOURCE_PARENT_RESERVATION', 'PROOF_RUN_TOKEN'];
function childEnv(env) {
  const markers = Object.fromEntries(SUPERVISOR_MARKERS.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
  return { ...env, ...markers, TMPDIR: dirs.tmp, TMP: dirs.tmp, TEMP: dirs.tmp };
}
function spawnOwned(name, cmd, args, env, portNumber = null) {
  const logFile = path.join(dirs.logs, `${name}.log`); const out = createWriteStream(logFile);
  const child = spawn(cmd, args, { cwd: ROOT, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let logBytes = 0;
  const capture = (chunk) => { if (logBytes < 262144) { const kept = chunk.subarray(0, 262144 - logBytes); out.write(kept); logBytes += kept.length; } };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
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

// ---------- local test OIDC issuer (as fucq435, four employee subjects) ----------
const idp = { codes: new Map(), txns: new Map(), subjects: { ...Object.fromEntries(PEOPLE.map((person) => [`sub-${person}`, ['employee']])), 'sub-presenter': ['presenter'] }, keys: null, server: null };
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
    GCSP_OIDC_ACCOUNTS: JSON.stringify([...PEOPLE.map((person) => ({ subject: `sub-${person}`, roles: ['employee'], employeeId: `employee-${person}` })), { subject: 'sub-presenter', roles: ['presenter'] }]),
    GCSP_ENVIRONMENT_ID: ENVIRONMENT_ID, GCSP_RUN_ID: RUN_ID, GCSP_POLICY_VERSION: POLICY,
    GCSP_ACCOUNT_PROVIDER: 'repository', GCSP_SCENARIO_PROVIDER: 'demo', GCSP_ORDERING_PROVIDER: 'synthetic', GCSP_RESET_ALLOWED: 'true',
    GCSP_SUPPLY_PROVIDER: 'demo', GCSP_ALLOCATION_CANDIDATES_PROVIDER: 'recommendation', GCSP_CLAIM_STOCK_PROVIDER: 'local',
    GCSP_PUBLIC_BASE_URL: process.env.PROOF_PUBLIC_BASE_URL ?? `https://localhost:${PORTS.web}`,
    GCSP_DATABASE_URL: DB_URL, GCSP_DATABASE_USER: process.env.PROOF_DB_USER ?? 'gcsp', GCSP_EXPECTED_DATABASE: DB_NAME };
}
let api = null; let apiStarts = 0;
async function startApi() {
  apiStarts++;
  const name = `api-${apiStarts}`;
  const props = ['-Xmx768m', `-Dquarkus.datasource.jdbc.additional-jdbc-properties.currentSchema=${SCHEMA}`, `-Dquarkus.flyway.schemas=${SCHEMA}`, `-Dquarkus.flyway.default-schema=${SCHEMA}`];
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

// ---------- direct HTTPS preparation commands and server-truth reads ----------
function request(method, p, headers = {}, body = null) {
  const u = new URL(ORIGINS.api);
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port: Number(u.port), path: `${API_PATH}${p}`, method, servername: u.hostname, headers: { Host: u.host, Accept: 'application/json', ...headers }, ca: tls.ca, timeout: 15000 }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* not json */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('timeout', () => req.destroy(new Error('request timeout'))); req.on('error', reject); req.end(body === null ? undefined : JSON.stringify(body));
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
// Public setup uses the same employee/presenter authorization as the browser; no business rows are fabricated.
let commandSequence = 0;
const commandId = (label) => `f444-${RUN_TOKEN}-${label}-${++commandSequence}`;
const authHeaders = (person = 'paula', role = 'employee') => ({ Authorization: `Bearer ${signJwt(accessClaims(`sub-${person}`, [role]), idp.keys.privateKey)}`, 'Content-Type': 'application/json' });
async function apiValue(method, suffix, body = null, person = 'paula', role = 'employee', allowed = [200]) {
  const r = await request(method, suffix, authHeaders(person, role), body);
  if (!allowed.includes(r.status) || r.json?.status !== 'ok') throw new Error(`${method} ${suffix}: ${r.status} ${r.json?.code ?? r.json?.status ?? 'no envelope'}`);
  return r.json.value;
}
async function editor(person = 'paula') { return (await apiValue('GET', '/brief/editor', null, person)).initial; }
async function prepareBrief(person, noMatch = false) {
  const initial = await editor(person);
  const brief = structuredClone(initial.brief);
  for (const p of Object.values(brief.preferences)) {
    p.valueState = 'confirmed'; p.importanceState = 'confirmed'; p.source = 'employee';
  }
  for (const key of ['body', 'comfort', 'economy']) {
    if (!brief.preferences[key]) throw new Error(`Editor has no registered ${key} preference`);
    brief.preferences[key].importance = 75;
  }
  brief.preferences.body.value = 'estate';
  brief.preferences.comfort.value = 70; brief.preferences.economy.value = 60;
  // No MPV exists in the configured demo supply; the actual allocator must still prove the outcome.
  brief.essentials = noMatch ? { body: { operator: 'equals', value: 'mpv', unit: null, state: 'confirmed', source: 'employee' } } : {};
  if (brief.currentCarFeedback) { brief.currentCarFeedback.state = 'confirmed'; brief.currentCarFeedback.source = 'employee'; }
  await apiValue('POST', '/brief/draft', { commandId: commandId(`draft-${person}`), expectedBriefVersion: initial.briefVersion, expectedDraftVersion: initial.draftVersion, brief }, person);
  const saved = await editor(person);
  await apiValue('POST', '/brief/confirm', { commandId: commandId(`confirm-${person}`), expectedBriefVersion: saved.briefVersion, expectedDraftVersion: saved.draftVersion, consent: { search: true, hold: true } }, person);
  const current = await editor(person);
  if (current.buddy?.state !== 'engaged') throw new Error(`${person}: real brief setup did not engage Buddy`);
  receipt.preparation ??= []; receipt.preparation.push({ person, noMatch, briefVersion: current.briefVersion, draftVersion: current.draftVersion, buddy: current.buddy.state });
}
async function clock() { return apiValue('GET', '/presenter/clock', null, 'presenter', 'presenter'); }
async function tick(label, { nextRelease = false, tolerateUnavailable = false } = {}) {
  const c = await clock(); const id = commandId(label);
  const suffix = nextRelease ? '/presenter/controls/tick' : '/presenter/clock/tick';
  const body = nextRelease ? { commandId: id, expectedClockVersion: c.clockVersion, mode: 'next-release' } : { tickId: id, expectedClockVersion: c.clockVersion };
  const r = await request('POST', suffix, authHeaders('presenter', 'presenter'), body);
  receipt.preparation ??= []; receipt.preparation.push({ operation: label, suffix, status: r.status, result: r.json });
  const state = nextRelease ? r.json?.value?.tick?.state : r.json?.value?.state;
  if (!tolerateUnavailable && (r.status !== 200 || r.json?.status !== 'ok' || state !== 'completed')) throw new Error(`Presenter tick ${label} did not complete: ${r.status} ${r.json?.code ?? state}`);
  return r;
}
async function activity(person = 'paula') { return apiValue('GET', '/activity', null, person); }
async function offer(id, person = 'paula') { return apiValue('GET', `/offers/${encodeURIComponent(id)}`, null, person); }
const compactOffer = (v) => v ? { offerId: v.offerId, runId: v.runId, state: v.state, reason: v.reason, offerVersion: v.offerVersion, holdVersion: v.holdVersion,
  serverNow: v.serverNow, clockVersion: v.clockVersion, expiresAt: v.expiresAt, availableActions: v.availableActions, followup: v.followup,
  quote: v.quote ? { quoteId: v.quote.quoteId, quoteVersion: v.quote.quoteVersion, orderNumber: v.quote.orderNumber,
    briefVersion: v.quote.briefVersion, policyVersion: v.quote.policyVersion, name: v.quote.facts?.display?.name } : null } : null;
const compactActivity = (v) => v ? { runId: v.runId, employeeId: v.employeeId, asOf: v.asOf, clockVersion: v.clockVersion, briefVersion: v.briefVersion,
  state: v.state, permission: v.permission, sourceStatus: v.sourceStatus, searchEvidence: v.searchEvidence, lastSuccessfulCheck: v.lastSuccessfulCheck,
  currentOffer: v.currentOffer, offers: v.offers, stateChanges: v.stateChanges } : null;

// ---------- own headless Chrome: actual API response capture, no business interception ----------
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else this.listeners.forEach((f) => f(m)); }); }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', () => j(new Error('CDP websocket failed'))); }); return new Cdp(ws); }
  send(method, params = {}, sessionId) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
}
const hdr = (h = {}, name) => Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1];
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
function requestSummary(b) {
  if (!b || typeof b !== 'object') return null;
  return { commandId: typeof b.commandId === 'string', orderUuid: b.orderUuid,
    carriesIdentity: /"(employeeId|runId|environmentId|principalId|subject)"/.test(JSON.stringify(b)) };
}
const responseSummary = (body) => !body || body.status !== 'ok' ? body : { status: body.status, value: body.value?.offerId ? compactOffer(body.value) : body.value?.searchEvidence ? compactActivity(body.value) : body.value };
class Page {
  constructor(cdp, sessionId, ctxId, label) { this.cdp = cdp; this.sid = sessionId; this.ctxId = ctxId; this.label = label; this.log = []; this.byId = new Map(); this.waits = []; this.mainFrame = null; this.mainLoader = null; this.docs = 0; this.errors = []; cdp.listeners.push((m) => m.sessionId === sessionId && this.event(m)); }
  send(method, params) { return this.cdp.send(method, params, this.sid); }
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
// DOM selectors follow the production Activity and offer screens; no Angular internals or component state are read.
const HELPERS = `
const main = document.querySelector('#gcsp-main') ?? document;
const $ = (s) => main.querySelector(s);
const button = (label) => [...main.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const press = (label) => { const b = button(label); if (!b || b.disabled) return false; b.click(); return true; };
const text = () => main.innerText.replace(/\\s+/g, ' ').trim();
const link = (label) => [...main.querySelectorAll('a')].find((a) => a.textContent.trim() === label);
`;
async function newPage(cdp, label) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, sessionId, browserContextId, label);
  await page.send('Page.enable');
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__f444Csp = []; addEventListener('securitypolicyviolation', (e) => window.__f444Csp.push({ directive: e.violatedDirective, blocked: e.blockedURI }));` });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true }); await page.send('Network.enable'); await page.send('Network.setCacheDisabled', { cacheDisabled: true }); await page.send('Runtime.enable');
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
  // DOM readiness can precede the asynchronous CDP body capture. Require this document's own body.
  const bodyDeadline = Date.now() + 5000;
  while (!read.failed && read.response === undefined && Date.now() < bodyDeadline) { await sleep(100); await page.settle(); }
  if (!read.failed && read.response === undefined) throw new Error(`${page.label}: ${readPath} response body was not captured for ${what}`);
  return read;
}
const ACTIVITY_READY = `return !!$('.activity-page') && !$('.activity-page[aria-busy="true"]') && !/Loading activity|Loading your Buddy/.test(text());`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function openActivity(page, how = `${ORIGINS.web}/gcsp/activity`) {
  return freshDocument(page, how, { ready: ACTIVITY_READY, readPath: '/activity', what: 'current Buddy activity' });
}
async function screen(page) {
  return page.act(`return { text: text(), badge: $('.activity-badge')?.textContent.trim(), offerState: $('.activity-offer-state')?.textContent.trim() ?? null,
    deadline: $('.activity-offer-deadline')?.textContent.trim() ?? null, offerHref: link('View offer')?.getAttribute('href') ?? null,
    controls: [...main.querySelectorAll('button')].filter((b) => !b.disabled).map((b) => b.textContent.trim()),
    image: $('.activity-offer img') ? { src: $('.activity-offer img').getAttribute('src'), complete: $('.activity-offer img').complete, width: $('.activity-offer img').naturalWidth } : null,
    overflow: document.documentElement.scrollWidth > innerWidth + 1, focus: { tag: document.activeElement?.tagName, text: document.activeElement?.textContent.trim().slice(0,100), outline: getComputedStyle(document.activeElement).outlineStyle } };`);
}
async function enterKey(page) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
}
async function tabTo(page, label) {
  for (let n = 0; n < 45; n++) {
    if (await page.eval(`document.activeElement?.textContent.trim() === ${JSON.stringify(label)}`)) return;
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  }
  throw new Error(`${page.label}: keyboard could not reach ${label}`);
}
async function inspect(s, page, name, { narrow = true } = {}) {
  const wide = await screen(page); s.checks[`${name}DesktopNoOverflow`] = !wide.overflow;
  const captures = [{ path: await page.shot(`${name}-desktop.png`), width: 1440, height: 1000 }];
  if (narrow) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    await sleep(100); const small = await screen(page); s.checks[`${name}NarrowNoOverflow`] = !small.overflow;
    captures.push({ path: await page.shot(`${name}-narrow.png`), width: 375, height: 812 });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  }
  s.observations[name] = { screen: wide, captures: captures.map((c) => ({ ...c, sha256: sha256File(c.path), bytes: statSync(c.path).size })) };
}
async function compareCurrent(s, page, name, person = 'paula') {
  const raw = await activity(person); const current = raw.currentOffer;
  const display = current ? await offer(current.offerRef.offerId, person) : null;
  const shown = await screen(page);
  const captured = page.calls().filter((c) => c.method === 'GET' && c.path === '/activity' && c.status === 200 && c.response).at(-1)?.response.value;
  s.checks[`${name}ActivityReadMatchesApi`] = !!captured && same(compactActivity(captured), compactActivity(raw));
  if (current) {
    const labels = { active: 'Waiting for you', pending: 'Waiting for you', accepted: 'Accepted', declined: 'Declined', rejected: 'Declined', expired: 'Expired',
      'decision-pending': 'Being processed', 'release-pending': 'Being processed', superseded: 'Offer replaced', released: 'Released' };
    s.checks[`${name}ExactOfferLink`] = shown.offerHref === `/gcsp/offers/${encodeURIComponent(current.offerRef.offerId)}` || decodeURIComponent(shown.offerHref ?? '') === `/gcsp/offers/${current.offerRef.offerId}`;
    s.checks[`${name}OwnedDisplayIsCurrent`] = display.offerId === current.offerRef.offerId && shown.offerState === labels[display.state];
    if (['expired', 'declined', 'accepted', 'superseded', 'released'].includes(display.state)) s.checks[`${name}TerminalHasNoDeadline`] = shown.deadline === null;
  }
  s.observations[name] = { raw: compactActivity(raw), display: compactOffer(display), shown };
  return { raw, display, shown };
}
async function scenario(id, title, ac, fn) {
  const s = { title, ac, pass: false, checks: {}, observations: {} }; receipt.scenarios[id] = s; log(`scenario ${id}: ${title}`);
  try { await fn(s); } catch (e) { s.error = e.message; s.checks.noException = false; }
  s.pass = Object.keys(s.checks).length > 0 && Object.values(s.checks).every((v) => v === true);
  log(`scenario ${id}: ${s.pass ? 'PASS' : 'FAIL'}${s.error ? ` (${s.error.slice(0,220)})` : ''}`);
  writeFileSync(path.join(dirs.evidence, 'checkpoint.json'), `${JSON.stringify({ completedAt: new Date().toISOString(), sourceRevision: SOURCE_REVISION, scenarios: receipt.scenarios }, null, 2)}\n`);
  if (!s.pass) throw new Error(`Stopped at failed activity scenario ${id}: ${s.error ?? Object.entries(s.checks).filter(([,v]) => !v).map(([k]) => k).join(', ')}`);
}
async function searching(cdp, s, pages) {
  await prepareBrief('paula', true);
  pages.one = await newPage(cdp, 'paula'); await signIn(pages.one);
  const read = await openActivity(pages.one); const truth = await activity();
  s.checks.actualEmployeeRead = read.status === 200 && truth.employeeId === EMPLOYEE && truth.permission?.canSearch === true;
  s.checks.searchingDoesNotInventAMatch = !truth.currentOffer && await pages.one.act(`return text().includes('Buddy engaged') && /Not searched yet|Still searching/.test(text()) && !link('View offer');`);
  await compareCurrent(s, pages.one, 'searching'); await inspect(s, pages.one, 'a-searching');
}
async function noMatch(s, pages) {
  await tick('first-release', { nextRelease: true });
  await openActivity(pages.one, 'reload');
  const { raw } = await compareCurrent(s, pages.one, 'noMatch');
  s.checks.allocatorRecordedNoMatch = raw.sourceStatus === 'ok' && raw.lastSuccessfulCheck?.outcome === 'no-match' && raw.lastSuccessfulCheck.carsChecked > 0 && raw.lastSuccessfulCheck.suitableCars === 0 && !raw.currentOffer;
  s.checks.groundedNoMatchAndNextActions = await pages.one.act(`return text().includes('Still searching. No match yet.') && text().includes('No released car has an MPV body.') && !!button('Keep searching') && !!link('Review your preferences');`);
  const before = pages.one.log.length; const truth = await activity();
  await tabTo(pages.one, 'Keep searching'); s.checks.keyboardHasVisibleFocus = await pages.one.eval(`getComputedStyle(document.activeElement).outlineStyle !== 'none'`);
  await enterKey(pages.one); await pages.one.until(`return text().includes('Buddy will keep searching with your preferences as they are.');`, 5000, 'keep-searching acknowledgement');
  await pages.one.settle(); s.checks.keepSearchingDoesNotWrite = pages.one.calls(before).every((c) => c.method === 'GET') && same(await activity(), truth);
  await inspect(s, pages.one, 'b-no-match');
}
async function live(cdp, s, pages) {
  await prepareBrief('paula'); await prepareBrief('alex'); await tick('eligible-briefs');
  await openActivity(pages.one, 'reload');
  const state = await compareCurrent(s, pages.one, 'live');
  s.checks.actualHeldOffer = state.raw.currentOffer?.state === 'active' && state.display?.state === 'pending' && state.display.availableActions.includes('decline');
  s.checks.deadlineFromBackend = !!state.shown.deadline && Number.isFinite(Date.parse(state.raw.currentOffer?.expiresAt));
  pages.paulaId = state.raw.currentOffer.offerRef.offerId;
  pages.alex = await newPage(cdp, 'alex'); await signIn(pages.alex, 'alex'); await openActivity(pages.alex);
  const alex = await activity('alex'); pages.alexId = alex.currentOffer?.offerRef.offerId;
  s.checks.separateOwnedOffer = !!pages.alexId && pages.alexId !== pages.paulaId;
  const before = pages.one.log.length; const held = await offer(pages.paulaId); await sleep(1250); const after = await offer(pages.paulaId);
  s.checks.displayTimeHasNoAuthority = held.state === after.state && held.offerVersion === after.offerVersion && held.holdVersion === after.holdVersion && pages.one.calls(before).every((c) => c.method === 'GET');
  await tabTo(pages.one, 'Disengage Buddy'); await enterKey(pages.one);
  await pages.one.until(`return text().includes('Buddy disengaged') && !!button('Engage Buddy');`, 15000, 'confirmed disengage'); await pages.one.settle();
  const disengaged = await activity(); s.checks.disengageConfirmedByJava = disengaged.permission?.canSearch === false && disengaged.permission?.canHold === false && disengaged.currentOffer?.offerRef.offerId === pages.paulaId;
  s.checks.disengageRetainsHeldOffer = (await offer(pages.paulaId)).state === 'pending' && await pages.one.act(`return text().includes('Your offer is still open. View it to accept or decline.');`);
  await tabTo(pages.one, 'Engage Buddy'); await enterKey(pages.one);
  await pages.one.until(`return text().includes('Buddy engaged') && !!button('Disengage Buddy');`, 15000, 'confirmed engage'); await pages.one.settle();
  s.checks.reengageConfirmedByJava = (await activity()).permission?.canSearch === true;
  await compareCurrent(s, pages.one, 'liveAfterEngage'); await inspect(s, pages.one, 'c-live-offer');
}
async function terminalFollowup(s, pages) {
  const current = await offer(pages.paulaId); const reasons = await apiValue('GET', `/offers/${encodeURIComponent(pages.paulaId)}/decision-reasons`);
  const reason = reasons.reasons?.find((r) => r.code === 'body-style') ?? reasons.reasons?.[0];
  if (!reason?.code) throw new Error('Actual decision reason registry is empty');
  const decision = await apiValue('POST', `/offers/${encodeURIComponent(pages.paulaId)}/decision`, { commandId: commandId('decline'), decision: 'decline',
    expectedOfferVersion: current.offerVersion, expectedHoldVersion: current.holdVersion, reasonCode: reason.code });
  s.checks.supportedDeclineIsTerminal = decision.state === 'declined' && !!decision.decisionId;
  const followup = await apiValue('GET', `/offer-followup?decisionId=${encodeURIComponent(decision.decisionId)}`);
  s.checks.realFollowupQuestion = followup.state === 'question' && followup.decisionId === decision.decisionId && !!followup.question?.prompt;
  await openActivity(pages.one, 'reload'); await compareCurrent(s, pages.one, 'declinedReload');
  await inspect(s, pages.one, 'd-declined');
  const before = pages.one.log.length;
  await tabTo(pages.one, 'View offer'); await enterKey(pages.one);
  await pages.one.until(`return location.pathname.includes('/offers/') && !!$('gcsp-offer-followup .followup legend');`, 15000, 'real declined offer follow-up'); await pages.one.settle();
  s.checks.followupPromptFromApi = await pages.one.act(`return $('gcsp-offer-followup legend')?.textContent.trim() === ${JSON.stringify(followup.question.prompt)};`);
  s.checks.terminalDoesNotRegainDecisions = (await offer(pages.paulaId)).availableActions.length === 0;
  s.observations.followup = { reasonCode: reason.code, decisionId: decision.decisionId, state: followup.state, question: followup.question };
  await inspect(s, pages.one, 'd-terminal-followup');
  await pages.one.eval(`history.back()`);
  await pages.one.until(ACTIVITY_READY, 15000, 'return navigation to activity'); await pages.one.settle();
  const returned = await compareCurrent(s, pages.one, 'declinedReturn');
  s.checks.returnKeepsTerminalOffer = returned.raw.currentOffer?.offerRef.offerId === pages.paulaId && returned.display?.state === 'declined';
  s.checks.readNavigationNeverReplaysDecision = pages.one.calls(before).every((c) => c.method === 'GET');
}
async function expiry(s, pages) {
  const active = await offer(pages.alexId, 'alex'); const c = await clock();
  const deadline = active.expiresAt ?? (await activity('alex')).currentOffer?.expiresAt;
  if (!Number.isFinite(Date.parse(deadline))) throw new Error('Owned Alex offer has no authoritative deadline');
  const bySeconds = Math.max(1, Math.ceil((Date.parse(deadline) - Date.parse(c.now)) / 1000) + 60);
  await apiValue('POST', '/presenter/clock/advance', { commandId: commandId('expiry'), expectedClockVersion: c.clockVersion, bySeconds }, 'presenter', 'presenter');
  // No tick runs: the durable row stays active while the owned read applies the actual backend clock.
  await openActivity(pages.alex, 'reload');
  const state = await compareCurrent(s, pages.alex, 'expiredReload', 'alex');
  s.checks.rawActiveAndBackendExpired = state.raw.currentOffer?.state === 'active' && state.display?.state === 'expired' && state.display.availableActions.length === 0;
  s.checks.expiryPresentationUsesServerRead = state.shown.offerState === 'Expired' && !state.shown.deadline;
  const before = pages.alex.log.length;
  await pages.alex.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/account` }); await pages.alex.until(`return location.pathname === '/gcsp/account' && !!$('.account-screen');`, 15000, 'account navigation');
  await pages.alex.eval(`history.back()`);
  await pages.alex.until(ACTIVITY_READY, 15000, 'return to expired activity'); await pages.alex.settle();
  await compareCurrent(s, pages.alex, 'expiredReturn', 'alex');
  s.checks.noTimerOrReturnMutation = pages.alex.calls(before).every((call) => call.method === 'GET');
  await inspect(s, pages.alex, 'e-expired');
}
async function unavailable(s, pages) {
  await apiValue('POST', '/presenter/scenarios/faults', { commandId: commandId('stock-fault'), adapter: 'stock', mode: 'unavailable' }, 'presenter', 'presenter');
  const result = await tick('unavailable-source', { tolerateUnavailable: true });
  await openActivity(pages.alex, 'reload'); const state = await compareCurrent(s, pages.alex, 'sourceUnavailable', 'alex');
  s.checks.actualSourceFailure = state.raw.sourceStatus === 'unavailable' && result.json?.value?.state !== 'completed';
  s.checks.truthfulUnavailableCopy = await pages.alex.act(`return text().includes("Couldn't check for new cars. Stock source unavailable.") && !!button('Refresh activity');`);
  await inspect(s, pages.alex, 'f-source-unavailable');
  const allowed = new Set(['/brief/disengage', '/brief/engage']);
  s.checks.onlyExplicitScopedBrowserCommands = [pages.one, pages.alex].every((p) => p.calls().every((call) => call.method === 'GET' || call.method === 'POST' && allowed.has(call.path)));
  s.checks.bearerEmployeeReads = [pages.one, pages.alex].every((p) => p.calls().every((call) => call.auth && !/[?&](employeeId|subject|principalId)=/.test(call.query)));
  s.checks.noBrowserExceptions = pages.one.errors.length === 0 && pages.alex.errors.length === 0;
  s.observations.csp = { paula: await pages.one.eval('window.__f444Csp ?? []'), alex: await pages.alex.eval('window.__f444Csp ?? []') };
  s.checks.noCspViolations = s.observations.csp.paula.length === 0 && s.observations.csp.alex.length === 0;
  s.checks.reducedMotion = await pages.alex.eval(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
  s.observations.browserErrors = { paula: pages.one.errors, alex: pages.alex.errors };
}

// ---------- main ----------
function accessLog() {
  const rows = [];
  for (const p of receipt.processes.filter((x) => x.name.startsWith('api-'))) {
    for (const l of tail(path.join(dirs.logs, `${p.name}.log`), 100000).split('\n')) { const m = /ACCESSLOG (\S+) (\S+) (\d+)/.exec(l); if (m && (/\/(activity|offers|brief|presenter|context)/.test(m[2]))) rows.push(`${p.name} ${m[1]} ${m[2].replace(API_PATH, '')} ${m[3]}`); }
  }
  return rows.slice(-80);
}
async function main() {
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  for (const [k, p] of Object.entries(PORTS)) if (!(await portFree(p))) throw new Error(`port ${p} (${k}) is in use; choose PROOF_${k.toUpperCase()}_PORT`);
  receipt.inputs = { scratch: PROOF, database: { source: DB_SOURCE, host: DB[1], port: DB[2] ?? '5432', name: DB_NAME, schema: SCHEMA }, ports: PORTS, jar: { path: path.relative(ROOT, JAR), sha256: sha256File(JAR) },
    appJars: readdirSync(path.join(path.dirname(JAR), 'app')).filter((f) => f.endsWith('.jar')).map((f) => ({ file: f, sha256: sha256File(path.join(path.dirname(JAR), 'app', f)) })), psql: { path: PSQL, sha256: sha256File(PSQL), version: cap(PSQL, ['--version']) }, media: MEDIA_FILES.map((name) => ({ name, sha256: sha256File(path.join(MEDIA_ROOT, name)) })), webBrowser: { path: path.relative(ROOT, WEB_BROWSER), indexSha256: sha256File(path.join(WEB_BROWSER, 'index.html')) } };
  if (!/PostgreSQL\) 17\./.test(receipt.inputs.psql.version)) throw new Error('Proof requires parent-pinned native PostgreSQL 17 psql');
  receipt.composition = { identity: 'oidc (local test issuer)', subjects: PEOPLE.map((p) => ({ subject: `sub-${p}`, employeeId: `employee-${p}` })), account: 'repository', scenario: 'demo', ordering: 'synthetic', resetAllowed: true, environmentId: ENVIRONMENT_ID, runId: RUN_ID, policyVersion: POLICY, supply: 'demo', candidates: 'recommendation', claims: 'local', mirrors: 'existing demo preparation, supply windows and public employee/presenter commands' };
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
  log('public setup and release will run within the selected scenarios');
  const profile = path.join(dirs.browser, 'profile'); mkdirSync(profile, { recursive: true });
  const chrome = spawnOwned('chrome', CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-allow-origins=*', `--ignore-certificate-errors-spki-list=${tls.spki}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--window-size=1280,900', 'about:blank'], { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp });
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) { if (chrome.done) throw new Error('Chrome exited during startup'); try { const [p, ws] = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n'); wsUrl = `ws://127.0.0.1:${p}${ws}`; } catch { await sleep(250); } }
  if (!wsUrl) throw new Error('Chrome DevTools endpoint not found');
  const cdp = await Cdp.connect(wsUrl); receipt.cdp = cdp;
  const pages = {};
  await scenario('a', 'Signed-in employee sees actual searching state before evaluation', 'AC1', (s) => searching(cdp, s, pages));
  await scenario('b', 'Real release produces grounded no-match and keyboard follow-up', 'AC1', (s) => noMatch(s, pages));
  await scenario('c', 'Real allocation produces exact live offers and versioned Buddy controls', 'AC1', (s) => live(cdp, s, pages));
  await scenario('d', 'Supported decline, real follow-up and terminal reload/navigation', 'AC1+AC2', (s) => terminalFollowup(s, pages));
  await scenario('e', 'Backend clock expiry overrides raw active row without a client timer command', 'AC1+AC2', (s) => expiry(s, pages));
  await scenario('f', 'Presenter stock fault produces truthful source-unavailable activity', 'AC1', (s) => unavailable(s, pages));

}
async function teardown() {
  receipt.schemaLeftForParent = SCHEMA;
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
  receipt.unrunScenarios = receipt.plannedScenarios.filter((id) => !sc[id]);
  if (runError) receipt.runError = runError;
  try { receipt.apiAccessLog = accessLog(); } catch { /* no log */ }
  receipt.originalAcceptance = {
    AC1: { text: 'Searching, no match, unavailable, live hold/offer, expiry and supported follow-up reflect actual backend state.', scenarios: ['a','b','c','d','e','f'], evidence: ['a','b','c','d','e','f'].every(ok) ? 'pass' : 'fail', closure: 'OPEN: parent review and covering batch decide' },
    AC2: { text: 'Reload and returning navigation show current activity and relevant next actions without reviving a terminal offer.', scenarios: ['d','e'], evidence: ok('d') && ok('e') ? 'pass' : 'fail', closure: 'OPEN: parent review and covering batch decide' } };
  receipt.overall = ['a','b','c','d','e','f'].every(ok) && !runError && receipt.teardown?.allOwnedExited ? 'PASS' : 'FAIL';
  const file = path.join(dirs.evidence, 'connected-activity-proof.json');
  try { writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`); } catch (e) { console.error('receipt write failed', e.message); }
  for (const k of Object.keys(sc).sort()) console.log(`  ${k}: ${sc[k].pass ? 'PASS' : 'FAIL'} ${sc[k].title}${sc[k].pass ? '' : ` [failed: ${Object.entries(sc[k].checks).filter(([, v]) => v !== true).map(([n]) => n).join(', ')}]`}`);
  console.log(`overall ${receipt.overall}; receipt ${file}; all owned processes exited: ${receipt.teardown?.allOwnedExited}`);
}
const deadline = setTimeout(async () => { log('global deadline exceeded'); await teardown(); finish('global deadline exceeded'); process.exit(1); }, Math.max(1, DEADLINE_MS - 45000));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await teardown(); finish(`interrupted by ${sig}`); process.exit(130); });
let runError;
try { await main(); } catch (e) { runError = e.message; console.error('RUN ERROR:', e.message); } finally { clearTimeout(deadline); await teardown(); finish(runError); }
process.exit(receipt.overall === 'PASS' ? 0 : 1);
