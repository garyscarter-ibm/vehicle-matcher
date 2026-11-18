#!/usr/bin/env node
// FUCQ-451 local proof: real Buddy capture -> presenter inspection -> signed OIDC owned offer return.
// Usage: SCRATCH=/private/tmp/<owned> PROOF_RUN_TOKEN=<unique> PROOF_SOURCE_REVISION=<40hex>
// GCSP_TEST_DATABASE_URL=jdbc:postgresql://127.0.0.1:<port>/<owned_db> PROOF_DB_USER=<role>
// PROOF_API_JAR=<prebuilt jar> PROOF_WEB_BROWSER=<prebuilt browser directory>
// PROOF_PUBLIC_BASE_URL=https://gcsp.example.test node scripts/gcsp/fucq451-connected-outbox-proof.mjs
// Optional PROOF_ORDERING_OUTCOME=synthetic|rejected|pending; each variant owns a fresh schema.
// No build, real mail, hosted provider, Safari, schema deletion or parent-scratch deletion occurs here.
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
const PROOF = path.join(SCRATCH, `fucq451-connected-${RUN_TOKEN}`);
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
const ENVIRONMENT_ID = `f451-connected-${RUN_TOKEN}`;
const RUN_ID = 'run-1';
const POLICY = 'gcsp-policy-v1+offer-journey-v1';
const PEOPLE = ['paula', 'carla', 'bruno'];
const CONTROL_ROLES = { presenter: ['presenter'], greg: ['greg'] };
const ORDERING_OUTCOME = process.env.PROOF_ORDERING_OUTCOME ?? 'synthetic';
if (!['synthetic', 'rejected', 'pending'].includes(ORDERING_OUTCOME)) refuse('PROOF_ORDERING_OUTCOME must be synthetic, rejected or pending');
const ORDERING_TOKEN = randomBytes(24).toString('hex');
const orderingRequests = []; const orderingReplies = new Map();
const TRANCHE_PLAN = path.join(PROOF, 'tranche-plan.json');
const PSQL = path.resolve(process.env.PROOF_PSQL_BIN ?? '/opt/homebrew/opt/postgresql@17/bin/psql');
const MEDIA_ROOT = path.resolve(process.env.PROOF_MEDIA_ROOT ?? path.join(ROOT, 'assets/gcsp-vehicle-evidence'));
const MEDIA_FILES = ['07c269dd7f55fad0a56bbad65ae72f7c35defc5e8883a8290a82972e1defb427.webp', 'ed60cefd049e7293423575b5f0fcee802dbab14083dea2480211ab272896281a.webp',
  'bd89864616f3f34813cb66230e93f5e39d6a25168331ea47e84da60fbf31a735.webp', 'c1a3b0f2df9a6c3834cd04fc8f65455e6daa8fda9e7bf0f7a9c9e5e437ec8318.webp'];
for (const file of [PSQL, MEDIA_ROOT, JAR, WEB_BROWSER, JAVA_HOME, CHROME]) if (/CloudStorage|OneDrive/i.test(file)) refuse('An input path points into a forbidden synced folder');
if (!existsSync(PSQL)) refuse('PROOF_PSQL_BIN must name the parent-pinned native PostgreSQL 17 psql');
for (const name of MEDIA_FILES) if (!existsSync(path.join(MEDIA_ROOT, name))) refuse(`Missing parent-pinned actual media ${name}`);
if (!Number.isFinite(DEADLINE_MS) || DEADLINE_MS <= 0 || DEADLINE_MS > 600000) refuse('PROOF_DEADLINE_SEC must be in (0, 600]');
const SCHEMA = `gcsp_s_f451c_${RUN_TOKEN.replace(/-/g, '_')}`;
const dirs = { logs: path.join(PROOF, 'logs'), tmp: path.join(PROOF, 'tmp'), certs: path.join(PROOF, 'certs'), static: path.join(PROOF, 'static'), browser: path.join(PROOF, 'browser'), evidence: path.join(PROOF, 'evidence') };

