#!/usr/bin/env node
// FUCQ-443 connected proof: built Angular manual claim/review/order -> started Java API (OIDC, native PG17, synthetic ordering), headless Chrome.
// Derived from fucq441/fucq442 connected proofs. Never builds; the parent supplies SCRATCH, the database, the jar and the compiled web.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:https';
import https from 'node:https';
import net from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { apiJvmArgs, jvmLimitsReceipt } from './proof-jvm.mjs';

const API_JVM_ARGS = apiJvmArgs({ heap: '768m' });

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
// The parent verifies and pins the source revision; this script never runs git.
const SOURCE_REVISION = process.env.PROOF_SOURCE_REVISION ?? '';
if (!/^[0-9a-f]{40}$/.test(SOURCE_REVISION)) refuse('PROOF_SOURCE_REVISION must be the parent-verified 40-hex source commit');
const DB_SOURCE = process.env.GCSP_TEST_DATABASE_URL ? 'GCSP_TEST_DATABASE_URL' : process.env.GCSP_TEST_RUNNING_DATABASE_URL ? 'GCSP_TEST_RUNNING_DATABASE_URL' : null;
if (!DB_SOURCE) refuse('GCSP_TEST_DATABASE_URL (or GCSP_TEST_RUNNING_DATABASE_URL) is not set; supply an owned throwaway PostgreSQL 17 database');
const DB_URL = process.env[DB_SOURCE];
const DB = /^jdbc:postgresql:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?\/([A-Za-z0-9_]+)(?:\?.*)?$/.exec(DB_URL);
if (!DB) refuse(`${DB_SOURCE} must be a jdbc:postgresql URL on localhost naming one database; hosted databases are never used`);
const DB_NAME = DB[3];
const PROOF = path.join(SCRATCH, `fucq443-connected-${RUN_TOKEN}`);
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
const PROOF_SCOPE = process.env.PROOF_SCOPE ?? 'all';
if (!['all', 'recovery', 'recovery-refusal'].includes(PROOF_SCOPE)) refuse('PROOF_SCOPE must be all, recovery or recovery-refusal');
const SELECTED_SCENARIOS = PROOF_SCOPE === 'recovery-refusal' ? ['f', 'g'] : PROOF_SCOPE === 'recovery' ? ['f'] : ['a', 'b', 'c', 'f', 'd', 'e'];

const ORIGINS = { web: `https://gcsp-web.localhost:${PORTS.web}`, api: `https://gcsp-api.localhost:${PORTS.api}`, idp: `https://gcsp-idp.localhost:${PORTS.idp}` };
const ISSUER = `${ORIGINS.idp}/realms/gcsp-local`;
const API_PATH = '/api/gcsp/v1';
const API_BASE = `${ORIGINS.api}${API_PATH}`;
const KID = 'gcsp-local-test-1';
const TRUST_PASS = 'proof-local-trust';
const ORDERING_TOKEN = randomBytes(24).toString('hex');
let orderingMode = 'synthetic';
const orderingRequests = [];
const orderingReplies = new Map();
// The four existing demo-preparation employees share EnvironmentGuard.FIRST_RUN_ID.
const SUBJECT = 'sub-paula';
const EMPLOYEE = 'employee-paula';
const ENVIRONMENT_ID = `f443-connected-${RUN_TOKEN}`;
const RUN_ID = 'run-1';
const POLICY = 'gcsp-policy-v1';
const PEOPLE = ['paula', 'alex', 'jordan'];
const EMAIL = { paula: 'paula.mason', alex: 'alex.brennan', jordan: 'jordan.hughes' };
// Stable exact-stock identities, isolated by this proof's environment/run and schema.
const STOCK_IDS = [1, 2, 3, 4].map((n) => `00000000-0443-4000-8000-${String(n).padStart(12, '0')}`);
const CAR = Object.fromEntries(PEOPLE.map((person, i) => [person, STOCK_IDS[i]]));
function carNumber(id) {
  const i = STOCK_IDS.indexOf(id);
  if (i < 0) throw new Error(`Unknown proof car ${id}`);
  return String(4430001 + i);
}
const PSQL = path.resolve(process.env.PROOF_PSQL_BIN ?? '/opt/homebrew/opt/postgresql@17/bin/psql');
const MEDIA_ROOT = path.resolve(process.env.PROOF_MEDIA_ROOT ?? path.join(ROOT, 'assets/gcsp-vehicle-evidence'));
const MEDIA_FILES = ['07c269dd7f55fad0a56bbad65ae72f7c35defc5e8883a8290a82972e1defb427.webp', 'ed60cefd049e7293423575b5f0fcee802dbab14083dea2480211ab272896281a.webp',
  'bd89864616f3f34813cb66230e93f5e39d6a25168331ea47e84da60fbf31a735.webp', 'c1a3b0f2df9a6c3834cd04fc8f65455e6daa8fda9e7bf0f7a9c9e5e437ec8318.webp'];
for (const file of [PSQL, MEDIA_ROOT, JAR, WEB_BROWSER, JAVA_HOME, CHROME]) if (/CloudStorage|OneDrive/i.test(file)) refuse('An input path points into a forbidden synced folder');
if (!existsSync(PSQL)) refuse('PROOF_PSQL_BIN must name the parent-pinned native PostgreSQL 17 psql');
for (const name of MEDIA_FILES) if (!existsSync(path.join(MEDIA_ROOT, name))) refuse(`Missing parent-pinned actual media ${name}`);
if (!Number.isFinite(DEADLINE_MS) || DEADLINE_MS <= 0 || DEADLINE_MS > 600000) refuse('PROOF_DEADLINE_SEC must be in (0, 600]');
const SCHEMA = `gcsp_s_f443c_${RUN_TOKEN.replace(/-/g, '_')}`;
const dirs = { logs: path.join(PROOF, 'logs'), tmp: path.join(PROOF, 'tmp'), certs: path.join(PROOF, 'certs'), static: path.join(PROOF, 'static'), browser: path.join(PROOF, 'browser'), evidence: path.join(PROOF, 'evidence') };

const receipt = { schema: 'fucq443-connected-manual-proof/1', story: 'DEV-2026-11-13-011 / FUCQ-443', startedAt: new Date().toISOString(), deadlineSeconds: DEADLINE_MS / 1000, runToken: RUN_TOKEN, origins: ORIGINS, scope: PROOF_SCOPE, selectedScenarios: SELECTED_SCENARIOS,
  localTestIssuer: `LOCAL TEST OIDC ISSUER ${ISSUER}: harness only, not the real provider`, composition: null, inputs: null, tools: {}, processes: [], scenarios: {}, originalAcceptance: null, failureLogs: {},
  limitations: [
    'The parent supplies prebuilt production web/API; input hashes do not independently establish their source revision.',
    'The issuer is a local test OIDC provider. Real signed tokens, code/PKCE login and Java bearer verification run; the real hosted identity provider does not.',
    'Ordering starts with the labelled synthetic provider in the run-owned schema. Recovery-refusal additionally selects the real remote adapter at process startup against a labelled owned HTTPS rejecting substitute, not a live provider. The parent owns the schema and teardown.',
    'Setup saves complete manual drafts through Java POST /manual/draft. Claims and orders are made by the browser except labelled negative API probes (stale terms/quote, declarations) and idempotency replays. One labelled second-client review-details save creates the stale-review scenario.',
    'Lost response uses CDP Fetch at the response stage: the server answers, then the browser connection is failed. No request or response body is altered.',
    'Hold timers are real (preview 120 s, order review 600 s); a slow run can expire a claim and fail a scenario honestly.',
    'The outer supervisor owns HostBudget, manifest/finalizer, aggregate output/RSS limits and final process/listener/schema/scratch audit.'] };
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
const SUPERVISOR_MARKERS = ['F441_LOCAL_TOKEN', 'F442_LOCAL_TOKEN', 'F443_LOCAL_TOKEN', 'TEST_RESOURCE_PARENT_RESERVATION', 'PROOF_RUN_TOKEN'];
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
    // Labelled HTTPS ordering substitute using the existing FUCQ-481 contract; it rejects every valid execute.
    if (url.pathname.startsWith('/proof-ordering/')) {
      const answer = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
      if (req.headers.authorization !== `Bearer ${ORDERING_TOKEN}` || orderingRequests.length >= 32) return answer(403, {});
      let input;
      if (req.method === 'POST' && url.pathname === '/proof-ordering/execute') {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 65536) return answer(413, {}); chunks.push(chunk); }
        try { input = JSON.parse(Buffer.concat(chunks).toString()); } catch { return answer(400, {}); }
      } else if (req.method === 'GET' && url.pathname === '/proof-ordering/reconcile') input = Object.fromEntries(url.searchParams);
      else return answer(405, {});
      if (!['operationId', 'runId', 'orderUuid'].every((k) => typeof input[k] === 'string' && input[k])) return answer(400, {});
      const ids = { operationId: input.operationId, runId: input.runId, orderUuid: input.orderUuid };
      const key = canon(ids); const existing = orderingReplies.get(key);
      const reply = existing ?? { status: req.method === 'POST' ? 'rejected' : 'not-found', ...ids, fictional: true };
      if (req.method === 'POST') orderingReplies.set(key, reply);
      orderingRequests.push({ method: req.method, path: url.pathname, authenticated: true, input, reply, idempotencyKey: req.headers['idempotency-key'] ?? null });
      return answer(200, reply);
    }
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
    GCSP_ACCOUNT_PROVIDER: 'repository', GCSP_SCENARIO_PROVIDER: 'demo', GCSP_ORDERING_PROVIDER: orderingMode, GCSP_RESET_ALLOWED: 'true',
    ...(orderingMode === 'remote' ? { GCSP_ORDERING_EXECUTE_URL: `https://127.0.0.1:${PORTS.idp}/proof-ordering/execute`, GCSP_ORDERING_RECONCILE_URL: `https://127.0.0.1:${PORTS.idp}/proof-ordering/reconcile`, GCSP_ORDERING_TOKEN: ORDERING_TOKEN, GCSP_ORDERING_TIMEOUT: '5s' } : {}),
    GCSP_DATABASE_URL: DB_URL, GCSP_DATABASE_USER: process.env.PROOF_DB_USER ?? 'gcsp', GCSP_EXPECTED_DATABASE: DB_NAME };
}
let api = null; let apiStarts = 0;
async function startApi() {
  apiStarts++;
  const name = `api-${apiStarts}`;
  const props = [`-Dquarkus.datasource.jdbc.additional-jdbc-properties.currentSchema=${SCHEMA}`, `-Dquarkus.flyway.schemas=${SCHEMA}`, `-Dquarkus.flyway.default-schema=${SCHEMA}`];
  api = spawnOwned(name, path.join(JAVA_HOME, 'bin/java'), [...API_JVM_ARGS, `-Djavax.net.ssl.trustStore=${tls.trust}`, `-Djavax.net.ssl.trustStorePassword=${TRUST_PASS}`, `-Djava.io.tmpdir=${dirs.tmp}`, ...props, '-jar', JAR], apiEnv(), PORTS.api);
  for (let i = 0; ; i++) {
    if (api.done) { receipt.failureLogs[name] = tail(api.logFile); throw new Error(`${name} exited during startup`); }
    try { const r = await request('GET', '/context'); if (r.status === 401) break; } catch { /* not up yet */ }
    if (i > 240) { receipt.failureLogs[name] = tail(api.logFile); throw new Error(`${name} did not become ready`); }
    await sleep(500);
  }
  log(`${name} ready on ${ORIGINS.api}`);
}
async function stopApi() { await api.stop(); log(`api-${apiStarts} stopped (exit ${api.exitCode ?? api.signalCode})`); }

