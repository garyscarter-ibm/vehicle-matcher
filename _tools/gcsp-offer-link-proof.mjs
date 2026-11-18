#!/usr/bin/env node
// FUCQ-465 offer links / opt-in FUCQ-466 native decisions: HTTPS web, API and a LOCAL TEST OIDC issuer (not the real provider), driven by headless Chrome.
// API runs the documented dev composition on a run-owned PostgreSQL database. Zero dependencies; scratch is removed on exit, receipt and screenshots kept.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, createSign, generateKeyPairSync, randomBytes, createPublicKey } from 'node:crypto';
import { createServer } from 'node:https';
import https from 'node:https';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, rmdirSync, readdirSync, statSync, createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startRemoteDecisionServer, remoteDecisionScenarios } from './gcsp-remote-decision-scenarios.mjs';
import { startRemoteOrderingServer, orderingDecisionScenarios } from './gcsp-ordering-decision-scenarios.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REMOTE_DECISION_PROOF = process.env.PROOF_STORY === '467';
const DECISION_PROOF = REMOTE_DECISION_PROOF || process.env.PROOF_STORY === '466';
const ORDERING_PROOF = process.env.PROOF_STORY === '466' && ['pending', 'refused'].includes(process.env.PROOF_ORDERING_CASE);
const OWNED_SCRATCH = ORDERING_PROOF ? '/private/tmp/vm-poller-20261118-hugh-466-ordering/browser' : REMOTE_DECISION_PROOF ? '/private/tmp/vm-poller-20261118-sulley-467/browser' : DECISION_PROOF ? '/private/tmp/vm-poller-20261118-hugh-466/browser' : '/private/tmp/vm-poller-20261117-hugh-465/browser';
const SCRATCH = path.resolve(process.env.SCRATCH ?? OWNED_SCRATCH);
const EVIDENCE = path.join(ROOT, `docs/gcsp/evidence/fucq${REMOTE_DECISION_PROOF ? '467' : DECISION_PROOF ? '466' : '465'}/${ORDERING_PROOF ? 'browser-ordering-' + process.env.PROOF_ORDERING_CASE : REMOTE_DECISION_PROOF && process.env.PROOF_REMOTE_CASE === 'decline-refused' ? 'browser-refused' : 'browser'}`);
const DEADLINE_MS = Number(process.env.PROOF_DEADLINE_SEC ?? 600) * 1000;
// Adapted from scripts/gcsp/fucq435-cross-origin-proof.mjs: same real local issuer/PKCE/CDP, scoped to owned offer-link proof.
const PG = { bin: '/opt/homebrew/opt/postgresql@17/bin', host: '127.0.0.1', port: '55465', user: 'gcsp', db: 'gcsp_test_dev' };
const JAVA_LOCK = '/tmp/vm-poller-java-verify.lock';
const DB_URL = 'jdbc:postgresql://127.0.0.1:55465/gcsp_test_dev';
const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const NODE_VERSION = '24.22.3';
const ORIGINS = { web: 'https://gcsp-web.example.test:7443', api: 'https://gcsp-api.localhost:8443', idp: 'https://gcsp-idp.localhost:9443', evil: 'https://evil.localhost:7444' };
const ISSUER = `${ORIGINS.idp}/realms/gcsp-local`;
const API_BASE = `${ORIGINS.api}/api/gcsp/v1`;
const KID = 'gcsp-local-test-1';
const TRUST_PASS = 'proof-local-trust';
const dirs = { logs: path.join(SCRATCH, 'logs'), tmp: path.join(SCRATCH, 'tmp'), certs: path.join(SCRATCH, 'certs'), node: path.join(SCRATCH, 'node'), static: path.join(SCRATCH, 'static'), browser: path.join(SCRATCH, 'browser') };
const startedAt = new Date().toISOString();
const shots = [];
const receipt = { productDefects: [], schema: 'fucq465-browser-proof/1', story: 'DEV-2026-11-13-033 / FUCQ-465', startedAt, origins: ORIGINS, localTestIssuer: `LOCAL TEST OIDC ISSUER ${ISSUER}: harness only, not the real provider and not committed configuration`, tools: {}, deviations: [], scenarios: {}, gaps: ['Actual hosted Render origins and real OIDC provider registration do not exist yet (Gary creates them); not proven here.'], failureLogs: {} };
if (DECISION_PROOF) { receipt.schema = 'fucq466-browser-proof/1'; receipt.story = 'DEV-2026-11-13-034 / FUCQ-466'; }
if (REMOTE_DECISION_PROOF) { receipt.schema = 'fucq467-browser-proof/1'; receipt.story = 'DEV-2026-11-13-035 / FUCQ-467'; }
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
  const run = ORDERING_PROOF ? 'hugh-466-ordering' : REMOTE_DECISION_PROOF ? 'sulley-467' : DECISION_PROOF ? 'hugh-466' : 'hugh-465';
  if (process.env.GCSP_PROOF_SUPERVISED_LOCK !== run) throw new Error('Run with the resource supervisor that owns the Java lane');
  const owner = JSON.parse(readFileSync(path.join(JAVA_LOCK, 'owner.json'), 'utf8'));
  if (owner.run !== `${run}-browser`) throw new Error('Java lane belongs to another run');
  receipt.javaLock = { path: JAVA_LOCK, supervised: true };
}
const pg = (args, bin = 'psql') => execFileSync(path.join(PG.bin, bin), ['-h', PG.host, '-p', PG.port, '-U', PG.user, ...args], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function createProofDb() {
  const data = path.join(SCRATCH, 'pg');
  await run('initdb', path.join(PG.bin, 'initdb'), ['-D', data, '-U', PG.user, '-A', 'trust', '--no-locale']);
  execFileSync(path.join(PG.bin, 'pg_ctl'), ['-D', data, '-l', path.join(dirs.logs, 'postgres.log'), '-o', `-p ${PG.port} -k ${SCRATCH} -h 127.0.0.1 -c shared_buffers=32MB -c max_connections=30`, '-w', 'start'], { timeout: 30000, stdio:'pipe' });
  cleanups.push(() => { execFileSync(path.join(PG.bin,'pg_ctl'), ['-D',data,'-m','fast','-w','stop'], {timeout:30000,stdio:'pipe'}); receipt.database.stopped = true; });
  pg([PG.db], 'createdb');
  receipt.database = {server:`127.0.0.1:${PG.port}`,name:PG.db,data,owned:true,stopped:false};
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
  writeFileSync(c('leaf.ext'), 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:gcsp-web.localhost,DNS:gcsp-web.example.test,DNS:gcsp-api.localhost,DNS:gcsp-idp.localhost,DNS:evil.localhost,DNS:localhost,IP:127.0.0.1\n');
  ssl(['x509', '-req', '-in', c('leaf.csr'), '-CA', c('ca.pem'), '-CAkey', c('ca.key'), '-CAcreateserial', '-days', '3', '-sha256', '-extfile', c('leaf.ext'), '-out', c('leaf.pem')]);
  writeFileSync(c('fullchain.pem'), readFileSync(c('leaf.pem'), 'utf8') + readFileSync(c('ca.pem'), 'utf8'));
  const pub = ssl(['x509', '-in', c('leaf.pem'), '-pubkey', '-noout']);
  const der = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'der'], { input: pub });
  const spki = createHash('sha256').update(der).digest('base64');
  execFileSync(path.join(JAVA_HOME, 'bin/keytool'), ['-importcert', '-alias', 'gcsp-local-ca', '-file', c('ca.pem'), '-keystore', c('truststore.p12'), '-storetype', 'PKCS12', '-storepass', TRUST_PASS, '-noprompt'], { stdio: 'pipe', timeout: 60000 });
  return { ca: readFileSync(c('ca.pem'), 'utf8'), cert: readFileSync(c('fullchain.pem')), key: readFileSync(c('leaf.key')), keyPem: readFileSync(c('leaf.key'), 'utf8'), spki, trust: c('truststore.p12') };
}

