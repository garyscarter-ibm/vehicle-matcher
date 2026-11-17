#!/usr/bin/env node
// FUCQ-441 connected proof: built Angular preferences -> started Java API (OIDC, repository accounts, native PG17), headless Chrome.
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
if (SCRATCH === ROOT || SCRATCH.startsWith(`${ROOT}${path.sep}`)) refuse('SCRATCH must be outside the repository');
if (!existsSync(SCRATCH) || !statSync(SCRATCH).isDirectory()) refuse('SCRATCH must be an existing directory owned by the parent run');
const RUN_TOKEN = process.env.PROOF_RUN_TOKEN ?? '';
if (!/^[a-z0-9][a-z0-9-]{5,39}$/.test(RUN_TOKEN)) refuse('PROOF_RUN_TOKEN must be the parent run token ([a-z0-9-], 6-40 characters)');
const DB_SOURCE = process.env.GCSP_TEST_DATABASE_URL ? 'GCSP_TEST_DATABASE_URL' : process.env.GCSP_TEST_RUNNING_DATABASE_URL ? 'GCSP_TEST_RUNNING_DATABASE_URL' : null;
if (!DB_SOURCE) refuse('GCSP_TEST_DATABASE_URL (or GCSP_TEST_RUNNING_DATABASE_URL) is not set; supply an owned throwaway PostgreSQL 17 database');
const DB_URL = process.env[DB_SOURCE];
const DB = /^jdbc:postgresql:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?\/([A-Za-z0-9_]+)(?:\?.*)?$/.exec(DB_URL);
if (!DB) refuse(`${DB_SOURCE} must be a jdbc:postgresql URL on localhost naming one database; hosted databases are never used`);
const DB_NAME = DB[3];
const PROOF = path.join(SCRATCH, `fucq441-connected-${RUN_TOKEN}`);
if (existsSync(PROOF)) refuse(`${PROOF} already exists; each run needs a fresh token`);
const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const JAR = path.resolve(process.env.PROOF_API_JAR ?? path.join(ROOT, 'services/gcsp-api/target/quarkus-app/quarkus-run.jar'));
const WEB_BROWSER = path.resolve(process.env.PROOF_WEB_BROWSER ?? path.join(ROOT, 'apps/gcsp-web/dist/gcsp-web/browser'));
for (const [label, file] of [['API jar (prebuilt)', JAR], ['compiled web index (prebuilt)', path.join(WEB_BROWSER, 'index.html')], ['java', path.join(JAVA_HOME, 'bin/java')], ['keytool', path.join(JAVA_HOME, 'bin/keytool')], ['Chrome', CHROME]]) {
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
// Mirrors BriefJourneyProfiles.config(): Paula is seeded by the demo preparation; run-1 is EnvironmentGuard.FIRST_RUN_ID.
const SUBJECT = 'sub-paula';
const EMPLOYEE = 'employee-paula';
const ENVIRONMENT_ID = `f441-connected-${RUN_TOKEN}`;
const RUN_ID = 'run-1';
const POLICY = 'gcsp-policy-v1';
const SCHEMA = `gcsp_s_f441c_${RUN_TOKEN.replace(/-/g, '_')}`;
const dirs = { logs: path.join(PROOF, 'logs'), tmp: path.join(PROOF, 'tmp'), certs: path.join(PROOF, 'certs'), static: path.join(PROOF, 'static'), browser: path.join(PROOF, 'browser'), evidence: path.join(PROOF, 'evidence') };

const receipt = { schema: 'fucq441-connected-preferences-proof/1', story: 'DEV-2026-11-13-009 / FUCQ-441', startedAt: new Date().toISOString(), runToken: RUN_TOKEN, origins: ORIGINS,
  localTestIssuer: `LOCAL TEST OIDC ISSUER ${ISSUER}: harness only, not the real provider`, composition: null, inputs: null, tools: {}, processes: [], scenarios: {}, originalAcceptance: null, failureLogs: {},
  limitations: [
    'The jar and compiled web are prebuilt by the parent; hashes are recorded but this script cannot prove they were built from the recorded HEAD.',
    'Unavailable is a stopped API process (browser network failure), not a 503 body from a running server; Java 503 bodies are covered by the A35 goldens.',
    'The per-run schema override mirrors BriefJourneyProfiles and is passed as JVM system properties; the database itself is the parent\'s throwaway PG17.',
    'Direct API reads use a token this harness signs for the same subject, verified by the same OIDC configuration; they only GET.'] };
const owned = [];
let finished = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256b64u = (s) => createHash('sha256').update(s).digest('base64url');
const sha256File = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const tail = (file, n = 40) => { try { return readFileSync(file, 'utf8').split('\n').slice(-n).join('\n'); } catch { return ''; } };
const cap = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 60000, ...opts }).trim();