// ---------- direct HTTPS (server truth and explicitly labelled setup/negative probes) ----------
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
  return call(person, 'GET', suffix);
}
async function call(person, method, suffix, body = null) {
  if (!PEOPLE.includes(person)) throw new Error(`Unknown proof employee ${person}`);
  return request(method, suffix, { Authorization: `Bearer ${signJwt(accessClaims(`sub-${person}`, ['employee']), idp.keys.privateKey)}`,
    ...(body === null ? {} : { 'Content-Type': 'application/json' }) }, body);
}
async function serverAccount(person = 'paula') {
  const r = await serverRead('/manual/account', person);
  if (r.status !== 200 || r.json?.status !== 'ok') throw new Error(`server account read failed: ${r.status} ${r.json?.code ?? ''}`);
  return r.json.value;
}
const REQUEST_KEYS = ['orderUuid', 'holdId', 'quoteId', 'reason', 'expectedStockVersion', 'expectedDraftVersion', 'expectedContextVersion', 'expectedTermsDigest', 'expectedHoldVersion',
  'expectedReviewDetailsVersion', 'expectedQuoteId', 'termsDigest', 'source', 'declarations', 'details'];
function requestSummary(b) {
  if (!b || typeof b !== 'object') return null;
  return { commandId: typeof b.commandId === 'string', ...Object.fromEntries(REQUEST_KEYS.filter((k) => b[k] !== undefined).map((k) => [k, b[k]])),
    raw: b, carriesIdentity: /"(employeeId|runId|environmentId|principalId|subject)"/.test(JSON.stringify(b)) };
}
const responseSummary = (body) => body;
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else this.listeners.forEach((f) => f(m)); }); }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', () => j(new Error('CDP websocket failed'))); }); return new Cdp(ws); }
  send(method, params = {}, sessionId) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
}
const hdr = (h = {}, name) => Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1];
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
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
// Fails selected responses AFTER the server answered (CDP Fetch, response stage). Bodies are never altered.
class FetchPage extends Page {
  constructor(...args) { super(...args); this.rules = []; this.dropped = []; }
  async intercept(suffix) { await this.send('Fetch.enable', { patterns: [{ urlPattern: `${ORIGINS.api}${API_PATH}${suffix}`, requestStage: 'Response' }] }); }
  interceptOrder() { return this.intercept('/manual/order'); }
  drop(method, times = 1) { this.rules.push({ method, times }); }
  event(m) {
    if (m.method === 'Fetch.requestPaused') { this.paused(m.params).catch(() => {}); return; }
    super.event(m);
  }
  async paused(p) {
    const rule = this.rules.find((r) => r.method === p.request.method && r.times > 0);
    if (!rule) {
      // TODO(unconfirmed): continueResponse vs continueRequest at the response stage; both are tried.
      await this.send('Fetch.continueResponse', { requestId: p.requestId }).catch(() => this.send('Fetch.continueRequest', { requestId: p.requestId }));
      return;
    }
    rule.times--;
    let body = null;
    try { const r = await this.send('Fetch.getResponseBody', { requestId: p.requestId }); body = parse(r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body); } catch { /* body unavailable */ }
    this.dropped.push({ method: p.request.method, path: new URL(p.request.url).pathname.replace(API_PATH, ''), status: p.responseStatusCode ?? null, body });
    await this.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'ConnectionReset' });
  }
}
async function newPage(cdp, label) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new FetchPage(cdp, sessionId, browserContextId, label);
  await page.send('Page.enable'); await page.send('Emulation.setFocusEmulationEnabled', { enabled: true }); await page.send('Network.enable'); await page.send('Network.setCacheDisabled', { cacheDisabled: true }); await page.send('Runtime.enable');
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__f443CspViolations = []; addEventListener('securitypolicyviolation', (e) => { if (window.__f443CspViolations.length < 20) window.__f443CspViolations.push({ directive: e.effectiveDirective, blocked: e.blockedURI }); });` });
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
// DOM helpers over the real StockComponent, ManualRoute, review-details and summary templates.
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
const setText = (selector, value) => { const el = $(selector); if (!el || el.disabled || el.closest('fieldset:disabled')) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); return el.value === value; };
const declarations = () => [...main.querySelectorAll('.manual-declaration')].map((l) => ({ label: l.querySelector('span')?.textContent.trim(), checked: l.querySelector('input').checked, disabled: l.querySelector('input').disabled || !!l.closest('fieldset:disabled') }));
const tick = (i) => { const el = $('#manual-declaration-' + i); if (!el || el.disabled || el.closest('fieldset:disabled')) return false; if (!el.checked) el.click(); return el.checked; };
const untick = (i) => { const el = $('#manual-declaration-' + i); if (!el || el.disabled || el.closest('fieldset:disabled')) return false; if (el.checked) el.click(); return !el.checked; };
const outcome = () => ({ title: main.querySelector('gcsp-screen-intro')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, heading: $('#manual-outcome-title')?.textContent.trim() ?? null, status: $('.manual-outcome [role=status]')?.textContent.trim() ?? null,
  facts: $('.manual-outcome') ? facts($('.manual-outcome')) : [], stages: [...main.querySelectorAll('.manual-stages li')].map((li) => [...li.querySelectorAll('span')].map((x) => x.textContent.trim())) });
const savedStatus = () => $('#manual-details-status')?.textContent.trim() ?? '';
`;
const STOCK_READY = `return !!$('.gcsp-stock') && !!$('#stock-query') && !/Loading released cars/.test(text());`;
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const same = (a, b) => canon(a) === canon(b);
async function openStock(page, how = `${ORIGINS.web}/gcsp/stock`) {
  return freshDocument(page, how, { ready: STOCK_READY, readPath: '/manual/stock', what: 'released stock' });
}
async function showAll(page) {
  for (let i = 0; i < 4; i++) {
    if (!(await page.act(`return !!button('Show more cars');`))) return;
    const n = await page.act('return cards().length;');
    if (!(await page.act(`return press('Show more cars');`))) throw new Error('Show more was not actionable');
    await page.until(`return cards().length > ${n};`, 5000, 'next actual stock page');
  }
  if (await page.act(`return !!button('Show more cars');`)) throw new Error('Unexpected unbounded proof stock');
}
async function selectCar(page, id) {
  await showAll(page);
  if (!(await page.act(`return detail(${JSON.stringify(id)});`))) throw new Error(`No detail action for ${id}`);
  await page.until(`return !!$('[data-detail-heading]') && history.state?.gcspStock?.selectedId === ${JSON.stringify(id)};`, 10000, 'exact selected detail');
  await page.until(`return document.activeElement?.hasAttribute('data-detail-heading');`, 5000, 'detail heading focus');
}
// ---------- fixture SQL (run-owned schema only; the parent owns the database and teardown) ----------
const quoted = (value) => `'${String(value).replaceAll("'", "''")}'`;
const RUN_KEY = `environment_id = ${quoted(ENVIRONMENT_ID)} AND run_id = ${quoted(RUN_ID)}`;
let sqlCount = 0;
async function sql(statement, flags = []) {
  const name = `fixture-${++sqlCount}`;
  await runOnce(name, PSQL, ['-X', '-v', 'ON_ERROR_STOP=1', ...flags, '-h', DB[1].replace(/[\[\]]/g, ''), '-p', DB[2] ?? '5432', '-U', process.env.PROOF_DB_USER ?? 'gcsp', '-d', DB_NAME, '-c', statement],
    { PATH: process.env.PATH, HOME: process.env.HOME, PGCONNECT_TIMEOUT: '10', PGOPTIONS: `-c search_path=${SCHEMA}` }, 30000);
  return name;
}
function sqlOut(statement) {
  return cap(PSQL, ['-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q', '-h', DB[1].replace(/[\[\]]/g, ''), '-p', DB[2] ?? '5432', '-U', process.env.PROOF_DB_USER ?? 'gcsp', '-d', DB_NAME, '-c', statement],
    { env: childEnv({ PATH: process.env.PATH, HOME: process.env.HOME, PGCONNECT_TIMEOUT: '10', PGOPTIONS: `-c search_path=${SCHEMA}` }), timeout: 30000 });
}
function sqlJson(statement) {
  const text = sqlOut(statement);
  return text ? JSON.parse(text) : null;
}
async function dbCount(table, person) {
  if (table !== 'selection_orders' || !PEOPLE.includes(person)) throw new Error('Unsupported proof count');
  return Number(sqlOut(`SELECT count(*) FROM selection_orders WHERE ${RUN_KEY} AND employee_id = ${quoted(`employee-${person}`)}`));
}
async function dbOrders(person) {
  if (!PEOPLE.includes(person)) throw new Error(`Unknown proof employee ${person}`);
  return sqlJson(`SELECT coalesce(json_agg(o ORDER BY o."operationId"), '[]'::json) FROM (
    SELECT s.operation_id AS "operationId", s.order_uuid AS "orderUuid", s.order_reference AS reference,
      s.selection, p.state, p.attempts
    FROM selection_orders s JOIN pending_operations p USING (environment_id, run_id, operation_id)
    WHERE s.environment_id = ${quoted(ENVIRONMENT_ID)} AND s.run_id = ${quoted(RUN_ID)}
      AND s.employee_id = ${quoted(`employee-${person}`)}) o`);
}
let providerDown = false;
async function setProvider(down) {
  if (providerDown === down) return;
  // Only this run-owned schema changes. The synthetic provider then returns UNKNOWN
  // from its real SQL error path, while durable order intent remains readable.
  await sql(down
    ? 'ALTER TABLE ordering_synthetic_receipts RENAME TO ordering_synthetic_receipts_proof_offline'
    : 'ALTER TABLE ordering_synthetic_receipts_proof_offline RENAME TO ordering_synthetic_receipts');
  providerDown = down;
  receipt.fixture.mutations.push({ label: down ? 'synthetic ordering store unavailable' : 'synthetic ordering store restored', at: new Date().toISOString() });
}
async function serverState(person, { order = true } = {}) {
  const get = async (p) => { const r = await call(person, 'GET', p); return { http: r.status, body: r.json }; };
  return { claim: await get('/manual/claim'), terms: await get('/manual/order/terms'), details: await get('/manual/review-details'), ...(order ? { order: await get('/manual/order') } : {}) };
}
async function waitDetailsVersion(person, version, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const r = await call(person, 'GET', '/manual/review-details'); if (r.json?.value?.reviewDetailsVersion === version) return r.json.value; await sleep(300); }
  throw new Error(`${person}: review details never reached version ${version}`);
}
function orderBody(state, declarations, over = {}) {
  const c = state.claim.body.value; const t = state.terms.body.value; const d = state.details.body.value;
  return { commandId: `f443-probe-${randomBytes(6).toString('hex')}`, source: { type: 'cart', holdId: c.hold.holdId, expectedHoldVersion: c.hold.version, expectedDraftVersion: c.quote.draftVersion },
    expectedQuoteId: c.quote.quoteId, expectedStockVersion: d.stockVersion, expectedReviewDetailsVersion: d.reviewDetailsVersion, termsDigest: t.termsDigest, declarations, ...over };
}
const declarationsFor = (terms, mode) => Object.fromEntries(terms.declarations.filter((x) => x.appliesTo === 'all' || x.appliesTo === mode).map((x) => [x.id, true]));

