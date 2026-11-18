#!/usr/bin/env node
// FUCQ-450 local connected proof: presenter controls operate real backend state; inspection stays read-only.
// Usage: node scripts/gcsp/fucq450-connected-presenter-proof.mjs  (zero dependencies, never builds, never touches synced folders)
// Optional: PROOF_SCRATCH_ROOT, PROOF_RUN_TOKEN, PROOF_PG_PORT, PROOF_WEB_PORT, PROOF_API_PORT, PROOF_IDP_PORT, PROOF_DEADLINE_SEC.
// Derived from fucq451-connected-outbox-proof.mjs and fucq456-restart-proof.mjs. Two owned databases, one JVM at a time.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:https';
import https from 'node:https';
import net from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, createWriteStream, rmSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const refuse = (why) => { console.error(`REFUSED: ${why}`); process.exit(2); };
const forbidden = (p) => /CloudStorage|OneDrive/i.test(String(p));

// ---------- inputs (parent-owned scratch root; each run owns runs/<token>) ----------
const SCRATCH_ROOT = path.resolve(process.env.PROOF_SCRATCH_ROOT ?? '/private/tmp/claude-501/fucq450-20261118T094842Z');
if (forbidden(SCRATCH_ROOT)) refuse('scratch root points into a cloud-synced folder');
if (!SCRATCH_ROOT.startsWith('/private/tmp/')) refuse('scratch root must be a parent-owned directory under /private/tmp');
if (!existsSync(SCRATCH_ROOT) || !statSync(SCRATCH_ROOT).isDirectory()) refuse('scratch root must exist');
const RUN_TOKEN = process.env.PROOF_RUN_TOKEN ?? `r${new Date().toISOString().replace(/\D/g, '').slice(2, 14)}${randomBytes(2).toString('hex')}`;
if (!/^[a-z0-9][a-z0-9-]{5,39}$/.test(RUN_TOKEN)) refuse('PROOF_RUN_TOKEN must be [a-z0-9-], 6-40 characters');
const PROOF = path.join(SCRATCH_ROOT, 'runs', RUN_TOKEN);
if (existsSync(PROOF)) refuse(`${PROOF} already exists; each run needs a fresh token`);
const EVIDENCE = path.join(ROOT, '.claude/test-runs/fucq450/connected', RUN_TOKEN);
if (existsSync(EVIDENCE)) refuse(`${EVIDENCE} already exists; each run needs a fresh token`);
const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@21';
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const JAR = path.join(ROOT, 'services/gcsp-api/target/quarkus-app/quarkus-run.jar');
const WEB_BROWSER = path.join(ROOT, 'apps/gcsp-web/dist/gcsp-web/browser');
const PG_BIN = '/opt/homebrew/opt/postgresql@17/bin';
const PSQL = path.join(PG_BIN, 'psql');
for (const [label, file] of [['API jar (prebuilt)', JAR], ['compiled web index (prebuilt)', path.join(WEB_BROWSER, 'index.html')], ['java', path.join(JAVA_HOME, 'bin/java')], ['keytool', path.join(JAVA_HOME, 'bin/keytool')], ['Chrome', CHROME], ['psql', PSQL]]) {
  if (forbidden(file)) refuse(`${label} points into a forbidden synced folder`);
  if (!existsSync(file)) refuse(`${label} not found at ${file}`);
}
const port = (name, fallback) => { const v = Number(process.env[name] ?? fallback); if (!Number.isInteger(v) || v < 1024 || v > 65535) refuse(`${name} must be a port number`); return v; };
const PORTS = { web: port('PROOF_WEB_PORT', 7450), api: port('PROOF_API_PORT', 8450), idp: port('PROOF_IDP_PORT', 9450) };
const PG = { host: '127.0.0.1', port: port('PROOF_PG_PORT', 55450), user: 'gcsp' };
const DB_DEV = 'gcsp_f450_dev'; const DB_RUN = 'gcsp_f450_running';
const DEADLINE_MS = Math.min(Number(process.env.PROOF_DEADLINE_SEC ?? 600), 600) * 1000;
const ORIGINS = { web: `https://gcsp-web.localhost:${PORTS.web}`, api: `https://gcsp-api.localhost:${PORTS.api}`, idp: `https://gcsp-idp.localhost:${PORTS.idp}` };
const ISSUER = `${ORIGINS.idp}/realms/gcsp-local`;
const API_PATH = '/api/gcsp/v1';
const API_BASE = `${ORIGINS.api}${API_PATH}`;
const KID = 'gcsp-local-test-1';
const TRUST_PASS = 'proof-local-trust';
const ENV_RUN = 'gcsp-poc'; const ENV_DEV = 'f450-dev';
const RUN_ID = 'run-1';
const POLICY = 'gcsp-policy-v1';
const ROLES = { presenter: ['presenter'], greg: ['greg'], paula: ['employee'] };
const SUBJECTS = Object.keys(ROLES);
const SUPPLY = path.join(ROOT, 'services/gcsp-api/src/test/resources/supply');
const RETURNS_POLICY = path.join(ROOT, 'services/gcsp-api/src/test/resources/returns/policy.json');
const dirs = { logs: path.join(PROOF, 'logs'), tmp: path.join(PROOF, 'tmp'), certs: path.join(PROOF, 'certs'), staticRun: path.join(PROOF, 'static-running'), staticDev: path.join(PROOF, 'static-dev'), browser: path.join(PROOF, 'browser'), evidence: path.join(PROOF, 'evidence') };
let SOURCE_REVISION = process.env.PROOF_SOURCE_REVISION ?? '';
if (!SOURCE_REVISION) SOURCE_REVISION = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', timeout: 10000 }).trim();
if (!/^[0-9a-f]{40}$/.test(SOURCE_REVISION)) refuse('source revision must be 40 hex');

const receipt = { schema: 'fucq450-connected-presenter-proof/1', story: 'DEV-2026-11-13-018 / FUCQ-450', startedAt: new Date().toISOString(), runToken: RUN_TOKEN, origins: ORIGINS, sourceRevision: SOURCE_REVISION,
  localTestIssuer: `LOCAL TEST OIDC ISSUER ${ISSUER}: harness only, not the real provider`, composition: null, inputs: null, tools: {}, processes: [], scenarios: {}, originalAcceptance: null, failureLogs: {}, resources: { peakRssMiB: 0 },
  limitations: [
    'Safari/WebKit is unrun: Chrome headless with isolated contexts covers desktop, narrow and private storage only.',
    'Hosted environments (Render dev, hosted identity provider, deployed running deployment) are unrun; the running deployment is a local stand-in (environment gcsp-poc, reset not allowed) on its own database.',
    'A local labelled OIDC issuer exercises real code/PKCE, signed JWTs and Java verification; it is not the real provider.',
    'The running-deployment stand-in has scenario provider none (demo refuses to start without reset), so the page offers no reset control there; the refusal is shown by the unavailable catalogue and direct POST 403.',
    'Parent supplies and pins the prebuilt API jar and web bundle; artifact hashes alone do not prove source provenance.' ] };
const owned = [];
const CHILD_LOG_LIMIT = 1024 * 1024;
const LOG_LIMIT_MARKER = Buffer.from('\nPROOF FAILURE: shared 1MiB child log budget exhausted; remaining child output discarded.\n');
let childLogBytes = 0; let logLimitFailure = false;
let finished = false; let teardownPromise;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256b64u = (s) => createHash('sha256').update(s).digest('base64url');
const sha256Hex = (s) => createHash('sha256').update(s).digest('hex');
const sha256File = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const tail = (file, n = 40) => { try { return readFileSync(file, 'utf8').split('\n').slice(-n).join('\n').slice(-6000); } catch { return ''; } };
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
const SUPERVISOR_MARKERS = ['F451_LOCAL_TOKEN', 'TEST_RESOURCE_PARENT_RESERVATION', 'PROOF_RUN_TOKEN'];
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

// ---------- local labelled test OIDC issuer (real authorization-code + PKCE, signed JWTs) ----------
const idp = { codes: new Map(), txns: new Map(), subjects: Object.fromEntries(SUBJECTS.map((s) => [`sub-${s}`, ROLES[s]])), keys: null, server: null };
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