// ---------- owned child processes ----------
function killGroup(child, sig) { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* gone */ } } }
function spawnOwned(name, cmd, args, env, portNumber = null) {
  const logFile = path.join(dirs.logs, `${name}.log`); const out = createWriteStream(logFile);
  const child = spawn(cmd, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.stdout.pipe(out); child.stderr.pipe(out);
  const record = { name, pid: child.pid, port: portNumber, startedAt: new Date().toISOString(), exit: null };
  receipt.processes.push(record);
  child.logFile = logFile;
  child.exited = new Promise((r) => child.on('exit', (code, signal) => { child.done = true; record.exit = code ?? signal; record.endedAt = new Date().toISOString(); r(code); }));
  child.stop = async () => { if (child.done) return; killGroup(child, 'SIGTERM'); await Promise.race([child.exited, sleep(10000)]); if (!child.done) { killGroup(child, 'SIGKILL'); await Promise.race([child.exited, sleep(5000)]); } };
  owned.push(child);
  return child;
}
function runOnce(name, cmd, args, env, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawnOwned(name, cmd, args, env);
    const timer = setTimeout(() => { killGroup(child, 'SIGKILL'); reject(new Error(`${name} timed out`)); }, timeout);
    child.exited.then((code) => { clearTimeout(timer); if (code === 0) resolve(); else { receipt.failureLogs[name] = tail(child.logFile); reject(new Error(`${name} exited ${code}`)); } });
  });
}
const portFree = (p) => new Promise((r) => { const s = net.createServer(); s.once('error', () => r(false)); s.listen(p, '127.0.0.1', () => s.close(() => r(true))); });

// ---------- certificates (as fucq435) ----------
function makeCerts() {
  const c = (f) => path.join(dirs.certs, f);
  const ssl = (args, opts) => execFileSync('openssl', args, { cwd: dirs.certs, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, ...opts });
  ssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', c('ca.key')]);
  ssl(['req', '-x509', '-new', '-key', c('ca.key'), '-sha256', '-days', '3', '-subj', '/CN=GCSP local proof CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', c('ca.pem')]);
  ssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', c('leaf.key')]);
  ssl(['req', '-new', '-key', c('leaf.key'), '-subj', '/CN=gcsp-web.localhost', '-out', c('leaf.csr')]);
  writeFileSync(c('leaf.ext'), 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:gcsp-web.localhost,DNS:gcsp-api.localhost,DNS:gcsp-idp.localhost,DNS:localhost,IP:127.0.0.1\n');
  ssl(['x509', '-req', '-in', c('leaf.csr'), '-CA', c('ca.pem'), '-CAkey', c('ca.key'), '-CAcreateserial', '-days', '3', '-sha256', '-extfile', c('leaf.ext'), '-out', c('leaf.pem')]);
  writeFileSync(c('fullchain.pem'), readFileSync(c('leaf.pem'), 'utf8') + readFileSync(c('ca.pem'), 'utf8'));
  const pub = ssl(['x509', '-in', c('leaf.pem'), '-pubkey', '-noout']);
  const der = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'der'], { input: pub });
  const spki = createHash('sha256').update(der).digest('base64');
  execFileSync(path.join(JAVA_HOME, 'bin/keytool'), ['-importcert', '-alias', 'gcsp-local-ca', '-file', c('ca.pem'), '-keystore', c('truststore.p12'), '-storetype', 'PKCS12', '-storepass', TRUST_PASS, '-noprompt'], { stdio: 'pipe', timeout: 60000 });
  return { ca: readFileSync(c('ca.pem'), 'utf8'), cert: readFileSync(c('fullchain.pem')), key: readFileSync(c('leaf.key')), spki, trust: c('truststore.p12') };
}

