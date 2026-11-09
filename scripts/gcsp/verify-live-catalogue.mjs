import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BMW_OTD_MEASUREMENT_MAPPING } from '../../server/vehicle-evidence/bmw-catalogue-adapter.js';
import { BMW_LIVE_CATALOGUE_OPERATION_POLICY, BMW_UCP_KEY_ENV, bmwCatalogueProviderSelection, createBmwCatalogueProvider,
  presentBmwLiveCatalogue } from '../../server/vehicle-evidence/bmw-live-catalogue.js';

// Opt-in, bounded, read-only smoke harness for the live catalogue provider (FUCQ-48). Nothing imports it; it sends
// no request unless main() is run with --live. Access comes only from backend env, never argv, files or logs.

export const VERIFY_LIVE_CATALOGUE_VERSION = 'fucq-48-verify.v1';
export const MAX_REQUEST_CAP = 8;
export const MAX_CONSECUTIVE_FAILURES = 3;
export const EVIDENCE_OFFLINE = 'offline-mock';
export const EVIDENCE_LIVE = 'live-demo-run-unsupported-route';
export const OVERSIZE_MARKER = 'response-too-large';

const HOST = 'prod.ucp.bmw.cloud';
const FAMILIES = ['matrix', 'solver', 'options', 'otd'];
const FORBIDDEN_PARTS = ['/garage', 'anonymous-configurations', 'configuration-state', 'marketing-texts', 'pricing'];
const IDENTITY_FIELDS = ['market', 'locale', 'catalogueDate', 'orderDate', 'effectDate', 'productionDate', 'taxDate',
  'modelCode', 'modelRange', 'rawModelRange', 'agModelCode', 'trim'];