// ---------- static web: one assembled bundle per environment id, served by one HTTPS server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.gif': 'image/gif' };
let webServer; let webStaticDir = null;
function startWeb(tls, fixedRoutes) {
  const fixed = new Set(fixedRoutes.map((r) => r.replace(/\/$/, '') || '/'));
  webServer = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const p = decodeURIComponent(new URL(req.url, ORIGINS.web).pathname);
    const root = path.join(webStaticDir ?? dirs.staticDev, 'gcsp');
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

// ---------- the real Java jar as an owned process: 'running' stand-in or isolated 'dev' ----------
let tls;
function apiEnv(kind, over = {}) {
  const dev = kind === 'dev'; const db = dev ? DB_DEV : DB_RUN;
  return { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp, JAVA_HOME, LANG: 'en_GB.UTF-8',
    QUARKUS_HTTP_SSL_PORT: String(PORTS.api), QUARKUS_HTTP_INSECURE_REQUESTS: 'disabled', QUARKUS_HTTP_SSL_CERTIFICATE_FILES: path.join(dirs.certs, 'fullchain.pem'), QUARKUS_HTTP_SSL_CERTIFICATE_KEY_FILES: path.join(dirs.certs, 'leaf.key'),
    QUARKUS_HTTP_ACCESS_LOG_ENABLED: 'true', QUARKUS_HTTP_ACCESS_LOG_PATTERN: 'ACCESSLOG %m %U %s',
    GCSP_ALLOWED_ORIGINS: ORIGINS.web, GCSP_IDENTITY_PROVIDER: 'oidc', GCSP_OIDC_ISSUER: ISSUER, GCSP_OIDC_JWKS_URI: `https://127.0.0.1:${PORTS.idp}/realms/gcsp-local/protocol/openid-connect/certs`,
    GCSP_OIDC_AUDIENCE: 'gcsp-api', GCSP_OIDC_AUTHORIZED_PARTY: 'gcsp-web', GCSP_OIDC_REQUIRED_SCOPES: 'gcsp-api',
    GCSP_OIDC_ACCOUNTS: JSON.stringify(SUBJECTS.map((s) => ({ subject: `sub-${s}`, roles: ROLES[s], ...(ROLES[s].includes('employee') ? { employeeId: `employee-${s}` } : {}) }))),
    GCSP_ENVIRONMENT_ID: dev ? ENV_DEV : ENV_RUN, GCSP_RUN_ID: RUN_ID, GCSP_POLICY_VERSION: POLICY,
    GCSP_SUPPLY_PROVIDER: 'tranche-plan', GCSP_SUPPLY_TRANCHE_PLAN_FILE: PLAN_FILE, GCSP_SUPPLY_POLICY_FILE: path.join(SUPPLY, 'policy.json'),
    GCSP_APPOINTMENTS_PROVIDER: 'synthetic', GCSP_RETURNS_PROVIDER: 'synthetic', GCSP_RETURNS_POLICY_FILE: RETURNS_POLICY,
    GCSP_ACCOUNT_PROVIDER: dev ? 'repository' : 'none', GCSP_SCENARIO_PROVIDER: dev ? 'demo' : 'none', ...(dev ? { GCSP_RESET_ALLOWED: 'true' } : {}),
    GCSP_SHUTDOWN_TIMEOUT: '10s', GCSP_CLAIMS_SWEEP_INTERVAL: '10m', GCSP_NOTIFY_DRAIN_INTERVAL: '10m',
    GCSP_DATABASE_URL: `jdbc:postgresql://${PG.host}:${PG.port}/${db}`, GCSP_DATABASE_USER: PG.user, GCSP_DATABASE_PASSWORD: '', GCSP_EXPECTED_DATABASE: db, ...over };
}
// The repo fixture window predates the demo clock, so it would release on the first tick. Re-date it to the scenario's release cue.
const PLAN_FILE = path.join(PROOF, 'tranche-plan.json');
function londonInstant(day, hh, mm) {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (const offset of [0, -1, 1]) { const t = new Date(Date.parse(`${day}T${String(hh + offset).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`)); if (fmt.format(t) === `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`) return t.toISOString(); }
  throw new Error('cannot derive the London release instant');
}
function writePlan() {
  const base = JSON.parse(readFileSync(path.join(SUPPLY, 'tranche-plan.json'), 'utf8'));
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
  base.windows[0].availableAt = londonInstant(day, 9, 30); base.windows[0].windowId = 'f450-release-window'; base.version = 'fucq450-redated-v1';
  writeFileSync(PLAN_FILE, JSON.stringify(base));
  return { source: 'services/gcsp-api/src/test/resources/supply/tranche-plan.json', sha256: sha256File(PLAN_FILE), availableAt: base.windows[0].availableAt };
}
let api = null; let apiStarts = 0;
function spawnApi(kind, over) {
  apiStarts++;
  const name = `api-${apiStarts}-${kind}`;
  api = spawnOwned(name, path.join(JAVA_HOME, 'bin/java'), ['-Xmx512m', `-Djavax.net.ssl.trustStore=${tls.trust}`, `-Djavax.net.ssl.trustStorePassword=${TRUST_PASS}`, `-Djava.io.tmpdir=${dirs.tmp}`, '-jar', JAR], apiEnv(kind, over), PORTS.api);
  return api;
}
async function startApi(kind, over) {
  const child = spawnApi(kind, over); const name = path.basename(child.logFile, '.log');
  for (let i = 0; ; i++) {
    if (child.done) { receipt.failureLogs[name] = tail(child.logFile); throw new Error(`${name} exited during startup`); }
    try { const r = await request('GET', '/context'); if (r.status === 401) break; } catch { /* not up yet */ }
    if (i > 240) { receipt.failureLogs[name] = tail(child.logFile); throw new Error(`${name} did not become ready`); }
    await sleep(500);
  }
  log(`${name} ready on ${ORIGINS.api}`);
  return child;
}
async function stopApi() { const child = api; const r = await child.stop(); log(`${path.basename(child.logFile, '.log')} stopped`); return r; }

// ---------- direct HTTPS, signed tokens, owned PostgreSQL ----------
function request(method, p, headers = {}, body = null) {
  const u = new URL(ORIGINS.api);
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port: Number(u.port), path: `${API_PATH}${p}`, method, servername: u.hostname, headers: { Host: u.host, Accept: 'application/json', ...headers }, ca: tls.ca, timeout: 15000 }, (res) => {
      const chunks = []; let size = 0; res.on('data', (c) => { size += c.length; if (size > 2 * 1024 * 1024) { req.destroy(new Error('API response exceeded 2MiB bound')); return; } chunks.push(c); });
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* not json */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('timeout', () => req.destroy(new Error('request timeout'))); req.on('error', reject); req.end(body === null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)));
  });
}
const tokenFor = (person) => signJwt(accessClaims(`sub-${person}`, ROLES[person]), idp.keys.privateKey);
async function call(person, suffix, body) {
  const auth = person ? { Authorization: `Bearer ${tokenFor(person)}` } : {};
  return request(body === undefined ? 'GET' : 'POST', suffix, { ...auth, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body ?? null);
}
async function value(person, suffix, body) {
  const r = await call(person, suffix, body);
  if (r.status !== 200 || r.json?.status !== 'ok') throw new Error(`${person} ${suffix}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json.value;
}
function psql(db, sqlText, schema = 'gcsp_app') {
  return execFileSync(PSQL, ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-h', PG.host, '-p', String(PG.port), '-U', PG.user, '-d', db, '-c', sqlText],
    { encoding: 'utf8', timeout: 60000, env: { PATH: process.env.PATH, HOME: process.env.HOME, PGCONNECT_TIMEOUT: '10', TMPDIR: dirs.tmp, ...(schema ? { PGOPTIONS: `-c search_path=${schema}` } : {}) } }).trim();
}
// Same shape as the FUCQ-456 running-database digest: every row of every base table in gcsp_app.
const DIGEST_SQL = "select md5(string_agg(table_name || ':' || (xpath('/row/c/text()', query_to_xml(format('select md5(coalesce(string_agg(t::text, ''|'' order by t::text), '''')) as c from gcsp_app.%I t', table_name), false, true, '')))[1]::text, ',' order by table_name)) from information_schema.tables where table_schema = 'gcsp_app' and table_type = 'BASE TABLE'";
const digest = (db) => psql(db, DIGEST_SQL, null);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const newId = (prefix = 'f450') => `${prefix}-${RUN_TOKEN}-${randomBytes(6).toString('hex')}`;

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
  return { ...b, carriesPrincipal: /"(employeeId|environmentId|principalId|subject)"/.test(JSON.stringify(b)) };
}
const responseSummary = (body) => body;
class Page {
  constructor(cdp, sessionId, ctxId, label) { this.cdp = cdp; this.sid = sessionId; this.ctxId = ctxId; this.label = label; this.log = []; this.byId = new Map(); this.waits = []; this.mainFrame = null; this.mainLoader = null; this.docs = 0; this.errors = []; cdp.listeners.push((m) => m.sessionId === sessionId && this.event(m)); }
  send(method, params) { return this.cdp.send(method, params, this.sid); }
  // Finished scenarios retain their observations, while browser processes and sessions are released.
  async close() { await this.settle(); await this.cdp.send('Target.disposeBrowserContext', { browserContextId: this.ctxId }); }
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
    const location = await this.eval(`({ origin: location.origin, pathname: location.pathname, queryKeys: [...new URL(location.href).searchParams.keys()], hasFragment: !!location.hash })`).catch(() => null);
    const calls = this.calls().slice(-16).map(({ method, path, query, auth, status, failed }) => ({ method, path, query, auth, status, failed }));
    throw new Error(`${this.label}: timed out waiting for ${what}; page text: ${text}; navigation/API diagnostics: ${JSON.stringify({ location, calls })}`);
  }
  async shot(name) {
    const metrics = await this.send('Page.getLayoutMetrics'); const size = metrics.cssContentSize ?? metrics.contentSize;
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.width, height: Math.min(size.height, 10000), scale: 1 } });
    writeFileSync(path.join(dirs.evidence, name), Buffer.from(r.data, 'base64')); return path.join(dirs.evidence, name);
  }
}

// DOM helpers run inside the page; selectors follow the presenter, outbox and comparison components.
const HELPERS = `
const main = document.querySelector('#gcsp-main') ?? document;
const $ = (s) => main.querySelector(s);
const norm = (s) => (s ?? '').replace(/\\s+/g, ' ').trim();
const buttons = () => [...main.querySelectorAll('button')];
const button = (label) => buttons().find((b) => b.textContent.trim() === label);
const buttonStarting = (p) => buttons().find((b) => b.textContent.trim().startsWith(p));
const press = (label) => { const b = button(label); if (!b || b.disabled) return false; b.click(); return true; };
const pressStarting = (p) => { const b = buttonStarting(p); if (!b || b.disabled) return false; b.click(); return true; };
const text = () => norm(main.textContent);
const setValue = (selector, value) => { const el = $(selector); if (!el || el.disabled) return false; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; };
const facts = (root) => [...root.querySelectorAll('dl > div')].map((r) => [r.querySelector('dt')?.textContent.trim(), r.querySelector('dd')?.textContent.trim()]);
const panel = (id) => document.getElementById(id)?.closest('section');
`;
const PRESENTER_VIEW = `
const clockPanel = panel('presenter-clock-heading'); const tickPanel = panel('presenter-tick-heading'); const faultPanel = panel('presenter-fault-heading'); const scenarioPanel = panel('presenter-scenario-heading');
const f = (p) => p && p.querySelector('dl') ? Object.fromEntries(facts(p)) : null;
const sel = (suffix) => main.querySelector('select[id$="-' + suffix + '"]');
const status = document.querySelector('[data-presenter-status]');
return {
  busy: document.querySelector('.presenter-screen')?.getAttribute('aria-busy') === 'true', status: norm(status?.textContent), focusStatus: !!status && document.activeElement === status,
  clock: f(clockPanel), release: norm(clockPanel?.querySelector('p[id$="-release-reason"]')?.textContent), tick: f(tickPanel),
  tickHandlers: tickPanel ? [...tickPanel.querySelectorAll('ol > li')].map((li) => norm(li.textContent)) : [],
  tickMissing: tickPanel ? [...tickPanel.querySelectorAll('ul > li')].map((li) => norm(li.textContent)) : [],
  tickOutcomes: tickPanel ? [...tickPanel.querySelectorAll('details > summary')].map((x) => norm(x.textContent)) : [],
  faults: faultPanel ? [...faultPanel.querySelectorAll(':scope > p')].map((p) => norm(p.textContent)).filter((t) => /^[a-z-]+: /.test(t)) : [],
  scenarioOptions: sel('scenario') ? [...sel('scenario').options].map((o) => ({ value: o.value, text: norm(o.textContent) })) : null, scenarioValue: sel('scenario')?.value ?? null,
  stepLabel: buttonStarting('Step ')?.textContent.trim() ?? null, stepDisabled: buttonStarting('Step ')?.disabled ?? null, nextReleaseDisabled: button('Next release')?.disabled ?? null,
  resetTrigger: !!$('[data-reset-trigger]'), resetTriggerDisabled: $('[data-reset-trigger]')?.disabled ?? null, retryButton: !!button('Retry the same command'), retryFaultButton: !!button('Retry the fault command'),
  catalogueUnavailable: norm(scenarioPanel?.textContent).includes('The scenario catalogue is unavailable'),
  controlIds: [...main.querySelectorAll('input, select, textarea')].map((e) => e.id.replace(/^gcsp-presenter-\\d+-/, '')),
  overflow: document.documentElement.scrollWidth > innerWidth + 1, heading: main.querySelector('h1')?.textContent?.trim() ?? null,
};`;
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
  await page.until(`return location.origin === '${ORIGINS.web}' && /^\\/gcsp\\/(account|preferences|presenter|greg)/.test(location.pathname);`, 30000, 'signed-in employee landing');
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

// ---------- checks, scenarios, page/server comparison ----------
const check = (s, name, passed) => { s.checks[name] = passed === true; if (passed !== true) throw new Error(`check failed: ${name}`); };
async function scenario(id, title, ac, fn) {
  const s = { title, ac, pass: false, checks: {}, observations: {} }; receipt.scenarios[id] = s; log(`scenario ${id}: ${title}`);
  try { await fn(s); } catch (e) { s.error = e.message; s.checks.noException = false; }
  s.pass = Object.keys(s.checks).length > 0 && Object.values(s.checks).every((v) => v === true);
  writeFileSync(path.join(dirs.evidence, `checkpoint-${id}.json`), JSON.stringify(s, null, 2));
  if (!s.pass) throw new Error(`Scenario ${id} failed: ${s.error ?? 'failed assertion'}`);
}
const num = (x) => Number(String(x ?? '').replace(/,/g, ''));
const brief = (r) => ({ status: r.status, code: r.json?.code, reason: r.json?.reason, bodyStatus: r.json?.status });
async function truth() {
  return { controls: await value('presenter', '/presenter/controls'), current: await value('presenter', '/presenter/scenarios/current'),
    faults: await value('presenter', '/presenter/scenarios/faults'), catalogue: await value('presenter', '/presenter/scenarios') };
}
const faultLines = (faults) => faults.faults.map((f) => (f.available ? `${f.adapter}: ${f.mode}` : `${f.adapter}: unavailable: ${f.reason}`));
const presenterView = (page) => page.act(PRESENTER_VIEW);
// Compares everything the page renders about clock, scenario, faults and the last tick with direct signed reads.
function matchPage(s, name, v, t) {
  const c = t.controls;
  check(s, `${name}: page current time equals server`, v.clock?.['Current time (UTC)'] === c.now);
  check(s, `${name}: page run equals server`, v.clock?.Run === c.runId);
  check(s, `${name}: page clock version equals server`, num(v.clock?.['Clock version']) === c.clockVersion);
  check(s, `${name}: page scenario, fixture and policy versions equal server`, v.clock?.['Scenario version'] === c.scenarioVersion && v.clock?.['Fixture version'] === c.fixtureVersion && v.clock?.['Policy version'] === c.controls.policyVersion);
  check(s, `${name}: page scenario name equals server current scenario`, !t.current.currentScenario || v.clock?.Scenario === t.current.currentScenario.name);
  check(s, `${name}: page fault lines equal server`, same(v.faults, faultLines(t.faults)));
  const r = c.controls.nextRelease;
  check(s, `${name}: page release line equals server`, v.release === (r.status === 'available' ? `Next release: ${r.at} (UTC)` : r.reason));
  check(s, `${name}: Next release enabled only when the server advertises one`, v.nextReleaseDisabled === (r.status !== 'available'));
  const lt = c.lastTick;
  if (!lt) check(s, `${name}: page shows no last tick as the server has none`, v.tick === null);
  else {
    check(s, `${name}: page last tick readback equals server`, v.tick?.Tick === lt.tickId && v.tick?.State === lt.state && v.tick?.['Time (UTC)'] === lt.now && v.tick?.Run === lt.runId && num(v.tick?.['Clock version']) === lt.clockVersion);
    check(s, `${name}: page handler order and missing stages equal server`, same(v.tickHandlers, lt.handlerOrder.map((h) => `${h.stage}: ${h.handlerId}`)) && same(v.tickMissing, lt.missingStages) && same(v.tickOutcomes, lt.outcomes.map((o) => `${o.stage}: ${o.handlerId}`)));
  }
}
function matchCatalogue(s, name, v, t) {
  const expected = [{ value: '', text: 'Choose a scenario' }, ...t.catalogue.scenarios.map((x) => ({ value: x.scenarioId, text: `${x.name}${x.availability.available ? '' : ': unavailable'}` }))];
  check(s, `${name}: scenario options equal server catalogue`, same(v.scenarioOptions, expected));
}
async function waitPost(page, from, endpoint) {
  const end = Date.now() + 25000;
  while (Date.now() < end) { await page.settle(); const sent = page.calls(from).filter((e) => e.method === 'POST' && e.path === endpoint); if (sent.some((e) => e.response !== undefined || e.failed)) return sent; await sleep(100); }
  throw new Error(`No completed browser POST ${endpoint}`);
}
// One trigger (click or key) must produce exactly one browser POST, then a readback, then no replay.
async function command(page, s, name, endpoint, trigger, expectStatus = 200) {
  const from = page.log.length;
  await trigger();
  await waitPost(page, from, endpoint);
  const post = page.log.slice(from).find((e) => e.method === 'POST' && e.path === endpoint); const at = page.log.indexOf(post);
  const end = Date.now() + 25000;
  for (;;) {
    await page.settle();
    const reread = page.log.slice(at + 1).some((e) => e.method === 'GET' && e.path === '/presenter/controls' && e.status !== undefined);
    if (reread && !(await presenterView(page)).busy) break;
    if (Date.now() > end) throw new Error(`${name}: no settled readback after the command`);
    await sleep(150);
  }
  await sleep(1500); await page.settle();
  const posts = page.calls(from).filter((e) => e.method === 'POST');
  check(s, `${name}: one click or key sent exactly one browser POST to ${endpoint}`, posts.length === 1 && posts[0].path === endpoint);
  check(s, `${name}: browser POST answered ${expectStatus}`, posts[0].status === expectStatus);
  check(s, `${name}: browser POST carries no principal, employee or run selector`, posts[0].request?.carriesPrincipal === false && !posts[0].query);
  s.observations[name] = { endpoint, status: posts[0].status, request: posts[0].request, bodyStatus: posts[0].response?.status, code: posts[0].response?.code };
  return posts[0];
}
async function openPresenter(page, expectReady = true) {
  await freshDocument(page, `${ORIGINS.web}/gcsp/presenter`, { readPath: '/presenter/controls', readOk: false, what: 'presenter page',
    ready: `return !!panel('presenter-clock-heading') ${expectReady ? "&& !document.querySelector('.presenter-screen[aria-busy=\"true\"]') && /Current backend state loaded|Some current state is unavailable/.test(text())" : ''};` });
}
const keyPress = async (page, key, code, vk, text) => {
  await page.send('Page.bringToFront');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text, unmodifiedText: text });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
};
const retain = new Set();
async function snap(page, name) { const f = await page.shot(`${name}.png`); retain.add(`${name}.png`); return f; }
const cspOk = (page) => page.eval(`(() => { const c = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''; return /script-src 'self'(?:;|$)/.test(c) && !c.includes('unsafe-eval') && !c.includes("script-src 'self' 'unsafe-inline'"); })()`);

// ---------- S0: running-deployment stand-in refuses reset and is never changed ----------
let D_RUN = null;
async function runningStandIn(cdp, s) {
  webStaticDir = dirs.staticRun;
  await startApi('running');
  const dPre = digest(DB_RUN); s.observations.D_preCommands = dPre;
  const page = await newPage(cdp, 'running presenter'); await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await signIn(page, 'presenter');
  await openPresenter(page, false);
  await page.until(`return !document.querySelector('.presenter-screen[aria-busy="true"]') && /Current backend state loaded|Some current state is unavailable|could not be read/.test(text());`, 30000, 'running presenter readback settled');
  const v = await presenterView(page); s.observations.runningPage = { status: v.status, catalogueUnavailable: v.catalogueUnavailable, resetTrigger: v.resetTrigger, clock: v.clock };
  const cat = await call('presenter', '/presenter/scenarios');
  const faultsRead = await call('presenter', '/presenter/scenarios/faults');
  s.observations.runningScenarioRead = brief(cat);
  check(s, 'running stand-in scenario catalogue is refused by the server (provider none)', cat.status === 403 && cat.json?.code === 'scenarios-not-configured');
  check(s, 'running stand-in page renders the catalogue as unavailable', v.catalogueUnavailable === true);
  check(s, 'running stand-in page offers no reset control', v.resetTrigger === false && !(await page.act(`return !!button('Reset scenario') || !!button('Confirm reset');`)));
  check(s, 'running stand-in fault readback is refused with the same server code as the catalogue', faultsRead.status === cat.status && faultsRead.json?.code === cat.json?.code);
  const run = await call('presenter', '/presenter/clock');
  if (run.status === 200) { const cv = await value('presenter', '/presenter/controls').catch(() => null); if (cv) check(s, 'running stand-in clock on the page equals server', v.clock?.Run === cv.runId && num(v.clock?.['Clock version']) === cv.clockVersion && v.clock?.['Current time (UTC)'] === cv.now); }
  await snap(page, 's0-running-presenter-desktop');
  check(s, 'running stand-in page made no browser command POST', page.calls().every((e) => e.method === 'GET'));
  await page.close();
  const body = { commandId: newId('s0'), expectedRunId: RUN_ID, scenarioId: 'gcsp-clock-scenario-v1', scenarioVersion: 'v', fixtureVersion: 'v', policyVersion: POLICY };
  const r1 = await call('presenter', '/presenter/scenarios/reset', body); const r2 = await call('presenter', '/presenter/clock/reset', body);
  s.observations.directResets = { scenariosReset: brief(r1), clockReset: brief(r2) };
  check(s, 'direct presenter POST /presenter/scenarios/reset on the running stand-in is refused 403', r1.status === 403 && r1.json?.status === 'forbidden');
  check(s, 'direct presenter POST /presenter/clock/reset on the running stand-in is refused 403', r2.status === 403 && r2.json?.status === 'forbidden');
  check(s, 'running database digest is unchanged by the presenter page and both refused resets', digest(DB_RUN) === dPre);
  await stopApi();
  D_RUN = digest(DB_RUN); s.observations.D_run = D_RUN;
  check(s, 'running database digest D_run recorded after the stand-in stopped', /^[0-9a-f]{32}$/.test(D_RUN));
  // A composition that would allow reset over the running database must refuse to start (FUCQ-456 P6 behaviour).
  const guard = spawnApi('running', { GCSP_SCENARIO_PROVIDER: 'demo', GCSP_RESET_ALLOWED: 'true' });
  let served = false;
  for (let i = 0; i < 240 && !guard.done; i++) { try { const r = await request('GET', '/context'); if (r.status === 401) { served = true; break; } } catch { /* not up */ } await sleep(500); }
  if (served) {
    const r = await call('presenter', '/presenter/scenarios/reset', body);
    s.observations.guardServedReset = brief(r);
    check(s, 'a reset-allowed composition over the running database, if it starts, still refuses reset 403', r.status === 403);
    await stopApi();
  } else {
    await Promise.race([guard.exited, sleep(10000)]);
    s.observations.guardStartup = { exitCode: guard.exitCode ?? null, done: guard.done, log: tail(guard.logFile, 6).slice(-600) };
    check(s, 'a reset-allowed demo composition over the running database refuses to start', guard.done === true && /does not allow reset/.test(tail(guard.logFile, 200)));
  }
  check(s, 'running database digest is unchanged by the refused reset-allowed start', digest(DB_RUN) === D_RUN);
}

// ---------- S1: AC1 on the isolated dev composition ----------
async function devControls(cdp, s, ctx) {
  webStaticDir = dirs.staticDev;
  await startApi('dev');
  const page = await newPage(cdp, 'dev presenter'); ctx.page = page;
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await signIn(page, 'presenter');
  await openPresenter(page);
  let t = await truth(); ctx.run1 = t.controls.runId;
  let v = await presenterView(page);
  check(s, 'dev composition is the isolated dev environment on its own database', psql(DB_DEV, 'select environment_id from environment_identity') === ENV_DEV && psql(DB_DEV, 'select reset_allowed from environment_identity') === 't');
  matchPage(s, 'initial load', v, t); matchCatalogue(s, 'initial load', v, t);
  check(s, 'initial load: server advertises a next release and the stock fault', t.controls.controls.nextRelease.status === 'available' && t.faults.faults.find((f) => f.adapter === 'stock')?.available === true);
  check(s, 'initial load: page status reports current backend state loaded', /Current backend state loaded/.test(v.status));
  const step = t.controls.controls.step.value; const releaseAt = Date.parse(t.controls.controls.nextRelease.at);
  check(s, 'initial load: step, advance and tick leave the release in the future', releaseAt - Date.parse(t.controls.now) > (step + 90 + 60) * 1000);
  check(s, 'initial load: Step label shows the server step', v.stepLabel === `Step ${step} seconds`);

  // Step, activated natively by the Enter key.
  let before = t.controls;
  await page.act(`buttonStarting('Step ').focus(); return true;`);
  check(s, 'Step has native keyboard focus', await page.act(`return document.activeElement === buttonStarting('Step ');`));
  const stepPost = await command(page, s, 'Step by Enter', '/presenter/controls/tick', () => keyPress(page, 'Enter', 'Enter', 13, '\r'));
  t = await truth(); v = await presenterView(page);
  check(s, 'Step: browser request was mode step against the page clock version', stepPost.request?.mode === 'step' && stepPost.request?.expectedClockVersion === before.clockVersion);
  check(s, 'Step: server clock version advanced by exactly one', t.controls.clockVersion === before.clockVersion + 1);
  check(s, 'Step: server time advanced by the configured step', Date.parse(t.controls.now) - Date.parse(before.now) === step * 1000);
  check(s, 'Step: server last tick is the browser response tick and completed', t.controls.lastTick?.tickId === stepPost.response?.value?.tick?.tickId && t.controls.lastTick?.state === 'completed');
  check(s, 'Step: native Enter activation leaves focus on the status as the component does', v.focusStatus === true);
  matchPage(s, 'after Step', v, t);

  // Advanced: advance by seconds, then tick the current time with a reference.
  before = t.controls;
  await page.act(`main.querySelector('details.presenter-details > summary').click(); return true;`);
  await page.until(`return !!$('input[id$="-seconds"]') && $('input[id$="-seconds"]').offsetParent !== null;`, 5000, 'advanced controls open');
  await page.act(`return setValue('input[id$="-seconds"]', '90');`);
  const advPost = await command(page, s, 'Advance clock by seconds', '/presenter/clock/advance', () => page.act(`return press('Advance clock');`));
  t = await truth(); v = await presenterView(page);
  check(s, 'Advance: browser request was bySeconds 90 against the page clock version', advPost.request?.bySeconds === 90 && advPost.request?.expectedClockVersion === before.clockVersion);
  check(s, 'Advance: server time moved by 90 seconds and clock version by one', Date.parse(t.controls.now) - Date.parse(before.now) === 90000 && t.controls.clockVersion === before.clockVersion + 1);
  matchPage(s, 'after Advance', v, t);
  const ref = `f450-tick-${randomBytes(4).toString('hex')}`;
  await page.act(`return setValue('input[id$="-tick"]', ${JSON.stringify(ref)});`);
  const tickPost = await command(page, s, 'Tick current time with a reference', '/presenter/clock/tick', () => page.act(`return press('Tick current time');`));
  t = await truth(); v = await presenterView(page);
  const refTick = await value('presenter', `/presenter/clock/ticks/${ref}`);
  check(s, 'Tick: browser request used the typed reference at the page clock version', tickPost.request?.tickId === ref && tickPost.request?.expectedClockVersion === t.controls.clockVersion);
  check(s, 'Tick: server holds the referenced tick completed and as the last tick', refTick.state === 'completed' && t.controls.lastTick?.tickId === ref);
  matchPage(s, 'after Tick', v, t);

  // Fault: unavailable stock interrupts Next release; clearing it and retrying the same command completes the same tick.
  const setFault = async (name, mode, retained) => {
    await page.act(`return setValue('select[id$="-fault"]', 'stock');`);
    await page.until(`const el = $('select[id$="-mode"]'); return !!el && !el.disabled && [...el.options].some((o) => o.value === ${JSON.stringify(mode)});`, 10000, `fault mode ${mode} offered`);
    await page.act(`return setValue('select[id$="-mode"]', ${JSON.stringify(mode)});`);
    await page.until(`const b = button('Set fault mode'); return !!b && !b.disabled;`, 10000, 'Set fault mode enabled');
    return command(page, s, name, '/presenter/scenarios/faults', () => page.act(`return press('Set fault mode');`));
  };
  const f1 = await setFault('Set stock fault unavailable', 'unavailable');
  t = await truth(); v = await presenterView(page);
  check(s, 'Fault: browser request named stock and unavailable', f1.request?.adapter === 'stock' && f1.request?.mode === 'unavailable');
  check(s, 'Fault: server shows stock unavailable for the active run', t.faults.runId === t.controls.runId && t.faults.faults.find((f) => f.adapter === 'stock')?.mode === 'unavailable');
  matchPage(s, 'after fault set', v, t);

  before = t.controls;
  const relPost = await command(page, s, 'Next release with the fault set', '/presenter/controls/tick', () => page.act(`return press('Next release');`), 503);
  const tickId = relPost.response?.tickId; ctx.tickId = tickId;
  t = await truth(); v = await presenterView(page);
  const interrupted = await value('presenter', `/presenter/clock/ticks/${tickId}`);
  const latest1 = await value('presenter', '/presenter/releases/latest');
  check(s, 'Next release: browser request was mode next-release', relPost.request?.mode === 'next-release' && relPost.request?.expectedClockVersion === before.clockVersion);
  check(s, 'Next release: server answered handler-interrupted for stock-release', relPost.response?.code === 'handler-interrupted' && relPost.response?.handlerId === 'stock-release');
  s.observations.afterInterrupt = { tick: interrupted.state, latestRelease: latest1.release, now: t.controls.now, releaseAt: before.controls.nextRelease.at, namedTimes: before.namedTimes, response: relPost.response };
  check(s, 'Next release: server holds the tick interrupted and no release yet', interrupted.state === 'interrupted' && latest1.release === null);
  check(s, 'Next release: the clock moved to the release time on the server and the page', t.controls.now === before.controls.nextRelease.at && v.clock?.['Current time (UTC)'] === t.controls.now);
  check(s, 'Next release: page offers the deliberate retry and shows the refusal', v.retryButton === true && /Request refused|Command outcome/.test(v.status));
  matchPage(s, 'after interrupted release', v, t);
  const postsAfterInterrupt = page.calls().filter((e) => e.method === 'POST').length;
  await sleep(2500); await page.settle();
  check(s, 'No automatic replay: no further browser POST after the interrupted command', page.calls().filter((e) => e.method === 'POST').length === postsAfterInterrupt);

  const f2 = await setFault('Clear stock fault to none during recovery', 'none');
  t = await truth(); v = await presenterView(page);
  check(s, 'Recovery: browser request cleared the stock fault', f2.request?.mode === 'none');
  check(s, 'Recovery: server shows stock none and the tick still interrupted', t.faults.faults.find((f) => f.adapter === 'stock')?.mode === 'none' && (await value('presenter', `/presenter/clock/ticks/${tickId}`)).state === 'interrupted');
  const postsBeforeRetry = page.calls().filter((e) => e.method === 'POST').length;
  const retry = await command(page, s, 'Retry the same command', '/presenter/controls/tick', () => page.act(`return press('Retry the same command');`));
  t = await truth(); v = await presenterView(page);
  const done = await value('presenter', `/presenter/clock/ticks/${tickId}`); const latest2 = await value('presenter', '/presenter/releases/latest');
  check(s, 'Retry: the browser re-sent the identical command identity and inputs', same(retry.request, relPost.request));
  check(s, 'Retry: server completed the same tick id', retry.response?.value?.tick?.tickId === tickId && done.state === 'completed' && t.controls.lastTick?.tickId === tickId);
  check(s, 'Retry: server release reflects the pulled release', !!latest2.release?.trancheId && t.controls.lastTick?.outcomes.some((o) => o.handlerId === 'stock-release' && o.outcome?.value?.kind === 'stock-released'));
  check(s, 'Retry: page no longer offers retry and shows the completed tick', v.retryButton === false && v.tick?.State === 'completed');
  check(s, 'Retry: exactly one extra POST for the deliberate retry', page.calls().filter((e) => e.method === 'POST').length === postsBeforeRetry + 1);
  matchPage(s, 'after retry', v, t);

  // Reset: choose a scenario, review, confirm.
  const chosen = t.catalogue.scenarios.find((x) => x.availability.available);
  check(s, 'Reset: the server catalogue has an available scenario', !!chosen);
  await page.act(`return setValue('select[id$="-scenario"]', ${JSON.stringify(chosen.scenarioId)});`);
  await page.until(`const b = $('[data-reset-trigger]'); return !!b && !b.disabled;`, 10000, 'Reset scenario enabled');
  const resetFrom = page.log.length;
  await page.act(`return press('Reset scenario');`);
  await page.until(`return document.activeElement?.matches('[data-reset-review]');`, 10000, 'review heading focused');
  const review = await page.act(`const p = main.querySelector('.presenter-confirmation'); return { heading: norm(p?.querySelector('h3')?.textContent), facts: p ? Object.fromEntries(facts(p)) : null };`);
  check(s, 'Reset review: focus lands on the review heading and nothing was sent yet', review.heading === 'Confirm scenario reset' && page.calls(resetFrom).every((e) => e.method !== 'POST'));
  check(s, 'Reset review: facts name the run to replace and the chosen scenario versions', review.facts?.['Run to replace'] === t.controls.runId && review.facts?.Scenario === chosen.scenarioId && review.facts?.['Scenario version'] === chosen.scenarioVersion && review.facts?.['Fixture version'] === chosen.fixtureVersion && review.facts?.['Policy version'] === chosen.policyVersion);
  const oldTicks = psql(DB_DEV, `select count(*) from clock_ticks where run_id = '${t.controls.runId}'`);
  const resetPost = await command(page, s, 'Confirm reset', '/presenter/scenarios/reset', () => page.act(`return press('Confirm reset');`));
  const afterReset = await value('presenter', '/presenter/scenarios/current'); v = await presenterView(page);
  ctx.run2 = afterReset.runId;
  check(s, 'Reset: browser request named the run to replace and the chosen scenario', resetPost.request?.expectedRunId === ctx.run1 && resetPost.request?.scenarioId === chosen.scenarioId);
  check(s, 'Reset: server activated a new run for the chosen scenario', afterReset.runId !== ctx.run1 && resetPost.response?.value?.activatedRunId === afterReset.runId && resetPost.response?.value?.retiredRunId === ctx.run1 && afterReset.currentScenario?.scenarioId === chosen.scenarioId);
  check(s, 'Reset: retired run keeps its rows', psql(DB_DEV, `select count(*) from clock_ticks where run_id = '${ctx.run1}'`) === oldTicks);
  check(s, 'Reset: page acknowledges the activated run and asks for a sign-in context refresh', v.status.includes(`Activated run: ${afterReset.runId}`) && v.status.includes('Refresh sign-in context'));
  await page.act(`return press('Refresh sign-in context');`);
  await page.until(`return !document.querySelector('.presenter-screen[aria-busy="true"]') && !!panel('presenter-clock-heading')?.querySelector('dl') && panel('presenter-clock-heading').textContent.includes(${JSON.stringify(afterReset.runId)});`, 30000, 'page reads the new run');
  await page.settle(); await sleep(500); await page.settle();
  t = await truth(); v = await presenterView(page);
  check(s, 'Reset: page now shows the new run and scenario from the server', v.clock?.Run === afterReset.runId && v.clock?.Scenario === chosen.name);
  check(s, 'Reset: the new run has no fault and no last tick, as on the server', t.faults.runId === afterReset.runId && t.faults.faults.find((f) => f.adapter === 'stock')?.mode === 'none' && t.controls.lastTick === null);
  matchPage(s, 'after reset', v, t); matchCatalogue(s, 'after reset', v, t);
  check(s, 'Whole flow: every browser POST was one deliberate click (8 commands)', page.calls().filter((e) => e.method === 'POST').length === 8);
  check(s, 'Whole flow: no browser POST carried a selector or principal', page.calls().filter((e) => e.method === 'POST').every((e) => e.request?.carriesPrincipal === false && !e.query));
  check(s, 'Whole flow: no JavaScript exception', page.errors.length === 0);
  ctx.postsByPath = Object.fromEntries([...new Set(page.calls().filter((e) => e.method === 'POST').map((e) => e.path))].map((p) => [p, page.calls().filter((e) => e.method === 'POST' && e.path === p).length]));
  await snap(page, 's1-presenter-desktop');
  check(s, 'Desktop 1280: no horizontal overflow', v.overflow === false);
}
function serverPostCounts() {
  const rows = {};
  for (const p of receipt.processes.filter((x) => x.name.endsWith('-dev'))) {
    for (const l of readFileSync(path.join(dirs.logs, `${p.name}.log`), 'utf8').split('\n')) { const m = /ACCESSLOG POST (\S+) (200|503)$/.exec(l.trim()); if (m) { const k = m[1].replace(API_PATH, ''); rows[k] = (rows[k] ?? 0) + 1; } }
  }
  return rows;
}

// ---------- S3: viewports, private context, keyboard Space, CSP (dev JVM still running) ----------
async function viewports(cdp, s, ctx) {
  const page = ctx.page;
  await page.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const v = await presenterView(page);
  await snap(page, 's1-presenter-narrow');
  check(s, 'Narrow 400: no horizontal overflow and controls still rendered', v.overflow === false && v.stepLabel !== null);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.act(`document.querySelector('[data-presenter-status]').blur(); button('Refresh current state').focus(); return true;`);
  const from = page.log.length;
  await keyPress(page, ' ', 'Space', 32, ' ');
  await page.until(`return document.activeElement?.matches('[data-presenter-status]') && !document.querySelector('.presenter-screen[aria-busy="true"]');`, 15000, 'Space refresh focuses status');
  await page.settle();
  check(s, 'Keyboard Space activates Refresh current state natively: GET reads only and focus lands on the status', page.calls(from).length >= 4 && page.calls(from).every((e) => e.method === 'GET') && (await presenterView(page)).focusStatus);
  check(s, 'Deployed CSP is served with the page and forbids unsafe-eval', await cspOk(page));
  await page.close();
  // One isolated private context: no session, no API reads, then its own sign-in.
  const priv = await newPage(cdp, 'private context');
  await priv.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 800, deviceScaleFactor: 1, mobile: false });
  await priv.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/presenter` });
  await priv.until(`return location.origin === '${ORIGINS.web}' && !!button('Sign in');`, 30000, 'private context sign-in guard');
  check(s, 'Private context: no session carried over and no API read before sign-in', priv.calls().length === 0 && await priv.act(`return !panel('presenter-clock-heading');`));
  await signIn(priv, 'presenter');
  await openPresenter(priv);
  const t = await truth(); const pv = await presenterView(priv);
  matchPage(s, 'private context', pv, t);
  await snap(priv, 's3-private-narrow');
  check(s, 'Private context narrow: no horizontal overflow and no exception', pv.overflow === false && priv.errors.length === 0);
  check(s, 'Private context sent no browser POST', priv.calls().every((e) => e.method === 'GET'));
  await priv.close();
}

