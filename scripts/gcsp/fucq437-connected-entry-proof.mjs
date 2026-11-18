#!/usr/bin/env node
// FUCQ-437 local proof: actual static entry, signed OIDC return and Java/PG offer ownership.
// Usage: SCRATCH=/private/tmp/<owned> PROOF_RUN_TOKEN=<unique> PROOF_SOURCE_REVISION=<40hex>
// GCSP_TEST_DATABASE_URL=jdbc:postgresql://127.0.0.1:<port>/<owned_db> PROOF_DB_USER=<role>
// PROOF_API_JAR=<prebuilt jar> PROOF_WEB_BROWSER=<prebuilt browser directory>
// PROOF_PUBLIC_BASE_URL=https://gcsp.example.test node scripts/gcsp/fucq437-connected-entry-proof.mjs
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:https';
import https from 'node:https';
import net from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { apiJvmArgs, jvmLimitsReceipt } from './proof-jvm.mjs';

const API_JVM_ARGS = apiJvmArgs({ heap: '320m' });

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
const PROOF = path.join(SCRATCH, `fucq437-connected-${RUN_TOKEN}`);
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
const PORTS = { web: port('PROOF_WEB_PORT', 7543), api: port('PROOF_API_PORT', 8543), idp: port('PROOF_IDP_PORT', 9543), launcher: port('PROOF_LAUNCHER_PORT', 10543) };
if (new Set(Object.values(PORTS)).size !== 4) refuse('Proof web/API/issuer/launcher ports must be distinct');
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


const ORIGINS = { web: `https://gcsp-web.localhost:${PORTS.web}`, api: `https://gcsp-api.localhost:${PORTS.api}`, idp: `https://gcsp-idp.localhost:${PORTS.idp}`, launcher: `https://gcsp-launcher.localhost:${PORTS.launcher}` };
const ISSUER = `${ORIGINS.idp}/realms/gcsp-local`;
const API_PATH = '/api/gcsp/v1';
const API_BASE = `${ORIGINS.api}${API_PATH}`;
const KID = 'gcsp-local-test-1';
const TRUST_PASS = 'proof-local-trust';
// EnvironmentGuard's first active run; employees are explicit upstream scenario records.
const ENVIRONMENT_ID = `f437-connected-${RUN_TOKEN}`;
const RUN_ID = 'run-1';
const POLICY = 'gcsp-policy-v1+offer-journey-v1';
const PEOPLE = ['paula', 'carla', 'bruno'];
const CONTROL_ROLES = { presenter: ['presenter'], greg: ['greg'] };
const TRANCHE_PLAN = path.join(PROOF, 'tranche-plan.json');
const PSQL = path.resolve(process.env.PROOF_PSQL_BIN ?? '/opt/homebrew/opt/postgresql@17/bin/psql');
const MEDIA_ROOT = path.resolve(process.env.PROOF_MEDIA_ROOT ?? path.join(ROOT, 'assets/gcsp-vehicle-evidence'));
const MEDIA_FILES = ['07c269dd7f55fad0a56bbad65ae72f7c35defc5e8883a8290a82972e1defb427.webp', 'ed60cefd049e7293423575b5f0fcee802dbab14083dea2480211ab272896281a.webp',
  'bd89864616f3f34813cb66230e93f5e39d6a25168331ea47e84da60fbf31a735.webp', 'c1a3b0f2df9a6c3834cd04fc8f65455e6daa8fda9e7bf0f7a9c9e5e437ec8318.webp'];
for (const file of [PSQL, MEDIA_ROOT, JAR, WEB_BROWSER, JAVA_HOME, CHROME]) if (/CloudStorage|OneDrive/i.test(file)) refuse('An input path points into a forbidden synced folder');
if (!existsSync(PSQL)) refuse('PROOF_PSQL_BIN must name the parent-pinned native PostgreSQL 17 psql');
for (const name of MEDIA_FILES) if (!existsSync(path.join(MEDIA_ROOT, name))) refuse(`Missing parent-pinned actual media ${name}`);
if (!Number.isFinite(DEADLINE_MS) || DEADLINE_MS <= 0 || DEADLINE_MS > 600000) refuse('PROOF_DEADLINE_SEC must be in (0, 600]');
const SCHEMA = `gcsp_s_f437c_${RUN_TOKEN.replace(/-/g, '_')}`;
const dirs = { logs: path.join(PROOF, 'logs'), tmp: path.join(PROOF, 'tmp'), certs: path.join(PROOF, 'certs'), static: path.join(PROOF, 'static'), browser: path.join(PROOF, 'browser'), launcher: path.join(PROOF, 'launcher'), evidence: path.join(PROOF, 'evidence') };

