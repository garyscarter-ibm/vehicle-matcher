#!/usr/bin/env node
// FUCQ-435 local cross-origin proof: HTTPS web, API and a LOCAL TEST OIDC issuer (not the real provider), driven by headless Chrome.
// API runs the documented dev composition on a run-owned PostgreSQL database. Zero dependencies; scratch is removed on exit, receipt and screenshots kept.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, createSign, generateKeyPairSync, randomBytes, createPublicKey } from 'node:crypto';
import { createServer } from 'node:https';
import https from 'node:https';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, rmdirSync, readdirSync, statSync, createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRATCH = path.resolve(process.env.SCRATCH ?? '/tmp/vm-poller-DEV-2026-11-13-003/proof');
const EVIDENCE = path.join(ROOT, 'docs/gcsp/evidence/fucq435/2026-11-17');
const DEADLINE_MS = Number(process.env.PROOF_DEADLINE_SEC ?? 900) * 1000;
const PG = { bin: '/opt/homebrew/opt/postgresql@17/bin', host: '127.0.0.1', port: '55491', user: 'gcsp', db: 'gcsp_dev20261113003_proof' };
const JAVA_LOCK = '/tmp/vm-poller-java-verify.lock';
const DB_URL = 'jdbc:postgresql://127.0.0.1:55491/gcsp_dev20261113003_proof';
const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const NODE_VERSION = '24.22.3';
const ORIGINS = { web: 'https://gcsp-web.localhost:7443', api: 'https://gcsp-api.localhost:8443', idp: 'https://gcsp-idp.localhost:9443', evil: 'https://evil.localhost:7444' };
const ISSUER = `${ORIGINS.idp}/realms/gcsp-local`;
const API_BASE = `${ORIGINS.api}/api/gcsp/v1`;
const KID = 'gcsp-local-test-1';
const TRUST_PASS = 'proof-local-trust';
const dirs = { logs: path.join(SCRATCH, 'logs'), tmp: path.join(SCRATCH, 'tmp'), certs: path.join(SCRATCH, 'certs'), node: path.join(SCRATCH, 'node'), static: path.join(SCRATCH, 'static'), browser: path.join(SCRATCH, 'browser') };
const startedAt = new Date().toISOString();
const shots = [];
const receipt = { productDefects: [], schema: 'fucq435-cross-origin-proof/1', story: 'DEV-2026-11-13-003 / FUCQ-435', startedAt, origins: ORIGINS, localTestIssuer: `LOCAL TEST OIDC ISSUER ${ISSUER}: harness only, not the real provider and not committed configuration`, tools: {}, deviations: [], scenarios: {}, gaps: ['Actual hosted Render origins and real OIDC provider registration do not exist yet (Gary creates them); not proven here.'], failureLogs: {} };
const cleanups = [];
let finished = false;
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const T0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256b64u = (s) => createHash('sha256').update(s).digest('base64url');
const tail = (file, n = 40) => { try { return readFileSync(file, 'utf8').split('\n').slice(-n).join('\n'); } catch { return ''; } };
const pickTyped = (j) => (j && typeof j === 'object' ? Object.fromEntries(['status', 'code', 'reason', 'retryable'].filter((k) => k in j).map((k) => [k, j[k]])) : null);

// ---------- child processes ----------
function run(name, cmd, args, { cwd = ROOT, env = {}, timeout = 120000, detached = false } = {}) {
  const logFile = path.join(dirs.logs, `${name}.log`);
  const out = createWriteStream(logFile);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...baseEnv(), ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    child.stdout.pipe(out, { end: false }); child.stderr.pipe(out, { end: false });
    const timer = setTimeout(() => { killGroup(child, 'SIGKILL'); reject(new Error(`${name} timed out after ${timeout / 1000}s`)); }, timeout);
    child.on('exit', (code) => { clearTimeout(timer); out.end(); if (code === 0) resolve(logFile); else { receipt.failureLogs[name] = tail(logFile); reject(new Error(`${name} exited ${code}`)); } });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}
function baseEnv() { return { PATH: `${path.join(dirs.node, 'bin')}:${process.env.PATH}`, HOME: process.env.HOME, TMPDIR: dirs.tmp, TMP: dirs.tmp, TEMP: dirs.tmp, JAVA_HOME, LANG: 'en_GB.UTF-8' }; }
function killGroup(child, sig = 'SIGTERM') { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* gone */ } } }
function spawnLong(name, cmd, args, env) {
  const out = createWriteStream(path.join(dirs.logs, `${name}.log`));
  const child = spawn(cmd, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.stdout.pipe(out); child.stderr.pipe(out);
  child.exited = new Promise((r) => child.on('exit', (c) => { child.done = true; r(c); }));
  cleanups.push(async () => { if (!child.done) { killGroup(child, 'SIGTERM'); await Promise.race([child.exited, sleep(6000)]); if (!child.done) { killGroup(child, 'SIGKILL'); await Promise.race([child.exited, sleep(3000)]); } } });
  return child;
}
const cap = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 60000, ...opts }).trim();

// ---------- shared Java lock and proof database ----------
async function takeJavaLock() {
  const began = Date.now(); const end = began + 30 * 60000;
  for (let n = 0; ; n++) {
    try { mkdirSync(JAVA_LOCK); cleanups.push(() => { rmdirSync(JAVA_LOCK); receipt.javaLock.released = true; }); receipt.javaLock = { path: JAVA_LOCK, waitedSec: Math.round((Date.now() - began) / 1000), released: false }; return; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (Date.now() > end) throw new Error(`Java lock ${JAVA_LOCK} still held after 30 minutes`);
    if (n % 5 === 0) log('Java lock held by another run; retrying in 60 s');
    await sleep(60000);
  }
}
const pg = (args, bin = 'psql') => execFileSync(path.join(PG.bin, bin), ['-h', PG.host, '-p', PG.port, '-U', PG.user, ...args], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function createProofDb() {
  pg(['--if-exists', '--force', PG.db], 'dropdb'); pg([PG.db], 'createdb');
  cleanups.push(() => { pg(['--if-exists', '--force', PG.db], 'dropdb'); receipt.database.dropped = !pg(['-d', 'postgres', '-Atc', `select count(*) from pg_database where datname='${PG.db}'`]).startsWith('1'); });
  receipt.database = { server: `${PG.host}:${PG.port} (shared PostgreSQL 17, trust auth)`, name: PG.db, created: true, dropped: false };
}
const setProofDbConnections = (on) => { pg(['-d', 'postgres', '-c', `ALTER DATABASE ${PG.db} WITH ALLOW_CONNECTIONS ${on}`]); if (!on) pg(['-d', 'postgres', '-Atc', `SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname='${PG.db}'`]); };

// ---------- certificates and keys ----------
function makeCerts() {
  const c = (f) => path.join(dirs.certs, f);
  const ssl = (args, opts) => execFileSync('openssl', args, { cwd: dirs.certs, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, ...opts });
  ssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', c('ca.key')]);
  ssl(['req', '-x509', '-new', '-key', c('ca.key'), '-sha256', '-days', '3', '-subj', '/CN=GCSP local proof CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', c('ca.pem')]);
  ssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', c('leaf.key')]);
  ssl(['req', '-new', '-key', c('leaf.key'), '-subj', '/CN=gcsp-web.localhost', '-out', c('leaf.csr')]);
  writeFileSync(c('leaf.ext'), 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:gcsp-web.localhost,DNS:gcsp-api.localhost,DNS:gcsp-idp.localhost,DNS:evil.localhost,DNS:localhost,IP:127.0.0.1\n');
  ssl(['x509', '-req', '-in', c('leaf.csr'), '-CA', c('ca.pem'), '-CAkey', c('ca.key'), '-CAcreateserial', '-days', '3', '-sha256', '-extfile', c('leaf.ext'), '-out', c('leaf.pem')]);
  writeFileSync(c('fullchain.pem'), readFileSync(c('leaf.pem'), 'utf8') + readFileSync(c('ca.pem'), 'utf8'));
  const pub = ssl(['x509', '-in', c('leaf.pem'), '-pubkey', '-noout']);
  const der = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'der'], { input: pub });
  const spki = createHash('sha256').update(der).digest('base64');
  execFileSync(path.join(JAVA_HOME, 'bin/keytool'), ['-importcert', '-alias', 'gcsp-local-ca', '-file', c('ca.pem'), '-keystore', c('truststore.p12'), '-storetype', 'PKCS12', '-storepass', TRUST_PASS, '-noprompt'], { stdio: 'pipe', timeout: 60000 });
  return { ca: readFileSync(c('ca.pem'), 'utf8'), cert: readFileSync(c('fullchain.pem')), key: readFileSync(c('leaf.key')), keyPem: readFileSync(c('leaf.key'), 'utf8'), spki, trust: c('truststore.p12') };
}

// ---------- local test OIDC issuer ----------
const idp = { lifetimeSec: 3600, codes: new Map(), txns: new Map(), subjects: { 'sub-employee': ['employee'], 'sub-greg': ['greg'], 'sub-presenter': ['presenter'], 'sub-unmapped': ['employee'] }, keys: null, wrongKeys: null, server: null };
function newKeys() { const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }); return { privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' } }; }
function signJwt(payload, key, header = {}) {
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID, ...header }));
  const body = b64u(JSON.stringify(payload));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key);
  return `${head}.${body}.${b64u(sig)}`;
}
function accessClaims(sub, roles, over = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { iss: ISSUER, aud: ['gcsp-api'], azp: 'gcsp-web', scope: 'openid profile gcsp-api', sub, realm_access: { roles }, iat: now, exp: now + idp.lifetimeSec, jti: randomBytes(8).toString('hex'), ...over };
}
function startIdp(tls) {
  idp.keys = newKeys(); idp.wrongKeys = newKeys();
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
      if (q.get('client_id') !== 'gcsp-web' || q.get('redirect_uri') !== `${ORIGINS.web}/gcsp/auth/callback` || q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || !q.get('state')) return text(res, 400, 'invalid_request: client, redirect_uri, PKCE S256 or state rejected by the local test issuer');
      const txn = randomBytes(12).toString('hex');
      idp.txns.set(txn, { redirectUri: q.get('redirect_uri'), challenge: q.get('code_challenge'), state: q.get('state'), nonce: q.get('nonce') });
      const buttons = Object.keys(idp.subjects).map((s) => `<p><button type="submit" name="subject" value="${s}" data-subject="${s}">Sign in as ${s}</button></p>`).join('');
      return text(res, 200, `<!doctype html><title>Local test issuer</title><h1>LOCAL TEST ISSUER (not the real provider)</h1><form method="post" action="${base}/protocol/openid-connect/auth"><input type="hidden" name="txn" value="${txn}">${buttons}</form>`, 'text/html');
    }
    if (url.pathname === `${base}/protocol/openid-connect/auth` && req.method === 'POST') {
      const f = await form(); const t = idp.txns.get(f.get('txn')); idp.txns.delete(f.get('txn'));
      if (!t || !idp.subjects[f.get('subject')]) return text(res, 400, 'invalid_request');
      const code = randomBytes(16).toString('hex');
      idp.codes.set(code, { ...t, subject: f.get('subject') });
      const target = new URL(t.redirectUri); target.searchParams.set('code', code); target.searchParams.set('state', t.state);
      res.writeHead(302, { Location: target.href, 'Cache-Control': 'no-store' }); return res.end();
    }
    if (url.pathname === `${base}/protocol/openid-connect/token` && req.method === 'POST') {
      const f = await form(); const c = idp.codes.get(f.get('code')); idp.codes.delete(f.get('code'));
      if (f.get('grant_type') !== 'authorization_code' || !c || f.get('client_id') !== 'gcsp-web' || f.get('redirect_uri') !== c.redirectUri || sha256b64u(f.get('code_verifier') ?? '') !== c.challenge) return json(req, res, 400, { error: 'invalid_grant' });
      const now = Math.floor(Date.now() / 1000);
      const idToken = signJwt({ iss: ISSUER, sub: c.subject, aud: 'gcsp-web', azp: 'gcsp-web', iat: now, exp: now + 300, auth_time: now, ...(c.nonce ? { nonce: c.nonce } : {}) }, idp.keys.privateKey);
      const access = signJwt(accessClaims(c.subject, idp.subjects[c.subject]), idp.keys.privateKey);
      return json(req, res, 200, { access_token: access, token_type: 'Bearer', expires_in: idp.lifetimeSec, scope: 'openid profile gcsp-api', id_token: idToken });
    }
    if (url.pathname === `${base}/protocol/openid-connect/logout`) {
      const back = url.searchParams.get('post_logout_redirect_uri');
      if (back === `${ORIGINS.web}/gcsp/`) { res.writeHead(302, { Location: back }); return res.end(); }
      return text(res, 200, 'signed out of the local test issuer');
    }
    return text(res, 404, 'not found');
  });
  return new Promise((r) => idp.server.listen(9443, '127.0.0.1', r)).then(() => cleanups.push(() => new Promise((r) => { idp.server.closeAllConnections?.(); idp.server.close(r); })));
}