// ---------- S2: read-only inspection, refusals and no impersonation ----------
const PRESENTER_GETS = ['/presenter/clock', '/presenter/controls', '/presenter/scenarios', '/presenter/scenarios/current', '/presenter/scenarios/faults', '/presenter/outbox', '/presenter/releases/latest'];
const PRESENTER_POSTS = [['/presenter/clock/advance', { commandId: 'x-adv', expectedClockVersion: 1, bySeconds: 1 }], ['/presenter/clock/tick', { tickId: 'x-tick', expectedClockVersion: 1 }],
  ['/presenter/controls/tick', { commandId: 'x-ctl', expectedClockVersion: 1, mode: 'step' }], ['/presenter/scenarios/reset', { commandId: 'x-rst', expectedRunId: RUN_ID, scenarioId: 'a', scenarioVersion: 'v', fixtureVersion: 'v', policyVersion: 'v' }],
  ['/presenter/scenarios/faults', { commandId: 'x-flt', adapter: 'stock', mode: 'none' }]];
async function readOnly(cdp, s, ctx) {
  const before = digest(DB_DEV);
  const page = await newPage(cdp, 'presenter inspection'); await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await signIn(page, 'presenter'); await openPresenter(page);
  const from = page.log.length;
  await page.act(`const a = [...main.querySelectorAll('a')].find((x) => x.textContent.trim() === 'Outbox'); if (!a) return false; a.click(); return true;`);
  await page.until(`return location.pathname === '/gcsp/presenter/outbox' && /No emails yet|Captured, not sent/.test(text());`, 30000, 'outbox opened from the presenter page');
  const outbox = await value('presenter', '/presenter/outbox');
  check(s, 'Presenter outbox page renders the server outbox read-only', outbox.runId === ctx.run2 && (outbox.messages.length === 0 ? true : await page.act(`return !!$('.gcsp-mail-row');`)));
  await snap(page, 's2-outbox-presenter');
  await page.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/presenter` });
  await page.until(`return !!panel('presenter-clock-heading') && !document.querySelector('.presenter-screen[aria-busy="true"]') && /Current backend state loaded/.test(text());`, 30000, 'presenter page again');
  await page.act(`const a = [...main.querySelectorAll('a')].find((x) => x.textContent.trim() === 'Process comparisons'); if (!a) return false; a.click(); return true;`);
  await page.until(`return location.pathname === '/gcsp/comparison' && /Active policy|Stored results|Experiment/.test(text());`, 30000, 'comparison opened from the presenter page');
  await page.settle(); await sleep(800); await page.settle();
  const cmp = await page.act(`return { command: !!document.getElementById('comparison-command-title'), start: !!buttonStarting('Start comparison') || !!buttonStarting('Retry same command'), fields: !!$('#comparison-values') || !!$('#comparison-basis'), text: text().slice(0, 240) };`);
  await snap(page, 's2-comparison-presenter');
  const calls = page.calls(from);
  check(s, 'Presenter inspection pages made API reads only: zero non-GET requests', calls.length > 0 && calls.every((e) => e.method === 'GET'));
  check(s, 'Presenter inspection reads carry a bearer token and no selector query', calls.every((e) => e.auth && !e.query));
  check(s, 'Presenter inspection read the outbox and comparison results', calls.some((e) => e.path === '/presenter/outbox' && e.status === 200) && calls.some((e) => e.path.startsWith('/comparison/') && e.status === 200));
  check(s, 'Presenter comparison page renders no Greg command control or draft field', cmp.command === false && cmp.start === false && cmp.fields === false);
  await page.close();

  // Greg sees the command section; Greg and employee cannot use presenter controls in the browser.
  const greg = await newPage(cdp, 'greg comparison'); await greg.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await signIn(greg, 'greg');
  await greg.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/comparison` });
  await greg.until(`return /Active policy/.test(text()) && !!document.getElementById('comparison-command-title');`, 30000, 'Greg comparison command section');
  check(s, 'Greg own login renders the comparison command section and Start control the presenter lacks', await greg.act(`return !!document.getElementById('comparison-command-title') && !!buttonStarting('Start comparison');`));
  await greg.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/presenter` });
  await greg.until(`return !!$('gcsp-status-screen') && !panel('presenter-clock-heading');`, 20000, 'Greg refused on presenter route');
  await greg.settle();
  check(s, 'Greg on the presenter route sees no presenter controls and makes no presenter read', !greg.calls().some((e) => e.path.startsWith('/presenter')) && await greg.act(`return !buttonStarting('Step ') && !button('Next release') && !$('[data-reset-trigger]');`));
  await greg.close();
  const emp = await newPage(cdp, 'employee presenter route'); await emp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await signIn(emp, 'paula');
  await emp.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/presenter` });
  await emp.until(`return !!$('gcsp-status-screen') && !panel('presenter-clock-heading');`, 20000, 'employee refused on presenter route');
  await emp.settle();
  check(s, 'Employee on the presenter route sees no presenter controls and makes no presenter read', !emp.calls().some((e) => e.path.startsWith('/presenter')) && await emp.act(`return !buttonStarting('Step ') && !button('Next release') && !$('[data-reset-trigger]');`));
  await emp.close();

  // Direct API permission refusals.
  check(s, 'Anonymous presenter GET is refused 401', (await request('GET', '/presenter/controls')).status === 401);
  check(s, 'Anonymous presenter POST is refused 401', (await request('POST', '/presenter/controls/tick', { 'Content-Type': 'application/json' }, { commandId: 'x', expectedClockVersion: 1, mode: 'step' })).status === 401);
  for (const who of ['paula', 'greg']) {
    const gets = []; for (const p of PRESENTER_GETS) gets.push([p, (await call(who, p)).status]);
    const posts = []; for (const [p, b] of PRESENTER_POSTS) posts.push([p, (await call(who, p, b)).status]);
    s.observations[`${who}PresenterRefusals`] = { gets, posts };
    check(s, `${who} token is refused 403 on every presenter GET route`, gets.every(([, st]) => st === 403));
    check(s, `${who} token is refused 403 on every presenter POST route`, posts.every(([, st]) => st === 403));
  }
  const empCmd = await call('presenter', '/manual/notification-email', { commandId: newId('emp'), expectedVersion: 0, deliveryEmail: 'presenter@example.test' });
  const gregCmd = await call('presenter', '/comparison/jobs', { experimentId: 'process-only', commandId: newId('greg') });
  s.observations.presenterOnOthersCommands = { employee: brief(empCmd), greg: brief(gregCmd) };
  check(s, 'Presenter token is refused 403 on an employee command', empCmd.status === 403);
  check(s, 'Presenter token is refused 403 on the Greg comparison start command', gregCmd.status === 403);
  check(s, 'Presenter and Greg may read comparison results; an employee may not', (await call('presenter', '/comparison/results/latest')).status === 200 && (await call('greg', '/comparison/results/latest')).status === 200 && (await call('paula', '/comparison/results/latest')).status === 403);

  // Impersonation: presenter requests cannot select another principal, employee or run.
  const pre = await value('presenter', '/presenter/controls');
  const refused = [];
  for (const q of ['principalId=sub-greg', 'employeeId=employee-paula', 'runId=run-1']) refused.push([`GET /presenter/controls?${q}`, (await call('presenter', `/presenter/controls?${q}`)).status]);
  refused.push(['GET /presenter/scenarios/faults?runId=x', (await call('presenter', '/presenter/scenarios/faults?runId=x')).status]);
  refused.push(['GET /presenter/outbox?employeeId=employee-paula', (await call('presenter', '/presenter/outbox?employeeId=employee-paula')).status]);
  refused.push(['GET /comparison/results/latest?principalId=sub-greg', (await call('presenter', '/comparison/results/latest?principalId=sub-greg')).status]);
  const sel = await request('POST', '/presenter/controls/tick?employeeId=employee-paula', { Authorization: `Bearer ${tokenFor('presenter')}`, 'Content-Type': 'application/json' }, { commandId: newId('imp'), expectedClockVersion: pre.clockVersion, mode: 'step' });
  refused.push(['POST /presenter/controls/tick?employeeId=', sel.status]);
  const extra = await call('presenter', '/presenter/controls/tick', { commandId: newId('imp'), expectedClockVersion: pre.clockVersion, mode: 'step', principalId: 'sub-greg' });
  refused.push(['POST /presenter/controls/tick body principalId', extra.status]);
  s.observations.impersonationAttempts = refused;
  check(s, 'Selector query parameters and principal fields on presenter requests are refused 400', refused.every(([, st]) => st === 400));
  const post = await value('presenter', '/presenter/controls');
  check(s, 'Refused impersonation attempts changed no clock state', pre.clockVersion === post.clockVersion && pre.now === post.now && pre.runId === post.runId);
  check(s, 'Refusal matrix left the dev database digest unchanged', digest(DB_DEV) === before);
  // The page cannot switch principal: only the documented controls exist, and the source holds no act-as request.
  const view = ctx.lastView;
  check(s, 'Presenter page renders only clock, scenario, fault and tick fields (no principal, employee or run switcher)', view.controlIds.every((id) => ['advance-kind', 'seconds', 'target', 'tick', 'scenario', 'fault', 'mode'].includes(id)) && view.controlIds.length > 0);
  const src = readdirSync(path.join(ROOT, 'apps/gcsp-web/src/app/presenter')).filter((f) => /\.(ts|html)$/.test(f) && !/\.spec\.ts$/.test(f)).map((f) => readFileSync(path.join(ROOT, 'apps/gcsp-web/src/app/presenter', f), 'utf8')).join('\n');
  check(s, 'Presenter source holds no impersonation, act-as or selector query construction', !/impersonat|act[-_ ]?as\b|actAs|switch[-_ ]?(principal|user|account|employee)|principalId|searchParams|URLSearchParams|\?[A-Za-z]+=|['"]X-[A-Za-z-]+['"]/i.test(src));
  const prevention = await call('presenter', '/presenter/controls');
  check(s, 'Presenter still reads its own controls after the refusals', prevention.status === 200);
}

// ---------- resources, main, teardown, receipt ----------
let sampler = null;
function sampleRss() {
  const groups = new Set(owned.filter((c) => !c.done).map((c) => c.pid));
  const r = spawnSync('/bin/ps', ['-axo', 'pgid=,rss='], { encoding: 'utf8', timeout: 3000 });
  let kib = 0; for (const l of (r.stdout ?? '').split('\n')) { const [g, rss] = l.trim().split(/\s+/).map(Number); if (groups.has(g)) kib += rss; }
  receipt.resources.peakRssMiB = Math.max(receipt.resources.peakRssMiB, Math.round(kib / 1024));
}
function dbReset() {
  const admin = (q) => execFileSync(PSQL, ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-h', PG.host, '-p', String(PG.port), '-U', PG.user, '-d', 'postgres', '-c', q], { encoding: 'utf8', timeout: 60000, env: { PATH: process.env.PATH, HOME: process.env.HOME, PGCONNECT_TIMEOUT: '10' } }).trim();
  for (const db of [DB_DEV, DB_RUN]) { admin(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`); admin(`CREATE DATABASE ${db}`); }
  return admin('SHOW server_version_num');
}
async function main() {
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  mkdirSync(EVIDENCE, { recursive: true });
  for (const [k, p] of Object.entries(PORTS)) if (!(await portFree(p))) throw new Error(`port ${p} (${k}) is in use`);
  const stray = spawnSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /quarkus-run\.jar/.test(l) && !/spawnSync|grep/.test(l));
  if (stray.length) throw new Error(`another gcsp JVM is running; wait for it: ${stray[0].slice(0, 120)}`);
  sampler = setInterval(sampleRss, 3000);
  const planInfo = writePlan();
  const serverVersion = dbReset();
  if (!/^17[0-9]{4}$/.test(serverVersion)) throw new Error(`Owned database must be native PostgreSQL 17; server_version_num=${serverVersion}`);
  receipt.inputs = { scratch: PROOF, evidence: path.relative(ROOT, EVIDENCE), databases: { host: PG.host, port: PG.port, dev: DB_DEV, running: DB_RUN, serverVersionNum: serverVersion }, ports: PORTS,
    jar: { path: path.relative(ROOT, JAR), sha256: sha256File(JAR) }, appJars: readdirSync(path.join(path.dirname(JAR), 'app')).filter((f) => f.endsWith('.jar')).map((f) => ({ file: f, sha256: sha256File(path.join(path.dirname(JAR), 'app', f)) })),
    webBrowser: { path: path.relative(ROOT, WEB_BROWSER), indexSha256: sha256File(path.join(WEB_BROWSER, 'index.html')) }, fixtures: { tranchePlan: planInfo, supplyPolicy: sha256File(path.join(SUPPLY, 'policy.json')), returnsPolicy: sha256File(RETURNS_POLICY) } };
  receipt.composition = { running: { environmentId: ENV_RUN, database: DB_RUN, scenarioProvider: 'none', accountProvider: 'none', resetAllowed: false, note: 'local stand-in for the running deployment (FUCQ-456 poc shape)' },
    dev: { environmentId: ENV_DEV, database: DB_DEV, scenarioProvider: 'demo', accountProvider: 'repository', resetAllowed: true, supply: 'tranche-plan (repo test fixture)', appointments: 'synthetic', returns: 'synthetic', jvm: '-Xmx512m, one JVM at a time' } };
  receipt.tools = { harnessNode: process.version, openssl: cap('openssl', ['version']), chrome: cap(CHROME, ['--version']), java: (spawnSync(path.join(JAVA_HOME, 'bin/java'), ['-version'], { encoding: 'utf8', env: childEnv(process.env) }).stderr ?? '').split('\n')[0] };
  log('certificates'); tls = makeCerts();
  log('static assembly of the prebuilt web for both environments');
  const assemble = await import(pathToFileURL(path.join(ROOT, 'scripts/build-gcsp-static.mjs')).href);
  for (const [env, out] of [[ENV_RUN, dirs.staticRun], [ENV_DEV, dirs.staticDev]]) {
    await runOnce(`assemble-${env}`, process.execPath, ['scripts/build-gcsp-static.mjs', '--browser', WEB_BROWSER, '--output', out, '--environment', 'deployed', '--revision', SOURCE_REVISION],
      { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp, GCSP_PUBLIC_ENVIRONMENT_ID: env, GCSP_PUBLIC_API_BASE_URL: API_BASE, GCSP_PUBLIC_OIDC_AUTHORITY: ISSUER, GCSP_PUBLIC_OIDC_CLIENT_ID: 'gcsp-web',
        GCSP_PUBLIC_OIDC_SCOPE: 'openid profile gcsp-api', GCSP_PUBLIC_OIDC_REDIRECT_URI: `${ORIGINS.web}/gcsp/auth/callback`, GCSP_PUBLIC_OIDC_POST_LOGOUT_REDIRECT_URI: `${ORIGINS.web}/gcsp/` });
  }
  await startIdp(tls); await startWeb(tls, assemble.GCSP_FIXED_ROUTES);
  const profile = path.join(dirs.browser, 'profile'); mkdirSync(profile, { recursive: true });
  const chrome = spawnOwned('chrome', CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-allow-origins=*', `--ignore-certificate-errors-spki-list=${tls.spki}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--window-size=1280,900', 'about:blank'], { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp });
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) { if (chrome.done) throw new Error('Chrome exited during startup'); try { const [p, ws] = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n'); wsUrl = `ws://127.0.0.1:${p}${ws}`; } catch { await sleep(250); } }
  if (!wsUrl) throw new Error('Chrome DevTools endpoint not found');
  const cdp = await Cdp.connect(wsUrl); receipt.cdp = cdp;
  const ctx = {};
  await scenario('S0', 'Running-deployment stand-in: reset refused, database unchanged', 'AC1', (s) => runningStandIn(cdp, s));
  await scenario('S1', 'Isolated dev: clock, tick/release, scenario/reset and fault/retry operate real backend state', 'AC1', async (s) => { await devControls(cdp, s, ctx); ctx.lastView = await presenterView(ctx.page); });
  await scenario('S3', 'Desktop and narrow viewports, private context, keyboard and CSP', 'AC1', (s) => viewports(cdp, s, ctx));
  await scenario('S2', 'Read-only inspection, direct permission refusals and no impersonation', 'AC2', (s) => readOnly(cdp, s, ctx));
  await scenario('S4', 'Server-side command counts and running-database isolation after all dev activity', 'AC1', async (s) => {
    const server = serverPostCounts(); s.observations.serverPostCounts = server; s.observations.browserPostCounts = ctx.postsByPath;
    const expected = { '/presenter/controls/tick': 3, '/presenter/clock/advance': 1, '/presenter/clock/tick': 1, '/presenter/scenarios/faults': 2, '/presenter/scenarios/reset': 1 };
    check(s, 'Browser POST counts per route match one per deliberate click', same(ctx.postsByPath, expected));
    check(s, 'Server access log recorded exactly the same executed POSTs per route (no hidden replay)', same(Object.fromEntries(Object.entries(server).sort()), Object.fromEntries(Object.entries(expected).sort())));
    await stopApi();
    check(s, 'Running database digest still equals D_run after all dev activity and reset', digest(DB_RUN) === D_RUN);
  });
}
function teardown() {
  if (teardownPromise) return teardownPromise;
  teardownPromise = (async () => {
    if (sampler) clearInterval(sampler);
    try { receipt.cdp?.ws.close(); } catch { /* closed */ }
    delete receipt.cdp;
    for (const child of owned.slice().reverse()) { try { await child.stop(); await child.logClosed; } catch (e) { log('stop error', child.pid, e.message); } }
    await closeServer(webServer); await closeServer(idp.server);
    receipt.teardown = { ownedProcesses: receipt.processes.map((p) => ({ name: p.name, pid: p.pid, exit: p.exit })), allOwnedExited: owned.every((c) => c.done), serversClosed: true };
  })();
  return teardownPromise;
}
function finish(runError) {
  if (finished) return; finished = true;
  const sc = receipt.scenarios; const ok = (k) => sc[k]?.pass === true;
  receipt.endedAt = new Date().toISOString(); receipt.elapsedSeconds = Math.round((Date.now() - T0) / 1000);
  if (runError) receipt.runError = runError;
  receipt.logBudget ??= { limitBytes: CHILD_LOG_LIMIT, writtenBytes: childLogBytes, exhausted: false };
  const names = (id, re) => Object.keys(sc[id]?.checks ?? {}).filter((n) => !re || re.test(n));
  receipt.originalAcceptance = {
    AC1: { text: 'Clock, tick/release, scenario/reset and fault/retry controls operate actual backend state with current outcomes.', localEvidence: ok('S0') && ok('S1') && ok('S3') && ok('S4') ? 'pass' : 'incomplete', checks: { S0: names('S0'), S1: names('S1'), S3: names('S3'), S4: names('S4') } },
    AC2: { text: 'Outbox/comparison and other permitted inspection are read-only. Employee/Greg actions require the respective account login.', localEvidence: ok('S2') ? 'pass' : 'incomplete', checks: { S2: names('S2') } } };
  receipt.checkCounts = Object.fromEntries(Object.entries(sc).map(([k, v]) => [k, Object.keys(v.checks).length]));
  receipt.overall = ['S0', 'S1', 'S3', 'S2', 'S4'].every(ok) && !runError && !logLimitFailure && receipt.teardown?.allOwnedExited ? 'PASS' : 'FAIL';
  if (receipt.overall !== 'PASS') for (const f of readdirSync(dirs.logs)) { const t = tail(path.join(dirs.logs, f), 40); if (t) receipt.failureLogs[f] = t; }
  try { for (const f of retain) copyFileSync(path.join(dirs.evidence, f), path.join(EVIDENCE, f)); } catch (e) { receipt.evidenceCopyError = e.message; }
  // Remove only this run's owned scratch (absolute path, inside the parent-owned root), and only when every child exited.
  const cleanup = { scratch: PROOF, removed: false };
  if (receipt.teardown?.allOwnedExited && PROOF.startsWith(`${SCRATCH_ROOT}${path.sep}runs${path.sep}`)) { try { rmSync(PROOF, { recursive: true, force: true }); } catch (e) { cleanup.error = e.message; } }
  cleanup.removed = !existsSync(PROOF); receipt.cleanup = cleanup;
  const file = path.join(EVIDENCE, 'receipt.json');
  try { mkdirSync(EVIDENCE, { recursive: true }); writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`); } catch (e) { console.error('receipt write failed', e.message); }
  for (const k of Object.keys(sc).sort()) console.log(`  ${k}: ${sc[k].pass ? 'PASS' : 'FAIL'} (${Object.keys(sc[k].checks).length} checks) ${sc[k].title}${sc[k].pass ? '' : ` [failed: ${Object.entries(sc[k].checks).filter(([, v]) => v !== true).map(([n]) => n).join(', ')}${sc[k].error ? `; ${sc[k].error.slice(0, 300)}` : ''}]`}`);
  console.log(`overall ${receipt.overall}; peak RSS ${receipt.resources.peakRssMiB} MiB; elapsed ${receipt.elapsedSeconds}s; scratch removed ${cleanup.removed}; receipt ${file}`);
}
const deadline = setTimeout(async () => { log('global deadline exceeded'); await teardown(); finish('global deadline exceeded'); process.exit(1); }, Math.max(1, DEADLINE_MS - 45000));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await teardown(); finish(`interrupted by ${sig}`); process.exit(130); });
let runError;
try { await main(); } catch (e) { runError = e.message; console.error('RUN ERROR:', e.message); } finally { clearTimeout(deadline); await teardown(); finish(runError); }
process.exit(receipt.overall === 'PASS' ? 0 : 1);