// Seeds four released cars (cloned from the paula-mixed source row) and one complete saved draft per employee.
async function seedDraft(person) {
  const account = await serverAccount(person);
  if (account.state !== 'ready') throw new Error(`Fixture account for ${person} is ${account.state}, expected ready`);
  const options = account.choices;
  const driver = options.drivers.find((d) => d.kind === 'employee');
  const contract = options.contractOptions.find((c) => c.driverKinds.includes(driver?.kind));
  const rules = account.assumptions?.find((a) => Number.isSafeInteger(a.value?.minimumLeadDays) && Number.isSafeInteger(a.value?.maximumLeadDays))?.value;
  if (!driver || !contract || !rules || !/^\d{4}-\d{2}-\d{2}T/.test(account.asOf ?? '')) throw new Error(`${person}: account lacks authoritative draft setup choices, clock or lead rules`);
  const today = Date.parse(`${account.asOf.slice(0, 10)}T00:00:00Z`);
  const window = account.currentContract;
  let day; let location;
  for (let lead = rules.minimumLeadDays; lead <= rules.maximumLeadDays; lead++) {
    const offered = new Date(today + lead * 86400000).toISOString().slice(0, 10);
    if (window?.earliestCollectionDate && offered < window.earliestCollectionDate || window?.latestCollectionDate && offered > window.latestCollectionDate) continue;
    const open = options.collectionLocations.find((l) => l.driverKinds.includes(driver.kind) && l.contractOptionIds.includes(contract.contractOptionId) && !(l.closedDates ?? []).includes(offered));
    if (open) { day = offered; location = open; break; }
  }
  if (!day || !location) throw new Error(`${person}: no collection date inside the authoritative lead/window/location rules`);
  const replacement = !!account.currentContract;
  const choices = { mode: replacement ? 'replacement' : 'new', oldContractId: replacement ? account.currentContract.contractId : null, slotId: options.slotId, schemeId: options.schemeId,
    driverId: driver.driverId, contractOptionId: contract.contractOptionId, requestedCollectionDate: day, collectionLocationId: location.locationId, brand: options.brands[0],
    contact: { phone: '01632 960000', email: `${EMAIL[person]}@gcsp-demo.com` }, expectedReturnMileage: replacement ? 20000 : null, specialRequirements: '' };
  const saved = await call(person, 'POST', '/manual/draft', { commandId: `f443-setup-${person}-${RUN_TOKEN}`, expectedDraftVersion: 0, expectedContextVersion: account.contextVersion, choices });
  if (saved.status !== 200 || saved.json?.status !== 'ok') throw new Error(`${person}: complete draft setup failed: ${JSON.stringify(saved)}`);
  receipt.fixture.drafts[person] = { mode: choices.mode, collectionDate: day, locationId: location.locationId, httpStatus: saved.status };
}
async function seedAll() {
  const cases = path.join(ROOT, 'services/gcsp-api/src/test/resources/recommendation-source/source-cases.json');
  receipt.inputs.stockFixture = { path: path.relative(ROOT, cases), sha256: sha256File(cases) };
  receipt.fixture = { stockIds: STOCK_IDS, cars: CAR, drafts: {}, mutations: [] };
  const account = await serverAccount('paula');
  const day = account.asOf.slice(0, 10);
  const base = JSON.parse(readFileSync(cases, 'utf8')).cases.find((c) => c.name === 'paula-mixed').rows[0];
  const rows = STOCK_IDS.map((orderUuid, i) => {
    const row = structuredClone(base);
    row.orderUuid = orderUuid; row.orderNumber = carNumber(orderUuid);
    const hatch = orderUuid === CAR.alex;
    row.configurationId = hatch ? 'F443-hatch-configuration' : 'F443-touring-configuration';
    const snapshot = row.facts;
    snapshot.sourceKeys.stockId = orderUuid; snapshot.snapshotVersion = `f443-snapshot-${i + 1}`;
    snapshot.display = { name: hatch ? 'BMW 1 Series Sports Hatch 120' : 'BMW 3 Series Touring 320i', photo: `/assets/gcsp-vehicle-evidence/${MEDIA_FILES[hatch ? 1 : 0]}` };
    const fact = (value, unit = null) => ({ status: 'known', value, unit, provenance: structuredClone(snapshot.facts.body.provenance) });
    snapshot.facts.eligibilityModelKey = fact(hatch ? 'F70 Sports Hatch|120' : 'G21 Touring|320i');
    snapshot.facts.body = fact(hatch ? 'hatchback' : 'estate');
    snapshot.facts.series = fact(hatch ? '1 Series' : '3 Series');
    snapshot.facts.model = fact(hatch ? '120' : '320i');
    snapshot.facts.exterior = fact(i % 2 ? 'Mineral Grey' : 'Alpine White');
    snapshot.facts.interior = fact('Black upholstery');
    snapshot.facts.insuranceGroup = fact(20, 'insurance-group');
    // TODO(unconfirmed): earliestCollection mirrors FUCQ-442 (+8..+15 days); here +8..+11 from the run clock, no gate on it was read.
    snapshot.facts.earliestCollection = fact(new Date(Date.parse(`${day}T00:00:00Z`) + (11 - i) * 86400000).toISOString());
    snapshot.facts.equipment = fact([i % 2 ? 'Heated seats' : 'Parking camera']);
    row.release.availability = { state: 'available', availableFrom: '2020-01-01T00:00:00.000Z', availableUntil: '2099-01-01T00:00:00.000Z', version: `f443-release-${i + 1}` };
    return row;
  });
  await sql(`BEGIN; DELETE FROM stock_cars WHERE ${RUN_KEY}; ${rows.map((row) => {
    const attributes = { ...row }; for (const key of ['orderUuid', 'configurationId', 'state', 'available', 'held', 'allocated', 'version']) delete attributes[key];
    return `INSERT INTO stock_cars (environment_id,run_id,order_uuid,configuration_id,state,attributes,version) VALUES (${quoted(ENVIRONMENT_ID)},${quoted(RUN_ID)},${quoted(row.orderUuid)},${quoted(row.configurationId)},'released',${quoted(JSON.stringify(attributes))}::jsonb,1);`;
  }).join('\n')} COMMIT;`);
  for (const person of PEOPLE) await seedDraft(person);
}
// ---------- scenarios ----------
async function scenario(id, title, ac, fn) {
  const s = { title, ac, pass: false, checks: {}, observations: {} };
  receipt.scenarios[id] = s; log(`scenario ${id}: ${title}`);
  try { await fn(s); } catch (e) { s.checks.noException = false; s.error = e.message; }
  s.pass = Object.keys(s.checks).length > 0 && Object.values(s.checks).every((v) => v === true);
  log(`scenario ${id}: ${s.pass ? 'PASS' : 'FAIL'}${s.error ? ` (${s.error.slice(0, 220)})` : ''}`);
}
const posts = (calls, p) => calls.filter((e) => e.method === 'POST' && e.path === p);
const gets = (calls, p) => calls.filter((e) => e.method === 'GET' && e.path === p);
const cap1 = (v) => (v ? v[0].toUpperCase() + v.slice(1) : v);
const TEXT = { a: 'F443 proof requirement A', b1: 'F443 proof requirement B1', b2: 'F443 server-side requirement B2', c: 'F443 proof requirement C', d: 'F443 proof requirement D' };
const POSTED_ORDER = '/manual/order';

