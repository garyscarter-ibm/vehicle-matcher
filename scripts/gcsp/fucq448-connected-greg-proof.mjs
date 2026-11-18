#!/usr/bin/env node
// FUCQ-448 connected proof: prebuilt Angular Greg demand and policy -> Java API (local signed test OIDC, owned PostgreSQL 17), headless Chrome.
// Reuses the FUCQ-452 mechanics. Seeds only through real routes; the parent supplies scratch, database, jar and web bundle.
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
const rejectForbidden = (value, label) => { if (FORBIDDEN_PATH.test(String(value ?? ''))) refuse(`${label} contains a forbidden synced-location path`); };
function localInput(input, label) {
  rejectForbidden(input, label);
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

// ---------- inputs ----------
const RAW_SCRATCH = process.env.SCRATCH ?? '';
if (!RAW_SCRATCH) refuse('SCRATCH is not set; the parent must supply an owned local scratch directory');
rejectForbidden(RAW_SCRATCH, 'SCRATCH');
if (!path.isAbsolute(RAW_SCRATCH)) refuse('SCRATCH must be absolute');
const SCRATCH = localInput(RAW_SCRATCH, 'SCRATCH');
if (!SCRATCH.startsWith('/private/tmp/')) refuse('SCRATCH must be a parent-owned directory under /private/tmp');
if (SCRATCH === ROOT || SCRATCH.startsWith(`${ROOT}${path.sep}`)) refuse('SCRATCH must be outside the repository');
if (!existsSync(SCRATCH) || !statSync(SCRATCH).isDirectory()) refuse('SCRATCH must already exist and be owned by the parent run');
const RUN_TOKEN = process.env.PROOF_RUN_TOKEN ?? randomBytes(4).toString('hex');
if (!/^[a-z0-9][a-z0-9-]{5,39}$/.test(RUN_TOKEN)) refuse('PROOF_RUN_TOKEN must be 6-40 lowercase letters, digits or hyphens');
const SOURCE_REVISION = process.env.PROOF_SOURCE_REVISION ?? '';
if (!/^[0-9a-f]{40}$/.test(SOURCE_REVISION)) refuse('PROOF_SOURCE_REVISION must be the parent-verified 40-hex source commit');
const DB_SOURCE = process.env.GCSP_TEST_DATABASE_URL ? 'GCSP_TEST_DATABASE_URL' : process.env.GCSP_TEST_RUNNING_DATABASE_URL ? 'GCSP_TEST_RUNNING_DATABASE_URL' : null;
if (!DB_SOURCE) refuse('GCSP_TEST_DATABASE_URL (or GCSP_TEST_RUNNING_DATABASE_URL) is required');
const DB_URL = process.env[DB_SOURCE];
const DB = /^jdbc:postgresql:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?\/([A-Za-z0-9_]+)(?:\?([^#]*))?$/.exec(DB_URL);
if (!DB) refuse(`${DB_SOURCE} must be a JDBC URL for one database on localhost`);
const DB_NAME = DB[3];
const DB_OPTIONS = new URLSearchParams(DB[4] ?? '');
const DB_USER = process.env.GCSP_DATABASE_USER || DB_OPTIONS.get('user') || 'gcsp';
const DB_PASSWORD = process.env.GCSP_DATABASE_PASSWORD ?? DB_OPTIONS.get('password') ?? '';
const JAVA_HOME = localInput(process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home', 'JAVA_HOME');
const CHROME = localInput(process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'Chrome');
const JAR = localInput(process.env.PROOF_API_JAR ?? path.join(ROOT, 'services/gcsp-api/target/quarkus-app/quarkus-run.jar'), 'API jar');
const WEB_BROWSER = localInput(process.env.PROOF_WEB_BROWSER ?? path.join(ROOT, 'apps/gcsp-web/dist/gcsp-web/browser'), 'Web browser directory');
for (const [label, file] of [['API jar', JAR], ['compiled web index', path.join(WEB_BROWSER, 'index.html')], ['java', path.join(JAVA_HOME, 'bin/java')],
  ['keytool', path.join(JAVA_HOME, 'bin/keytool')], ['Chrome', CHROME]]) if (!existsSync(file)) refuse(`${label} was not found`);
const port = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) refuse(`${name} must be a port number`);
  return value;
};
const PORTS = { web: port('PROOF_WEB_PORT', 7648), api: port('PROOF_API_PORT', 8648), idp: port('PROOF_IDP_PORT', 9648) };
if (new Set(Object.values(PORTS)).size !== 3) refuse('Proof ports must be distinct');
const DEADLINE_MS = Number(process.env.PROOF_DEADLINE_SEC ?? 840) * 1000;

const ORIGINS = { web: `https://gcsp-web.localhost:${PORTS.web}`, api: `https://gcsp-api.localhost:${PORTS.api}`, idp: `https://gcsp-idp.localhost:${PORTS.idp}` };
const ISSUER = `${ORIGINS.idp}/realms/gcsp-local`;
const API_PATH = '/api/gcsp/v1';
const API_BASE = `${ORIGINS.api}${API_PATH}`;
const KID = 'gcsp-local-test-1';
const TRUST_PASS = 'proof-local-trust';
const ENVIRONMENT_ID = `fucq448-connected-${RUN_TOKEN}`;
const SCHEMA = `gcsp_s_fucq448_${RUN_TOKEN.replace(/-/g, '_')}`;
const SUBJECTS = { greg: ['greg'], presenter: ['presenter'], paula: ['employee'], alex: ['employee'] };
const OIDC_SUBJECTS = Object.fromEntries(Object.entries(SUBJECTS).map(([name, roles]) => [`sub-${name}`, roles]));
const dirs = { logs: path.join(SCRATCH, 'logs'), tmp: path.join(SCRATCH, 'tmp'), certs: path.join(SCRATCH, 'certs'),
  static: path.join(SCRATCH, 'static'), browser: path.join(SCRATCH, 'browser'), evidence: process.env.PROOF_EVIDENCE_DIR ? localInput(process.env.PROOF_EVIDENCE_DIR, 'Evidence dir') : path.join(SCRATCH, 'evidence') };
const receipt = {
  schema: 'fucq448-connected-greg-proof/1', story: 'DEV-2026-11-13-016 / FUCQ-448', startedAt: new Date().toISOString(),
  sourceRevision: SOURCE_REVISION, scenarios: {}, processes: [], tools: {}, blockers: [],
  limitations: [
    'Local test OIDC uses real signed RS256 tokens validated by Java; it is not the hosted identity provider.',
    'Chromium only via CDP isolated contexts; Safari/WebKit and the hosted deployment are not covered.',
    'No tokens, database credentials, OIDC codes or private keys are written to this receipt.',
  ],
};
const owned = [];
const LOG_BUDGET = 8 * 1024 * 1024;
let logBytes = 0; let shotBytes = 0; let finished = false; let teardownPromise; let tls; let api = null; let webServer = null;
const idp = { codes: new Map(), txns: new Map(), keys: null, server: null };
const allPages = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256b64u = (value) => createHash('sha256').update(value).digest('base64url');
const sha256File = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const childEnv = (env) => ({ ...env, TMPDIR: dirs.tmp, TMP: dirs.tmp, TEMP: dirs.tmp });
const cap = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 60000, env: childEnv(process.env), ...opts }).trim();

// ---------- owned child processes ----------
function spawnOwned(name, cmd, args, env, portNumber = null) {
  const output = createWriteStream(path.join(dirs.logs, `${name}.log`));
  const child = spawn(cmd, args, { cwd: ROOT, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const write = (chunk) => { if (logBytes < LOG_BUDGET) { logBytes += chunk.length; output.write(chunk); } };
  child.stdout.on('data', write); child.stderr.on('data', write);
  child.logClosed = new Promise((resolve) => output.once('finish', resolve));
  child.once('close', () => output.end());
  const record = { name, pid: child.pid, executable: path.basename(cmd), port: portNumber, startedAt: new Date().toISOString(), exit: null };
  receipt.processes.push(record);
  child.exited = new Promise((resolve) => {
    child.on('error', (error) => { child.done = true; record.exit = `spawn-error: ${error.message}`; resolve(-1); });
    child.on('exit', (code, signal) => { child.done = true; record.exit = code ?? signal; resolve(code); });
  });
  const signal = (sig) => { if (!child.done) { try { process.kill(-child.pid, sig); } catch { /* already gone */ } } };
  child.stop = async () => {
    if (child.done) return;
    signal('SIGTERM'); await Promise.race([child.exited, sleep(10000)]);
    if (!child.done) { signal('SIGKILL'); await Promise.race([child.exited, sleep(5000)]); }
    if (!child.done) throw new Error(`Owned child ${name} did not join`);
  };
  owned.push(child);
  return child;
}
function runOnce(name, cmd, args, env, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawnOwned(name, cmd, args, env);
    const timer = setTimeout(() => { child.stop().then(() => reject(new Error(`${name} timed out`)), reject); }, timeout);
    child.exited.then((code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${name} exited ${code}`)); });
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
  execFileSync(path.join(JAVA_HOME, 'bin/keytool'), ['-importcert', '-alias', 'gcsp-local-ca', '-file', file('ca.pem'),
    '-keystore', file('truststore.p12'), '-storetype', 'PKCS12', '-storepass', TRUST_PASS, '-noprompt'], { stdio: 'pipe', timeout: 60000, env: childEnv(process.env) });
  return { ca: readFileSync(file('ca.pem'), 'utf8'), cert: readFileSync(file('fullchain.pem')), key: readFileSync(file('leaf.key')),
    spki: createHash('sha256').update(der).digest('base64'), trust: file('truststore.p12') };
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
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  idp.keys = { privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' } };
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
      const buttons = Object.keys(OIDC_SUBJECTS).map((subject) => `<p><button type="submit" name="subject" value="${subject}" data-subject="${subject}">Sign in as ${subject}</button></p>`).join('');
      return text(res, 200, `<!doctype html><title>Local test issuer</title><h1>LOCAL TEST ISSUER (not the real provider)</h1><form method="post" action="${base}/protocol/openid-connect/auth"><input type="hidden" name="txn" value="${txn}">${buttons}</form>`, 'text/html');
    }
    if (url.pathname === `${base}/protocol/openid-connect/auth` && req.method === 'POST') {
      const fields = await form(); const transaction = idp.txns.get(fields.get('txn')); idp.txns.delete(fields.get('txn'));
      if (!transaction || !OIDC_SUBJECTS[fields.get('subject')]) return text(res, 400, 'invalid_request');
      const code = randomBytes(16).toString('hex'); idp.codes.set(code, { ...transaction, subject: fields.get('subject') });
      const target = new URL(transaction.redirectUri); target.searchParams.set('code', code); target.searchParams.set('state', transaction.state);
      res.writeHead(302, { Location: target.href, 'Cache-Control': 'no-store' }); return res.end();
    }
    if (url.pathname === `${base}/protocol/openid-connect/token` && req.method === 'POST') {
      const fields = await form(); const code = idp.codes.get(fields.get('code')); idp.codes.delete(fields.get('code'));
      if (fields.get('grant_type') !== 'authorization_code' || !code || fields.get('client_id') !== 'gcsp-web'
        || fields.get('redirect_uri') !== code.redirectUri || sha256b64u(fields.get('code_verifier') ?? '') !== code.challenge) return json(req, res, 400, { error: 'invalid_grant' });
      const now = Math.floor(Date.now() / 1000);
      const idToken = signJwt({ iss: ISSUER, sub: code.subject, aud: 'gcsp-web', azp: 'gcsp-web', iat: now, exp: now + 300, auth_time: now,
        ...(code.nonce ? { nonce: code.nonce } : {}) }, idp.keys.privateKey);
      return json(req, res, 200, { access_token: signJwt(accessClaims(code.subject, OIDC_SUBJECTS[code.subject]), idp.keys.privateKey),
        token_type: 'Bearer', expires_in: 3600, scope: 'openid profile gcsp-api', id_token: idToken });
    }
    if (url.pathname === `${base}/protocol/openid-connect/logout`) { res.writeHead(302, { Location: `${ORIGINS.web}/gcsp/` }); return res.end(); }
    return text(res, 404, 'not found');
  });
  return new Promise((resolve) => idp.server.listen(PORTS.idp, '127.0.0.1', resolve));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.gif': 'image/gif', '.avif': 'image/avif' };
function startWeb(fixedRoutes) {
  const fixed = new Set(fixedRoutes.map((route) => route.replace(/\/$/, '') || '/'));
  const root = path.join(dirs.static, 'gcsp');
  webServer = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, ORIGINS.web).pathname);
    if (pathname === '/' || pathname === '/gcsp') { res.writeHead(302, { Location: '/gcsp/' }); return res.end(); }
    if (!pathname.startsWith('/gcsp/') || pathname.includes('..')) { res.writeHead(404); return res.end('not found'); }
    let file = path.join(root, pathname.slice('/gcsp/'.length));
    if (fixed.has(pathname.replace(/\/$/, '')) || pathname.endsWith('/')) file = path.join(root, 'index.html');
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': ext === '.html' || ext === '.json' ? 'no-store' : 'public, max-age=31536000, immutable' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => webServer.listen(PORTS.web, '127.0.0.1', resolve));
}
const closeServer = (server) => server ? new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }) : Promise.resolve();

// ---------- Java API and script-level calls ----------
function apiEnv() {
  return {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp, JAVA_HOME, LANG: 'en_GB.UTF-8',
    QUARKUS_HTTP_SSL_PORT: String(PORTS.api), QUARKUS_HTTP_INSECURE_REQUESTS: 'disabled',
    QUARKUS_HTTP_SSL_CERTIFICATE_FILES: path.join(dirs.certs, 'fullchain.pem'), QUARKUS_HTTP_SSL_CERTIFICATE_KEY_FILES: path.join(dirs.certs, 'leaf.key'),
    GCSP_ALLOWED_ORIGINS: ORIGINS.web, GCSP_IDENTITY_PROVIDER: 'oidc', GCSP_OIDC_ISSUER: ISSUER,
    GCSP_OIDC_JWKS_URI: `https://127.0.0.1:${PORTS.idp}/realms/gcsp-local/protocol/openid-connect/certs`,
    GCSP_OIDC_AUDIENCE: 'gcsp-api', GCSP_OIDC_AUTHORIZED_PARTY: 'gcsp-web', GCSP_OIDC_REQUIRED_SCOPES: 'gcsp-api',
    GCSP_OIDC_ACCOUNTS: JSON.stringify(Object.entries(SUBJECTS).map(([name, roles]) => ({ subject: `sub-${name}`, roles,
      ...(roles.includes('employee') ? { employeeId: `employee-${name}` } : {}) }))),
    GCSP_ENVIRONMENT_ID: ENVIRONMENT_ID, GCSP_RUN_ID: 'run-1', GCSP_POLICY_VERSION: 'gcsp-policy-v1',
    GCSP_DATABASE_URL: DB_URL, GCSP_DATABASE_USER: DB_USER, GCSP_DATABASE_PASSWORD: DB_PASSWORD, GCSP_EXPECTED_DATABASE: DB_NAME,
    GCSP_RESET_ALLOWED: 'true', GCSP_CODE_REVISION: SOURCE_REVISION,
    GCSP_ACCOUNT_PROVIDER: 'repository', GCSP_SCENARIO_PROVIDER: 'demo', GCSP_SUPPLY_PROVIDER: 'demo',
    GCSP_ALLOCATION_CANDIDATES_PROVIDER: 'recommendation', GCSP_ORDERING_PROVIDER: 'synthetic', GCSP_PRODUCTION_PROVIDER: 'synthetic',
    GCSP_CLAIMS_SWEEP_INTERVAL: '10m', GCSP_NOTIFY_DRAIN_INTERVAL: '10m',
  };
}
function request(method, suffix, token = null, body = null) {
  const origin = new URL(ORIGINS.api);
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port: Number(origin.port), path: `${API_PATH}${suffix}`, method,
      servername: origin.hostname, ca: tls.ca, timeout: 20000,
      headers: { Host: origin.host, Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === null ? {} : { 'Content-Type': 'application/json' }) } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* non-JSON body */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('timeout', () => req.destroy(new Error('API request timed out'))); req.on('error', reject);
    req.end(body === null ? undefined : JSON.stringify(body));
  });
}
const tokenFor = (person) => signJwt(accessClaims(`sub-${person}`, SUBJECTS[person]), idp.keys.privateKey);
const call = (person, suffix, body) => request(body === undefined ? 'GET' : 'POST', suffix, tokenFor(person), body ?? null);
async function ok(person, suffix, body) {
  const response = await call(person, suffix, body);
  if (response.status !== 200 || response.json?.status !== 'ok') throw new Error(`${person} ${body === undefined ? 'GET' : 'POST'} ${suffix} answered ${response.status} ${response.json?.code ?? ''}`);
  return response.json.value;
}
async function startApi() {
  const properties = [`-Dquarkus.datasource.jdbc.additional-jdbc-properties.currentSchema=${SCHEMA}`,
    `-Dquarkus.flyway.schemas=${SCHEMA}`, `-Dquarkus.flyway.default-schema=${SCHEMA}`];
  api = spawnOwned('api', path.join(JAVA_HOME, 'bin/java'), [`-Djavax.net.ssl.trustStore=${tls.trust}`, `-Djavax.net.ssl.trustStorePassword=${TRUST_PASS}`,
    `-Djava.io.tmpdir=${dirs.tmp}`, ...properties, '-jar', JAR], apiEnv(), PORTS.api);
  for (let i = 0; ; i++) {
    if (api.done) throw new Error('api exited during startup; see logs/api.log');
    try { const response = await request('GET', '/greg/demand'); if (response.status === 401) break; } catch { /* starting */ }
    if (i > 240) throw new Error('api did not become ready');
    await sleep(500);
  }
  log('api ready');
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
class Page {
  constructor(cdp, sessionId, label) {
    this.cdp = cdp; this.sid = sessionId; this.label = label;
    this.log = []; this.byId = new Map(); this.waits = []; this.errors = []; this.csp = [];
    cdp.listeners.push((message) => message.sessionId === sessionId && this.event(message));
    allPages.push(this);
  }
  send(method, params = {}) { return this.cdp.send(method, params, this.sid); }
  event(message) {
    const p = message.params ?? {};
    const cspText = (text) => /content.security|content-security|\bcsp\b/i.test(text ?? '');
    if (message.method === 'Runtime.exceptionThrown') { this.errors.push(p.exceptionDetails?.text ?? 'runtime exception'); return; }
    if (message.method === 'Log.entryAdded') { if (p.entry?.level === 'error' && cspText(p.entry?.text)) this.csp.push(p.entry.text); return; }
    if (message.method === 'Runtime.consoleAPICalled') { const text = (p.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '); if (cspText(text)) this.csp.push(text); return; }
    if (message.method === 'Network.requestWillBeSent') {
      if (!p.request.url.startsWith(ORIGINS.api)) return;
      const url = new URL(p.request.url);
      const entry = { id: p.requestId, method: p.request.method, path: url.pathname.replace(API_PATH, ''), query: url.search,
        bearer: /^Bearer \S+/.test(hdr(p.request.headers, 'authorization') ?? ''), status: null, failed: null, body: parse(p.request.postData) };
      if (!p.request.postData && p.request.hasPostData) this.waits.push(this.send('Network.getRequestPostData', { requestId: p.requestId })
        .then((result) => { entry.body = parse(result.postData); }).catch(() => {}));
      this.log.push(entry); this.byId.set(p.requestId, entry);
    } else if (message.method === 'Network.requestWillBeSentExtraInfo') {
      const entry = this.byId.get(p.requestId); if (entry && /^Bearer \S+/.test(hdr(p.headers, 'authorization') ?? '')) entry.bearer = true;
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
    if (result.exceptionDetails) throw new Error(`DOM evaluation failed on ${this.label}: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result.value;
  }
  act(body) { return this.eval(`(() => { ${HELPERS}\n${body} })()`); }
  async until(body, timeout = 30000, what = body) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { try { if (await this.act(body)) return true; } catch { /* document navigating */ } await sleep(250); }
    const text = await this.eval("document.body.innerText.replace(/\\s+/g,' ').slice(0,300)").catch(() => '?');
    throw new Error(`${this.label}: timed out waiting for ${what}; page text: ${text}`);
  }
  async key(key, extra = {}) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, ...extra });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, ...extra });
  }
  async viewport(width, height) { await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); }
  // Records overflow and a JPEG; full=true grows the viewport to the content height first.
  async snap(name, full = false) {
    const width = await this.eval('innerWidth'); const baseHeight = await this.eval('innerHeight');
    const overflow = await this.eval('document.documentElement.scrollWidth > innerWidth');
    if (full) {
      const height = await this.eval(`Math.min(5200, Math.ceil(Math.max(document.documentElement.scrollHeight, ...[...document.querySelectorAll('*')]
        .filter((e) => e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY)).map((e) => e.scrollHeight + e.getBoundingClientRect().top))))`);
      await this.viewport(width, Math.max(baseHeight, height)); await sleep(300);
    }
    const result = await this.send('Page.captureScreenshot', { format: 'jpeg', quality: 62 });
    if (full) await this.viewport(width, baseHeight);
    const bytes = Buffer.from(result.data, 'base64');
    if (bytes.length > 600 * 1024 || shotBytes + bytes.length > 2.6 * 1024 * 1024) throw new Error(`Screenshot evidence exceeded its bounded budget at ${name}`);
    writeFileSync(path.join(dirs.evidence, name), bytes); shotBytes += bytes.length;
    const entry = { file: name, width, overflow, bytes: bytes.length };
    render.captures.push(entry); return entry;
  }
}
const render = { captures: [], focus: null };
const HELPERS = `
const main = document.querySelector('#gcsp-main') ?? document;
const $ = (selector, root = main) => root.querySelector(selector);
const norm = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
const button = (label, root = main) => [...root.querySelectorAll('button')].find((item) => norm(item.textContent) === label);
const press = (label, root = main) => { const item = button(label, root); if (!item || item.disabled) return false; item.click(); return true; };
const loaded = () => !!$('.greg-demand .demand-metrics') && !!$('.greg-policy .policy-controls input[type=number]');
`;
async function newPage(cdp, label, width = 1440, height = 1000) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, sessionId, label);
  await page.send('Page.enable'); await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.send('Network.enable'); await page.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.send('Runtime.enable'); await page.send('Log.enable');
  await page.viewport(width, height);
  return page;
}
async function signIn(page, person, target, expectPath = target) {
  await page.send('Page.navigate', { url: `${ORIGINS.web}${target}` });
  await page.until(`return location.origin === '${ORIGINS.web}' && !!button('Sign in');`, 30000, 'unauthenticated sign-in page');
  const signedOutFirst = await page.act("return !!button('Sign in');");
  await page.act("return press('Sign in');");
  await page.until(`return location.origin === '${ORIGINS.idp}' && !!document.querySelector('button[data-subject="sub-${person}"]');`, 30000, 'local OIDC login');
  await page.eval(`document.querySelector('button[data-subject="sub-${person}"]').click()`);
  await page.until(`return location.origin === '${ORIGINS.web}' && location.pathname === '${expectPath}';`, 30000, `return to ${expectPath}`);
  return { signedOutFirst, path: await page.eval('location.pathname') };
}
async function waitCall(page, from, method, route, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    await page.settle();
    const rows = page.calls(from).filter((entry) => entry.method === method && entry.path === route);
    if (rows.length && rows.every((entry) => entry.status !== null && (entry.response !== undefined || entry.failed))) return rows;
    await sleep(100);
  }
  throw new Error(`No completed browser ${method} ${route}`);
}
const selectTab = async (page, label) => {
  await page.act(`const tab = [...document.querySelectorAll('[role=tab]')].find((b) => norm(b.textContent) === '${label}'); if (!tab) return false; tab.click(); return true;`);
  await page.until(`const tab = [...document.querySelectorAll('[role=tab]')].find((b) => norm(b.textContent) === '${label}'); return tab?.getAttribute('aria-selected') === 'true';`, 5000, `tab ${label}`);
};
const waitLoaded = async (page) => {
  try { await page.until('return loaded();', 30000, 'Greg demand and policy loaded'); } catch (error) {
    const dump = await page.act("return { demand: norm($('.greg-demand')?.textContent).slice(0, 500), policy: norm($('.greg-policy')?.textContent).slice(0, 500) };").catch(() => null);
    await page.settle(); receipt.loadFailure = { dump, calls: page.calls().filter((c) => c.path.startsWith('/greg/')).map((c) => ({ method: c.method, path: c.path, status: c.status, failed: c.failed, bearer: c.bearer })) };
    throw error;
  }
};

const check = (s, name, passed, detail = undefined) => { s.checks[name] = passed === true; if (detail !== undefined) s.observations[name] = detail; return passed === true; };
async function scenario(name, title, fn) {
  const out = { title, pass: false, checks: {}, observations: {} };
  receipt.scenarios[name] = out; log(`scenario ${name}: ${title}`);
  try { await fn(out); } catch (error) { out.error = error.message; out.checks.noException = false; log(`  error: ${error.message}`); }
  out.pass = Object.keys(out.checks).length > 0 && Object.values(out.checks).every((value) => value === true);
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cmd = (prefix) => `${prefix}-${randomBytes(8).toString('hex')}`;
function countLabels(value, into = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => countLabels(item, into));
  else if (value && typeof value === 'object') {
    if (['exact', 'band'].includes(value.kind) && typeof value.label === 'string') into.add(value.label);
    Object.values(value).forEach((item) => countLabels(item, into));
  }
  return into;
}
const publishBody = (expected, version, effectiveFrom, changes) => ({ commandId: cmd('pub'), expectedActiveVersion: expected, policyVersion: version, effectiveFrom, changes });
const newVersion = () => `greg-fucq448-${randomBytes(4).toString('hex')}`;
const brief = (r) => ({ http: r.status, status: r.json?.status, code: r.json?.code, reason: r.json?.reason, expectedVersion: r.json?.expectedVersion, currentVersion: r.json?.currentVersion, accepted: r.json?.accepted });
const scoreText = (m) => (m?.status === 'available' ? `${m.value.toFixed(1)} / 100` : 'Suppressed for privacy');
function expectedPreviewRows(v) {
  const unmet = (side) => v[side].demand.demand.unmet.total.count.label;
  const fit = (side, key) => v[side].fit[key].label;
  return [['Briefs with unmet demand', unmet('active'), unmet('draft')], ['Employees with eligible stock', fit('active', 'employeesWithEligibleStock'), fit('draft', 'employeesWithEligibleStock')],
    ['Scored saved briefs', fit('active', 'scoredBriefs'), fit('draft', 'scoredBriefs')],
    ['Mean best recommendation fit', scoreText(v.active.fit.meanBestScore), scoreText(v.draft.fit.meanBestScore)]];
}
// Types a changed value into the first visible number field; returns the field and the new value.
async function typeDraft(page, policy, delta) {
  const target = await page.act("const i = $('.greg-policy .policy-control:not([hidden]) input[type=number]'); return { index: [...document.querySelectorAll('.greg-policy .policy-control input[type=number]')].indexOf(i), value: i.value };");
  const field = policy.fields[target.index]; const to = field.value + delta;
  await page.act("const i = $('.greg-policy .policy-control:not([hidden]) input[type=number]'); i.focus(); i.select(); return true;");
  for (const ch of String(to)) await page.key(ch, { code: `Digit${ch}`, text: ch });
  await page.until("return !button('Preview changes', $('.greg-policy')).disabled;", 5000, 'Preview enabled by the typed draft');
  return { field, to };
}
async function previewDom(page) {
  return page.act(`const r = $('.greg-policy .preview-results'); if (!r) return null;
    const table = (cap) => { const t = [...r.querySelectorAll('table')].find((x) => norm(x.querySelector('caption').textContent) === cap); return t ? [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => norm(c.textContent))) : null; };
    return { outcomes: table('Preview outcomes'), changed: table('Changed values in this preview'), cohort: norm($('.preview-metric dd', r)?.textContent), text: norm(r.textContent) };`);
}

async function demandDom(page) {
  return page.act(`const section = $('.greg-demand');
    const pairs = (dl) => dl ? [...dl.children].map((d) => [norm($('dt', d)?.textContent), norm($('dd', d)?.textContent)]) : [];
    const tables = {}; for (const t of section.querySelectorAll('table')) tables[norm(t.querySelector('caption').textContent)] = [...t.querySelectorAll('tbody tr')].map((r) => [...r.children].map((c) => norm(c.textContent)));
    return { headline: pairs(section.querySelector('dl.demand-metrics')), offers: pairs(section.querySelector('dl.offer-metrics')), tables,
      cells: [...section.querySelectorAll('dd, td')].filter((c) => !c.closest('.demand-meta')).map((c) => norm(c.textContent)).filter((t) => /\\d/.test(t)),
      hasMetrics: !!section.querySelector('.demand-metrics'), cellCount: section.querySelectorAll('dd, td').length, text: norm(section.textContent) };`);
}
async function policyDom(page) {
  return page.act(`const p = $('.greg-policy');
    return { inputs: [...p.querySelectorAll('.policy-control input[type=number]')].map((i) => i.value),
      controls: [...p.querySelectorAll('.policy-control')].map((c) => norm(c.textContent)), facts: norm($('.policy-facts', p)?.textContent),
      sources: norm($('.policy-sources', p)?.textContent), status: norm($('.policy-status', p)?.textContent), text: norm(p.textContent),
      hasControls: !!p.querySelector('.policy-controls input'), hasPreview: !!p.querySelector('.preview-results'),
      previewDisabled: button('Preview changes', p)?.disabled ?? null, publishDisabled: button('Publish this preview', p)?.disabled ?? null };`);
}
function expectedDemandCells(d) {
  const L = (e) => e.count.label;
  const rows = (list, pick) => list.length ? list.map(pick) : 'placeholder';
  return { headline: [['Active briefs', L(d.demand.activeBriefs)], ['Briefs with no suitable car', L(d.demand.unmet.total)], ['Offers made', L(d.offers.made)], ['Selected', L(d.offers.selected)]],
    offers: [['Offers made', L(d.offers.made)], ['Accepted', L(d.offers.accepted)], ['Declined', L(d.offers.declined)], ['Expired', L(d.offers.expired)], ['Selected', L(d.offers.selected)]],
    'By model line': rows(d.demand.byModelLine, (r) => [L(r)]), 'By body style': rows(d.demand.byBody, (r) => [L(r)]), 'By fuel type': rows(d.demand.byFuel, (r) => [L(r)]),
    'By essential requirement': rows(d.demand.essentials, (r) => [L(r)]), 'Briefs with no suitable car, by gate': rows(d.demand.unmet.byGate, (r) => [L(r)]),
    'Stock by model line': rows(d.stock.byModelLine, (r) => [r.released.count.label, r.held.count.label, r.allocated.count.label]),
    'Declined offers, by reason': rows(d.offers.declinedByReason, (r) => [L(r)]) };
}
function compareDemand(dom, d) {
  const exp = expectedDemandCells(d); const result = {};
  result.headline = same(dom.headline, exp.headline); result.offers = same(dom.offers, exp.offers);
  for (const [caption, expected] of Object.entries(exp)) {
    if (['headline', 'offers'].includes(caption)) continue;
    const rows = dom.tables[caption];
    result[caption] = Array.isArray(rows) && (expected === 'placeholder' ? rows.length === 1 && rows[0].length === 1
      : rows.length === expected.length && rows.every((row, i) => same(row.slice(-expected[i].length), expected[i])));
  }
  const known = countLabels(d);
  const stray = dom.cells.filter((cell) => !known.has(cell));
  result.everyRenderedNumberIsInThePayload = stray.length === 0;
  return { result, stray, knownCount: known.size };
}

async function main() {
  for (const directory of Object.values(dirs)) mkdirSync(directory, { recursive: true });
  for (const [name, number] of Object.entries(PORTS)) if (!(await portFree(number))) throw new Error(`Port ${number} (${name}) is in use`);
  receipt.inputs = { database: { name: DB_NAME }, ports: PORTS, jar: { path: path.relative(ROOT, JAR), sha256: sha256File(JAR) },
    webIndexSha256: sha256File(path.join(WEB_BROWSER, 'index.html')) };
  receipt.tools = { harnessNode: process.version, chrome: cap(CHROME, ['--version']), openssl: cap('openssl', ['version']),
    java: (spawnSync(path.join(JAVA_HOME, 'bin/java'), ['-version'], { encoding: 'utf8', env: childEnv(process.env) }).stderr ?? '').split('\n')[0] };

  tls = makeCerts();
  const assemble = await import(pathToFileURL(path.join(ROOT, 'scripts/build-gcsp-static.mjs')).href);
  await runOnce('assemble', process.execPath, ['scripts/build-gcsp-static.mjs', '--browser', WEB_BROWSER, '--output', dirs.static,
    '--environment', 'deployed', '--revision', SOURCE_REVISION],
    { PATH: process.env.PATH, HOME: process.env.HOME, GCSP_PUBLIC_ENVIRONMENT_ID: ENVIRONMENT_ID, GCSP_PUBLIC_API_BASE_URL: API_BASE,
      GCSP_PUBLIC_OIDC_AUTHORITY: ISSUER, GCSP_PUBLIC_OIDC_CLIENT_ID: 'gcsp-web', GCSP_PUBLIC_OIDC_SCOPE: 'openid profile gcsp-api',
      GCSP_PUBLIC_OIDC_REDIRECT_URI: `${ORIGINS.web}/gcsp/auth/callback`, GCSP_PUBLIC_OIDC_POST_LOGOUT_REDIRECT_URI: `${ORIGINS.web}/gcsp/` });
  await startIdp(); await startWeb(assemble.GCSP_FIXED_ROUTES); await startApi();

  const chrome = spawnOwned('chrome', CHROME, ['--headless=new', `--user-data-dir=${path.join(dirs.browser, 'profile')}`,
    '--remote-debugging-port=0', '--remote-allow-origins=*', `--ignore-certificate-errors-spki-list=${tls.spki}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--window-size=1440,1000', 'about:blank'],
    { PATH: process.env.PATH, HOME: process.env.HOME });
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    if (chrome.done) throw new Error('Chrome exited during startup');
    try { const [debugPort, wsPath] = readFileSync(path.join(dirs.browser, 'profile', 'DevToolsActivePort'), 'utf8').trim().split('\n'); wsUrl = `ws://127.0.0.1:${debugPort}${wsPath}`; }
    catch { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Chrome DevTools endpoint was not found');
  const cdp = await Cdp.connect(wsUrl);
  const shared = { offerBefore: null, policy0: null, demand0: null };

  // 1. Seed through the real routes only: briefs, engagement, presenter tick.
  const seeded = await scenario('seed-through-routes', 'Two employees confirm briefs and engage; a presenter tick allocates', async (s) => {
    const clock = await ok('presenter', '/presenter/clock');
    const release = await call('presenter', '/presenter/controls/tick', { commandId: cmd('rel'), expectedClockVersion: clock.clockVersion, mode: 'next-release' });
    check(s, 'Presenter next-release tick is accepted and completes', release.status === 200 && release.json?.value?.tick?.state === 'completed', { http: release.status, state: release.json?.value?.tick?.state });
    const THREE = { comfort: { value: 50 }, body: { value: ['estate'] }, sportiness: { value: 50 } };
    const engaged = {};
    for (const who of ['paula', 'alex']) {
      const draft = async () => (await ok(who, '/brief/editor')).initial.draftVersion;
      const saved = await call(who, '/brief/preferences', { commandId: cmd('pref'), expectedBriefVersion: 0, expectedDraftVersion: await draft(), changes: THREE });
      const eng = await call(who, '/brief/engage', { commandId: cmd('eng'), expectedBriefVersion: 0, expectedDraftVersion: await draft() });
      engaged[who] = { saved: saved.status, engaged: eng.status, buddy: eng.json?.value?.buddy?.state };
      check(s, `${who} saved the brief and engaged`, saved.status === 200 && eng.status === 200 && eng.json?.value?.buddy?.state === 'engaged', engaged[who]);
    }
    const tick = await call('presenter', '/presenter/clock/tick', { tickId: cmd('alloc'), expectedClockVersion: (await ok('presenter', '/presenter/clock')).clockVersion });
    const allocation = (tick.json?.value?.outcomes ?? []).find((o) => o.handlerId === 'buddy-allocation')?.outcome?.status;
    check(s, 'Allocation tick runs buddy-allocation to ok', tick.status === 200 && allocation === 'ok', { http: tick.status, allocation });
    const demand = await ok('greg', '/greg/demand');
    shared.demand0 = demand;
    s.observations.apiCounts = { threshold: demand.privacy.threshold, activeBriefs: demand.demand.activeBriefs.count, holdsTotal: demand.holds.total.count,
      holdsActive: demand.holds.active.count, offersMade: demand.offers.made.count, unmet: demand.demand.unmet.total.count, stockLines: demand.stock.byModelLine.length };
    check(s, 'Greg demand API reports the two confirmed briefs (exact or fewer-than band)', ['exact', 'band'].includes(demand.demand.activeBriefs.count.kind));
    const offers = {};
    for (const who of ['paula', 'alex']) { const v = await ok(who, '/offers/current'); offers[who] = Array.isArray(v) ? v : v.offers ?? []; }
    s.observations.employeeOffers = Object.fromEntries(Object.entries(offers).map(([who, list]) => [who, list.map((o) => ({ id: o.offerId ?? o.id, state: o.state ?? o.status, keys: Object.keys(o) }))]));
    const live = (o) => ['active', 'pending'].includes(o.state ?? o.status);
    const owner = Object.keys(offers).find((who) => offers[who].some(live));
    check(s, 'At least one employee has an active offer read with their own bearer', !!owner);
    if (owner) {
      const id = offers[owner].find(live).offerId;
      const detail = await ok(owner, `/offers/${encodeURIComponent(id)}`);
      shared.offerBefore = { owner, id, terms: detail.quote ?? detail };
      s.observations.offerTerms = { owner, id, state: detail.state, detailKeys: Object.keys(detail), quoteKeys: Object.keys(detail.quote ?? {}), terms: shared.offerBefore.terms };
      check(s, 'The active offer detail carries its quoted terms', detail.quote !== undefined && detail.quote !== null);
    }
  });
  if (!seeded.pass) throw new Error('seeding did not complete; later scenarios need a computed demand');

  // 2. Greg DOM against the API: counts, bands, policy version and field values.
  let greg; const typed = { id: null, from: null, to: null };
  await scenario('greg-demand-and-policy', 'Greg opens /gcsp/greg after real OIDC login; the DOM shows the API demand and policy', async (s) => {
    greg = await newPage(cdp, 'Greg');
    const login = await signIn(greg, 'greg', '/gcsp/greg');
    check(s, 'Fresh context starts signed out then returns to /gcsp/greg after code+PKCE login', login.signedOutFirst && login.path === '/gcsp/greg', login);
    const demand = await ok('greg', '/greg/demand'); const policy = await ok('greg', '/greg/policy');
    shared.policy0 = policy; receipt.apiPayloads = { demand, policy };
    await waitLoaded(greg);
    const dom = await demandDom(greg);
    const compared = compareDemand(dom, demand);
    s.observations.demandComparison = { result: compared.result, stray: compared.stray, headline: dom.headline, offers: dom.offers, apiLabelCount: compared.knownCount };
    check(s, 'Headline counts and bands equal the API labels', compared.result.headline);
    check(s, 'Offer outcome counts equal the API labels', compared.result.offers);
    for (const caption of ['By model line', 'By body style', 'By fuel type', 'By essential requirement', 'Briefs with no suitable car, by gate', 'Stock by model line', 'Declined offers, by reason']) {
      check(s, `Table "${caption}" counts equal the API labels row by row`, compared.result[caption] === true);
    }
    check(s, 'Every number rendered in the demand section appears in the API payload', compared.result.everyRenderedNumberIsInThePayload, compared.stray);
    const pol = await policyDom(greg);
    check(s, 'Policy active version label and reference are shown', pol.facts.includes(policy.activeVersionLabel) && pol.sources.includes(policy.activeVersion),
      { label: policy.activeVersionLabel, version: policy.activeVersion });
    check(s, 'Every policy field input equals the API value', same(pol.inputs, policy.fields.map((f) => String(f.value))) && policy.fields.length > 0, { fields: policy.fields.length });
    check(s, 'Every field shows its current value as "Now N unit"', policy.fields.every((f, i) => pol.controls[i]?.includes(`Now ${f.value} ${f.unitLabel}`)));
    check(s, 'Held-offer count is null in the API', policy.heldOffers.count === null, policy.heldOffers);
    check(s, 'Held-offer count shows the unavailable message, not 0', pol.facts.includes(policy.heldOffers.message) && !/held offers?[^.]{0,30}\b0\b|\b0 (?:held )?offers/i.test(pol.text));
    const calls = greg.calls().filter((c) => c.path.startsWith('/greg/'));
    check(s, 'The browser read demand and policy with a signed bearer', calls.length >= 2 && calls.every((c) => c.bearer && c.status === 200), calls.map((c) => ({ path: c.path, status: c.status, bearer: c.bearer })));
    await selectTab(greg, 'Demand and supply');
    await greg.snap('greg-demand-1440.jpg', true);
    await greg.viewport(390, 844); await greg.snap('greg-demand-390.jpg', true);
    await selectTab(greg, 'Policy'); await greg.snap('greg-policy-390.jpg', true);
    await greg.viewport(1440, 1000); await greg.snap('greg-policy-1440.jpg', true);
  });

  // 3. Preview: keyboard edit, Tab to the button, Java answers 200 preview-ready and the DOM shows the server results.
  await scenario('preview-ready', 'A keyboard edit and Preview send a signed request; Java answers 200 preview-ready and the DOM shows the server results', async (s) => {
    const policy = shared.policy0;
    await selectTab(greg, 'Policy');
    const { field, to } = await typeDraft(greg, policy, 7);
    typed.id = field.id; typed.from = field.value; typed.to = to;
    let tabs = 0; let reached = false;
    for (; tabs < 60 && !reached; tabs++) {
      await greg.key('Tab', { code: 'Tab', windowsVirtualKeyCode: 9 });
      reached = await greg.eval("document.activeElement?.tagName === 'BUTTON' && document.activeElement.textContent.trim() === 'Preview changes'");
    }
    render.focus = await greg.eval("({ tag: document.activeElement?.tagName, label: document.activeElement?.textContent.trim(), outlineStyle: getComputedStyle(document.activeElement).outlineStyle, outlineWidth: getComputedStyle(document.activeElement).outlineWidth, visible: document.activeElement?.getBoundingClientRect().width > 0 })");
    render.focus.tabsPressed = tabs; render.focus.reachedPreview = reached;
    await greg.snap('greg-preview-focus-1440.jpg');
    const before = greg.log.length;
    await greg.key('Enter', { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    const [row] = await waitCall(greg, before, 'POST', '/greg/policy/preview');
    const value = row.response?.value;
    shared.preview = value;
    s.observations.previewRequest = { status: row.status, bearer: row.bearer, body: row.body, response: { status: row.response?.status, state: value?.state, activeVersion: value?.activeVersion, asOf: value?.asOf, differences: value?.differences } };
    check(s, 'Preview was sent by keyboard with Authorization: Bearer', row.bearer === true && reached);
    check(s, 'Request carried expectedActiveVersion equal to the API active version and the typed change',
      row.body?.expectedActiveVersion === policy.activeVersion && same(row.body?.changes, [{ id: typed.id, value: typed.to }]), { expected: policy.activeVersion, changes: row.body?.changes });
    check(s, 'Java answered 200 ok with state preview-ready for the active version', row.status === 200 && row.response?.status === 'ok' && value?.state === 'preview-ready'
      && value?.preview === true && value?.activeVersion === policy.activeVersion);
    check(s, 'The differences are exactly the typed edit (id, before, after, unit)', same(value?.differences, [{ id: typed.id, before: typed.from, after: typed.to, unit: field.unit }]), value?.differences);
    await greg.until("return !!$('.greg-policy .preview-results');", 10000, 'preview results');
    const prev = await previewDom(greg); const pol = await policyDom(greg);
    const expected = expectedPreviewRows(value);
    check(s, 'DOM changed-values table shows the server difference (name, before, after, unit)',
      same(prev.changed?.map((r) => r.slice(0, 4)), [[field.label, String(typed.from), String(typed.to), field.unitLabel || field.unit]]), prev.changed);
    check(s, 'DOM outcome rows show only the server fit and demand labels (no fabricated totals)', same(prev.outcomes?.map((r) => r.slice(0, 3)), expected), { dom: prev.outcomes, expected });
    check(s, 'DOM eligible-stock cohort and held-offer message equal the response', prev.cohort === value.draft.fit.employeesWithEligibleStock.label && prev.text.includes(value.heldOffers.message)
      && prev.text.includes(value.activeVersion), { cohort: prev.cohort });
    check(s, 'Publish this preview is enabled and Preview changes stays available', pol.publishDisabled === false && pol.previewDisabled === false);
    check(s, 'The draft value is kept in the field', pol.inputs[policy.fields.findIndex((f) => f.id === typed.id)] === String(typed.to), pol.inputs);
    await greg.snap('greg-preview-ready-1440.jpg', true);
    await greg.viewport(390, 844); await greg.snap('greg-preview-ready-390.jpg', true); await greg.viewport(1440, 1000);
  });

  // 4. Publish the reviewed preview from the browser; Java activates it and the reloaded page agrees.
  await scenario('publish-through-ui', 'Publish this preview sends the preview asOf; Java accepts and activates, offer terms are kept, the reloaded page agrees', async (s) => {
    const policy = shared.policy0; const preview = shared.preview;
    check(s, 'A preview-ready result from the previous scenario is available to publish', !!preview?.asOf);
    const before = greg.log.length;
    await greg.act("return press('Publish this preview', $('.greg-policy'));");
    const [row] = await waitCall(greg, before, 'POST', '/greg/policy/publish');
    const value = row.response?.value;
    s.observations.publishRequest = { status: row.status, bearer: row.bearer, body: row.body, response: { status: row.response?.status, state: value?.state, accepted: value?.accepted, activation: value?.activation } };
    check(s, 'Publish carried Authorization: Bearer', row.bearer === true);
    check(s, 'Request carried the old active version, effectiveFrom equal to the preview asOf and the previewed change',
      row.body?.expectedActiveVersion === policy.activeVersion && row.body?.effectiveFrom === preview?.asOf && same(row.body?.changes, [{ id: typed.id, value: typed.to }]) && /^greg-/.test(row.body?.policyVersion ?? ''),
      { expected: row.body?.expectedActiveVersion, effectiveFrom: row.body?.effectiveFrom, previewAsOf: preview?.asOf });
    check(s, 'Java answered 200 accepted with state published and the new version active', row.status === 200 && row.response?.status === 'ok' && value?.accepted === true && value?.state === 'published'
      && value?.policyVersion === row.body?.policyVersion && value?.effectiveFrom === row.body?.effectiveFrom && value?.activation?.status === 'active' && value?.activation?.publishedVersionActive === true);
    const after = await ok('greg', '/greg/policy');
    check(s, 'GET /greg/policy reports the published version active with the new field value', after.activeVersion === row.body?.policyVersion && after.fields.find((f) => f.id === typed.id)?.value === typed.to,
      { activeVersion: after.activeVersion, label: after.activeVersionLabel });
    await greg.until("return norm($('.greg-policy .publication h3')?.textContent) === 'Policy published and active';", 15000, 'published and active outcome');
    const pol = await policyDom(greg);
    check(s, 'DOM shows the publication outcome and no preview result remains', !pol.hasPreview && pol.text.includes(row.body?.policyVersion ?? '?'), pol.status);
    await greg.snap('greg-published-1440.jpg', true);
    if (shared.offerBefore) {
      const offer = await ok(shared.offerBefore.owner, `/offers/${encodeURIComponent(shared.offerBefore.id)}`);
      const unchanged = same(offer.quote ?? offer, shared.offerBefore.terms);
      check(s, 'The employee offer made before activation keeps its terms after activation', unchanged && ['active', 'pending'].includes(offer.state), { id: shared.offerBefore.id, state: offer.state, unchanged, terms: offer.quote ?? offer });
    } else check(s, 'The employee offer made before activation keeps its terms after activation', false, 'no offer was captured');
    await greg.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/greg` }); await waitLoaded(greg);
    const reloaded = await policyDom(greg);
    check(s, 'Reloaded Greg page shows the server active version and field value', reloaded.facts.includes(after.activeVersionLabel) && reloaded.sources.includes(after.activeVersion)
      && reloaded.inputs[after.fields.findIndex((f) => f.id === typed.id)] === String(typed.to), { label: after.activeVersionLabel, version: after.activeVersion });
    shared.policy1 = after;
  });

  // 5. Version checks at script level: unknown and stale versions are refused and nothing is activated.
  await scenario('publish-version-checks', 'Unknown and stale versions are refused by Java on publish and preview, and nothing is activated', async (s) => {
    const old = shared.policy0; const current = await ok('greg', '/greg/policy');
    check(s, 'Setup: the active version moved on from the first read', current.activeVersion !== old.activeVersion && current.activeVersion === shared.policy1?.activeVersion);
    const field = current.fields.find((f) => f.kind === 'price') ?? current.fields[0];
    const changes = [{ id: field.id, value: field.value + 25 }];
    const unknown = await call('greg', '/greg/policy/publish', publishBody('no-such-version', newVersion(), current.asOf, changes));
    s.observations.unknownVersion = brief(unknown);
    check(s, 'An unretained expectedActiveVersion is refused 400 invalid-active-version', unknown.status === 400 && unknown.json?.code === 'invalid-active-version');
    const stale = await call('greg', '/greg/policy/publish', publishBody(old.activeVersion, newVersion(), current.asOf, changes));
    s.observations.stalePublish = brief(stale);
    check(s, 'A stale publish (old version, fresh asOf) is refused 409 stale-version with accepted false', stale.status === 409 && stale.json?.status === 'stale-version' && stale.json?.accepted === false
      && stale.json?.expectedVersion === old.activeVersion && stale.json?.currentVersion === current.activeVersion);
    const preview = await call('greg', '/greg/policy/preview', { expectedActiveVersion: old.activeVersion, changes });
    s.observations.stalePreview = { ...brief(preview), hasAccepted: !!preview.json && 'accepted' in preview.json, action: preview.json?.action };
    check(s, 'A stale preview is refused 409 stale-version with no accepted key', preview.status === 409 && preview.json?.status === 'stale-version' && !!preview.json && !('accepted' in preview.json)
      && preview.json?.expectedVersion === old.activeVersion && preview.json?.currentVersion === current.activeVersion && preview.json?.retryable === false && preview.json?.action === 'refresh');
    const after = await ok('greg', '/greg/policy');
    check(s, 'Nothing was activated: the active version and field value are unchanged', after.activeVersion === current.activeVersion && after.fields.find((f) => f.id === field.id)?.value === field.value, { activeVersion: after.activeVersion });
  });

  // 6. Stale in the UI: the page still shows the previous active version when another publish lands.
  await scenario('stale-in-ui', 'A later publish makes the open page stale; Preview is refused 409 and the page shows The policy changed with no preview', async (s) => {
    const shown = shared.policy1; const current = await ok('greg', '/greg/policy');
    const field = current.fields.find((f) => f.kind === 'price') ?? current.fields[0];
    const next = newVersion();
    const pub = await call('greg', '/greg/policy/publish', publishBody(current.activeVersion, next, current.asOf, [{ id: field.id, value: field.value + 11 }]));
    s.observations.laterPublish = brief(pub);
    check(s, 'A later script-level publish with a fresh asOf is accepted and activates', pub.status === 200 && pub.json?.value?.accepted === true && pub.json?.value?.policyVersion === next && pub.json?.value?.activation?.status === 'active');
    await selectTab(greg, 'Policy');
    const { field: edited, to } = await typeDraft(greg, shown, 3);
    const before = greg.log.length;
    await greg.act("return press('Preview changes', $('.greg-policy'));");
    const [row] = await waitCall(greg, before, 'POST', '/greg/policy/preview');
    s.observations.stalePreview = { status: row.status, bearer: row.bearer, body: row.body, response: row.response };
    check(s, 'The browser preview carried the old active version and a bearer', row.bearer === true && row.body?.expectedActiveVersion === shown.activeVersion && same(row.body?.changes, [{ id: edited.id, value: to }]));
    check(s, 'Java answered 409 stale-version naming the new active version, with no accepted key', row.status === 409 && row.response?.status === 'stale-version' && row.response?.currentVersion === next
      && row.response?.expectedVersion === shown.activeVersion && !('accepted' in (row.response ?? {})));
    await greg.until("return norm($('.greg-policy')?.textContent).includes('The policy changed');", 10000, 'explicit policy changed state');
    const pol = await policyDom(greg);
    check(s, 'DOM shows The policy changed, no preview result, and Preview and Publish disabled', pol.text.includes('The policy changed') && !pol.hasPreview && pol.publishDisabled === true && pol.previewDisabled === true, pol.status);
    await greg.snap('greg-stale-1440.jpg', true);
    await greg.act("return press('Refresh demand and policy', $('.greg-policy'));"); await waitLoaded(greg);
    const refreshed = await policyDom(greg);
    check(s, 'A deliberate refresh shows the new active version reference', refreshed.sources.includes(next), { version: next });
  });

  // 5. Unavailable: abort each read through CDP Fetch; no stale numbers stay painted.
  await scenario('unavailable', 'Aborted demand and policy reads show explicit unavailable states and no stale figures', async (s) => {
    const abortOn = async (route, fn) => {
      let aborted = 0;
      const handler = (message) => { if (message.sessionId === greg.sid && message.method === 'Fetch.requestPaused') { aborted++; void greg.send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'ConnectionFailed' }); } };
      await greg.send('Fetch.enable', { patterns: [{ urlPattern: `${API_BASE}${route}*`, requestStage: 'Request' }] });
      cdp.listeners.push(handler);
      try { await fn(); } finally { cdp.listeners = cdp.listeners.filter((l) => l !== handler); await greg.send('Fetch.disable').catch(() => {}); }
      return aborted;
    };
    await selectTab(greg, 'Demand and supply');
    const demandAborted = await abortOn('/greg/demand', async () => {
      await greg.act("return press('Refresh demand and policy', $('.greg-demand'));");
      await greg.until("return norm($('.greg-demand')?.textContent).includes('Demand figures unavailable');", 20000, 'demand unavailable state');
      const dom = await demandDom(greg);
      s.observations.demandUnavailable = { status: await greg.act("return norm($('.greg-demand .demand-status')?.textContent);"), cellCount: dom.cellCount };
      check(s, 'Demand shows "Demand figures unavailable" with the refresh message', dom.text.includes('Demand figures unavailable') && dom.text.includes('could not be confirmed'));
      check(s, 'No demand figure is painted as current while unavailable', !dom.hasMetrics && dom.cellCount === 0 && dom.cells.length === 0);
      await greg.snap('greg-demand-unavailable-1440.jpg');
      await greg.viewport(390, 844); await greg.snap('greg-demand-unavailable-390.jpg'); await greg.viewport(1440, 1000);
    });
    check(s, 'The CDP abort was applied to the demand read only', demandAborted > 0, { aborted: demandAborted });
    await greg.act("return press('Refresh demand and policy', $('.greg-demand'));"); await waitLoaded(greg);
    check(s, 'A deliberate refresh restores the demand figures', (await demandDom(greg)).hasMetrics);
    await selectTab(greg, 'Policy');
    const policyAborted = await abortOn('/greg/policy', async () => {
      await greg.act("return press('Refresh demand and policy', $('.greg-policy'));");
      await greg.until("return norm($('.greg-policy')?.textContent).includes('Policy unavailable');", 20000, 'policy unavailable state');
      const pol = await policyDom(greg);
      s.observations.policyUnavailable = { status: pol.status };
      check(s, 'Policy shows "Policy unavailable" with no editable fields', pol.text.includes('Policy unavailable') && !pol.hasControls);
      check(s, 'Preview and Publish are disabled while the policy is unavailable', pol.previewDisabled === true && pol.publishDisabled === true);
      await greg.snap('greg-policy-unavailable-1440.jpg');
    });
    check(s, 'The CDP abort was applied to the policy read only', policyAborted > 0, { aborted: policyAborted });
    await greg.act("return press('Refresh demand and policy', $('.greg-policy'));"); await waitLoaded(greg);
    check(s, 'A deliberate refresh restores the policy controls', (await policyDom(greg)).hasControls);
  });

  // 6. Denied: employee and presenter see access denied; the API refuses every Greg route.
  await scenario('denied', 'Employee and presenter are denied in the browser and by Java on every Greg route', async (s) => {
    for (const person of ['paula', 'presenter']) {
      const page = await newPage(cdp, `${person} denied`);
      const login = await signIn(page, person, '/gcsp/greg', '/gcsp/access-denied');
      await page.until("return norm(document.body.textContent).includes('Access not available');", 15000, 'access denied state');
      await page.settle();
      const facts = await page.act("return { text: norm(main.textContent), hasDemand: !!$('.greg-demand'), hasPolicy: !!$('.greg-policy'), hasMetrics: !!document.querySelector('.demand-metrics')};");
      const gregCalls = page.calls().filter((c) => c.path.startsWith('/greg/'));
      s.observations[person] = { path: login.path, calls: gregCalls.map((c) => ({ path: c.path, status: c.status, failed: c.failed })), text: facts.text.slice(0, 120) };
      check(s, `${person}: the browser lands on the access-denied state`, login.path === '/gcsp/access-denied' && facts.text.includes('Access not available'));
      check(s, `${person}: no Greg content is rendered and no demand or policy request succeeded`, !facts.hasDemand && !facts.hasPolicy && !facts.hasMetrics && gregCalls.every((c) => c.status !== 200));
      await page.snap(`denied-${person}-1440.jpg`);
      if (person === 'paula') { await page.viewport(390, 844); await page.snap('denied-paula-390.jpg'); }
    }
    const routes = [['GET', '/greg/demand'], ['GET', '/greg/policy'], ['POST', '/greg/policy/preview'], ['POST', '/greg/policy/publish']];
    const outcomes = {};
    for (const person of ['paula', 'presenter']) {
      for (const [method, route] of routes) {
        const response = await call(person, route, method === 'POST' ? {} : undefined);
        outcomes[`${person} ${method} ${route}`] = { http: response.status, status: response.json?.status, code: response.json?.code };
      }
    }
    for (const [method, route] of routes) {
      const response = await request(method, route, null, method === 'POST' ? {} : null);
      outcomes[`no-token ${method} ${route}`] = { http: response.status, status: response.json?.status, code: response.json?.code };
    }
    s.observations.apiRefusals = outcomes;
    check(s, 'Employee and presenter bearers get 403 role-required on all four routes',
      Object.entries(outcomes).filter(([k]) => !k.startsWith('no-token')).every(([, o]) => o.http === 403 && o.code === 'role-required'));
    check(s, 'No bearer gets 401 on all four routes', Object.entries(outcomes).filter(([k]) => k.startsWith('no-token')).every(([, o]) => o.http === 401));
  });

  // 7. Rendered quality summary from the captures and probes above.
  await scenario('rendered', 'Captures, overflow, keyboard focus and CSP across the states above', async (s) => {
    const names = render.captures.map((c) => c.file);
    s.observations.captures = render.captures;
    for (const name of ['greg-demand-1440.jpg', 'greg-demand-390.jpg', 'greg-policy-1440.jpg', 'greg-policy-390.jpg', 'greg-preview-ready-1440.jpg', 'greg-preview-ready-390.jpg', 'greg-published-1440.jpg', 'greg-stale-1440.jpg',
      'denied-paula-1440.jpg', 'denied-paula-390.jpg', 'greg-demand-unavailable-1440.jpg', 'greg-demand-unavailable-390.jpg']) check(s, `Captured ${name}`, names.includes(name));
    check(s, 'No capture has horizontal overflow (scrollWidth <= innerWidth)', render.captures.every((c) => !c.overflow), render.captures.filter((c) => c.overflow));
    s.observations.focus = render.focus;
    check(s, 'Tab reaches the Preview button and it has a visible focus outline', render.focus?.reachedPreview === true && render.focus.visible && render.focus.outlineStyle !== 'none' && parseFloat(render.focus.outlineWidth) > 0, render.focus);
    const csp = allPages.flatMap((p) => p.csp);
    check(s, 'No CSP violation messages in any browser context', csp.length === 0, csp.slice(0, 5));
    const errors = allPages.flatMap((p) => p.errors.map((e) => `${p.label}: ${e}`));
    check(s, 'No uncaught runtime exceptions in any browser context', errors.length === 0, errors.slice(0, 5));
  });
}

function teardown() {
  if (teardownPromise) return teardownPromise;
  teardownPromise = (async () => {
    for (const child of owned.slice().reverse()) {
      try { await child.stop(); await child.logClosed; } catch (error) { log('owned child stop error', child.pid, error.message); }
    }
    await closeServer(webServer); await closeServer(idp.server);
    receipt.teardown = { ownedProcesses: receipt.processes.map((run) => ({ name: run.name, pid: run.pid, exit: run.exit })), allOwnedExited: owned.every((child) => child.done), screenshotBytes: shotBytes, logBytes };
  })();
  return teardownPromise;
}
function finish(runError) {
  if (finished) return;
  finished = true;
  receipt.endedAt = new Date().toISOString();
  if (runError) receipt.runError = runError;
  const required = ['seed-through-routes', 'greg-demand-and-policy', 'preview-ready', 'publish-through-ui', 'publish-version-checks', 'stale-in-ui', 'unavailable', 'denied', 'rendered'];
  receipt.overall = required.every((name) => receipt.scenarios[name]?.pass === true) && !runError && receipt.teardown?.allOwnedExited === true ? receipt.blockers.length ? 'PARTIAL' : 'PASS' : 'FAIL';
  try { writeFileSync(path.join(dirs.evidence, 'fucq448-connected-greg-proof.json'), `${JSON.stringify(receipt, null, 2)}\n`); } catch (error) { console.error('receipt write failed', error.message); }
  for (const name of Object.keys(receipt.scenarios)) {
    const entry = receipt.scenarios[name];
    console.log(`  ${name}: ${entry.pass ? 'PASS' : 'FAIL'}${entry.pass ? '' : ` [${Object.entries(entry.checks).filter(([, v]) => v !== true).map(([k]) => k).join('; ')}${entry.error ? ` | ${entry.error}` : ''}]`}`);
  }
  console.log(`overall ${receipt.overall}; owned processes exited: ${receipt.teardown?.allOwnedExited}`);
}
const deadline = setTimeout(async () => { log('global deadline reached'); await teardown(); finish('global proof deadline reached'); process.exit(1); }, DEADLINE_MS);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await teardown(); finish(`interrupted by ${signal}`); process.exit(130); });
let runError;
try { await main(); } catch (error) { runError = error.message; console.error('RUN ERROR:', error.message); }
clearTimeout(deadline);
await teardown(); finish(runError);
process.exit(receipt.overall === 'PASS' ? 0 : receipt.overall === 'PARTIAL' ? 3 : 1);