// ---------- static web and disallowed-origin servers ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.gif': 'image/gif', '.avif': 'image/avif' };
async function startWeb(tls, fixedRoutes) {
  const fixed = new Set(fixedRoutes.map((r) => r.replace(/\/$/, '') || '/'));
  const root = path.join(dirs.static, 'gcsp');
  const server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    let p = decodeURIComponent(new URL(req.url, ORIGINS.web).pathname);
    if (p === '/' || p === '/gcsp') { res.writeHead(302, { Location: '/gcsp/' }); return res.end(); }
    if (!p.startsWith('/gcsp/') || p.includes('..')) { res.writeHead(404); return res.end('not found'); }
    const norm = p.replace(/\/$/, '');
    let file = path.join(root, p.slice('/gcsp/'.length));
    if (fixed.has(norm) || /^\/gcsp\/offers\/[^/]+$/.test(norm)) file = path.join(root, 'index.html');
    else if (p.endsWith('/')) file = path.join(root, 'index.html');
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file);
    const noStore = ext === '.html' || ext === '.json';
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': noStore ? 'no-store' : 'public, max-age=31536000, immutable' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(7443, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
}
async function startEvil(tls, token) {
  const page = `<!doctype html><title>disallowed origin</title><p id="out">pending</p><script>
fetch(${JSON.stringify(`${API_BASE}/context`)},{headers:{Accept:'application/json',Authorization:'Bearer '+${JSON.stringify(token)}},credentials:'omit'})
.then(async r=>{window.__result='readable:'+r.status;document.getElementById('out').textContent='Response readable: '+r.status;})
.catch(e=>{window.__result='blocked:'+e.name;document.getElementById('out').textContent='Browser blocked the request (CORS): '+e.name;});</script>`;
  const server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(page); });
  await new Promise((r) => server.listen(7444, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
}

// ---------- direct HTTPS client (no browser) ----------
function request(origin, method, p, { headers = {}, body, ca } = {}) {
  const u = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port: Number(u.port), path: p, method, servername: u.hostname, headers: { Host: u.host, ...headers }, ca, timeout: 15000 }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    req.on('timeout', () => req.destroy(new Error('request timeout'))); req.on('error', reject); req.end(body);
  });
}