const receipt = { schema: 'fucq437-connected-entry-proof/1', story: 'DEV-2026-11-13-005 / FUCQ-437', startedAt: new Date().toISOString(), deadlineSeconds: DEADLINE_MS / 1000, cleanupReserveSeconds: 45, runToken: RUN_TOKEN, origins: ORIGINS,
  localTestIssuer: `LOCAL TEST OIDC ISSUER ${ISSUER}: harness only, not the real provider`, composition: null, inputs: null, tools: {}, processes: [], scenarios: {}, originalAcceptance: null, failureLogs: {},
  limitations: [
    'Parent supplies and pins prebuilt API/web; artifact hashes alone do not prove source provenance.',
    'Local labelled OIDC issuer exercises real code/PKCE, signed JWTs and Java verification; hosted identity provider remains unrun.',
    'BuddyJourneySeed-equivalent synthetic upstream source records and retained policy feed real allocation, quote, hold and decision services. Browser business responses are never forged.',
    'Only invalid API fault responses are injected and labelled; browser business success always comes from Java.',
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
const SUPERVISOR_MARKERS = ['F437_LOCAL_TOKEN', 'TEST_RESOURCE_PARENT_RESERVATION', 'PROOF_RUN_TOKEN'];
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
  writeFileSync(c('leaf.ext'), 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:gcsp-web.localhost,DNS:gcsp-api.localhost,DNS:gcsp-idp.localhost,DNS:gcsp-launcher.localhost,DNS:localhost,IP:127.0.0.1\n');
  ssl(['x509', '-req', '-in', c('leaf.csr'), '-CA', c('ca.pem'), '-CAkey', c('ca.key'), '-CAcreateserial', '-days', '3', '-sha256', '-extfile', c('leaf.ext'), '-out', c('leaf.pem')]);
  writeFileSync(c('fullchain.pem'), readFileSync(c('leaf.pem'), 'utf8') + readFileSync(c('ca.pem'), 'utf8'));
  const pub = ssl(['x509', '-in', c('leaf.pem'), '-pubkey', '-noout']);
  const der = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'der'], { input: pub, env: childEnv(process.env) });
  const spki = createHash('sha256').update(der).digest('base64');
  execFileSync(path.join(JAVA_HOME, 'bin/keytool'), ['-importcert', '-alias', 'gcsp-local-ca', '-file', c('ca.pem'), '-keystore', c('truststore.p12'), '-storetype', 'PKCS12', '-storepass', TRUST_PASS, '-noprompt'], { stdio: 'pipe', timeout: 60000, env: childEnv(process.env) });
  return { ca: readFileSync(c('ca.pem'), 'utf8'), cert: readFileSync(c('fullchain.pem')), key: readFileSync(c('leaf.key')), spki, trust: c('truststore.p12') };
}

// ---------- local labelled test OIDC issuer ----------
const idp = { observed: { pkceAuthorizations: 0, verifiedExchanges: 0 }, codes: new Map(), txns: new Map(), subjects: { ...Object.fromEntries(PEOPLE.map((person) => [`sub-${person}`, ['employee']])), ...Object.fromEntries(Object.entries(CONTROL_ROLES).map(([person, roles]) => [`sub-${person}`, roles])) }, keys: null, server: null };
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