// ---------- local test OIDC issuer (as fucq435, one employee subject) ----------
const idp = { codes: new Map(), txns: new Map(), subjects: { [SUBJECT]: ['employee'] }, keys: null, server: null };
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
    GCSP_OIDC_ACCOUNTS: JSON.stringify([{ subject: SUBJECT, roles: ['employee'], employeeId: EMPLOYEE }]),
    GCSP_ENVIRONMENT_ID: ENVIRONMENT_ID, GCSP_RUN_ID: RUN_ID, GCSP_POLICY_VERSION: POLICY,
    GCSP_ACCOUNT_PROVIDER: 'repository', GCSP_SCENARIO_PROVIDER: 'demo', GCSP_ORDERING_PROVIDER: 'synthetic', GCSP_RESET_ALLOWED: 'true',
    GCSP_DATABASE_URL: DB_URL, GCSP_EXPECTED_DATABASE: DB_NAME };
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
async function serverEditor() {
  const r = await request('GET', '/brief/editor', { Authorization: `Bearer ${signJwt(accessClaims(SUBJECT, ['employee']), idp.keys.privateKey)}` });
  if (r.status !== 200 || r.json?.status !== 'ok') throw new Error(`server editor read failed: ${r.status} ${r.json?.code ?? ''}`);
  const v = r.json.value; const i = v.initial;
  const prefs = Object.fromEntries(Object.entries(i.brief.preferences ?? {}).map(([k, x]) => [k, { value: x.value, importance: x.importance, valueState: x.valueState }]));
  return { briefVersion: i.briefVersion, draftVersion: i.draftVersion, prefs, buddy: i.buddy?.state, consent: i.consent, rating: i.currentCarRating?.value ?? null, contractId: i.currentCarRating?.contractId ?? null,
    model: v.context?.knownFacts?.currentContract?.value?.model ?? null };
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
  const prefs = b.brief?.preferences ? Object.fromEntries(Object.entries(b.brief.preferences).map(([k, x]) => [k, [x.value, x.importance]])) : undefined;
  return { commandId: typeof b.commandId === 'string', expectedBriefVersion: b.expectedBriefVersion, expectedDraftVersion: b.expectedDraftVersion, baseBriefVersion: b.baseBriefVersion, consent: b.consent, changes: b.changes ? Object.keys(b.changes) : undefined, rating: b.currentCarRating?.value, prefs,
    carriesIdentity: /"(employeeId|runId|environmentId|principalId|subject)"/.test(JSON.stringify(b)) };
}
function responseSummary(j) {
  if (!j || typeof j !== 'object') return null;
  const v = j.value ?? {};
  return { status: j.status, code: j.code, action: j.action, briefVersion: v.briefVersion ?? v.brief?.briefVersion ?? v.initial?.briefVersion, draftVersion: v.draftVersion ?? v.initial?.draftVersion, eligibleCount: v.eligibleCount };
}
class Page {
  constructor(cdp, sessionId, ctxId, label) { this.cdp = cdp; this.sid = sessionId; this.ctxId = ctxId; this.label = label; this.log = []; this.byId = new Map(); this.waits = []; cdp.listeners.push((m) => m.sessionId === sessionId && this.event(m)); }
  send(method, params) { return this.cdp.send(method, params, this.sid); }
  event(m) {
    const p = m.params ?? {};
    if (m.method === 'Network.requestWillBeSent') {
      if (!p.request.url.startsWith(ORIGINS.api)) return;
      const e = { id: p.requestId, method: p.request.method, path: new URL(p.request.url).pathname.replace(API_PATH, ''), auth: !!hdr(p.request.headers, 'authorization') };
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
  async shot(name) { const r = await this.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(dirs.evidence, name), Buffer.from(r.data, 'base64')); return name; }
}
// DOM helpers over the real PreferencesComponent template; selectors follow its ids, names and visible labels.
const HELPERS = `
const main = document.querySelector('#gcsp-main') ?? document;
const $ = (s) => main.querySelector(s);
const setRange = (s, v) => { const el = $(s); if (!el || el.disabled || el.closest('fieldset:disabled')) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); return el.value === String(v); };
const choice = (name, text) => { const el = [...main.querySelectorAll('input[name="' + name + '"]')].find((i) => i.closest('label')?.textContent.trim() === text); if (!el || el.disabled || el.closest('fieldset:disabled')) return false; if (!el.checked) el.click(); return el.checked; };
const checkedLabel = (name) => [...main.querySelectorAll('input[name="' + name + '"]')].filter((i) => i.checked).map((i) => i.closest('label')?.textContent.trim());
const button = (text) => [...main.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const press = (text) => { const b = button(text); if (!b || b.disabled) return false; b.click(); return true; };
const saveStatus = () => $('.gcsp-actions + p[role="status"]')?.textContent.trim() ?? '';
const versionNote = () => [...main.querySelectorAll('p.gcsp-note')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim()).find((t) => /· Version \\d+/.test(t)) ?? null;
const openDetails = (text) => { const s = [...main.querySelectorAll('details > summary')].find((x) => x.textContent.trim() === text); if (s && !s.parentElement.open) s.click(); return !!s?.parentElement.open; };
const value = (s) => $(s)?.value ?? null;
`;
const versionOf = (note) => { const m = /(Unsaved draft|Your saved preferences) · Version (\d+)/.exec(note ?? ''); return m ? { saved: m[1] === 'Your saved preferences', version: Number(m[2]) } : null; };
const CONFIRMED = /^Your preferences were confirmed\. Showing saved version (\d+)\./;
const STALE = 'Your preferences changed elsewhere. Reload to see the latest. Your edits are kept until then.';
const NOT_SAVED = 'Your changes are not confirmed as saved. Try again or reload.';

async function newPage(cdp, label) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, sessionId, browserContextId, label);
  await page.send('Page.enable'); await page.send('Network.enable'); await page.send('Network.setCacheDisabled', { cacheDisabled: true }); await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  return page;
}
async function signIn(page) {
  await page.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/` });
  await page.until(`return location.origin === '${ORIGINS.web}' && !!button('Sign in');`, 30000, 'sign-in page');
  await page.act(`return press('Sign in');`);
  await page.until(`return location.origin === '${ORIGINS.idp}' && !!document.querySelector('button[data-subject="${SUBJECT}"]');`, 30000, 'issuer login form');
  await page.eval(`document.querySelector('button[data-subject="${SUBJECT}"]').click()`);
  await page.until(`return location.origin === '${ORIGINS.web}' && /^\\/gcsp\\/(account|preferences)/.test(location.pathname);`, 30000, 'signed-in employee landing');
  return page.eval('location.pathname');
}
async function openPreferences(page) {
  await page.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/preferences` });
  await page.until(`return !!versionNote() && !!$('#preference-comfort');`, 30000, 'preferences editor');
  return versionOf(await page.act('return versionNote();'));
}
async function waitStatus(page, test, what) { await page.until(`const s = saveStatus(); return ${test};`, 30000, what); await page.settle(); return page.act('return saveStatus();'); }