// ---------- CDP ----------
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(`${m.error.message}`)) : res(m.result); } else this.listeners.forEach((f) => f(m)); }); }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', () => j(new Error('CDP websocket failed'))); }); return new Cdp(ws); }
  send(method, params = {}, sessionId) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
}
const hdr = (h = {}, name) => Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1];
class Page {
  constructor(cdp, sessionId, ctxId) { this.cdp = cdp; this.sid = sessionId; this.ctxId = ctxId; this.log = []; this.byId = new Map(); this.early = new Map(); this.console = []; this.bodies = []; cdp.listeners.push((m) => m.sessionId === sessionId && this.event(m)); }
  send(method, params) { return this.cdp.send(method, params, this.sid); }
  event(m) {
    const p = m.params ?? {};
    if (m.method === 'Network.requestWillBeSent') {
      const prev = this.byId.get(p.requestId);
      if (p.redirectResponse && prev) { prev.status = p.redirectResponse.status; prev.acao = hdr(p.redirectResponse.headers, 'access-control-allow-origin'); }
      const e = { t: Date.now(), id: p.requestId, method: p.request.method, url: p.request.url, type: p.type, auth: !!hdr(p.request.headers, 'authorization') || this.early.get(p.requestId) === true };
      this.log.push(e); this.byId.set(p.requestId, e);
    } else if (m.method === 'Network.requestWillBeSentExtraInfo') {
      const e = this.byId.get(p.requestId); if (hdr(p.headers, 'authorization')) { if (e) e.auth = true; else this.early.set(p.requestId, true); }
    } else if (m.method === 'Network.responseReceived' || m.method === 'Network.responseReceivedExtraInfo') {
      const e = this.byId.get(p.requestId); if (!e) return;
      const status = p.response?.status ?? p.statusCode; const headers = p.response?.headers ?? p.headers;
      if (status) e.status = status; const a = hdr(headers, 'access-control-allow-origin'); if (a !== undefined) e.acao = a;
      for (const k of ['allow-methods', 'allow-headers', 'allow-credentials']) { const v = hdr(headers, `access-control-${k}`); if (v !== undefined) (e.cors ??= {})[k] = v; }
    } else if (m.method === 'Network.loadingFailed') {
      const e = this.byId.get(p.requestId); if (e) { e.failed = p.errorText; e.corsError = p.corsErrorStatus?.corsError; e.blocked = p.blockedReason; }
    } else if (m.method === 'Network.loadingFinished') {
      const e = this.byId.get(p.requestId);
      if (e && e.url.includes('/api/gcsp/v1/') && e.method !== 'OPTIONS') this.bodies.push(this.send('Network.getResponseBody', { requestId: p.requestId }).then((r) => { try { e.body = pickTyped(JSON.parse(r.body)); } catch { e.body = null; } }).catch(() => {}));
    } else if (m.method === 'Log.entryAdded') { if (this.console.length < 20) this.console.push(`${p.entry.source}/${p.entry.level}: ${p.entry.text.slice(0, 300)}`); }
  }
  async eval(expression) { const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.text}`); return r.result.value; }
  async waitFor(expression, timeout = 25000, what = expression) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { try { if (await this.eval(`Boolean(${expression})`)) return true; } catch { /* navigating */ } await sleep(250); }
    const where = await this.eval('location.href').catch(() => '?'); const text = await this.eval(`document.body.innerText.replace(/\\s+/g,' ').slice(0,300)`).catch(() => '?');
    throw new Error(`timed out waiting for ${what}; page ${where.replace(/\?.*/, '?...')} text: ${text}`);
  }
  async main() { try { return await this.eval(`(document.querySelector('#gcsp-main')??document.body).innerText.replace(/\\s+/g,' ').trim()`); } catch { return ''; } }
  async shot(name) { const r = await this.send('Page.captureScreenshot', { format: 'png' }); mkdirSync(EVIDENCE, { recursive: true }); writeFileSync(path.join(EVIDENCE, name), Buffer.from(r.data, 'base64')); shots.push(name); return name; }
  async shotBoth(base) {
    const out = [];
    for (const [w, h, tag] of [[1280, 800, '1280x800'], [390, 844, '390x844']]) { await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 }); await sleep(700); out.push(await this.shot(`${base}-${tag}.png`)); }
    await this.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 720, deviceScaleFactor: 1, mobile: false });
    return out;
  }
  async settle() { await Promise.allSettled(this.bodies); }
  api() { return this.log.filter((e) => e.url.startsWith(ORIGINS.api)).map((e) => ({ method: e.method, path: new URL(e.url).pathname, type: e.type, status: e.status, acao: e.acao ?? null, authorizationSent: e.auth, ...(e.cors ? { cors: e.cors } : {}), ...(e.failed ? { failed: e.failed, corsError: e.corsError } : {}), ...(e.body ? { body: e.body } : {}) })); }
}
async function newPage(cdp) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, sessionId, browserContextId);
  await page.send('Page.enable'); await page.send('Network.enable'); await page.send('Network.setCacheDisabled', { cacheDisabled: true }); await page.send('Runtime.enable'); await page.send('Log.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 720, deviceScaleFactor: 1, mobile: false });
  return page;
}
const closePage = async (cdp, page) => { await page.settle(); await cdp.send('Target.disposeBrowserContext', { browserContextId: page.ctxId }).catch(() => {}); };
async function signInAs(page, subject, from = `${ORIGINS.web}/gcsp/`) {
  await page.send('Page.navigate', { url: from });
  await page.waitFor(`location.origin==='${ORIGINS.web}' && [...document.querySelectorAll('#gcsp-main button')].some(b=>b.textContent.trim()==='Sign in')`, 25000, 'sign-in page');
  await page.eval(`[...document.querySelectorAll('#gcsp-main button')].find(b=>b.textContent.trim()==='Sign in').click()`);
  await chooseSubject(page, subject);
}
async function chooseSubject(page, subject) {
  await page.waitFor(`location.origin==='${ORIGINS.idp}' && document.querySelector('button[data-subject="${subject}"]')`, 25000, 'issuer login form');
  await page.eval(`document.querySelector('button[data-subject="${subject}"]').click()`);
}

// ---------- scenarios ----------
async function scenario(id, title, fn) {
  const s = { title, pass: false, checks: {}, observations: {} };
  receipt.scenarios[id] = s; log(`scenario ${id}: ${title}`);
  try { await fn(s); } catch (e) { s.checks.noException = false; s.error = e.message; }
  s.pass = Object.keys(s.checks).length > 0 && Object.values(s.checks).every((v) => v === true);
  log(`scenario ${id}: ${s.pass ? 'PASS' : 'FAIL'}${s.error ? ` (${s.error})` : ''}`);
}
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const mint = (sub, roles, over, key = idp.keys.privateKey) => signJwt(accessClaims(sub, roles, over), key);
const direct = (ctx, method, p, token, body) => request(ORIGINS.api, method, `/api/gcsp/v1${p}`, { ca: ctx.tls.ca, headers: { Accept: 'application/json', Origin: ORIGINS.web, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
const uid = () => `proof-${randomBytes(6).toString('hex')}`;
const ORDER_SUBMIT = /\/manual\/order(\/|$)/;
const main$ = `(document.querySelector('#gcsp-main')??document.body).innerText`;
const clickButton = (page, text) => page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && !x.disabled); if (b) b.click(); return !!b; })()`);
// Edits the first enabled preference control (radio, else slider) the way a user would.
const editPreference = (page) => page.eval(`(() => {
  const r = [...document.querySelectorAll('.brief-form fieldset.full-preference:not([disabled]) input[type=radio]:not(:checked)')][0];
  if (r) { r.click(); return 'radio ' + r.name + ' = ' + (r.closest('label')?.textContent.trim() ?? ''); }
  const sl = [...document.querySelectorAll('.brief-form fieldset.full-preference:not([disabled]) input[type=range][id^="preference-"]')][0];
  if (sl) { const n = Number(sl.value) < Number(sl.max) ? Number(sl.value) + 1 : Number(sl.value) - 1; sl.value = String(n); sl.dispatchEvent(new Event('input', { bubbles: true })); return 'slider ' + sl.id + ' = ' + n; }
  return null; })()`);
const formState = (page) => page.eval(`[...document.querySelectorAll('.brief-form input')].map((i) => (i.type === 'radio' || i.type === 'checkbox' ? (i.checked ? 1 : 0) : i.value)).join(',')`);
const saveForm = (page) => page.eval(`(() => { const b = [...document.querySelectorAll('.brief-form button[type=submit]')].find((x) => /Save your preferences/.test(x.textContent)); if (b && !b.disabled) { b.click(); return true; } return false; })()`);
const gotoPreferences = async (page) => { await page.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/preferences` }); await page.waitFor(`document.querySelector('.brief-form')`, 40000, 'preferences form'); };

async function scenarioA(cdp, s, ctx) {
  idp.lifetimeSec = 3600;
  const page = await newPage(cdp);
  try {
    await signInAs(page, 'sub-employee');
    await page.waitFor(`location.pathname==='/gcsp/account'`, 30000, 'employee landing on /gcsp/account');
    s.observations.landedPath = await page.eval('location.pathname');
    await page.waitFor(`/Current car/.test(${main$}) && !/Loading your|Checking your/i.test(${main$})`, 30000, 'account page content');
    await sleep(2000); await page.settle();
    const api = page.api();
    const pre = api.find((e) => e.method === 'OPTIONS' && e.path.endsWith('/context'));
    const get = api.find((e) => e.method === 'GET' && e.path.endsWith('/context'));
    const acct = api.find((e) => e.method === 'GET' && e.path.endsWith('/manual/account'));
    s.observations.preflight = pre ?? null; s.observations.contextGet = get ?? null; s.observations.manualAccountGet = acct ?? null;
    s.observations.apiRequests = api.map((e) => `${e.method} ${e.path} ${e.status} ACAO=${e.acao}`);
    s.observations.accountVisibleText = (await page.main()).slice(0, 700);
    s.checks.browserPreflightObserved = !!pre && [200, 204].includes(pre.status);
    s.checks.preflightExactOrigin = pre?.acao === ORIGINS.web;
    s.checks.preflightNoCredentials = pre?.cors?.['allow-credentials'] !== 'true';
    s.checks.contextGet200WithBearer = get?.status === 200 && get.authorizationSent === true && get.acao === ORIGINS.web;
    s.checks.landedOnEmployeeAccount = s.observations.landedPath === '/gcsp/account';
    s.checks.manualAccountGet200WithBearer = acct?.status === 200 && acct.authorizationSent === true && acct.acao === ORIGINS.web;
    s.checks.accountShowsRealDataNotUnavailable = s.observations.accountVisibleText.length > 60 && !/unavailable|not available|couldn.t|failed/i.test(s.observations.accountVisibleText);
    s.observations.screenshot = await page.shot('a-employee-account.png');
    // A non-simple request from the real app: edit and save preferences (JSON body + Authorization triggers a preflight).
    await gotoPreferences(page);
    s.observations.edit = await editPreference(page);
    await page.waitFor(`/Unsaved/.test(${main$})`, 10000, 'unsaved note');
    s.observations.saveClicked = await saveForm(page);
    const until = Date.now() + 40000;
    while (Date.now() < until && !page.log.some((e) => e.url.endsWith('/brief/confirm') && e.method === 'POST' && e.status)) await sleep(300);
    await sleep(1000); await page.settle();
    const post = page.api().filter((e) => e.method === 'POST' && e.path.endsWith('/brief/draft'));
    const postPre = page.api().find((e) => e.method === 'OPTIONS' && e.path.endsWith('/brief/draft'));
    s.observations.postBriefDraft = post.map((e) => ({ status: e.status, acao: e.acao, auth: e.authorizationSent, body: e.body })); s.observations.postBriefDraftPreflight = postPre ?? null;
    s.observations.saveOutcomeText = (await page.eval(`[...document.querySelectorAll('.brief-form [role=status]')].map((n) => n.innerText.trim()).filter(Boolean).join(' | ')`)).slice(0, 300);
    s.observations.confirmPost = page.api().filter((e) => e.method === 'POST' && e.path.endsWith('/brief/confirm')).map((e) => ({ status: e.status, acao: e.acao }));
    s.checks.browserPostPreflightObserved = !!postPre && [200, 204].includes(postPre.status) && postPre.acao === ORIGINS.web && /POST/.test(postPre.cors?.['allow-methods'] ?? '') && /authorization/i.test(postPre.cors?.['allow-headers'] ?? '');
    s.checks.browserPostBearerExactOrigin = post.length >= 1 && post.every((e) => e.status === 200 && e.authorizationSent === true && e.acao === ORIGINS.web);
    const d1 = await request(ORIGINS.api, 'OPTIONS', '/api/gcsp/v1/context', { ca: ctx.tls.ca, headers: { Origin: ORIGINS.web, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
    const d2 = await request(ORIGINS.api, 'OPTIONS', '/api/gcsp/v1/brief/draft', { ca: ctx.tls.ca, headers: { Origin: ORIGINS.web, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
    const view = (r) => ({ status: r.status, acao: r.headers['access-control-allow-origin'] ?? null, allowHeaders: r.headers['access-control-allow-headers'] ?? null, allowMethods: r.headers['access-control-allow-methods'] ?? null, allowCredentials: r.headers['access-control-allow-credentials'] ?? null });
    s.observations.directPreflightGet = view(d1); s.observations.directPreflightPost = view(d2);
    s.checks.directPreflightGetExactOrigin = [200, 204].includes(d1.status) && d1.headers['access-control-allow-origin'] === ORIGINS.web;
    s.checks.directPreflightPostExactOriginAllowsPost = [200, 204].includes(d2.status) && d2.headers['access-control-allow-origin'] === ORIGINS.web && /POST/.test(d2.headers['access-control-allow-methods'] ?? '') && d2.headers['access-control-allow-credentials'] !== 'true';
  } finally { await closePage(cdp, page); }
}

async function scenarioB(cdp, s) {
  idp.lifetimeSec = 3600;
  const p1 = await newPage(cdp);
  try {
    await signInAs(p1, 'sub-unmapped');
    await p1.waitFor(`/access not available/i.test(${main$})`, 30000, 'denied state for unmapped subject');
    await sleep(500); await p1.settle();
    const ctxCall = p1.api().find((e) => e.method === 'GET' && e.path.endsWith('/context'));
    s.observations.unmapped = { apiContext: ctxCall ?? null, visibleText: (await p1.main()).slice(0, 300), path: await p1.eval('location.pathname') };
    s.checks.unmappedApi403 = ctxCall?.status === 403 && ctxCall.body?.code === 'subject-not-mapped';
    s.checks.unmappedUiAccessNotAvailable = /access not available/i.test(s.observations.unmapped.visibleText);
    s.observations.screenshots = await p1.shotBoth('b-access-not-available');
  } finally { await closePage(cdp, p1); }
  const p2 = await newPage(cdp);
  try {
    await signInAs(p2, 'sub-employee');
    await p2.waitFor(`location.pathname==='/gcsp/account'`, 30000, 'employee landing');
    await p2.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/greg/cases` });
    await p2.waitFor(`location.pathname==='/gcsp/access-denied' || /access not available/i.test(${main$})`, 25000, 'employee denied on greg/cases');
    await sleep(500); await p2.settle();
    const apiAfter = p2.api().filter((e) => /scheme-team|greg/.test(e.path));
    s.observations.employeeOnGregCases = { path: await p2.eval('location.pathname'), visibleText: (await p2.main()).slice(0, 300), gregApiCalls: apiAfter };
    s.checks.employeeGregCasesDenied = /access not available/i.test(s.observations.employeeOnGregCases.visibleText);
    s.checks.noGregApiCall = apiAfter.length === 0;
  } finally { await closePage(cdp, p2); }
}