const LIMITATIONS = Object.freeze([
  'Unsupported demo route that uses the public configurator website key.',
  'Not a BMW-supported API or a production entitlement.',
  'Covers only the requested identity.',
  'Says nothing about quotas, other models or catalogue reliability.',
]);
const SNAPSHOT_URL = new URL('../../server/vehicle-evidence/snapshots/bmw-gb-i5-2026-11-01.v1.json', import.meta.url);
const SAFE_TEXT = /^[A-Za-z0-9._ -]{1,40}$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The exact identity of the bundled dated snapshot, in the request shape the providers take. */
export function defaultVerificationTarget() {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_URL, 'utf8'));
  const { model } = snapshot;
  const day = model.prodDate;
  return {
    market: snapshot.market, locale: snapshot.locale, catalogueDate: model.orderDate, orderDate: model.orderDate,
    effectDate: model.effectDate, productionDate: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`, taxDate: model.taxDate,
    modelCode: model.modelCode, modelRange: model.modelRange, rawModelRange: model.rawModelRange, agModelCode: model.agModelCode,
    trim: snapshot.trim, selectedOptions: [...snapshot.selectedOptions].sort(),
    selectedAccessories: snapshot.selectedAccessories.map(({ code, type, quantity }) => ({ code, type, quantity })),
    selectionComplete: true,
  };
}

/** Throws a fixed error when text could carry a secret, a URL, markup or a token-shaped id. */
export function assertRedacted(text, secrets = []) {
  const value = typeof text === 'string' ? text : '';
  const lower = value.toLowerCase();
  const bad = secrets.some((secret) => typeof secret === 'string' && secret && value.includes(secret))
    || lower.includes('x-api-key') || lower.includes('http://') || lower.includes('https://') || value.includes('<') || UUID.test(value);
  if (bad) throw new Error('Redaction check failed.');
}

function validCap(cap) {
  if (!Number.isInteger(cap) || cap < 1 || cap > MAX_REQUEST_CAP) throw new TypeError(`requestCap must be an integer from 1 to ${MAX_REQUEST_CAP}`);
  return cap;
}

/** In-memory ledger: append(entry), count(), entries(). The CLI uses a file ledger with the same two methods. */
export function createMemoryLedger() {
  const items = [];
  return { append: (entry) => { items.push(structuredClone(entry)); }, count: () => items.length, entries: () => structuredClone(items) };
}

const headerOf = (headers, name) => {
  try {
    if (typeof headers?.get === 'function') return headers.get(name);
    for (const [key, value] of Object.entries(headers ?? {})) if (key.toLowerCase() === name) return value;
  } catch { /* treated as absent */ }
  return undefined;
};
const bodyText = (body) => {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) { try { return new TextDecoder().decode(body); } catch { return null; } }
  return null;
};

/**
 * Wraps the real transport. The provider emits a trace 'request' event just before each call; that event writes the ledger
 * entry first, and the guard refuses anything not preceded by one, over the cap, after a stop, or outside the read-only scope.
 */
export function createGuardedTransport({ transport, ledger, clock = () => new Date(), requestCap = MAX_REQUEST_CAP, secrets = [] } = {}) {
  if (typeof transport !== 'function') throw new TypeError('transport must be a function');
  if (!ledger || typeof ledger.append !== 'function' || typeof ledger.count !== 'function') throw new TypeError('ledger needs append and count');
  const cap = validCap(requestCap);
  const s = { forwarded: 0, seq: 0, pending: false, current: null, stop: null, failures: 0, ledgerFailures: 0, refusedCount: 0,
    refused: {}, hosts: new Set(), entries: [], bodies: new Map() };

  const write = (entry) => {
    try {
      assertRedacted(JSON.stringify(entry), secrets);
      const before = ledger.count();
      ledger.append(entry);
      if (ledger.count() !== before + 1) return false;
      s.entries.push(entry);
      s.seq += 1;
      return true;
    } catch { return false; }
  };
  const stamp = () => clock().toISOString();

  function trace(event) {
    if (event?.type !== 'request') return;
    s.pending = false;
    s.current = null;
    if (!FAMILIES.includes(event.family) || event.host !== HOST || !Number.isInteger(event.attempt)) { s.ledgerFailures += 1; return; }
    let ok = false;
    try { ok = write({ seq: s.seq + 1, at: stamp(), host: event.host, family: event.family, attempt: event.attempt }); } catch { /* counted below */ }
    if (ok) { s.pending = true; s.current = event.family; } else s.ledgerFailures += 1;
  }

  function refuse(code) {
    s.refused[code] = (s.refused[code] ?? 0) + 1;
    s.refusedCount += 1;
    s.pending = false;
    try { write({ seq: s.seq + 1, at: stamp(), refused: code }); } catch { /* the refusal itself still stands */ }
    throw new Error(`Request refused: ${code}`);
  }

  const stopWith = (reason) => { if (!s.stop) s.stop = reason; };
  function noteFailure() {
    s.failures += 1;
    if (s.failures >= MAX_CONSECUTIVE_FAILURES) stopWith('consecutive-failures');
  }

  function observe(response, family) {
    const status = response?.status;
    const text = bodyText(response?.body);
    const oversize = text === OVERSIZE_MARKER;
    let parseable = false;
    if (text !== null && !oversize) { try { JSON.parse(text); parseable = true; } catch { /* not JSON */ } }
    const type = headerOf(response?.headers, 'content-type');
    const challenge = (status === 200 && !oversize && (!parseable || text.trimStart().startsWith('<')
      || (typeof type === 'string' && type !== '' && !/json/i.test(type)))) || /captcha|challenge/i.test(text ?? '');
    if (status === 401 || status === 403) stopWith('auth-refused');
    else if (status === 429) stopWith('rate-limited');
    else if (challenge) stopWith('challenge');
    if (status === 200 && parseable && !challenge && response.redirected !== true) {
      s.failures = 0;
      s.bodies.set(family, text);
    } else noteFailure();
  }

  async function guarded(call) {
    if (!s.pending) refuse('ledger-not-written');
    if (s.stop) refuse('stopped');
    if (s.forwarded >= cap) refuse('cap-reached');
    if (call?.method !== 'GET' || call.body !== undefined) refuse('method-not-get');
    let url = null;
    try { url = new URL(call.url); } catch { /* refused below */ }
    if (!url || url.protocol !== 'https:' || url.host !== HOST) refuse('host-not-allowed');
    let decoded = call.url;
    try { decoded = decodeURI(call.url); } catch { /* raw form only */ }
    const haystack = `${call.url}\n${decoded}`.toLowerCase();
    if (FORBIDDEN_PARTS.some((part) => haystack.includes(part))) refuse('forbidden-path');
    const family = s.current;
    s.pending = false;
    s.forwarded += 1;
    s.hosts.add(url.host);
    let response;
    try { response = await transport(call); } catch (error) { noteFailure(); throw error; }
    observe(response, family);
    return response;
  }

  return {
    transport: guarded, trace,
    body: (family) => s.bodies.get(family) ?? null,
    summary: () => ({ forwarded: s.forwarded, refusedCount: s.refusedCount, refusedReasons: { ...s.refused }, stopReason: s.stop,
      hosts: [...s.hosts].sort(), ledgerEntries: s.entries.length, ledgerFailures: s.ledgerFailures, entries: structuredClone(s.entries) }),
  };
}

const shown = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return SAFE_TEXT.test(value) ? value : 'unrecognised';
  if (Array.isArray(value)) return `${value.length} items`;
  return 'unrecognised';
};
const sortedJson = (list) => JSON.stringify(Array.isArray(list) ? [...list].sort() : null);
const accessoryJson = (list) => JSON.stringify(Array.isArray(list)
  ? list.map(({ code, type, quantity }) => ({ code, type, quantity })).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)) : null);

function sourceValueOf(text, reference) {
  if (typeof text !== 'string') return null;
  let body;
  try { body = JSON.parse(text); } catch { return null; }
  const values = Array.isArray(body?.values) ? body.values : body?.values && typeof body.values === 'object' ? Object.values(body.values) : [];
  const hits = values.filter((item) => item?.referenceName === reference);
  if (hits.length !== 1) return null;
  const value = hits[0].targetValue;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function technicalValues(result, otdText) {
  return Object.entries(BMW_OTD_MEASUREMENT_MAPPING).map(([fact, [code, , unit]]) => {
    const entry = result?.facts?.[fact];
    const known = entry?.state === 'known' && typeof entry.value === 'number' && Number.isFinite(entry.value);
    const sourceValue = sourceValueOf(otdText, code);
    return { fact, code, unit, normalised: { state: known ? 'known' : 'unknown', value: known ? entry.value : null }, sourceValue,
      match: known && sourceValue !== null && entry.value === sourceValue };
  });
}

function presentation(result, clock) {
  try {
    const view = presentBmwLiveCatalogue(result, { now: clock() });
    const text = (value) => (typeof value === 'string' ? value : null);
    return { label: text(view.label), source: text(view.source), requested: text(view.identities?.requested),
      resolved: text(view.identities?.resolved), failureMessage: text(view.failure?.message), snapshotChoice: text(view.snapshotChoice) };
  } catch { return null; }
}

function unknownExample(result) {
  for (const [name, fact] of Object.entries(result?.facts ?? {})) {
    if (fact?.state === 'unknown') return { name, state: 'unknown', reason: /^[a-z-]{1,40}$/.test(fact.reason) ? fact.reason : null };
  }
  return null;
}

function baseReport({ evidenceClass, credential, cap, policyVersion }) {
  return { harnessVersion: VERIFY_LIVE_CATALOGUE_VERSION, evidenceClass, satisfiesLivePositive: false, credential, policyVersion, cap,
    limitations: [...LIMITATIONS] };
}

/** Resolves one request through the real provider path with a guarded, ledgered transport and returns a redacted report. */
export async function runVerification({ env = process.env, transport, request = defaultVerificationTarget(), clock = () => new Date(), sleep,
  ledger, requestCap = MAX_REQUEST_CAP, evidenceClass } = {}) {
  if (![EVIDENCE_OFFLINE, EVIDENCE_LIVE].includes(evidenceClass)) throw new TypeError('evidenceClass must be a supported value');
  const cap = validCap(requestCap);
  if (!ledger || typeof ledger.append !== 'function' || typeof ledger.count !== 'function') throw new TypeError('ledger needs append and count');
  const key = env?.[BMW_UCP_KEY_ENV];
  const secrets = typeof key === 'string' && key ? [key] : [];
  const head = baseReport({ evidenceClass, credential: secrets.length ? 'present' : 'absent', cap, policyVersion: BMW_LIVE_CATALOGUE_OPERATION_POLICY.version });

  const notRun = (reason) => {
    const report = { ...head, outcome: 'not-run', reason, verdict: 'not-run', requestCount: 0, refusedRequests: { count: 0, reasons: {} },
      hostsContacted: [], ledgerEntries: 0 };
    assertRedacted(JSON.stringify(report), secrets);
    return report;
  };
  if (bmwCatalogueProviderSelection(env) !== 'live') return notRun('source-not-selected');
  if (!secrets.length) return notRun('credentials-unavailable');
  if (typeof transport !== 'function') throw new TypeError('transport must be a function');

  const guard = createGuardedTransport({ transport, ledger, clock, requestCap: cap, secrets });
  const provider = createBmwCatalogueProvider({ env, transport: guard.transport, clock, sleep, trace: guard.trace });
  const result = await provider.resolve(request);
  const sum = guard.summary();

  const requested = result.requestedIdentity;
  const resolved = result.resolvedIdentity;
  const identity = requested ? IDENTITY_FIELDS.map((field) => ({ field, requested: shown(requested[field]), resolved: resolved ? shown(resolved[field]) : null,
    match: Boolean(resolved) && requested[field] === resolved[field] })) : [];
  const optionsEqual = Boolean(requested && resolved) && sortedJson(requested.selectedOptions) === sortedJson(resolved.selectedOptions);
  const accessoriesEqual = Boolean(requested && resolved) && accessoryJson(requested.selectedAccessories) === accessoryJson(resolved.selectedAccessories);
  const technical = technicalValues(result, guard.body('otd'));
  const known = technical.filter(({ normalised }) => normalised.state === 'known');
  const usable = ['ok', 'partial'].includes(result.status);
  const live = result.sourceKind === 'live';
  const differences = (Array.isArray(result.resolution?.differences) ? result.resolution.differences : [])
    .map(({ field, requested: was, resolved: now }) => ({ field: shown(field), requested: shown(was), resolved: shown(now) }));

  const reasons = [];
  if (!live || !usable) reasons.push('status-not-usable');
  if (result.resolution?.exact !== true) reasons.push('not-exact');
  if (result.resolution?.constructible !== true) reasons.push('not-constructible');
  if (!optionsEqual) reasons.push('options-differ');
  if (!accessoriesEqual) reasons.push('accessories-differ');
  if (!known.length) reasons.push('no-known-measurement');
  if (known.some(({ match }) => !match)) reasons.push('measurement-mismatch');
  if (sum.refusedCount) reasons.push('request-refused');
  if (sum.ledgerFailures || sum.ledgerEntries < sum.forwarded) reasons.push('ledger-incomplete');
  const choice = result.snapshotChoice;
  if (choice && choice.automatic !== false) reasons.push('snapshot-choice-automatic');

  let verdict = 'fail';
  if (sum.stopReason) verdict = 'stopped';
  else if (result.status === 'identity-mismatch') verdict = 'identity-mismatch';
  else if (result.status === 'source-unavailable') verdict = 'source-unavailable';
  else if (!reasons.length) verdict = 'pass';
  if (verdict === 'fail' && result.failure?.code) reasons.push(`failure-${String(result.failure.code).replace(/[^a-z-]/g, '')}`);

  const report = { ...head, outcome: 'completed', verdict, satisfiesLivePositive: evidenceClass === EVIDENCE_LIVE && verdict === 'pass',
    reasons: verdict === 'pass' ? [] : reasons, stopReason: sum.stopReason, status: shown(result.status),
    failureCode: result.failure?.code ? shown(result.failure.code) : null,
    provider: shown(result.provider), providerVersion: shown(result.providerVersion), sourceVersion: shown(result.sourceVersion),
    sourceRoute: shown(result.sourceRoute), retrievedDate: shown(result.retrievedDate),
    hostsContacted: sum.hosts, requestCount: sum.forwarded, refusedRequests: { count: sum.refusedCount, reasons: sum.refusedReasons },
    ledgerEntries: sum.ledgerEntries,
    comparisons: { identity, options: { complete: optionsEqual, requested: requested?.selectedOptions?.length ?? null, resolved: resolved?.selectedOptions?.length ?? null },
      accessories: { equal: accessoriesEqual, requested: requested?.selectedAccessories?.length ?? null, resolved: resolved?.selectedAccessories?.length ?? null },
      constructible: result.resolution?.constructible === true, exact: result.resolution?.exact === true, technical },
    differences: verdict === 'identity-mismatch' ? differences : [],
    snapshotChoice: choice ? { kind: shown(choice.kind), provider: shown(choice.provider), snapshotVersion: shown(choice.snapshotVersion),
      observedDate: shown(choice.observedDate), label: typeof choice.label === 'string' ? choice.label : null, automatic: choice.automatic === false ? false : true } : null,
    presentation: presentation(result, clock), unknownFactExample: unknownExample(result) };
  for (const entry of sum.entries) assertRedacted(JSON.stringify(entry), secrets);
  assertRedacted(JSON.stringify(report), secrets);
  return report;
}

/** The real transport, used only by main --live. Logs nothing; a redirect rejects (redirect: 'error'). */
export async function fetchTransport(call) {
  const response = await globalThis.fetch(call.url, { method: call.method, headers: call.headers, signal: call.signal,
    redirect: 'error', cache: 'no-store', credentials: 'omit' });
  const max = Number.isInteger(call.maxResponseBytes) && call.maxResponseBytes > 0 ? call.maxResponseBytes : 4194304;
  let body = '';
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) { try { await reader.cancel(); } catch { /* already closed */ } body = OVERSIZE_MARKER; break; }
      body += decoder.decode(value, { stream: true });
    }
    if (body !== OVERSIZE_MARKER) body += decoder.decode();
  } else {
    const text = await response.text();
    body = Buffer.byteLength(text) > max ? OVERSIZE_MARKER : text;
  }
  return { status: response.status, headers: response.headers, body, redirected: response.redirected === true || (response.status >= 300 && response.status < 400) };
}

const USAGE = 'Usage: node scripts/gcsp/verify-live-catalogue.mjs [--target <request.json>] [--max-requests <1-8>] [--live --out <dir>]\n'
  + 'Access comes only from the backend environment, never from arguments.\n';

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const parsed = { live: false, target: null, out: null, max: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (typeof arg !== 'string' || /key|token|=/i.test(arg)) return null;
    if (arg === '--live') { if (parsed.live) return null; parsed.live = true; continue; }
    const field = { '--target': 'target', '--out': 'out', '--max-requests': 'max' }[arg];
    const value = args[index + 1];
    if (!field || parsed[field] !== null || typeof value !== 'string' || value === '' || value.startsWith('-')) return null;
    parsed[field] = value;
    index += 1;
  }
  if (parsed.max !== null) {
    if (!/^\d{1,2}$/.test(parsed.max)) return null;
    const cap = Number(parsed.max);
    if (cap < 1 || cap > MAX_REQUEST_CAP) return null;
    parsed.max = cap;
  }
  if (parsed.live && !parsed.out) return null;
  return parsed;
}

function planText(request, selection, credential, cap) {
  const t = (value) => shown(value) ?? 'unknown';
  const r = request && typeof request === 'object' ? request : {};
  return [`Live catalogue verification plan (${VERIFY_LIVE_CATALOGUE_VERSION})`,
    `Target: ${t(r.modelCode)} (${t(r.modelRange)} / ${t(r.rawModelRange)}, AG ${t(r.agModelCode)}), ${t(r.market)} ${t(r.locale)}, trim ${t(r.trim)}, `
    + `catalogue ${t(r.catalogueDate)}, order ${t(r.orderDate)}, effect ${t(r.effectDate)}, production ${t(r.productionDate)}, tax ${t(r.taxDate)}, `
    + `${Array.isArray(r.selectedOptions) ? r.selectedOptions.length : 'unknown'} options, ${Array.isArray(r.selectedAccessories) ? r.selectedAccessories.length : 'unknown'} accessories`,
    `Provider selection: ${selection}`, `Credential: ${credential}`, `Request cap: ${cap}`,
    `Reads (GET only): ${FAMILIES.join(', ')} on ${HOST}`,
    'No request sent. Pass --live after the runbook preconditions are recorded.', ''].join('\n');
}

function fileLedger(file) {
  const fd = fs.openSync(file, 'wx', 0o600); // a fresh ledger per run; reuse is refused
  fs.chmodSync(file, 0o600);
  let lines = 0;
  return { append: (entry) => { fs.appendFileSync(fd, `${JSON.stringify(entry)}\n`); lines += 1; }, count: () => lines,
    close: () => fs.closeSync(fd) };
}

/** CLI entry. Returns the exit code: 0 pass, 1 not pass, 2 usage, 3 preconditions missing (no request was sent). */
export async function main(argv, deps = {}) {
  const { env = process.env, stdout = process.stdout, stderr = process.stderr, clock = () => new Date(),
    transportFactory = () => fetchTransport } = deps;
  const out = (text) => { stdout.write(text); };
  const err = (text) => { stderr.write(text); };
  const parsed = parseArgs(argv);
  if (!parsed) { err(USAGE); return 2; }
  let request;
  try { request = parsed.target ? JSON.parse(fs.readFileSync(parsed.target, 'utf8')) : defaultVerificationTarget(); } catch {
    err('The target file could not be read.\n'); return 2;
  }
  const cap = parsed.max ?? MAX_REQUEST_CAP;
  const selection = bmwCatalogueProviderSelection(env);
  const key = env?.[BMW_UCP_KEY_ENV];
  const credential = typeof key === 'string' && key ? 'present' : 'absent';
  if (!parsed.live) { out(planText(request, selection, credential, cap)); return 0; }
  if (selection !== 'live' || credential !== 'present') {
    err('Live verification needs the live provider selected and the credential present in the backend environment. No request sent.\n');
    return 3;
  }
  let ledger = null;
  try {
    const dir = path.resolve(parsed.out);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    ledger = fileLedger(path.join(dir, 'ledger.jsonl'));
    const report = await runVerification({ env, transport: transportFactory(), request, clock, ledger, requestCap: cap, evidenceClass: EVIDENCE_LIVE });
    const file = path.join(dir, 'report.json');
    fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    out(`Verdict: ${report.verdict}. Requests sent: ${report.requestCount} of ${report.cap}. Stop: ${report.stopReason ?? 'none'}. `
      + `Hosts: ${report.hostsContacted.join(', ') || 'none'}. Report: ${path.join(dir, 'report.json')}\n`);
    return report.verdict === 'pass' ? 0 : 1;
  } catch {
    err('Verification did not complete. Check the output directory for the ledger.\n');
    return 1;
  } finally {
    try { ledger?.close(); } catch { /* already closed */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
