#!/usr/bin/env node
// FUCQ-447 connected proof: built Angular Help/case screens -> started Java API (OIDC, repository accounts, native PG17), headless Chrome.
// Derived from fucq435-cross-origin-proof.mjs. Never builds; the parent supplies SCRATCH, the database, the jar and the compiled web.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:https';
import https from 'node:https';
import net from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, createWriteStream, lstatSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const PROOF = path.join(SCRATCH, `fucq447-connected-${RUN_TOKEN}`);
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
const PORTS = { web: port('PROOF_WEB_PORT', 7543), api: port('PROOF_API_PORT', 8543), idp: port('PROOF_IDP_PORT', 9543) };
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
// Explicit upstream employee records share EnvironmentGuard.FIRST_RUN_ID.
const ENVIRONMENT_ID = `f447-connected-${RUN_TOKEN}`;
const RUN_ID = 'run-1';
const POLICY = 'gcsp-policy-v1+offer-journey-v1';
const PEOPLE = ['paula', 'alex'];
const CONTROL_ROLES = { presenter: ['presenter'], greg: ['greg'] };
const TRANCHE_PLAN = path.join(PROOF, 'tranche-plan.json');
const PSQL = localInput(process.env.PROOF_PSQL_BIN ?? '/opt/homebrew/opt/postgresql@17/bin/psql');
const MEDIA_ROOT = localInput(process.env.PROOF_MEDIA_ROOT ?? path.join(ROOT, 'assets/gcsp-vehicle-evidence'));
const MEDIA_FILES = ['07c269dd7f55fad0a56bbad65ae72f7c35defc5e8883a8290a82972e1defb427.webp', 'ed60cefd049e7293423575b5f0fcee802dbab14083dea2480211ab272896281a.webp',
  'bd89864616f3f34813cb66230e93f5e39d6a25168331ea47e84da60fbf31a735.webp', 'c1a3b0f2df9a6c3834cd04fc8f65455e6daa8fda9e7bf0f7a9c9e5e437ec8318.webp'];
for (const file of [PSQL, MEDIA_ROOT, JAR, WEB_BROWSER, JAVA_HOME, CHROME]) if (/CloudStorage|OneDrive/i.test(file)) refuse('An input path points into a forbidden synced folder');
if (!existsSync(PSQL)) refuse('PROOF_PSQL_BIN must name the parent-pinned native PostgreSQL 17 psql');
for (const name of MEDIA_FILES) if (!existsSync(path.join(MEDIA_ROOT, name))) refuse(`Missing parent-pinned actual media ${name}`);
if (!Number.isFinite(DEADLINE_MS) || DEADLINE_MS <= 45000 || DEADLINE_MS > 600000) refuse('PROOF_DEADLINE_SEC and remaining absolute deadline must be in (45, 600] including cleanup reserve');
const SCHEMA = `gcsp_s_f447c_${RUN_TOKEN.replace(/-/g, '_')}`;
const dirs = { logs: path.join(PROOF, 'logs'), tmp: path.join(PROOF, 'tmp'), certs: path.join(PROOF, 'certs'), static: path.join(PROOF, 'static'), browser: path.join(PROOF, 'browser'), evidence: path.join(PROOF, 'evidence') };

