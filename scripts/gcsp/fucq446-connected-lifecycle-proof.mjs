#!/usr/bin/env node
// FUCQ-446 connected proof: built Angular lifecycle -> started Java API (OIDC, repository accounts, native PG17), headless Chrome.
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
const PROOF = path.join(SCRATCH, `fucq446-connected-${RUN_TOKEN}`);
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
// The four existing demo-preparation employees share EnvironmentGuard.FIRST_RUN_ID.
const SUBJECT = 'sub-paula';
const EMPLOYEE = 'employee-paula';
const ENVIRONMENT_ID = `f446-connected-${RUN_TOKEN}`;
const RUN_ID = 'run-1';
const POLICY = 'gcsp-policy-v1';
const PEOPLE = ['paula', 'alex'];
const CONTROL_ROLES = { presenter: ['presenter'], greg: ['greg'] };
let providerMode = 'synthetic';
const RETURN_POLICY = path.join(SCRATCH, `f446-return-policy-${RUN_TOKEN}.json`);
const PSQL = path.resolve(process.env.PROOF_PSQL_BIN ?? '/opt/homebrew/opt/postgresql@17/bin/psql');
const MEDIA_ROOT = path.resolve(process.env.PROOF_MEDIA_ROOT ?? path.join(ROOT, 'assets/gcsp-vehicle-evidence'));
const MEDIA_FILES = ['07c269dd7f55fad0a56bbad65ae72f7c35defc5e8883a8290a82972e1defb427.webp', 'ed60cefd049e7293423575b5f0fcee802dbab14083dea2480211ab272896281a.webp',
  'bd89864616f3f34813cb66230e93f5e39d6a25168331ea47e84da60fbf31a735.webp', 'c1a3b0f2df9a6c3834cd04fc8f65455e6daa8fda9e7bf0f7a9c9e5e437ec8318.webp'];
for (const file of [PSQL, MEDIA_ROOT, JAR, WEB_BROWSER, JAVA_HOME, CHROME]) if (/CloudStorage|OneDrive/i.test(file)) refuse('An input path points into a forbidden synced folder');
if (!existsSync(PSQL)) refuse('PROOF_PSQL_BIN must name the parent-pinned native PostgreSQL 17 psql');
for (const name of MEDIA_FILES) if (!existsSync(path.join(MEDIA_ROOT, name))) refuse(`Missing parent-pinned actual media ${name}`);
if (!Number.isFinite(DEADLINE_MS) || DEADLINE_MS <= 0 || DEADLINE_MS > 600000) refuse('PROOF_DEADLINE_SEC must be in (0, 600]');
const SCHEMA = `gcsp_s_f446c_${RUN_TOKEN.replace(/-/g, '_')}`;
const dirs = { logs: path.join(PROOF, 'logs'), tmp: path.join(PROOF, 'tmp'), certs: path.join(PROOF, 'certs'), static: path.join(PROOF, 'static'), browser: path.join(PROOF, 'browser'), evidence: path.join(PROOF, 'evidence') };

const receipt = { schema: 'fucq446-connected-lifecycle-proof/1', story: 'DEV-2026-11-13-014 / FUCQ-446', startedAt: new Date().toISOString(), deadlineSeconds: DEADLINE_MS / 1000, cleanupReserveSeconds: 45, runToken: RUN_TOKEN, origins: ORIGINS,
  localTestIssuer: `LOCAL TEST OIDC ISSUER ${ISSUER}: harness only, not the real provider`, composition: null, inputs: null, tools: {}, processes: [], scenarios: {}, originalAcceptance: null, failureLogs: {},
  limitations: [
    'The parent supplies prebuilt production web/API; input hashes do not independently establish their source revision.',
    'The issuer is a local test OIDC provider. Real signed tokens, code/PKCE login and Java bearer verification run; the real hosted identity provider does not.',
    'Only upstream released stock is seeded in the owned schema; lifecycle business outcomes are produced by Java services and selected synthetic providers. No HTTP business payload is intercepted or replaced.',
    'The return policy mirrors ReturnOutcomeJourneyProfile: only the existing proposeChange and enabled outcome switches change in an owned retained policy copy.',
    'Setup uses real manual draft, stock, claim, review and ordering routes. Employee lifecycle commands run through the actual Angular DOM; Greg and presenter controls use signed role tokens.',
    'Fresh isolated Chrome contexts cover desktop/narrow and private storage; Safari and hosted deployment remain unrun.',
    'The outer supervisor owns HostBudget, manifest/finalizer, aggregate output/RSS limits and final process/listener/schema/scratch audit.'] };
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
const SUPERVISOR_MARKERS = ['F446_LOCAL_TOKEN', 'TEST_RESOURCE_PARENT_RESERVATION', 'PROOF_RUN_TOKEN'];
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