async function toReview(page, person) {
  await openStock(page);
  await selectCar(page, CAR[person]);
  await page.act(`return press('Review this car');`);
  await page.until(`return location.pathname === '/gcsp/manual/review' && !!$('#manual-car-name') && !!button('Reserve this car to review');`, 20000, 'selection-ready review');
}
async function reserve(page) {
  await page.act(`return press('Reserve this car to review');`);
  await page.until(`const b = button('Continue to order review'); return !!b && !b.disabled && !!$('#manual-special-requirements');`, 30000, 'quoted preview');
  await page.settle();
}
async function startReview(page) {
  await page.act(`return press('Continue to order review');`);
  await page.until(`return !!button('Place order') && !!$('#manual-declaration-0') && !!$('#manual-details-form');`, 30000, 'order review summary');
  await page.settle();
}
async function saveDetails(page, text) {
  await page.act(`return setText('#manual-special-requirements', ${JSON.stringify(text)});`);
  await page.until(`const b = button('Save review details'); return !!b && !b.disabled;`, 10000, 'save enabled after an edit');
  await page.act(`return press('Save review details');`);
  await page.until(`return /Your saved review details are shown below/.test(savedStatus()) && $('#manual-special-requirements')?.value === ${JSON.stringify(text)};`, 30000, 'saved review details shown');
  await page.settle();
}
async function tickAll(page) {
  const list = await page.act(`return declarations();`);
  for (let i = 0; i < list.length; i++) if (!(await page.act(`return tick(${i});`))) throw new Error(`declaration ${i} could not be ticked`);
  await page.until(`return declarations().every((d) => d.checked);`, 5000, 'all declarations ticked');
  return (await page.act(`return declarations();`)).map((d) => d.label);
}
async function placeOrder(page, double = false) {
  await page.until(`const b = button('Place order'); return !!b && !b.disabled;`, 10000, 'Place order enabled');
  return page.act(`const b = button('Place order'); b.click(); ${double ? 'b.click();' : ''} return true;`);
}
async function waitOutcome(page, heading, timeout = 30000) {
  await page.until(`return $('#manual-outcome-title')?.textContent.trim() === ${JSON.stringify(heading)};`, timeout, `outcome ${heading}`);
  await page.settle();
  return page.act(`return outcome();`);
}
const view = (page) => page.act(`return { text: text(), notice: main.querySelector('gcsp-status-screen')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, place: button('Place order') ? !button('Place order').disabled : null, outcome: outcome(), declarations: declarations() };`);
// The server's own answer for the same employee, used for every read-back comparison.
async function holdRow(holdId) { return sqlJson(`SELECT row_to_json(h) FROM (SELECT state, version FROM custody_holds WHERE ${RUN_KEY} AND hold_id = ${quoted(holdId)}) h`); }
const stagesOf = (v) => v.progress.stages.map((x) => [cap1(x.name), cap1(x.state)]);

// AC1: claim, edit review details, tick declarations, double-click submit; the order holds exactly what the user confirmed.
async function scenarioA(cdp, s, pages) {
  const page = await newPage(cdp, 'paula'); pages.paula = page;
  s.observations.landed = await signIn(page, 'paula');
  s.checks.noOrderBefore = (await dbCount('selection_orders', 'paula')) === 0;
  await toReview(page, 'paula');
  const mark = page.log.length;
  await reserve(page);
  const afterClaim = await serverState('paula');
  const claimPost = posts(page.calls(mark), '/manual/claim')[0];
  s.observations.claimPost = claimPost;
  s.checks.claimedExactCar = claimPost?.status === 200 && claimPost.request?.orderUuid === CAR.paula && afterClaim.claim.body.value.hold.orderUuid === CAR.paula && afterClaim.claim.body.value.hold.phase === 'preview';
  s.checks.claimPinsFromServer = claimPost?.request?.expectedStockVersion === 1 && claimPost.request.expectedDraftVersion === afterClaim.claim.body.value.quote.draftVersion
    && claimPost.request.expectedContextVersion === afterClaim.claim.body.value.quote.contextVersion && claimPost.request.expectedTermsDigest === afterClaim.claim.body.value.quote.termsDigest;
  s.observations.screenshotClaim = await page.shot('a1-claimed-preview.png');
  const reviewMark = page.log.length;
  await startReview(page);
  const reviewPost = posts(page.calls(reviewMark), '/manual/claim/review')[0];
  s.checks.reviewBeganAtServerVersions = reviewPost?.status === 200 && reviewPost.request?.holdId === afterClaim.claim.body.value.hold.holdId
    && reviewPost.request.expectedHoldVersion === afterClaim.claim.body.value.hold.version && reviewPost.request.expectedDraftVersion === afterClaim.claim.body.value.quote.draftVersion;
  const detailsMark = page.log.length;
  await saveDetails(page, TEXT.a);
  const detailsPost = posts(page.calls(detailsMark), '/manual/review-details')[0];
  const savedDetails = await waitDetailsVersion('paula', 1);
  s.checks.detailsSavedAtVersionZero = detailsPost?.status === 200 && detailsPost.request?.expectedReviewDetailsVersion === 0 && savedDetails.details.specialRequirements === TEXT.a && savedDetails.mode === 'replacement';
  const labels = await tickAll(page);
  const snap = await serverState('paula');
  const required = snap.terms.body.value.declarations.filter((x) => x.appliesTo === 'all' || x.appliesTo === 'replacement');
  s.observations.requiredDeclarations = required;
  s.checks.uiShowsServerDeclarations = same(labels, required.map((x) => x.label));
  s.observations.screenshotReview = await page.shot('a2-review-ticked.png');
  const orderMark = page.log.length;
  await placeOrder(page, true);
  const outcome = await waitOutcome(page, 'Awaiting approval');
  const orderCalls = page.calls(orderMark);
  const orderPost = posts(orderCalls, POSTED_ORDER);
  s.observations.orderPosts = orderPost;
  s.checks.doubleClickSentOnePost = orderPost.length === 1 && orderPost[0].status === 200;
  const orders = await dbOrders('paula'); s.observations.dbOrders = orders;
  s.checks.exactlyOneOrderRecorded = orders.length === 1 && orders[0].state === 'acknowledged';
  const sel = orders[0]?.selection ?? {}; const q = snap.claim.body.value.quote; const hold = snap.claim.body.value.hold; const req = orderPost[0]?.request ?? {};
  s.checks.orderHasExactCar = sel.stock?.orderUuid === CAR.paula && sel.stock.orderNumber === carNumber(CAR.paula) && sel.stock.configurationId === q.configurationId && orders[0].orderUuid === CAR.paula;
  s.checks.orderHasQuotedTerms = sel.quote?.quoteId === q.quoteId && sel.quote.termsDigest === q.termsDigest && same(sel.quote.terms, q.terms) && sel.terms?.termsDigest === snap.terms.body.value.termsDigest;
  s.checks.orderHasDraftVersions = sel.source?.holdId === hold.holdId && sel.source.expectedHoldVersion === hold.version && sel.source.expectedDraftVersion === q.draftVersion && sel.draft?.mode === 'replacement';
  s.checks.orderHasReviewDetails = sel.reviewDetails?.reviewDetailsVersion === 1 && sel.reviewDetails.details?.specialRequirements === TEXT.a && sel.reviewDetails.binding?.holdId === hold.holdId;
  s.checks.orderHasConfirmedDeclarations = same(sel.declarations, Object.fromEntries(required.map((x) => [x.id, true]))) && same(req.declarations, sel.declarations);
  s.checks.requestCarriedTheServerPins = req.expectedQuoteId === q.quoteId && req.termsDigest === snap.terms.body.value.termsDigest && req.expectedReviewDetailsVersion === 1
    && req.expectedStockVersion === snap.details.body.value.stockVersion && req.source?.holdId === hold.holdId && req.source.expectedHoldVersion === hold.version;
  const held = await holdRow(hold.holdId); s.observations.hold = held;
  s.checks.holdAllocatedByServer = held?.state === 'allocated';
  const read = await call('paula', 'GET', '/manual/order');
  s.observations.serverOrder = read.json;
  s.checks.serverReportsAwaitingApproval = read.status === 200 && read.json?.value?.status === 'acknowledged' && read.json.value.view?.state === 'awaiting-approval' && read.json.value.orderReference === orders[0]?.reference;
  s.checks.uiShowsServerState = outcome.status === 'Your order has reached ordering and is awaiting approval.' && same(outcome.stages, stagesOf(read.json.value))
    && outcome.facts.some(([k, v]) => k === 'Order reference' && v === orders[0]?.reference) && outcome.facts.some(([k, v]) => k === 'Car order number' && v === carNumber(CAR.paula))
    && outcome.facts.some(([k, v]) => k === 'Car ID' && v === CAR.paula);
  s.checks.noEmDashOnScreen = !/\u2014/.test((await view(page)).text);
  s.checks.requestsCarryOnlyTheBearer = page.calls().every((e) => e.auth && !e.query && !e.path.includes(EMPLOYEE) && !e.request?.carriesIdentity);
  s.observations.screenshotOutcome = await page.shot('a3-awaiting-approval.png');
  pages.paulaOrderRequest = req;
}