const receipt = { schema: 'fucq447-connected-case-proof/1', story: 'DEV-2026-11-13-015 / FUCQ-447', startedAt: new Date().toISOString(), deadlineSeconds: DEADLINE_MS / 1000, cleanupReserveSeconds: 45, runToken: RUN_TOKEN, origins: ORIGINS,
  localTestIssuer: `LOCAL TEST OIDC ISSUER ${ISSUER}: harness only, not the real provider`, composition: null, inputs: null, tools: {}, processes: [], scenarios: {}, originalAcceptance: null, failureLogs: {},
  limitations: [
    'The parent supplies prebuilt production web/API; input hashes do not independently establish their source revision.',
    'The issuer is a local test OIDC provider. Real signed tokens, code/PKCE login and Java bearer verification run; the real hosted identity provider does not.',
    'Only upstream account, entitlement, brief and stock records are seeded in the owned schema. Java creates offers, declines, cases and remedies; no case outcome is inserted.',
    'The unavailable presentation uses a labelled CDP transport abort for case reads, never a fabricated success or backend-refusal claim.',
    'Positive Help/case/remedy commands run through actual Angular DOM controls. Offer allocation/decline setup and negative probes use explicitly labelled signed API commands.',
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
const SUPERVISOR_MARKERS = ['F447_LOCAL_TOKEN', 'TEST_RESOURCE_PARENT_RESERVATION', 'PROOF_RUN_TOKEN', 'PROOF_ABSOLUTE_DEADLINE_MS'];
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
    GCSP_ACCOUNT_PROVIDER: 'repository', GCSP_SCENARIO_PROVIDER: 'none', GCSP_ORDERING_PROVIDER: 'synthetic', GCSP_RESET_ALLOWED: 'true',
    GCSP_BUDDY_PROVIDER: 'local-synthetic', GCSP_CLAIM_STOCK_PROVIDER: 'local', GCSP_SUPPLY_PROVIDER: 'tranche-plan', GCSP_SUPPLY_TRANCHE_PLAN_FILE: TRANCHE_PLAN,
    GCSP_SUPPLY_POLICY_FILE: path.join(ROOT, 'services/gcsp-api/src/test/resources/supply/policy.json'), GCSP_ALLOCATION_CANDIDATES_PROVIDER: 'recommendation',
    GCSP_DATABASE_PASSWORD: process.env.PROOF_DB_PASSWORD ?? '',
    GCSP_CLAIMS_SWEEP_INTERVAL: '10m', GCSP_NOTIFY_DRAIN_INTERVAL: '10m', GCSP_PUBLIC_BASE_URL: PUBLIC_BASE_URL,
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

// ---------- explicitly labelled API setup, negative probes and server readback ----------
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
let sqlCount = 0;
async function sql(statement) {
  await runOnce(`fixture-${++sqlCount}`, PSQL, ['-X', '-v', 'ON_ERROR_STOP=1', '-h', DB[1].replace(/[\[\]]/g, ''), '-p', DB[2] ?? '5432', '-U', process.env.PROOF_DB_USER ?? 'gcsp', '-d', DB_NAME, '-c', `SET search_path TO ${SCHEMA}; ${statement}`],
    { PATH: process.env.PATH, HOME: process.env.HOME, PGCONNECT_TIMEOUT: '10', PGPASSWORD: process.env.PROOF_DB_PASSWORD ?? '' }, 30000);
}
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
  constructor(cdp, sessionId, ctxId, label) { this.cdp = cdp; this.sid = sessionId; this.ctxId = ctxId; this.label = label; this.log = []; this.byId = new Map(); this.waits = []; this.mainFrame = null; this.mainLoader = null; this.docs = 0; this.errors = []; this.csp = []; cdp.listeners.push((m) => m.sessionId === sessionId && this.event(m)); }
  send(method, params) { return this.cdp.send(method, params, this.sid); }
  event(m) {
    const p = m.params ?? {};
    if (m.method === 'Log.entryAdded') { if (p.entry?.level === 'error' && /content.security|content-security|\bcsp\b/i.test(p.entry?.text ?? '')) this.csp.push({ level: p.entry.level, text: p.entry.text }); return; }
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
// DOM selectors follow HelpComponent, CaseQueueComponent and the shared shell.
const HELPERS = `
const main = document.querySelector('#gcsp-main') ?? document;
const $ = (s) => main.querySelector(s);
const button = (label) => [...main.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const press = (label) => { const b = button(label); if (!b || b.disabled) return false; b.click(); return true; };
const text = () => main.textContent.replace(/\\s+/g, ' ').trim();
const setValue = (selector, value) => { const el = $(selector); if (!el || el.disabled) return false; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; };
`;
async function newPage(cdp, label) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, sessionId, browserContextId, label);
  await page.send('Page.enable'); await page.send('Emulation.setFocusEmulationEnabled', { enabled: true }); await page.send('Network.enable'); await page.send('Network.setCacheDisabled', { cacheDisabled: true }); await page.send('Runtime.enable'); await page.send('Log.enable');
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
  await page.until(`return location.origin === '${ORIGINS.web}' && /^\\/gcsp\\/(account|preferences|greg|presenter)/.test(location.pathname);`, 30000, 'signed-in employee landing');
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
const command = () => `f447-${RUN_TOKEN}-${randomBytes(6).toString('hex')}`;
async function call(person, suffix, body) {
  return request(body === undefined ? 'GET' : 'POST', suffix,
    { Authorization: `Bearer ${signJwt(accessClaims(`sub-${person}`, rolesFor(person)), idp.keys.privateKey)}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body ?? null);
}
async function value(person, suffix, body) {
  const r = await call(person, suffix, body);
  if (r.status !== 200 || r.json?.status !== 'ok') throw new Error(`${person} ${suffix}: ${JSON.stringify(r)}`);
  return r.json.value;
}

const quoted = (v) => `'${String(v).replace(/'/g, "''")}'`;
const sourceFile = path.join(ROOT, 'services/gcsp-api/src/test/resources/recommendation-source/source-cases.json');
const accountFile = path.join(ROOT, 'services/gcsp-api/src/test/resources/account/node-baseline/paula.json');
function upstreamRows() { return JSON.parse(readFileSync(sourceFile, 'utf8')).cases.find(c => c.name === 'paula-mixed').rows.slice(0, 2); }
function writePlan() {
  const rows = upstreamRows(); const now = Date.now();
  const plan = { label: 'TEST FIXTURE Buddy journey; not actual stock evidence', version: 'f447-connected-v1', windows: [{ windowId: 'f447-w1', availableAt: new Date(now - 86400000).toISOString(), supplyId: null,
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
    attributes.facts.display.photo = `/assets/gcsp-vehicle-evidence/${MEDIA_FILES[0]}`;
    statements.push(`INSERT INTO stock_cars (environment_id,run_id,order_uuid,configuration_id,state,attributes,version) VALUES (${quoted(ENVIRONMENT_ID)},${quoted(RUN_ID)},${quoted(row.orderUuid)},${quoted(row.configurationId)},'unreleased',${quoted(JSON.stringify(attributes))}::jsonb,1)`);
  }
  for (const [index, key] of PEOPLE.entries()) {
    const employeeId = `employee-${key}`; const grade = 'G7';
    const rename = v => JSON.parse(JSON.stringify(v).replaceAll('employee-paula', employeeId).replaceAll('slot-paula', `slot-${key}`).replaceAll('Paula Mason', `${key[0].toUpperCase() + key.slice(1)} Mason`).replaceAll('paula.mason@', `${key}.mason@`));
    const attributes = { companyId: golden.context.companyId, schemeId: golden.context.schemeId, gradeId: grade, entitlementSlotId: `slot-${key}` };
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
  receipt.fixture = { kind: 'BuddyJourneySeed-equivalent upstream scenario records', accountSource: path.relative(ROOT, accountFile), accountSha256: sha256File(accountFile), asOf: now, upstreamInputsOnly: true, modifications: ['two employee identities and entitlement slots','contract ends 30 and 45 days from actual demo clock','required-by one year from demo clock','confirmed estate preference and Buddy search/hold consent','two unreleased source-cases rows with actual retained image'], excludedSyntheticOutcomes: ['offers','holds','quotes','declines','cases','remedies','post-decline confirmation audit'] };
}
const check = (s, name, passed) => { s.checks[name] = passed === true; if (!passed) throw new Error(name); };
async function scenario(id, title, ac, fn) {
  const s = { title, ac, pass: false, checks: {}, observations: {} }; receipt.scenarios[id] = s;
  log(`scenario ${id}: ${title}`);
  try { await fn(s); } catch (e) { s.error = e.message; s.checks.noException = false; }
  s.pass = Object.keys(s.checks).length > 0 && Object.values(s.checks).every(v => v === true);
  writeFileSync(path.join(dirs.evidence, `checkpoint-${id}.json`), `${JSON.stringify(s, null, 2)}\n`);
  if (!s.pass) throw new Error(`Case scenario ${id} failed: ${s.error ?? 'failed assertion'}`);
}
async function tick() {
  const clock = await value('presenter', '/presenter/clock');
  const result = await value('presenter', '/presenter/clock/tick', { tickId: command(), expectedClockVersion: clock.clockVersion });
  if (result.state !== 'completed') throw new Error(`Setup allocation tick did not complete: ${JSON.stringify(result)}`);
  return result;
}
async function waitPost(page, from, endpoint) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    await page.settle();
    const rows = page.calls(from).filter(e => e.method === 'POST' && e.path === endpoint);
    if (rows.length && rows.every(e => e.response !== undefined)) return rows;
    await sleep(100);
  }
  throw new Error(`No completed browser POST ${endpoint}`);
}
async function snapshot(page, s, name) {
  await page.settle();
  const dom = await page.act(`return { text: text(), overflow: document.documentElement.scrollWidth > innerWidth + 1,
    headings: [...main.querySelectorAll('h1,h2,h3,h4')].map(h => ({level:h.tagName,text:h.textContent.trim()})),
    focus: {tag:document.activeElement?.tagName,id:document.activeElement?.id,text:document.activeElement?.textContent?.trim().slice(0,160)},
    caseIds: [...main.querySelectorAll('[data-case-id]')].map(a=>a.dataset.caseId),
    controls: [...main.querySelectorAll('button,input,select,textarea')].map(a=>({tag:a.tagName,name:a.getAttribute('aria-label')||a.textContent.trim().slice(0,100),disabled:a.disabled})),
    cspPolicy: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? '',
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches };`);
  s.observations[name] = { dom, screenshot: await page.shot(`${name}.png`), csp: [...page.csp], errors: [...page.errors] };
  check(s, `${name}: no horizontal overflow`, !dom.overflow);
  check(s, `${name}: no runtime exception`, page.errors.length === 0);
  check(s, `${name}: CSP is active without reported violations`, dom.cspPolicy.includes("script-src 'self'") && page.csp.length === 0);
  return dom;
}
async function narrow(page) { await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }); }
async function desktop(page) { await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); }
const HELP_READY = `return !!$('.help-body') && !$('.help-body[aria-busy="true"]') && !!button('Refresh cases');`;
const QUEUE_READY = `return !!$('.case-queue') && !$('.case-queue[aria-busy="true"]') && !!button('Refresh cases');`;
async function openHelp(page, how = `${ORIGINS.web}/gcsp/help`) {
  return freshDocument(page, how, { ready: HELP_READY, readPath: '/cases', what: 'current employee Help' });
}
async function openQueue(page) {
  return freshDocument(page, `${ORIGINS.web}/gcsp/greg/cases`, { ready: QUEUE_READY, readPath: '/scheme-team/cases', what: 'current Greg queue' });
}
let caseId;
async function ownCase() { return (await value('paula', `/cases?caseId=${encodeURIComponent(caseId)}`)).case; }
async function openCase(page) {
  const from = page.log.length;
  const selected = await page.act(`const b = [...main.querySelectorAll('gcsp-data-table button[data-row-id]')].find(r=>r.dataset.rowId===${JSON.stringify(caseId)});
    if(!b || b.disabled) return false; b.click(); return true;`);
  if (!selected) throw new Error('Current Greg table has no Paula Open control');
  await page.until(`return !!$('[data-case-id="${caseId}"] [data-case-editor]') && !$('.case-queue[aria-busy="true"]');`, 15000, 'selected current case options');
  await page.settle();
  const read = page.calls(from).find(e => e.path === '/scheme-team/cases/options' && e.status === 200);
  if (!read?.auth || read.response?.value?.case?.caseId !== caseId) throw new Error('Greg options did not come from the signed Java read');
  return read.response.value;
}
async function fillUpdate(page, status, remedy = 'manual', decision = 'A scheme-team adviser will contact Paula to agree the renewal.') {
  const data = {status, reason: 'Reviewed the current renewal and permitted options.', nextAction: 'Scheme team to contact Paula with the recorded decision.', dueAt: '2030-01-01T09:00:00', remedyKey: remedy};
  for (const [field, value] of Object.entries(data)) {
    if (!await page.act(`return setValue('[id$="-${field}"]', ${JSON.stringify(value)});`)) throw new Error(`Missing editable case field ${field}`);
  }
  if (remedy === 'manual' && !await page.act(`return setValue('[id$="-decision"]', ${JSON.stringify(decision)});`)) throw new Error('Missing manual decision field');
}
async function reviewUpdate(page, s, label) {
  const from = page.log.length;
  check(s, `${label}: review button available`, await page.act(`return press('Review case update');`));
  await page.until(`return !!$('[data-case-review]') && !!button('Confirm case update');`, 10000, 'explicit Greg review');
  await page.settle();
  check(s, `${label}: review sends no command`, !page.calls(from).some(e => e.method === 'POST'));
  check(s, `${label}: review receives focus`, await page.act(`return document.activeElement?.hasAttribute('data-case-review');`));
  return from;
}
async function confirmUpdate(page, s, label, from) {
  check(s, `${label}: confirm available`, await page.act(`return press('Confirm case update');`));
  const posts = await waitPost(page, from, '/scheme-team/cases/update'); s.observations[`${label} browser commands`] = posts;
  check(s, `${label}: one signed scoped update`, posts.length === 1 && posts[0].auth && !posts[0].request?.carriesIdentity && posts[0].request?.caseId === caseId);
  check(s, `${label}: Java acknowledged`, posts[0].status === 200 && posts[0].response?.status === 'ok');
  await page.until(`return !$('.case-queue[aria-busy="true"]') && !$('.case-confirmation');`, 10000, 'Greg update readback');
  return posts[0].response.value.case;
}
async function helpJourney(cdp, s, pages) {
  const page = pages.paula = await newPage(cdp, 'Paula Help private context'); await signIn(page);
  const read = await openHelp(page);
  check(s, 'empty Help is an actual authorized read', read.auth && read.response?.value?.cases?.length === 0);
  check(s, 'empty Help stays useful', await page.act(`return text().includes('No renewal case') && !!button('Ask for help');`));
  await snapshot(page, s, 'help-empty-desktop');
  await narrow(page); await snapshot(page, s, 'help-empty-narrow'); await desktop(page);
  const from = page.log.length;
  check(s, 'ask action opens reason', await page.act(`return press('Ask for help');`));
  await page.until(`return !!$('textarea');`, 10000, 'help reason');
  check(s, 'reason is editable', await page.act(`return setValue('textarea', 'My replacement may miss my contract end. Please review my renewal.');`));
  check(s, 'request can be reviewed', await page.act(`return press('Review help request');`));
  await page.until(`return !!button('Confirm help request');`, 10000, 'explicit Help confirmation');
  await page.settle(); check(s, 'ask and review make no write', !page.calls(from).some(e => e.method === 'POST'));
  await snapshot(page, s, 'help-request-review');
  check(s, 'employee explicitly confirms', await page.act(`return press('Confirm help request');`));
  const posts = await waitPost(page, from, '/cases'); s.observations.browserCommand = posts;
  const record = posts[0]?.response?.value?.case; caseId = record?.caseId;
  check(s, 'one signed Java-owned help command', posts.length === 1 && posts[0].auth && !posts[0].request?.carriesIdentity && posts[0].status === 200 && record?.employeeId === 'employee-paula' && record.runId === RUN_ID);
  check(s, 'case has actual named ownership and status', record.status === 'open' && !!record.owner?.name && !!record.nextAction && record.version > 0);
  await openHelp(page); const dom = await snapshot(page, s, 'help-owned-open');
  check(s, 'owned named case is rendered', dom.caseIds.includes(caseId) && dom.text.includes(record.owner.name));
}
async function gregJourney(cdp, s, pages) {
  const greg = pages.greg = await newPage(cdp, 'Greg queue private context'); await signIn(greg, 'greg');
  const read = await openQueue(greg);
  check(s, 'Greg sees authorized case', read.auth && read.response?.value?.cases?.some(c=>c.caseId===caseId));
  await snapshot(greg, s, 'greg-queue-desktop'); await narrow(greg); await snapshot(greg, s, 'greg-queue-narrow'); await desktop(greg);
  const options = await openCase(greg); s.observations.options = options;
  check(s, 'actual feasible manual option and permitted transition', options.nextStatuses.includes('in-progress') && options.options.manualDecision.available === true);
  await fillUpdate(greg, 'in-progress');
  const from = await reviewUpdate(greg, s, 'manual decision'); await snapshot(greg, s, 'greg-manual-review');
  const updated = await confirmUpdate(greg, s, 'manual decision', from);
  check(s, 'manual remedy is persisted by Java', updated.status === 'in-progress' && updated.remedy?.type === 'manual-decision');
  await openHelp(pages.paula); const dom = await snapshot(pages.paula, s, 'employee-manual-readback');
  const truth = await ownCase(); s.observations.employeeTruth = truth;
  check(s, 'employee receives actual remedy and named owner', truth.version === updated.version && dom.text.includes(updated.remedy.decision) && dom.text.includes(updated.owner.name));
}
async function authorityAndStale(cdp, s, pages) {
  const before = await ownCase();
  const body = { commandId: command(), caseId, expectedVersion: before.version, status: 'remedy-proposed', reason: 'Current authorized review.', nextAction: 'Contact Paula.', dueAt: '2030-01-01T09:00:00Z', remedy: { type:'manual-decision', decision:'Reviewed by the scheme team.' } };
  const tests = [
    ['other employee case', 'alex', `/cases?caseId=${encodeURIComponent(caseId)}`, undefined, 403],
    ['employee cannot list Greg queue', 'paula', '/scheme-team/cases', undefined, 403],
    ['employee cannot update Greg case', 'paula', '/scheme-team/cases/update', body, 403],
    ['Greg cannot use employee Help', 'greg', '/help', undefined, 403],
    ['presenter cannot read employee case', 'presenter', `/cases?caseId=${encodeURIComponent(caseId)}`, undefined, 403],
    ['presenter cannot update Greg case', 'presenter', '/scheme-team/cases/update', body, 403],
    ['employee query override refused', 'paula', '/cases?employeeId=employee-alex', undefined, 400],
    ['Greg query override refused', 'greg', '/scheme-team/cases?employeeId=employee-paula', undefined, 400],
    ['repeated case identifier refused', 'paula', `/cases?caseId=${caseId}&caseId=${caseId}`, undefined, 400],
    ['identity in help body refused', 'paula', '/cases', {commandId:command(),reason:'Private probe',employeeId:'employee-alex'}, 400],
  ];
  s.observations.apiNegativeProbes = [];
  for (const [name, person, suffix, input, expected] of tests) {
    const r = await call(person, suffix, input); s.observations.apiNegativeProbes.push({name,person,method:input?'POST':'GET',suffix,result:r});
    check(s, `${name}: real backend refusal`, r.status === expected && r.json?.status !== 'ok' && !r.json?.value);
    check(s, `${name}: no private case payload`, !JSON.stringify(r.json).includes('"history"') && !JSON.stringify(r.json).includes('"remedy"'));
  }
  const bad = signJwt(accessClaims('sub-paula',['employee']), newKeys().privateKey);
  const signature = await request('GET','/cases',{Authorization:`Bearer ${bad}`}); s.observations.invalidSignature = signature;
  check(s, 'invalid signature refused by backend', signature.status === 401 && !signature.json?.value);
  check(s, 'negative probes did not mutate case', same(before, await ownCase()));
  const greg = pages.greg; await openQueue(greg); await openCase(greg); await fillUpdate(greg,'remedy-proposed');
  const from = await reviewUpdate(greg,s,'stale review');
  const changed = await value('greg','/scheme-team/cases/update',body); s.observations.explicitApiConcurrentUpdate = {label:'API setup for stale browser race', case:changed.case};
  check(s,'concurrent Java write advanced version',changed.case.version === before.version+1);
  await greg.act(`return press('Confirm case update');`);
  const sent = await waitPost(greg,from,'/scheme-team/cases/update'); s.observations.staleBrowserResponse = sent;
  check(s,'stale browser command refused by Java',sent.length===1 && sent[0].status===409 && sent[0].response?.code==='stale-version');
  await greg.until(`return !$('.case-queue[aria-busy="true"]') && /changed|refresh|current/i.test(text());`,10000,'useful stale state');
  await snapshot(greg,s,'greg-stale-refusal');
  check(s,'stale refusal preserves current authoritative version',(await ownCase()).version===changed.case.version);
  const denied = await newPage(cdp,'Presenter actual role denial'); await signIn(denied,'presenter');
  await denied.send('Page.navigate',{url:`${ORIGINS.web}/gcsp/help`});
  await denied.until(`return /cannot|not authorized|not available|access|permission/i.test(text()) && !$('.help-detail');`,15000,'presenter denied route');
  const dom = await snapshot(denied,s,'presenter-denied-help');
  check(s,'denied route contains no private case',!dom.caseIds.length && !dom.text.includes(caseId));
}
async function preferenceJourney(s, pages) {
  s.observations.setupAllocation = {label:'Explicit setup API tick; Java creates real offer/hold/quote',result:await tick()};
  const offers = (await value('paula','/offers/current')).offers;
  const pending = offers.find(o=>['active','pending'].includes(o.state));
  if(!pending) throw new Error('Setup allocation did not create Paula offer');
  const owner = await value('paula',`/offers/${encodeURIComponent(pending.offerId)}`);
  const declined = await value('paula',`/offers/${encodeURIComponent(pending.offerId)}/decision`,{commandId:command(),runId:RUN_ID,decision:'decline',expectedQuoteVersion:owner.quote.revisions.quote,expectedOfferVersion:owner.offerVersion,expectedHoldVersion:owner.holdVersion,reasonCode:'body-style'});
  s.observations.setupDecline = {label:'Explicit signed employee API setup; actual Java decline, not an inserted decision',offerId:pending.offerId,result:declined};
  check(s,'real unused decline exists',declined.state==='declined' && !!declined.decisionId);
  const greg=pages.greg; await openQueue(greg); await openCase(greg);
  await fillUpdate(greg,'in-progress'); let from=await reviewUpdate(greg,s,'resume case'); await confirmUpdate(greg,s,'resume case',from);
  await openQueue(greg); const options=await openCase(greg);
  const items=options.options.preferenceRelaxations.items; const index=items.findIndex(p=>p.valueType==='enum' && p.values?.length);
  check(s,'server supplies feasible preference proposal',options.options.preferenceRelaxations.available && index>=0);
  const selected=items[index]; s.observations.selectedPreference=selected;
  await fillUpdate(greg,'remedy-proposed',`preference:${index}`);
  check(s,'proposal value selected from server options',await greg.act(`return setValue('[id$="-preferenceValue"]','0');`));
  from=await reviewUpdate(greg,s,'preference proposal'); await snapshot(greg,s,'greg-preference-review');
  const proposed=await confirmUpdate(greg,s,'preference proposal',from);
  check(s,'proposal requires actual employee confirmation',proposed.remedy?.type==='preference-relaxation' && proposed.remedy.confirmationState==='employee-confirmation-required');
  const page=pages.paula; await openHelp(page);
  const briefBefore=await value('paula','/brief'); s.observations.briefBefore=briefBefore;
  const begin=page.log.length; check(s,'employee may review exact proposal',await page.act(`return press('Review preference change');`));
  await page.until(`return !!button('Confirm preference change');`,10000,'employee preference review'); await page.settle();
  check(s,'preference review makes no write',!page.calls(begin).some(e=>e.method==='POST'));
  await snapshot(page,s,'employee-preference-review-desktop'); await narrow(page); await snapshot(page,s,'employee-preference-review-narrow'); await desktop(page);
  check(s,'employee explicitly confirms exact preference',await page.act(`return press('Confirm preference change');`));
  const posts=await waitPost(page,begin,'/brief/change-after-decline'); s.observations.employeeConfirmation=posts;
  check(s,'one actual signed brief confirmation',posts.length===1 && posts[0].auth && posts[0].status===200 && posts[0].response?.status==='ok' && !posts[0].request?.carriesIdentity);
  const after=await value('paula','/brief'); s.observations.briefAfter=after;
  const brief=after.brief ?? after;
  const audit=brief.postDeclineChange ?? after.postDeclineChange;
  check(s,'audit names employee and exact proposal',audit?.confirmedBy==='sub-paula' && audit.decisionId===selected.decisionId && audit.path===selected.path && audit.fromBriefVersion===selected.expectedBriefVersion && same(audit.after,proposed.remedy.value));
  check(s,'essentials preserved',same((briefBefore.brief ?? briefBefore).essentials,brief.essentials));
  check(s,'brief advanced once',(brief.briefVersion ?? after.briefVersion)===selected.expectedBriefVersion+1);
  await openHelp(page); const own=await ownCase(); s.observations.confirmedCase=own;
  check(s,'case readback recognizes confirmation',own.relaxation?.confirmed===true);
  await snapshot(page,s,'employee-preference-confirmed');
}
async function recoveryAndPrivate(cdp,s,pages) {
  const before=await ownCase(); await stopApi(); await startApi(); await openHelp(pages.paula);
  check(s,'restart preserves actual owned case and remedy',same(before,await ownCase()));
  const page=pages.paula;
  await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const dom=await snapshot(page,s,'help-reduced-motion'); check(s,'reduced motion preference applied',dom.reducedMotion);
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  const focus=await page.eval(`({tag:document.activeElement?.tagName,outline:getComputedStyle(document.activeElement).outlineStyle,outlineWidth:getComputedStyle(document.activeElement).outlineWidth})`); s.observations.keyboardFocus=focus;
  check(s,'keyboard reaches visible focusable control',['A','BUTTON','INPUT','SELECT','TEXTAREA','SUMMARY'].includes(focus.tag) && focus.outline!=='none' && focus.outlineWidth!=='0px');
  await page.send('Fetch.enable',{patterns:[{urlPattern:`${API_BASE}/cases*`,requestStage:'Request'},{urlPattern:`${API_BASE}/help`,requestStage:'Request'}]});
  const abort=(m)=>{if(m.sessionId===page.sid && m.method==='Fetch.requestPaused') void page.send('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'ConnectionFailed'});}; cdp.listeners.push(abort);
  try {
    await freshDocument(page,`${ORIGINS.web}/gcsp/help`,{ready:`return text().includes('unavailable') && !$('.help-detail');`,readPath:'/cases',readOk:false,what:'labelled case-read transport failure'});
    const failed=await snapshot(page,s,'help-transport-unavailable');
    s.observations.transportSubstitution={kind:'CDP transport abort only',backendRefusal:false,affectedRoutes:['GET /help','GET /cases']};
    check(s,'transport failure hides private cases and offers refresh',!failed.caseIds.length && failed.text.includes('Refresh cases') && !failed.text.includes(caseId));
  } finally { cdp.listeners=cdp.listeners.filter(f=>f!==abort); await page.send('Fetch.disable'); }
  await openHelp(page);
  await page.eval(`document.querySelector('summary.gcsp-account-summary').click(); document.querySelector('button.gcsp-account-signout').click();`);
  await page.until(`return !!button('Sign in');`,15000,'actual signout');
  const signedOut=await snapshot(page,s,'signed-out-private'); check(s,'signout clears case details',!signedOut.caseIds.length && !signedOut.text.includes(caseId));
  await signIn(page,'alex'); const read=await openHelp(page); const alex=await snapshot(page,s,'alex-same-context-private');
  check(s,'other login cannot retain Paula case',read.auth && !read.response.value.cases.some(c=>c.caseId===caseId) && !alex.caseIds.includes(caseId) && !alex.text.includes(before.reason));
}

// ---------- main ----------
function accessLog() {
  const rows = [];
  for (const p of receipt.processes.filter((x) => x.name.startsWith('api-'))) {
    for (const l of tail(path.join(dirs.logs, `${p.name}.log`), 100000).split('\n')) { const m = /ACCESSLOG (\S+) (\S+) (\d+)/.exec(l); if (m && (/\/(help|cases|scheme-team|brief|offers|context|presenter)/.test(m[2]))) rows.push(`${p.name} ${m[1]} ${m[2].replace(API_PATH, '')} ${m[3]}`); }
  }
  return rows.slice(-80);
}
async function main() {
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  for (const [k, p] of Object.entries(PORTS)) if (!(await portFree(p))) throw new Error(`port ${p} (${k}) is in use; choose PROOF_${k.toUpperCase()}_PORT`);
  receipt.parentReservation = process.env.TEST_RESOURCE_PARENT_RESERVATION ?? null;
  receipt.inputs = { scratch: PROOF, publicMailBaseUrl: PUBLIC_BASE_URL, database: { source: DB_SOURCE, host: DB[1], port: DB[2] ?? '5432', name: DB_NAME, schema: SCHEMA }, ports: PORTS, jar: { path: path.relative(ROOT, JAR), sha256: sha256File(JAR) },
    appJars: readdirSync(path.join(path.dirname(JAR), 'app')).filter((f) => f.endsWith('.jar')).map((f) => ({ file: f, sha256: sha256File(path.join(path.dirname(JAR), 'app', f)) })), psql: { path: PSQL, sha256: sha256File(PSQL) }, media: MEDIA_FILES.map((name) => ({ name, sha256: sha256File(path.join(MEDIA_ROOT, name)) })), webBrowser: { path: path.relative(ROOT, WEB_BROWSER), indexSha256: sha256File(path.join(WEB_BROWSER, 'index.html')) } };
  receipt.composition = { identity: 'oidc (local test issuer)', subjects: PEOPLE.map((p) => ({ subject: `sub-${p}`, employeeId: `employee-${p}` })), account: 'repository', scenario: 'none (explicit upstream fixture)', ordering: 'synthetic', cases: 'real Java case services and repository', buddy: 'local-synthetic allocation setup', resetAllowed: true, environmentId: ENVIRONMENT_ID, runId: RUN_ID, policyVersion: POLICY, mirrors: 'BuddyJourneySeed-equivalent upstream records only; actual Java case and remedy outcomes' };
  receipt.sourceRevision = { value: SOURCE_REVISION, provenance: 'PROOF_SOURCE_REVISION supplied and verified by the parent; not read from git here' };
  receipt.tools = { harnessNode: process.version, openssl: cap('openssl', ['version']), chrome: cap(CHROME, ['--version']), java: (spawnSync(path.join(JAVA_HOME, 'bin/java'), ['-version'], { encoding: 'utf8', env: childEnv(process.env) }).stderr ?? '').split('\n')[0] };
  receipt.tools.psql = cap(PSQL, ['--version']);
  const serverVersion = Number(cap(PSQL, ['-X','-A','-t','-h',DB[1].replace(/[\[\]]/g,''),'-p',DB[2] ?? '5432','-U',process.env.PROOF_DB_USER ?? 'gcsp','-d',DB_NAME,'-c','SHOW server_version_num'], { env: childEnv({PATH:process.env.PATH,HOME:process.env.HOME,PGPASSWORD:process.env.PROOF_DB_PASSWORD ?? '',PGCONNECT_TIMEOUT:'10'}) }));
  if (!/PostgreSQL\) 17\./.test(receipt.tools.psql) || serverVersion < 170000 || serverVersion >= 180000) throw new Error('Proof requires native PostgreSQL 17 client and server');
  receipt.inputs.database.serverVersion = serverVersion;
  writePlan();
  log('certificates'); tls = makeCerts();
  log('static assembly of the prebuilt web');
  const assemble = await import(pathToFileURL(path.join(ROOT, 'scripts/build-gcsp-static.mjs')).href);
  await runOnce('assemble', process.execPath, ['scripts/build-gcsp-static.mjs', '--browser', WEB_BROWSER, '--output', dirs.static, '--environment', 'deployed', '--revision', SOURCE_REVISION],
    { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp, GCSP_PUBLIC_ENVIRONMENT_ID: ENVIRONMENT_ID, GCSP_PUBLIC_API_BASE_URL: API_BASE, GCSP_PUBLIC_OIDC_AUTHORITY: ISSUER, GCSP_PUBLIC_OIDC_CLIENT_ID: 'gcsp-web',
      GCSP_PUBLIC_OIDC_SCOPE: 'openid profile gcsp-api', GCSP_PUBLIC_OIDC_REDIRECT_URI: `${ORIGINS.web}/gcsp/auth/callback`, GCSP_PUBLIC_OIDC_POST_LOGOUT_REDIRECT_URI: `${ORIGINS.web}/gcsp/` });
  const manifest = path.join(dirs.static, 'gcsp/static-manifest.json');
  receipt.inputs.compiledAssembly = {sha256:sha256File(manifest), manifest:JSON.parse(readFileSync(manifest,'utf8'))};
  log('issuer and web'); await startIdp(tls); await startWeb(tls, assemble.GCSP_FIXED_ROUTES);
  log('API (repository accounts, native PG)'); await startApi();
  log('seed upstream accounts, briefs and unreleased stock'); await seedSources();
  const profile = path.join(dirs.browser, 'profile'); mkdirSync(profile, { recursive: true });
  const chrome = spawnOwned('chrome', CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-allow-origins=*', `--ignore-certificate-errors-spki-list=${tls.spki}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--window-size=1280,900', 'about:blank'], { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp });
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) { if (chrome.done) throw new Error('Chrome exited during startup'); try { const [p, ws] = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n'); wsUrl = `ws://127.0.0.1:${p}${ws}`; } catch { await sleep(250); } }
  if (!wsUrl) throw new Error('Chrome DevTools endpoint not found');
  const cdp = await Cdp.connect(wsUrl); receipt.cdp = cdp;
  const pages = {};
  await scenario('help', 'Employee empty Help, explicit request and owned named case', 'AC1,AC2', s => helpJourney(cdp,s,pages));
  await scenario('greg', 'Greg permitted manual remedy and employee readback', 'AC1', s => gregJourney(cdp,s,pages));
  await scenario('authority', 'Backend role, owner, signature, query and stale refusals', 'AC2', s => authorityAndStale(cdp,s,pages));
  await scenario('preference', 'Feasible Greg preference proposal and explicit employee confirmation', 'AC1,AC2', s => preferenceJourney(s,pages));
  await scenario('recovery', 'Restart, transport unavailable, keyboard, reduced motion and login privacy', 'AC2', s => recoveryAndPrivate(cdp,s,pages));
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
  const required = ['help','greg','authority','preference','recovery'];
  receipt.originalAcceptance = {
    AC1: { text: 'Users see authorized cases, named ownership, real status and permitted feasible remedies/actions.', scenarios: ['help','greg','preference'], evidence: ['help','greg','preference'].every(ok) ? 'pass' : 'incomplete', closure: 'OPEN: parent review and batch acceptance decide' },
    AC2: { text: 'Empty, unavailable, stale and denied cases remain useful and private; employee and Greg authority are enforced by the backend.', scenarios: ['help','authority','preference','recovery'], evidence: ['help','authority','preference','recovery'].every(ok) ? 'pass' : 'incomplete', closure: 'OPEN: Safari/hosted and parent acceptance remain separate' }
  };
  receipt.overall = required.every(ok) && !runError && !logLimitFailure && receipt.teardown?.allOwnedExited ? 'PASS' : 'FAIL';
  const file = path.join(dirs.evidence, 'connected-case-proof.json');
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
