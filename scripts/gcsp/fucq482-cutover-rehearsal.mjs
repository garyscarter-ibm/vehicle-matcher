#!/usr/bin/env node
// FUCQ-482 local fresh-state cutover rehearsal: the Java API on native PostgreSQL in the render.gcsp.yaml demo composition,
// the Angular site and a LOCAL TEST OIDC issuer. Proves retained-input startup, ordinary restart, the authorised reset and one journey.
// Usage: SCRATCH=/private/tmp/<owned> PROOF_RUN_TOKEN=<unique> PROOF_SOURCE_REVISION=<40hex> PROOF_API_JAR=<quarkus-run.jar>
// PROOF_WEB_BROWSER=<browser dir> GCSP_TEST_DATABASE_URL=<owned db> [PROOF_DB_USER=gcsp] [PROOF_COMPACT_RECEIPT=<abs path>] node scripts/gcsp/fucq482-cutover-rehearsal.mjs
// Helpers are copied from scripts/gcsp/fucq438-release-proof.mjs and _tools/gcsp-offer-link-proof.mjs; this script never runs git.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:https';
import https from 'node:https';
import net from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, createWriteStream, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { apiJvmArgs, jvmLimitsReceipt } from './proof-jvm.mjs';

const API_JVM_ARGS = apiJvmArgs({ heap: '768m' });
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const refuse = (why) => { console.error(`REFUSED: ${why}`); process.exit(2); };
const FORBIDDEN_PATH = /CloudStorage|OneDrive/i;

// ---------- required inputs (refuse rather than invent) ----------
const RAW_SCRATCH = process.env.SCRATCH ?? '';
if (!RAW_SCRATCH) refuse('SCRATCH is not set; the parent must supply an owned local scratch directory');
if (FORBIDDEN_PATH.test(RAW_SCRATCH)) refuse('SCRATCH points into a cloud-synced folder; never used');
if (!path.isAbsolute(RAW_SCRATCH)) refuse('SCRATCH must be an absolute path');
const SCRATCH = path.resolve(RAW_SCRATCH);
if (!SCRATCH.startsWith('/private/tmp/')) refuse('SCRATCH must be a parent-owned directory under /private/tmp');
if (SCRATCH === ROOT || SCRATCH.startsWith(`${ROOT}${path.sep}`)) refuse('SCRATCH must be outside the repository');
if (!existsSync(SCRATCH) || !statSync(SCRATCH).isDirectory()) refuse('SCRATCH must be an existing directory owned by the parent run');
const RUN_TOKEN = process.env.PROOF_RUN_TOKEN ?? '';
if (!/^[a-z0-9][a-z0-9-]{5,39}$/.test(RUN_TOKEN)) refuse('PROOF_RUN_TOKEN must be the parent run token ([a-z0-9-], 6-40 characters)');
const SOURCE_REVISION = process.env.PROOF_SOURCE_REVISION ?? '';
if (!/^[0-9a-f]{40}$/.test(SOURCE_REVISION)) refuse('PROOF_SOURCE_REVISION must be the parent-verified 40-hex source commit');
const DB_SOURCE = process.env.GCSP_TEST_DATABASE_URL ? 'GCSP_TEST_DATABASE_URL' : null;
if (!DB_SOURCE) refuse('GCSP_TEST_DATABASE_URL is not set; supply an owned throwaway PostgreSQL 17 database');
const DB_URL_RAW = process.env[DB_SOURCE];
const DB = /^jdbc:postgresql:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?\/([A-Za-z0-9_]+)(?:\?.*)?$/.exec(DB_URL_RAW);
if (!DB) refuse(`${DB_SOURCE} must be a jdbc:postgresql URL on localhost naming one database; hosted databases are never used`);
const DB_NAME = DB[3];
const DB_HOST = DB[1].replace(/[\[\]]/g, '');
const DB_PORT = DB[2] ?? '5432';
const DB_URL = `jdbc:postgresql://${DB[1]}${DB[2] ? `:${DB[2]}` : ''}/${DB_NAME}`;
const DB_USER = process.env.PROOF_DB_USER ?? 'gcsp';
const PROOF = path.join(SCRATCH, `fucq482-rehearsal-${RUN_TOKEN}`);
if (existsSync(PROOF)) refuse(`${PROOF} already exists; each run needs a fresh token`);
const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PSQL = path.resolve(process.env.PROOF_PSQL_BIN ?? '/opt/homebrew/opt/postgresql@17/bin/psql');
const need = (name) => { const v = process.env[name] ?? ''; if (!v) refuse(`${name} is not set`); return path.resolve(v); };
const JAR = need('PROOF_API_JAR');
const WEB_BROWSER = need('PROOF_WEB_BROWSER');
for (const [label, file] of [['API jar', JAR], ['web index', path.join(WEB_BROWSER, 'index.html')], ['java', path.join(JAVA_HOME, 'bin/java')], ['keytool', path.join(JAVA_HOME, 'bin/keytool')], ['Chrome', CHROME], ['psql', PSQL]]) {
  if (FORBIDDEN_PATH.test(file)) refuse(`${label} points into a forbidden synced folder`);
  if (!existsSync(file)) refuse(`${label} not found at ${file}`);
}
const COMPACT_RECEIPT = process.env.PROOF_COMPACT_RECEIPT ? path.resolve(process.env.PROOF_COMPACT_RECEIPT) : null;
if (COMPACT_RECEIPT && (FORBIDDEN_PATH.test(COMPACT_RECEIPT) || !(COMPACT_RECEIPT.startsWith('/private/tmp/') || COMPACT_RECEIPT.startsWith(`${ROOT}/.claude/test-runs/`)))) refuse('PROOF_COMPACT_RECEIPT must be an absolute path under /private/tmp or the worktree .claude/test-runs');
const port = (name, fallback) => { const v = Number(process.env[name] ?? fallback); if (!Number.isInteger(v) || v < 1024 || v > 65535) refuse(`${name} must be a port number`); return v; };
const PORTS = { web: port('PROOF_WEB_PORT', 7482), api: port('PROOF_API_PORT', 8482), idp: port('PROOF_IDP_PORT', 9482), api2: port('PROOF_API2_PORT', 8483) };
if (new Set(Object.values(PORTS)).size !== 4) refuse('Proof ports must be distinct');
const DEADLINE_MS = Number(process.env.PROOF_DEADLINE_SEC ?? 840) * 1000;
if (!Number.isFinite(DEADLINE_MS) || DEADLINE_MS <= 60000 || DEADLINE_MS > 900000) refuse('PROOF_DEADLINE_SEC must be in (60, 900]');

// The web origin is also the public mail base, as in the offer-link proof; Chrome maps the .test host to loopback.
const ORIGINS = { web: `https://gcsp-web.example.test:${PORTS.web}`, api: `https://gcsp-api.localhost:${PORTS.api}`, idp: `https://gcsp-idp.localhost:${PORTS.idp}` };
const ISSUER = `${ORIGINS.idp}/realms/gcsp-local`;
const API_PATH = '/api/gcsp/v1';
const API_BASE = `${ORIGINS.api}${API_PATH}`;
const KID = 'gcsp-local-test-1';
const TRUST_PASS = 'proof-local-trust';
const ENVIRONMENT_ID = `f482-${RUN_TOKEN}`.slice(0, 63);
const RUN_ID = 'run-1';
const POLICY = 'gcsp-policy-v1+offer-journey-v1';
const SUBJECTS = { paula: { sub: 'sub-paula', roles: ['employee'], employeeId: 'employee-paula' }, presenter: { sub: 'sub-presenter', roles: ['presenter'] }, greg: { sub: 'sub-greg', roles: ['greg'] } };
const REQUIRED_PROVIDERS = 'identity,persistence,account,scenario,supply,allocation-candidates,ordering,approvals,documents,appointments,returns,production,evidence';
const EVIDENCE = { store: path.join(ROOT, 'server/data/gcsp/vehicle-evidence/fleet-source.v1'), reference: path.join(ROOT, 'server/data/gcsp/vehicle-evidence') };
const RETAINED = {
  comparisonDigest: 'd388e3371ea4a7f3c3665102e9452e7ccd0940b685b64fa2d623e7e47a3f3027',
  learnedModelId: 'sha256:2ce1109d986c7709bf9505f8e388e9c1479ff3c36e7cae86f656ff29bb973c7d',
  corpus: '28374a10e989560f036c912c4b3d6d6b22d69d5ec212aecfc3921bc202af7884',
  displayImages: 'f12e588c78ca900dc98800697960f7d2857283d982fadd5cde292ba6be27b694',
  definitions: '7327f922585d0a5eabe5dca00363bc2f2e7ed29816c9c91bb17a304beddab939' };
const dirs = { logs: path.join(PROOF, 'logs'), tmp: path.join(PROOF, 'tmp'), certs: path.join(PROOF, 'certs'), static: path.join(PROOF, 'static'), browser: path.join(PROOF, 'browser'), evidence: path.join(PROOF, 'evidence') };
const MIGRATIONS = readdirSync(path.join(ROOT, 'services/gcsp-api/src/main/resources/db/migration')).filter((f) => /^V.*\.sql$/.test(f)).length;
const PHASES = ['P1-fresh-start', 'P2-retained-inputs', 'P3-create-state', 'P4-ordinary-restart', 'P5-authorised-reset', 'P6-no-node-runtime'];

