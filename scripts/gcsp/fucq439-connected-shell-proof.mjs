#!/usr/bin/env node
// FUCQ-439 connected proof: built Angular shell (login, role landing, direct entry, refresh, denied/unavailable, renewal, recovery, sign-out)
// against a LOCAL MOCK OIDC ISSUER, the started Java API and native PG17. Derived from fucq447/fucq443. Never builds; the parent supplies inputs.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, createSign, createVerify, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:https';
import https from 'node:https';
import net from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, createWriteStream, lstatSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { apiJvmArgs, jvmLimitsReceipt } from './proof-jvm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const refuse = (why) => { console.error(`REFUSED: ${why}`); process.exit(2); };

// ---------- required inputs (refuse rather than invent) ----------
function localInput(input) {
  let pending = path.resolve(input).split(path.sep).filter(Boolean); let resolved = path.sep; let links = 0;
  while (pending.length) {
    const next = path.join(resolved, pending.shift());
    if (/CloudStorage|OneDrive/i.test(next)) refuse('Input resolves into a forbidden synced location');
    let item; try { item = lstatSync(next); } catch (e) { if (e.code === 'ENOENT') return path.join(next, ...pending); throw e; }
    if (item.isSymbolicLink()) {
      if (++links > 32) refuse('Input has too many symbolic links');
      const target = path.resolve(path.dirname(next), readlinkSync(next));
      if (/CloudStorage|OneDrive/i.test(target)) refuse('Input link targets a forbidden synced location');
      pending = [...target.split(path.sep).filter(Boolean), ...pending]; resolved = path.sep;
    } else resolved = next;
  }
  return resolved;
}
const RAW_SCRATCH = process.env.SCRATCH ?? '';
if (!RAW_SCRATCH) refuse('SCRATCH is not set; the parent must supply an owned local scratch directory');
if (/CloudStorage|OneDrive/i.test(RAW_SCRATCH)) refuse('SCRATCH points into a cloud-synced folder; never used');
if (!path.isAbsolute(RAW_SCRATCH)) refuse('SCRATCH must be an absolute path');
const SCRATCH = localInput(RAW_SCRATCH);
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
const PROOF = path.join(SCRATCH, `fucq439-connected-${RUN_TOKEN}`);
if (existsSync(PROOF)) refuse(`${PROOF} already exists; each run needs a fresh token`);
const JAVA_HOME = localInput(process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home');
const CHROME = localInput(process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const JAR = localInput(process.env.PROOF_API_JAR ?? path.join(ROOT, 'services/gcsp-api/target/quarkus-app/quarkus-run.jar'));
const WEB_BROWSER = localInput(process.env.PROOF_WEB_BROWSER ?? path.join(ROOT, 'apps/gcsp-web/dist/gcsp-web/browser'));
for (const [label, file] of [['API jar (prebuilt)', JAR], ['compiled web index (prebuilt)', path.join(WEB_BROWSER, 'index.html')], ['java', path.join(JAVA_HOME, 'bin/java')], ['keytool', path.join(JAVA_HOME, 'bin/keytool')], ['Chrome', CHROME]]) {
  if (/CloudStorage|OneDrive/i.test(file)) refuse(`${label} points into a forbidden synced folder`);
  if (!existsSync(file)) refuse(`${label} not found at ${file}`);
}
const port = (name, fallback) => { const v = Number(process.env[name] ?? fallback); if (!Number.isInteger(v) || v < 1024 || v > 65535) refuse(`${name} must be a port number`); return v; };
const PORTS = { web: port('PROOF_WEB_PORT', 7439), api: port('PROOF_API_PORT', 8439), idp: port('PROOF_IDP_PORT', 9439) };
if (new Set(Object.values(PORTS)).size !== 3) refuse('Proof ports must be distinct');
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
const ENVIRONMENT_ID = `f439-connected-${RUN_TOKEN}`;
const RUN_ID = 'run-1';
const POLICY = 'gcsp-policy-v1';
const PEOPLE = ['paula'];
const CONTROL_ROLES = { greg: ['greg'], presenter: ['presenter'] };
const SHORT_LIFETIME = Number(process.env.PROOF_SHORT_LIFETIME_SEC ?? 25);
if (!Number.isInteger(SHORT_LIFETIME) || SHORT_LIFETIME < 15 || SHORT_LIFETIME > 120) refuse('PROOF_SHORT_LIFETIME_SEC must be an integer in [15, 120]');
const API_JVM_ARGS = apiJvmArgs();
// Stable exact-stock identities, isolated by this proof's environment/run and schema.
const STOCK_IDS = [1, 2, 3, 4].map((n) => `00000000-0439-4000-8000-${String(n).padStart(12, '0')}`);
const CAR = { paula: STOCK_IDS[0] };
const carNumber = (id) => String(4390001 + STOCK_IDS.indexOf(id));
const PSQL = localInput(process.env.PROOF_PSQL_BIN ?? '/opt/homebrew/opt/postgresql@17/bin/psql');
const MEDIA_ROOT = localInput(process.env.PROOF_MEDIA_ROOT ?? path.join(ROOT, 'assets/gcsp-vehicle-evidence'));
const MEDIA_FILES = ['07c269dd7f55fad0a56bbad65ae72f7c35defc5e8883a8290a82972e1defb427.webp', 'ed60cefd049e7293423575b5f0fcee802dbab14083dea2480211ab272896281a.webp',
  'bd89864616f3f34813cb66230e93f5e39d6a25168331ea47e84da60fbf31a735.webp', 'c1a3b0f2df9a6c3834cd04fc8f65455e6daa8fda9e7bf0f7a9c9e5e437ec8318.webp'];
for (const file of [PSQL, MEDIA_ROOT, JAR, WEB_BROWSER, JAVA_HOME, CHROME]) if (/CloudStorage|OneDrive/i.test(file)) refuse('An input path points into a forbidden synced folder');
if (!existsSync(PSQL)) refuse('PROOF_PSQL_BIN must name the parent-pinned native PostgreSQL 17 psql');
for (const name of MEDIA_FILES) if (!existsSync(path.join(MEDIA_ROOT, name))) refuse(`Missing parent-pinned actual media ${name}`);
if (!Number.isFinite(DEADLINE_MS) || DEADLINE_MS <= 45000 || DEADLINE_MS > 600000) refuse('PROOF_DEADLINE_SEC and remaining absolute deadline must be in (45, 600] including cleanup reserve');
const SCHEMA = `gcsp_s_f439c_${RUN_TOKEN.replace(/-/g, '_')}`;
const dirs = { logs: path.join(PROOF, 'logs'), tmp: path.join(PROOF, 'tmp'), certs: path.join(PROOF, 'certs'), static: path.join(PROOF, 'static'), browser: path.join(PROOF, 'browser'), evidence: path.join(PROOF, 'evidence') };

const receipt = { schema: 'fucq439-connected-shell-proof/1', story: 'DEV-2026-11-13-007 / FUCQ-439', startedAt: new Date().toISOString(), deadlineSeconds: DEADLINE_MS / 1000, cleanupReserveSeconds: 45, runToken: RUN_TOKEN, origins: ORIGINS,
  localTestIssuer: `LOCAL MOCK OIDC ISSUER ${ISSUER}: sign-on is mocked for this PoC (decision 2026-11-18); no real provider is used`, composition: null, inputs: null, tools: {}, processes: [], scenarios: {}, originalAcceptance: null, failureLogs: {}, issuerPolicyLog: [],
  limitations: [
    'The parent supplies prebuilt production web/API; input hashes do not independently establish their source revision.',
    'Every sign-on item is proved against a local mock issuer (code/PKCE, refresh grant, provider session cookie, end-session). The real hosted provider is not exercised.',
    'Access-token lifetime and refresh-token issue are issuer policy changed between scenarios, so expiry is real (short lifetime) rather than simulated in the browser.',
    'Only the upstream account, stock and one saved draft are seeded through Java and the run-owned schema; the unfinished order is made through the Angular controls.',
    'GET /context carries no displayName; the mock id_token supplies name and email for paula and greg and none for the presenter, so the header name comes from the Angular profile fallback.',
    'Chrome only, desktop viewport 1280x800; Safari and hosted deployment remain unrun.',
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
const SUPERVISOR_MARKERS = ['F439_LOCAL_TOKEN', 'TEST_RESOURCE_PARENT_RESERVATION', 'PROOF_RUN_TOKEN', 'PROOF_ABSOLUTE_DEADLINE_MS'];
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

// ---------- LOCAL MOCK OIDC issuer: code/PKCE, refresh grant, provider session cookie, end-session, request log ----------
const SUBJECT_ROLES = { 'sub-paula': ['employee'], 'sub-greg': ['greg'], 'sub-presenter': ['presenter'] };
// The presenter has no name claim on purpose, to prove the header fallback.
const PROFILES = { 'sub-paula': { name: 'Paula Mason', email: 'paula.mason@gcsp-demo.com' }, 'sub-greg': { name: 'Greg Lawson', email: 'greg.lawson@gcsp-demo.com' } };
const SESSION_COOKIE = 'gcsp_idp_sid';
const COOKIE_PATH = '/realms/gcsp-local/';
const POST_LOGOUT = `${ORIGINS.web}/gcsp/`;
const idp = { codes: new Map(), txns: new Map(), refresh: new Map(), sessions: new Map(), requests: [], policy: { lifetimeSec: 3600, refresh: true }, subjects: SUBJECT_ROLES, keys: null, server: null };
// The proof changes issuer policy between scenarios; each change is receipted.
function setPolicy(change) { Object.assign(idp.policy, change); receipt.issuerPolicyLog.push({ at: new Date().toISOString(), ...idp.policy }); }
function newKeys() { const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }); return { privateKey, publicKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' } }; }
function signJwt(payload, key) {
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID })); const body = b64u(JSON.stringify(payload));
  return `${head}.${body}.${b64u(createSign('RSA-SHA256').update(`${head}.${body}`).sign(key))}`;
}
function verifyJwt(token, publicKey) {
  const parts = String(token ?? '').split('.'); if (parts.length !== 3) return null;
  try {
    if (!createVerify('RSA-SHA256').update(`${parts[0]}.${parts[1]}`).verify(publicKey, Buffer.from(parts[2], 'base64url'))) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch { return null; }
}
function accessClaims(sub, roles, lifetimeSec = 3600) {
  const now = Math.floor(Date.now() / 1000);
  return { iss: ISSUER, aud: ['gcsp-api'], azp: 'gcsp-web', scope: 'openid profile gcsp-api', sub, realm_access: { roles }, iat: now, exp: now + lifetimeSec, jti: randomBytes(8).toString('hex') };
}
const cookieSid = (req) => /(?:^|;\s*)gcsp_idp_sid=([0-9a-f]+)/.exec(req.headers.cookie ?? '')?.[1] ?? null;
const lastIdp = (from, filter) => idp.requests.slice(from).filter(filter);
function startIdp(tls) {
  idp.keys = newKeys();
  const base = '/realms/gcsp-local'; const oidc = `${base}/protocol/openid-connect`;
  const meta = { issuer: ISSUER, authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`, token_endpoint: `${ISSUER}/protocol/openid-connect/token`, jwks_uri: `${ISSUER}/protocol/openid-connect/certs`, end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`, response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], grant_types_supported: ['authorization_code', 'refresh_token'], scopes_supported: ['openid', 'profile', 'gcsp-api'] };
  const cors = (req, res) => { if (req.headers.origin === ORIGINS.web) { res.setHeader('Access-Control-Allow-Origin', ORIGINS.web); res.setHeader('Vary', 'Origin'); } };
  const json = (req, res, code, obj) => { cors(req, res); res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const text = (res, code, body, type = 'text/plain') => { res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(body); };
  const note = (entry) => { const row = { seq: idp.requests.length, at: Date.now(), ...entry }; idp.requests.push(row); return row; };
  const issue = (subject, { nonce, authTime, sid }) => {
    const now = Math.floor(Date.now() / 1000); const lifetime = idp.policy.lifetimeSec;
    const idToken = signJwt({ iss: ISSUER, sub: subject, aud: 'gcsp-web', azp: 'gcsp-web', iat: now, exp: now + 300, auth_time: authTime, sid, ...PROFILES[subject], ...(nonce ? { nonce } : {}) }, idp.keys.privateKey);
    const access = signJwt(accessClaims(subject, SUBJECT_ROLES[subject], lifetime), idp.keys.privateKey);
    const body = { access_token: access, token_type: 'Bearer', expires_in: lifetime, scope: 'openid profile gcsp-api', id_token: idToken };
    if (idp.policy.refresh) { const rt = randomBytes(24).toString('hex'); idp.refresh.set(rt, { subject, sid, authTime, used: false }); body.refresh_token = rt; }
    return { body, summary: { subject, lifetimeSec: lifetime, expiresAt: Date.now() + lifetime * 1000, refreshIssued: !!body.refresh_token, accessSha: createHash('sha256').update(access).digest('hex').slice(0, 12) } };
  };
  idp.server = createServer({ key: tls.key, cert: tls.cert }, async (req, res) => {
    const url = new URL(req.url, ISSUER);
    const form = async () => { const chunks = []; for await (const ch of req) chunks.push(ch); return new URLSearchParams(Buffer.concat(chunks).toString()); };
    if (req.method === 'OPTIONS') { cors(req, res); res.writeHead(204, req.headers.origin === ORIGINS.web ? { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Accept', 'Access-Control-Max-Age': '600' } : {}); return res.end(); }
    if (url.pathname === `${base}/.well-known/openid-configuration`) return json(req, res, 200, meta);
    if (url.pathname === `${oidc}/certs`) return json(req, res, 200, { keys: [idp.keys.jwk] });
    if (url.pathname === `${oidc}/auth` && req.method === 'GET') {
      const q = url.searchParams;
      const row = note({ path: 'auth', method: 'GET', prompt: q.get('prompt'), cookie: idp.sessions.has(cookieSid(req) ?? '') });
      if (q.get('client_id') !== 'gcsp-web' || q.get('redirect_uri') !== `${ORIGINS.web}/gcsp/auth/callback` || q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || !q.get('state')) { row.status = 400; return text(res, 400, 'invalid_request'); }
      const txn = randomBytes(12).toString('hex');
      idp.txns.set(txn, { redirectUri: q.get('redirect_uri'), challenge: q.get('code_challenge'), state: q.get('state'), nonce: q.get('nonce') });
      const buttons = Object.keys(idp.subjects).map((s) => `<p><button type="submit" name="subject" value="${s}" data-subject="${s}">Sign in as ${s}</button></p>`).join('');
      row.status = 200;
      return text(res, 200, `<!doctype html><title>Local mock issuer</title><h1>LOCAL MOCK ISSUER (not the real provider)</h1><p>Choose an account</p><form method="post" action="${oidc}/auth"><input type="hidden" name="txn" value="${txn}">${buttons}</form>`, 'text/html');
    }
    if (url.pathname === `${oidc}/auth` && req.method === 'POST') {
      const f = await form(); const t = idp.txns.get(f.get('txn')); idp.txns.delete(f.get('txn'));
      const row = note({ path: 'auth', method: 'POST', subject: f.get('subject'), cookie: idp.sessions.has(cookieSid(req) ?? '') });
      if (!t || !idp.subjects[f.get('subject')]) { row.status = 400; return text(res, 400, 'invalid_request'); }
      const old = cookieSid(req); if (old) idp.sessions.delete(old);
      const sid = randomBytes(16).toString('hex'); const authTime = Math.floor(Date.now() / 1000);
      idp.sessions.set(sid, { subject: f.get('subject'), authTime });
      const code = randomBytes(16).toString('hex'); idp.codes.set(code, { ...t, subject: f.get('subject'), sid, authTime });
      const target = new URL(t.redirectUri); target.searchParams.set('code', code); target.searchParams.set('state', t.state);
      row.status = 302; row.setCookie = true;
      res.writeHead(302, { Location: target.href, 'Cache-Control': 'no-store', 'Set-Cookie': `${SESSION_COOKIE}=${sid}; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax` }); return res.end();
    }
    if (url.pathname === `${oidc}/token` && req.method === 'POST') {
      const f = await form(); const grant = f.get('grant_type');
      const row = note({ path: 'token', method: 'POST', grantType: grant });
      if (grant === 'authorization_code') {
        const c = idp.codes.get(f.get('code')); idp.codes.delete(f.get('code'));
        if (!c || f.get('client_id') !== 'gcsp-web' || f.get('redirect_uri') !== c.redirectUri || sha256b64u(f.get('code_verifier') ?? '') !== c.challenge) { row.status = 400; return json(req, res, 400, { error: 'invalid_grant' }); }
        const out = issue(c.subject, { nonce: c.nonce, authTime: c.authTime, sid: c.sid }); Object.assign(row, out.summary, { status: 200 });
        return json(req, res, 200, out.body);
      }
      if (grant === 'refresh_token') {
        const r = idp.refresh.get(f.get('refresh_token') ?? '');
        if (!r || r.used || f.get('client_id') !== 'gcsp-web' || !idp.sessions.has(r.sid)) { row.status = 400; row.rejected = !r ? 'unknown' : r.used ? 'reused' : 'client-or-session'; return json(req, res, 400, { error: 'invalid_grant' }); }
        r.used = true;
        const out = issue(r.subject, { authTime: r.authTime, sid: r.sid }); Object.assign(row, out.summary, { status: 200, rotated: out.summary.refreshIssued });
        return json(req, res, 200, out.body);
      }
      row.status = 400; return json(req, res, 400, { error: 'unsupported_grant_type' });
    }
    if (url.pathname === `${oidc}/logout` && req.method === 'GET') {
      const q = url.searchParams; const claims = verifyJwt(q.get('id_token_hint'), idp.keys.publicKey);
      const hintValid = !!claims && claims.iss === ISSUER && [claims.aud].flat().includes('gcsp-web');
      const redirectOk = q.get('post_logout_redirect_uri') === POST_LOGOUT;
      const presented = cookieSid(req);
      const row = note({ path: 'logout', method: 'GET', hintValid, hintSubject: claims?.sub ?? null, hintSid: claims?.sid ?? null, redirectUri: q.get('post_logout_redirect_uri'), redirectOk, cookie: idp.sessions.has(presented ?? ''), cookieMatchesHint: !!presented && presented === claims?.sid, sessionDeleted: false });
      if (!hintValid || !redirectOk) { row.status = 400; return text(res, 400, 'invalid_logout_request'); }
      row.sessionDeleted = idp.sessions.delete(claims.sid);
      for (const [token, r] of idp.refresh) if (r.sid === claims.sid) idp.refresh.delete(token);
      row.status = 302; row.cookieExpired = true;
      res.writeHead(302, { Location: POST_LOGOUT, 'Cache-Control': 'no-store', 'Set-Cookie': `${SESSION_COOKIE}=; Path=${COOKIE_PATH}; Max-Age=0; HttpOnly; Secure; SameSite=Lax` }); return res.end();
    }
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

// ---------- Java API (the real jar, repository accounts, native PG, synthetic ordering) ----------
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
    GCSP_CLAIMS_SWEEP_INTERVAL: '10m', GCSP_NOTIFY_DRAIN_INTERVAL: '10m', GCSP_PUBLIC_BASE_URL: PUBLIC_BASE_URL,
    GCSP_DATABASE_PASSWORD: process.env.PROOF_DB_PASSWORD ?? '', GCSP_DATABASE_URL: DB_URL, GCSP_DATABASE_USER: process.env.PROOF_DB_USER ?? 'gcsp', GCSP_EXPECTED_DATABASE: DB_NAME };
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
function request(method, p, headers = {}, body = null) {
  const u = new URL(ORIGINS.api);
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port: Number(u.port), path: `${API_PATH}${p}`, method, servername: u.hostname, headers: { Host: u.host, Accept: 'application/json', ...headers }, ca: tls.ca, timeout: 15000 }, (res) => {
      const chunks = []; let size = 0; res.on('data', (c) => { size += c.length; if (size > 2 * 1024 * 1024) return req.destroy(new Error('API response exceeded 2MiB')); chunks.push(c); });
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* not json */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('timeout', () => req.destroy(new Error('request timeout'))); req.on('error', reject); req.end(body === null ? undefined : JSON.stringify(body));
  });
}

// ---------- labelled API setup (signed, long-lived tokens) and server readback ----------
async function call(person, method, suffix, body = null) {
  const roles = SUBJECT_ROLES[`sub-${person}`];
  return request(method, suffix, { Authorization: `Bearer ${signJwt(accessClaims(`sub-${person}`, roles), idp.keys.privateKey)}`, ...(body === null ? {} : { 'Content-Type': 'application/json' }) }, body);
}
async function serverAccount(person = 'paula') {
  const r = await call(person, 'GET', '/manual/account');
  if (r.status !== 200 || r.json?.status !== 'ok') throw new Error(`server account read failed: ${r.status} ${r.json?.code ?? ''}`);
  return r.json.value;
}
const quoted = (value) => `'${String(value).replaceAll("'", "''")}'`;
const RUN_KEY = `environment_id = ${quoted(ENVIRONMENT_ID)} AND run_id = ${quoted(RUN_ID)}`;
let sqlCount = 0;
async function sql(statement) {
  await runOnce(`fixture-${++sqlCount}`, PSQL, ['-X', '-v', 'ON_ERROR_STOP=1', '-h', DB[1].replace(/[\[\]]/g, ''), '-p', DB[2] ?? '5432', '-U', process.env.PROOF_DB_USER ?? 'gcsp', '-d', DB_NAME, '-c', statement],
    { PATH: process.env.PATH, HOME: process.env.HOME, PGCONNECT_TIMEOUT: '10', PGPASSWORD: process.env.PROOF_DB_PASSWORD ?? '', PGOPTIONS: `-c search_path=${SCHEMA}` }, 30000);
}
function sqlOut(statement) {
  return cap(PSQL, ['-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q', '-h', DB[1].replace(/[\[\]]/g, ''), '-p', DB[2] ?? '5432', '-U', process.env.PROOF_DB_USER ?? 'gcsp', '-d', DB_NAME, '-c', statement],
    { env: childEnv({ PATH: process.env.PATH, HOME: process.env.HOME, PGCONNECT_TIMEOUT: '10', PGPASSWORD: process.env.PROOF_DB_PASSWORD ?? '', PGOPTIONS: `-c search_path=${SCHEMA}` }), timeout: 30000 });
}
function sqlJson(statement) { const out = sqlOut(statement); return out ? JSON.parse(out) : null; }
const dbOrders = (person) => sqlJson(`SELECT coalesce(json_agg(o ORDER BY o."operationId"), '[]'::json) FROM (
  SELECT s.operation_id AS "operationId", s.order_uuid AS "orderUuid", s.order_reference AS reference, p.state
  FROM selection_orders s JOIN pending_operations p USING (environment_id, run_id, operation_id)
  WHERE s.environment_id = ${quoted(ENVIRONMENT_ID)} AND s.run_id = ${quoted(RUN_ID)} AND s.employee_id = ${quoted(`employee-${person}`)}) o`);
const dbOrderCount = (person) => Number(sqlOut(`SELECT count(*) FROM selection_orders WHERE ${RUN_KEY} AND employee_id = ${quoted(`employee-${person}`)}`));
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
    contact: { phone: '01632 960000', email: `${person}.mason@gcsp-demo.com` }, expectedReturnMileage: replacement ? 20000 : null, specialRequirements: '' };
  const saved = await call(person, 'POST', '/manual/draft', { commandId: `f439-setup-${person}-${RUN_TOKEN}`, expectedDraftVersion: 0, expectedContextVersion: account.contextVersion, choices });
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
    const hatch = orderUuid === STOCK_IDS[1];
    row.configurationId = hatch ? 'F439-hatch-configuration' : 'F439-touring-configuration';
    const snapshot = row.facts;
    snapshot.sourceKeys.stockId = orderUuid; snapshot.snapshotVersion = `f439-snapshot-${i + 1}`;
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
    row.release.availability = { state: 'available', availableFrom: '2020-01-01T00:00:00.000Z', availableUntil: '2099-01-01T00:00:00.000Z', version: `f439-release-${i + 1}` };
    return row;
  });
  await sql(`BEGIN; DELETE FROM stock_cars WHERE ${RUN_KEY}; ${rows.map((row) => {
    const attributes = { ...row }; for (const key of ['orderUuid', 'configurationId', 'state', 'available', 'held', 'allocated', 'version']) delete attributes[key];
    return `INSERT INTO stock_cars (environment_id,run_id,order_uuid,configuration_id,state,attributes,version) VALUES (${quoted(ENVIRONMENT_ID)},${quoted(RUN_ID)},${quoted(row.orderUuid)},${quoted(row.configurationId)},'released',${quoted(JSON.stringify(attributes))}::jsonb,1);`;
  }).join('\n')} COMMIT;`);
  for (const person of PEOPLE) await seedDraft(person);
}
// Records only the scheme and a short hash of the bearer, never the token itself.
const bearer = (value) => (value ? { scheme: value.split(' ')[0], token: createHash('sha256').update(value.split(' ')[1] ?? '').digest('hex').slice(0, 12) } : {});
// ---------- own headless Chrome: actual API response capture, no business interception ----------
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else this.listeners.forEach((f) => f(m)); }); }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', () => j(new Error('CDP websocket failed'))); }); return new Cdp(ws); }
  send(method, params = {}, sessionId) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
}
const hdr = (h = {}, name) => Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1];
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
function requestSummary(b) { return b && typeof b === 'object' ? { ...b, carriesIdentity: /\"(employeeId|environmentId|principalId|subject)\"/.test(JSON.stringify(b)) } : null; }
const responseSummary = (body) => body;
class Page {
  constructor(cdp, sessionId, ctxId, label) { this.cdp = cdp; this.sid = sessionId; this.ctxId = ctxId; this.label = label; this.log = []; this.byId = new Map(); this.waits = []; this.mainFrame = null; this.mainLoader = null; this.docs = 0; this.errors = []; this.csp = []; this.urls = []; cdp.listeners.push((m) => m.sessionId === sessionId && this.event(m)); }
  send(method, params) { return this.cdp.send(method, params, this.sid); }
  event(m) {
    const p = m.params ?? {};
    if (m.method === 'Log.entryAdded') { if (p.entry?.level === 'error' && /content.security|content-security|\bcsp\b/i.test(p.entry?.text ?? '')) this.csp.push({ level: p.entry.level, text: p.entry.text }); return; }
    if (m.method === 'Runtime.exceptionThrown') { this.errors.push(p.exceptionDetails?.text ?? 'exception'); return; }
    // A new main-frame document bumps docs; API calls are tagged with the document generation that issued them.
    if (m.method === 'Page.frameNavigated' && !p.frame.parentId) { this.mainFrame = p.frame.id; this.mainLoader = p.frame.loaderId; this.docs++; this.urls.push(p.frame.url); return; }
    if (m.method === 'Page.navigatedWithinDocument' && p.frameId === this.mainFrame) { this.urls.push(p.url); return; }
    if (m.method === 'Network.requestWillBeSent') {
      if (!p.request.url.startsWith(ORIGINS.api)) return;
      const e = { id: p.requestId, at: Date.now(), method: p.request.method, path: new URL(p.request.url).pathname.replace(API_PATH, ''), query: new URL(p.request.url).search, auth: !!hdr(p.request.headers, 'authorization'), ...bearer(hdr(p.request.headers, 'authorization')),
        doc: p.frameId === this.mainFrame ? this.docs : null, loader: p.loaderId };
      if (p.request.postData) e.request = requestSummary(parse(p.request.postData));
      else if (p.request.hasPostData) this.waits.push(this.send('Network.getRequestPostData', { requestId: p.requestId }).then((r) => { e.request = requestSummary(parse(r.postData)); }).catch(() => {}));
      this.log.push(e); this.byId.set(p.requestId, e);
    } else if (m.method === 'Network.requestWillBeSentExtraInfo') {
      const e = this.byId.get(p.requestId); if (e && hdr(p.headers, 'authorization')) Object.assign(e, { auth: true }, bearer(hdr(p.headers, 'authorization')));
    } else if (m.method === 'Network.responseReceived') {
      const e = this.byId.get(p.requestId); if (e) e.status = p.response.status;
    } else if (m.method === 'Network.loadingFailed') {
      const e = this.byId.get(p.requestId); if (e) e.failed = p.errorText;
    } else if (m.method === 'Network.loadingFinished') {
      const e = this.byId.get(p.requestId);
      if (e && e.method !== 'OPTIONS') this.waits.push(this.send('Network.getResponseBody', { requestId: p.requestId }).then((r) => { e.response = responseSummary(parse(r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body)); }).catch(() => {}));
    }
  }
  async close() { try { await this.cdp.send('Target.disposeBrowserContext', { browserContextId: this.ctxId }); } catch { /* already closed */ } }
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
const heading = () => main.querySelector('h1')?.textContent.trim() ?? null;
const notice = () => main.querySelector(':scope > p[role="status"]')?.textContent.trim() ?? null;
const railItems = () => [...document.querySelectorAll('.gcsp-nav-item .gcsp-nav-label')].map((e) => e.textContent.trim());
const accountName = () => document.querySelector('.gcsp-account-name')?.textContent.trim() ?? null;
const oidcUsers = () => Object.keys(sessionStorage).filter((k) => k.startsWith('gcsp:oidc:user:')).length;
`;
const STOCK_READY = `return !!$('.gcsp-stock') && !!$('#stock-query') && !/Loading released cars/.test(text());`;
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

// ---------- sessions, sign-in flow and scenario framework ----------
const WEB = (p) => `${ORIGINS.web}${p}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function newPage(cdp, label) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, sessionId, browserContextId, label);
  await page.send('Page.enable'); await page.send('Emulation.setFocusEmulationEnabled', { enabled: true }); await page.send('Network.enable'); await page.send('Network.setCacheDisabled', { cacheDisabled: true }); await page.send('Runtime.enable'); await page.send('Log.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  return page;
}
const check = (s, name, passed) => { s.checks[name] = passed === true; return passed === true; };
async function scenario(id, title, ac, fn) {
  const s = { id, title, ac, pass: false, checks: {}, observations: {} }; receipt.scenarios[id] = s;
  log(`scenario ${id}: ${title}`);
  try { await fn(s); } catch (e) { s.error = e.message; s.checks.noException = false; }
  s.pass = Object.keys(s.checks).length > 0 && Object.values(s.checks).every((v) => v === true);
  writeFileSync(path.join(dirs.evidence, `checkpoint-${id}.json`), `${JSON.stringify(s, null, 2)}\n`);
  log(`scenario ${id}: ${s.pass ? 'PASS' : 'FAIL'}${s.error ? ` (${s.error.slice(0, 240)})` : ''}`);
}
// Web paths only; the callback's code and state are never recorded.
const webPaths = (urls) => urls.filter((u) => u.startsWith(ORIGINS.web)).map((u) => { const x = new URL(u); return x.pathname === '/gcsp/auth/callback' ? x.pathname : x.pathname + x.search; });
// Signs in through the real Angular sign-in page and the mock issuer's account picker.
async function login(page, person, { from = null } = {}) {
  const mark = idp.requests.length;
  if (from) await page.send('Page.navigate', { url: WEB(from) });
  await page.until(`return location.origin === '${ORIGINS.web}' && location.pathname === '/gcsp/sign-in' && !!button('Sign in');`, 30000, 'Angular sign-in page');
  const signInUrl = await page.eval('location.pathname + location.search');
  await page.act(`return press('Sign in');`);
  await page.until(`return location.origin === '${ORIGINS.idp}' && !!document.querySelector('button[data-subject="sub-${person}"]');`, 30000, 'mock issuer account picker');
  const picker = await page.eval(`[...document.querySelectorAll('button[data-subject]')].map((b) => b.dataset.subject)`);
  const authRequest = lastIdp(mark, (r) => r.path === 'auth' && r.method === 'GET').at(-1) ?? null;
  const callbackFrom = page.urls.length;
  await page.eval(`document.querySelector('button[data-subject="sub-${person}"]').click()`);
  await page.until(`return location.origin === '${ORIGINS.web}' && !['/gcsp/auth/callback', '/gcsp/sign-in'].includes(location.pathname) && !!accountName() && !main.querySelector('[aria-busy="true"]');`, 30000, `${person} signed-in page`);
  return { mark, signInUrl, picker, authRequest, callbackFrom };
}
async function snap(page, s, name) {
  await page.settle();
  const dom = await page.act(`return { path: location.pathname + location.search, heading: heading(), rail: railItems(), account: accountName(), avatar: document.querySelector('.gcsp-avatar')?.textContent.trim() ?? null, notice: notice(), text: text().slice(0, 400), oidcUsers: oidcUsers(), overflow: document.documentElement.scrollWidth > innerWidth + 1 };`);
  s.observations[name] = { dom, screenshot: path.basename(await page.shot(`${s.id}-${name}.png`)), errors: [...page.errors] };
  return dom;
}
const waitFor = (page, body, what, timeout = 20000) => page.until(body, timeout, what);
const contextCalls = (calls) => calls.filter((e) => e.path === '/context');

const LANDING = { paula: { path: '/gcsp/account', rail: ['Your cars', 'Order progress'], name: 'Paula Mason', avatar: 'PM' }, greg: { path: '/gcsp/greg', rail: ['Employee car ordering', 'Process comparisons'], name: 'Greg Lawson', avatar: 'GL' }, presenter: { path: '/gcsp/presenter', rail: ['Presenter controls'], name: 'Account', avatar: '?' } };

// AC1: login and role landing for each role, bearer on every API call.
async function scenarioLanding(cdp, s) {
  for (const person of ['paula', 'greg', 'presenter']) {
    const page = await newPage(cdp, `${person} landing`);
    try {
      const r = await login(page, person, { from: '/gcsp/' });
      await waitFor(page, `return location.pathname === ${JSON.stringify(LANDING[person].path)} && !!heading();`, `${person} role landing`);
      const dom = await snap(page, s, `${person}-landing`);
      const calls = page.calls(); const ctx = contextCalls(calls);
      s.observations[`${person}-detail`] = { signInUrl: r.signInUrl, authRequest: r.authRequest, picker: r.picker, contextRoles: ctx.at(-1)?.response?.value?.roles ?? null, contextHasDisplayName: ctx.at(-1)?.response?.value?.displayName !== undefined, apiCalls: calls.map((e) => `${e.method} ${e.path} ${e.status ?? e.failed} ${e.scheme ?? 'no-auth'}`) };
      check(s, `${person}: Angular sign-in page then issuer, prompt=login`, r.signInUrl.startsWith('/gcsp/sign-in') && r.authRequest?.prompt === 'login' && r.picker.length === 3);
      check(s, `${person}: lands on ${LANDING[person].path}`, dom.path === LANDING[person].path);
      check(s, `${person}: rail items are exactly the role's`, same(dom.rail, LANDING[person].rail));
      check(s, `${person}: header shows ${LANDING[person].name} with avatar ${LANDING[person].avatar}`, dom.account === LANDING[person].name && dom.avatar === LANDING[person].avatar);
      check(s, `${person}: context API call authorised and answered`, ctx.length >= 1 && ctx.every((e) => e.status === 200) && same(ctx.at(-1).response?.value?.roles, SUBJECT_ROLES[`sub-${person}`]));
      check(s, `${person}: every API request carried Authorization Bearer`, calls.length > 0 && calls.every((e) => e.scheme === 'Bearer'));
      check(s, `${person}: no runtime exception`, page.errors.length === 0);
    } finally { await page.close(); }
  }
}

// AC1: a deep route survives sign-in and is not replaced by the role landing.
async function scenarioDirectEntry(cdp, s) {
  for (const [person, route] of [['paula', '/gcsp/orders'], ['greg', '/gcsp/greg/cases']]) {
    const page = await newPage(cdp, `${person} direct entry`);
    try {
      const r = await login(page, person, { from: route });
      await waitFor(page, `return location.pathname === ${JSON.stringify(route)} && !!heading();`, `${person} deep route ${route}`);
      const afterCallback = webPaths(page.urls.slice(r.callbackFrom));
      const dom = await snap(page, s, `${person}-deep-route`);
      s.observations[`${person}-detail`] = { signInUrl: r.signInUrl, afterCallback };
      check(s, `${person}: signed-out entry went to sign-in carrying the route`, decodeURIComponent(r.signInUrl).includes(`returnTo=${route}`));
      check(s, `${person}: back on exactly ${route}`, dom.path === route);
      check(s, `${person}: the role landing was never shown after sign-in`, !afterCallback.includes(LANDING[person].path));
      check(s, `${person}: route renders its own screen`, !!dom.heading && !['Sign in', 'Access not available', 'Account unavailable'].includes(dom.heading));
    } finally { await page.close(); }
  }
}

// AC1: a reload keeps the route and the session without asking the issuer again.
async function scenarioRefresh(cdp, s) {
  const page = await newPage(cdp, 'paula refresh');
  try {
    await login(page, 'paula', { from: '/gcsp/' });
    await waitFor(page, `return location.pathname === '/gcsp/account' && !!heading();`, 'account landing');
    check(s, 'rail link opens the route inside the app', await page.act(`const a = [...document.querySelectorAll('.gcsp-nav-btn')].find((x) => x.textContent.trim() === 'Order progress'); if (!a) return false; a.click(); return true;`));
    await waitFor(page, `return location.pathname === '/gcsp/orders' && !!heading();`, 'orders route');
    const before = await snap(page, s, 'before-reload');
    const mark = idp.requests.length;
    const read = await freshDocument(page, 'reload', { ready: `return location.pathname === '/gcsp/orders' && !!heading() && !!accountName();`, readPath: '/context', what: 'reloaded orders route' });
    const after = await snap(page, s, 'after-reload');
    const issuer = idp.requests.slice(mark).filter((r) => r.path === 'auth');
    s.observations.reload = { contextRead: { status: read.status, scheme: read.scheme }, issuerAuthRequestsSinceReload: issuer.length };
    check(s, 'same route after reload', before.path === '/gcsp/orders' && after.path === before.path);
    check(s, 'same heading after reload', !!before.heading && after.heading === before.heading);
    check(s, 'still signed in, no sign-in screen', !!after.account && !(await page.act(`return !!button('Sign in');`)));
    check(s, 'reload read the context with the stored bearer', read.status === 200 && read.scheme === 'Bearer');
    check(s, 'issuer saw no new /auth request', issuer.length === 0);
  } finally { await page.close(); }
}

// AC1: roles outside a route's policy get the denied state and no private body.
async function scenarioDenied(cdp, s) {
  for (const [person, route, privateTitle] of [['paula', '/gcsp/presenter', 'Presenter controls'], ['presenter', '/gcsp/account', 'Your cars'], ['greg', '/gcsp/orders', 'Order progress']]) {
    const page = await newPage(cdp, `${person} denied`);
    try {
      await login(page, person, { from: '/gcsp/' });
      await waitFor(page, `return location.pathname === ${JSON.stringify(LANDING[person].path)} && !!heading();`, `${person} landing`);
      const mark = page.log.length;
      await page.send('Page.navigate', { url: WEB(route) });
      await waitFor(page, `return heading() === 'Access not available';`, `${person} denied on ${route}`);
      const dom = await snap(page, s, `${person}-denied`);
      const calls = page.calls(mark);
      s.observations[`${person}-detail`] = { route, apiCalls: calls.map((e) => `${e.method} ${e.path} ${e.status ?? e.failed}`) };
      check(s, `${person}: ${route} shows the access-denied state`, dom.heading === 'Access not available' && /does not have access/.test(dom.text));
      check(s, `${person}: no private body (${privateTitle}) in the page`, !dom.text.includes(privateTitle));
      check(s, `${person}: only the context was read, no private endpoint`, calls.every((e) => e.path === '/context'));
    } finally { await page.close(); }
  }
}

// AC1: an unavailable API gives a retry state, and retry recovers once the API is back.
async function scenarioUnavailable(cdp, s) {
  const page = await newPage(cdp, 'paula unavailable');
  try {
    await login(page, 'paula', { from: '/gcsp/' });
    await waitFor(page, `return location.pathname === '/gcsp/account' && !!heading();`, 'account landing');
    const accountHeading = await page.act(`return heading();`);
    await stopApi();
    const mark = page.log.length;
    await page.send('Page.navigate', { url: WEB('/gcsp/account') });
    await waitFor(page, `return heading() === 'Account unavailable' && !!button('Try again');`, 'unavailable state with retry', 30000);
    const down = await snap(page, s, 'unavailable');
    check(s, 'unavailable state with a retry control', down.heading === 'Account unavailable' && await page.act(`return !!button('Try again');`));
    check(s, 'the context read failed at the transport, not invented', page.calls(mark).some((e) => e.path === '/context' && !!e.failed));
    check(s, 'no private account body while unavailable', !down.text.includes(accountHeading) || accountHeading === 'Account unavailable');
    await startApi();
    check(s, 'retry control is actionable', await page.act(`return press('Try again');`));
    await waitFor(page, `return location.pathname === '/gcsp/account' && heading() === ${JSON.stringify(accountHeading)} && !!accountName();`, 'account page after retry', 30000);
    const up = await snap(page, s, 'recovered');
    check(s, 'retry renders the account page', up.heading === accountHeading && up.path === '/gcsp/account');
    check(s, 'retry made an authorised context read', page.calls(mark).some((e) => e.path === '/context' && e.status === 200 && e.scheme === 'Bearer'));
  } finally { if (api.done) await startApi(); await page.close(); }
}

// AC2: an expired access token is renewed with the refresh token, without a new sign-in.
async function scenarioRenewal(cdp, s) {
  setPolicy({ lifetimeSec: SHORT_LIFETIME, refresh: true });
  const page = await newPage(cdp, 'paula renewal');
  try {
    await login(page, 'paula', { from: '/gcsp/' });
    await waitFor(page, `return location.pathname === '/gcsp/account' && !!heading();`, 'account landing');
    await snap(page, s, 'signed-in');
    const grant = idp.requests.filter((r) => r.path === 'token' && r.grantType === 'authorization_code').at(-1);
    check(s, 'issuer issued a short-lived token and a refresh token', grant?.lifetimeSec === SHORT_LIFETIME && grant.refreshIssued === true);
    const firstToken = page.calls().at(-1)?.token;
    const mark = idp.requests.length; const logMark = page.log.length; const urlMark = page.urls.length;
    await sleep(Math.max(0, grant.expiresAt + 3000 - Date.now()));
    check(s, 'access token is past its expiry before the next navigation', Date.now() > grant.expiresAt);
    check(s, 'navigates inside the app after expiry', await page.act(`const a = [...document.querySelectorAll('.gcsp-nav-btn')].find((x) => x.textContent.trim() === 'Order progress'); if (!a) return false; a.click(); return true;`));
    await waitFor(page, `return location.pathname === '/gcsp/orders' && !!heading() && !!accountName();`, 'orders after renewal', 30000);
    const dom = await snap(page, s, 'after-renewal');
    const issuer = idp.requests.slice(mark);
    const refreshes = issuer.filter((r) => r.path === 'token' && r.grantType === 'refresh_token');
    const calls = page.calls(logMark); const later = calls.filter((e) => e.at >= (refreshes[0]?.at ?? Infinity));
    s.observations.detail = { refreshes: refreshes.map((r) => ({ status: r.status, rotated: r.rotated, lifetimeSec: r.lifetimeSec })), issuerAuthRequests: issuer.filter((r) => r.path === 'auth').length, pageUrlsSinceExpiry: webPaths(page.urls.slice(urlMark)), apiCalls: calls.map((e) => `${e.method} ${e.path} ${e.status ?? e.failed} ${e.token === firstToken ? 'old-token' : 'new-token'}`), noticeAfterRenewal: dom.notice };
    check(s, 'issuer saw a refresh_token grant that succeeded', refreshes.length >= 1 && refreshes.every((r) => r.status === 200 && r.subject === 'sub-paula'));
    check(s, 'no new authorization navigation', issuer.filter((r) => r.path === 'auth').length === 0 && page.urls.slice(urlMark).every((u) => !u.startsWith(ORIGINS.idp) && !u.includes('/gcsp/sign-in')));
    check(s, 'still signed in on the target page', dom.path === '/gcsp/orders' && !!dom.account && !(await page.act(`return !!button('Sign in');`)));
    check(s, 'API calls after renewal used the new access token', later.length > 0 && later.every((e) => e.scheme === 'Bearer' && e.token !== firstToken && e.status !== 401));
    check(s, 'the expired access token was not sent after expiry', calls.every((e) => !(e.token === firstToken && e.at > grant.expiresAt)));
  } finally { setPolicy({ lifetimeSec: 3600, refresh: true }); await page.close(); }
}

const SAVED_TEXT = 'F439 saved review note';
// AC2: expiry with no refresh token restores the page and saved progress after sign-in, with no automatic order.
async function scenarioExpiry(cdp, s) {
  setPolicy({ lifetimeSec: 3600, refresh: false });
  const setup = await newPage(cdp, 'paula unfinished order');
  try {
    await login(setup, 'paula', { from: '/gcsp/' });
    await toReview(setup, 'paula'); await reserve(setup); await startReview(setup); await saveDetails(setup, SAVED_TEXT);
    s.observations.setup = { path: await setup.eval('location.pathname'), note: 'claim reserved and review details saved through the Angular controls; order not placed' };
  } finally { await setup.close(); }
  check(s, 'no order exists before the session ends', dbOrderCount('paula') === 0);
  setPolicy({ lifetimeSec: SHORT_LIFETIME, refresh: false });
  const page = await newPage(cdp, 'paula expiry');
  try {
    await login(page, 'paula', { from: '/gcsp/manual/summary' });
    const grant = idp.requests.filter((r) => r.path === 'token' && r.grantType === 'authorization_code').at(-1);
    check(s, 'issuer issued a short-lived token with no refresh token', grant?.lifetimeSec === SHORT_LIFETIME && grant.refreshIssued === false);
    await waitFor(page, `return location.pathname === '/gcsp/manual/summary' && !!button('Continue reviewing this selection');`, 'summary asks to confirm resume', 30000);
    await page.act(`return press('Continue reviewing this selection');`);
    await waitFor(page, `return declarations().length > 0 && declarations().every((d) => !d.disabled);`, 'declarations editable');
    await tickAll(page);
    const ticked = await snap(page, s, 'ticked-before-expiry');
    check(s, 'declarations ticked and Place order available before expiry', Date.now() < grant.expiresAt && await page.act(`return declarations().every((d) => d.checked) && button('Place order')?.disabled === false;`));
    const afterTick = page.log.length;
    await waitFor(page, `return location.pathname === '/gcsp/sign-in';`, 'sign-in after the token expires', 70000);
    const signed = await snap(page, s, 'signed-out-at-expiry');
    check(s, 'the app reached sign-in only after the token expired', Date.now() >= grant.expiresAt);
    check(s, 'sign-in carries returnTo=/gcsp/manual/summary', decodeURIComponent(await page.eval('location.search')).includes('returnTo=/gcsp/manual/summary'));
    check(s, 'expiry notice shown and no order content on the sign-in page', /session expired/i.test(signed.notice ?? '') && !signed.text.includes('Place order'));
    check(s, 'no order was submitted by the expiry', page.calls(afterTick).every((e) => !(e.method === 'POST' && e.path === '/manual/order')) && dbOrderCount('paula') === 0);
    setPolicy({ lifetimeSec: 3600, refresh: false });
    const recoveryMark = page.log.length;
    const r = await login(page, 'paula');
    await waitFor(page, `return location.pathname === '/gcsp/manual/summary' && !!button('Continue reviewing this selection');`, 'summary after sign-in with resume confirmation', 30000);
    const recovered = await snap(page, s, 'recovered-needs-confirmation');
    const view = await page.act(`return { notice: notice(), declarations: declarations(), place: button('Place order') ? !button('Place order').disabled : null, requirements: $('#manual-special-requirements')?.value ?? null };`);
    s.observations.recovered = { view, afterCallback: webPaths(page.urls.slice(r.callbackFrom)) };
    check(s, 'authorised page restored after sign-in', recovered.path === '/gcsp/manual/summary');
    check(s, 'recovery notice shown', /signed in again/i.test(view.notice ?? ''));
    check(s, 'resume confirmation required, declaration ticks cleared', view.declarations.length > 0 && view.declarations.every((d) => !d.checked) && view.place !== true);
    check(s, 'no order submit and no order row after recovery', page.calls(recoveryMark).every((e) => !(e.method === 'POST' && e.path === '/manual/order')) && dbOrderCount('paula') === 0);
    const explicit = page.log.length;
    check(s, 'user confirms resume', await page.act(`return press('Continue reviewing this selection');`));
    await waitFor(page, `return declarations().length > 0 && declarations().every((d) => !d.checked && !d.disabled) && !button('Continue reviewing this selection');`, 'resumed review');
    s.observations.savedProgress = await page.act(`return $('#manual-special-requirements')?.value ?? null;`);
    check(s, 'saved progress restored (review details)', s.observations.savedProgress === SAVED_TEXT);
    await tickAll(page); await snap(page, s, 'resumed-ticked');
    await placeOrder(page);
    const outcome = await waitOutcome(page, 'Awaiting approval');
    const orderPosts = page.calls(explicit).filter((e) => e.method === 'POST' && e.path === '/manual/order');
    const orders = await dbOrders('paula'); s.observations.dbOrders = orders; s.observations.outcome = outcome;
    await snap(page, s, 'order-placed');
    check(s, 'explicit placing sent exactly one order POST', orderPosts.length === 1 && orderPosts[0].status === 200 && orderPosts[0].scheme === 'Bearer');
    check(s, 'exactly one order exists after the explicit action', orders.length === 1 && orders[0].orderUuid === CAR.paula);
  } finally { setPolicy({ lifetimeSec: 3600, refresh: true }); await page.close(); }
}

// AC2: sign-out clears app auth and ends the provider session, so a different account can sign in.
async function scenarioSignOut(cdp, s) {
  setPolicy({ lifetimeSec: 3600, refresh: true });
  const page = await newPage(cdp, 'paula sign-out');
  try {
    await login(page, 'paula', { from: '/gcsp/' });
    await waitFor(page, `return location.pathname === '/gcsp/account' && !!heading();`, 'account landing');
    const paulaTokens = new Set(page.calls().map((e) => e.token));
    const sessionsBefore = idp.sessions.size;
    check(s, 'before sign-out the header shows Paula Mason', (await page.act('return accountName();')) === 'Paula Mason');
    check(s, 'before sign-out: app holds a user and the provider holds a session', (await page.act('return oidcUsers();')) === 1 && sessionsBefore >= 1);
    await snap(page, s, 'signed-in');
    const mark = idp.requests.length; const logMark = page.log.length;
    check(s, 'Sign out is operable from the account menu', await page.eval(`(() => { const d = document.querySelector('summary.gcsp-account-summary'); const b = document.querySelector('button.gcsp-account-signout'); if (!d || !b) return false; d.click(); b.click(); return true; })()`));
    await waitFor(page, `return location.origin === '${ORIGINS.web}' && !!button('Sign in');`, 'signed-out sign-in screen', 30000);
    const out = await snap(page, s, 'signed-out');
    const logout = idp.requests.slice(mark).find((r) => r.path === 'logout');
    s.observations.logout = logout ?? null;
    check(s, 'issuer recorded an end-session request with a valid id_token_hint for paula', logout?.hintValid === true && logout.hintSubject === 'sub-paula');
    check(s, 'post_logout_redirect_uri equals the configured value', logout?.redirectOk === true && logout.redirectUri === POST_LOGOUT);
    check(s, 'provider session deleted and cookie expired', logout?.sessionDeleted === true && logout.cookieExpired === true && !idp.sessions.has(logout.hintSid) && idp.sessions.size === sessionsBefore - 1);
    check(s, 'no gcsp:oidc:user: key in sessionStorage', out.oidcUsers === 0);
    check(s, 'no authorised API call after sign-out', page.calls(logMark).every((e) => !e.auth));
    await page.send('Page.navigate', { url: WEB('/gcsp/account') });
    await waitFor(page, `return location.pathname === '/gcsp/sign-in' && !!button('Sign in');`, 'account route goes to sign-in');
    const gated = await snap(page, s, 'account-gated');
    check(s, '/gcsp/account now goes to sign-in without private content', gated.path.startsWith('/gcsp/sign-in') && !gated.account && !gated.text.includes('Your cars'));
    const second = await login(page, 'greg', { from: '/gcsp/' });
    await waitFor(page, `return location.pathname === '/gcsp/greg' && !!heading();`, 'greg landing');
    const dom = await snap(page, s, 'greg-after-paula');
    const body = await page.eval(`document.documentElement.innerText + ' ' + JSON.stringify(Object.entries(sessionStorage))`);
    const calls = page.calls(logMark); const ctx = contextCalls(calls);
    s.observations.second = { authRequest: second.authRequest, picker: second.picker, contextSubject: ctx.at(-1)?.response?.value?.subject ?? null };
    check(s, 'the next /auth request asked for the account picker (prompt=login) with no provider session', second.authRequest?.prompt === 'login' && second.authRequest.cookie === false && second.picker.includes('sub-paula') && second.picker.includes('sub-greg'));
    check(s, 'header shows Greg Lawson and never Paula Mason after the account change', dom.account === 'Greg Lawson' && dom.avatar === 'GL' && !body.includes('Paula Mason'));
    check(s, 'a different account (greg) lands on /gcsp/greg', dom.path === '/gcsp/greg' && same(dom.rail, LANDING.greg.rail) && ctx.at(-1)?.response?.value?.subject === 'sub-greg');
    check(s, 'no paula name or data in the DOM or session storage', !/paula/i.test(body) && !body.includes(CAR.paula));
    check(s, 'greg calls never used paula tokens', calls.filter((e) => e.token).every((e) => !paulaTokens.has(e.token)));
  } finally { await page.close(); }
}

// ---------- main ----------
const SCENARIOS = [
  ['ac1a', 'Login and role landing for employee, Greg and presenter', 'AC1', scenarioLanding],
  ['ac1b', 'Direct entry to a deep route survives sign-in', 'AC1', scenarioDirectEntry],
  ['ac1c', 'Refresh keeps route and session, no new issuer request', 'AC1', scenarioRefresh],
  ['ac1d', 'Denied states show no private body', 'AC1', scenarioDenied],
  ['ac1e', 'Unavailable state with retry, recovery after the API returns', 'AC1', scenarioUnavailable],
  ['ac2a', 'Expired access token renewed with the refresh token', 'AC2', scenarioRenewal],
  ['ac2b', 'Expiry without renewal restores page and saved progress, no automatic order', 'AC2', scenarioExpiry],
  ['ac2c', 'Sign-out clears app and provider sessions, a different account can sign in', 'AC2', scenarioSignOut]];
function accessLog() {
  const rows = [];
  for (const p of receipt.processes.filter((x) => x.name.startsWith('api-'))) {
    for (const l of tail(path.join(dirs.logs, `${p.name}.log`), 100000).split('\n')) { const m = /ACCESSLOG (\S+) (\S+) (\d+)/.exec(l); if (m && /\/(context|manual|ordering)/.test(m[2])) rows.push(`${p.name} ${m[1]} ${m[2].replace(API_PATH, '')} ${m[3]}`); }
  }
  return rows.slice(-80);
}
async function main() {
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  for (const [k, p] of Object.entries(PORTS)) if (!(await portFree(p))) throw new Error(`port ${p} (${k}) is in use; choose PROOF_${k.toUpperCase()}_PORT`);
  receipt.parentReservation = process.env.TEST_RESOURCE_PARENT_RESERVATION ?? null;
  receipt.inputs = { scratch: PROOF, publicMailBaseUrl: PUBLIC_BASE_URL, database: { source: DB_SOURCE, host: DB[1], port: DB[2] ?? '5432', name: DB_NAME, schema: SCHEMA }, ports: PORTS, shortLifetimeSec: SHORT_LIFETIME, jar: { path: path.relative(ROOT, JAR), sha256: sha256File(JAR) },
    appJars: readdirSync(path.join(path.dirname(JAR), 'app')).filter((f) => f.endsWith('.jar')).map((f) => ({ file: f, sha256: sha256File(path.join(path.dirname(JAR), 'app', f)) })), psql: { path: PSQL, sha256: sha256File(PSQL) }, media: MEDIA_FILES.map((name) => ({ name, sha256: sha256File(path.join(MEDIA_ROOT, name)) })), webBrowser: { path: path.relative(ROOT, WEB_BROWSER), indexSha256: sha256File(path.join(WEB_BROWSER, 'index.html')) } };
  receipt.composition = { identity: 'oidc (local mock issuer)', subjects: Object.entries(SUBJECT_ROLES).map(([subject, roles]) => ({ subject, roles })), account: 'repository', scenario: 'demo', ordering: 'synthetic', resetAllowed: true, environmentId: ENVIRONMENT_ID, runId: RUN_ID, policyVersion: POLICY, apiJvm: jvmLimitsReceipt(API_JVM_ARGS) };
  receipt.sourceRevision = { value: SOURCE_REVISION, provenance: 'PROOF_SOURCE_REVISION supplied and verified by the parent; not read from git here' };
  receipt.tools = { harnessNode: process.version, openssl: cap('openssl', ['version']), chrome: cap(CHROME, ['--version']), java: (spawnSync(path.join(JAVA_HOME, 'bin/java'), ['-version'], { encoding: 'utf8', env: childEnv(process.env) }).stderr ?? '').split('\n')[0] };
  receipt.tools.psql = cap(PSQL, ['--version']);
  const serverVersion = Number(cap(PSQL, ['-X', '-A', '-t', '-h', DB[1].replace(/[\[\]]/g, ''), '-p', DB[2] ?? '5432', '-U', process.env.PROOF_DB_USER ?? 'gcsp', '-d', DB_NAME, '-c', 'SHOW server_version_num'], { env: childEnv({ PATH: process.env.PATH, HOME: process.env.HOME, PGPASSWORD: process.env.PROOF_DB_PASSWORD ?? '', PGCONNECT_TIMEOUT: '10' }) }));
  if (!/PostgreSQL\) 17\./.test(receipt.tools.psql) || serverVersion < 170000 || serverVersion >= 180000) throw new Error('Proof requires native PostgreSQL 17 client and server');
  receipt.inputs.database.serverVersion = serverVersion;
  log('certificates'); tls = makeCerts();
  log('static assembly of the prebuilt web');
  const assemble = await import(pathToFileURL(path.join(ROOT, 'scripts/build-gcsp-static.mjs')).href);
  await runOnce('assemble', process.execPath, ['scripts/build-gcsp-static.mjs', '--browser', WEB_BROWSER, '--output', dirs.static, '--environment', 'deployed', '--revision', SOURCE_REVISION],
    { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp, GCSP_PUBLIC_ENVIRONMENT_ID: ENVIRONMENT_ID, GCSP_PUBLIC_API_BASE_URL: API_BASE, GCSP_PUBLIC_OIDC_AUTHORITY: ISSUER, GCSP_PUBLIC_OIDC_CLIENT_ID: 'gcsp-web',
      GCSP_PUBLIC_OIDC_SCOPE: 'openid profile gcsp-api', GCSP_PUBLIC_OIDC_REDIRECT_URI: `${ORIGINS.web}/gcsp/auth/callback`, GCSP_PUBLIC_OIDC_POST_LOGOUT_REDIRECT_URI: POST_LOGOUT });
  const manifest = path.join(dirs.static, 'gcsp/static-manifest.json');
  receipt.inputs.compiledAssembly = { sha256: sha256File(manifest), manifest: JSON.parse(readFileSync(manifest, 'utf8')) };
  log('mock issuer and web'); await startIdp(tls); await startWeb(tls, assemble.GCSP_FIXED_ROUTES);
  log('API (repository accounts, native PG, synthetic ordering)'); await startApi();
  log('seed released stock and one saved draft for the employee'); await seedAll();
  const profile = path.join(dirs.browser, 'profile'); mkdirSync(profile, { recursive: true });
  const chrome = spawnOwned('chrome', CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-allow-origins=*', `--ignore-certificate-errors-spki-list=${tls.spki}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--window-size=1280,900', 'about:blank'], { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp });
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) { if (chrome.done) throw new Error('Chrome exited during startup'); try { const [p, ws] = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n'); wsUrl = `ws://127.0.0.1:${p}${ws}`; } catch { await sleep(250); } }
  if (!wsUrl) throw new Error('Chrome DevTools endpoint not found');
  const cdp = await Cdp.connect(wsUrl); receipt.cdp = cdp;
  for (const [id, title, ac, fn] of SCENARIOS) await scenario(id, title, ac, (s) => fn(cdp, s));
  receipt.issuerRequests = idp.requests.filter((r) => r.path !== 'certs').map(({ seq, at, ...rest }) => ({ seq, at: new Date(at).toISOString(), ...rest }));
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
  const evidence = (ids) => ids.some((k) => sc[k] && !ok(k)) ? 'fail' : ids.every(ok) ? 'pass' : 'incomplete';
  receipt.endedAt = new Date().toISOString();
  receipt.resources = { durationSec: Math.round((Date.now() - T0) / 1000), harnessMaxRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) };
  if (runError) receipt.runError = runError;
  receipt.logBudget ??= { limitBytes: CHILD_LOG_LIMIT, writtenBytes: childLogBytes, exhausted: false };
  try { receipt.apiAccessLog = accessLog(); } catch { /* no log */ }
  const ids = SCENARIOS.map(([id]) => id);
  receipt.originalAcceptance = {
    AC1: { text: 'Angular owns shell/navigation and handles login, role landing, direct entry, refresh and unavailable/denied states with the baseline visual design.', scenarios: ['ac1a', 'ac1b', 'ac1c', 'ac1d', 'ac1e'], evidence: evidence(['ac1a', 'ac1b', 'ac1c', 'ac1d', 'ac1e']), boundary: 'Local mock issuer; Chrome desktop 1280x800; baseline visual design is evidenced by the captures, not a pixel comparison.', closure: 'OPEN: parent review and batch acceptance decide' },
    AC2: { text: 'Renew authentication where supported; otherwise restore the authorised page and saved progress after sign-in without automatic order submission. Sign-out clears app authentication and ends the provider session where supported, permitting a different account next time.', scenarios: ['ac2a', 'ac2b', 'ac2c'], evidence: evidence(['ac2a', 'ac2b', 'ac2c']), boundary: 'Local mock issuer only (decision 2026-11-18); no real provider.', closure: 'OPEN: parent review and batch acceptance decide' } };
  receipt.overall = ids.every(ok) && !runError && !logLimitFailure && receipt.teardown?.allOwnedExited ? 'PASS' : 'FAIL';
  const file = path.join(dirs.evidence, 'connected-shell-proof.json');
  let serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > 8 * 1024 * 1024) {
    receipt.overall = 'FAIL'; receipt.runError = 'connected receipt exceeded its explicit 8MiB evidence budget';
    for (const entry of Object.values(receipt.scenarios)) entry.observations = { omitted: 'Complete observation evidence exceeded the receipt budget; this run is failed.' };
    serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  }
  try { writeFileSync(file, serialized); } catch (e) { console.error('receipt write failed', e.message); }
  for (const k of Object.keys(sc)) console.log(`  ${k}: ${sc[k].pass ? 'PASS' : 'FAIL'} ${sc[k].title}${sc[k].pass ? '' : ` [failed: ${Object.entries(sc[k].checks).filter(([, v]) => v !== true).map(([n]) => n).join(', ')}]${sc[k].error ? ` error: ${sc[k].error.slice(0, 200)}` : ''}`}`);
  console.log(`overall ${receipt.overall}; receipt ${file}; all owned processes exited: ${receipt.teardown?.allOwnedExited}`);
}
const deadline = setTimeout(async () => { log('global deadline exceeded'); await teardown(); finish('global deadline exceeded'); process.exit(1); }, Math.max(1, DEADLINE_MS - 45000));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await teardown(); finish(`interrupted by ${sig}`); process.exit(130); });
let runError;
try { await main(); } catch (e) { runError = e.message; console.error('RUN ERROR:', e.message); } finally { clearTimeout(deadline); await teardown(); finish(runError); }
process.exit(receipt.overall === 'PASS' ? 0 : 1);