// ---------- scenarios ----------
async function scenario(id, title, ac, fn) {
  const s = { title, ac, pass: false, checks: {}, observations: {} };
  receipt.scenarios[id] = s; log(`scenario ${id}: ${title}`);
  try { await fn(s); } catch (e) { s.checks.noException = false; s.error = e.message; }
  s.pass = Object.keys(s.checks).length > 0 && Object.values(s.checks).every((v) => v === true);
  log(`scenario ${id}: ${s.pass ? 'PASS' : 'FAIL'}${s.error ? ` (${s.error.slice(0, 200)})` : ''}`);
}
const posts = (calls, p) => calls.filter((e) => e.method === 'POST' && e.path === p);
const ownedCalls = (calls) => calls.length > 0 && calls.every((e) => e.auth && !e.path.includes(EMPLOYEE) && !e.request?.carriesIdentity);

// AC1: rate the current car, edit preferences and Buddy, save with consent, read back, reload.
async function scenarioA(cdp, s, pages) {
  const page = await newPage(cdp, 'context-1'); pages.one = page;
  s.observations.landed = await signIn(page);
  s.checks.signedInAsEmployee = /^\/gcsp\/(account|preferences)/.test(s.observations.landed);
  const before = await serverEditor(); s.observations.serverBefore = before;
  if (s.observations.landed !== '/gcsp/account') await page.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/account` });
  const rated = await page.until(`return main.querySelectorAll('gcsp-current-car-rating input[type=radio]').length === 5;`, 30000, 'current-car rating stars').then(() => true, (e) => { s.observations.ratingMissing = e.message.slice(0, 200); return false; });
  s.checks.currentCarRatingOffered = rated;
  if (rated) {
    await page.act(`const l = [...main.querySelectorAll('gcsp-current-car-rating label')].find((x) => x.textContent.includes('4 stars')); l.querySelector('input').click(); return true;`);
    await page.until(`return main.querySelector('gcsp-current-car-rating p[role=status]')?.textContent.trim() === 'Preferences saved automatically.';`, 30000, 'rating autosave');
    await page.settle();
    const afterRating = await serverEditor(); s.observations.serverAfterRating = { briefVersion: afterRating.briefVersion, draftVersion: afterRating.draftVersion, rating: afterRating.rating };
    s.checks.ratingSavedByServer = afterRating.rating === 4 && afterRating.contractId === before.contractId;
    s.observations.screenshotRating = await page.shot('a1-account-rating-saved.png');
  }
  await page.act(`const a = [...main.querySelectorAll('a')].find((x) => x.textContent.trim() === 'Edit your preferences'); if (!a) return false; a.click(); return true;`);
  await page.until(`return location.pathname === '/gcsp/preferences' && !!versionNote() && !!$('#preference-comfort');`, 30000, 'preferences editor from account link');
  const server0 = await serverEditor();
  const shown0 = versionOf(await page.act('return versionNote();'));
  s.observations.editorOpened = { shown: shown0, server: { briefVersion: server0.briefVersion, draftVersion: server0.draftVersion } };
  s.checks.editorShowsServerVersion = shown0?.saved === true && shown0.version === server0.briefVersion;
  const facts = await page.act(`return [...main.querySelectorAll('.known-facts dl > div')].map((d) => [d.querySelector('dt')?.textContent.trim(), d.querySelector('dd')?.textContent.trim()]);`);
  s.observations.knownFacts = facts;
  s.checks.knownFactsFromServer = !!server0.model && facts.some(([k, v]) => k === 'Current car' && v === server0.model);
  const mark = page.log.length;
  // Importance inputs enable only after Angular renders the new preference, so values and importances are two turns.
  const values = await page.act(`openDetails('Anything else?');
    return { estate: choice('preference-body', 'Estate'), comfort: setRange('#preference-comfort', 70), economy: setRange('#preference-economy', 60) };`);
  await page.until(`return !$('#importance-body').disabled && !$('#importance-comfort').disabled && !$('#importance-economy').disabled;`, 10000, 'importance controls enabled');
  const edits = { ...values, ...await page.act(`return { bodyImportance: setRange('#importance-body', 75), comfortImportance: setRange('#importance-comfort', 75),
      economyImportance: setRange('#importance-economy', 50), engage: choice('buddy-engagement', 'Engage Buddy') };`) };
  s.observations.edits = edits;
  s.checks.controlsAcceptedEdits = Object.values(edits).every((v) => v === true);
  s.checks.unsavedDraftShown = versionOf(await page.act('return versionNote();'))?.saved === false;
  await page.act(`return press('Save your preferences');`);
  const status = await waitStatus(page, `/^Your preferences were confirmed|not confirmed|changed elsewhere|Confirmation failed|unavailable/.test(s)`, 'full save outcome');
  const server1 = await serverEditor(); s.observations.serverAfterSave = server1;
  const calls = page.calls(mark); s.observations.saveCalls = calls.filter((e) => e.method === 'POST' || e.path.startsWith('/brief/editor'));
  const draft = posts(calls, '/brief/draft'); const confirm = posts(calls, '/brief/confirm');
  s.observations.status = status;
  s.checks.oneDraftOneConfirm = draft.length === 1 && confirm.length === 1 && draft[0].status === 200 && confirm[0].status === 200;
  s.checks.draftAtServerVersions = draft[0]?.request?.expectedBriefVersion === server0.briefVersion && draft[0]?.request?.expectedDraftVersion === server0.draftVersion;
  s.checks.confirmCarriesConsent = confirm[0]?.request?.consent?.search === true && confirm[0]?.request?.consent?.hold === true;
  s.checks.confirmedMessageIsServerVersion = Number(CONFIRMED.exec(status)?.[1]) === server1.briefVersion && server1.briefVersion > server0.briefVersion;
  const p = server1.prefs;
  s.checks.serverSavedTheChoices = Array.isArray(p.body?.value) && p.body.value.includes('estate') && p.comfort?.value === 70 && p.economy?.value === 60
    && ['body', 'comfort', 'economy'].every((k) => p[k]?.valueState === 'confirmed') && server1.buddy === 'engaged' && server1.consent?.search === true && server1.consent?.hold === true;
  s.observations.screenshotSaved = await page.shot('a2-preferences-confirmed.png');
  await page.send('Page.reload', { ignoreCache: true });
  await page.until(`return !!versionNote() && !!$('#preference-comfort');`, 30000, 'editor after reload');
  const shown = await page.act(`return { note: versionNote(), comfort: value('#preference-comfort'), economy: value('#preference-economy'), body: checkedLabel('preference-body'), buddy: checkedLabel('buddy-engagement') };`);
  s.observations.afterReload = shown;
  s.checks.reloadShowsServerSaved = versionOf(shown.note)?.saved === true && versionOf(shown.note)?.version === server1.briefVersion && shown.comfort === '70' && shown.economy === '60'
    && shown.body.includes('Estate') && shown.buddy.includes('Engage Buddy');
  await page.settle();
  const preview = await page.act(`return main.querySelector('.preview [role=status]')?.textContent.replace(/\\s+/g, ' ').trim() ?? '';`);
  const lastPreview = page.calls().filter((e) => e.path === '/brief/preview' && e.response).at(-1)?.response ?? null;
  s.observations.preview = { shown: preview, server: lastPreview };
  const count = /^(\d+) eligible/.exec(preview);
  s.checks.previewIsServerOrHonest = count ? lastPreview?.status === 'ok' && Number(count[1]) === lastPreview.eligibleCount : /Preview unavailable\. Your edits are kept\.|Preview not calculated\.|Updating cars/.test(preview);
  s.checks.requestsCarryOnlyTheBearer = ownedCalls(page.calls());
  s.observations.screenshotReload = await page.shot('a3-reload-server-saved.png');
}

// AC2 stale: two signed-in contexts read the same version; the second writer is refused and can correct by refreshing.
async function scenarioB(cdp, s, pages) {
  const one = pages.one; const two = await newPage(cdp, 'context-2');
  try {
    await signIn(two);
    const v1 = await openPreferences(one); const v2 = await openPreferences(two); const base = await serverEditor();
    s.observations.opened = { one: v1, two: v2, server: base.briefVersion };
    s.checks.bothContextsReadTheSameVersion = v1?.version === base.briefVersion && v2?.version === base.briefVersion;
    await two.act(`openDetails('Anything else?'); return true;`); await one.act(`openDetails('Anything else?'); return true;`);
    const twoMark = two.log.length;
    s.observations.twoEdit = await two.act(`return setRange('#preference-comfort', 30) && press('Save your preferences');`);
    const twoStatus = await waitStatus(two, `/^Your preferences were confirmed|not confirmed|changed elsewhere/.test(s)`, 'first writer outcome');
    const afterTwo = await serverEditor(); s.observations.afterFirstWriter = { status: twoStatus, briefVersion: afterTwo.briefVersion, comfort: afterTwo.prefs.comfort?.value };
    s.checks.firstWriterSaved = Number(CONFIRMED.exec(twoStatus)?.[1]) === afterTwo.briefVersion && afterTwo.briefVersion === base.briefVersion + 1 && afterTwo.prefs.comfort?.value === 30;
    s.checks.firstWriterOneDraftOneConfirm = posts(two.calls(twoMark), '/brief/draft').length === 1 && posts(two.calls(twoMark), '/brief/confirm').length === 1;
    const economyBefore = afterTwo.prefs.economy?.value;
    const oneMark = one.log.length;
    // Edit and submit in one turn so the 180 ms preview timer cannot run first.
    s.observations.oneEdit = await one.act(`return setRange('#preference-economy', 80) && press('Save your preferences');`);
    const oneStatus = await waitStatus(one, `s === ${JSON.stringify(STALE)} || /^Your preferences were confirmed|not confirmed/.test(s)`, 'second writer outcome');
    const oneCalls = one.calls(oneMark);
    const refused = oneCalls.filter((e) => e.method === 'POST' && ['/brief/draft', '/brief/preview'].includes(e.path) && e.status === 409);
    s.observations.secondWriter = { status: oneStatus, calls: oneCalls.filter((e) => e.method === 'POST') };
    s.checks.secondWriterRefusedStale = refused.some((e) => e.response?.code === 'stale-version');
    s.checks.secondWriterNoAcceptedWrite = !oneCalls.some((e) => e.method === 'POST' && ['/brief/draft', '/brief/confirm', '/brief/preferences'].includes(e.path) && e.status === 200);
    s.checks.truthfulStaleMessage = oneStatus === STALE;
    const afterStale = await serverEditor(); s.observations.serverAfterStale = { briefVersion: afterStale.briefVersion, economy: afterStale.prefs.economy?.value };
    s.checks.serverUnchangedByStaleWrite = afterStale.briefVersion === afterTwo.briefVersion && afterStale.prefs.economy?.value === economyBefore && afterStale.prefs.comfort?.value === 30;
    const kept = await one.act(`return { economy: value('#preference-economy'), save: button('Save your preferences')?.disabled ?? null, tryAgain: !!button('Try again'), refresh: button('Refresh and review')?.disabled ?? null };`);
    s.observations.staleScreen = kept;
    s.checks.editKeptAndSaveBlocked = kept.economy === '80' && kept.save === true && kept.tryAgain === false && kept.refresh === false;
    s.observations.screenshotStale = await one.shot('b1-stale-reload-offered.png');
    await one.act(`return press('Refresh and review');`);
    await one.until(`return !!button('Replace draft with saved preferences');`, 15000, 'replace confirmation');
    await one.act(`return press('Replace draft with saved preferences');`);
    await one.until(`const v = versionNote(); return !!v && v.startsWith('Your saved preferences') && v.endsWith('Version ${afterTwo.briefVersion}');`, 30000, 'refreshed saved version');
    const refreshed = await one.act(`return { note: versionNote(), comfort: value('#preference-comfort'), economy: value('#preference-economy') };`);
    s.observations.refreshed = refreshed;
    s.checks.refreshShowsTheNewerServerVersion = refreshed.comfort === '30' && refreshed.economy === String(economyBefore);
    const fixMark = one.log.length;
    await one.act(`openDetails('Anything else?'); return setRange('#preference-economy', 80) && press('Save your preferences');`);
    const fixStatus = await waitStatus(one, `/^Your preferences were confirmed|not confirmed|changed elsewhere/.test(s)`, 'corrected save outcome');
    const fixed = await serverEditor(); s.observations.corrected = { status: fixStatus, briefVersion: fixed.briefVersion, economy: fixed.prefs.economy?.value, comfort: fixed.prefs.comfort?.value };
    s.checks.correctionSavesAtTheNewVersion = Number(CONFIRMED.exec(fixStatus)?.[1]) === fixed.briefVersion && fixed.briefVersion === afterTwo.briefVersion + 1 && fixed.prefs.economy?.value === 80 && fixed.prefs.comfort?.value === 30
      && posts(one.calls(fixMark), '/brief/draft')[0]?.request?.expectedBriefVersion === afterTwo.briefVersion;
    s.checks.requestsCarryOnlyTheBearer = ownedCalls(one.calls()) && ownedCalls(two.calls());
    s.observations.screenshotCorrected = await one.shot('b2-corrected-save.png');
  } finally { await two.settle(); await cdp.send('Target.disposeBrowserContext', { browserContextId: two.ctxId }).catch(() => {}); }
}

// AC2 unavailable: the API stops; the save is truthfully unsaved, a fresh read shows no invented editor; after restart both recover.
async function scenarioC(cdp, s, pages) {
  const one = pages.one; const reader = await newPage(cdp, 'context-3');
  try {
    await signIn(reader);
    const shownReader = await openPreferences(reader); await openPreferences(one); const base = await serverEditor();
    s.observations.before = { reader: shownReader, server: base.briefVersion, economy: base.prefs.economy?.value };
    await stopApi();
    const mark = one.log.length;
    s.observations.edit = await one.act(`openDetails('Anything else?'); return setRange('#preference-economy', 20) && press('Save your preferences');`);
    const status = await waitStatus(one, `s === ${JSON.stringify(NOT_SAVED)} || /confirmed|changed elsewhere/.test(s)`, 'save outcome while the API is stopped');
    const calls = one.calls(mark);
    s.observations.whileStopped = { status, calls: calls.filter((e) => e.method === 'POST') };
    s.checks.truthfulNotSavedMessage = status === NOT_SAVED;
    s.checks.draftFailedNoSuccess = posts(calls, '/brief/draft').some((e) => e.failed && !e.status) && !calls.some((e) => e.status === 200 && e.method === 'POST');
    const kept = await one.act(`return { economy: value('#preference-economy'), tryAgain: button('Try again')?.disabled ?? null, note: versionNote() };`);
    s.observations.unsavedScreen = kept;
    s.checks.editKeptWithTryAgain = kept.economy === '20' && kept.tryAgain === false && versionOf(kept.note)?.saved === false;
    s.observations.screenshotUnsaved = await one.shot('c1-unsaved-api-stopped.png');
    await reader.send('Page.reload', { ignoreCache: true });
    await reader.until(`return !$('form.brief-form') && /could not be loaded|unavailable/i.test(main.innerText);`, 30000, 'fresh read while the API is stopped');
    const down = await reader.act(`return { path: location.pathname, text: main.innerText.replace(/\\s+/g, ' ').trim().slice(0, 300), form: !!$('form.brief-form'), note: versionNote(), tryAgain: !!button('Try again') };`);
    s.observations.freshReadWhileStopped = down;
    s.checks.freshReadInventsNothing = !down.form && down.note === null;
    s.observations.screenshotLoadFailed = await reader.shot('c2-load-failed-api-stopped.png');
    await startApi();
    const restarted = await serverEditor(); s.observations.serverAfterRestart = { briefVersion: restarted.briefVersion, economy: restarted.prefs.economy?.value };
    s.checks.nothingWrittenWhileStopped = restarted.briefVersion === base.briefVersion && restarted.prefs.economy?.value === base.prefs.economy?.value;
    const retryMark = one.log.length;
    s.observations.retryPressed = await one.act(`return press('Try again');`);
    const retried = await waitStatus(one, `/^Your preferences were confirmed|not confirmed|changed elsewhere/.test(s)`, 'retry outcome after restart');
    const after = await serverEditor(); s.observations.retried = { status: retried, briefVersion: after.briefVersion, economy: after.prefs.economy?.value };
    s.checks.retrySavesAfterRestart = Number(CONFIRMED.exec(retried)?.[1]) === after.briefVersion && after.briefVersion === base.briefVersion + 1 && after.prefs.economy?.value === 20
      && posts(one.calls(retryMark), '/brief/draft').length === 1 && posts(one.calls(retryMark), '/brief/confirm').length === 1;
    s.observations.recoverBy = down.tryAgain ? 'status-screen Try again' : 'navigate to /gcsp/preferences';
    if (down.tryAgain) await reader.act(`return press('Try again');`); else await reader.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/preferences` });
    await reader.until(`return !!versionNote() && !!$('#preference-economy');`, 30000, 'reader editor after restart');
    const readBack = await reader.act(`return { note: versionNote(), economy: value('#preference-economy') };`);
    s.observations.readerAfterRestart = readBack;
    s.checks.otherContextReadsTheServerSavedVersion = versionOf(readBack.note)?.saved === true && versionOf(readBack.note)?.version === after.briefVersion && readBack.economy === '20';
    s.checks.requestsCarryOnlyTheBearer = ownedCalls(one.calls()) && ownedCalls(reader.calls());
    s.observations.screenshotRecovered = await reader.shot('c3-reader-after-restart.png');
  } finally { await reader.settle(); await cdp.send('Target.disposeBrowserContext', { browserContextId: reader.ctxId }).catch(() => {}); }
}