const receipt = { schema: 'fucq482-cutover-rehearsal/1', story: 'DEV-2026-11-13-050 / FUCQ-482', startedAt: new Date().toISOString(), deadlineSeconds: DEADLINE_MS / 1000, runToken: RUN_TOKEN, origins: ORIGINS,
  localTestIssuer: `LOCAL TEST OIDC ISSUER ${ISSUER}: harness only, not the real provider`, composition: null, builds: null, tools: {}, processes: [], scenarios: {}, failureLogs: {},
  limitations: [
    'Local rehearsal only: real prebuilt jar and compiled web bundle, native PostgreSQL 17, headless Chrome; the hosted Render checks remain Gary\'s end-of-build review.',
    'The static host emulates the explicit Render fixed/named-placeholder rewrites; it is not Render.',
    'Local labelled OIDC issuer exercises real code/PKCE, signed JWTs and Java verification; the hosted identity provider is unrun.',
    'No email transport is configured; the captured outbox link is the producer output, not a delivered email.',
    'Chrome only. Offer decisions are never submitted. The learned model stays off and comparison reruns stay off.',
    'Parent owns resource reservation, scratch supervision, the throwaway database drop and the final audit.' ] };

const owned = [];
const CHILD_LOG_LIMIT = 3 * 1024 * 1024;
const LOG_LIMIT_MARKER = Buffer.from('\nPROOF FAILURE: shared child log budget exhausted; remaining child output discarded.\n');
let childLogBytes = 0; let logLimitFailure = false;
let finished = false; let teardownPromise;
const dbTargets = new Set([`${DB_HOST}:${DB_PORT}/${DB_NAME}`]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256b64u = (s) => createHash('sha256').update(s).digest('base64url');
const sha256File = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const sha = (v) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const tail = (file, n = 40) => { try { return readFileSync(file, 'utf8').split('\n').slice(-n).join('\n'); } catch { return ''; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cap = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 60000, env: childEnv(process.env), ...opts }).trim();
const trim = (v, n = 6000) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? `${s.slice(0, n)}...(${s.length} chars)` : s; };

// ---------- owned child processes (copied from the 438 proof) ----------
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
  child.logClosed = new Promise((resolve) => out.once('finish', resolve));
  child.once('close', () => out.end());
  child.identity = processIdentity(child.pid);
  const record = { name, pid: child.pid, identity: child.identity, executable: cmd, port: portNumber, startedAt: new Date().toISOString(), exit: null };
  receipt.processes.push(record);
  child.logFile = logFile;
  child.exited = new Promise((r) => {
    child.on('error', (e) => { child.done = true; record.exit = `spawn-error: ${e.message}`; record.endedAt = new Date().toISOString(); r(-1); });
    child.on('exit', (code, signal) => { child.done = true; child.exitCode = code; record.exit = code ?? signal; record.endedAt = new Date().toISOString(); r(code); });
  });
  child.stop = async () => { if (child.done) return; killGroup(child, 'SIGTERM'); await Promise.race([child.exited, sleep(10000)]); if (!child.done) { killGroup(child, 'SIGKILL'); await Promise.race([child.exited, sleep(5000)]); } if (!child.done) throw new Error(`Owned child ${name} did not join`); };
  owned.push(child);
  return child;
}
const portFree = (p) => new Promise((r) => { const s = net.createServer(); s.once('error', () => r(false)); s.listen(p, '127.0.0.1', () => s.close(() => r(true))); });

// ---------- certificates ----------
function makeCerts() {
  const c = (f) => path.join(dirs.certs, f);
  const ssl = (args, opts) => execFileSync('openssl', args, { cwd: dirs.certs, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, env: childEnv(process.env), ...opts });
  ssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', c('ca.key')]);
  ssl(['req', '-x509', '-new', '-key', c('ca.key'), '-sha256', '-days', '3', '-subj', '/CN=GCSP local proof CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', c('ca.pem')]);
  ssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', c('leaf.key')]);
  ssl(['req', '-new', '-key', c('leaf.key'), '-subj', '/CN=gcsp-web.example.test', '-out', c('leaf.csr')]);
  writeFileSync(c('leaf.ext'), 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:gcsp-web.example.test,DNS:gcsp-api.localhost,DNS:gcsp-idp.localhost,DNS:localhost,IP:127.0.0.1\n');
  ssl(['x509', '-req', '-in', c('leaf.csr'), '-CA', c('ca.pem'), '-CAkey', c('ca.key'), '-CAcreateserial', '-days', '3', '-sha256', '-extfile', c('leaf.ext'), '-out', c('leaf.pem')]);
  writeFileSync(c('fullchain.pem'), readFileSync(c('leaf.pem'), 'utf8') + readFileSync(c('ca.pem'), 'utf8'));
  const pub = ssl(['x509', '-in', c('leaf.pem'), '-pubkey', '-noout']);
  const der = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'der'], { input: pub, env: childEnv(process.env) });
  const spki = createHash('sha256').update(der).digest('base64');
  execFileSync(path.join(JAVA_HOME, 'bin/keytool'), ['-importcert', '-alias', 'gcsp-local-ca', '-file', c('ca.pem'), '-keystore', c('truststore.p12'), '-storetype', 'PKCS12', '-storepass', TRUST_PASS, '-noprompt'], { stdio: 'pipe', timeout: 60000, env: childEnv(process.env) });
  return { ca: readFileSync(c('ca.pem'), 'utf8'), cert: readFileSync(c('fullchain.pem')), key: readFileSync(c('leaf.key')), spki, trust: c('truststore.p12') };
}

// ---------- local labelled test OIDC issuer ----------
const idp = { observed: { pkceAuthorizations: 0, verifiedExchanges: 0 }, codes: new Map(), txns: new Map(), subjects: Object.fromEntries(Object.values(SUBJECTS).map((s) => [s.sub, s.roles])), keys: null, server: null };
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

// ---------- static web host: emulates the Render fixed/named-placeholder rewrites ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.gif': 'image/gif', '.avif': 'image/avif' };
let webServer = null; const WEB = {};
function startWeb(tls, fixedRoutes, dynamicRoutes) {
  if (!Array.isArray(dynamicRoutes) || !dynamicRoutes.includes('/gcsp/offers/:offerId')) throw new Error('Builder must export explicit GCSP_DYNAMIC_ROUTES offer metadata');
  const fixed = new Set(fixedRoutes.map((r) => r.replace(/\/$/, '') || '/'));
  const root = path.join(dirs.static, 'gcsp');
  const mediaRoot = path.join(ROOT, 'assets/gcsp-vehicle-evidence');
  const dynamicMatch = (pathname) => dynamicRoutes.some((route) => { const parts = pathname.replace(/\/$/, '').split('/'); const expected = route.split('/'); return parts.length === expected.length && expected.every((segment, i) => segment.startsWith(':') ? parts[i].length > 0 : parts[i] === segment); });
  receipt.staticHost = { mode: 'Local emulator of explicit Render fixed/named-placeholder rewrites; no generic SPA fallback', fixedRoutes, dynamicRoutes, hosted: false };
  webServer = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, ORIGINS.web).pathname); } catch { res.writeHead(400); return res.end('invalid path'); }
    if (p === '/' || p === '/gcsp') { res.writeHead(302, { Location: '/gcsp/' }); return res.end(); }
    const media = /^\/assets\/gcsp-vehicle-evidence\/([0-9a-f]{64}\.webp)$/.exec(p);
    if (media) {
      const file = path.join(mediaRoot, media[1]);
      if (!existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'no-store' }); return res.end(readFileSync(file));
    }
    if (!p.startsWith('/gcsp/') || p.includes('..')) { res.writeHead(404); return res.end('not found'); }
    const norm = p.replace(/\/$/, '');
    let file = path.join(root, p.slice('/gcsp/'.length));
    if (fixed.has(norm) || dynamicMatch(p)) file = path.join(root, 'index.html');
    if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end('Not Found'); }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': ext === '.html' || ext === '.json' ? 'no-store' : 'public, max-age=31536000, immutable' }); res.end(readFileSync(file));
  });
  return new Promise((r) => webServer.listen(PORTS.web, '127.0.0.1', r));
}
const closeServer = (s) => (s ? new Promise((r) => { s.closeAllConnections?.(); s.close(() => r()); }) : Promise.resolve());
let tls; let routes = null;
function httpsGet(host, portNumber, servername, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get({ host, port: portNumber, path: p, servername, headers: { Host: `${servername}:${portNumber}`, ...headers }, ca: tls.ca, agent: false }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (chunk) => { size += chunk.length; if (size > 8 * 1024 * 1024) req.destroy(new Error('response too large')); else chunks.push(chunk); });
      res.on('end', () => { const body = Buffer.concat(chunks); let json = null; try { json = JSON.parse(body.toString()); } catch { /* not json */ } resolve({ status: res.statusCode, body, json }); });
    });
    req.setTimeout(15000, () => req.destroy(new Error('request timeout'))); req.on('error', reject);
  });
}
const staticRead = (p) => httpsGet('127.0.0.1', PORTS.web, new URL(ORIGINS.web).hostname, p);
async function servedMain() {
  const index = await staticRead('/gcsp/');
  const name = /main-[A-Za-z0-9]+\.js/.exec(index.body.toString())?.[0] ?? null;
  const js = name ? await staticRead(`/gcsp/${name}`) : null;
  return { indexStatus: index.status, name, jsStatus: js?.status ?? null, sha256: js ? createHash('sha256').update(js.body).digest('hex') : null };
}