// AC2 stale: review details change on the server after the user ticked; submit is refused, nothing is created, correction works.
async function scenarioB(cdp, s, pages) {
  const page = await newPage(cdp, 'alex'); pages.alex = page;
  await signIn(page, 'alex');
  await toReview(page, 'alex'); await reserve(page); await startReview(page);
  await saveDetails(page, TEXT.b1);
  await waitDetailsVersion('alex', 1);
  const staleLabels = await tickAll(page);
  const snap = await serverState('alex', { order: false });
  const hold = snap.claim.body.value.hold; const q = snap.claim.body.value.quote; const d1 = snap.details.body.value;
  const required = snap.terms.body.value.declarations.filter((x) => x.appliesTo === 'all' || x.appliesTo === hold.mode);
  const all = Object.fromEntries(required.map((x) => [x.id, true]));
  // Server-side change between review and submit: a second save moves review details to version 2.
  const second = await call('alex', 'POST', '/manual/review-details', { commandId: `f443-b-server-${RUN_TOKEN}`, holdId: hold.holdId, quoteId: q.quoteId, expectedHoldVersion: hold.version,
    expectedDraftVersion: q.draftVersion, expectedReviewDetailsVersion: 1, details: { ...d1.details, specialRequirements: TEXT.b2 } });
  receipt.fixture.mutations.push({ label: 'alex review details saved server-side to version 2', at: new Date().toISOString(), http: second.status });
  s.checks.serverMovedDetailsToVersionTwo = second.status === 200 && second.json?.value?.reviewDetailsVersion === 2;
  // Negative API probe (labelled): stale terms digest. TODO(unconfirmed): exact reason text; asserts status and code only.
  const probeBody = orderBody(snap, all, { termsDigest: 'f443-stale-terms-digest', expectedReviewDetailsVersion: 2 });
  const probe = await call('alex', 'POST', POSTED_ORDER, probeBody);
  s.observations.termsChangedProbe = { http: probe.status, body: probe.json };
  s.checks.staleTermsRefusedByServer = probe.status === 409 && probe.json?.status === 'conflict' && probe.json.code === 'terms-changed';
  const staleQuote = await call('alex', 'POST', POSTED_ORDER, orderBody(snap, all, { expectedQuoteId: `${q.quoteId}-stale`, expectedReviewDetailsVersion: 2 }));
  s.observations.staleQuoteProbe = { http: staleQuote.status, body: staleQuote.json };
  s.checks.staleQuoteRefusedByServer = staleQuote.status === 409 && staleQuote.json?.status === 'conflict' && staleQuote.json.code === 'quote-binding-changed';
  s.checks.nothingWrittenByProbe = (await dbCount('selection_orders', 'alex')) === 0 && (await holdRow(hold.holdId))?.state === 'active';
  const mark = page.log.length;
  await placeOrder(page);
  await page.until(`return /Your selection has changed/.test(text());`, 30000, 'stale selection notice');
  await page.settle();
  const calls = page.calls(mark); const refused = posts(calls, POSTED_ORDER)[0];
  s.observations.refusedPost = refused;
  // TODO(unconfirmed): the freeze refusal code is expected to be stale-review-details; asserts conflict plus a stale code and records it.
  s.checks.serverRefusedStale = refused?.status === 409 && refused.response?.status === 'conflict' && /stale|changed/.test(refused.response?.code ?? '') && refused.request?.expectedReviewDetailsVersion === 1;
  s.observations.refusalCode = refused?.response?.code;
  s.checks.noOrderCreated = (await dbCount('selection_orders', 'alex')) === 0 && (await holdRow(hold.holdId))?.state === 'active';
  const stale = await view(page); s.observations.staleView = stale;
  s.checks.uiTellsTheUserTheSelectionChanged = /Your selection has changed/.test(stale.notice ?? '') && !stale.outcome.heading && stale.place === false && !/Awaiting approval|Order received/.test(stale.text);
  s.observations.screenshotStale = await page.shot('b1-stale-details-refused.png');
  await page.act(`return press('Check status');`);
  await page.until(`return !button('Check status') && !!button('Place order') && $('#manual-special-requirements')?.value === ${JSON.stringify(TEXT.b2)};`, 30000, 'refreshed to the server details');
  await page.settle();
  const refreshed = await view(page);
  s.checks.refreshShowsServerVersionAndClearsConsent = refreshed.declarations.length === required.length && refreshed.declarations.every((x) => !x.checked) && refreshed.place === false;
  s.observations.screenshotRefreshed = await page.shot('b2-refreshed-consent-cleared.png');
  const labels = await tickAll(page);
  s.checks.sameDeclarationsOffered = same(labels, staleLabels);
  const fixMark = page.log.length;
  await placeOrder(page);
  const outcome = await waitOutcome(page, 'Awaiting approval');
  const fixPost = posts(page.calls(fixMark), POSTED_ORDER)[0];
  const orders = await dbOrders('alex'); s.observations.dbOrders = orders;
  const sel = orders[0]?.selection ?? {};
  s.checks.correctionCreatedOneOrder = orders.length === 1 && orders[0].state === 'acknowledged' && fixPost?.status === 200 && fixPost.request?.expectedReviewDetailsVersion === 2;
  s.checks.correctionHasNewDetailsAndSameCar = sel.reviewDetails?.reviewDetailsVersion === 2 && sel.reviewDetails.details?.specialRequirements === TEXT.b2 && sel.stock?.orderUuid === CAR.alex && same(sel.declarations, all);
  s.checks.exactlyTwoSubmitsTheFirstRefused = posts(page.calls(mark), POSTED_ORDER).map((e) => e.status).join() === '409,200';
  s.checks.uiMatchesServerAfterCorrection = outcome.heading === 'Awaiting approval' && outcome.facts.some(([k, v]) => k === 'Order reference' && v === orders[0]?.reference);
  s.observations.screenshotCorrected = await page.shot('b3-corrected-order.png');
}

// AC2 declarations: the UI cannot submit without every declaration; the server refuses the same shapes with invalid on declarations.
async function scenarioC(cdp, s, pages) {
  const page = await newPage(cdp, 'jordan'); pages.jordan = page;
  await signIn(page, 'jordan');
  await toReview(page, 'jordan'); await reserve(page); await startReview(page);
  await saveDetails(page, TEXT.c);
  const snap = await serverState('jordan', { order: false });
  const hold = snap.claim.body.value.hold; const mode = hold.mode;
  const required = snap.terms.body.value.declarations.filter((x) => x.appliesTo === 'all' || x.appliesTo === mode);
  s.observations.mode = mode; s.observations.required = required;
  s.checks.jordanIsANewOrder = mode === 'new' && required.length >= 2;
  const mark = page.log.length;
  await page.act(`return tick(0);`);
  const partial = await view(page); s.observations.partial = partial;
  s.checks.uiBlocksSubmitWithAMissingDeclaration = partial.place === false && partial.declarations.filter((d) => d.checked).length === 1 && (await page.act(`return press('Place order');`)) === false;
  s.checks.noPostWasMade = posts(page.calls(mark), POSTED_ORDER).length === 0;
  s.observations.screenshotPartial = await page.shot('c1-missing-declaration-blocked.png');
  const first = required[0].id;
  const bodies = { missing: { [first]: true }, falseValue: { ...Object.fromEntries(required.map((x) => [x.id, true])), [required.at(-1).id]: false }, extra: { ...Object.fromEntries(required.map((x) => [x.id, true])), 'not-a-declaration': true } };
  s.observations.probes = {};
  for (const [name, declarations] of Object.entries(bodies)) {
    const r = await call('jordan', 'POST', POSTED_ORDER, orderBody(snap, declarations));
    s.observations.probes[name] = { http: r.status, body: r.json };
    // TODO(unconfirmed): reason text is not asserted; the field and status are what OrderingResource.invalid returns.
    s.checks[`server-invalid-${name}`] = r.status === 400 && r.json?.status === 'invalid' && r.json.code === 'invalid' && r.json.reasons?.some((x) => x.field === 'declarations');
  }
  s.checks.nothingWritten = (await dbCount('selection_orders', 'jordan')) === 0 && same(await holdRow(hold.holdId), { state: 'active', version: hold.version });
  await page.act(`return press('Check current claim');`);
  await page.settle();
  const after = await view(page);
  s.checks.uiStillShowsNoOrder = !after.outcome.heading && after.place === false && (await dbCount('selection_orders', 'jordan')) === 0;
  // Repeat entry: a reload must ask the user to confirm before anything can be submitted.
  const reloadMark = page.log.length;
  await freshDocument(page, 'reload', { ready: `return !!button('Continue reviewing this selection');`, readPath: '/manual/order', readOk: false, what: 'reload of an unfinished review' });
  const resume = await view(page); s.observations.resume = resume;
  s.checks.reloadRequiresExplicitConfirmation = resume.place === false && resume.declarations.every((x) => x.disabled || !x.checked);
  s.checks.reloadMadeNoWrites = page.calls(reloadMark).every((e) => e.method === 'GET');
  s.observations.screenshotResume = await page.shot('c2-reload-needs-confirmation.png');
  await page.act(`return press('Continue reviewing this selection');`);
  await page.until(`return !button('Continue reviewing this selection') && declarations().every((d) => !d.checked && !d.disabled);`, 15000, 'confirmed resume with consent cleared');
  s.checks.confirmationClearsConsent = true;
  s.checks.stillNoOrder = (await dbCount('selection_orders', 'jordan')) === 0;
}