// ---------- main ----------
function accessLog() {
  const rows = [];
  for (const p of receipt.processes.filter((x) => x.name.startsWith('api-'))) {
    for (const l of tail(path.join(dirs.logs, `${p.name}.log`), 100000).split('\n')) { const m = /ACCESSLOG (\S+) (\S+) (\d+)/.exec(l); if (m && m[2].includes('/brief')) rows.push(`${p.name} ${m[1]} ${m[2].replace(API_PATH, '')} ${m[3]}`); }
  }
  return rows.slice(-80);
}
async function main() {
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  for (const [k, p] of Object.entries(PORTS)) if (!(await portFree(p))) throw new Error(`port ${p} (${k}) is in use; choose PROOF_${k.toUpperCase()}_PORT`);
  receipt.inputs = { scratch: PROOF, database: { source: DB_SOURCE, host: DB[1], port: DB[2] ?? '5432', name: DB_NAME, schema: SCHEMA }, ports: PORTS, jar: { path: path.relative(ROOT, JAR), sha256: sha256File(JAR) },
    appJars: readdirSync(path.join(path.dirname(JAR), 'app')).filter((f) => f.endsWith('.jar')).map((f) => ({ file: f, sha256: sha256File(path.join(path.dirname(JAR), 'app', f)) })), webBrowser: { path: path.relative(ROOT, WEB_BROWSER), indexSha256: sha256File(path.join(WEB_BROWSER, 'index.html')) } };
  receipt.composition = { identity: 'oidc (local test issuer)', subject: SUBJECT, employeeId: EMPLOYEE, account: 'repository', scenario: 'demo', ordering: 'synthetic', resetAllowed: true, environmentId: ENVIRONMENT_ID, runId: RUN_ID, policyVersion: POLICY, mirrors: 'services/gcsp-api/src/test/java/gcsp/api/brief/BriefJourneyProfiles.config()' };
  receipt.head = cap('git', ['-C', ROOT, 'rev-parse', 'HEAD']);
  receipt.tools = { harnessNode: process.version, openssl: cap('openssl', ['version']), chrome: cap(CHROME, ['--version']), java: (spawnSync(path.join(JAVA_HOME, 'bin/java'), ['-version'], { encoding: 'utf8' }).stderr ?? '').split('\n')[0] };
  log('certificates'); tls = makeCerts();
  log('static assembly of the prebuilt web');
  const assemble = await import(pathToFileURL(path.join(ROOT, 'scripts/build-gcsp-static.mjs')).href);
  await runOnce('assemble', process.execPath, ['scripts/build-gcsp-static.mjs', '--browser', WEB_BROWSER, '--output', dirs.static, '--environment', 'deployed', '--revision', receipt.head],
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
  await scenario('a', 'Edit, rate, choose Buddy, confirm with consent, read back and reload', 'AC1', (s) => scenarioA(cdp, s, pages));
  if (pages.one) await scenario('b', 'Two contexts at one version: stale write refused, refresh and save again', 'AC2', (s) => scenarioB(cdp, s, pages));
  if (pages.one) await scenario('c', 'API stopped: unsaved save and failed read are truthful; restart recovers', 'AC1+AC2', (s) => scenarioC(cdp, s, pages));
}
async function teardown() {
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
    AC1: { text: 'Employees can edit, confirm and save supported inputs and Buddy engagement; reload reflects the server saved version.', scenarios: ['a', 'c'], evidence: ok('a') && ok('c') ? 'pass' : 'fail', closure: 'OPEN: parent review decides' },
    AC2: { text: 'Failed/stale saves preserve truthful outcomes and usable correction. The UI does not calculate authoritative eligibility or manufacture a match.', scenarios: ['a', 'b', 'c'], evidence: ok('a') && ok('b') && ok('c') ? 'pass' : 'fail', closure: 'OPEN: parent review decides' } };
  receipt.overall = ['a', 'b', 'c'].every(ok) && !runError ? 'PASS' : 'FAIL';
  const file = path.join(dirs.evidence, 'connected-preferences-proof.json');
  try { writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`); } catch (e) { console.error('receipt write failed', e.message); }
  for (const k of Object.keys(sc).sort()) console.log(`  ${k}: ${sc[k].pass ? 'PASS' : 'FAIL'} ${sc[k].title}${sc[k].pass ? '' : ` [failed: ${Object.entries(sc[k].checks).filter(([, v]) => v !== true).map(([n]) => n).join(', ')}]`}`);
  console.log(`overall ${receipt.overall}; receipt ${file}; all owned processes exited: ${receipt.teardown?.allOwnedExited}`);
}
const deadline = setTimeout(async () => { log('global deadline exceeded'); await teardown(); finish('global deadline exceeded'); process.exit(1); }, DEADLINE_MS);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await teardown(); finish(`interrupted by ${sig}`); process.exit(130); });
let runError;
try { await main(); } catch (e) { runError = e.message; console.error('RUN ERROR:', e.message); } finally { clearTimeout(deadline); await teardown(); finish(runError); }
process.exit(receipt.overall === 'PASS' ? 0 : 1);