// Employee reaches a held manual claim (an unfinished order) by clicking through stock and review.
async function reachHeldClaim(page, s) {
  // Account page: start the journey, complete the ordering details form, then Find a car.
  await page.waitFor(`[...document.querySelectorAll('button')].some((b)=>/Choose a replacement|Start a new order|Carry on/.test(b.textContent) && !b.disabled)`, 30000, 'journey start button');
  s.observations.startedWith = await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x)=>/Choose a replacement|Start a new order|Carry on/.test(x.textContent) && !x.disabled); const t = b.textContent.trim(); b.click(); return t; })()`);
  await page.waitFor(`document.querySelector('#choices-driverId')`, 30000, 'ordering details form');
  s.observations.formFill = [];
  for (const id of ['choices-driverId', 'choices-contractOptionId', 'choices-collectionLocationId', 'choices-brand']) {
    await sleep(500);
    s.observations.formFill.push(await page.eval(`(() => { const sel = document.querySelector('#${id}'); const o = sel && [...sel.options].find((x) => x.value && !x.disabled); if (o) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); } return '${id}=' + (sel?.value ?? 'missing'); })()`));
  }
  s.observations.formFill.push(await page.eval(`(() => {
    const out = [];
    const d = document.querySelector('#choices-requestedCollectionDate'); if (d && !d.value && d.min) { d.value = d.min; d.dispatchEvent(new Event('input', { bubbles: true })); d.dispatchEvent(new Event('change', { bubbles: true })); out.push('date=' + d.value); }
    const fill = (id, v) => { const i = document.querySelector(id); if (i && !i.value) { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); out.push(id + '=set'); } };
    fill('#choices-phone', '01632 960000'); fill('#choices-email', 'paula.mason@gcsp-demo.com');
    const m = document.querySelector('#choices-expectedReturnMileage'); if (m && !m.value) { m.value = '5200'; m.dispatchEvent(new Event('input', { bubbles: true })); out.push('mileage=5200'); }
    return out.join(','); })()`));
  await sleep(500);
  s.observations.selectOptions = await page.eval(`[...document.querySelectorAll('.choices-grid select')].map((x) => x.id + ': ' + [...x.options].map((o) => o.value + (o.disabled ? '(disabled)' : '') + '/' + o.textContent.trim().slice(0, 50)).join(' | '))`);
  s.observations.findCarClicked = await clickButton(page, 'Find a car');
  await sleep(1500); s.observations.afterFindCar = (await page.main()).slice(0, 900);
  if (!s.observations.findCarClicked) throw new Error(`Find a car not clickable; form text: ${(await page.main()).slice(0, 300)}`);
  await page.waitFor(`location.pathname==='/gcsp/stock'`, 30000, 'navigation to /gcsp/stock');
  const ready = `[...document.querySelectorAll('gcsp-vehicle-card button')].some((b)=>b.textContent.trim()==='Review this car' && !b.disabled)`;
  await page.waitFor(ready, 40000, 'a reviewable car on /gcsp/stock');
  s.observations.stockText = (await page.main()).slice(0, 300);
  await page.eval(`[...document.querySelectorAll('gcsp-vehicle-card button')].find((b)=>b.textContent.trim()==='Review this car' && !b.disabled).click()`);
  await page.waitFor(`location.pathname==='/gcsp/manual/review'`, 30000, 'navigation to /gcsp/manual/review');
  await page.waitFor(`[...document.querySelectorAll('button')].some((b)=>/Reserve this car to review|Continue to order review|Continue reviewing this selection/.test(b.textContent))`, 30000, 'review page actions');
  if (await clickButton(page, 'Reserve this car to review')) s.observations.reservedByUserClick = true;
  await page.waitFor(`/Quote valid until/.test(${main$})`, 40000, 'held claim shown on review page');
  s.observations.heldClaimText = (await page.main()).slice(0, 500);
}

let CTX;
async function scenarioC(cdp, s) {
  idp.lifetimeSec = Number(process.env.PROOF_EXPIRY_SEC ?? 100);
  const page = await newPage(cdp);
  try {
    await signInAs(page, 'sub-employee');
    await page.waitFor(`location.pathname==='/gcsp/account'`, 30000, 'employee on /gcsp/account');
    const signedAt = Date.now();
    let expectedReturn = '/gcsp/manual/review';
    try { await reachHeldClaim(page, s); s.checks.heldClaimReachedOnReviewPage = true; }
    catch (e) {
      { const g = await direct(CTX, 'GET', '/manual/claim', mint('sub-employee', ['employee'])); const v = g.json?.value; s.observations.claimReadAfterReview = { status: g.status, holdState: v?.hold?.state ?? null, holdMode: v?.hold?.mode ?? null, quoteState: v?.state ?? null, pageText: (await page.main()).slice(0, 160) }; }
      await page.settle(); s.observations.manualCalls = page.api().filter((x) => /\/manual\/(claim|quote|stock|order)/.test(x.path) && x.method !== 'OPTIONS').map((x) => `${x.method} ${x.path} ${x.status} ${JSON.stringify(x.body ?? null)}`);
      const here = await page.eval('location.pathname');
      s.observations.manualJourneyFallback = `Held claim not displayed: ${e.message}. Expiry exercised on ${here}.`;
      receipt.deviations.push(`Scenario c: ${s.observations.manualJourneyFallback} Fallback: expiry and recovery exercised on that page; the held claim exists server-side from the user's click.`);
      receipt.productDefects.push({ id: 'claim-hold-mode-local-rejected', where: 'Angular apps/gcsp-web/src/app/manual/manual.projection.ts manualSelection() vs Java ClaimRow.hold()', evidence: 'POST /manual/claim 200 returns hold.mode "local"; the validator accepts only "new" or "replacement", so isManualClaim fails and /gcsp/manual/review shows "Outcome not confirmed" instead of the held claim. Direct GET /manual/claim confirms holdState active, holdMode local (observations.claimReadAfterReview).' });
      expectedReturn = here === '/gcsp/sign-in' ? '/gcsp/account' : here;
      s.checks.heldClaimReachedOnReviewPage = false;
    }
    s.observations.journeyReachedAtSec = Math.round((Date.now() - signedAt) / 1000);
    s.observations.mutatingBeforeExpiry = page.api().filter((e) => MUTATING.has(e.method) && e.method !== 'OPTIONS').map((e) => `${e.method} ${e.path} ${e.status}`);
    await page.waitFor(`location.pathname==='/gcsp/sign-in'`, 150000, 'redirect to /sign-in after token expiry');
    s.observations.expiredAfterSec = Math.round((Date.now() - signedAt) / 1000);
    s.observations.redirectUrl = await page.eval('location.pathname+location.search');
    await page.waitFor(`/session expired/i.test(${main$})`, 10000, 'expiry notice');
    s.observations.expiryText = (await page.main()).slice(0, 300);
    s.checks.redirectedToSignInWithReturnTo = decodeURIComponent(s.observations.redirectUrl).includes(`returnTo=${expectedReturn}`);
    s.checks.expiryNoticeShown = /Your session expired\. Sign in to continue with your saved progress\./.test(s.observations.expiryText);
    s.observations.expectedReturn = expectedReturn;
    s.observations.screenshotsExpiry = await page.shotBoth('c-session-expired');
    idp.lifetimeSec = 3600;
    const mark = page.log.length;
    await page.eval(`[...document.querySelectorAll('#gcsp-main button')].find(b=>b.textContent.trim()==='Sign in').click()`);
    await chooseSubject(page, 'sub-employee');
    await page.waitFor(`location.pathname==='${expectedReturn}'`, 40000, `return to ${expectedReturn} after re-login`);
    await page.waitFor(`/signed in again/i.test(${main$})`, 20000, 'recovery notice');
    await sleep(5000); await page.settle();
    s.observations.returnedTo = await page.eval('location.pathname');
    s.observations.recoveryText = (await page.main()).slice(0, 700);
    s.observations.screenshotsRecovered = await page.shotBoth('c-recovered-notice');
    const after = page.log.slice(mark).filter((e) => e.url.startsWith(ORIGINS.api));
    const mutating = page.api().filter((e) => MUTATING.has(e.method));
    s.observations.apiRequestsAfterRelogin = after.map((e) => `${e.method} ${new URL(e.url).pathname} ${e.status ?? ''}`);
    s.observations.mutatingInWholeBrowserLog = mutating.map((e) => `${e.method} ${e.path} ${e.status}`);
    s.checks.returnedToExpectedPage = s.observations.returnedTo === expectedReturn;
    s.checks.recoveryNoticeShown = /signed in again\. Review your saved progress before continuing\./.test(s.observations.recoveryText);
    s.checks.savedProgressVisible = expectedReturn === '/gcsp/manual/review' && s.checks.heldClaimReachedOnReviewPage ? /Quote valid until|Continue reviewing this selection|Continue to order review/.test(s.observations.recoveryText) : s.observations.recoveryText.length > 60;
    s.checks.noMutatingRequestAfterRelogin = after.every((e) => !MUTATING.has(e.method));
    s.checks.noOrderSubmitInBrowserLog = !page.api().some((e) => ORDER_SUBMIT.test(e.path) && !['GET', 'OPTIONS'].includes(e.method));
  } finally { idp.lifetimeSec = 3600; await closePage(cdp, page); }
}