// AC1/AC2 recovery: lose a completed save response, reconcile only by reads, then restart the real Java process.
async function scenarioF(cdp, s, pages) {
  let page = pages.jordan;
  if (!page) {
    page = await newPage(cdp, 'jordan-recovery'); pages.jordan = page;
    await signIn(page, 'jordan');
    await toReview(page, 'jordan'); await reserve(page); await startReview(page);
    await saveDetails(page, TEXT.c);
  }
  const before = await serverState('jordan', { order: false });
  const version = before.details.body.value.reviewDetailsVersion;
  const savedText = `F443 lost-save durable recovery ${RUN_TOKEN}`;
  await tickAll(page);
  await page.act(`return setText('#manual-special-requirements', ${JSON.stringify(savedText)});`);
  await page.until(`const b = button('Save review details'); return !!b && !b.disabled;`, 10000, 'edited recovery save');
  s.checks.editClearsDeclarations = (await view(page)).declarations.every((d) => !d.checked);
  await page.intercept('/manual/review-details'); page.drop('POST'); page.drop('GET');
  const mark = page.log.length;
  await page.act(`return press('Save review details');`);
  await page.until(`return /Outcome not confirmed/.test(text());`, 30000, 'lost-save unconfirmed notice');
  await page.settle();
  s.observations.dropped = page.dropped;
  const unknown = await view(page); s.observations.unknown = unknown;
  s.checks.saveAndReadResponsesDroppedAfterServerAnswer = page.dropped.length === 2 && page.dropped.every((r) => r.path === '/manual/review-details' && r.status === 200)
    && page.dropped.map((r) => r.method).join() === 'POST,GET' && page.dropped[0].body?.value?.reviewDetailsVersion === version + 1;
  s.checks.lostSaveDoesNotInventSuccess = /Outcome not confirmed/.test(unknown.notice ?? '') && unknown.place === false
    && !unknown.outcome.heading && unknown.declarations.every((d) => d.disabled || !d.checked);
  s.observations.screenshotUnknown = await page.shot('f1-save-outcome-not-confirmed.png');
  const durableRows = () => sqlJson(`SELECT coalesce(json_agg(d ORDER BY d.version), '[]'::json) FROM (
    SELECT hold_id AS "holdId", review_details_version AS version, binding, details, constraints, command_id AS "commandId"
    FROM manual_review_details WHERE ${RUN_KEY} AND employee_id = 'employee-jordan') d`);
  const stored = durableRows(); s.observations.rowsAfterLoss = stored;
  const actual = await waitDetailsVersion('jordan', version + 1);
  s.checks.serverPersistedExactlyOneNewRevision = stored.length === version + 1 && stored.at(-1)?.details?.specialRequirements === savedText
    && actual.details.specialRequirements === savedText && actual.binding.holdId === before.claim.body.value.hold.holdId;
  const readMark = page.log.length;
  await page.act(`return press('Check status');`);
  await page.until(`return !button('Check status') && /Your saved review details are shown below/.test(savedStatus()) && $('#manual-special-requirements')?.value === ${JSON.stringify(savedText)};`, 30000, 'lost-save read reconciliation');
  await page.settle();
  const reconciled = await view(page); s.observations.reconciled = reconciled;
  s.checks.reconciliationUsesOnlyReads = page.calls(readMark).length > 0 && page.calls(readMark).every((r) => r.method === 'GET')
    && gets(page.calls(readMark), '/manual/review-details').length === 1;
  s.checks.saveNeverResubmitted = posts(page.calls(mark), '/manual/review-details').length === 1 && (await dbCount('selection_orders', 'jordan')) === 0;
  s.checks.reconciledDetailsNeedFreshConsent = reconciled.place === false && reconciled.declarations.length > 0 && reconciled.declarations.every((d) => !d.checked);
  await page.send('Fetch.disable');
  const oldProcess = api.identity; const restartMark = page.log.length;
  if (!oldProcess) throw new Error('Started API has no captured process identity');
  await stopApi();
  s.checks.oldApiProcessExited = api.done === true && processIdentity(oldProcess.pid) === null;
  await startApi();
  s.observations.restart = { previous: oldProcess, current: api.identity, starts: apiStarts, schema: SCHEMA, database: DB_NAME };
  s.checks.freshJavaProcessOnSameDatabase = api.identity?.pid !== oldProcess.pid && apiStarts === 2;
  const after = await serverState('jordan', { order: false }); s.observations.afterRestart = after;
  s.checks.durableRowsUnchangedByRestart = same(durableRows(), stored);
  const authority = (value) => { const { now, ...saved } = value; return saved; };
  s.checks.exactSavedAuthoritySurvivesRestart = after.details.http === 200 && same(authority(after.details.body.value), authority(actual))
    && same(after.claim.body.value.quote, before.claim.body.value.quote)
    && after.claim.body.value.hold.holdId === before.claim.body.value.hold.holdId
    && after.claim.body.value.hold.version === before.claim.body.value.hold.version
    && same(after.terms, before.terms);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
  await freshDocument(page, 'reload', { ready: `return !!button('Continue reviewing this selection');`, readPath: '/manual/order', readOk: false, what: 'unfinished review after real API restart' });
  const resume = await view(page); s.observations.resume = resume;
  s.checks.restartReentryReadsWithoutWrites = page.calls(restartMark).length > 0 && page.calls(restartMark).every((r) => r.method === 'GET');
  s.checks.restartRequiresExplicitConfirmation = resume.place === false && resume.declarations.every((d) => d.disabled || !d.checked)
    && (await page.act(`return press('Place order');`)) === false && (await dbCount('selection_orders', 'jordan')) === 0;
  s.checks.narrowReviewHasNoHorizontalOverflow = await page.eval('document.documentElement.scrollWidth <= innerWidth');
  s.observations.screenshotResume = await page.shot('f2-restart-narrow-needs-confirmation.png');
  // Actual Tab/Enter input, without a DOM click or scripted focus, reaches the explicit recovery control.
  let focus = null;
  for (let i = 0; i < 60; i++) {
    focus = await page.eval(`({ tag: document.activeElement?.tagName, label: document.activeElement?.textContent.trim(), outline: getComputedStyle(document.activeElement).outlineStyle, outlineWidth: getComputedStyle(document.activeElement).outlineWidth, shadow: getComputedStyle(document.activeElement).boxShadow })`);
    if (focus.tag === 'BUTTON' && focus.label === 'Continue reviewing this selection') break;
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  }
  s.observations.resumeKeyboardFocus = focus;
  s.checks.keyboardReachesExplicitResume = focus?.tag === 'BUTTON' && focus.label === 'Continue reviewing this selection';
  s.checks.resumeFocusIsVisible = s.checks.keyboardReachesExplicitResume && (focus.outline !== 'none' && focus.outlineWidth !== '0px' || focus.shadow !== 'none');
  s.observations.screenshotKeyboardFocus = await page.shot('f3-restart-keyboard-focus.png');
  if (!s.checks.keyboardReachesExplicitResume) throw new Error('Keyboard did not reach the explicit resume button');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await page.until(`return !button('Continue reviewing this selection') && declarations().length > 0 && declarations().every((d) => !d.checked && !d.disabled);`, 15000, 'keyboard-confirmed resume');
  s.checks.explicitResumeKeepsSavedDetailsAndClearsConsent = await page.act(`return $('#manual-special-requirements')?.value === ${JSON.stringify(savedText)} && declarations().every((d) => !d.checked) && button('Place order')?.disabled === true;`);
  s.checks.noOrderOrSaveOnResume = page.calls(restartMark).every((r) => r.method === 'GET') && (await dbCount('selection_orders', 'jordan')) === 0 && same(durableRows(), stored);
  const tree = await page.send('Accessibility.getFullAXTree');
  const accessible = tree.nodes.filter((n) => !n.ignored).map((n) => ({ role: n.role?.value, name: n.name?.value }));
  s.observations.accessibleControls = accessible.filter((n) => ['textbox', 'checkbox', 'button'].includes(n.role));
  s.checks.savedFieldsHaveAccessibleNames = ['Contact telephone (required)', 'Contact email (required)', 'Special requirements (optional)']
    .every((label) => accessible.some((n) => n.role === 'textbox' && n.name === label));
  s.checks.requiredDeclarationsHaveAccessibleNames = (await page.act('return declarations();')).every((d) => accessible.some((n) => n.role === 'checkbox' && n.name === d.label));
  s.observations.csp = await page.eval(`({ policy: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? '', violations: window.__f443CspViolations ?? null })`);
  s.checks.deployedCspHasNoObservedViolation = /script-src 'self'(?:;|$)/.test(s.observations.csp.policy)
    && Array.isArray(s.observations.csp.violations) && s.observations.csp.violations.length === 0;
  s.checks.noBrowserRuntimeException = page.errors.length === 0;
  s.observations.screenshotResumed = await page.shot('f4-restart-narrow-resumed.png');
}