// ---------- local test OIDC issuer (as fucq435, four employee subjects) ----------
const idp = { codes: new Map(), txns: new Map(), subjects: { ...Object.fromEntries(PEOPLE.map((person) => [`sub-${person}`, ['employee']])), ...Object.fromEntries(Object.entries(CONTROL_ROLES).map(([person, roles]) => [`sub-${person}`, roles])) }, keys: null, server: null };
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
    GCSP_OIDC_ACCOUNTS: JSON.stringify([...PEOPLE.map((person) => ({ subject: `sub-${person}`, roles: ['employee'], employeeId: `employee-${person}` })), ...Object.entries(CONTROL_ROLES).map(([person, roles]) => ({ subject: `sub-${person}`, roles }))]),
    GCSP_ENVIRONMENT_ID: ENVIRONMENT_ID, GCSP_RUN_ID: RUN_ID, GCSP_POLICY_VERSION: POLICY,
    GCSP_ACCOUNT_PROVIDER: 'repository', GCSP_SCENARIO_PROVIDER: 'demo', GCSP_ORDERING_PROVIDER: 'synthetic', GCSP_RESET_ALLOWED: 'true',
    GCSP_APPROVALS_PROVIDER: providerMode, GCSP_DOCUMENTS_PROVIDER: providerMode, GCSP_APPOINTMENTS_PROVIDER: providerMode, GCSP_RETURNS_PROVIDER: providerMode, GCSP_RETURNS_POLICY_FILE: RETURN_POLICY, GCSP_SUPPLY_PROVIDER: 'demo',
    GCSP_CLAIMS_SWEEP_INTERVAL: '10m', GCSP_NOTIFY_DRAIN_INTERVAL: '10m', GCSP_PUBLIC_BASE_URL: PUBLIC_BASE_URL,
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
    { PATH: process.env.PATH, HOME: process.env.HOME, PGCONNECT_TIMEOUT: '10' }, 30000);
}
const ACCOUNT_KEY = `environment_id = '${ENVIRONMENT_ID}' AND run_id = '${RUN_ID}'`;
const quoted = (v) => `'${String(v).replace(/'/g, "''")}'`;
const STOCK_IDS = ['44600000-0000-4000-8000-000000000001'];
async function seedStock() {
  const account = await serverAccount();
  if (account.state !== 'ready') throw new Error(`Fixture account is ${account.state}, expected ready`);
  const cases = path.join(ROOT, 'services/gcsp-api/src/test/resources/recommendation-source/source-cases.json');
  receipt.inputs.stockFixture = { path: path.relative(ROOT, cases), sha256: sha256File(cases) };
  const base = JSON.parse(readFileSync(cases, 'utf8')).cases.find((c) => c.name === 'paula-mixed').rows[0];
  const options = account.choices;
  const driver = options.drivers.find((d) => d.kind === 'employee');
  const contract = options.contractOptions.find((c) => c.driverKinds.includes(driver?.kind));
  const rules = account.assumptions?.find((a) => Number.isSafeInteger(a.value?.minimumLeadDays)
    && Number.isSafeInteger(a.value?.maximumLeadDays))?.value;
  if (!driver || !contract || !rules || !/^\d{4}-\d{2}-\d{2}T/.test(account.asOf ?? '')) throw new Error('Account lacks authoritative draft setup choices, clock or lead rules');
  const today = Date.parse(`${account.asOf.slice(0, 10)}T00:00:00Z`);
  const window = account.currentContract;
  let day; let location;
  for (let lead = rules.minimumLeadDays; lead <= rules.maximumLeadDays; lead++) {
    const offered = new Date(today + lead * 86400000).toISOString().slice(0, 10);
    if (window?.earliestCollectionDate && offered < window.earliestCollectionDate
      || window?.latestCollectionDate && offered > window.latestCollectionDate) continue;
    const open = options.collectionLocations.find((l) => l.driverKinds.includes(driver.kind)
      && l.contractOptionIds.includes(contract.contractOptionId) && !(l.closedDates ?? []).includes(offered));
    if (open) { day = offered; location = open; break; }
  }
  if (!day || !location) throw new Error('Fixture has no collection date inside its authoritative lead/window/location rules');
  const rows = STOCK_IDS.map((orderUuid, i) => {
    const row = structuredClone(base);
    row.orderUuid = orderUuid; row.orderNumber = `446000${i + 1}`;
    row.configurationId = 'F446-touring-configuration';
    const snapshot = row.facts;
    snapshot.sourceKeys.stockId = orderUuid; snapshot.snapshotVersion = `f446-snapshot-${i + 1}`;
    snapshot.display = { name: 'BMW 3 Series Touring 320i',
      photo: `/assets/gcsp-vehicle-evidence/${MEDIA_FILES[0]}` };
    const fact = (value, unit = null) => ({ status: 'known', value, unit, provenance: structuredClone(snapshot.facts.body.provenance) });
    snapshot.facts.eligibilityModelKey = fact('G21 Touring|320i');
    snapshot.facts.body = fact('estate');
    snapshot.facts.series = fact('3 Series');
    snapshot.facts.model = fact('320i');
    snapshot.facts.exterior = fact(i % 2 ? 'Mineral Grey' : 'Alpine White');
    snapshot.facts.interior = fact('Black upholstery');
    snapshot.facts.insuranceGroup = fact(20, 'insurance-group');
    snapshot.facts.earliestCollection = fact(new Date(Date.parse(`${day}T00:00:00Z`)).toISOString());
    snapshot.facts.equipment = fact([i % 2 ? 'Heated seats' : 'Parking camera']);
    row.release.availability = { state: 'available', availableFrom: '2020-01-01T00:00:00.000Z', availableUntil: '2099-01-01T00:00:00.000Z', version: `f446-release-${i + 1}` };
    return row;
  });
  await sql(`BEGIN; DELETE FROM stock_cars WHERE ${ACCOUNT_KEY}; ${rows.map((row) => {
    const attributes = { ...row }; for (const key of ['orderUuid', 'configurationId', 'state', 'available', 'held', 'allocated', 'version']) delete attributes[key];
    return `INSERT INTO stock_cars (environment_id,run_id,order_uuid,configuration_id,state,attributes,version) VALUES (${quoted(ENVIRONMENT_ID)},${quoted(RUN_ID)},${quoted(row.orderUuid)},${quoted(row.configurationId)},'released',${quoted(JSON.stringify(attributes))}::jsonb,1);`;
  }).join('\n')} COMMIT;`);
  const choices = { mode: 'replacement', oldContractId: account.currentContract.contractId, slotId: options.slotId, schemeId: options.schemeId,
    driverId: driver.driverId, contractOptionId: contract.contractOptionId, requestedCollectionDate: day, collectionLocationId: location.locationId,
    brand: options.brands[0], contact: { phone: '01632 960000', email: 'paula.mason@gcsp-demo.com' }, expectedReturnMileage: 20000, specialRequirements: '' };
  const saved = await request('POST', '/manual/draft', { Authorization: `Bearer ${signJwt(accessClaims(SUBJECT, ['employee']), idp.keys.privateKey)}`, 'Content-Type': 'application/json' },
    { commandId: `f446-setup-${RUN_TOKEN}`, expectedDraftVersion: 0, expectedContextVersion: account.contextVersion, choices });
  receipt.fixture = { stockIds: STOCK_IDS,
    setupDate: { asOf: account.asOf, minimumLeadDays: rules.minimumLeadDays, maximumLeadDays: rules.maximumLeadDays,
      earliest: window?.earliestCollectionDate, latest: window?.latestCollectionDate, chosen: day, locationId: location.locationId },
    setupDraft: saved, mutations: [] };
  if (saved.status !== 200 || saved.json?.status !== 'ok') throw new Error(`Complete draft setup failed: ${JSON.stringify(saved)}`);
}

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
const responseSummary = (body) => body;
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
// DOM-only selectors follow OrdersComponent and the shared portal shell.
const HELPERS = `
const main = document.querySelector('#gcsp-main') ?? document;
const $ = (s) => main.querySelector(s);
const button = (label) => [...main.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const press = (label) => { const b = button(label); if (!b || b.disabled) return false; b.click(); return true; };
const text = () => main.textContent.replace(/\\s+/g, ' ').trim();
const cards = () => [...main.querySelectorAll('gcsp-vehicle-card article')].map((a) => a.dataset.memberId);
const setValue = (selector, value) => { const el = $(selector); if (!el || el.disabled) return false; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; };
const choose = (id, value) => { const b = [...main.querySelectorAll('#' + id + ' button')].find((b) => b.value === value); if (!b || b.disabled) return false; b.click(); return true; };
const detail = (id) => { const b = [...main.querySelectorAll('[data-details-id]')].find((b) => b.dataset.detailsId === id); if (!b) return false; b.click(); return true; };
const facts = (root) => [...root.querySelectorAll('dl > div')].map((r) => [r.querySelector('dt')?.textContent.trim(), r.querySelector('dd')?.textContent.trim()]);
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
  // DOM readiness can precede the asynchronous CDP body capture. Require this document's own body.
  const bodyDeadline = Date.now() + 5000;
  while (!read.failed && read.response === undefined && Date.now() < bodyDeadline) { await sleep(100); await page.settle(); }
  if (!read.failed && read.response === undefined) throw new Error(`${page.label}: ${readPath} response body was not captured for ${what}`);
  return read;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ORDERS_READY = `return !!$('.orders-screen') && !!$('#order-summary-title') && !$('.order-sections[aria-busy="true"]');`;
const rolesFor = (person) => CONTROL_ROLES[person] ?? ['employee'];
const command = () => `f446-${RUN_TOKEN}-${randomBytes(6).toString('hex')}`;
async function call(person, suffix, body) {
  return request(body === undefined ? 'GET' : 'POST', suffix,
    { Authorization: `Bearer ${signJwt(accessClaims(`sub-${person}`, rolesFor(person)), idp.keys.privateKey)}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body ?? null);
}
async function value(person, suffix, body) {
  const r = await call(person, suffix, body);
  if (r.status !== 200 || r.json?.status !== 'ok') throw new Error(`${person} ${suffix}: ${JSON.stringify(r)}`);
  return r.json.value;
}
function writeReturnPolicy() {
  const source = path.join(ROOT, 'server/gcsp/policy/seed-v1.json');
  const policy = JSON.parse(readFileSync(source, 'utf8')); let changed = 0;
  for (const row of policy.assumptions) {
    if (row.key === 'lifecycle.appointments.scenario.v1') { row.value.proposeChange = true; changed++; }
    if (row.key === 'lifecycle.return.outcome.v1') { row.value.enabled = true; changed++; }
  }
  if (changed !== 2) throw new Error('Existing return journey policy switches are missing');
  writeFileSync(RETURN_POLICY, JSON.stringify(policy));
  receipt.inputs.returnPolicy = { source: path.relative(ROOT, source), sourceSha256: sha256File(source), path: RETURN_POLICY, sha256: sha256File(RETURN_POLICY), switches: ['lifecycle.appointments.scenario.v1.proposeChange=true', 'lifecycle.return.outcome.v1.enabled=true'] };
}
let order;
async function placeOrder() {
  const stock = await value('paula', '/manual/stock');
  const input = stock.decisions.find((d) => d.gateStatus === 'eligible')?.claimInput;
  if (!input) throw new Error(`No eligible real stock decision: ${JSON.stringify(stock.decisions)}`);
  const claimed = await value('paula', '/manual/claim', { ...input, commandId: command() });
  const reviewed = await value('paula', '/manual/claim/review', { commandId: command(), holdId: claimed.hold.holdId, expectedHoldVersion: claimed.hold.version, expectedDraftVersion: 1 });
  const terms = await value('paula', '/manual/order/terms');
  const placed = await value('paula', '/manual/order', { commandId: command(), source: { type: 'cart', holdId: claimed.hold.holdId, expectedHoldVersion: reviewed.hold.version, expectedDraftVersion: 1 }, expectedQuoteId: reviewed.quote.quoteId, expectedStockVersion: reviewed.quote.stockVersion, termsDigest: terms.termsDigest, declarations: { terms: true, driver: true, return: true } });
  if (placed.status !== 'acknowledged' || placed.selection.orderUuid !== input.orderUuid) throw new Error('Ordering did not acknowledge the exact selected car');
  order = input.orderUuid; receipt.orderSetup = { orderUuid: order, status: placed.status, quoteId: reviewed.quote.quoteId };
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
const plus = (at, seconds) => new Date(Date.parse(at) + seconds * 1000).toISOString();
async function truth() {
  const [stages, documents, appointment, plan, account] = await Promise.all([
    value('paula', `/orders/progress?orderUuid=${order}`), value('paula', '/documents'),
    value('paula', `/appointments?orderUuid=${order}`), value('paula', `/return-plan?orderUuid=${order}`), value('paula', '/manual/account')]);
  const document = documents.orders.find((d) => d.orderUuid === order);
  return { stages, document: document ?? null, appointment, plan, relationships: account.currentCarRelationships ?? null };
}
async function openOrders(page, how = `${ORIGINS.web}/gcsp/orders?orderUuid=${order}`) {
  return freshDocument(page, how, { ready: ORDERS_READY, readPath: '/return-plan', what: 'current order lifecycle document' });
}
async function capture(page, s, name) {
  const read = await openOrders(page); const t = await truth();
  const dom = await page.act(`return { text: text(), panels: [...main.querySelectorAll('.order-panel')].map(p => ({ title: p.querySelector('h2')?.textContent, text: p.textContent.replace(/\\s+/g, ' ').trim() })), overflow: document.documentElement.scrollWidth > innerWidth + 1, focus: document.activeElement?.outerHTML?.slice(0,200) };`);
  s.observations[name] = { truth: t, dom, browserRead: read, screenshot: await page.shot(`${name}.png`) };
  s.checks[`${name}: exact owned order`] = [t.stages, t.document, t.appointment, t.plan].filter(Boolean).every(v => v.orderUuid === order && v.employeeId === EMPLOYEE && v.runId === RUN_ID);
  s.checks[`${name}: actual signed Java read`] = read.auth && read.status === 200 && read.response?.value?.orderUuid === order;
  s.checks[`${name}: visible sections`] = ['Your order', 'Handover', 'Documents and checks', 'Current car', 'Returning your previous car'].every(title => dom.panels.some(p => p.title === title));
  s.checks[`${name}: no horizontal overflow`] = !dom.overflow;
  const owner = (v) => v === 'employee' ? 'You' : String(v ?? '').replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
  s.checks[`${name}: next authority presented`] = [t.stages, t.appointment, t.plan].every(v => (!v.owner || dom.text.includes(owner(v.owner))) && (!v.nextStep || dom.text.includes(v.nextStep)));
  const readinessText = dom.panels.find(p => p.title === 'Documents and checks')?.text ?? '';
  // The stages panel always names its readiness stage; only the documents panel presents the current readiness fact.
  s.checks[`${name}: readiness presented`] = t.document ? readinessText.includes(t.document.readiness.ready ? 'Ready for handover' : 'Not ready for handover')
    : readinessText.includes('Documents and checks open once your order is sent to ordering.');
  // FUCQ-522: Java retains proposedSlot as history, so proposal copy must follow only a live change-proposed state.
  const returnText = dom.panels.find(p => p.title === 'Returning your previous car')?.text ?? '';
  const liveProposal = t.plan.state === 'return-requested' && t.plan.appointment?.state === 'change-proposed';
  s.checks[`${name}: return proposal copy matches live state`] = returnText.includes('New time proposed') === liveProposal
    && (!['returned', 'return-scheduled'].includes(t.plan.state) || !returnText.includes('Not booked yet'));
  s.checks[`${name}: no browser exception`] = page.errors.length === 0;
  return t;
}
async function employeeCommand(page, s, selector, endpoint, label) {
  const from = page.log.length;
  const clicked = await page.act(`const buttons = [...main.querySelectorAll(${JSON.stringify(selector)})].filter(b => !b.disabled); const b = buttons.at(-1); if (!b) return false; b.click(); return true;`);
  if (!clicked) throw new Error(`No available ${label} employee control`);
  await page.until(`return !!$('.order-review') && !!button('Confirm');`, 10000, `${label} explicit review`);
  s.checks[`${label}: review does not send`] = !page.calls(from).some(e => e.method === 'POST');
  await page.act(`return press('Confirm');`);
  await page.until(`return !!$('.order-notice');`, 15000, `${label} outcome`); await page.settle();
  const sent = page.calls(from).filter(e => e.method === 'POST' && e.path === endpoint);
  s.observations[`${label} command`] = sent;
  s.checks[`${label}: one signed employee command`] = sent.length === 1 && sent[0].auth && sent[0].request?.orderUuid === order && sent[0].request?.commandId === true && sent[0].request?.carriesIdentity === false;
  s.checks[`${label}: provider acknowledged`] = sent[0]?.status === 200 && sent[0]?.response?.status === 'ok';
}
async function scenario(id, title, ac, fn) {
  const s = { title, ac, pass: false, checks: {}, observations: {} }; receipt.scenarios[id] = s; log(`scenario ${id}: ${title}`);
  try { await fn(s); } catch (e) { s.error = e.message; s.checks.noException = false; }
  s.pass = Object.keys(s.checks).length > 0 && Object.values(s.checks).every(v => v === true);
  if (!s.pass) throw new Error(`Lifecycle scenario ${id} failed: ${s.error ?? Object.entries(s.checks).filter(([,v]) => !v).map(([k]) => k).join(', ')}`);
}
async function lifecycle(cdp, s, pages, proveUnavailable) {
  const page = await newPage(cdp, 'employee lifecycle'); pages.paula = page; await signIn(page);
  const initial = await capture(page, s, 'approval-pending-desktop');
  s.checks['approval has not been completed by employee'] = initial.stages.outcome !== 'sent-to-ordering';
  const t0 = (await value('presenter', '/presenter/clock')).now; await tick();
  for (let i = 0; i < 20; i++) {
    const p = await value('paula', `/orders/progress?orderUuid=${order}`); if (p.outcome === 'sent-to-ordering') break;
    const c = await value('presenter', '/presenter/clock');
    await value('presenter', '/presenter/approvals/ticks', { commandId: command(), tickId: command(), now: c.now, clockVersion: c.clockVersion });
  }
  await tick();
  const approved = await capture(page, s, 'approved-documents-outstanding');
  s.checks['provider sent order to ordering'] = approved.stages.outcome === 'sent-to-ordering';
  s.checks['employee and provider tasks separate'] = approved.document.items.some(i => i.owner === 'employee' && i.status === 'waiting-for-employee') && approved.document.items.some(i => i.owner !== 'employee');
  s.checks['initial readiness is incomplete'] = approved.document.readiness.ready === false;
  await proveUnavailable();
  await openOrders(page);
  await employeeCommand(page, s, '#documents-title ~ .task-list button, #documents-title ~ ul button', '/documents/tasks/acknowledge', 'document acknowledgement');
  await capture(page, s, 'acknowledged-documents');
  await employeeCommand(page, s, 'button[aria-label^="Request handover "]', '/appointments/request', 'handover request');
  const requested = await capture(page, s, 'handover-requested');
  s.checks['request is not a booking'] = requested.appointment.state === 'requested' && requested.appointment.booked === false && requested.appointment.slot === null;
  s.checks['request preserves current car'] = requested.plan.relationship?.currentCar?.kind !== 'order';
  await tick(plus(t0, 1801));
  const scheduled = await capture(page, s, 'handover-booked');
  s.checks['provider books handover'] = scheduled.appointment.state === 'scheduled' && scheduled.appointment.booked === true;
  await employeeCommand(page, s, 'button[aria-label^="Request return "]', '/return-plan/request', 'return request');
  const returning = await capture(page, s, 'return-requested');
  s.checks['return request is not a booking'] = returning.plan.state === 'return-requested' && returning.plan.scheduled === false;
  await tick(plus(t0, 3602));
  const proposed = await capture(page, s, 'return-proposed');
  s.checks['provider proposal requires employee acceptance'] = proposed.plan.appointment?.state === 'change-proposed' && !!proposed.plan.proposalId && proposed.plan.scheduled === false;
  await employeeCommand(page, s, '#return-title ~ button', '/return-plan/accept', 'return acceptance');
  const booked = await capture(page, s, 'return-booked'); pages.booked = booked;
  s.checks['bookings do not prove physical events'] = booked.appointment.state === 'scheduled' && booked.plan.state === 'return-scheduled' && booked.plan.outcome === null && booked.plan.relationship?.currentCar?.kind !== 'order';
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await capture(page, s, 'booked-narrow');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  s.checks['keyboard reaches an interactive control'] = await page.eval(`['A','BUTTON','SELECT','INPUT'].includes(document.activeElement?.tagName)`);
  s.observations.keyboardScreenshot = await page.shot('booked-keyboard-narrow.png');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  pages.t0 = t0;
}
async function ownership(cdp, s, pages) {
  const page = await newPage(cdp, 'other employee'); await signIn(page, 'alex');
  await freshDocument(page, `${ORIGINS.web}/gcsp/orders?orderUuid=${order}`, { ready: `return /Order not found/.test(text());`, readPath: '/orders/progress/all', readOk: false, what: 'other employee order refusal' });
  s.observations.otherEmployee = { text: await page.act('return text();'), calls: page.calls(), screenshot: await page.shot('other-employee-refused.png') };
  s.checks['other employee does not see owned car'] = !(await page.act('return !!$("#order-summary-title");'));
  const denies = [];
  for (const person of ['alex', 'presenter']) {
    for (const [route, body] of [
      ['/documents/tasks/acknowledge', { commandId: command(), orderUuid: order, itemId: 'agreement-acknowledgement', expectedDocumentsRevision: 1 }],
      ['/appointments/request', { commandId: command(), orderUuid: order, slotId: pages.booked.appointment.slot.slotId, expectedVersion: pages.booked.appointment.version }],
      ['/return-plan/request', { commandId: command(), orderUuid: order, choice: 'same-visit', slotId: pages.booked.appointment.slot.slotId, expectedVersion: pages.booked.plan.version }],
      ['/appointments/complete', { commandId: command(), orderUuid: order, expectedVersion: pages.booked.appointment.version }]]) {
      const r = await call(person, route, body); denies.push({ person, route, ...r });
    }
  }
  const employeeComplete = await call('paula', '/appointments/complete', { commandId: command(), orderUuid: order, expectedVersion: pages.booked.appointment.version });
  denies.push({ person: 'paula', route: '/appointments/complete', ...employeeComplete });
  s.observations.refusals = denies;
  s.checks['employee ownership and physical authority enforced'] = denies.every(r => r.status === 403);
  const t = await truth(); s.checks['refused work preserves relationship'] = same(t.plan.relationship, pages.booked.plan.relationship);
}
async function physical(s, pages) {
  const page = pages.paula; const booked = pages.booked;
  await tick(plus(pages.t0, 86400 + 1802)); await tick(plus(pages.t0, 172800 + 1802));
  const ready = await capture(page, s, 'documents-ready');
  s.checks['provider and employee work both ready'] = ready.document.readiness.ready === true;
  const at = booked.appointment.slot.start; await tick(at);
  const completed = await value('greg', '/appointments/complete', { commandId: command(), orderUuid: order, expectedVersion: ready.appointment.version });
  s.checks['Greg records physical completion'] = completed.state === 'completed' && !!completed.outcome?.at;
  await tick(plus(at, 60));
  const collected = await capture(page, s, 'handover-completed-old-car-held');
  s.checks['physical collection changes current car'] = collected.plan.relationship?.currentCar?.kind === 'order' && collected.plan.relationship.currentCar.orderUuid === order && collected.plan.relationship.newCar?.status === 'collected' && collected.plan.relationship.oldCar?.status === 'held';
  const returnEnd = booked.plan.slot.end;
  await tick(plus(returnEnd, 1801));
  const returned = await capture(page, s, 'old-car-returned');
  s.checks['provider outcome records returned old car'] = returned.plan.state === 'returned' && returned.plan.relationship?.oldCar?.status === 'returned' && !!returned.plan.outcome?.providerReference;
  s.checks['new current car remains collected'] = returned.plan.relationship?.currentCar?.orderUuid === order && returned.plan.relationship.newCar?.status === 'collected';
  const before = returned.plan.relationship;
  await stopApi(); await startApi();
  const restarted = await capture(page, s, 'restart-current-car');
  s.checks['restart preserves relationship and outcome'] = same(before, restarted.plan.relationship) && same(returned.plan.outcome, restarted.plan.outcome) && same(returned.relationships, restarted.relationships);
  const read = await openOrders(page, 'reload');
  s.checks['reload fetches current persisted relationship'] = same(read.response?.value?.relationship, before);
}
async function unavailable(s, pages) {
  await stopApi(); providerMode = 'none'; await startApi();
  const page = pages.paula;
  await freshDocument(page, `${ORIGINS.web}/gcsp/orders?orderUuid=${order}`, { ready: ORDERS_READY, readPath: '/appointments', readOk: false, what: 'missing lifecycle provider refusal' });
  await page.settle();
  const text = await page.act('return text();');
  s.observations.unconfigured = { text, calls: page.calls().slice(-15), screenshot: await page.shot('providers-unconfigured.png') };
  s.checks['missing provider cannot offer employee commands'] = !(await page.act(`return [...main.querySelectorAll('.order-panel button')].some(b => !b.disabled);`));
  s.checks['missing provider is visibly unavailable'] = /unavailable|not configured|not supplied|not selected|not available/i.test(text);
  const refused = await call('paula', '/documents/tasks/acknowledge', { commandId: command(), orderUuid: order, itemId: 'agreement-acknowledgement', expectedDocumentsRevision: (await value('paula', '/documents')).orders.find(d => d.orderUuid === order).documentsRevision });
  s.observations.missingProviderCommand = refused;
  s.checks['missing provider refuses acknowledgement'] = [422, 503].includes(refused.status) && refused.json?.status !== 'ok';
  s.checks['no employee command silently submitted'] = !page.calls().filter(e => e.doc === page.docs).some(e => e.method === 'POST');
  await stopApi(); providerMode = 'synthetic'; await startApi();
}

// ---------- main ----------
function accessLog() {
  const rows = [];
  for (const p of receipt.processes.filter((x) => x.name.startsWith('api-'))) {
    for (const l of tail(path.join(dirs.logs, `${p.name}.log`), 100000).split('\n')) { const m = /ACCESSLOG (\S+) (\S+) (\d+)/.exec(l); if (m && (/\/(manual|ordering|context|orders|documents|appointments|return-plan|presenter)/.test(m[2]))) rows.push(`${p.name} ${m[1]} ${m[2].replace(API_PATH, '')} ${m[3]}`); }
  }
  return rows.slice(-80);
}
async function main() {
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  for (const [k, p] of Object.entries(PORTS)) if (!(await portFree(p))) throw new Error(`port ${p} (${k}) is in use; choose PROOF_${k.toUpperCase()}_PORT`);
  receipt.inputs = { scratch: PROOF, publicMailBaseUrl: PUBLIC_BASE_URL, database: { source: DB_SOURCE, host: DB[1], port: DB[2] ?? '5432', name: DB_NAME, schema: SCHEMA }, ports: PORTS, jar: { path: path.relative(ROOT, JAR), sha256: sha256File(JAR) },
    appJars: readdirSync(path.join(path.dirname(JAR), 'app')).filter((f) => f.endsWith('.jar')).map((f) => ({ file: f, sha256: sha256File(path.join(path.dirname(JAR), 'app', f)) })), psql: { path: PSQL, sha256: sha256File(PSQL) }, media: MEDIA_FILES.map((name) => ({ name, sha256: sha256File(path.join(MEDIA_ROOT, name)) })), webBrowser: { path: path.relative(ROOT, WEB_BROWSER), indexSha256: sha256File(path.join(WEB_BROWSER, 'index.html')) } };
  receipt.composition = { identity: 'oidc (local test issuer)', subjects: PEOPLE.map((p) => ({ subject: `sub-${p}`, employeeId: `employee-${p}` })), account: 'repository', scenario: 'demo', ordering: 'synthetic', lifecycle: 'synthetic (explicit none-provider refusal phase)', returnPolicy: 'owned retained seed copy; existing proposal/outcome switches only', resetAllowed: true, environmentId: ENVIRONMENT_ID, runId: RUN_ID, policyVersion: POLICY, mirrors: 'existing demo preparation plus released-stock source-cases; owned schema fixture changes only' };
  receipt.sourceRevision = { value: SOURCE_REVISION, provenance: 'PROOF_SOURCE_REVISION supplied and verified by the parent; not read from git here' };
  receipt.tools = { harnessNode: process.version, openssl: cap('openssl', ['version']), chrome: cap(CHROME, ['--version']), java: (spawnSync(path.join(JAVA_HOME, 'bin/java'), ['-version'], { encoding: 'utf8', env: childEnv(process.env) }).stderr ?? '').split('\n')[0] };
  writeReturnPolicy();
  log('certificates'); tls = makeCerts();
  log('static assembly of the prebuilt web');
  const assemble = await import(pathToFileURL(path.join(ROOT, 'scripts/build-gcsp-static.mjs')).href);
  await runOnce('assemble', process.execPath, ['scripts/build-gcsp-static.mjs', '--browser', WEB_BROWSER, '--output', dirs.static, '--environment', 'deployed', '--revision', SOURCE_REVISION],
    { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp, GCSP_PUBLIC_ENVIRONMENT_ID: ENVIRONMENT_ID, GCSP_PUBLIC_API_BASE_URL: API_BASE, GCSP_PUBLIC_OIDC_AUTHORITY: ISSUER, GCSP_PUBLIC_OIDC_CLIENT_ID: 'gcsp-web',
      GCSP_PUBLIC_OIDC_SCOPE: 'openid profile gcsp-api', GCSP_PUBLIC_OIDC_REDIRECT_URI: `${ORIGINS.web}/gcsp/auth/callback`, GCSP_PUBLIC_OIDC_POST_LOGOUT_REDIRECT_URI: `${ORIGINS.web}/gcsp/` });
  log('issuer and web'); await startIdp(tls); await startWeb(tls, assemble.GCSP_FIXED_ROUTES);
  log('API (repository accounts, native PG)'); await startApi();
  log('seed upstream released stock; place an actual acknowledged order'); await seedStock(); await placeOrder(); await tick();
  const profile = path.join(dirs.browser, 'profile'); mkdirSync(profile, { recursive: true });
  const chrome = spawnOwned('chrome', CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-allow-origins=*', `--ignore-certificate-errors-spki-list=${tls.spki}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--window-size=1280,900', 'about:blank'], { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp });
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) { if (chrome.done) throw new Error('Chrome exited during startup'); try { const [p, ws] = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n'); wsUrl = `ws://127.0.0.1:${p}${ws}`; } catch { await sleep(250); } }
  if (!wsUrl) throw new Error('Chrome DevTools endpoint not found');
  const cdp = await Cdp.connect(wsUrl); receipt.cdp = cdp;
  const pages = {};
  await scenario('a', 'Provider approval, employee tasks, bookings and pending plan states', 'AC1,AC2', s => lifecycle(cdp, s, pages,
    () => scenario('d', 'Configured missing-provider refusals stay visible and inert', 'AC1,AC2', item => unavailable(item, pages))));
  await scenario('b', 'Cross-employee and presenter command refusals preserve ownership', 'AC1,AC2', s => ownership(cdp, s, pages));
  await scenario('c', 'Physical outcomes, current car, reload and restart', 'AC1,AC2', s => physical(s, pages));

}
function teardown() {
  if (teardownPromise) return teardownPromise;
  teardownPromise = (async () => {
  receipt.fixtureOwnership = 'Only the per-run schema was mutated; parent owns its teardown audit and removal.';
  try { receipt.cdp?.ws.close(); } catch { /* closed */ }
  delete receipt.cdp;
  for (const child of owned.slice().reverse()) { try { await child.stop(); await child.logClosed; } catch (e) { log('stop error', child.pid, e.message); } }
  await closeServer(webServer); await closeServer(idp.server);
  receipt.teardown = { ownedProcesses: receipt.processes.map((p) => ({ name: p.name, pid: p.pid, exit: p.exit })), allOwnedExited: owned.every((c) => c.done), serversClosed: true,
    scratchLeftForParent: PROOF, note: 'Nothing is deleted here; the parent owns scratch, the throwaway database and teardown audit.' };
  })();
  return teardownPromise;
}
function finish(runError) {
  if (finished) return; finished = true;
  const sc = receipt.scenarios; const ok = (k) => sc[k]?.pass === true;
  receipt.endedAt = new Date().toISOString();
  if (runError) receipt.runError = runError;
  receipt.logBudget ??= { limitBytes: CHILD_LOG_LIMIT, writtenBytes: childLogBytes, exhausted: false };
  try { receipt.apiAccessLog = accessLog(); } catch { /* no log */ }
  receipt.originalAcceptance = {
    AC1: { text: 'Supported approval, document, readiness, appointment and return states/actions reflect the provider and employee authority.', scenarios: ['a', 'b', 'c', 'd'], evidence: ['a', 'b', 'c', 'd'].every(ok) ? 'pass' : 'fail', closure: 'OPEN: parent review decides' },
    AC2: { text: 'Ownership, pending/refused work and current-car relationships remain accurate through reload and supported transitions.', scenarios: ['a', 'b', 'c', 'd'], evidence: ['a', 'b', 'c', 'd'].every(ok) ? 'pass' : 'fail', closure: 'OPEN: parent review decides' } };
  receipt.overall = ['a', 'b', 'c', 'd'].every(ok) && !runError && !logLimitFailure && !receipt.fixtureRestoreError && receipt.teardown?.allOwnedExited ? 'PASS' : 'FAIL';
  const file = path.join(dirs.evidence, 'connected-lifecycle-proof.json');
  let serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > 8 * 1024 * 1024) {
    receipt.overall = 'FAIL'; receipt.runError = 'connected receipt exceeded its explicit 8MiB evidence budget';
    for (const entry of Object.values(receipt.scenarios)) entry.observations = { omitted: 'Complete observation evidence exceeded the receipt budget; this run is failed.' };
    serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  }
  try { writeFileSync(file, serialized); } catch (e) { console.error('receipt write failed', e.message); }
  for (const k of Object.keys(sc).sort()) console.log(`  ${k}: ${sc[k].pass ? 'PASS' : 'FAIL'} ${sc[k].title}${sc[k].pass ? '' : ` [failed: ${Object.entries(sc[k].checks).filter(([, v]) => v !== true).map(([n]) => n).join(', ')}]`}`);
  console.log(`overall ${receipt.overall}; receipt ${file}; all owned processes exited: ${receipt.teardown?.allOwnedExited}`);
}
const deadline = setTimeout(async () => { log('global deadline exceeded'); await teardown(); finish('global deadline exceeded'); process.exit(1); }, Math.max(1, DEADLINE_MS - 45000));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await teardown(); finish(`interrupted by ${sig}`); process.exit(130); });
let runError;
try { await main(); } catch (e) { runError = e.message; console.error('RUN ERROR:', e.message); } finally { clearTimeout(deadline); await teardown(); finish(runError); }
process.exit(receipt.overall === 'PASS' ? 0 : 1);