async function scenarioD(cdp, s, ctx) {
  const page = await newPage(cdp);
  try {
    await page.send('Page.navigate', { url: `${ORIGINS.evil}/` });
    await page.waitFor(`window.__result`, 20000, 'evil page fetch result');
    await sleep(500); await page.settle();
    s.observations.result = await page.eval('window.__result');
    s.observations.pageText = (await page.main()).slice(0, 200);
    const api = page.api(); s.observations.apiRequests = api;
    s.observations.consoleMessages = page.console.map((c) => c.replace(/Bearer\s+\S+/g, 'Bearer [redacted]'));
    s.checks.browserBlockedFetch = String(s.observations.result).startsWith('blocked:');
    s.checks.noApiGetReachedServerAsCors = !api.some((e) => e.method === 'GET' && e.status === 200);
    s.observations.screenshot = await page.shot('d-evil-origin-blocked.png');
  } finally { await closePage(cdp, page); }
  const r = await request(ORIGINS.api, 'OPTIONS', '/api/gcsp/v1/context', { ca: ctx.tls.ca, headers: { Origin: ORIGINS.evil, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
  s.observations.directPreflight = { status: r.status, acao: r.headers['access-control-allow-origin'] ?? null, body: r.text.slice(0, 80) };
  s.checks.disallowedPreflightRejected = r.status === 403 || !r.headers['access-control-allow-origin'];
  s.checks.noAcaoForDisallowedOrigin = !r.headers['access-control-allow-origin'];
}

async function scenarioE(s, ctx) {
  idp.lifetimeSec = 3600;
  const now = Math.floor(Date.now() / 1000);
  const call = async (p, token, origin = ORIGINS.web) => { const r = await request(ORIGINS.api, 'GET', p, { ca: ctx.tls.ca, headers: { Accept: 'application/json', Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) } }); return { status: r.status, acao: r.headers['access-control-allow-origin'] ?? null, body: pickTyped(r.json), vary: r.headers.vary ?? null }; };
  const cases = {
    noBearer: [await call('/api/gcsp/v1/context'), 401, 'bearer-missing'],
    badSignature: [await call('/api/gcsp/v1/context', mint('sub-employee', ['employee'], {}, idp.wrongKeys.privateKey)), 401, 'token-signature-invalid'],
    expired: [await call('/api/gcsp/v1/context', mint('sub-employee', ['employee'], { iat: now - 400, exp: now - 120 })), 401, 'token-expired'],
    wrongAudience: [await call('/api/gcsp/v1/context', mint('sub-employee', ['employee'], { aud: ['other-api'] })), 401, 'token-audience-invalid'],
    employeeOnGregOnly: [await call('/api/gcsp/v1/scheme-team/cases', mint('sub-employee', ['employee'])), 403, 'role-required'],
    unmappedSubject: [await call('/api/gcsp/v1/context', mint('sub-unmapped', ['employee'])), 403, 'subject-not-mapped'],
    validEmployee: [await call('/api/gcsp/v1/context', mint('sub-employee', ['employee'])), 200, null],
    dbRouteNoBearer: [await call('/api/gcsp/v1/brief/editor'), 401, 'bearer-missing'],
    dbRouteGregOnEmployeeRoute: [await call('/api/gcsp/v1/brief/editor', mint('sub-greg', ['greg'])), 403, 'role-required'],
    dbRouteEmployee: [await call('/api/gcsp/v1/brief/editor', mint('sub-employee', ['employee'])), 200, null],
  };
  s.observations.cases = {};
  for (const [name, [got, status, code]] of Object.entries(cases)) {
    s.observations.cases[name] = got;
    s.checks[`${name}_${status}${code ? `_${code}` : ''}`] = got.status === status && (code === null || got.body?.code === code);
    s.checks[`${name}_acaoExactWebOrigin`] = got.acao === ORIGINS.web;
  }
  s.observations.typedBodyReadableCrossOrigin = 'every case above carries Access-Control-Allow-Origin equal to the web origin, including 401 and 403';
  const evil = await call('/api/gcsp/v1/context', mint('sub-employee', ['employee']), ORIGINS.evil);
  s.observations.disallowedOriginSimpleGet = evil;
  s.checks.disallowedOriginGetHasNoAcao = evil.acao === null;
  ctx.evilToken = mint('sub-employee', ['employee']);
}

async function scenarioG(cdp, s, ctx) {
  idp.lifetimeSec = 3600;
  const page = await newPage(cdp);
  try {
    await signInAs(page, 'sub-employee');
    await page.waitFor(`location.pathname==='/gcsp/account'`, 30000, 'employee on /gcsp/account');
    await gotoPreferences(page);
    s.observations.browserEdit = await editPreference(page);
    await page.waitFor(`/Unsaved/.test(${main$})`, 10000, 'unsaved note');
    const before = await formState(page);
    // Another client changes the same draft first, with the employee's own token.
    const token = mint('sub-employee', ['employee']);
    const ed = (await direct(ctx, 'GET', '/brief/editor', token)).json?.value;
    const brief = JSON.parse(JSON.stringify(ed.initial.brief));
    const [key] = Object.entries(ed.context.preferences).find(([, d]) => d.editable && d.type === 'slider') ?? [];
    if (!key) throw new Error('no editable slider preference to change directly');
    const cur = brief.preferences[key]?.value; const { minimum, maximum } = ed.context.slider;
    brief.preferences[key] = { ...(brief.preferences[key] ?? { importance: ed.context.accountPreferences.importance.medium, valueState: 'draft', importanceState: 'draft' }), value: cur === maximum ? minimum : maximum, source: 'employee', valueState: 'draft' };
    const other = await direct(ctx, 'POST', '/brief/draft', token, { commandId: uid(), expectedBriefVersion: ed.initial.briefVersion, expectedDraftVersion: ed.initial.draftVersion, brief });
    s.observations.directChange = { preference: key, status: other.status, body: pickTyped(other.json), versionsBefore: { brief: ed.initial.briefVersion, draft: ed.initial.draftVersion } };
    s.checks.directDraftChangeAccepted = other.status === 200;
    const mark = page.log.length;
    s.observations.saveClicked = await saveForm(page);
    await page.waitFor(`/changed elsewhere/.test(${main$})`, 40000, 'stale-copy message after save');
    await sleep(6000); await page.settle();
    const calls = page.log.slice(mark).filter((e) => e.url.startsWith(ORIGINS.api) && e.method !== 'OPTIONS'); const api = page.api().filter((e) => e.method === 'POST');
    const draft = api.filter((e) => e.path.endsWith('/brief/draft'));
    s.observations.browserApiBody = draft.map((e) => ({ status: e.status, body: e.body }));
    const fullText = await page.main(); s.observations.visibleText = fullText.slice(0, 400); s.observations.staleMessageText = /Your preferences changed elsewhere\.[^.]*\.[^.]*\./.exec(fullText)?.[0] ?? null;
    s.observations.apiAfterSave = calls.map((e) => `${e.method} ${new URL(e.url).pathname} ${e.status ?? ''}`);
    const after = await formState(page);
    s.checks.api409Typed = draft.length >= 1 && draft[0].status === 409 && ['stale-version', 'conflict'].includes(draft[0].body?.code ?? draft[0].body?.status);
    s.checks.staleCopyMessageVisible = /Your preferences changed elsewhere\. Reload to see the latest\. Your edits are kept until then\./.test(fullText);
    s.checks.editsKeptNotReloaded = before === after;
    s.checks.noAutomaticResubmit = draft.length === 1 && !api.some((e) => /\/brief\/(confirm|preferences)$/.test(e.path));
    await page.eval(`(() => { const n = [...document.querySelectorAll('[role=status]')].find((x) => /changed elsewhere/.test(x.innerText)); n?.scrollIntoView({ block: 'center' }); return !!n; })()`);
    s.observations.screenshots = await page.shotBoth('g-stale-409');
  } finally { await closePage(cdp, page); }
}

async function scenarioH(cdp, s) {
  idp.lifetimeSec = 3600;
  const page = await newPage(cdp);
  let blocked = false;
  try {
    await signInAs(page, 'sub-employee');
    await page.waitFor(`location.pathname==='/gcsp/account'`, 30000, 'employee on /gcsp/account');
    await gotoPreferences(page);
    setProofDbConnections(false); blocked = true;
    s.observations.databaseRefusingConnections = pg(['-d', 'postgres', '-Atc', `select datallowconn from pg_database where datname='${PG.db}'`]) === 'f';
    const mark = page.log.length;
    await page.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/preferences` });
    await page.waitFor(`/unavailable|not available|try again/i.test(${main$})`, 60000, 'unavailable state on preferences');
    await sleep(1500); await page.settle();
    const prefApi = page.api().filter((e) => e.path.includes('/brief/') && e.status >= 500);
    s.observations.preferences = { path: await page.eval('location.pathname'), visibleText: (await page.main()).slice(0, 400), failedCalls: prefApi, hasTryAgain: await page.eval(`[...document.querySelectorAll('button')].some((b)=>b.textContent.trim()==='Try again')`) };
    s.checks.preferencesTyped503Retryable = prefApi.some((e) => e.status === 503 && !!e.body?.code && e.body.retryable === true);
    s.checks.preferencesUsefulUnavailableState = /could not be loaded|unavailable|not available/i.test(s.observations.preferences.visibleText) && s.observations.preferences.hasTryAgain;
    s.observations.screenshots = await page.shotBoth('h-database-unavailable');
    await page.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/account` });
    await page.waitFor(`/unavailable|not available|try again/i.test(${main$})`, 60000, 'unavailable state on account');
    await sleep(1500); await page.settle();
    const acctApi = page.api().filter((e) => e.path.includes('/manual/') && e.status >= 500);
    s.observations.account = { visibleText: (await page.main()).slice(0, 400), failedCalls: acctApi.slice(0, 4) };
    s.checks.accountTyped503Retryable = acctApi.some((e) => e.status === 503 && !!e.body?.code && e.body.retryable === true);
    s.checks.accountUsefulUnavailableState = /unavailable|not available/i.test(s.observations.account.visibleText);
    s.observations.screenshotAccount = await page.shot('h-account-unavailable-1000x720.png');
    setProofDbConnections(true); blocked = false;
    await page.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/preferences` });
    let recovered = false;
    for (let i = 0; i < 14 && !recovered; i++) {
      recovered = await page.eval(`Boolean(document.querySelector('.brief-form'))`).catch(() => false);
      if (!recovered) { await clickButton(page, 'Try again'); await sleep(3000); }
    }
    s.observations.recovered = { ok: recovered, visibleText: (await page.main()).slice(0, 200) };
    s.checks.recoversAfterDatabaseBack = recovered;
    s.observations.screenshotRecovered = await page.shot('h-recovered-1000x720.png');
  } finally { if (blocked) { try { setProofDbConnections(true); } catch { /* teardown drops the database */ } } await closePage(cdp, page); }
}

async function scenarioI(cdp, s, ctx) {
  idp.lifetimeSec = 3600;
  const page = await newPage(cdp);
  const id = `offer-proof-${randomBytes(4).toString('hex')}`;
  try {
    await signInAs(page, 'sub-employee');
    await page.waitFor(`location.pathname==='/gcsp/account'`, 30000, 'employee on /gcsp/account');
    await page.send('Page.navigate', { url: `${ORIGINS.web}/gcsp/offers/${id}` });
    await page.waitFor(`location.pathname==='/gcsp/offers/${id}' && /offer/i.test(${main$}) && !/Loading|Checking/i.test(${main$})`, 40000, 'offer state');
    await sleep(2000); await page.settle();
    const call = page.api().find((e) => e.method === 'GET' && e.path.includes(`/offers/${id}`));
    s.observations.browserOfferCall = call ?? null; s.observations.visibleText = (await page.main()).slice(0, 300);
    const token = mint('sub-employee', ['employee']);
    const bare = await direct(ctx, 'GET', `/offers/${id}`, token); const withRun = await direct(ctx, 'GET', `/offers/${id}?runId=run-1`, token);
    s.observations.directBare = { status: bare.status, body: pickTyped(bare.json) }; s.observations.directWithRunIdQuery = { status: withRun.status, body: pickTyped(withRun.json) };
    s.checks.typedRefusalReachedBrowserWithExactOrigin = !!call?.body?.code && call.acao === ORIGINS.web && call.authorizationSent === true;
    s.checks.usefulVisibleState = /offer/i.test(s.observations.visibleText) && /not found|link|account|try again/i.test(s.observations.visibleText);
    s.checks.directUnknownOfferIs404OfferNotFound = bare.status === 404 && bare.json?.code === 'offer-not-found';
    s.observations.browserOfferStatus = call?.status ?? null; s.checks.browserUnknownOfferIs404 = call?.status === 404;
    if (call?.status === 400 && call.body?.code === 'unsupported-query') receipt.productDefects.push({ id: 'offer-read-sends-runId-query', where: 'Angular offers/offer.client.ts readOffer() vs Java OffersResource.offer()', evidence: `Browser GET /offers/{id}?runId=run-1 gets 400 unsupported-query ("Offers do not take query parameters.") so every offer, known or not, shows "Offer link incomplete". The same unknown id without the query gets 404 offer-not-found (observations.directBare).` });

    s.observations.screenshots = await page.shotBoth('i-offer-not-found');
  } finally { await closePage(cdp, page); }
}

function walk(dir, base = dir) { return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))])); }
function scenarioF(s, ctx) {
  const root = path.join(dirs.static, 'gcsp');
  const files = walk(dirs.static);
  s.observations.filesScanned = files.length; s.observations.topLevel = [...new Set(files.map((f) => f.split('/')[0]))];
  const privateParts = [...Object.entries(idp.keys.privateKey.export({ format: 'jwk' })).filter(([k]) => ['d', 'p', 'q', 'dp', 'dq', 'qi'].includes(k)).map(([, v]) => v.slice(0, 24)), ...ctx.tls.keyPem.split('\n').filter((l) => l.length > 40).slice(1, 4)];
  const everywhere = [['PEM private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/], ['JWT-shaped string', /eyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{6,}/], ['GCSP_OIDC_ACCOUNTS', /GCSP_OIDC_ACCOUNTS/], ['database setting', /GCSP_DATABASE|DATABASE_URL|DATABASE_PASSWORD/], ['BREVO', /BREVO/i], ['realm_access', /realm_access/], ['literal secret assignment', /(client_secret|password|api[_-]?key)["']?\s*[:=]\s*["'][^"'\s]{4,}["']/i]];
  const metaOnly = [['client_secret/password keyword', /client_secret|password/i]];
  const jwk = idp.keys.privateKey.export({ format: 'jwk' });
  const literals = [['database URL', DB_URL], ['database host:port', '127.0.0.1:55491'], ['database name', PG.db], ['jdbc scheme', 'jdbc:postgresql'], ['database user setting', `DATABASE_USER`], ...['d', 'p', 'q'].map((k) => [`JWKS private key ${k}`, jwk[k]])];
  const hits = [];
  const metaFiles = new Set(['gcsp/index.html', 'gcsp/runtime-config.json', 'gcsp/static-manifest.json']);
  for (const f of files) {
    const text = readFileSync(path.join(dirs.static, f), 'latin1');
    for (const [name, re] of everywhere) if (re.test(text)) hits.push({ file: f, finding: name });
    if (metaFiles.has(f)) for (const [name, re] of metaOnly) if (re.test(text)) hits.push({ file: f, finding: name });
    for (const part of privateParts) if (text.includes(part)) hits.push({ file: f, finding: 'harness private key material' });
    for (const [name, lit] of literals) if (text.includes(lit)) hits.push({ file: f, finding: name });
  }
  s.observations.hits = hits;
  const informational = [];
  for (const f of files) if (/\.js$/.test(f) && /client_secret|password/i.test(readFileSync(path.join(dirs.static, f), 'latin1'))) informational.push(f);
  s.observations.libraryKeywordFiles = informational;
  s.checks.noSecretFindings = hits.length === 0;
  const cfg = JSON.parse(readFileSync(path.join(root, 'runtime-config.json'), 'utf8'));
  s.observations.runtimeConfig = cfg;
  const same = (a, b) => JSON.stringify(Object.keys(a).sort()) === JSON.stringify(b.slice().sort());
  s.checks.runtimeConfigKeysExact = same(cfg, ['schemaVersion', 'environmentId', 'apiBaseUrl', 'oidc']) && same(cfg.oidc, ['authority', 'clientId', 'scope', 'redirectUri', 'postLogoutRedirectUri']);
  s.checks.runtimeConfigPublicOrigins = cfg.apiBaseUrl === API_BASE && cfg.oidc.authority === ISSUER && cfg.oidc.redirectUri === `${ORIGINS.web}/gcsp/auth/callback`;
  const idx = readFileSync(path.join(root, 'index.html'), 'utf8');
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(idx)?.[1] ?? '';
  s.observations.csp = csp;
  s.checks.cspConnectSrcExactOrigins = /connect-src 'self' https:\/\/gcsp-api\.localhost:8443 https:\/\/gcsp-idp\.localhost:9443(;|$)/.test(csp);
}

// Releases the demo stock through the presenter API when the employee sees none; recorded in the receipt.
async function ensureStock(ctx) {
  const pres = mint('sub-presenter', ['presenter']);
  const count = async () => { const r = await direct(ctx, 'GET', '/presenter/releases/stock?limit=500', pres); const v = r.json?.value; const list = Array.isArray(v) ? v : v?.cars ?? v?.stock ?? v?.items ?? v?.decisions; return { status: r.status, cars: Array.isArray(list) ? list.length : null, keys: v ? Object.keys(v).slice(0, 8) : null, code: r.json?.code ?? null, text: r.status === 200 ? undefined : r.text.slice(0, 160) }; };
  const before = await count();
  receipt.stockSetup = { before };
  if (before.status === 200 && before.cars > 0) { receipt.stockSetup.released = false; return; }
  const controls = await direct(ctx, 'GET', '/presenter/controls', pres);
  const version = controls.json?.value?.clockVersion;
  const tick = await direct(ctx, 'POST', '/presenter/controls/tick', pres, { commandId: uid(), expectedClockVersion: version, mode: 'next-release' });
  receipt.stockSetup = { before, released: tick.status === 200, controlsStatus: controls.status, tickStatus: tick.status, tickBody: pickTyped(tick.json), after: await count(), note: 'Stock was empty at startup; released through the presenter API (next-release) before the scenarios.' };
  receipt.deviations.push(receipt.stockSetup.note);
}

// ---------- main steps ----------
async function ensureNode() {
  const archive = `node-v${NODE_VERSION}-darwin-arm64.tar.gz`;
  try {
    const sums = await (await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`, { signal: AbortSignal.timeout(60000) })).text();
    const want = sums.split('\n').find((l) => l.endsWith(` ${archive}`))?.split(/\s+/)[0];
    const bytes = Buffer.from(await (await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/${archive}`, { signal: AbortSignal.timeout(180000) })).arrayBuffer());
    if (!want || createHash('sha256').update(bytes).digest('hex') !== want) throw new Error('checksum mismatch');
    const tgz = path.join(SCRATCH, archive); writeFileSync(tgz, bytes);
    mkdirSync(dirs.node, { recursive: true });
    execFileSync('tar', ['-xzf', tgz, '-C', dirs.node, '--strip-components=1'], { timeout: 120000 });
    rmSync(tgz, { force: true });
    receipt.tools.angularBuildNode = `v${NODE_VERSION} (official nodejs.org tarball, SHA-256 verified against SHASUMS256.txt)`;
    return {};
  } catch (e) {
    receipt.deviations.push(`Node ${NODE_VERSION} download or verification failed (${e.message}); used installed Node with engine-strict disabled.`);
    mkdirSync(path.join(dirs.node, 'bin'), { recursive: true });
    for (const bin of ['node', 'npm', 'npx']) { try { execFileSync('ln', ['-sf', `/opt/homebrew/opt/node@24/bin/${bin}`, path.join(dirs.node, 'bin', bin)]); } catch { /* optional */ } }
    receipt.tools.angularBuildNode = 'installed node@24 (not the pinned version)';
    return { npm_config_engine_strict: 'false' };
  }
}

function accessLogSummary() {
  const lines = readFileSync(path.join(dirs.logs, 'api.log'), 'utf8').split('\n').filter((l) => l.includes('ACCESSLOG'));
  const rows = lines.map((l) => { const m = /ACCESSLOG (\S+) (\S+) (\d+) ORIGIN=(\S*) ACAO=(\S*)/.exec(l); return m ? { method: m[1], path: m[2], status: Number(m[3]), origin: m[4], acao: m[5] } : null; }).filter(Boolean);
  const methods = {}; for (const r of rows) methods[r.method] = (methods[r.method] ?? 0) + 1;
  return { total: rows.length, methods, mutating: rows.filter((r) => MUTATING.has(r.method)).length, orderSubmits: rows.filter((r) => ORDER_SUBMIT.test(r.path) && r.method !== 'GET' && r.method !== 'OPTIONS').length, mutatingRequests: rows.filter((r) => MUTATING.has(r.method)).map((r) => `${r.method} ${r.path} ${r.status}`).slice(0, 40), preflights: rows.filter((r) => r.method === 'OPTIONS').map((r) => `${r.status} ${r.path} origin=${r.origin} acao=${r.acao}`).slice(0, 12) };
}

async function main() {
  mkdirSync(EVIDENCE, { recursive: true });
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  for (const f of readdirSync(EVIDENCE)) if (f.endsWith('.png')) rmSync(path.join(EVIDENCE, f), { force: true });
  receipt.head = cap('git', ['-C', ROOT, 'rev-parse', 'HEAD']);
  receipt.tools = { ...receipt.tools, harnessNode: process.version, openssl: cap('openssl', ['version']), chrome: cap(CHROME, ['--version']) };
  receipt.tools.java = (spawnSync(path.join(JAVA_HOME, 'bin/java'), ['-version'], { encoding: 'utf8' }).stderr ?? '').split('\n')[0];
  
  log('certificates'); const tls = makeCerts();
  log('node toolchain'); const nodeEnv = await ensureNode();
  receipt.tools.angularBuildNodeVersion = cap(path.join(dirs.node, 'bin/node'), ['--version']);
  receipt.tools.npm = cap(path.join(dirs.node, 'bin/npm'), ['--version'], { env: baseEnv() });
  log('npm ci + production build');
  if (process.env.PROOF_SKIP_CI !== '1') await run('npm-ci', 'npm', ['--prefix', 'apps/gcsp-web', 'ci', '--no-audit', '--no-fund'], { env: nodeEnv, timeout: 240000 });
  await run('ng-build', 'npm', ['--prefix', 'apps/gcsp-web', 'run', 'build', '--', '--configuration', 'production'], { env: nodeEnv, timeout: 300000 });
  log('static assembly');
  const assemble = await import(pathToFileURL(path.join(ROOT, 'scripts/build-gcsp-static.mjs')).href);
  await run('assemble', path.join(dirs.node, 'bin/node'), ['scripts/build-gcsp-static.mjs', '--browser', 'apps/gcsp-web/dist/gcsp-web/browser', '--output', dirs.static, '--environment', 'deployed', '--revision', receipt.head], { timeout: 120000, env: { ...nodeEnv, GCSP_PUBLIC_ENVIRONMENT_ID: 'local-cross-origin-proof', GCSP_PUBLIC_API_BASE_URL: API_BASE, GCSP_PUBLIC_OIDC_AUTHORITY: ISSUER, GCSP_PUBLIC_OIDC_CLIENT_ID: 'gcsp-web', GCSP_PUBLIC_OIDC_SCOPE: 'openid profile gcsp-api', GCSP_PUBLIC_OIDC_REDIRECT_URI: `${ORIGINS.web}/gcsp/auth/callback`, GCSP_PUBLIC_OIDC_POST_LOGOUT_REDIRECT_URI: `${ORIGINS.web}/gcsp/` } });
  log('java lock'); await takeJavaLock();
  log('maven package'); await run('mvn-package', './mvnw', ['-B', '-q', '-DskipTests', 'package'], { cwd: path.join(ROOT, 'services/gcsp-api'), timeout: 420000 });
  log('proof database'); createProofDb();
  log('issuer, web and API'); await startIdp(tls); await startWeb(tls, assemble.GCSP_FIXED_ROUTES);
  const apiEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp, JAVA_HOME,
    QUARKUS_HTTP_SSL_PORT: '8443', QUARKUS_HTTP_INSECURE_REQUESTS: 'disabled', QUARKUS_HTTP_SSL_CERTIFICATE_FILES: path.join(dirs.certs, 'fullchain.pem'), QUARKUS_HTTP_SSL_CERTIFICATE_KEY_FILES: path.join(dirs.certs, 'leaf.key'),
    QUARKUS_HTTP_ACCESS_LOG_ENABLED: 'true', QUARKUS_HTTP_ACCESS_LOG_PATTERN: 'ACCESSLOG %m %U %s ORIGIN=%{i,Origin} ACAO=%{o,Access-Control-Allow-Origin}',
    GCSP_ALLOWED_ORIGINS: ORIGINS.web, GCSP_IDENTITY_PROVIDER: 'oidc', GCSP_OIDC_ISSUER: ISSUER, GCSP_OIDC_JWKS_URI: 'https://127.0.0.1:9443/realms/gcsp-local/protocol/openid-connect/certs', GCSP_OIDC_AUDIENCE: 'gcsp-api', GCSP_OIDC_AUTHORIZED_PARTY: 'gcsp-web', GCSP_OIDC_REQUIRED_SCOPES: 'gcsp-api',
    GCSP_OIDC_ACCOUNTS: JSON.stringify([{ subject: 'sub-employee', roles: ['employee'], employeeId: 'employee-paula' }, { subject: 'sub-greg', roles: ['greg'] }, { subject: 'sub-presenter', roles: ['presenter'] }]),
    GCSP_ENVIRONMENT_ID: 'local-cross-origin-proof', GCSP_RUN_ID: 'run-1', GCSP_POLICY_VERSION: 'gcsp-policy-v1',
    GCSP_DATABASE_URL: DB_URL, GCSP_DATABASE_USER: PG.user, GCSP_EXPECTED_DATABASE: PG.db, GCSP_RESET_ALLOWED: 'true',
    GCSP_ACCOUNT_PROVIDER: 'repository', GCSP_SCENARIO_PROVIDER: 'demo', GCSP_SUPPLY_PROVIDER: 'demo', GCSP_ORDERING_PROVIDER: 'synthetic', GCSP_APPROVALS_PROVIDER: 'synthetic', GCSP_DOCUMENTS_PROVIDER: 'synthetic', GCSP_APPOINTMENTS_PROVIDER: 'synthetic', GCSP_RETURNS_PROVIDER: 'synthetic', GCSP_ALLOCATION_CANDIDATES_PROVIDER: 'recommendation',
    GCSP_VEHICLE_EVIDENCE_PROVIDER: 'lookup', GCSP_VEHICLE_EVIDENCE_STORE: path.join(ROOT, 'server/data/gcsp/vehicle-evidence/fleet-source.v1'), GCSP_VEHICLE_EVIDENCE_REFERENCE_DIR: path.join(ROOT, 'server/data/gcsp/vehicle-evidence'), GCSP_VEHICLE_ASSETS_ROOT: ROOT };
  receipt.apiComposition = Object.fromEntries(Object.entries(apiEnv).filter(([k]) => /^GCSP_(ACCOUNT|SCENARIO|SUPPLY|ORDERING|APPROVALS|DOCUMENTS|APPOINTMENTS|RETURNS|ALLOCATION|VEHICLE_EVIDENCE_PROVIDER|RUN_ID|POLICY|RESET)/.test(k)));
  const java = spawnLong('api', path.join(JAVA_HOME, 'bin/java'), [`-Djavax.net.ssl.trustStore=${tls.trust}`, `-Djavax.net.ssl.trustStorePassword=${TRUST_PASS}`, `-Djava.io.tmpdir=${dirs.tmp}`, '-jar', path.join(ROOT, 'services/gcsp-api/target/quarkus-app/quarkus-run.jar')], apiEnv);
  const ctx = { tls }; CTX = ctx;
  for (let i = 0; ; i++) {
    if (java.done) { receipt.failureLogs.api = tail(path.join(dirs.logs, 'api.log')); throw new Error('API process exited during startup'); }
    try { const r = await request(ORIGINS.api, 'GET', '/q/health/ready', { ca: tls.ca }); if (r.status === 200) { const c = await request(ORIGINS.api, 'GET', '/api/gcsp/v1/context', { ca: tls.ca }); if (c.status === 401) break; } } catch { /* not up yet */ }
    if (i > 120) { receipt.failureLogs.api = tail(path.join(dirs.logs, 'api.log')); throw new Error('API did not become ready'); }
    await sleep(500);
  }
  log('API ready on https://gcsp-api.localhost:8443');
  receipt.apiReadiness = pickTyped((await request(ORIGINS.api, 'GET', '/q/health/ready', { ca: tls.ca })).json) ?? 'ready';
  await ensureStock(ctx);
  await scenario('e', 'Direct API calls without a browser', (s) => scenarioE(s, ctx));
  await startEvil(tls, ctx.evilToken);
  await scenario('f', 'Secret scan of assembled static output', (s) => scenarioF(s, ctx));
  const profile = path.join(dirs.browser, 'profile'); mkdirSync(profile, { recursive: true });
  const chrome = spawnLong('chrome', CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-allow-origins=*', `--ignore-certificate-errors-spki-list=${tls.spki}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--window-size=1000,720', 'about:blank'], { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dirs.tmp });
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) { if (chrome.done) throw new Error('Chrome exited during startup'); try { const [port, p] = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n'); wsUrl = `ws://127.0.0.1:${port}${p}`; } catch { await sleep(250); } }
  if (!wsUrl) throw new Error('Chrome DevTools endpoint not found');
  const cdp = await Cdp.connect(wsUrl); cleanups.push(async () => { try { cdp.ws.close(); } catch { /* closed */ } });
  const only = (process.env.PROOF_SCENARIOS ?? 'abcdghi').split('');
  if (only.includes('a')) await scenario('a', 'Employee sign-in, cross-origin preflight, bearer GET and typed account failure', (s) => scenarioA(cdp, s, ctx));
  if (only.includes('b')) await scenario('b', 'Denied: unmapped subject and employee on a Greg-only page', (s) => scenarioB(cdp, s));
  if (only.includes('c')) await scenario('c', 'Token expiry, re-login and recovery without automatic submission', (s) => scenarioC(cdp, s));
  if (only.includes('d')) await scenario('d', 'Disallowed origin is blocked by CORS', (s) => scenarioD(cdp, s, ctx));
  if (only.includes('g')) await scenario('g', 'Stale draft: typed 409 keeps the user\'s edits and does not resubmit', (s) => scenarioG(cdp, s, ctx));
  if (only.includes('i')) await scenario('i', 'Typed 404 for an unknown offer', (s) => scenarioI(cdp, s, ctx));
  if (only.includes('h')) await scenario('h', 'Database unavailable: typed 503, useful state and recovery', (s) => scenarioH(cdp, s));
  receipt.apiAccessLog = accessLogSummary();
  const ordersPosted = receipt.apiAccessLog.orderSubmits;
  if (receipt.scenarios.c) { const c = receipt.scenarios.c; c.checks.serverAccessLogNoOrderSubmitWholeRun = ordersPosted === 0; c.pass = Object.values(c.checks).every((v) => v === true); }
}

async function teardown() {
  for (const fn of cleanups.splice(0).reverse()) { try { await fn(); } catch (e) { log('cleanup error', e.message); } }
  const expected = '/tmp/vm-poller-DEV-2026-11-13-003/proof';
  const safe = SCRATCH === expected || (SCRATCH.startsWith('/tmp/') && path.basename(SCRATCH) === 'proof');
  if (safe) rmSync(SCRATCH, { recursive: true, force: true });
  receipt.teardown = { scratch: SCRATCH, removed: safe && !existsSync(SCRATCH), javaLockReleased: receipt.javaLock ? receipt.javaLock.released === true : null, proofDatabaseDropped: receipt.database ? receipt.database.dropped === true : null, retained: ['docs/gcsp/evidence/fucq435/2026-11-17/cross-origin-proof.json', 'docs/gcsp/evidence/fucq435/2026-11-17/*.png'], leftoverInRepo: 'apps/gcsp-web/node_modules, apps/gcsp-web/dist and services/gcsp-api/target are git-ignored build outputs left in place' };
}
function finish(extra) {
  if (finished) return; finished = true;
  const all = Object.keys(receipt.scenarios);
  receipt.endedAt = new Date().toISOString();
  const expected = (process.env.PROOF_SCENARIOS ?? 'abcdghi').length + 2;
  receipt.overall = all.length === expected && all.every((k) => receipt.scenarios[k].pass) && !extra && !receipt.productDefects.length ? 'PASS' : 'FAIL';
  receipt.screenshots = shots;
  if (extra) receipt.runError = extra;
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, 'cross-origin-proof.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  for (const k of all.sort()) console.log(`  ${k}: ${receipt.scenarios[k].pass ? 'PASS' : 'FAIL'} ${receipt.scenarios[k].title}`);
  console.log(`overall ${receipt.overall}; scratch removed: ${receipt.teardown?.removed}`);
}
const deadline = setTimeout(async () => { log('global deadline exceeded'); await teardown(); finish('global deadline exceeded'); process.exit(1); }, DEADLINE_MS);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await teardown(); finish(`interrupted by ${sig}`); process.exit(130); });
let runError;
try { await main(); } catch (e) { runError = e.message; console.error('RUN ERROR:', e.stack ?? e.message); } finally { clearTimeout(deadline); await teardown(); finish(runError); }
process.exit(receipt.overall === 'PASS' ? 0 : 1);