// AC2 provider refusal: real remote adapter/Java/PG state, driven by a labelled HTTPS substitute rather than a forged browser response.
async function scenarioG(cdp, s, pages) {
  const page = pages.jordan;
  if (!page) throw new Error('Provider-refusal proof requires the completed recovery selection');
  const snap = await serverState('jordan', { order: false });
  const before = await dbOrders('jordan');
  s.checks.noPriorOrder = before.length === 0;
  const oldProcess = api.identity;
  await stopApi(); orderingMode = 'remote'; await startApi();
  s.observations.startup = { provider: orderingMode, actualAdapter: 'HttpOrderingProvider', previous: oldProcess, current: api.identity,
    executeUrl: `https://127.0.0.1:${PORTS.idp}/proof-ordering/execute`, reconcileUrl: `https://127.0.0.1:${PORTS.idp}/proof-ordering/reconcile`, tokenConfigured: true,
    label: 'Owned rejecting HTTPS substitute for the agreed remote contract; no live provider' };
  const reloadMark = page.log.length;
  await freshDocument(page, 'reload', { ready: `return !!button('Continue reviewing this selection');`, readPath: '/manual/order', readOk: false, what: 'unfinished selection under the real remote ordering adapter' });
  s.checks.startupAndReentryDidNotSubmit = page.calls(reloadMark).every((r) => r.method === 'GET') && orderingRequests.length === 0;
  await page.act(`return press('Continue reviewing this selection');`);
  await page.until(`return !button('Continue reviewing this selection') && declarations().length > 0 && declarations().every((d) => !d.checked && !d.disabled);`, 10000, 'explicit remote-adapter review confirmation');
  await tickAll(page);
  const submitMark = page.log.length;
  await placeOrder(page);
  const refused = await waitOutcome(page, 'Handoff failed');
  const orderPosts = posts(page.calls(submitMark), POSTED_ORDER);
  const server = await call('jordan', 'GET', POSTED_ORDER);
  const orders = await dbOrders('jordan');
  s.observations.providerRequests = orderingRequests;
  s.observations.server = server;
  s.observations.orders = orders;
  s.observations.outcome = refused;
  const executes = orderingRequests.filter((r) => r.method === 'POST');
  const execute = executes[0]; const row = orders[0];
  s.checks.realRemoteExecuteReturnedRejected = executes.length === 1 && execute.authenticated === true && execute.reply.status === 'rejected'
    && execute.input.operationId === row?.operationId && execute.input.orderUuid === CAR.jordan && execute.input.runId === RUN_ID
    && execute.idempotencyKey === execute.input.idempotencyKey && execute.reply.fictional === true;
  s.checks.oneBrowserSubmitAndOneDurableRefusal = orderPosts.length === 1 && orderPosts[0].status === 200 && orders.length === 1 && row.state === 'refused';
  s.checks.refusalRetainsExactSelection = row?.selection?.stock?.orderUuid === CAR.jordan && row.selection.quote?.quoteId === snap.claim.body.value.quote.quoteId
    && same(row.selection.quote?.terms, snap.claim.body.value.quote.terms)
    && row.selection.reviewDetails?.reviewDetailsVersion === snap.details.body.value.reviewDetailsVersion
    && same(row.selection.reviewDetails?.details, snap.details.body.value.details);
  s.checks.serverTruthIsHandoffFailed = server.status === 200 && server.json?.status === 'ok' && server.json.value?.status === 'refused'
    && server.json.value.view?.state === 'handoff-failed' && server.json.value.failure?.reason === 'remote-ordering-rejected';
  const shown = await view(page);
  s.checks.uiShowsActualRefusalAndSupport = refused.status === 'Your order is saved, but it could not be sent to ordering. Contact scheme support.'
    && same(refused.stages, stagesOf(server.json.value)) && shown.text.includes('remote-ordering-rejected')
    && !/Awaiting approval|Your order has reached ordering/.test(shown.text)
    && (await page.act(`return !!button('Contact scheme support') && !button('Place order');`));
  s.observations.screenshotRefused = await page.shot('g1-remote-provider-handoff-failed.png');
  const reentryMark = page.log.length;
  await freshDocument(page, 'reload', { ready: `return $('#manual-outcome-title')?.textContent.trim() === 'Handoff failed';`, readPath: POSTED_ORDER, what: 'persisted provider refusal' });
  s.checks.reentryReadsRefusalWithoutAnotherSubmit = page.calls(reentryMark).every((r) => r.method === 'GET')
    && posts(page.calls(submitMark), POSTED_ORDER).length === 1 && orderingRequests.filter((r) => r.method === 'POST').length === 1
    && (await dbOrders('jordan')).length === 1;
  s.observations.screenshotRefusedReentry = await page.shot('g2-remote-refusal-reentry.png');
}

// AC2 lost response: the POST response is dropped after the server accepted it; the UI never claims confirmation and no resubmission happens.
async function scenarioD(cdp, s, pages) {
  const page = pages.jordan;
  await tickAll(page);
  const snap = await serverState('jordan', { order: false }); const hold = snap.claim.body.value.hold;
  await setProvider(true);
  page.dropped = []; // F (scope all) shares this page; count only D's own drops.
  await page.interceptOrder(); page.drop('POST'); page.drop('GET');
  const mark = page.log.length;
  await placeOrder(page);
  await page.until(`return /Outcome not confirmed/.test(text());`, 30000, 'unconfirmed outcome notice');
  await page.settle();
  s.checks.bothResponsesWereDropped = page.dropped.map((x) => x.method).join() === 'POST,GET';
  s.observations.dropped = page.dropped;
  const lost = await view(page); s.observations.lostView = lost;
  s.checks.uiDoesNotClaimConfirmation = /Outcome not confirmed/.test(lost.notice ?? '') && !/Awaiting approval|Order received|Handoff pending/.test(lost.text) && lost.place === false;
  s.observations.screenshotLost = await page.shot('d1-outcome-not-confirmed.png');
  const orders = await dbOrders('jordan'); s.observations.dbOrdersAfterLoss = orders;
  s.checks.serverAcceptedExactlyOne = orders.length === 1 && ['intent', 'pending'].includes(orders[0].state) && orders[0].selection?.stock?.orderUuid === CAR.jordan;
  s.checks.holdAllocatedAtAcceptance = (await holdRow(hold.holdId))?.state === 'allocated';
  const attempts = orders[0]?.attempts;
  s.checks.serverAnsweredBeforeTheDrop = page.dropped[0]?.status === 202 && page.dropped[0].body?.status === 'pending';
  await sleep(4000);
  s.observations.attempts = { atLoss: attempts, afterWait: (await dbOrders('jordan'))[0]?.attempts };
  s.checks.noAutomaticResubmission = posts(page.calls(mark), POSTED_ORDER).length === 1 && (await dbCount('selection_orders', 'jordan')) === 1;
  // Explicit user action: Check status reads the real order; it never posts.
  const checkMark = page.log.length;
  await page.act(`return press('Check status');`);
  const pending = await waitOutcome(page, 'Handoff pending');
  const checkCalls = page.calls(checkMark);
  const serverPending = await call('jordan', 'GET', '/manual/order'); s.observations.serverPending = serverPending.json;
  s.checks.checkStatusOnlyReads = checkCalls.length > 0 && checkCalls.every((e) => e.method === 'GET') && gets(checkCalls, POSTED_ORDER).length === 1;
  s.checks.uiShowsServerPending = serverPending.status === 202 && serverPending.json?.status === 'pending' && serverPending.json.value?.view?.state === 'handoff-pending'
    && pending.status === 'Your order is saved and is being sent to ordering. Check again shortly.' && same(pending.stages, stagesOf(serverPending.json.value));
  s.observations.screenshotPending = await page.shot('d2-handoff-pending.png');
  const reloadMark = page.log.length;
  await freshDocument(page, 'reload', { ready: `return $('#manual-outcome-title')?.textContent.trim() === 'Handoff pending';`, readPath: '/manual/order', readOk: false, what: 'reload of a pending order' });
  s.checks.reloadShowsPendingWithoutWrites = page.calls(reloadMark).every((e) => e.method === 'GET') && (await dbCount('selection_orders', 'jordan')) === 1;
  await setProvider(false);
  await sleep(6500);
  await page.act(`return press('Check order status');`);
  const done = await waitOutcome(page, 'Awaiting approval', 45000);
  const final = await dbOrders('jordan'); s.observations.dbOrdersFinal = final;
  s.checks.reconciledToServerTruth = final.length === 1 && final[0].state === 'acknowledged' && done.status === 'Your order has reached ordering and is awaiting approval.';
  s.checks.clientSentExactlyOneOrderPost = posts(page.calls(mark), POSTED_ORDER).length === 1;
  s.checks.holdAllocatedOnceReconciled = (await holdRow(hold.holdId))?.state === 'allocated';
  s.observations.screenshotReconciled = await page.shot('d3-reconciled-awaiting-approval.png');
}