// ---------- local test OIDC issuer ----------
const idp = { lifetimeSec: 3600, codes: new Map(), txns: new Map(), subjects: { 'sub-employee': ['employee'], 'sub-alex': ['employee'], 'sub-jordan': ['employee'], 'sub-greg': ['greg'], 'sub-presenter': ['presenter'], 'sub-unmapped': ['employee'] }, keys: null, wrongKeys: null, server: null };
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
      if (p.request.method === 'POST' && p.request.url.endsWith('/decision') && p.request.postData) {
        try { e.decisionInput = JSON.parse(p.request.postData); } catch { /* not a decision body */ }
      }
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
    for (const [w, h, tag] of [[1280, 800, '1280x800'], [390, 844, '390x844']]) {
      await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 }); await sleep(700);
      (receipt.viewportEvidence??={})[`${base}-${tag}`]=await this.eval(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,mainWidth:document.querySelector('#gcsp-main')?.offsetWidth,focused:{tag:document.activeElement?.tagName,text:document.activeElement?.textContent?.trim().slice(0,80)},controls:[...document.querySelectorAll('#gcsp-main button')].filter(e=>e.offsetWidth&&e.getBoundingClientRect().bottom>0&&e.getBoundingClientRect().top<innerHeight).map(e=>({text:e.textContent.trim(),width:e.offsetWidth,height:e.offsetHeight,disabled:e.disabled}))})`);
      out.push(await this.shot(`${base}-${tag}.png`));
    }
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
async function signInAs(page, subject, from = `${ORIGINS.web}/gcsp/`, capture = false) {
  await page.send('Page.navigate', { url: from });
  await page.waitFor(`location.origin==='${ORIGINS.web}' && [...document.querySelectorAll('#gcsp-main button')].some(b=>b.textContent.trim()==='Sign in')`, 25000, 'sign-in page');
  if(capture)await page.shotBoth('signed-out-link');
  await page.eval(`[...document.querySelectorAll('#gcsp-main button')].find(b=>b.textContent.trim()==='Sign in').click()`);
  await chooseSubject(page, subject);
}
async function chooseSubject(page, subject) {
  await page.waitFor(`location.origin==='${ORIGINS.idp}' && document.querySelector('button[data-subject="${subject}"]')`, 25000, 'issuer login form');
  await page.eval(`document.querySelector('button[data-subject="${subject}"]').click()`);
}


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

const main$ = `(document.querySelector('#gcsp-main')??document.body).innerText`;
async function requireApi(ctx, method, route, token, body) {
  const r = await direct(ctx, method, route, token, body);
  if (r.status !== 200) throw new Error(`${method} ${route}: ${r.status} ${r.json?.code ?? ''}`);
  return r.json.value;
}
async function prepareOffer(ctx,subject='sub-employee',employeeId='employee-paula') {
  const employee = mint(subject, ['employee']);
  const presenter = mint('sub-presenter', ['presenter']);
  await ensureStock(ctx);
  let editor = (await requireApi(ctx, 'GET', '/brief/editor', employee)).initial;
  await requireApi(ctx, 'POST', '/brief/preferences', employee, { commandId: uid(), expectedBriefVersion: editor.briefVersion, expectedDraftVersion: editor.draftVersion, changes: { comfort: { value: 50 }, body: { value: ['estate'] }, sportiness: { value: 50 } } });
  editor = (await requireApi(ctx, 'GET', '/brief/editor', employee)).initial;
  await requireApi(ctx, 'POST', '/brief/engage', employee, { commandId: uid(), expectedBriefVersion: editor.briefVersion, expectedDraftVersion: editor.draftVersion });
  const clock = await requireApi(ctx, 'GET', '/presenter/clock', presenter);
  await requireApi(ctx, 'POST', '/presenter/clock/tick', presenter, { tickId: uid(), expectedClockVersion: clock.clockVersion });
  const current = await requireApi(ctx, 'GET', '/offers/current', employee);
  const offer = current.offers.find((o) => o.state === 'active' || o.state === 'pending');
  if (!offer) throw new Error(`No current offer from actual allocation: ${JSON.stringify(current)}`);
  const outbox = await requireApi(ctx, 'GET', '/presenter/outbox', presenter);
  const mail = outbox.messages.find((m) => m.recipient.employeeId === employeeId && m.offerLink && decodeURIComponent(new URL(m.offerLink,ORIGINS.web).pathname.split('/').pop()) === offer.offerId);
  if (!mail?.offerLink) throw new Error('No captured notification link for allocated offer');
  const tRead=performance.now();
  const projection = await requireApi(ctx, 'GET', `/offers/${encodeURIComponent(offer.offerId)}`, employee);
  receipt.ownerReadMilliseconds=performance.now()-tRead;
  (receipt.preparation??=[]).push({ via: 'Public employee brief/preferences/engage and presenter release/tick APIs; no offer SQL fixture', offerId: offer.offerId, capturedLink: mail.offerLink, actualState: projection.state, displayedVehicle: projection.quote.facts.display.name, delivery: 'captured local outbox, not external email' });
  return { employee, presenter, offerId: offer.offerId, link: mail.offerLink, projection };
}
async function pageEvidence(page, base) {
  const text = await page.main();
  const geometry = await page.eval(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,main:document.querySelector('#gcsp-main')?.getBoundingClientRect().toJSON(),buttons:[...document.querySelectorAll('#gcsp-main button')].filter(b=>b.offsetWidth).map(b=>({text:b.textContent.trim(),disabled:b.disabled,width:b.offsetWidth,height:b.offsetHeight}))})`);
  return { text: text.slice(0, 12000), geometry, screenshots: await page.shotBoth(base) };
}
async function focusVisibility(page) {
  const results=[];
  for(const [width,height] of [[1280,800],[390,844]]) {
    await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
    await page.eval(`document.querySelector('input[id$="-mileage"]').focus()`);
    for(let step=0;step<6;step++) {
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9}); await sleep(80);
      results.push(await page.eval(`(() => {const e=document.activeElement,l=e?.closest('label'),d=e?.closest('[role="dialog"],dialog'),f=d?.querySelector('[drawer-footer]');return {width:innerWidth,step:${step},tag:e?.tagName,id:e?.id,text:l?.textContent.trim()??e?.textContent.trim().slice(0,80),control:e?.getBoundingClientRect().toJSON(),label:l?.getBoundingClientRect().toJSON(),footer:f?.getBoundingClientRect().toJSON(),inDialog:!!d};})()`));
      if(results.at(-1).id?.includes('declaration-2'))await page.shot(`focused-third-${width}x${height}.png`);
    }
  }
  await page.send('Emulation.setDeviceMetricsOverride',{width:1000,height:720,deviceScaleFactor:1,mobile:false});
  return results;
}
async function declineScenario(cdp, ctx, restartApi) {
  await scenario('decline-followup-restart', 'Native decline releases once, saves a supported answer and survives ordinary restart', async (s) => {
    const next = await prepareOffer(ctx,'sub-alex','employee-alex');
    const page = await newPage(cdp);
    try {
      await signInAs(page,'sub-alex',next.link);
      await page.waitFor(`document.querySelector('[data-offer-action="decline"]')`,30000,'owned offer to decline');
      await page.eval(`document.querySelector('[data-offer-action="decline"]').click()`);
      await page.waitFor(`document.querySelector('input[type="radio"][value="body-style"]')`,10000,'adopted decline registry');
      s.checks.reasonRequired = await page.eval(`document.querySelector('[data-offer-action="confirm"]').disabled`);
      s.observations.unselected = await pageEvidence(page,'decline-unselected');
      await page.eval(`document.querySelector('input[type="radio"][value="body-style"]').click()`);
      s.observations.selected = await pageEvidence(page,'decline-selected');
      await page.eval(`document.querySelector('[data-offer-action="confirm"]').click()`);
      await page.waitFor(`${main$}.match(/Offer declined/i) && document.querySelector('.followup form')`,20000,'native decline and supported follow-up');
      s.checks.nativeDeclineRendered = true;
      await page.settle();
      const native = page.log.findLast(e=>e.method==='POST'&&e.url.endsWith('/decision'));
      s.checks.canonicalBrowserPost = native?.status===200 && native.decisionInput?.decision==='decline'
        && native.decisionInput?.runId==='run-1' && native.decisionInput?.expectedQuoteVersion===1;
      const current = await requireApi(ctx,'GET',`/offers/${encodeURIComponent(next.offerId)}`,next.employee);
      s.checks.custodyReleased = current.state==='declined' && current.holdState==='released' && current.availableActions.length===0;
      const replay = await direct(ctx,'POST',`/offers/${encodeURIComponent(next.offerId)}/decision`,next.employee,native.decisionInput);
      s.checks.declineReplays = replay.status===200 && replay.json?.value?.decisionId===current.followup?.decisionId;
      s.observations.declined = await pageEvidence(page,'declined-followup');
      await page.eval(`(() => {const choices=[...document.querySelectorAll('.followup form input[type="radio"]')];const e=choices.find(e=>e.value!=='estate');if(!e)throw new Error('No supported alternative');e.click();})()`);
      await page.waitFor(`!document.querySelector('.followup form button[type="submit"]').disabled`,5000,'confirmed changed answer');
      await page.eval(`document.querySelector('.followup form button[type="submit"]').click()`);
      await page.waitFor(`!document.querySelector('.followup form') && ${main$}.match(/saved|looking|waiting/i)`,15000,'saved follow-up answer');
      const followup = await requireApi(ctx,'GET',`/offer-followup?decisionId=${encodeURIComponent(current.followup.decisionId)}`,next.employee);
      s.checks.supportedAnswerSaved = ['waiting','change-saved'].includes(followup.state) && !!followup.savedChange;
      s.observations.saved = await pageEvidence(page,'followup-saved');
      await restartApi(); await page.send('Page.navigate',{url:next.link});
      await page.waitFor(`${main$}.match(/Offer declined/i)`,30000,'declined offer after restart');
      const persisted = await requireApi(ctx,'GET',`/offer-followup?decisionId=${encodeURIComponent(current.followup.decisionId)}`,next.employee);
      s.checks.savedAnswerSurvivesRestart = JSON.stringify(followup)===JSON.stringify(persisted);
      s.observations.restarted = await pageEvidence(page,'declined-restart');
      s.observations.network = page.api();
    } catch(e) { s.observations.failure = await pageEvidence(page,'decline-failure'); throw e; }
    finally { await closePage(cdp,page); }
  });
}
async function browserScenarios(cdp, ctx, prepared, restartApi) {
  await scenario('owner-return-restart', 'Captured new link returns through OIDC PKCE to the correct current offer and survives API restart', async (s) => {
    const page = await newPage(cdp);
    try {
      await signInAs(page, 'sub-employee', prepared.link, true);
      await page.waitFor(`${main$}.match(/Your offer/i) && document.querySelector('[data-offer-action="accept"]')`, 30000, 'current owned offer');
      s.checks.capturedLinkReturnsToExactOffer = decodeURIComponent(await page.eval('location.pathname')) === decodeURIComponent(new URL(prepared.link).pathname);
      s.checks.actualVehicleVisible = (await page.main()).includes(prepared.projection.quote.facts.display.name);
      s.checks.actionsMatchAuthority = await page.eval(`!document.querySelector('[data-offer-action="accept"]').disabled && !document.querySelector('[data-offer-action="decline"]').disabled`);
      s.observations.pending = await pageEvidence(page, 'pending');
      if (DECISION_PROOF) {
        const currentVersion='browser-current-ordering-v1';
        const quotePolicy=prepared.projection.quote.policyVersion;
        const raw=pg(['-d',PG.db,'-Atc',`SELECT d.document::text FROM gcsp_app.policy_versions v JOIN gcsp_app.policy_documents d USING(seed_digest) WHERE v.environment_id='local-offer-link-proof' AND v.run_id='run-1' AND v.policy_version='${quotePolicy}'`]);
        const seed=JSON.parse(raw.replaceAll(quotePolicy,currentVersion));
        seed.effectiveFrom=new Date(Date.parse(prepared.projection.serverNow)-1000).toISOString();
        const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
        const digest=createHash('sha256').update(canonical(seed)).digest('hex');
        const sqlText=v=>"'"+v.replaceAll("'","''")+"'";
        const sql=`BEGIN; SET LOCAL search_path=gcsp_app; INSERT INTO policy_documents(seed_digest,document) VALUES('${digest}',${sqlText(JSON.stringify(seed))}::jsonb); INSERT INTO policy_versions(environment_id,run_id,policy_version,effective_from,seed_digest,source_version,publisher,published_at,command_id) VALUES('local-offer-link-proof','run-1','${currentVersion}','${seed.effectiveFrom}','${digest}','${quotePolicy}','owned-browser-policy-fixture',now(),'browser-retained-policy-fixture'); COMMIT;`;
        pg(['-d',PG.db,'-v','ON_ERROR_STOP=1','-c',sql]);
        s.observations.policySplit={quotePolicy,currentPolicy:currentVersion,effectiveFrom:seed.effectiveFrom,seedDigest:digest,
          via:'Transparent immutable successor-policy fixture in owned native PG only; copies actual reviewed adopted document with successor version/effectiveFrom and verified canonical digest. No offer, decision, selection, custody or provider outcome is inserted.'};
        await restartApi(currentVersion);
      } else await restartApi();
      await page.send('Page.navigate', {url: prepared.link});
      await page.waitFor(`document.querySelector('[data-offer-action="accept"]')`, 30000, 'same offer after ordinary process restart');
      s.checks.restartKeepsIdentity = (await page.main()).includes(prepared.projection.quote.facts.display.name);
      await page.eval(`document.querySelector('[data-offer-action="accept"]').click()`);
      await page.waitFor(`document.querySelector('[role="dialog"][open],dialog[open],[role="dialog"][aria-modal="true"]')`, 5000, 'accept review drawer');
      s.checks.unconfirmedDecisionDisabled = await page.eval(`document.querySelector('[data-offer-action="confirm"]').disabled`);
      s.observations.drawerFocus=[];
      for(let i=0;i<5;i++){await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});s.observations.drawerFocus.push(await page.eval(`({tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label')??document.activeElement?.textContent?.trim().slice(0,80),inDialog:!!document.activeElement?.closest('[role="dialog"],dialog')})`));}
      s.checks.keyboardStaysInReview=s.observations.drawerFocus.every(f=>f.inDialog);
      s.observations.review = await pageEvidence(page, 'accept-review');
      s.observations.focusVisibility = await focusVisibility(page);
      const mileage = await page.eval(`(() => { const e=document.querySelector('input[id$="-mileage"]');if(!e)return false;e.value='not-a-mileage';e.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
      if (mileage) { await sleep(100); s.checks.invalidMileageDisabled = await page.eval(`document.querySelector('[data-offer-action="confirm"]').disabled`); s.observations.validation = await pageEvidence(page, 'accept-validation'); }
      await page.eval(`(() => {const e=document.querySelector('input[id$="-mileage"]');if(e){e.value='45000';e.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelectorAll('[role="dialog"] input[type="checkbox"],dialog input[type="checkbox"]').forEach(e=>{if(!e.checked)e.click();});})()`);
      await page.waitFor(`!document.querySelector('[data-offer-action="confirm"]').disabled`, 5000, 'complete declarations');
      await page.eval(`document.querySelector('[data-offer-action="confirm"]').click()`);
      await page.waitFor(`!document.querySelector('[data-offer-action="confirm"]')`, 15000, 'decision response');
      await page.settle(); s.observations.decisionNetwork = page.api();
      s.observations.immediateDecision = await pageEvidence(page, 'decision-response');
      const after = await direct(ctx,'GET',`/offers/${encodeURIComponent(prepared.offerId)}`,prepared.employee);
      s.observations.currentAfterDecision = {status:after.status,code:after.json?.code,state:after.json?.value?.state,availableActions:after.json?.value?.availableActions};
      if(DECISION_PROOF && !(await page.main()).match(/Offer accepted/i)) throw new Error('Native Angular decision did not render accepted; no fallback is allowed');
      if(!DECISION_PROOF && !(await page.main()).match(/Offer accepted/i)) {
        const decision = s.observations.decisionNetwork.findLast(e=>e.method==='POST'&&e.path.endsWith('/decision'));
        if(decision?.status!==400||decision.body?.code!=='invalid-offer-decision'||after.json?.value?.state!=='pending') throw new Error('Unexpected decision failure; no setup retry permitted');
        receipt.productDefects.push({boundary:'FUCQ-466 native Angular decision command',observed:'POST400 invalid-offer-decision; no transition, verified pending GET',cause:'Angular sends runId and expectedQuoteVersion, both excluded by existing OfferDecisions.KEYS',unfixed:true});
        const offer=after.json.value;
        const setup=await direct(ctx,'POST',`/offers/${encodeURIComponent(prepared.offerId)}/decision`,prepared.employee,{commandId:uid(),decision:'accept',expectedOfferVersion:offer.offerVersion,expectedHoldVersion:offer.holdVersion,termsDigest:offer.handoff.termsDigest,declarations:Object.fromEntries(offer.handoff.declarations.map(d=>[d.id,true])),...(offer.handoff.mode==='replacement'?{expectedReturnMileage:45000}:{})});
        s.observations.terminalSetup={via:'Explicit authenticated public API using current Java contract, separate command after pre-write browser refusal; no SQL, intercept or product fallback',status:setup.status,state:setup.json?.value?.state};
        if(setup.status!==200||setup.json?.value?.state!=='accepted') throw new Error('Explicit accepted-state setup failed');
        await page.send('Page.navigate',{url:prepared.link});
      }
      await page.waitFor(`${main$}.match(/Offer accepted/i)`, 10000, 'accepted current state after explicit check');
      s.checks.acceptedShowsCurrentState = true;
      s.checks.terminalHasNoDecisionAuthority = await page.eval(`![...document.querySelectorAll('[data-offer-action]')].some(b=>['accept','decline'].includes(b.dataset.offerAction))`);
      s.observations.accepted = await pageEvidence(page, 'accepted');
      if (DECISION_PROOF) {
        const native = page.log.findLast(e => e.method === 'POST' && e.url.endsWith('/decision'));
        s.checks.nativeAngularCommandSucceeded = native?.status === 200 && native?.decisionInput?.runId === 'run-1'
          && native?.decisionInput?.expectedQuoteVersion === 1;
        if (!s.checks.nativeAngularCommandSucceeded) throw new Error('Missing successful canonical browser POST');
        const replay = await direct(ctx,'POST',`/offers/${encodeURIComponent(prepared.offerId)}/decision`,prepared.employee,native.decisionInput);
        s.checks.sameCommandReplays = replay.status === 200 && replay.json?.value?.state === 'accepted';
        s.checks.retainedPolicyReceipt = replay.json?.value?.policyVersion===prepared.projection.quote.policyVersion
          && replay.json?.value?.selection===null && !!replay.json?.value?.operationId;
        s.checks.currentReadShowsSavedProgress = after.status===200 && after.json?.value?.selection?.selectionState==='acknowledged'
          && !!after.json?.value?.selection?.orderReference;
        await page.eval(`document.querySelector('[data-offer-action="check"]').click()`);
        await page.waitFor(`${main$}.includes('Selection received. Waiting for')`,10000,'actual saved ordering progress after check');
        s.observations.currentProgress = await pageEvidence(page,'accepted-current-progress');
        const conflict = await direct(ctx,'POST',`/offers/${encodeURIComponent(prepared.offerId)}/decision`,prepared.employee,{...native.decisionInput,expectedReturnMileage:45001});
        s.checks.changedCommandRefused = conflict.status === 409 && conflict.json?.code === 'command-input-changed';
        s.observations.replay = {status:replay.status,state:replay.json?.value?.state,operationId:replay.json?.value?.operationId,
          changedInputStatus:conflict.status,changedInputCode:conflict.json?.code};
        await restartApi(); await page.send('Page.navigate',{url:prepared.link});
        await page.waitFor(`${main$}.match(/Offer accepted/i)`,30000,'accepted offer after ordinary restart');
        s.checks.acceptedSurvivesRestart = true;
        s.observations.acceptedAfterRestart = await pageEvidence(page,'accepted-restart');
      }
      await page.settle(); s.observations.network = page.api();
    } catch(e) { s.observations.ownerFailure = await pageEvidence(page,'owner-result'); await page.settle(); s.observations.network = page.api(); throw e; } finally { await closePage(cdp, page); }
  });
  if(DECISION_PROOF && process.env.PROOF_ACCEPT_ONLY==='1') {receipt.reusedEvidence='Scoped acceptance correction rerun; matching earlier actual native decline/follow-up/restart and authority refusal scenarios retained in browser-setup-attempts.json and Markdown summary.'; return;}
  if (DECISION_PROOF) { await restartApi('gcsp-policy-v1+offer-journey-v1'); await declineScenario(cdp,ctx,restartApi); }
  if(process.env.PROOF_OWNER_ONLY==='1') {receipt.reusedRefusals='Wrong employee/presenter/unknown/invalid passed in matching prior chunk; expiry remains covered by unchanged native HTTP acceptance test and F465 browser evidence. No Jordan allocation obtained in this setup.'; return;}
  for (const [id, subject, link, expected] of [
    ['wrong-employee','sub-jordan',prepared.link,403],
    ['presenter','sub-presenter',prepared.link,403],
    ['unknown','sub-employee',`${ORIGINS.web}/gcsp/offers/${encodeURIComponent('buddy-offer:'+'f'.repeat(64))}`,404],
    ['invalid','sub-employee',`${ORIGINS.web}/gcsp/offers/bad%20id`,400],
  ]) await scenario(id, `${id} link gives no decision authority`, async (s) => {
    const page = await newPage(cdp);
    try {
      await signInAs(page, subject, link);
      await page.waitFor(`${main$}.match(/incomplete|not available|not found|not valid|not have|cannot|could not|another|access|no longer|unavailable|valid offer/i) && !${main$}.includes('Please wait.')`, 30000, 'safe refusal state');
      s.checks.noDecisionControls = await page.eval(`!document.querySelector('[data-offer-action="accept"],[data-offer-action="decline"],[data-offer-action="confirm"]')`);
      await page.settle(); s.observations.network = page.api();
      const directRefusal=await direct(ctx,'GET',`/offers/${new URL(link).pathname.split('/').pop()}`,mint(subject,idp.subjects[subject]));
      s.observations.directRefusal={status:directRefusal.status,code:directRefusal.json?.code};
      s.checks.typedRefusal=directRefusal.status===expected;
      s.observations.screen = await pageEvidence(page, id);
    } finally { await closePage(cdp, page); }
  });
  await scenario('expired','A real second employee offer follows the run clock to expiry with no decision authority',async(s)=>{
    const subject=DECISION_PROOF?'sub-jordan':'sub-alex';
    const next=await prepareOffer(ctx,subject,DECISION_PROOF?'employee-jordan':'employee-alex');
    const clock=await requireApi(ctx,'GET','/presenter/clock',next.presenter);
    await requireApi(ctx,'POST','/presenter/clock/advance',next.presenter,{commandId:uid(),expectedClockVersion:clock.clockVersion,bySeconds:8*24*60*60});
    const page=await newPage(cdp);
    try{await signInAs(page,subject,next.link);await page.waitFor(`${main$}.match(/Offer expired/i)`,30000,'expired current offer');s.checks.actualExpiryVisible=true;s.checks.noDecisionControls=await page.eval(`!document.querySelector('[data-offer-action="accept"],[data-offer-action="decline"]')`);s.observations.screen=await pageEvidence(page,'expired');}
    finally{await closePage(cdp,page);}
  });
}

async function main() {
  mkdirSync(EVIDENCE, {recursive:true}); for (const d of Object.values(dirs)) mkdirSync(d,{recursive:true});
  receipt.head=cap('git',['-C',ROOT,'rev-parse','HEAD']);
  receipt.tools={harnessNode:process.version,chrome:cap(CHROME,['--version'])};
  let tls; let nodeEnv={};
  const reuse=process.env.PROOF_REUSE_BUILD==='1';
  if(reuse){mkdirSync(path.join(dirs.node,'bin'),{recursive:true});for(const bin of ['node','npm','npx'])execFileSync('ln',['-s',`/opt/homebrew/opt/node@24/bin/${bin}`,path.join(dirs.node,'bin',bin)]);receipt.reusedBuild='Prior matching Angular source build and focused offer tests; runtime assembly only';}
  else nodeEnv=await ensureNode();
  receipt.tools.buildNode=cap(path.join(dirs.node,'bin/node'),['--version']);
  if(!reuse){
    if(!existsSync(path.join(ROOT,'apps/gcsp-web/node_modules'))) await run('npm-ci','npm',['--prefix','apps/gcsp-web','ci','--no-audit','--no-fund'],{env:nodeEnv,timeout:240000});
    await run('ng-offers-tests','npm',['--prefix','apps/gcsp-web','test','--','--include=src/app/offers/**/*.spec.ts'],{env:nodeEnv,timeout:240000});
    await run('ng-build','npm',['--prefix','apps/gcsp-web','run','build','--','--configuration','production'],{env:nodeEnv,timeout:240000});
    for(const name of ['ng-offers-tests','ng-build'])receipt[name]=tail(path.join(dirs.logs,`${name}.log`),18);
  }
  const assemble=await import(pathToFileURL(path.join(ROOT,'scripts/build-gcsp-static.mjs')).href);
  await run('assemble',path.join(dirs.node,'bin/node'),['scripts/build-gcsp-static.mjs','--browser',process.env.PROOF_ANGULAR_BUILD ?? 'apps/gcsp-web/dist/gcsp-web/browser','--output',dirs.static,'--environment','deployed','--revision',receipt.head],{env:{...nodeEnv,GCSP_PUBLIC_ENVIRONMENT_ID:'local-offer-link-proof',GCSP_PUBLIC_API_BASE_URL:API_BASE,GCSP_PUBLIC_OIDC_AUTHORITY:ISSUER,GCSP_PUBLIC_OIDC_CLIENT_ID:'gcsp-web',GCSP_PUBLIC_OIDC_SCOPE:'openid profile gcsp-api',GCSP_PUBLIC_OIDC_REDIRECT_URI:`${ORIGINS.web}/gcsp/auth/callback`,GCSP_PUBLIC_OIDC_POST_LOGOUT_REDIRECT_URI:`${ORIGINS.web}/gcsp/`}});
  if(process.env.PROOF_BUILD_ONLY==='1'){receipt.buildOnly=true;return;}
  await takeJavaLock();
  tls=makeCerts();
  await run('mvn-package','./mvnw',['-B','-q','-DskipTests','package'],{cwd:path.join(ROOT,'services/gcsp-api'),timeout:300000,env:{MAVEN_OPTS:'-Xmx512m'}});
  await createProofDb(); await startIdp(tls); await startWeb(tls,assemble.GCSP_FIXED_ROUTES);
  const remote = REMOTE_DECISION_PROOF ? await startRemoteDecisionServer(tls, { pg, database: PG.db }) : null;
  if (remote) cleanups.push(() => remote.close());
  const remoteOrdering = ORDERING_PROOF ? await startRemoteOrderingServer(tls, { pg, database: PG.db, outcome: process.env.PROOF_ORDERING_CASE }) : null;
  if (remoteOrdering) cleanups.push(() => remoteOrdering.close());
  const apiEnv={...baseEnv(),QUARKUS_HTTP_SSL_PORT:'8443',QUARKUS_HTTP_INSECURE_REQUESTS:'disabled',QUARKUS_HTTP_SSL_CERTIFICATE_FILES:path.join(dirs.certs,'fullchain.pem'),QUARKUS_HTTP_SSL_CERTIFICATE_KEY_FILES:path.join(dirs.certs,'leaf.key'),GCSP_ALLOWED_ORIGINS:ORIGINS.web,GCSP_IDENTITY_PROVIDER:'oidc',GCSP_OIDC_ISSUER:ISSUER,GCSP_OIDC_JWKS_URI:'https://127.0.0.1:9443/realms/gcsp-local/protocol/openid-connect/certs',GCSP_OIDC_AUDIENCE:'gcsp-api',GCSP_OIDC_AUTHORIZED_PARTY:'gcsp-web',GCSP_OIDC_REQUIRED_SCOPES:'gcsp-api',GCSP_OIDC_ACCOUNTS:JSON.stringify([{subject:'sub-employee',roles:['employee'],employeeId:'employee-paula'},{subject:'sub-alex',roles:['employee'],employeeId:'employee-alex'},{subject:'sub-jordan',roles:['employee'],employeeId:'employee-jordan'},{subject:'sub-greg',roles:['greg']},{subject:'sub-presenter',roles:['presenter']}]),GCSP_ENVIRONMENT_ID:'local-offer-link-proof',GCSP_RUN_ID:'run-1',GCSP_POLICY_VERSION:'gcsp-policy-v1+offer-journey-v1',GCSP_DATABASE_URL:DB_URL,GCSP_DATABASE_USER:PG.user,GCSP_EXPECTED_DATABASE:PG.db,GCSP_RESET_ALLOWED:'true',GCSP_ACCOUNT_PROVIDER:'repository',GCSP_SCENARIO_PROVIDER:'demo',GCSP_SUPPLY_PROVIDER:'demo',GCSP_ORDERING_PROVIDER:'synthetic',GCSP_APPROVALS_PROVIDER:'synthetic',GCSP_DOCUMENTS_PROVIDER:'synthetic',GCSP_APPOINTMENTS_PROVIDER:'synthetic',GCSP_RETURNS_PROVIDER:'synthetic',GCSP_ALLOCATION_CANDIDATES_PROVIDER:'recommendation',GCSP_VEHICLE_EVIDENCE_PROVIDER:'lookup',GCSP_VEHICLE_EVIDENCE_STORE:path.join(ROOT,'server/data/gcsp/vehicle-evidence/fleet-source.v1'),GCSP_VEHICLE_EVIDENCE_REFERENCE_DIR:path.join(ROOT,'server/data/gcsp/vehicle-evidence'),GCSP_VEHICLE_ASSETS_ROOT:ROOT,GCSP_PUBLIC_BASE_URL:ORIGINS.web};
  if (remote) Object.assign(apiEnv, { GCSP_BUDDY_PROVIDER: 'remote', GCSP_BUDDY_EXECUTE_URL: remote.origin + '/execute', GCSP_BUDDY_RECONCILE_URL: remote.origin + '/reconcile', GCSP_BUDDY_TIMEOUT: '2s' });
  if (remoteOrdering) Object.assign(apiEnv, { GCSP_ORDERING_PROVIDER: 'remote', GCSP_ORDERING_EXECUTE_URL: remoteOrdering.origin + '/execute', GCSP_ORDERING_RECONCILE_URL: remoteOrdering.origin + '/reconcile', GCSP_ORDERING_TIMEOUT: '2s' });
  receipt.apiComposition=Object.fromEntries(Object.entries(apiEnv).filter(([k])=>/^GCSP_(ACCOUNT|SCENARIO|SUPPLY|ORDERING|ALLOCATION|RUN_ID|POLICY)/.test(k)));
  let java;let starts=0;
  const startApi=async()=>{java=spawnLong(`api-${++starts}`,path.join(JAVA_HOME,'bin/java'),['-Xmx768m',`-Djavax.net.ssl.trustStore=${tls.trust}`,`-Djavax.net.ssl.trustStorePassword=${TRUST_PASS}`,`-Djava.io.tmpdir=${dirs.tmp}`,'-jar',path.join(ROOT,'services/gcsp-api/target/quarkus-app/quarkus-run.jar')],apiEnv);for(let i=0;i<100;i++){if(java.done){receipt.failureLogs.api=tail(path.join(dirs.logs,`api-${starts}.log`));throw new Error('API exited');}try{if((await request(ORIGINS.api,'GET','/q/health/ready',{ca:tls.ca})).status===200)return;}catch{}await sleep(300);}throw new Error('API readiness timeout');};
  const restartApi=async(policyVersion)=>{if(policyVersion)apiEnv.GCSP_POLICY_VERSION=policyVersion;killGroup(java);await Promise.race([java.exited,sleep(8000)]);if(!java.done)throw new Error('API did not stop');await startApi();receipt.ordinaryRestart={processStarts:starts,sameDatabase:true,sameRun:true};};
  await startApi(); const ctx={tls};const prepared=await prepareOffer(ctx);
  const profile=path.join(dirs.browser,'profile');mkdirSync(profile,{recursive:true});
  const chrome=spawnLong('chrome',CHROME,['--headless=new',`--user-data-dir=${profile}`,'--remote-debugging-port=0','--remote-allow-origins=*',`--ignore-certificate-errors-spki-list=${tls.spki}`,'--host-resolver-rules=MAP gcsp-web.example.test 127.0.0.1','--no-proxy-server','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--window-size=1000,720','about:blank'],baseEnv());
  let wsUrl;for(let i=0;i<80&&!wsUrl;i++){if(chrome.done)throw new Error('Chrome exited');try{const[port,p]=readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split('\n');wsUrl=`ws://127.0.0.1:${port}${p}`;}catch{await sleep(250);}}
  if(!wsUrl)throw new Error('Chrome endpoint unavailable');const cdp=await Cdp.connect(wsUrl);cleanups.push(()=>cdp.ws.close());
  if (ORDERING_PROOF) await orderingDecisionScenarios({ cdp, ctx, prepared, restartApi, remoteOrdering, scenario, newPage, closePage, signInAs, pageEvidence, direct, pg, database: PG.db, outcome: process.env.PROOF_ORDERING_CASE });
  else if (REMOTE_DECISION_PROOF) await remoteDecisionScenarios({ cdp, ctx, prepared, restartApi, remote, scenario, newPage, closePage, signInAs, pageEvidence, requireApi, direct, prepareOffer, pg, database: PG.db });
  else await browserScenarios(cdp,ctx,prepared,restartApi);
}
async function teardown(){for(const fn of cleanups.splice(0).reverse()){try{await fn();}catch(e){(receipt.cleanupErrors??=[]).push(e.message);}}if(SCRATCH!==OWNED_SCRATCH)throw new Error('Unexpected scratch ownership');rmSync(SCRATCH,{recursive:true,force:true});receipt.teardown={scratch:SCRATCH,scratchAbsent:!existsSync(SCRATCH),databaseStopped:receipt.database?.stopped??null,installedEnvironmentRetained:'apps/gcsp-web/node_modules; gitignored compiled app dist and Maven target'};}
function finish(error){if(finished)return;finished=true;receipt.endedAt=new Date().toISOString();receipt.screenshots=shots;if(error)receipt.runError=error;receipt.overall=!error&&!receipt.cleanupErrors&&(receipt.buildOnly||Object.keys(receipt.scenarios).length===(ORDERING_PROOF?1:REMOTE_DECISION_PROOF?(process.env.PROOF_REMOTE_CASE==='decline-refused'?1:2):DECISION_PROOF?(process.env.PROOF_ACCEPT_ONLY==='1'?1:process.env.PROOF_OWNER_ONLY==='1'?2:7):6)&&Object.values(receipt.scenarios).every(s=>s.pass))?'PASS':'FAIL';mkdirSync(EVIDENCE,{recursive:true});writeFileSync(path.join(EVIDENCE,'offer-link-proof.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({overall:receipt.overall,scenarios:Object.fromEntries(Object.entries(receipt.scenarios).map(([k,v])=>[k,{pass:v.pass,error:v.error}])),error,teardown:receipt.teardown}));}
const deadline=setTimeout(async()=>{await teardown();finish('600 second chunk deadline');process.exit(1);},DEADLINE_MS);
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,async()=>{await teardown();finish(`interrupted ${sig}`);process.exit(130);});
let error;try{await main();}catch(e){error=e.message;console.error(e.stack);}finally{clearTimeout(deadline);await teardown();finish(error);}process.exit(receipt.overall==='PASS'?0:1);