// ---------- static web (as fucq435) ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.gif': 'image/gif', '.avif': 'image/avif' };
let webServer; let launcherServer;
function startWeb(tls, fixedRoutes, dynamicRoutes) {
  if (!Array.isArray(dynamicRoutes) || !dynamicRoutes.includes('/gcsp/offers/:offerId')) throw new Error('Builder must export explicit GCSP_DYNAMIC_ROUTES offer metadata');
  const fixed = new Set(fixedRoutes.map(r => r.replace(/\/$/, '') || '/'));
  const root = path.join(dirs.static, 'gcsp');
  const dynamicMatch = pathname => dynamicRoutes.some(route => { const parts = pathname.replace(/\/$/, '').split('/'); const expected = route.split('/'); return parts.length === expected.length && expected.every((segment, i) => segment.startsWith(':') ? parts[i].length > 0 : parts[i] === segment); });
  receipt.staticHost = { mode: 'Local emulator of explicit Render fixed/named-placeholder rewrites; no generic SPA fallback', fixedRoutes, dynamicRoutes, hosted: false };
  webServer = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, ORIGINS.web).pathname); } catch { res.writeHead(400); return res.end('invalid path'); }
    if (p === '/' || p === '/gcsp') { res.writeHead(302, { Location: '/gcsp/' }); return res.end(); }
    if (p.startsWith('/assets/gcsp-vehicle-evidence/')) {
      const name = p.slice('/assets/gcsp-vehicle-evidence/'.length);
      if (!MEDIA_FILES.includes(name)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'no-store' }); return res.end(readFileSync(path.join(MEDIA_ROOT, name)));
    }
    if (!p.startsWith('/gcsp/') || p.includes('..')) { res.writeHead(404); return res.end('not found'); }
    const norm = p.replace(/\/$/, '');
    let file = path.join(root, p.slice('/gcsp/'.length));
    if (fixed.has(norm) || dynamicMatch(p)) file = path.join(root, 'index.html');
    if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end('Not Found'); }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': ext === '.html' || ext === '.json' ? 'no-store' : 'public, max-age=31536000, immutable' }); res.end(readFileSync(file));
  });
  return new Promise(r => webServer.listen(PORTS.web, '127.0.0.1', r));
}
function startLauncher(tls) {
  launcherServer = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, ORIGINS.launcher).pathname); } catch { res.writeHead(400); return res.end(); }
    const file = path.resolve(dirs.launcher, `.${p === '/' ? '/index.html' : p}`);
    if (!file.startsWith(`${dirs.launcher}${path.sep}`) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(readFileSync(file));
  });
  return new Promise(r => launcherServer.listen(PORTS.launcher, '127.0.0.1', r));
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
    GCSP_ACCOUNT_PROVIDER: 'repository', GCSP_SCENARIO_PROVIDER: 'none', GCSP_ORDERING_PROVIDER: 'synthetic', GCSP_RESET_ALLOWED: 'true',
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
  api = spawnOwned(name, path.join(JAVA_HOME, 'bin/java'), [...API_JVM_ARGS, `-Djavax.net.ssl.trustStore=${tls.trust}`, `-Djavax.net.ssl.trustStorePassword=${TRUST_PASS}`, `-Djava.io.tmpdir=${dirs.tmp}`, ...props, '-Dgcsp.allocation.candidates.provider=recommendation', '-jar', JAR], apiEnv(), PORTS.api);
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
  const plan = { label: 'TEST FIXTURE Buddy journey; not actual stock evidence', version: 'f437-connected-v1', windows: [{ windowId: 'f437-w1', availableAt: new Date(now - 86400000).toISOString(), supplyId: null,
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
const activeContexts = new Set();
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
  async close() { await this.settle(); await this.cdp.send('Target.disposeBrowserContext', { browserContextId: this.ctxId }); activeContexts.delete(this.ctxId); }
  event(m) {
    const p = m.params ?? {};
    if (m.method === 'Fetch.requestPaused' && this.invalidContextFault) {
      // CORS preflight must reach the real Java host; inject only the intended invalid GET response.
      if (p.request.method !== 'GET') { this.waits.push(this.send('Fetch.continueRequest', { requestId: p.requestId })); return; }
      this.faultRequests ??= [];
      this.faultRequests.push({ path: new URL(p.request.url).pathname, method: p.request.method, label: 'Deliberately malformed context; never business success' });
      this.waits.push(this.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Cache-Control', value: 'no-store' }, { name: 'Access-Control-Allow-Origin', value: ORIGINS.web }],
        body: Buffer.from(JSON.stringify({ status: 'ok', value: { malformedProofFault: true } })).toString('base64') })); return;
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
      if (e && e.method !== 'OPTIONS') this.waits.push(this.send('Network.getResponseBody', { requestId: p.requestId }).then((r) => { e.response = responseSummary(parse(r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body)); }).catch(() => {}));
    }
  }
  async settle() { await sleep(300); await Promise.allSettled(this.waits.splice(0)); }
  calls(from = 0) { return this.log.slice(from).filter((e) => e.method !== 'OPTIONS'); }
  async eval(expression) { const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`); return r.result.value; }
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
const command = () => `f437-${RUN_TOKEN}-${randomBytes(6).toString('hex')}`;
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
  if (!s.pass) throw new Error(`Entry scenario ${id} failed: ${s.error ?? 'failed assertion'}`);
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
async function enterKey(page) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
}
async function loginFromCurrent(page, person, s) {
  await page.until(`return location.origin === '${ORIGINS.web}' && !!button('Sign in');`, 20000, 'protected sign-in guard');
  check(s, `${person}: no employee business read before sign-in`, !page.calls().some(e => e.auth || /^\/(manual|offers|presenter)/.test(e.path)));
  await page.send('Page.bringToFront');
  await page.act(`button('Sign in').focus();`);
  check(s, `${person}: native sign-in control focused`, await page.act(`return document.activeElement === button('Sign in') && getComputedStyle(document.activeElement).outlineStyle !== 'none';`));
  await enterKey(page);
  await page.until(`return location.origin === '${ORIGINS.idp}' && !!document.querySelector('button[data-subject="sub-${person}"]');`, 20000, 'local signed PKCE issuer form');
  await page.eval(`document.querySelector('button[data-subject="sub-${person}"]').click()`);
  await page.until(`return location.origin === '${ORIGINS.web}' && !location.pathname.includes('/auth/callback') && !button('Sign in') && !!document.querySelector('.gcsp-account-details');`, 30000, 'verified signed-in return');
  await page.settle();
  const context = page.calls().find(e => e.path === '/context' && e.status === 200 && e.auth);
  check(s, `${person}: Java verified signed identity`, context?.response?.value?.subject === `sub-${person}` && context.response.value.roles.includes(rolesFor(person)[0]));
}
async function entryRefresh(cdp, s) {
  const page = await newPage(cdp, 'direct employee entry');
  const target = `${ORIGINS.web}/gcsp/account?brand=bmw&entry=f437#cars`;
  await page.send('Page.navigate', { url: target });
  await loginFromCurrent(page, 'paula', s);
  await page.until(`return location.href === ${JSON.stringify(target)} && !!$('.account-screen');`, 20000, 'exact original protected URL');
  const truth = await serverAccount();
  const read = page.calls().find(e => e.path === '/manual/account' && e.status === 200 && e.auth);
  // AccountService emits a fresh system-clock asOf for each independent read.
  // Compare every business field and retain both actual timestamps; never equate two separate clock reads.
  const observedAccount = read?.response?.value;
  const businessProjection = account => account && Object.fromEntries(Object.entries(account).filter(([key]) => key !== 'asOf'));
  s.observations.accountComparison = { browser: observedAccount, server: truth, excludedPerReadField: 'asOf' };
  check(s, 'intended account is real current Java projection', !!read && same(businessProjection(observedAccount), businessProjection(truth))
    && Number.isFinite(Date.parse(observedAccount.asOf)) && Number.isFinite(Date.parse(truth.asOf))
    && Math.abs(Date.parse(observedAccount.asOf) - Date.parse(truth.asOf)) < 15000);
  const desktop = await snapshot(page, s, 'entry-authorized-desktop');
  check(s, 'actual static CSP retains external scripts and excludes eval', /script-src 'self'(?:;|$)/.test(desktop.csp ?? '') && !desktop.csp.includes('unsafe-eval'));
  check(s, 'frozen branded shell exists on direct entry', await page.eval(`!!document.querySelector('.gcsp-header .gcsp-mark') && !!document.querySelector('.gcsp-nav') && document.querySelector('.gcsp-title')?.textContent.includes('Group Car Schemes')`));
  await freshDocument(page, 'reload', { ready: `return location.href === ${JSON.stringify(target)} && !!$('.account-screen');`, what: 'direct account refresh and query/fragment retention' });
  check(s, 'refresh retains authenticated URL and account', await page.eval(`location.href === ${JSON.stringify(target)}`) && page.calls().filter(e => e.path === '/manual/account' && e.auth && e.status === 200).length >= 2);
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
  check(s, 'reduced motion available in narrow private context', await page.eval(`matchMedia('(prefers-reduced-motion: reduce)').matches`));
  await snapshot(page, s, 'entry-refresh-narrow');
  s.observations.browser = { isolatedBrowserContext: true, tokenInjection: false, directTarget: target };
  await page.close();
}
async function roleLandings(cdp, s) {
  const expected = { paula: '/gcsp/account', greg: '/gcsp/greg', presenter: '/gcsp/presenter' };
  for (const [person, pathname] of Object.entries(expected)) {
    const page = await newPage(cdp, `${person} role landing`);
    const target = `${ORIGINS.web}/gcsp/?brand=bmw&entry=landing#home`;
    await page.send('Page.navigate', { url: target });
    await loginFromCurrent(page, person, s);
    await page.until(`return location.pathname === ${JSON.stringify(pathname)} && location.search === '?brand=bmw&entry=landing' && location.hash === '#home';`, 20000, `${person} role landing with root context`);
    const nav = await page.eval(`[...document.querySelectorAll('.gcsp-nav-btn')].map(a => new URL(a.href).pathname)`);
    const required = person === 'presenter' ? ['/gcsp/presenter'] : person === 'greg' ? ['/gcsp/greg', '/gcsp/comparison'] : ['/gcsp/account', '/gcsp/orders'];
    check(s, `${person}: authorized navigation only`, same(nav, required));
    await snapshot(page, s, `landing-${person}-desktop`);
    await page.close();
  }
  check(s, 'all browser logins used real PKCE exchanges', idp.observed.pkceAuthorizations >= 4 && idp.observed.verifiedExchanges >= 4);
}
async function offerReturn(cdp, s) {
  let current;
  for (let i = 0; i < 40 && !current; i++) {
    const outbox = await value('presenter', '/presenter/outbox');
    current = outbox.messages.find(m => m.recipient?.employeeId === 'employee-paula' && m.offerLink && decodeURIComponent(new URL(m.offerLink).pathname.split('/').at(-1)) === offers.paula);
    if (!current) await sleep(250);
  }
  check(s, 'actual producer captured a newly allocated offer URL', !!current && current.transport === 'captured');
  receipt.capturedLink = { jobId: current.jobId, offerId: offers.paula, url: current.offerLink, deliveredToInbox: false };
  const owner = await newPage(cdp, 'new offer signed-out owner return');
  await deepLinkLogin(owner, 'paula', offers.paula);
  await owner.until(`return !!$('[data-offer-action="accept"]') && text().includes('Your offer');`, 30000, 'authorized owned offer');
  const truth = await value('paula', offerPath(offers.paula));
  await owner.settle();
  check(s, 'browser owned offer agrees with actual Java producer', owner.calls().some(e => e.path === offerPath(offers.paula) && e.auth && e.status === 200 && e.response?.value?.offerId === offers.paula) && truth.state === 'pending');
  check(s, 'real pinned vehicle rendered', await owner.act(`return text().includes(${JSON.stringify(truth.quote.facts.display.name)});`));
  await snapshot(owner, s, 'offer-return-desktop');
  await openOffer(owner, offers.paula, 'pending', 'reload');
  check(s, 'dynamic offer refresh reads real owned state', await owner.act(`return !!$('[data-offer-action="accept"]');`));
  await owner.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
  await snapshot(owner, s, 'offer-return-narrow');
  await owner.close();
  const wrong = await newPage(cdp, 'offer wrong-account return');
  await deepLinkLogin(wrong, 'carla', offers.paula);
  await wrong.until(`return !!$('gcsp-status-screen') && !text().includes('Loading');`, 20000, 'actual ownership refusal');
  await wrong.settle();
  check(s, 'actual Java ownership refusal hides offer business data', wrong.calls().some(e => e.path === offerPath(offers.paula) && e.status === 403 && e.auth) && await wrong.act(`return !$('[data-offer-action]') && !text().includes(${JSON.stringify(truth.quote.facts.display.name)});`));
  await snapshot(wrong, s, 'offer-return-wrong-account');
  await wrong.close();
  check(s, 'entry and refresh never submit employee decisions', ![owner, wrong].some(p => p.calls().some(e => e.method === 'POST')) && (await value('paula', offerPath(offers.paula))).state === 'pending');
  s.observations.linkMapping = { producer: current.offerLink, localTarget: offerUrl(offers.paula), basis: 'Same actual generated path, mapped to owned local host. No inbox delivery or hosted return proved.' };
}
async function sharedLauncher(cdp, s) {
  const page = await newPage(cdp, 'actual shared launcher');
  const query = '?experience=launcher&brand=bmw&mode=swipe&scope=national&retailer=proof-retailer&retailerName=Proof%20Retailer';
  await page.send('Page.navigate', { url: `${ORIGINS.launcher}/${query}#m=proof-context` });
  await page.until(`return !!document.querySelector('.demo-launcher') && [...document.querySelectorAll('a')].some(a => a.textContent.trim() === 'Explore Employee cars');`, 20000, 'packaged actual shared launcher');
  const links = await page.eval(`(() => { const a = [...document.querySelectorAll('a')]; return { employee: a.find(a => a.textContent.trim() === 'Explore Employee cars')?.href, retail: a.find(a => a.textContent.trim() === 'Explore BMW Used cars')?.href }; })()`);
  check(s, 'configured employee link preserves only BMW presentation context', links.employee === `${ORIGINS.web}/gcsp/?brand=bmw`);
  const retail = new URL(links.retail);
  check(s, 'retail link retains its mode scope retailer and share context', retail.origin === ORIGINS.launcher && retail.searchParams.get('experience') === 'used-cars' && retail.searchParams.get('brand') === 'bmw' && retail.searchParams.get('mode') === 'swipe' && retail.searchParams.get('scope') === 'national' && retail.searchParams.get('retailer') === 'proof-retailer' && retail.searchParams.get('retailerName') === 'Proof Retailer' && retail.hash === '#m=proof-context');
  s.observations.links = links;
  await snapshot(page, s, 'shared-launcher-desktop');
  await page.send('Page.bringToFront');
  await page.eval(`[...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'Explore Employee cars').focus()`);
  check(s, 'employee launcher link receives keyboard focus', await page.eval(`document.activeElement?.textContent.trim() === 'Explore Employee cars'`));
  await enterKey(page);
  await loginFromCurrent(page, 'paula', s);
  await page.until(`return location.pathname === '/gcsp/account' && location.search === '?brand=bmw' && location.hash === '';`, 20000, 'shared configured employee return');
  check(s, 'shared launcher return shows actual employee account', page.calls().some(e => e.path === '/manual/account' && e.status === 200 && e.auth));
  await page.close();
}
function staticRead(p) {
  return new Promise((resolve, reject) => {
    const req = https.get({ host: '127.0.0.1', port: PORTS.web, path: p, servername: new URL(ORIGINS.web).hostname, ca: tls.ca }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 256 * 1024) req.destroy(new Error('static response too large')); else chunks.push(chunk); });
      res.on('end', () => resolve({ status: res.statusCode, contentType: res.headers['content-type'], cacheControl: res.headers['cache-control'], body: Buffer.concat(chunks).toString() }));
    });
    req.setTimeout(10000, () => req.destroy(new Error('static request timeout'))); req.on('error', reject);
  });
}
async function unknownStatic(cdp, s) {
  for (const missing of ['/gcsp/not-a-route', '/gcsp/missing-proof.js', '/gcsp/media/missing-proof.woff2', '/gcsp/assets/missing-proof.png']) {
    const r = await staticRead(missing);
    check(s, `${missing}: genuine static HTTP 404 without Angular index masking`, r.status === 404 && !r.body.includes('<app-root') && !r.body.includes('<gcsp-root'));
    s.observations[missing] = { status: r.status, contentType: r.contentType };
  }
  const page = await newPage(cdp, 'unknown frontend direct URL');
  await page.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/not-a-route` });
  await page.until(`return document.readyState === 'complete' && document.body.innerText.includes('Not Found');`, 15000, 'native host unknown route');
  check(s, 'unknown host route makes no private API calls', page.calls().length === 0);
  await snapshot(page, s, 'unknown-direct-native-404');
  s.observations.limitation = 'Native host 404 is distinct; this emulator does not establish Render custom error copy or a useful recovery link. Hosted usefulness remains open.';
  await page.close();
}
async function apiFailures(cdp, s) {
  const page = await newPage(cdp, 'invalid then unavailable API');
  await signIn(page, 'paula');
  await page.until(`return !!$('.account-screen');`, 15000, 'account before faults');
  page.invalidContextFault = true;
  receipt.faultInjection = { boundary: `${API_BASE}/context`, method: 'GET', status: 200, body: { status: 'ok', value: { malformedProofFault: true } }, purpose: 'Deliberately invalid schema only; no business success is mocked' };
  await page.send('Fetch.enable', { patterns: [{ urlPattern: `${API_BASE}/context`, requestStage: 'Request' }] });
  const invalid = await freshDocument(page, 'reload', { readPath: '/context', readOk: false, ready: `return text().includes('Account unavailable') && !!button('Try again');`, what: 'invalid context response refusal' });
  s.observations.invalidContext = { read: invalid, interceptedRequests: page.faultRequests ?? [], rendered: await page.act(`return { text: text(), accountVisible: !!$('.account-screen') };`) };
  check(s, 'invalid schema produces useful API failure rather than not-found', invalid.status === 200 && invalid.response?.value?.malformedProofFault === true && await page.act(`return !text().includes('Page not found') && !$('.account-screen');`) && page.faultRequests?.length === 1);
  await snapshot(page, s, 'api-invalid-context');
  await page.send('Fetch.disable'); page.invalidContextFault = false;
  await stopApi();
  const unavailable = await freshDocument(page, 'reload', { readPath: '/context', readOk: false, ready: `return text().includes('Account unavailable') && !!button('Try again');`, what: 'actually stopped API transport failure' });
  check(s, 'unavailable real API yields account recovery and no false 404', !!unavailable.failed && await page.act(`return !text().includes('Page not found') && !$('.account-screen');`));
  await snapshot(page, s, 'api-unavailable-context');
  await startApi();
  await page.send('Page.bringToFront'); await page.act(`button('Try again').focus();`); await enterKey(page);
  await page.until(`return !!$('.account-screen') && !text().includes('Account unavailable');`, 20000, 'retry returns to real account after owned API restart');
  await page.settle();
  check(s, 'keyboard retry restores real Java account', page.calls().some(e => e.path === '/manual/account' && e.status === 200 && e.auth));
  await snapshot(page, s, 'api-recovered-account');
  await page.close();
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
  receipt.composition = { identity: 'oidc (local test issuer)', subjects: PEOPLE.map((p) => ({ subject: `sub-${p}`, employeeId: `employee-${p}` })), account: 'repository', scenario: 'none; explicit BuddyJourneySeed-equivalent source records', ordering: 'synthetic (unused employee decisions)', allocation: 'recommendation / local-synthetic Buddy', resetAllowed: true, environmentId: ENVIRONMENT_ID, runId: RUN_ID, policyVersion: POLICY, mirrors: 'BuddyJourneySeed; source-only owned-schema fixtures, real services produce all business outcomes' };
  receipt.sourceRevision = { value: SOURCE_REVISION, provenance: 'PROOF_SOURCE_REVISION supplied and verified by the parent; not read from git here' };
  receipt.tools = { harnessNode: process.version, openssl: cap('openssl', ['version']), chrome: cap(CHROME, ['--version']), apiJvm: jvmLimitsReceipt(API_JVM_ARGS), java: (spawnSync(path.join(JAVA_HOME, 'bin/java'), ['-version'], { encoding: 'utf8', env: childEnv(process.env) }).stderr ?? '').split('\n')[0] };
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
  log('issuer and web'); await startIdp(tls); await startWeb(tls, assemble.GCSP_FIXED_ROUTES, assemble.GCSP_DYNAMIC_ROUTES);
  const { assembleSite } = await import(pathToFileURL(path.join(ROOT, 'scripts/assemble-site.mjs')).href);
  const launcher = await assembleSite({ output: dirs.launcher, apiUrl: ORIGINS.api, environment: 'deployed', employeeFrontendUrl: `${ORIGINS.web}/gcsp/`, revision: SOURCE_REVISION });
  receipt.launcherPackage = { revision: launcher.revision, files: launcher.files.length, frontend: launcher.employeeFrontendUrl, manifestSha256: sha256File(path.join(dirs.launcher, 'site-manifest.json')) };
  await startLauncher(tls);
  log('API (repository accounts, native PG)'); await startApi();
  const profile = path.join(dirs.browser, 'profile'); mkdirSync(profile, { recursive: true });
  const chrome = spawnOwned('chrome', CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-allow-origins=*', `--ignore-certificate-errors-spki-list=${tls.spki}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--window-size=1280,900', 'about:blank'], { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp });
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) { if (chrome.done) throw new Error('Chrome exited during startup'); try { const [p, ws] = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n'); wsUrl = `ws://127.0.0.1:${p}${ws}`; } catch { await sleep(250); } }
  if (!wsUrl) throw new Error('Chrome DevTools endpoint not found');
  const cdp = await Cdp.connect(wsUrl); receipt.cdp = cdp;
  log('seed upstream sources, then actual Buddy allocation and capture'); await seedSources();
  await scenario('entry-refresh', 'Direct protected entry survives signed OIDC and refresh', 'AC1 local', s => entryRefresh(cdp, s));
  await scenario('role-landings', 'Employee, Greg and presenter land on authorized role homes', 'AC1 local', s => roleLandings(cdp, s));
  await scenario('new-offer-return', 'New producer offer link signs in its owner and refuses another employee', 'AC1 local; email delivery unrun', s => offerReturn(cdp, s));
  await scenario('shared-launcher', 'Actual packaged launcher preserves BMW and retail context', 'AC2 local', s => sharedLauncher(cdp, s));
  await scenario('unknown-static', 'Unknown frontend and missing assets are genuine HTTP 404', 'AC2 local', s => unknownStatic(cdp, s));
  await scenario('api-failures', 'Invalid response and unavailable API show useful account failure, distinct from unknown routes', 'AC2 local', s => apiFailures(cdp, s));

}
function teardown() {
  if (teardownPromise) return teardownPromise;
  teardownPromise = (async () => {
  receipt.fixtureOwnership = 'Only the per-run schema was mutated; parent owns its teardown audit and removal.';
  const errors = [];
  for (const browserContextId of activeContexts) { try { await receipt.cdp?.send('Target.disposeBrowserContext', { browserContextId }); activeContexts.delete(browserContextId); } catch (e) { errors.push(`browser context: ${e.message}`); } }
  try { receipt.cdp?.ws.close(); } catch (e) { errors.push(`CDP close: ${e.message}`); }
  delete receipt.cdp;
  for (const child of owned.slice().reverse()) { try { await child.stop(); await child.logClosed; } catch (e) { errors.push(`process ${child.pid}: ${e.message}`); } }
  for (const [name, server] of [['web', webServer], ['launcher', launcherServer], ['issuer', idp.server]]) { try { await closeServer(server); } catch (e) { errors.push(`${name}: ${e.message}`); } }
  receipt.teardown = { ownedProcesses: receipt.processes.map((p) => ({ name: p.name, pid: p.pid, exit: p.exit })), allOwnedExited: owned.every((c) => c.done), browserContextsClosed: activeContexts.size === 0, serversClosed: [webServer, launcherServer, idp.server].every(server => !server?.listening), errors,
    scratchLeftForParent: PROOF, note: 'Nothing is deleted here; the parent owns scratch, the throwaway database and teardown audit.' };
  })();
  return teardownPromise;
}
function finish(runError) {
  if (finished) return; finished = true;
  receipt.oidcObserved = idp.observed;
  const sc = receipt.scenarios; const ok = (k) => sc[k]?.pass === true;
  receipt.endedAt = new Date().toISOString();
  if (runError) receipt.runError = runError;
  receipt.logBudget ??= { limitBytes: CHILD_LOG_LIMIT, writtenBytes: childLogBytes, exhausted: false };
  try { receipt.apiAccessLog = accessLog(); } catch { /* no log */ }
  receipt.originalAcceptance = {
    AC1: { text: 'Direct entry, refresh, role landing, sign-in return and new offer links reach the intended authorized state.', localEvidence: ['entry-refresh', 'role-landings', 'new-offer-return'].every(ok) ? 'pass' : 'incomplete', closure: 'OPEN: actual hosted refresh/OIDC and newly delivered email return remain unverified' },
    AC2: { text: 'Unknown frontend routes and unavailable/invalid API responses produce distinct useful outcomes; shared links preserve brand/context.', localEvidence: ['shared-launcher', 'unknown-static', 'api-failures'].every(ok) ? 'partial: native404 usefulness remains unproven' : 'incomplete', closure: 'OPEN: local Render contract emulation does not establish deployed host behavior; Safari unrun' } };
  receipt.overall = ['entry-refresh', 'role-landings', 'new-offer-return', 'shared-launcher', 'unknown-static', 'api-failures'].every(ok) && !runError && !logLimitFailure && receipt.teardown?.allOwnedExited && receipt.teardown?.serversClosed && receipt.teardown?.browserContextsClosed && receipt.teardown?.errors.length === 0 ? 'PASS' : 'FAIL';
  const file = path.join(dirs.evidence, 'connected-entry-proof.json');
  let serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > 8 * 1024 * 1024) {
    receipt.overall = 'FAIL'; receipt.runError = 'connected receipt exceeded its explicit 8MiB evidence budget';
    for (const entry of Object.values(receipt.scenarios)) entry.observations = { omitted: 'Complete observation evidence exceeded the receipt budget; this run is failed.' };
    serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  }
  try { writeFileSync(file, serialized); } catch (e) { receipt.overall = 'FAIL'; console.error('receipt write failed', e.message); }
  for (const k of Object.keys(sc).sort()) console.log(`  ${k}: ${sc[k].pass ? 'PASS' : 'FAIL'} ${sc[k].title}${sc[k].pass ? '' : ` [failed: ${Object.entries(sc[k].checks).filter(([, v]) => v !== true).map(([n]) => n).join(', ')}]`}`);
  console.log(`overall ${receipt.overall}; receipt ${file}; all owned processes exited: ${receipt.teardown?.allOwnedExited}`);
}
const deadline = setTimeout(async () => { log('global deadline exceeded'); await teardown(); finish('global deadline exceeded'); process.exit(1); }, Math.max(1, DEADLINE_MS - 45000));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await teardown(); finish(`interrupted by ${sig}`); process.exit(130); });
let runError;
try { await main(); } catch (e) { runError = e.message; console.error('RUN ERROR:', e.message); } finally { clearTimeout(deadline); await teardown(); finish(runError); }
process.exit(receipt.overall === 'PASS' ? 0 : 1);