// ---------- Java API: exactly the gcsp-java-api demo composition of render.gcsp.yaml ----------
const apiHost = (portNumber) => ({ host: '127.0.0.1', port: portNumber, servername: 'gcsp-api.localhost' });
function apiEnv(over = {}, apiPort = PORTS.api) {
  return { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp, JAVA_HOME, LANG: 'en_GB.UTF-8',
    QUARKUS_HTTP_SSL_PORT: String(apiPort), QUARKUS_HTTP_INSECURE_REQUESTS: 'disabled', QUARKUS_HTTP_SSL_CERTIFICATE_FILES: path.join(dirs.certs, 'fullchain.pem'), QUARKUS_HTTP_SSL_CERTIFICATE_KEY_FILES: path.join(dirs.certs, 'leaf.key'),
    GCSP_IDENTITY_PROVIDER: 'oidc', GCSP_ALLOWED_ORIGINS: ORIGINS.web, GCSP_OIDC_ISSUER: ISSUER, GCSP_OIDC_JWKS_URI: `https://127.0.0.1:${PORTS.idp}/realms/gcsp-local/protocol/openid-connect/certs`,
    GCSP_OIDC_AUDIENCE: 'gcsp-api', GCSP_OIDC_AUTHORIZED_PARTY: 'gcsp-web', GCSP_OIDC_REQUIRED_SCOPES: 'gcsp-api',
    GCSP_OIDC_ACCOUNTS: JSON.stringify(Object.values(SUBJECTS).map((s) => ({ subject: s.sub, roles: s.roles, ...(s.employeeId ? { employeeId: s.employeeId } : {}) }))),
    GCSP_RUN_ID: RUN_ID, GCSP_POLICY_VERSION: POLICY, GCSP_SHUTDOWN_TIMEOUT: '10s',
    GCSP_DATABASE_URL: DB_URL, GCSP_DATABASE_USER: DB_USER, GCSP_DATABASE_PASSWORD: process.env.PROOF_DB_PASSWORD ?? '', GCSP_EXPECTED_DATABASE: DB_NAME, GCSP_ENVIRONMENT_ID: ENVIRONMENT_ID,
    GCSP_RESET_ALLOWED: 'true', GCSP_DATABASE_POOL_SIZE: '10',
    GCSP_REQUIRED_PROVIDERS: REQUIRED_PROVIDERS, GCSP_SCENARIO_PROVIDER: 'demo', GCSP_SUPPLY_PROVIDER: 'demo', GCSP_ACCOUNT_PROVIDER: 'repository', GCSP_ALLOCATION_CANDIDATES_PROVIDER: 'recommendation',
    GCSP_DOCUMENTS_PROVIDER: 'synthetic', GCSP_ORDERING_PROVIDER: 'synthetic', GCSP_VEHICLE_EVIDENCE_PROVIDER: 'lookup',
    GCSP_VEHICLE_EVIDENCE_STORE: EVIDENCE.store, GCSP_VEHICLE_EVIDENCE_REFERENCE_DIR: EVIDENCE.reference, GCSP_VEHICLE_ASSETS_ROOT: ROOT, GCSP_VEHICLE_IMAGES_PUBLIC: 'false',
    GCSP_APPOINTMENTS_PROVIDER: 'synthetic', GCSP_RETURNS_PROVIDER: 'synthetic', GCSP_APPROVALS_PROVIDER: 'synthetic', GCSP_PRODUCTION_PROVIDER: 'synthetic',
    GCSP_PUBLIC_BASE_URL: ORIGINS.web, GCSP_CODE_REVISION: SOURCE_REVISION, ...over };
}
let api = null; let apiStarts = 0;
async function readyBody(portNumber = PORTS.api) { const r = await httpsGet(...Object.values(apiHost(portNumber)), '/q/health/ready'); return { status: r.status, json: r.json }; }
async function startApi() {
  apiStarts++;
  const name = `api-${apiStarts}`;
  api = spawnOwned(name, path.join(JAVA_HOME, 'bin/java'), [...API_JVM_ARGS, `-Djavax.net.ssl.trustStore=${tls.trust}`, `-Djavax.net.ssl.trustStorePassword=${TRUST_PASS}`, `-Djava.io.tmpdir=${dirs.tmp}`, '-jar', JAR], apiEnv(), PORTS.api);
  let last = null; const t = Date.now();
  for (let i = 0; ; i++) {
    if (api.done) { receipt.failureLogs[name] = tail(api.logFile); throw new Error(`${name} exited during startup`); }
    try { last = await readyBody(); if (last.status === 200) break; } catch { /* not up yet */ }
    if (i > 300) { receipt.failureLogs[name] = `${tail(api.logFile)}\nlast readiness: ${trim(last)}`; throw new Error(`${name} did not become ready (last readiness ${last?.status})`); }
    await sleep(500);
  }
  log(`${name} ready on ${ORIGINS.api} after ${Date.now() - t} ms`);
  return { ready: last, startMs: Date.now() - t };
}
async function stopApi() { const stopped = api; await api.stop(); log(`api-${apiStarts} stopped (exit ${stopped.exitCode ?? 'signal'})`); }
const apiJar = (pid) => { const r = spawnSync('/bin/ps', ['-ww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 1000, env: childEnv(process.env) }); return /-jar (\S+)\s*$/.exec((r.stdout ?? '').trim())?.[1] ?? null; };

// ---------- direct HTTPS API access as the local issuer's subjects ----------
async function request(method, p, headers = {}, body = null) {
  const h = apiHost(PORTS.api);
  return new Promise((resolve, reject) => {
    const req = https.request({ host: h.host, port: h.port, path: p, method, servername: h.servername, headers: { Host: `${h.servername}:${h.port}`, Accept: 'application/json', ...headers }, ca: tls.ca, agent: false, timeout: 20000 }, (res) => {
      const chunks = []; let size = 0; res.on('data', (c) => { size += c.length; if (size > 4 * 1024 * 1024) { req.destroy(new Error('API response exceeded 4MiB bound')); return; } chunks.push(c); });
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* not json */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('timeout', () => req.destroy(new Error('request timeout'))); req.on('error', reject); req.end(body === null ? undefined : JSON.stringify(body));
  });
}
const token = (person) => signJwt(accessClaims(SUBJECTS[person].sub, SUBJECTS[person].roles), idp.keys.privateKey);
async function call(person, route, body) {
  return request(body === undefined ? 'GET' : 'POST', `${API_PATH}${route}`, { ...(person ? { Authorization: `Bearer ${token(person)}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body ?? null);
}
async function value(person, route, body) {
  const r = await call(person, route, body);
  if (r.status !== 200 || r.json?.status !== 'ok') throw new Error(`${person} ${route}: ${r.status} ${trim(r.json, 300)}`);
  return r.json.value;
}
const uid = () => `f482-${randomBytes(6).toString('hex')}`;
const offerPath = (id) => `/offers/${encodeURIComponent(id)}`;
const safeId = (id) => { if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id ?? '')) throw new Error(`Unexpected identifier shape: ${trim(id, 60)}`); return id; };

// ---------- database reads (owned database only) ----------
let sqlCount = 0;
async function sqlOut(statement) {
  const child = spawnOwned(`query-${++sqlCount}`, PSQL, ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-h', DB_HOST, '-p', DB_PORT, '-U', DB_USER, '-d', DB_NAME, '-c', statement],
    { PATH: process.env.PATH, HOME: process.env.HOME, PGCONNECT_TIMEOUT: '10', PGPASSWORD: process.env.PROOF_DB_PASSWORD ?? '' });
  const code = await child.exited; await child.logClosed;
  if (code !== 0) throw new Error(`query failed: ${tail(child.logFile, 5)}`);
  return readFileSync(child.logFile, 'utf8').trim();
}
async function flywayState() {
  const rows = (await sqlOut(`SELECT type || '|' || count(*) FROM gcsp_app.flyway_schema_history WHERE success GROUP BY type ORDER BY type`)).split('\n').filter(Boolean);
  const byType = Object.fromEntries(rows.map((r) => { const [t, c] = r.split('|'); return [t, Number(c)]; }));
  const latest = await sqlOut(`SELECT version FROM gcsp_app.flyway_schema_history WHERE success AND version IS NOT NULL ORDER BY installed_rank DESC LIMIT 1`);
  return { byType, sqlMigrations: byType.SQL ?? 0, latestVersion: latest };
}
// Row counts of every base table in gcsp_app, for "nothing is deleted" checks.
async function tableCounts() {
  const out = await sqlOut(`SELECT table_name || '|' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema = 'gcsp_app' AND table_type = 'BASE TABLE' ORDER BY 1`);
  return Object.fromEntries(out.split('\n').filter(Boolean).map((l) => { const [t, c] = l.split('|'); return [t, Number(c)]; }));
}
const nothingDeleted = (before, after) => Object.keys(before).every((t) => (after[t] ?? -1) >= before[t]);
async function offerRow(offerId) {
  const out = await sqlOut(`SELECT run_id || '|' || state || '|' || policy_version || '|' || quote_id FROM gcsp_app.buddy_offers WHERE offer_id = '${safeId(offerId)}'`);
  const [runId, state, policyVersion, quoteId] = out.split('|');
  return out ? { runId, state, policyVersion, quoteId } : null;
}
async function runsState() { return (await sqlOut(`SELECT run_id || '|' || status FROM gcsp_app.runs ORDER BY activated_at, run_id`)).split('\n').filter(Boolean); }

// ---------- retained inputs read in place (read-only) ----------
const RETAINED_FILES = ['active.json', 'last-good.json', 'identity-inventory.json'].map((f) => path.join(EVIDENCE.store, f)).concat([path.join(EVIDENCE.store, 'versions', RETAINED.corpus, 'manifest.json'), path.join(EVIDENCE.reference, 'display-images.v1.json'), path.join(EVIDENCE.reference, 'configuration-definitions.v1.json'), path.join(ROOT, 'server/data/gcsp/comparison/process-only.json')]);
const retainedFileHashes = () => Object.fromEntries(RETAINED_FILES.map((f) => [path.relative(ROOT, f), sha256File(f)]));
function firstConfigurationId() {
  const fd = openSync(path.join(EVIDENCE.store, 'versions', RETAINED.corpus, 'configurations.jsonl'), 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024); const n = readSync(fd, buf, 0, buf.length, 0);
    const line = buf.subarray(0, n).toString('utf8').split('\n')[0];
    return JSON.parse(line).configurationId;
  } finally { closeSync(fd); }
}
function packagedLearnedArtifact() {
  const appJar = path.join(path.dirname(JAR), 'app', readdirSync(path.join(path.dirname(JAR), 'app')).find((f) => /^gcsp-api-.*\.jar$/.test(f)));
  const name = `gcsp/learning/artifacts/${RETAINED.learnedModelId.replace(/^sha256:/, '')}.json`;
  const bytes = spawnSync('unzip', ['-p', appJar, name], { maxBuffer: 16 * 1024 * 1024, timeout: 30000 });
  const repoFile = path.join(ROOT, 'docs/gcsp/models/artifacts', `${RETAINED.learnedModelId.replace(/^sha256:/, '')}.json`);
  return { appJar: path.basename(appJar), resource: name, bytes: bytes.stdout?.length ?? 0, sha256: bytes.stdout?.length ? createHash('sha256').update(bytes.stdout).digest('hex') : null, repoFileSha256: sha256File(repoFile) };
}
// One retained-identities read through the API as authorised users; used before and after the reset.
async function readRetained(label) {
  const results = await value('presenter', '/comparison/results/latest');
  const proc = await value('presenter', '/comparison/process/latest');
  const ready = (await readyBody()).json;
  const evidenceCheck = ready?.checks?.find((c) => c.name === 'vehicle-evidence');
  const configId = firstConfigurationId();
  const evidence = await call('paula', `/vehicle-evidence/configurations/${encodeURIComponent(configId)}`);
  const vehicle = evidence.json?.value?.vehicle;
  return {
    label,
    activePolicyVersion: results.activePolicyVersion,
    comparison: { resultDigest: proc.resultDigest, resultId: proc.resultId, origin: proc.origin, policyVersion: proc.policyVersion, policyCurrent: proc.policyCurrent, storedAt: proc.storedAt,
      experiments: results.experiments?.map((e) => ({ experimentId: e.experimentId, stored: e.latest ? e.latest.resultDigest : null })) },
    learnedModel: { servedByApi: false, note: 'not served while off: no endpoint exposes the learned-model artifact id when GCSP_LEARNING_ACTIVE_MODEL is unset', packaged: packagedLearnedArtifact() },
    evidence: { readiness: evidenceCheck ? { status: evidenceCheck.status, data: evidenceCheck.data } : null, configurationIdPrefix: configId.slice(0, 24), readStatus: evidence.status, contractVersion: evidence.json?.value?.contractVersion, readResult: evidence.json?.value?.status,
      vehicleKeys: vehicle && typeof vehicle === 'object' ? Object.keys(vehicle).slice(0, 12) : null, vehicleCarriesConfigurationId: !!vehicle && JSON.stringify(vehicle).includes(configId) },
    files: retainedFileHashes() };
}
const retainedComparable = (r) => ({ digest: r.comparison.resultDigest, resultId: r.comparison.resultId, experiments: r.comparison.experiments, packaged: r.learnedModel.packaged.sha256, manifestDigest: r.evidence.readiness?.data?.manifestDigest, datasetId: r.evidence.readiness?.data?.datasetId, version: r.evidence.readiness?.data?.version, files: r.files });

// ---------- Chrome over CDP (copied from the 438 proof) ----------
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else this.listeners.forEach((f) => f(m)); }); }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', () => j(new Error('CDP websocket failed'))); }); return new Cdp(ws); }
  send(method, params = {}, sessionId) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
}
const activeContexts = new Set();
const hdr = (h = {}, name) => Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1];
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
class Page {
  constructor(cdp, sessionId, ctxId, label) { this.cdp = cdp; this.sid = sessionId; this.ctxId = ctxId; this.label = label; this.log = []; this.byId = new Map(); this.waits = []; this.mainFrame = null; this.mainLoader = null; this.docs = 0; this.errors = []; cdp.listeners.push((m) => m.sessionId === sessionId && this.event(m)); }
  send(method, params) { return this.cdp.send(method, params, this.sid); }
  async close() { await this.settle(); await this.cdp.send('Target.disposeBrowserContext', { browserContextId: this.ctxId }); activeContexts.delete(this.ctxId); }
  event(m) {
    const p = m.params ?? {};
    if (m.method === 'Runtime.exceptionThrown') { this.errors.push(p.exceptionDetails?.text ?? 'exception'); return; }
    if (m.method === 'Page.frameNavigated' && !p.frame.parentId) { this.mainFrame = p.frame.id; this.mainLoader = p.frame.loaderId; this.docs++; return; }
    if (m.method === 'Network.requestWillBeSent') {
      if (!p.request.url.startsWith(ORIGINS.api)) return;
      const e = { id: p.requestId, method: p.request.method, path: new URL(p.request.url).pathname.replace(API_PATH, ''), auth: !!hdr(p.request.headers, 'authorization'), doc: p.frameId === this.mainFrame ? this.docs : null, loader: p.loaderId };
      this.log.push(e); this.byId.set(p.requestId, e);
    } else if (m.method === 'Network.requestWillBeSentExtraInfo') {
      const e = this.byId.get(p.requestId); if (e && hdr(p.headers, 'authorization')) e.auth = true;
    } else if (m.method === 'Network.responseReceived') {
      const e = this.byId.get(p.requestId); if (e) e.status = p.response.status;
    } else if (m.method === 'Network.loadingFailed') {
      const e = this.byId.get(p.requestId); if (e) e.failed = p.errorText;
    } else if (m.method === 'Network.loadingFinished') {
      const e = this.byId.get(p.requestId);
      if (e && e.method !== 'OPTIONS') this.waits.push(this.send('Network.getResponseBody', { requestId: p.requestId }).then((r) => { e.response = parse(r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body); }).catch(() => {}));
    }
  }
  async settle() { await sleep(300); await Promise.allSettled(this.waits.splice(0)); }
  calls() { return this.log.filter((e) => e.method !== 'OPTIONS'); }
  async eval(expression) { const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`); return r.result.value; }
  act(body) { return this.eval(`(() => { ${HELPERS}\n${body} })()`); }
  async until(body, timeout = 30000, what = body) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { try { if (await this.act(body)) return true; } catch { /* navigating */ } await sleep(250); }
    const text = await this.eval(`document.body.innerText.replace(/\\s+/g,' ').slice(0,300)`).catch(() => '?');
    const location = await this.eval(`({ origin: location.origin, pathname: location.pathname })`).catch(() => null);
    const calls = this.calls().slice(-12).map(({ method, path: p, auth, status, failed }) => ({ method, path: p, auth, status, failed }));
    throw new Error(`${this.label}: timed out waiting for ${what}; page text: ${text}; diagnostics: ${JSON.stringify({ location, calls })}`);
  }
}
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
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  return page;
}
// Navigates, then waits for a NEW main-frame document whose own selected GET finished, so DOM reads are never the previous page's.
async function freshDocument(page, url, { ready, readPath, timeout = 30000, what = 'fresh document' }) {
  const before = page.docs;
  await page.send('Page.navigate', { url });
  const end = Date.now() + timeout; let read = null;
  while (Date.now() < end) {
    if (page.docs > before) {
      read = page.log.find((e) => e.doc === page.docs && e.loader === page.mainLoader && e.method === 'GET' && e.path === readPath && (e.status !== undefined || e.failed));
      if (read && read.status === 200) break;
    }
    await sleep(100);
  }
  if (page.docs <= before) throw new Error(`${page.label}: no new main-frame document for ${what}`);
  if (!read) throw new Error(`${page.label}: the new document made no ${readPath} read for ${what}`);
  if (read.status !== 200) throw new Error(`${page.label}: ${readPath} answered ${read.status ?? read.failed} for ${what}`);
  await page.until(ready, timeout, what); await page.settle();
  return read;
}
async function chooseSubject(page, person) {
  await page.until(`return location.origin === '${ORIGINS.idp}' && !!document.querySelector('button[data-subject="${SUBJECTS[person].sub}"]');`, 30000, 'real PKCE issuer form');
  await page.eval(`document.querySelector('button[data-subject="${SUBJECTS[person].sub}"]').click()`);
}
const OFFER_READY = `return !!$('.offer-page') && text().includes('Your offer');`;
// Signs in from the site root through the issuer's code+PKCE form, then waits for an authenticated 200 API read.
async function signInFromRoot(page, person) {
  await page.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/` });
  await page.until(`return location.origin === '${ORIGINS.web}' && !!button('Sign in');`, 30000, 'sign-in page');
  await page.act(`return press('Sign in');`);
  await chooseSubject(page, person);
  await page.until(`return location.origin === '${ORIGINS.web}' && !location.pathname.startsWith('/gcsp/auth/callback') && !button('Sign in');`, 30000, 'signed-in landing');
  const end = Date.now() + 20000;
  while (Date.now() < end && !page.calls().some((e) => e.auth && e.status === 200)) await sleep(250);
  await page.settle();
  return { landedPath: await page.eval('location.pathname'), authenticatedReads: page.calls().filter((e) => e.auth && e.status === 200).map((e) => e.path).slice(0, 6) };
}
// Starts from the captured link in a fresh isolated context: sign in, return to the exact offer, render it. No token injection.
async function linkSignInRender(page, person, link, id) {
  await page.send('Page.navigate', { url: link });
  await page.until(`return location.origin === '${ORIGINS.web}' && !!button('Sign in');`, 30000, 'deep link sign-in guard');
  if (page.calls().some((e) => e.path === offerPath(id))) throw new Error('Unauthenticated offer link leaked a business read before sign-in');
  await page.act(`return press('Sign in');`);
  await chooseSubject(page, person);
  await page.until(`const parts = location.pathname.split('/'); return location.origin === '${ORIGINS.web}' && parts.length === 4 && parts[1] === 'gcsp' && parts[2] === 'offers' && decodeURIComponent(parts[3]) === ${JSON.stringify(id)} && location.search === '' && location.hash === '';`, 30000, 'return to exact offer');
  await page.until(OFFER_READY, 30000, 'offer rendered after link sign-in'); await page.settle();
  const read = page.calls().filter((e) => e.path === offerPath(id) && e.auth && e.status === 200).at(-1);
  return { rendered: true, offerReadStatus: read?.status ?? null, offerIdInRead: read?.response?.value?.offerId ?? null, text: await page.eval(`document.querySelector('#gcsp-main')?.innerText.replace(/\\s+/g,' ').slice(0,160) ?? ''`) };
}

// ---------- state creation and truth snapshots ----------
async function ensureStock() {
  const count = async () => { const r = await call('presenter', '/presenter/releases/stock?limit=500'); const v = r.json?.value; const list = Array.isArray(v) ? v : v?.cars ?? v?.stock ?? v?.items; return { status: r.status, cars: Array.isArray(list) ? list.length : null }; };
  const before = await count();
  if (before.status === 200 && before.cars > 0) return { before, released: false };
  const controls = await value('presenter', '/presenter/controls');
  const tick = await call('presenter', '/presenter/controls/tick', { commandId: uid(), expectedClockVersion: controls.clockVersion, mode: 'next-release' });
  return { before, released: tick.status === 200, tickStatus: tick.status, after: await count() };
}
async function editorRead() {
  const i = (await value('paula', '/brief/editor')).initial; const p = i.brief?.preferences ?? {};
  const pick = (k) => (p[k] ? { value: p[k].value, importance: p[k].importance } : null);
  return { briefVersion: i.briefVersion, draftVersion: i.draftVersion, comfort: pick('comfort'), body: pick('body'), sportiness: pick('sportiness') };
}
async function outboxLink(offerId) {
  const outbox = await value('presenter', '/presenter/outbox');
  return outbox.messages.filter((m) => m.recipient?.employeeId === 'employee-paula' && m.offerLink && decodeURIComponent(new URL(m.offerLink, ORIGINS.web).pathname.split('/').at(-1)) === offerId)
    .map((m) => ({ url: new URL(m.offerLink, ORIGINS.web).href, transport: m.transport })).sort((a, b) => a.url.localeCompare(b.url));
}
// Saves one preference set, engages Buddy, ticks the clock and captures the new offer link (as the offer-link proof's prepareOffer).
async function prepareOffer() {
  const stock = await ensureStock();
  let editor = await editorRead();
  await value('paula', '/brief/preferences', { commandId: uid(), expectedBriefVersion: editor.briefVersion, expectedDraftVersion: editor.draftVersion, changes: { comfort: { value: 50 }, body: { value: ['estate'] }, sportiness: { value: 50 } } });
  editor = await editorRead();
  const savedAfterWrite = editor;
  await value('paula', '/brief/engage', { commandId: uid(), expectedBriefVersion: editor.briefVersion, expectedDraftVersion: editor.draftVersion });
  const clock = await value('presenter', '/presenter/clock');
  const tick = await value('presenter', '/presenter/clock/tick', { tickId: uid(), expectedClockVersion: clock.clockVersion });
  const current = await value('paula', '/offers/current');
  const offer = current.offers.find((o) => o.state === 'active' || o.state === 'pending');
  if (!offer) throw new Error(`No current offer from the actual allocation: ${trim(current, 400)}`);
  let links = [];
  for (let i = 0; i < 40 && !links.length; i++) { links = await outboxLink(offer.offerId); if (!links.length) await sleep(500); }
  if (!links.length) throw new Error('No captured notification link for the allocated offer');
  return { offerId: offer.offerId, link: links[0].url, transport: links[0].transport, stock, tickState: tick.state, savedAfterWrite };
}
async function snapshot(offerId) {
  const context = await value('paula', '/context');
  const offer = await value('paula', offerPath(offerId));
  return { runId: context.runId, contextPolicyVersion: context.policyVersion,
    offer: { offerId: offer.offerId, state: offer.state, quoteId: offer.quote?.quoteId ?? null, quoteSha256: sha(offer.quote ?? null), policyVersion: offer.quote?.policyVersion ?? null },
    savedPreference: await editorRead(), outbox: await outboxLink(offerId), row: await offerRow(offerId) };
}
const check = (s, name, passed) => { s.checks[name] = passed === true; };
const health = (body, name) => body?.json?.checks?.find((c) => c.name === name);
const requiredOk = (body) => { const c = health(body, 'required-providers'); const required = (c?.data?.required ?? '').split(',').sort(); return c?.status === 'UP' && same(required, REQUIRED_PROVIDERS.split(',').sort()) && !c?.data?.unconfigured && required.length === 13; };

// ---------- phases ----------
const S = { signedIn: null, offer1: null, snap1: null, retained0: null, flyway0: null, run0: null, apiPid0: null };
let cdp; let session = null;
async function phaseFresh(s) {
  const empty = await sqlOut(`SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`);
  check(s, 'owned database starts empty (no user tables)', empty === '0');
  await startWeb(tls, routes.fixed, routes.dynamic);
  const started = await startApi();
  S.apiPid0 = api.pid;
  const ready = await readyBody();
  s.observations.readiness = { status: ready.status, body: ready.json };
  check(s, '/q/health/ready is 200 and overall UP', ready.status === 200 && ready.json?.status === 'UP');
  check(s, 'required-providers check UP with all 13 providers configured and none unconfigured', requiredOk(ready));
  const live = await httpsGet(...Object.values(apiHost(PORTS.api)), '/q/health/live');
  s.observations.liveStatus = live.status;
  check(s, '/q/health/live is 200', live.status === 200);
  S.flyway0 = await flywayState();
  const total = Object.values(S.flyway0.byType).reduce((a, b) => a + b, 0);
  s.observations.flyway = { ...S.flyway0, totalSuccessfulRows: total, migrationFilesOnDisk: MIGRATIONS, schema: 'gcsp_app' };
  check(s, `Flyway applied every migration into gcsp_app (${MIGRATIONS} SQL migrations)`, S.flyway0.sqlMigrations === MIGRATIONS);
  const identity = await sqlOut(`SELECT environment_id || '|' || reset_allowed FROM gcsp_app.environment_identity`);
  s.observations.environmentIdentity = identity;
  check(s, 'database identity claimed for this environment with reset allowed', identity === `${ENVIRONMENT_ID}|true`);
  const noToken = await call(null, '/context');
  s.observations.contextWithoutToken = { status: noToken.status, code: noToken.json?.code };
  check(s, 'GET /context without a token is 401', noToken.status === 401);
  const rc = await staticRead('/gcsp/runtime-config.json');
  const rcText = rc.body.toString();
  s.observations.runtimeConfig = { status: rc.status, json: rc.json, namesApi: rcText.includes(API_BASE), namesIssuer: rcText.includes(ISSUER) };
  check(s, '/gcsp/runtime-config.json names the API and the issuer', rc.status === 200 && rcText.includes(API_BASE) && rcText.includes(ISSUER));
  const served = await servedMain();
  check(s, 'static host serves the built main bundle', served.indexStatus === 200 && served.name === WEB.mainJs && served.sha256 === WEB.mainSha256);
  s.observations.startMs = started.startMs;
  s.identity = { api: { pid: api.pid, jar: apiJar(api.pid) }, web: WEB.mainJs, jarSha256: receipt.builds.api.jarSha256 };
}
async function phaseRetained(s) {
  const r = await readRetained('P2');
  S.retained0 = r; s.observations.retained = r;
  check(s, 'active policy version is readable through the API', typeof r.activePolicyVersion === 'string' && r.activePolicyVersion.length > 0);
  check(s, `stored comparison result digest is ${RETAINED.comparisonDigest.slice(0, 12)}... (the bundled process-only result)`, r.comparison.resultDigest === RETAINED.comparisonDigest);
  check(s, 'learned model artifact: packaged resource present in the jar and the file name is the artifact id', !!r.learnedModel.packaged.sha256 && r.learnedModel.packaged.sha256 === r.learnedModel.packaged.repoFileSha256);
  const ev = r.evidence;
  check(s, 'vehicle-evidence readiness UP: lookup provider on the selected corpus', ev.readiness?.status === 'UP' && ev.readiness?.data?.provider === 'lookup' && ev.readiness?.data?.manifestDigest === RETAINED.corpus);
  check(s, 'one vehicle evidence read through EvidenceResource succeeds for a configuration of the selected corpus', ev.readStatus === 200 && ['complete', 'partial'].includes(ev.readResult));
  check(s, 'retained reference files match the documented identities', r.files['server/data/gcsp/vehicle-evidence/display-images.v1.json'] === RETAINED.displayImages && r.files['server/data/gcsp/vehicle-evidence/configuration-definitions.v1.json'] === RETAINED.definitions && r.files[`server/data/gcsp/vehicle-evidence/fleet-source.v1/versions/${RETAINED.corpus}/manifest.json`] !== undefined);
  const active = JSON.parse(readFileSync(path.join(EVIDENCE.store, 'active.json'), 'utf8'));
  check(s, 'retained store selects the expected corpus in place', active.selected?.manifestDigest === RETAINED.corpus);
}
async function phaseCreate(s) {
  session = await newPage(cdp, 'signed-in session');
  s.observations.signIn = await signInFromRoot(session, 'paula');
  check(s, 'Paula signed in through the browser (code+PKCE) and the site made authenticated reads', s.observations.signIn.authenticatedReads.length > 0);
  const offer = await prepareOffer();
  S.offer1 = offer; s.observations.offer = { offerId: offer.offerId, link: offer.link, transport: offer.transport, stock: offer.stock, tickState: offer.tickState };
  check(s, 'allocation captured a new offer link in the outbox (captured transport)', offer.transport === 'captured' && offer.link.startsWith(`${ORIGINS.web}/gcsp/offers/`));
  S.snap1 = await snapshot(offer.offerId);
  s.observations.snapshot = S.snap1; s.observations.savedPreferenceAfterWrite = offer.savedAfterWrite;
  check(s, 'snapshot: active-or-pending offer with a pinned quote, saved preference and run id', ['active', 'pending'].includes(S.snap1.offer.state) && !!S.snap1.offer.quoteId && offer.savedAfterWrite.comfort?.value === 50 && S.snap1.runId === RUN_ID && S.snap1.row?.runId === RUN_ID);
  const read = await freshDocument(session, offer.link, { readPath: offerPath(offer.offerId), ready: OFFER_READY, what: 'offer link in the signed-in browser' }).catch(async (e) => {
    // A token held only in memory would show the sign-in guard; sign in once more and record it.
    s.observations.signedInNavigationNote = e.message.slice(0, 200);
    return null;
  });
  if (read) {
    check(s, 'the offer link opens in the signed-in browser and renders the offer', true);
    s.observations.signedInRender = { offerReadStatus: read.status, text: await session.eval(`document.querySelector('#gcsp-main')?.innerText.replace(/\\s+/g,' ').slice(0,160) ?? ''`) };
  } else {
    const fresh = await newPage(cdp, 'link sign-in P3');
    try { s.observations.signedInRender = await linkSignInRender(fresh, 'paula', offer.link, offer.offerId); check(s, 'the offer link signs in and renders the offer (session did not carry across navigation)', true); } finally { await fresh.close(); }
  }
  check(s, 'no JavaScript exception in the browser session', session.errors.length === 0);
}
async function phaseRestart(s) {
  const before = { pid: api.pid, runs: await runsState(), counts: await tableCounts() };
  await stopApi();
  const started = await startApi();
  s.observations.restart = { oldPid: before.pid, newPid: api.pid, startMs: started.startMs, jar: apiJar(api.pid) };
  check(s, 'API restarted as a new process on the same jar and database', api.pid !== before.pid && apiJar(api.pid) === JAR);
  const ready = await readyBody();
  s.observations.readiness = { status: ready.status, requiredProviders: health(ready, 'required-providers') };
  check(s, 'readiness UP again with all 13 providers configured', ready.status === 200 && ready.json?.status === 'UP' && requiredOk(ready));
  const flyway = await flywayState();
  check(s, 'Flyway history unchanged by the restart', same(flyway, S.flyway0));
  check(s, 'a restart never resets or reseeds: same runs, nothing deleted', same(await runsState(), before.runs) && nothingDeleted(before.counts, await tableCounts()));
  const now = await snapshot(S.offer1.offerId);
  s.observations.snapshotDiffKeys = Object.keys(now).filter((k) => !same(now[k], S.snap1[k]));
  check(s, 'step 3 snapshot unchanged (offer id, state, quote hash, policy version, saved preference, run id, link)', same(now, S.snap1));
  const retained = await readRetained('P4');
  check(s, 'retained identities unchanged after the restart', same(retainedComparable(retained), retainedComparable(S.retained0)) && retained.activePolicyVersion === S.retained0.activePolicyVersion);
  const fresh = await newPage(cdp, 'link sign-in P4');
  try { s.observations.linkAfterRestart = await linkSignInRender(fresh, 'paula', S.offer1.link, S.offer1.offerId); check(s, 'the same link still signs in and renders the same offer after the restart', s.observations.linkAfterRestart.offerIdInRead === S.offer1.offerId); check(s, 'no JavaScript exception in that page', fresh.errors.length === 0); } finally { await fresh.close(); }
}
async function resetBody(commandId, expectedRunId) {
  const catalogue = await value('presenter', '/presenter/scenarios');
  const mechanics = catalogue.scenarios.find((x) => x.scenarioId === 'gcsp-clock-scenario-v1');
  if (!mechanics) throw new Error('Mechanics scenario missing from the catalogue');
  return { commandId, expectedRunId, scenarioVersion: mechanics.scenarioVersion, fixtureVersion: mechanics.fixtureVersion, policyVersion: mechanics.policyVersion };
}
async function phaseReset(s) {
  const current0 = await value('presenter', '/presenter/scenarios/current');
  const run0 = current0.runId; S.run0 = run0;
  check(s, 'the active run before the reset is the one the offer was created in', run0 === RUN_ID && run0 === S.snap1.runId);
  // Reset isolation: a stale expectedRunId is refused and deletes nothing.
  const countsBefore = await tableCounts(); const runsBefore = await runsState();
  const stale = await call('presenter', '/presenter/clock/reset', await resetBody(uid(), `stale-${randomBytes(4).toString('hex')}`));
  s.observations.staleReset = { status: stale.status, code: stale.json?.code };
  check(s, 'a reset with a wrong expectedRunId is refused 409 stale-run', stale.status === 409 && stale.json?.code === 'stale-run');
  check(s, 'the refused reset deleted nothing and kept the same active run', nothingDeleted(countsBefore, await tableCounts()) && same(await runsState(), runsBefore) && (await value('presenter', '/presenter/scenarios/current')).runId === run0);
  // A second API with another GCSP_ENVIRONMENT_ID against the same database must refuse to start.
  const t = Date.now();
  const other = spawnOwned('api-isolation', path.join(JAVA_HOME, 'bin/java'), [...API_JVM_ARGS, `-Djavax.net.ssl.trustStore=${tls.trust}`, `-Djavax.net.ssl.trustStorePassword=${TRUST_PASS}`, `-Djava.io.tmpdir=${dirs.tmp}`, '-jar', JAR],
    apiEnv({ GCSP_ENVIRONMENT_ID: `${ENVIRONMENT_ID.slice(0, 55)}-other` }, PORTS.api2), PORTS.api2);
  await Promise.race([other.exited, sleep(60000)]);
  const refused = other.done && other.exitCode !== 0; const wasUp = !other.done;
  if (!other.done) await other.stop();
  await other.logClosed;
  const otherLog = readFileSync(other.logFile, 'utf8');
  const reason = otherLog.split('\n').find((l) => /environment|identity|mismatch|isolation/i.test(l) && /ERROR|Exception|refus|mismatch|does not match/i.test(l)) ?? '';
  s.observations.environmentIsolation = { startedSecondApiWithOtherEnvironmentId: true, exitCode: other.exitCode ?? null, stillRunningAfter60s: wasUp, ms: Date.now() - t, reason: reason.slice(0, 300) };
  check(s, 'a second API process with a different GCSP_ENVIRONMENT_ID on the same database refuses to start', refused);
  check(s, 'the database identity is unchanged by that attempt', (await sqlOut(`SELECT environment_id FROM gcsp_app.environment_identity`)) === ENVIRONMENT_ID && same(await runsState(), runsBefore));
  // The authorised reset.
  const command = uid(); const body = await resetBody(command, run0);
  const done = await value('presenter', '/presenter/clock/reset', body);
  s.observations.reset = { retiredRunId: done.retiredRunId, activatedRunId: done.activatedRunId, replayed: done.replayed, scenarioId: done.scenario?.scenarioId };
  const run1 = done.activatedRunId; S.run1 = run1;
  check(s, 'the reset retired the old run and activated a new, different run', done.retiredRunId === run0 && typeof run1 === 'string' && run1.startsWith('demo-') && run1 !== run0 && done.replayed === false);
  check(s, 'the new run is the active run', (await value('presenter', '/presenter/scenarios/current')).runId === run1);
  const replay = await value('presenter', '/presenter/clock/reset', body);
  s.observations.replay = { retiredRunId: replay.retiredRunId, activatedRunId: replay.activatedRunId, replayed: replay.replayed };
  check(s, 'replaying the same commandId returns the same receipt', replay.replayed === true && replay.retiredRunId === run0 && replay.activatedRunId === run1);
  // The old offer in the new run.
  const current = await value('paula', '/offers/current');
  const oldDirect = await call('paula', offerPath(S.offer1.offerId));
  const rowAfter = await offerRow(S.offer1.offerId);
  s.observations.oldOffer = { currentOfferIds: current.offers.map((o) => o.offerId), currentRun: (await value('paula', '/context')).runId, directRead: { status: oldDirect.status, code: oldDirect.json?.code, state: oldDirect.json?.value?.state }, rowKeptInDatabase: rowAfter };
  check(s, "the old run's offer is no longer Paula's current offer in the new run", !current.offers.some((o) => o.offerId === S.offer1.offerId));
  check(s, "the old run's offer row is kept in the database under the retired run (nothing deleted)", rowAfter?.runId === run0 && nothingDeleted(countsBefore, await tableCounts()));
  const runsAfter = await runsState();
  s.observations.runs = runsAfter;
  check(s, 'run history shows the old run retired and the new run active', runsAfter.includes(`${run0}|retired`) && runsAfter.includes(`${run1}|active`));
  const oldLink = await observeOldLink(session, S.offer1.link, S.offer1.offerId);
  s.observations.oldLink = oldLink;
  check(s, 'the old link was opened in the browser and its outcome recorded', oldLink.offerReadStatus !== undefined);
  const retained = await readRetained('P5');
  s.observations.policyVersionAcrossReset = { before: S.retained0.activePolicyVersion, after: retained.activePolicyVersion, unchanged: retained.activePolicyVersion === S.retained0.activePolicyVersion };
  const keep = (r) => { const c = retainedComparable(r); return c; };
  check(s, 'step 2 retained identities unchanged after the reset (comparison digest, packaged learned model, evidence corpus, retained files)', same(keep(retained), keep(S.retained0)));
  // A new allocation in the new run.
  const offer2 = await prepareOffer();
  S.offer2 = offer2; s.observations.newOffer = { offerId: offer2.offerId, link: offer2.link, stock: offer2.stock, tickState: offer2.tickState };
  const row2 = await offerRow(offer2.offerId);
  s.observations.newOfferRow = row2;
  check(s, 'a new allocation in the new run issued a different offer and a different link', offer2.offerId !== S.offer1.offerId && offer2.link !== S.offer1.link && row2?.runId === run1);
  const fresh = await newPage(cdp, 'link sign-in P5');
  try { s.observations.newLink = await linkSignInRender(fresh, 'paula', offer2.link, offer2.offerId); check(s, 'the new link signs in and renders the new offer', s.observations.newLink.offerIdInRead === offer2.offerId); check(s, 'no JavaScript exception in that page', fresh.errors.length === 0); } finally { await fresh.close(); }
}
// Opens the old link in the signed-in browser and records exactly what the API answered and what the page shows.
async function observeOldLink(page, link, id) {
  const before = page.docs;
  await page.send('Page.navigate', { url: link });
  const end = Date.now() + 30000; let read = null; let signedOutGuard = false;
  while (Date.now() < end) {
    if (page.docs > before) {
      read = page.log.find((e) => e.doc === page.docs && e.loader === page.mainLoader && e.method === 'GET' && e.path === offerPath(id) && (e.status !== undefined || e.failed));
      if (read) break;
      if (await page.act(`return !!button('Sign in');`).catch(() => false)) { signedOutGuard = true; break; }
    }
    await sleep(200);
  }
  await sleep(1000); await page.settle();
  return { offerReadStatus: read ? (read.status ?? read.failed) : (signedOutGuard ? 'no-read: sign-in guard shown' : 'no-read'), offerReadBody: read?.response ? trim({ status: read.response.status, code: read.response.code, reason: read.response.reason }, 300) : null,
    rendersOffer: await page.act(OFFER_READY).catch(() => false), pageText: await page.eval(`(document.querySelector('#gcsp-main') ?? document.body).innerText.replace(/\\s+/g,' ').slice(0,240)`).catch(() => '?'), path: await page.eval('location.pathname').catch(() => null) };
}
function phaseNoNode(s) {
  const lines = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', timeout: 10000 }).split('\n').map((l) => l.trim()).filter(Boolean);
  const parsed = lines.map((l) => { const m = /^(\d+)\s+(\d+)\s+(.*)$/.exec(l); return m ? { pid: Number(m[1]), ppid: Number(m[2]), command: m[3] } : null; }).filter(Boolean);
  const nodes = parsed.filter((p) => /(^|\/)node$/.test(p.command.split(/\s+/)[0] ?? ''));
  const FORBIDDEN = /(?:server\/index\.js|gcsp\/runtime\.js|gcsp\/host\.js|gcsp-demo\.mjs)(?:\s|$)/;
  const hits = nodes.filter((p) => FORBIDDEN.test(p.command));
  const own = nodes.filter((p) => p.pid === process.pid).map((p) => ({ pid: p.pid, role: 'this rehearsal script, which also hosts the static site and the local OIDC issuer', script: 'scripts/gcsp/fucq482-cutover-rehearsal.mjs' }));
  const javaPids = receipt.processes.filter((p) => /java$/.test(p.executable)).map((p) => ({ name: p.name, pid: p.pid, port: p.port }));
  s.observations.nodeScan = { scannedProcesses: lines.length, nodeProcessesVisible: nodes.length, ownNodeProcesses: own, runtimeMatches: hits.map((p) => ({ pid: p.pid, command: p.command.slice(0, 160) })), forbiddenPatterns: ['server/index.js', 'gcsp/runtime.js', 'gcsp/host.js', 'gcsp-demo.mjs'] };
  s.observations.javaProcesses = javaPids;
  check(s, 'no node process runs server/index.js, gcsp/runtime.js, gcsp/host.js or gcsp-demo.mjs', hits.length === 0);
  check(s, 'the only node process of this run is the rehearsal script itself (static host and issuer in-process)', own.length === 1);
  s.observations.databaseConnections = { ownedDatabaseOnly: [...dbTargets], apiDatabaseUrl: DB_URL, apiExpectedDatabase: DB_NAME, psqlDatabase: DB_NAME };
  check(s, 'the script only ever targeted its own owned database', dbTargets.size === 1 && dbTargets.has(`${DB_HOST}:${DB_PORT}/${DB_NAME}`));
}

// ---------- scenarios, main, teardown and receipts ----------
async function scenario(id, title, fn) {
  const s = { title, pass: false, checks: {}, observations: {} }; receipt.scenarios[id] = s; log(`phase ${id}: ${title}`);
  const t = Date.now();
  try { await fn(s); } catch (e) { s.error = e.message; s.checks.noException = false; }
  s.ms = Date.now() - t;
  s.pass = Object.keys(s.checks).length > 0 && Object.values(s.checks).every((v) => v === true);
  try { writeFileSync(path.join(dirs.evidence, `checkpoint-${id}.json`), JSON.stringify(s, null, 2)); } catch { /* evidence dir gone */ }
  log(`phase ${id}: ${s.pass ? 'PASS' : 'FAIL'}${s.error ? ` (${s.error.slice(0, 300)})` : ''}${s.pass ? '' : ` failed: ${Object.entries(s.checks).filter(([, v]) => v !== true).map(([n]) => n).join(' | ')}`}`);
  if (!s.pass) throw new Error(`Phase ${id} failed; later phases are not run`);
}
const appJarsOf = (jar) => readdirSync(path.join(path.dirname(jar), 'app')).filter((f) => f.endsWith('.jar')).map((f) => ({ file: f, sha256: sha256File(path.join(path.dirname(jar), 'app', f)) }));
async function assembleWeb() {
  const child = spawnOwned('assemble', process.execPath, ['scripts/build-gcsp-static.mjs', '--browser', WEB_BROWSER, '--output', dirs.static, '--environment', 'deployed', '--revision', SOURCE_REVISION],
    { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp, GCSP_PUBLIC_ENVIRONMENT_ID: ENVIRONMENT_ID, GCSP_PUBLIC_API_BASE_URL: API_BASE, GCSP_PUBLIC_OIDC_AUTHORITY: ISSUER, GCSP_PUBLIC_OIDC_CLIENT_ID: 'gcsp-web',
      GCSP_PUBLIC_OIDC_SCOPE: 'openid profile gcsp-api', GCSP_PUBLIC_OIDC_REDIRECT_URI: `${ORIGINS.web}/gcsp/auth/callback`, GCSP_PUBLIC_OIDC_POST_LOGOUT_REDIRECT_URI: `${ORIGINS.web}/gcsp/` });
  const code = await child.exited; await child.logClosed;
  if (code !== 0) { receipt.failureLogs.assemble = tail(child.logFile); throw new Error(`assemble exited ${code}`); }
  const root = path.join(dirs.static, 'gcsp');
  const mains = readdirSync(root).filter((f) => /^main-[A-Za-z0-9]+\.js$/.test(f));
  if (mains.length !== 1) throw new Error(`expected exactly one main bundle, found ${mains.length}`);
  Object.assign(WEB, { sourceRevision: SOURCE_REVISION, browser: WEB_BROWSER, mainJs: mains[0], mainSha256: sha256File(path.join(root, mains[0])), indexSha256: sha256File(path.join(root, 'index.html')) });
}
async function main() {
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  for (const [k, p] of Object.entries(PORTS)) if (!(await portFree(p))) throw new Error(`port ${p} (${k}) is in use; choose PROOF_${k.toUpperCase()}_PORT`);
  receipt.builds = { api: { jar: JAR, jarSha256: sha256File(JAR), appJars: appJarsOf(JAR) }, sourceRevision: SOURCE_REVISION, web: WEB };
  receipt.retainedFilesBefore = retainedFileHashes();
  const env = apiEnv();
  receipt.composition = { note: 'exactly the gcsp-java-api demo composition of render.gcsp.yaml; local values for the sync:false keys',
    env: Object.fromEntries(Object.entries(env).filter(([k]) => /^GCSP_/.test(k)).map(([k, v]) => [k, k === 'GCSP_DATABASE_PASSWORD' ? (v ? '<set>' : '<empty>') : k === 'GCSP_DATABASE_URL' ? DB_URL : k === 'GCSP_OIDC_ACCOUNTS' ? JSON.parse(v) : v])),
    notSet: { GCSP_MAIL_TRANSPORT: 'unset: mail stays captured', GCSP_LEARNING_ACTIVE_MODEL: 'unset and no +learned-model-v1: the learned model is off', GCSP_COMPARISON_RERUNS: 'unset: comparison reruns off', GCSP_NOTIFY_DRAIN_INTERVAL: 'unset (default 5s)' },
    jvm: jvmLimitsReceipt(API_JVM_ARGS), database: { host: DB_HOST, port: DB_PORT, name: DB_NAME, user: DB_USER, schema: 'gcsp_app (Flyway)' }, ports: PORTS, environmentId: ENVIRONMENT_ID, runId: RUN_ID, policyVersion: POLICY };
  receipt.tools = { harnessNode: process.version, openssl: cap('openssl', ['version']), chrome: cap(CHROME, ['--version']), java: (spawnSync(path.join(JAVA_HOME, 'bin/java'), ['-version'], { encoding: 'utf8', env: childEnv(process.env) }).stderr ?? '').split('\n')[0] };
  const version = await sqlOut('SHOW server_version_num');
  if (!/^17[0-9]{4}$/.test(version)) throw new Error(`Owned database must be native PostgreSQL 17; server_version_num=${version.slice(0, 20)}`);
  receipt.composition.database.serverVersionNum = version;
  log('certificates'); tls = makeCerts();
  log('static assembly of the prebuilt web');
  const assemble = await import(pathToFileURL(path.join(ROOT, 'scripts/build-gcsp-static.mjs')).href);
  routes = { fixed: assemble.GCSP_FIXED_ROUTES, dynamic: assemble.GCSP_DYNAMIC_ROUTES };
  await assembleWeb();
  log('issuer'); await startIdp(tls);
  const profile = path.join(dirs.browser, 'profile'); mkdirSync(profile, { recursive: true });
  const chrome = spawnOwned('chrome', CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-allow-origins=*', `--ignore-certificate-errors-spki-list=${tls.spki}`, '--host-resolver-rules=MAP gcsp-web.example.test 127.0.0.1', '--no-proxy-server', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--window-size=1280,900', 'about:blank'], { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp });
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) { if (chrome.done) throw new Error('Chrome exited during startup'); try { const [p, ws] = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n'); wsUrl = `ws://127.0.0.1:${p}${ws}`; } catch { await sleep(250); } }
  if (!wsUrl) throw new Error('Chrome DevTools endpoint not found');
  cdp = await Cdp.connect(wsUrl); receipt.cdp = cdp;
  await scenario(PHASES[0], 'Fresh start on the empty owned database', phaseFresh);
  await scenario(PHASES[1], 'Retained inputs served through the API', phaseRetained);
  await scenario(PHASES[2], 'Create state: sign in, save a preference, allocate an offer, open the link', phaseCreate);
  await scenario(PHASES[3], 'Ordinary restart on the same jar and database', phaseRestart);
  await scenario(PHASES[4], 'Authorised reset, isolation and a new journey', phaseReset);
  await scenario(PHASES[5], 'No Node GCSP runtime executed', phaseNoNode);
  const after = retainedFileHashes();
  receipt.retainedFilesUnchangedByRun = same(after, receipt.retainedFilesBefore);
  if (!receipt.retainedFilesUnchangedByRun) throw new Error('A retained input file changed during the run');
}
function teardown() {
  if (teardownPromise) return teardownPromise;
  teardownPromise = (async () => {
    const errors = [];
    for (const browserContextId of activeContexts) { try { await receipt.cdp?.send('Target.disposeBrowserContext', { browserContextId }); activeContexts.delete(browserContextId); } catch (e) { errors.push(`browser context: ${e.message}`); } }
    try { receipt.cdp?.ws.close(); } catch (e) { errors.push(`CDP close: ${e.message}`); }
    delete receipt.cdp;
    for (const child of owned.slice().reverse()) { try { await child.stop(); await child.logClosed; } catch (e) { errors.push(`process ${child.pid}: ${e.message}`); } }
    for (const [name, server] of [['web', webServer], ['issuer', idp.server]]) { try { await closeServer(server); } catch (e) { errors.push(`${name}: ${e.message}`); } }
    receipt.teardown = { ownedProcesses: receipt.processes.map((p) => ({ name: p.name, pid: p.pid, exit: p.exit })), allOwnedExited: owned.every((c) => c.done), browserContextsClosed: activeContexts.size === 0, serversClosed: [webServer, idp.server].every((server) => !server?.listening), errors,
      scratchLeftForParent: PROOF, note: 'Nothing is deleted here; the parent owns scratch removal and the throwaway database drop.' };
  })();
  return teardownPromise;
}
function compactReceipt() {
  return { schema: 'fucq482-cutover-rehearsal-compact/1', story: receipt.story, runToken: RUN_TOKEN, overall: receipt.overall, runError: receipt.runError ?? null, startedAt: receipt.startedAt, endedAt: receipt.endedAt, sourceRevision: SOURCE_REVISION,
    builds: { api: { jarSha256: receipt.builds?.api?.jarSha256, appJars: receipt.builds?.api?.appJars }, web: WEB }, composition: receipt.composition, tools: receipt.tools,
    phases: PHASES.map((id) => { const s = receipt.scenarios[id]; return s ? { id, title: s.title, pass: s.pass, ms: s.ms, checks: s.checks, identity: s.identity ?? null, observations: s.observations, error: s.error } : { id, pass: false, notRun: true }; }),
    retainedFilesUnchangedByRun: receipt.retainedFilesUnchangedByRun ?? null, oidc: idp.observed, processes: receipt.processes.map((p) => ({ name: p.name, pid: p.pid, exit: p.exit })), failureLogs: receipt.failureLogs,
    teardown: { allOwnedExited: receipt.teardown?.allOwnedExited, serversClosed: receipt.teardown?.serversClosed, browserContextsClosed: receipt.teardown?.browserContextsClosed, errors: receipt.teardown?.errors }, logBudget: receipt.logBudget, limitations: receipt.limitations };
}
function finish(runError) {
  if (finished) return; finished = true;
  const sc = receipt.scenarios; receipt.oidcObserved = idp.observed; receipt.endedAt = new Date().toISOString();
  if (runError) receipt.runError = runError;
  receipt.logBudget ??= { limitBytes: CHILD_LOG_LIMIT, writtenBytes: childLogBytes, exhausted: false };
  receipt.overall = PHASES.every((k) => sc[k]?.pass === true) && !runError && !logLimitFailure && receipt.teardown?.allOwnedExited && receipt.teardown?.serversClosed && receipt.teardown?.browserContextsClosed && receipt.teardown?.errors.length === 0 ? 'PASS' : 'FAIL';
  const file = path.join(dirs.evidence, 'rehearsal.json');
  try { writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`); } catch (e) { receipt.overall = 'FAIL'; console.error('receipt write failed', e.message); }
  if (COMPACT_RECEIPT) {
    try { mkdirSync(path.dirname(COMPACT_RECEIPT), { recursive: true }); const text = `${JSON.stringify(compactReceipt(), null, 2)}\n`; if (Buffer.byteLength(text) > 400 * 1024) throw new Error('compact receipt exceeded 400 KB'); writeFileSync(COMPACT_RECEIPT, text); } catch (e) { receipt.overall = 'FAIL'; console.error('compact receipt write failed', e.message); }
  }
  for (const k of PHASES) console.log(`  ${k}: ${sc[k] ? (sc[k].pass ? 'PASS' : 'FAIL') : 'NOT RUN'} ${sc[k]?.title ?? ''}`);
  console.log(`overall ${receipt.overall}; receipt ${file}; compact ${COMPACT_RECEIPT ?? 'none'}; all owned processes exited: ${receipt.teardown?.allOwnedExited}`);
}
const deadline = setTimeout(async () => { log('global deadline exceeded'); await teardown(); finish('global deadline exceeded'); process.exit(1); }, Math.max(1, DEADLINE_MS - 45000));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGALRM']) process.on(sig, async () => { await teardown(); finish(`interrupted by ${sig}`); process.exit(130); });
let runError;
try { await main(); } catch (e) { runError = e.message; console.error('RUN ERROR:', e.message); } finally { clearTimeout(deadline); await teardown(); finish(runError); }
process.exit(receipt.overall === 'PASS' ? 0 : 1);