const receipt = { schema: 'fucq451-connected-outbox-proof/1', story: 'DEV-2026-11-13-019 / FUCQ-451', startedAt: new Date().toISOString(), deadlineSeconds: DEADLINE_MS / 1000, cleanupReserveSeconds: 45, runToken: RUN_TOKEN, origins: ORIGINS,
  localTestIssuer: `LOCAL TEST OIDC ISSUER ${ISSUER}: harness only, not the real provider`, composition: null, inputs: null, tools: {}, processes: [], scenarios: {}, originalAcceptance: null, failureLogs: {},
  limitations: [
    'Parent supplies and pins prebuilt API/web; artifact hashes alone do not prove source provenance.',
    'Local labelled OIDC issuer exercises real code/PKCE, signed JWTs and Java verification; hosted identity provider remains unrun.',
    'BuddyJourneySeed-equivalent synthetic upstream source records and retained policy feed real allocation, quote, hold and decision services. Browser business responses are never forged.',
    'Synthetic or labelled owned HTTPS remote ordering substitutes establish adapter outcomes only; no live BMW service is called.',
    'No email transport is configured. Navigating an offer URL proves deep-link login return only, never actual email delivery.',
    'Chrome isolated contexts cover desktop/narrow/private storage. Safari and hosted acceptance remain unrun.',
    'Parent owns resource reservation, 2GiB scratch/32MiB output supervision, aggregate original deadline and final schema/scratch audit.' ] };
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