// AC2 repeat entry: revisiting the routes or replaying the same command cannot make a second order.
async function scenarioE(cdp, s, pages) {
  const page = pages.paula;
  const orderBefore = (await dbOrders('paula'))[0];
  const original = pages.paulaOrderRequest.raw;
  const mark = page.log.length;
  for (const route of ['manual/review', 'manual/summary']) {
    await freshDocument(page, `${ORIGINS.web}/gcsp/${route}`, { ready: `return $('#manual-outcome-title')?.textContent.trim() === 'Awaiting approval';`, readPath: '/manual/order', what: `existing order at ${route}` });
    s.checks[`${route}-showsTheExistingOrder`] = await page.act(`return !button('Place order') && !button('Reserve this car to review') && outcome().facts.some(([k, v]) => k === 'Order reference' && v === ${JSON.stringify(orderBefore.reference)});`);
  }
  s.checks.revisitMadeNoWrites = page.calls(mark).every((e) => e.method === 'GET') && posts(page.calls(mark), POSTED_ORDER).length === 0;
  s.observations.screenshotRevisit = await page.shot('e1-revisit-existing-order.png');
  const replay = await call('paula', 'POST', POSTED_ORDER, original);
  s.observations.sameCommandReplay = { http: replay.status, status: replay.json?.status, replayed: replay.json?.value?.replayed };
  s.checks.sameCommandIsAReplay = replay.status === 200 && replay.json?.value?.replayed === true && replay.json.value.orderReference === orderBefore.reference;
  const again = await call('paula', 'POST', POSTED_ORDER, { ...original, commandId: `f443-e-new-command-${RUN_TOKEN}` });
  s.observations.newCommandSameIntent = { http: again.status, replayed: again.json?.value?.replayed };
  s.checks.newCommandSameIntentIsAReplay = again.status === 200 && again.json?.value?.replayed === true && again.json.value.orderReference === orderBefore.reference;
  // TODO(unconfirmed): a different intent is expected to answer 409 active-selection-exists; the status and code are recorded.
  const different = await call('paula', 'POST', POSTED_ORDER, { ...original, commandId: `f443-e-different-${RUN_TOKEN}`, expectedStockVersion: 99 });
  s.observations.differentIntent = { http: different.status, body: different.json };
  s.checks.differentIntentRefused = different.status === 409 && different.json?.code === 'active-selection-exists';
  const after = await dbOrders('paula');
  s.checks.stillExactlyOneOrder = after.length === 1 && after[0].operationId === orderBefore.operationId && after[0].reference === orderBefore.reference && same(after[0].selection, orderBefore.selection);
  s.checks.atMostOneOrderPerEmployee = Number(sqlOut(`SELECT coalesce(max(c), 0) FROM (SELECT count(*) c FROM selection_orders WHERE ${RUN_KEY} GROUP BY employee_id) x`)) <= 1;
}
// ---------- main ----------
function accessLog() {
  const rows = [];
  for (const p of receipt.processes.filter((x) => x.name.startsWith('api-'))) {
    for (const l of tail(path.join(dirs.logs, `${p.name}.log`), 100000).split('\n')) { const m = /ACCESSLOG (\S+) (\S+) (\d+)/.exec(l); if (m && /\/(manual|ordering|context)/.test(m[2])) rows.push(`${p.name} ${m[1]} ${m[2].replace(API_PATH, '')} ${m[3]}`); }
  }
  return rows.slice(-120);
}
async function main() {
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  for (const [k, p] of Object.entries(PORTS)) if (!(await portFree(p))) throw new Error(`port ${p} (${k}) is in use; choose PROOF_${k.toUpperCase()}_PORT`);
  receipt.inputs = { scratch: PROOF, database: { source: DB_SOURCE, host: DB[1], port: DB[2] ?? '5432', name: DB_NAME, schema: SCHEMA }, ports: PORTS, jar: { path: path.relative(ROOT, JAR), sha256: sha256File(JAR) },
    appJars: readdirSync(path.join(path.dirname(JAR), 'app')).filter((f) => f.endsWith('.jar')).map((f) => ({ file: f, sha256: sha256File(path.join(path.dirname(JAR), 'app', f)) })), psql: { path: PSQL, sha256: sha256File(PSQL) },
    media: MEDIA_FILES.map((name) => ({ name, sha256: sha256File(path.join(MEDIA_ROOT, name)) })), webBrowser: { path: path.relative(ROOT, WEB_BROWSER), indexSha256: sha256File(path.join(WEB_BROWSER, 'index.html')) } };
  receipt.composition = { identity: 'oidc (local test issuer)', subjects: PEOPLE.map((p) => ({ subject: `sub-${p}`, employeeId: `employee-${p}` })), account: 'repository', scenario: 'demo', ordering: 'synthetic', resetAllowed: true, environmentId: ENVIRONMENT_ID, runId: RUN_ID, policyVersion: POLICY,
    mirrors: 'existing demo preparation; released stock cloned from source-cases paula-mixed; one complete saved draft per employee via Java' };
  receipt.sourceRevision = { value: SOURCE_REVISION, provenance: 'PROOF_SOURCE_REVISION supplied and verified by the parent; not read from git here' };
  receipt.tools = { harnessNode: process.version, openssl: cap('openssl', ['version']), chrome: cap(CHROME, ['--version']), apiJvm: jvmLimitsReceipt(API_JVM_ARGS), java: (spawnSync(path.join(JAVA_HOME, 'bin/java'), ['-version'], { encoding: 'utf8', env: childEnv(process.env) }).stderr ?? '').split('\n')[0] };
  log('certificates'); tls = makeCerts();
  log('static assembly of the prebuilt web');
  const assemble = await import(pathToFileURL(path.join(ROOT, 'scripts/build-gcsp-static.mjs')).href);
  await runOnce('assemble', process.execPath, ['scripts/build-gcsp-static.mjs', '--browser', WEB_BROWSER, '--output', dirs.static, '--environment', 'deployed', '--revision', SOURCE_REVISION],
    { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp, GCSP_PUBLIC_ENVIRONMENT_ID: ENVIRONMENT_ID, GCSP_PUBLIC_API_BASE_URL: API_BASE, GCSP_PUBLIC_OIDC_AUTHORITY: ISSUER, GCSP_PUBLIC_OIDC_CLIENT_ID: 'gcsp-web',
      GCSP_PUBLIC_OIDC_SCOPE: 'openid profile gcsp-api', GCSP_PUBLIC_OIDC_REDIRECT_URI: `${ORIGINS.web}/gcsp/auth/callback`, GCSP_PUBLIC_OIDC_POST_LOGOUT_REDIRECT_URI: `${ORIGINS.web}/gcsp/` });
  log('issuer and web'); await startIdp(tls); await startWeb(tls, assemble.GCSP_FIXED_ROUTES);
  log('API (repository accounts, native PG, synthetic ordering)'); await startApi();
  log('seed released stock and one complete saved draft per employee'); await seedAll();
  const profile = path.join(dirs.browser, 'profile'); mkdirSync(profile, { recursive: true });
  const chrome = spawnOwned('chrome', CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-allow-origins=*', `--ignore-certificate-errors-spki-list=${tls.spki}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--window-size=1280,900', 'about:blank'], { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp });
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) { if (chrome.done) throw new Error('Chrome exited during startup'); try { const [p, ws] = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n'); wsUrl = `ws://127.0.0.1:${p}${ws}`; } catch { await sleep(250); } }
  if (!wsUrl) throw new Error('Chrome DevTools endpoint not found');
  const cdp = await Cdp.connect(wsUrl); receipt.cdp = cdp;
  const pages = {};
  if (PROOF_SCOPE === 'all') {
    await scenario('a', 'Claim, edit review details, tick declarations, submit once: the order holds what the user confirmed', 'AC1+AC2', (s) => scenarioA(cdp, s, pages));
    await scenario('b', 'Review details change on the server before submit: refused as stale, no order, correction works', 'AC2', (s) => scenarioB(cdp, s, pages));
    await scenario('c', 'Missing declarations: blocked in the UI, refused invalid by the server, nothing written', 'AC2', (s) => scenarioC(cdp, s, pages));
  }
  await scenario('f', 'Lost save response and ordinary Java restart: durable details, read-only recovery, explicit keyboard resume', 'AC1+AC2', (s) => scenarioF(cdp, s, pages));
  if (PROOF_SCOPE === 'recovery-refusal' && receipt.scenarios.f.pass) await scenario('g', 'Real remote provider refusal: durable backend handoff-failed, truthful support display, no repeat submission', 'AC2', (s) => scenarioG(cdp, s, pages));
  if (PROOF_SCOPE === 'all') {
    if (pages.jordan) await scenario('d', 'Lost order response: no invented confirmation, reconcile to the server, one order, no resubmission', 'AC2', (s) => scenarioD(cdp, s, pages));
    if (pages.paula && pages.paulaOrderRequest) await scenario('e', 'Repeat entry and replay: no second order', 'AC2', (s) => scenarioE(cdp, s, pages));
  }
}
async function teardown() {
  try { if (providerDown) { await setProvider(false); receipt.providerRestoredAtTeardown = true; } } catch (e) { receipt.providerRestoreError = e.message; }
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
  const evidence = (ids) => ids.some((k) => sc[k] && !ok(k)) ? 'fail' : ids.every(ok) ? 'pass' : 'not-run';
  receipt.endedAt = new Date().toISOString();
  if (runError) receipt.runError = runError;
  try { receipt.apiAccessLog = accessLog(); } catch { /* no log */ }
  receipt.originalAcceptance = {
    AC1: { text: 'Claim, review/edit and submission retain the exact car, quoted terms, draft versions and required declarations.', scenarios: ['a', 'b', 'f'], evidence: evidence(['a', 'b', 'f']), closure: 'OPEN: parent review decides' },
    AC2: { text: 'Confirmed, pending, stale and refused submissions display actual backend state. Repeat entry/retry cannot invent confirmation or duplicate a request.', scenarios: ['a', 'b', 'c', 'd', 'e', 'f'], evidence: evidence(['a', 'b', 'c', 'd', 'e', 'f']), closure: 'OPEN: parent review decides' },
    validation: { text: 'Replay claim-to-order against actual Java/nativePG17/signed testOIDC, including stale quotes, declaration failures and lost responses; recovery requires unfinished-order confirmation.', scenarios: ['a', 'b', 'c', 'd', 'e', 'f'], evidence: evidence(['a', 'b', 'c', 'd', 'e', 'f']),
      providerRefusal: { scenario: 'g', evidence: evidence(['g']), boundary: 'Actual remote adapter against owned HTTPS substitute; live providers remain unrun.' } } };
  receipt.overall = SELECTED_SCENARIOS.every(ok) && !runError && !receipt.providerRestoreError && receipt.teardown?.allOwnedExited ? 'PASS' : 'FAIL';
  const file = path.join(dirs.evidence, 'connected-manual-proof.json');
  try { writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`); } catch (e) { console.error('receipt write failed', e.message); }
  for (const k of Object.keys(sc).sort()) console.log(`  ${k}: ${sc[k].pass ? 'PASS' : 'FAIL'} ${sc[k].title}${sc[k].pass ? '' : ` [failed: ${Object.entries(sc[k].checks).filter(([, v]) => v !== true).map(([n]) => n).join(', ')}]`}`);
  console.log(`overall ${receipt.overall}; receipt ${file}; all owned processes exited: ${receipt.teardown?.allOwnedExited}`);
}
const deadline = setTimeout(async () => { log('global deadline exceeded'); await teardown(); finish('global deadline exceeded'); process.exit(1); }, Math.max(1, DEADLINE_MS - 45000));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await teardown(); finish(`interrupted by ${sig}`); process.exit(130); });
let runError;
try { await main(); } catch (e) { runError = e.message; console.error('RUN ERROR:', e.message); } finally { clearTimeout(deadline); await teardown(); finish(runError); }
process.exit(receipt.overall === 'PASS' ? 0 : 1);