// ---------- local labelled test OIDC issuer ----------
const idp = { codes: new Map(), txns: new Map(), subjects: { ...Object.fromEntries(PEOPLE.map((person) => [`sub-${person}`, ['employee']])), ...Object.fromEntries(Object.entries(CONTROL_ROLES).map(([person, roles]) => [`sub-${person}`, roles])) }, keys: null, server: null };
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
    if (url.pathname.startsWith('/proof-ordering/')) {
      const answer = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (req.headers.authorization !== `Bearer ${ORDERING_TOKEN}` || orderingRequests.length >= 64) return answer(403, {});
      let input;
      if (req.method === 'POST' && url.pathname === '/proof-ordering/execute') {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 65536) return answer(413, {}); chunks.push(chunk); }
        try { input = JSON.parse(Buffer.concat(chunks).toString()); } catch { return answer(400, {}); }
      } else if (req.method === 'GET' && url.pathname === '/proof-ordering/reconcile') input = Object.fromEntries(url.searchParams);
      else return answer(405, {});
      if (!['operationId', 'runId', 'orderUuid'].every(k => typeof input[k] === 'string' && input[k])) return answer(400, {});
      const ids = { operationId: input.operationId, runId: input.runId, orderUuid: input.orderUuid };
      const key = JSON.stringify(ids);
      const reply = orderingReplies.get(key) ?? { status: req.method === 'POST' ? (ORDERING_OUTCOME === 'pending' ? 'unknown' : ORDERING_OUTCOME) : 'not-found', ...ids, fictional: true };
      if (req.method === 'POST') orderingReplies.set(key, reply);
      orderingRequests.push({ method: req.method, path: url.pathname, authenticated: true, ...ids, reply, idempotencyKey: req.headers['idempotency-key'] ?? null });
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
    GCSP_OIDC_ACCOUNTS: JSON.stringify([...PEOPLE.map((person) => ({ subject: `sub-${person}`, roles: ['employee'], employeeId: `employee-${person}` })), ...Object.entries(CONTROL_ROLES).map(([person, roles]) => ({ subject: `sub-${person}`, roles }))]),
    GCSP_ENVIRONMENT_ID: ENVIRONMENT_ID, GCSP_RUN_ID: RUN_ID, GCSP_POLICY_VERSION: POLICY,
    GCSP_ACCOUNT_PROVIDER: 'repository', GCSP_SCENARIO_PROVIDER: 'none', GCSP_ORDERING_PROVIDER: ORDERING_OUTCOME === 'synthetic' ? 'synthetic' : 'remote', GCSP_RESET_ALLOWED: 'true',
    ...(ORDERING_OUTCOME === 'synthetic' ? {} : { GCSP_ORDERING_EXECUTE_URL: `https://127.0.0.1:${PORTS.idp}/proof-ordering/execute`, GCSP_ORDERING_RECONCILE_URL: `https://127.0.0.1:${PORTS.idp}/proof-ordering/reconcile`, GCSP_ORDERING_TOKEN: ORDERING_TOKEN, GCSP_ORDERING_TIMEOUT: '5s' }),
    GCSP_BUDDY_PROVIDER: 'local-synthetic', GCSP_CLAIM_STOCK_PROVIDER: 'local',
    GCSP_SUPPLY_PROVIDER: 'tranche-plan', GCSP_SUPPLY_TRANCHE_PLAN_FILE: TRANCHE_PLAN,
    GCSP_SUPPLY_POLICY_FILE: path.join(ROOT, 'services/gcsp-api/src/test/resources/supply/policy.json'),
    GCSP_ALLOCATION_CANDIDATES_PROVIDER: 'recommendation',
    GCSP_DATABASE_PASSWORD: process.env.PROOF_DB_PASSWORD ?? '',
    GCSP_CLAIMS_SWEEP_INTERVAL: '10m', GCSP_NOTIFY_DRAIN_INTERVAL: '1s', GCSP_PUBLIC_BASE_URL: PUBLIC_BASE_URL,
    GCSP_DATABASE_URL: DB_URL, GCSP_DATABASE_USER: process.env.PROOF_DB_USER ?? 'gcsp', GCSP_EXPECTED_DATABASE: DB_NAME };
}
let api = null; let apiStarts = 0;
async function startApi() {
  apiStarts++;
  const name = `api-${apiStarts}`;
  const props = [`-Dquarkus.datasource.jdbc.additional-jdbc-properties.currentSchema=${SCHEMA}`, `-Dquarkus.flyway.schemas=${SCHEMA}`, `-Dquarkus.flyway.default-schema=${SCHEMA}`];
  api = spawnOwned(name, path.join(JAVA_HOME, 'bin/java'), [`-Djavax.net.ssl.trustStore=${tls.trust}`, `-Djavax.net.ssl.trustStorePassword=${TRUST_PASS}`, `-Djava.io.tmpdir=${dirs.tmp}`, ...props, '-Dgcsp.allocation.candidates.provider=recommendation', '-jar', JAR], apiEnv(), PORTS.api);
  for (let i = 0; ; i++) {
    if (api.done) { receipt.failureLogs[name] = tail(api.logFile); throw new Error(`${name} exited during startup`); }
    try { const r = await request('GET', '/context'); if (r.status === 401) break; } catch { /* not up yet */ }
    if (i > 240) { receipt.failureLogs[name] = tail(api.logFile); throw new Error(`${name} did not become ready`); }
    await sleep(500);
  }
  log(`${name} ready on ${ORIGINS.api}`);
}
async function stopApi() { await api.stop(); log(`api-${apiStarts} stopped (exit ${api.exitCode ?? api.signalCode})`); }

// ---------- direct HTTPS setup, authority controls and current server truth ----------
function request(method, p, headers = {}, body = null) {
  const u = new URL(ORIGINS.api);
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port: Number(u.port), path: `${API_PATH}${p}`, method, servername: u.hostname, headers: { Host: u.host, Accept: 'application/json', ...headers }, ca: tls.ca, timeout: 15000 }, (res) => {
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
  const plan = { label: 'TEST FIXTURE Buddy journey; not actual stock evidence', version: 'f451-connected-v1', windows: [{ windowId: 'f451-w1', availableAt: new Date(now - 86400000).toISOString(), supplyId: null,
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
// DOM-only selectors follow the offer components and shared portal shell.
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rolesFor = (person) => CONTROL_ROLES[person] ?? ['employee'];
const command = () => `f451-${RUN_TOKEN}-${randomBytes(6).toString('hex')}`;
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
const check = (s, name, passed) => { s.checks[name] = passed === true; if (!passed) throw new Error(name); };
async function scenario(id, title, ac, fn) {
  const s = { title, ac, pass: false, checks: {}, observations: {} }; receipt.scenarios[id] = s; log(`scenario ${id}: ${title}`);
  try { await fn(s); } catch (e) { s.error = e.message; s.checks.noException = false; }
  s.pass = Object.keys(s.checks).length > 0 && Object.values(s.checks).every(v => v === true);
  writeFileSync(path.join(dirs.evidence, `checkpoint-${id}.json`), JSON.stringify(s, null, 2));
  if (!s.pass) throw new Error(`Offer scenario ${id} failed: ${s.error ?? 'failed assertion'}`);
}
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
async function snapshot(page, s, name) {
  const dom = await page.act(`return { text: text(), title: main.querySelector('h1')?.textContent?.trim(), overflow: document.documentElement.scrollWidth > innerWidth + 1, modal: !!document.querySelector('dialog[open]'), csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'), focus: document.activeElement?.outerHTML?.slice(0, 240), actions: [...main.querySelectorAll('[data-offer-action]')].map(b => ({ action: b.dataset.offerAction, disabled: b.disabled })), dialogs: [...document.querySelectorAll('dialog[open]')].map(d => ({ modal: d.matches(':modal'), focusedInside: d.contains(document.activeElement), text: d.textContent.replace(/\s+/g, ' ').trim() })) };`);
  s.observations[name] = { dom, screenshot: await page.shot(`${name}.png`) };
  check(s, `${name}: no horizontal overflow`, !dom.overflow);
  check(s, `${name}: no JavaScript exception`, page.errors.length === 0);
  return dom;
}
async function waitPost(page, from, endpoint) {
  const end = Date.now() + 20000;
  while (Date.now() < end) { await page.settle(); const sent = page.calls(from).filter(e => e.method === 'POST' && e.path === endpoint); if (sent.some(e => e.response !== undefined || e.failed)) return sent; await sleep(100); }
  throw new Error(`No completed browser POST ${endpoint}`);
}
async function inspection(cdp, s, pages) {
  const page = await newPage(cdp, 'presenter outbox'); pages.presenter = page;
  await signIn(page, 'presenter');
  await page.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/presenter/outbox` });
  await page.until(`return !!$('.gcsp-mail-row') && text().includes('Captured, not sent');`, 30000, 'actual captured outbox');
  const truth = await value('presenter', '/presenter/outbox');
  s.observations.authoritative = truth;
  check(s, 'actual captured notification rows exist', truth.runId === RUN_ID && truth.messages.length >= 2 && truth.messages.every(m => m.transport === 'captured' && m.state === 'sent'));
  const current = truth.messages.find(m => m.recipient?.employeeId === 'employee-paula');
  check(s, 'new captured link identifies actual allocated offer', !!current?.offerLink && decodeURIComponent(new URL(current.offerLink).pathname.split('/').at(-1)) === offers.paula);
  receipt.capturedLink = { jobId: current.jobId, offerId: offers.paula, url: current.offerLink, deliveredToInbox: false };
  check(s, 'safe projection omits private transport and addresses', truth.messages.every(m => !('payload' in m) && !('providerId' in m) && !('address' in (m.recipient ?? {}))));
  await snapshot(page, s, 'outbox-desktop');
  await page.act(`setValue('#outbox-recipient', 'employee-paula');`);
  await page.until(`return document.querySelectorAll('.gcsp-mail-row').length === 1;`, 5000, 'actual recipient filter');
  check(s, 'recipient filter preserves actual context', await page.act(`return $('#outbox-recipient').value === 'employee-paula' && $('.gcsp-mail-line').textContent.includes(${JSON.stringify(current.recipient.name)});`));
  check(s, 'kind and state filters use returned facts', await page.act(`return setValue('#outbox-kind', ${JSON.stringify(current.messageKind)}) && setValue('#outbox-state', 'sent');`));
  await page.until(`return $('#outbox-state')?.value === 'sent' && $('#outbox-kind')?.value === ${JSON.stringify(current.messageKind)} && document.querySelectorAll('.gcsp-mail-row').length === 1;`, 5000, 'filters settled before keyboard trial');
  await page.send('Page.bringToFront');
  await page.act(`$('.gcsp-mail-row').focus();`);
  await page.until(`return document.activeElement?.classList.contains('gcsp-mail-row');`, 5000, 'row has native keyboard focus');
  s.observations.keyboardBefore = await page.act(`return { active: document.activeElement?.outerHTML?.slice(0, 500), rowFocused: document.activeElement === $('.gcsp-mail-row'), selected: $('.gcsp-mail-row')?.getAttribute('aria-current') };`);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  try { await page.until(`return document.activeElement?.classList.contains('gcsp-mail-heading');`, 5000, 'keyboard row selection focus'); }
  finally { s.observations.keyboardAfter = await page.act(`return { active: document.activeElement?.outerHTML?.slice(0, 500), headingFocused: document.activeElement === $('.gcsp-mail-heading') };`); }
  check(s, 'preview is sandboxed without authority', await page.act(`const f = $('iframe'); return f?.getAttribute('sandbox') === '' && f.getAttribute('referrerpolicy') === 'no-referrer';`));
  check(s, 'deployed CSP forbids inline business script and eval', await page.eval(`(() => { const c = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''; return /script-src 'self'(?:;|$)/.test(c) && !c.includes('unsafe-eval'); })()`));
  check(s, 'capture explicitly denies email delivery', await page.act(`return text().includes('Captured, not sent') && text().includes('No email has been sent');`));
  const before = page.calls().length;
  await page.act(`return press('Refresh');`);
  await page.until(`return !!$('.gcsp-mail-row') && $('#outbox-recipient')?.value === 'employee-paula' && $('#outbox-state')?.value === 'sent' && $('#outbox-kind')?.value === ${JSON.stringify(current.messageKind)};`, 10000, 'refresh retains filters');
  await page.settle();
  check(s, 'outbox interactions issue signed reads without selectors or commands', page.calls().filter(e => e.path === '/presenter/outbox').every(e => e.method === 'GET' && e.auth && !e.query) && !page.calls(before).some(e => e.method === 'POST'));
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
  check(s, 'reduced motion preference reaches browser', await page.eval(`matchMedia('(prefers-reduced-motion: reduce)').matches`));
  await snapshot(page, s, 'outbox-narrow-reduced-motion');
  // Supplemental viewport capture paints the nested preview after it enters the visible viewport.
  await page.act(`$('iframe').scrollIntoView({ block: 'center' });`);
  await page.settle();
  await page.eval(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const previewShot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const previewFile = path.join(dirs.evidence, 'outbox-narrow-preview-viewport.png');
  writeFileSync(previewFile, Buffer.from(previewShot.data, 'base64'));
  s.observations.narrowPreviewViewport = { screenshot: previewFile, scroll: await page.eval(`({ x: scrollX, y: scrollY })`) };
  await page.act(`setValue('#outbox-kind', ''); setValue('#outbox-state', ''); setValue('#outbox-recipient', '');`);
  s.observations.reads = page.calls().map(({method,path,query,auth,status}) => ({method,path,query,auth,status}));
  await page.close();
}
async function refusals(cdp, s) {
  const anonymous = await newPage(cdp, 'anonymous outbox');
  await anonymous.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/presenter/outbox` });
  await anonymous.until(`return !!button('Sign in');`, 15000, 'anonymous route sign-in guard');
  check(s, 'anonymous route makes no private outbox read', !anonymous.calls().some(e => e.path === '/presenter/outbox') && await anonymous.act(`return !$('.gcsp-mail-row');`));
  await snapshot(anonymous, s, 'outbox-anonymous-signin');
  await anonymous.close();
  check(s, 'anonymous API is refused', (await request('GET', '/presenter/outbox')).status === 401);
  for (const person of ['paula', 'greg']) {
    check(s, `${person} outbox API is refused`, (await call(person, '/presenter/outbox')).status === 403);
    const page = await newPage(cdp, `${person} forbidden outbox`);
    await signIn(page, person);
    await page.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/presenter/outbox` });
    await page.until(`return !!$('gcsp-status-screen') && !text().includes('Loading');`, 15000, 'role route refusal');
    check(s, `${person} route exposes no captured messages`, await page.act(`return !$('.gcsp-mail-row') && !$('.gcsp-mail-detail');`));
    await snapshot(page, s, `outbox-${person}-refused`);
    await page.close();
  }
  check(s, 'query selectors refused by API', (await call('presenter', '/presenter/outbox?state=sent')).status === 400);
  check(s, 'presenter employee action is refused', (await call('presenter', '/manual/notification-email', { commandId: command(), expectedVersion: 0, deliveryEmail: 'control@example.test' })).status === 403);
}
async function offerReturn(cdp, s) {
  const owner = await newPage(cdp, 'signed-out captured offer return');
  await deepLinkLogin(owner, 'paula', offers.paula);
  await owner.until(`return !!$('[data-offer-action="accept"]') && text().includes('Your offer');`, 30000, 'owned offer after local OIDC');
  const truth = await value('paula', offerPath(offers.paula));
  await owner.settle();
  const read = owner.calls().find(e => e.path === offerPath(offers.paula) && e.status === 200);
  check(s, 'signed owned offer matches newly captured link', !!read?.auth && read.response?.value?.offerId === offers.paula && truth.state === 'pending');
  check(s, 'pinned vehicle displayed', await owner.act(`return text().includes(${JSON.stringify(truth.quote.facts.display.name)});`));
  await snapshot(owner, s, 'offer-owned-desktop');
  await owner.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
  await snapshot(owner, s, 'offer-owned-narrow');
  await owner.close();
  const wrong = await newPage(cdp, 'wrong account captured offer return');
  await deepLinkLogin(wrong, 'carla', offers.paula);
  await wrong.until(`return !!$('gcsp-status-screen') && !text().includes('Loading');`, 20000, 'wrong account refusal');
  await wrong.settle();
  check(s, 'wrong account API and rendered refusal', wrong.calls().some(e => e.path === offerPath(offers.paula) && e.status === 403) && await wrong.act(`return !$('[data-offer-action]') && !text().includes(${JSON.stringify(truth.quote.facts.display.name)});`));
  await snapshot(wrong, s, 'offer-wrong-account');
  await wrong.close();
  check(s, 'inspection and returns made no employee decisions', ![owner,wrong].some(p => p.calls().some(e => e.method === 'POST')) && (await value('paula', offerPath(offers.paula))).state === 'pending');
  s.observations.linkMapping = { source: receipt.capturedLink.url, localBrowserTarget: offerUrl(offers.paula), basis: 'Same newly generated offer path on owned local frontend; hosted email topology and inbox are unrun.' };
}

function accessLog() {
  const rows = [];
  for (const p of receipt.processes.filter((x) => x.name.startsWith('api-'))) {
    for (const l of tail(path.join(dirs.logs, `${p.name}.log`), 100000).split('\n')) { const m = /ACCESSLOG (\S+) (\S+) (\d+)/.exec(l); if (m && (/\/(offers|offer-followup|manual|ordering|context|presenter)/.test(m[2]))) rows.push(`${p.name} ${m[1]} ${m[2].replace(API_PATH, '')} ${m[3]}`); }
  }
  return rows.slice(-80);
}
async function main() {
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  for (const [k, p] of Object.entries(PORTS)) if (!(await portFree(p))) throw new Error(`port ${p} (${k}) is in use; choose PROOF_${k.toUpperCase()}_PORT`);
  receipt.inputs = { scratch: PROOF, publicMailBaseUrl: PUBLIC_BASE_URL, database: { source: DB_SOURCE, host: DB[1], port: DB[2] ?? '5432', name: DB_NAME, schema: SCHEMA }, ports: PORTS, jar: { path: path.relative(ROOT, JAR), sha256: sha256File(JAR) },
    appJars: readdirSync(path.join(path.dirname(JAR), 'app')).filter((f) => f.endsWith('.jar')).map((f) => ({ file: f, sha256: sha256File(path.join(path.dirname(JAR), 'app', f)) })), psql: { path: PSQL, sha256: sha256File(PSQL) }, media: MEDIA_FILES.map((name) => ({ name, sha256: sha256File(path.join(MEDIA_ROOT, name)) })), webBrowser: { path: path.relative(ROOT, WEB_BROWSER), indexSha256: sha256File(path.join(WEB_BROWSER, 'index.html')) } };
  receipt.composition = { identity: 'oidc (local test issuer)', subjects: PEOPLE.map((p) => ({ subject: `sub-${p}`, employeeId: `employee-${p}` })), account: 'repository', scenario: 'none; explicit BuddyJourneySeed-equivalent source records', ordering: ORDERING_OUTCOME, allocation: 'recommendation / local-synthetic Buddy', resetAllowed: true, environmentId: ENVIRONMENT_ID, runId: RUN_ID, policyVersion: POLICY, mirrors: 'BuddyJourneySeed; source-only owned-schema fixtures, real services produce all business outcomes' };
  receipt.sourceRevision = { value: SOURCE_REVISION, provenance: 'PROOF_SOURCE_REVISION supplied and verified by the parent; not read from git here' };
  receipt.tools = { harnessNode: process.version, openssl: cap('openssl', ['version']), chrome: cap(CHROME, ['--version']), java: (spawnSync(path.join(JAVA_HOME, 'bin/java'), ['-version'], { encoding: 'utf8', env: childEnv(process.env) }).stderr ?? '').split('\n')[0] };
  await runOnce('database-version', PSQL, ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-h', DB[1].replace(/[\[\]]/g, ''), '-p', DB[2] ?? '5432', '-U', process.env.PROOF_DB_USER ?? 'gcsp', '-d', DB_NAME, '-c', 'SHOW server_version_num'], { PATH: process.env.PATH, HOME: process.env.HOME, PGCONNECT_TIMEOUT: '10', PGPASSWORD: process.env.PROOF_DB_PASSWORD ?? '' }, 15000);
  await owned.at(-1).logClosed;
  const serverVersion = readFileSync(path.join(dirs.logs, 'database-version.log'), 'utf8').trim();
  if (!/^17[0-9]{4}$/.test(serverVersion)) throw new Error(`Owned database must be native PostgreSQL 17; server_version_num=${serverVersion.slice(0,20)}`);
  receipt.inputs.database.serverVersionNum = serverVersion;
  writePlan();
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
  await scenario('empty', 'Actual empty current-run outbox before allocation', 'AC1', async s => {
    const page = await newPage(cdp, 'empty outbox');
    await signIn(page, 'presenter');
    await page.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/presenter/outbox` });
    await page.until(`return text().includes('No emails yet');`, 15000, 'actual empty outbox');
    check(s, 'actual Java empty read agrees with screen', (await value('presenter', '/presenter/outbox')).messages.length === 0);
    await snapshot(page, s, 'outbox-empty-desktop');
    await page.close();
  });
  log('seed upstream sources, then actual Buddy allocation and capture'); await seedSources();
  await scenario('inspection', 'Actual Java outbox capture, recipient and supported local filters', 'AC1', s => inspection(cdp, s, pages));
  await scenario('refusals', 'Presenter inspection does not grant employee authority', 'AC1', s => refusals(cdp, s));
  await scenario('offer-return', 'New captured offer link returns through local signed OIDC; wrong owner refused', 'AC2 partial', s => offerReturn(cdp, s));

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
  receipt.orderingSubstitute = { outcome: ORDERING_OUTCOME, requests: orderingRequests };
  receipt.originalAcceptance = {
    AC1: { text: 'Authorized inspection shows actual recipient, delivery/capture state and supported filters without employee authority.', localEvidence: ok('inspection') && ok('refusals') ? 'pass' : 'incomplete', closure: 'OPEN: applicable WebKit/hosted proof and review remain' },
    AC2: { text: 'A newly delivered test email opens the correct replacement offer through sign-in/ownership; wrong account refused.', localEvidence: ok('offer-return') ? 'partial' : 'incomplete', closure: 'OPEN: no actual inbox delivery or hosted test identity provider; captured link only' } };
  receipt.overall = ['empty', 'inspection', 'refusals', 'offer-return'].every(ok) && !runError && !logLimitFailure && receipt.teardown?.allOwnedExited ? 'PASS' : 'FAIL';
  const file = path.join(dirs.evidence, 'connected-outbox-proof.json');
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
