import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { hostname } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { inputDigest } from '../../server/gcsp/repository/core.js';
import { CollectionError, requireValue } from './configuration-key.mjs';
import { BMW_BATCH_SOURCE_VERSION, BMW_MODEL_BATCH_SOURCE_VERSION, BMW_CONTEXT_SOURCE_VERSION, BMW_OPTIONS_SOURCE_VERSION, BMW_MODEL_OPTIONS_SOURCE_VERSION, BMW_INVENTORY_SOURCE_VERSION,
  bmwPublicRequestUrls, bmwModelBatchRequestUrls, validateBmwModelBatchRequestRegistration, bmwModelOptionsRequestUrls, validateBmwModelOptionsRequestRegistration, bmwInventoryRequestUrls, validateBmwInventoryRequestRegistration,
  validateBmwBatchRequestRegistration, validateBmwContextRequestRegistration, validateBmwOptionsRequestRegistration } from './bmw-public-registration.mjs';

export const COLLECTION_SESSION_VERSION = '2';
// Only existing readHttp closures register objects; callers cannot attest copied metadata.
// Injected same-process fetch remains a trusted port: membership is not network proof.
const executorObservations = new WeakSet();
export function assertCollectionHttpObservation(metadata) {
  requireValue(metadata !== null && typeof metadata === 'object' && executorObservations.has(metadata),
    'source-observation-metadata', 'Use the existing executor-owned HTTP observation.');
}

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => inputDigest(a) === inputDigest(b);
const bounded = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const version = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9.-]{0,95}$/.test(value);
const freshCounts = (names) => ({ sourceCalls: 0, operations: Object.fromEntries(names.map((n) => [n, 0])),
  cacheHits: Object.fromEntries(names.map((n) => [n, 0])), failures: 0, timeouts: 0, substitutions: 0, cacheEvictions: 0,
  httpAttempts: 0, decodedBytes: 0, operationBytes: Object.fromEntries(names.map((n) => [n, 0])) });

const PUBLIC_SOURCE_VERSION = 'f58-20261105.v1';
const DIAGNOSTIC_SOURCE_VERSION = 'f59-diagnostic-20261106.v1';
const PUBLIC_PAGE = 'https://configure.bmw.co.uk/en_GB/configure/G61E/T5MJ';
const TREE_PATH = '/model-matrices/vehicle-trees/connext-bmw/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/2026-11-01/order-dates/2026-11-01';
const SOLVER_PATH = '/rulesolver/constructibility-check/rule-sets/pcaso,con/brands/bmwCar/countries/gb/effect-dates/2027-01-05/order-dates/2026-11-01/models/T5MJ';
const OPTIONS_PATH = '/localisations/overridden-vehicle-data/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/2027-01-05/order-dates/2026-11-01/applications/connext/models/T5MJ/options/languages/en';
const CAPABILITIES = ['bmw-page', 'bmw-settings', 'bmw-model-tree', 'bmw-solver'];
const DIAGNOSTIC_CAPABILITIES = ['bmw-page', 'bmw-settings', 'bmw-model-tree', 'bmw-options'];
function readOnlyRequest(capability, request, registration) {
  let url;
  try { url = new URL(request?.url); } catch { /* refused below */ }
  const query = url && Object.fromEntries(url.searchParams);
  const exactQuery = (expected) => url.searchParams.size === Object.keys(expected).length && same(query, expected);
  const batchAllowed = () => {
    if (registration.schemaVersion === 'bmw-public-range-inventory-registration.v1') {
      const urls = bmwInventoryRequestUrls(registration);
      return capability === 'bmw-page' ? url.href === urls.page
        : capability === 'bmw-model-tree' ? url.href === urls.discover
          : capability === 'bmw-settings' && url.origin === 'https://configure.bmw.co.uk'
            && /^\/en_GB\/settings\.[a-zA-Z0-9]+\.json$/.test(url.pathname) && !url.search;
    }
    const urls = Object.hasOwn(registration, 'line') ? bmwModelOptionsRequestUrls({ model: registration.model, line: registration.line }) : bmwPublicRequestUrls(registration.model);
    return capability === 'bmw-page' ? url.href === urls.page
      : capability === 'bmw-model-tree' ? url.href === urls.discover
        : capability === 'bmw-options' ? (Object.hasOwn(registration, 'line') || Array.isArray(registration.candidates) || Object.hasOwn(registration.model, 'optionsTrim')) && url.href === urls.options
          : capability === 'bmw-settings' ? url.origin === 'https://configure.bmw.co.uk'
            && /^\/en_GB\/settings\.[a-zA-Z0-9]+\.json$/.test(url.pathname) && !url.search
            : capability === 'bmw-solver' && Array.isArray(registration.candidates)
              && registration.candidates.some((row) => url.href === (Object.hasOwn(registration, 'line') ? bmwModelBatchRequestUrls(registration, row) : bmwPublicRequestUrls(registration.model, row)).solve);
  };
  const allowed = url && url.protocol === 'https:' && !url.username && !url.password && !url.hash
    && (registration ? batchAllowed() : capability === 'bmw-page' ? url.href === PUBLIC_PAGE
      : capability === 'bmw-settings' ? url.origin === 'https://configure.bmw.co.uk'
        && /^\/en_GB\/settings\.[a-zA-Z0-9]+\.json$/.test(url.pathname) && !url.search
        : url.origin === 'https://prod.ucp.bmw.cloud' && (capability === 'bmw-model-tree'
          ? url.pathname === TREE_PATH && exactQuery({ 'gfs-policy': 'none', cluster: 'default', 'model-ranges': 'G61E', 'future-models': 'true', 'closest-fallback': 'true' })
          : capability === 'bmw-options' ? url.pathname === OPTIONS_PATH && exactQuery({ trim: 'S0337' })
          : capability === 'bmw-solver' && url.pathname === SOLVER_PATH && exactQuery({
            'add-rules-for-mandatory-element-classes': 'fabric,paint,rim', application: 'connext',
            'included-elements': 'FKSFU,P0300,S0337,S043L', 'mandatory-elements': 'S0337' })));
  requireValue(allowed && request.method === 'GET' && Object.keys(request).every((key) => ['method', 'url', 'headers'].includes(key))
    && object(request.headers) && Object.entries(request.headers).every(([key, value]) => ['bmw-model-tree', 'bmw-solver', 'bmw-options'].includes(capability) && key === 'x-api-key'
      && typeof value === 'string' && value.length > 0 && value.length <= 4096),
  'source-endpoint-refused', 'Only the pinned qualified public GET route/query and ephemeral application header are permitted.');
  return Object.freeze({ method: request.method, url: url.href, headers: Object.freeze({ ...request.headers }) });
}

// JSON.parse has checked grammar. Inspect decoded keys before accepting its last-value semantics.
function duplicateJsonKeys(text) {
  const stack = [];
  for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\],]/gu)) {
    const value = token[0]; const top = stack.at(-1);
    if (value === '{') stack.push({ keys: new Set(), expectingKey: true });
    else if (value === '[') stack.push({});
    else if (value === '}' || value === ']') stack.pop();
    else if (value === ',' && top?.keys) top.expectingKey = true;
    else if (value.startsWith('"') && top?.keys && top.expectingKey) {
      const key = JSON.parse(value);
      if (top.keys.has(key)) return true;
      top.keys.add(key); top.expectingKey = false;
    }
  }
  return false;
}

export async function readCollectionJson(path, bytes, code) {
  const file = await open(path, 'r');
  try {
    requireValue((await file.stat()).size <= bytes, code, 'The checkpoint/input exceeds its configured byte budget.');
    const buffer = Buffer.alloc(bytes + 1); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    requireValue(bytesRead <= bytes, code, 'The checkpoint/input exceeds its configured byte budget.');
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
  } finally { await file.close(); }
}
async function syncDirectory(path) {
  const directory = await open(path, 'r'); try { await directory.sync(); } finally { await directory.close(); }
}
async function writeAtomic(path, content, bytes, phase, kind, staging) {
  const encoded = JSON.stringify({ schemaVersion: '1', content, contentDigest: inputDigest(content) }) + '\n';
  requireValue(Buffer.byteLength(encoded) <= bytes, 'checkpoint-budget', 'The checkpoint exceeds its finite byte budget.');
  try {
    const file = await open(staging, 'wx', 0o600);
    try { await file.writeFile(encoded); await file.sync(); } finally { await file.close(); }
    await phase('before-rename', { kind }); await rename(staging, path); await syncDirectory(dirname(path));
  } finally { await rm(staging, { force: true }); }
}

async function checkpointLock(path) {
  // Same nonblocking bakery approach as F54: unique participants avoid the stale shared-lock ABA race.
  const token = randomUUID(); const prefix = `${basename(path)}.writer-`;
  const marker = join(dirname(path), `${prefix}${process.pid}-${token}.json`);
  const staging = `${path}.writing-${process.pid}-${token}`; let kept = false;
  const release = async () => { await rm(marker, { force: true }); await syncDirectory(dirname(path)); };
  const writeMarker = async (choosing, ticket, exclusive = false) => {
    const file = await open(marker, exclusive ? 'wx' : 'w', 0o600);
    try { await file.writeFile(JSON.stringify({ schemaVersion: '1', pid: process.pid, host: hostname(), token, choosing, ticket })); await file.sync(); }
    finally { await file.close(); }
  };
  const contenders = async () => {
    const rows = [];
    for (const name of await readdir(dirname(path))) {
      if (!name.startsWith(prefix)) continue;
      const match = /^([1-9][0-9]*)-([0-9a-f-]{36})\.json$/.exec(name.slice(prefix.length));
      requireValue(match, 'checkpoint-busy', 'An unknown checkpoint writer marker needs diagnosis.');
      const candidate = join(dirname(path), name); const pid = Number(match[1]); let row;
      try { row = await readCollectionJson(candidate, 1024, 'checkpoint-busy'); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      requireValue(row?.schemaVersion === '1' && row.pid === pid && row.token === match[2] && row.host === hostname()
        && (row.choosing === true && row.ticket === null || row.choosing === false && bounded(row.ticket, 1, Number.MAX_SAFE_INTEGER)),
      'checkpoint-busy', 'Unknown checkpoint writer ownership is preserved.');
      let alive = true;
      try { process.kill(pid, 0); } catch (probe) { if (probe.code === 'ESRCH') alive = false; }
      if (!alive) {
        // Both paths were reserved by this exact recorded participant, not discovered by a broad wildcard.
        await rm(`${path}.writing-${pid}-${row.token}`, { force: true }); await rm(candidate, { force: true }); continue;
      }
      rows.push(row);
    }
    return rows;
  };
  try {
    await writeMarker(true, null, true);
    const initial = await contenders();
    requireValue(!initial.some((row) => row.token !== token && row.choosing), 'checkpoint-busy', 'Another checkpoint writer is choosing.');
    const ticket = Math.max(0, ...initial.map((row) => row.ticket || 0)) + 1;
    requireValue(Number.isSafeInteger(ticket), 'checkpoint-busy', 'Checkpoint ticket range exhausted.');
    await writeMarker(false, ticket);
    requireValue(!(await contenders()).some((row) => row.token !== token && (row.choosing || row.ticket < ticket || row.ticket === ticket && row.token < token)),
      'checkpoint-busy', 'The checkpoint already has an active writer.');
    kept = true; return { release, staging };
  } finally { if (!kept) await release(); }
}

/** One injected offline executor for collection and enrichment stages. No provider is installed here. */
export async function createCollectionSession({ identity: stageIdentity, operations, limits, statePath, http,
  initialState = {}, validateState = () => {}, now = Date.now, onPhase = async () => {} } = {}) {
  const names = Object.keys(operations || {}).sort();
  requireValue(object(stageIdentity) && object(initialState) && names.length > 0 && names.length <= 16
    && names.every((name) => /^[a-z][a-z0-9-]{0,31}$/.test(name) && object(operations[name])
      && version(operations[name].sourceId) && version(operations[name].sourceVersion)
      && (operations[name].kind === 'offline' && typeof operations[name].execute === 'function'
        || operations[name].kind === 'read-only-http'
          && (operations[name].sourceVersion === PUBLIC_SOURCE_VERSION && CAPABILITIES.includes(operations[name].capability)
            || operations[name].sourceVersion === DIAGNOSTIC_SOURCE_VERSION && DIAGNOSTIC_CAPABILITIES.includes(operations[name].capability)
            || operations[name].sourceVersion === BMW_BATCH_SOURCE_VERSION && [...CAPABILITIES, 'bmw-options'].includes(operations[name].capability)
              && validateBmwBatchRequestRegistration(operations[name].requestRegistration)
            || operations[name].sourceVersion === BMW_MODEL_BATCH_SOURCE_VERSION && [...CAPABILITIES, 'bmw-options'].includes(operations[name].capability)
              && validateBmwModelBatchRequestRegistration(operations[name].requestRegistration)
            || operations[name].sourceVersion === BMW_CONTEXT_SOURCE_VERSION && ['bmw-page', 'bmw-settings', 'bmw-model-tree'].includes(operations[name].capability)
              && validateBmwContextRequestRegistration(operations[name].requestRegistration)
            || operations[name].sourceVersion === BMW_OPTIONS_SOURCE_VERSION && DIAGNOSTIC_CAPABILITIES.includes(operations[name].capability)
              && validateBmwOptionsRequestRegistration(operations[name].requestRegistration)
            || operations[name].sourceVersion === BMW_MODEL_OPTIONS_SOURCE_VERSION && DIAGNOSTIC_CAPABILITIES.includes(operations[name].capability)
              && validateBmwModelOptionsRequestRegistration(operations[name].requestRegistration)
            || operations[name].sourceVersion === BMW_INVENTORY_SOURCE_VERSION && ['bmw-page', 'bmw-settings', 'bmw-model-tree'].includes(operations[name].capability)
              && validateBmwInventoryRequestRegistration(operations[name].requestRegistration))
          && typeof operations[name].prepare === 'function'
          && typeof operations[name].project === 'function'))
    && object(limits) && object(limits.requestBudgets)
    && same(Object.keys(limits.requestBudgets).sort(), names)
    && names.every((name) => bounded(limits.requestBudgets[name], 0, 100000))
    && bounded(limits.maxAttempts, 1, 5) && bounded(limits.operationTimeoutMs, 1, 300000)
    && bounded(limits.deadlineMs, 1, 3600000) && bounded(limits.retryDelayMs, 0, 60000)
    && limits.concurrency === 1 && limits.imageRequests === 0
    && bounded(limits.cacheEntries, 1, 10000) && bounded(limits.cacheRetentionMs, 1, 7 * 86400000)
    && bounded(limits.checkpointBytes, 1024, 16 * 1024 * 1024)
    && !Object.keys(initialState).some((field) => ['identity', 'counts', 'cache', 'attempts', 'halted', 'stages', 'deadlineAt'].includes(field)),
  'invalid-session', 'Inject named offline operations with explicit finite budgets and a separate stage/input identity.');
  const hasHttp = names.some((name) => operations[name].kind === 'read-only-http');
  const httpVersions = [...new Set(names.filter((name) => operations[name].kind === 'read-only-http').map((name) => operations[name].sourceVersion))];
  requireValue(!hasHttp || object(http) && ['fixture', 'live'].includes(http.kind) && typeof http.fetch === 'function'
    && httpVersions.length === 1
    && bounded(limits.sourceAttempts, 1, 3000) && bounded(limits.sourceBytes, 1, 64 * 1024 * 1024)
    && bounded(limits.responseBytes, 1, 2 * 1024 * 1024)
    && (http.kind !== 'live' || object(http.allocation) && version(http.allocation.id)
      && http.allocation.sourceVersion === httpVersions[0] && http.allocation.planDigest === stageIdentity.planDigest
      && limits.sourceAttempts <= http.allocation.attempts && limits.sourceBytes <= http.allocation.bytes
      && bounded(http.allocation.attempts, 1, 3000) && bounded(http.allocation.bytes, 1, 64 * 1024 * 1024)
      && limits.maxAttempts === 1), 'source-allocation-required', 'Public HTTP execution requires an explicit transport, finite combined attempt/byte limits and a pinned live allocation.');
  requireValue(typeof statePath === 'string' && isAbsolute(statePath), 'explicit-path-required', 'Supply an absolute owned checkpoint path.');
  const sources = Object.fromEntries(names.map((name) => [name, { sourceId: operations[name].sourceId,
    sourceVersion: operations[name].sourceVersion, kind: operations[name].kind,
    ...(operations[name].kind === 'read-only-http' ? { capability: operations[name].capability, cache: operations[name].cache !== false,
      ...(operations[name].sourceVersion === BMW_BATCH_SOURCE_VERSION ? { requestRegistration: validateBmwBatchRequestRegistration(operations[name].requestRegistration) } : {}),
      ...(operations[name].sourceVersion === BMW_MODEL_BATCH_SOURCE_VERSION ? { requestRegistration: validateBmwModelBatchRequestRegistration(operations[name].requestRegistration) } : {}),
      ...(operations[name].sourceVersion === BMW_CONTEXT_SOURCE_VERSION ? { requestRegistration: validateBmwContextRequestRegistration(operations[name].requestRegistration) } : {}),
      ...(operations[name].sourceVersion === BMW_OPTIONS_SOURCE_VERSION ? { requestRegistration: validateBmwOptionsRequestRegistration(operations[name].requestRegistration) } : {}),
      ...(operations[name].sourceVersion === BMW_MODEL_OPTIONS_SOURCE_VERSION ? { requestRegistration: validateBmwModelOptionsRequestRegistration(operations[name].requestRegistration) } : {}),
      ...(operations[name].sourceVersion === BMW_INVENTORY_SOURCE_VERSION ? { requestRegistration: validateBmwInventoryRequestRegistration(operations[name].requestRegistration) } : {}),
      ...(operations[name].strictJson === true ? { strictJson: true } : {}) } : {}) }]));
  const identity = { toolVersion: COLLECTION_SESSION_VERSION, stage: structuredClone(stageIdentity), sources,
    limitsDigest: inputDigest(limits), transport: hasHttp ? { kind: http.kind, allocation: http.allocation || null } : null };
  const observationSources = structuredClone(sources); const transportKind = identity.transport?.kind;
  inputDigest(initialState);
  let running = false;
  return { async withCheckpoint(callback, { stage, initialState: stageInitialState = {} } = {}) {
    requireValue(stage === undefined || object(stage) && version(stage.id) && version(stage.version)
      && typeof stage.inputDigest === 'string' && /^[a-f0-9]{64}$/.test(stage.inputDigest) && object(stageInitialState),
    'invalid-stage', 'A stage has its own ID, version, input digest and optional data, separate from run identity.');
    requireValue(!running, 'checkpoint-busy', 'This session already owns an active checkpoint.'); running = true;
    let ownership; let state; let inFlight = null; let activeController; let persist;
    try {
      await mkdir(dirname(statePath), { recursive: true }); ownership = await checkpointLock(statePath);
      let envelope;
      try { envelope = await readCollectionJson(statePath, limits.checkpointBytes, 'checkpoint-corrupt'); }
      catch (error) {
        if (error.code !== 'ENOENT') throw new CollectionError('checkpoint-corrupt', 'The complete checkpoint failed integrity validation; preserve it for diagnosis.');
      }
      if (envelope !== undefined) {
        requireValue(envelope?.schemaVersion === '1' && object(envelope.content) && inputDigest(envelope.content) === envelope.contentDigest,
          'checkpoint-corrupt', 'Checkpoint integrity failed.');
        state = envelope.content;
        requireValue(same(state.identity, identity), 'checkpoint-incompatible', 'Stage/input, source, plan, tool or policy version changed; use a separate explicit checkpoint.');
        requireValue(Array.isArray(state.cache) && state.cache.length <= limits.cacheEntries && object(state.counts) && object(state.stages)
          && object(state.attempts) && Object.entries(state.attempts).every(([key, count]) => /^[a-f0-9]{64}$/.test(key) && bounded(count, 1, limits.maxAttempts))
          && names.every((name) => bounded(state.counts.operations?.[name], 0, limits.requestBudgets[name])
            && bounded(state.counts.cacheHits?.[name], 0, Number.MAX_SAFE_INTEGER))
          && ['sourceCalls', 'failures', 'timeouts', 'substitutions', 'cacheEvictions', 'httpAttempts', 'decodedBytes'].every((field) => bounded(state.counts[field], 0, Number.MAX_SAFE_INTEGER))
          && object(state.counts.operationBytes) && names.every((name) => bounded(state.counts.operationBytes[name], 0, Number.MAX_SAFE_INTEGER))
          && (hasHttp ? state.counts.httpAttempts <= limits.sourceAttempts && state.counts.sourceCalls <= state.counts.httpAttempts : state.counts.sourceCalls === 0 && state.counts.httpAttempts === 0)
          && Number.isFinite(state.deadlineAt)
          && (state.halted === null || typeof state.halted === 'string'), 'checkpoint-corrupt', 'Checkpoint accounting is invalid.');
        for (const cached of state.cache) requireValue(names.includes(cached.operation) && /^[a-f0-9]{64}$/.test(cached.cacheKey)
          && Number.isFinite(cached.expiresAt) && inputDigest(cached.payload) === cached.payloadDigest,
        'cache-corrupt', 'The retained response cache failed integrity validation.');
      } else state = { ...structuredClone(initialState), identity, cache: [], attempts: {}, counts: freshCounts(names), halted: null, stages: {}, deadlineAt: now() + limits.deadlineMs };
      validateState(state);
      const deadline = state.deadlineAt;
      const commit = async (kind = 'checkpoint') => {
        validateState(state); await writeAtomic(statePath, state, limits.checkpointBytes, onPhase, kind, ownership.staging);
      };
      persist = commit;
      const stop = (reason, sticky = false) => { if (sticky) state.halted = reason; const error = new CollectionError(reason, 'The bounded stage stopped with an incomplete checkpoint.'); error.stop = true; error.sticky = sticky; throw error; };
      const checkDeadline = () => { if (now() >= deadline) stop('deadline'); };
      async function readHttp(prepared, signal, operation) {
        let reader; let response;
        try {
          response = await http.fetch(prepared.url, { method: 'GET', headers: prepared.headers,
            credentials: 'omit', cache: 'no-store', redirect: 'manual', signal });
          if (response.status >= 300 && response.status < 400) stop('source-redirect-refused', true);
          if (response.status !== 200) { const error = new CollectionError('source-http-failure', 'Public source HTTP failure.'); error.status = response.status; throw error; }
          const expectedType = observationSources[operation].capability === 'bmw-page' ? 'text/html' : 'application/json';
          requireValue((response.headers.get('content-type') || '').split(';')[0] === expectedType, 'source-content-type', 'The qualified response content type changed.');
          if (Number(response.headers.get('content-length')) > limits.responseBytes) stop('response-byte-budget', true);
          const chunks = []; let bytes = 0;
          reader = response.body.getReader();
          const abort = () => { reader.cancel().catch(() => {}); };
          signal.addEventListener('abort', abort, { once: true });
          try {
            while (true) {
              const part = await reader.read();
              if (!part.done) {
                const size = part.value.byteLength; bytes += size;
                state.counts.decodedBytes += size; state.counts.operationBytes[operation] += size;
                await commit('source-bytes');
              }
              checkDeadline();
              if (signal.aborted) throw new CollectionError('operation-timeout', 'The complete source request timed out.');
              if (part.done) break;
              if (bytes > limits.responseBytes) stop('response-byte-budget', true);
              if (state.counts.decodedBytes > limits.sourceBytes) stop('source-byte-budget', true);
              chunks.push(part.value);
            }
          } finally { signal.removeEventListener('abort', abort); }
          const body = Buffer.concat(chunks); let text;
          const strictJson = (observationSources[operation].sourceVersion === DIAGNOSTIC_SOURCE_VERSION
            || observationSources[operation].strictJson === true) && expectedType !== 'text/html';
          try { text = strictJson ? new TextDecoder('utf-8', { fatal: true }).decode(body) : body.toString('utf8'); }
          catch { stop('source-json-utf8', true); }
          let value = text;
          if (expectedType !== 'text/html') {
            try { value = JSON.parse(text); } catch { stop('source-json-shape', true); }
            if (strictJson && duplicateJsonKeys(text)) stop('source-json-duplicate-key', true);
          }
          // Exact decoded stream bytes, before UTF-8 decoding/JSON parsing. No body or header
          // value enters this optional handoff, and request input cannot supply its provenance.
          const metadata = Object.freeze({ schemaVersion: 'collection-http-observation.v1', operation,
            sourceId: observationSources[operation].sourceId, sourceVersion: observationSources[operation].sourceVersion,
            capability: observationSources[operation].capability, transportKind,
            request: Object.freeze({ method: prepared.method, url: prepared.url }),
            observedAt: new Date(now()).toISOString(), responseBytes: bytes,
            responseSha256: createHash('sha256').update(body).digest('hex') });
          executorObservations.add(metadata);
          return { value, metadata };
        } finally {
          if (reader) await reader.cancel().catch(() => {});
          else if (response?.body) await response.body.cancel().catch(() => {});
        }
      }
      async function perform(operation, request) {
        if (state.halted) stop(state.halted, true);
        checkDeadline(); const descriptor = operations[operation];
        const cacheKey = inputDigest({ operation, ...sources[operation], request });
        const cached = descriptor.cache !== false && state.cache.find((row) => row.cacheKey === cacheKey && row.expiresAt > now());
        if (cached) { state.counts.cacheHits[operation] += 1; return structuredClone(cached.payload); }
        for (let attempt = 0; attempt < limits.maxAttempts; attempt += 1) {
          checkDeadline();
          if (state.counts.operations[operation] >= limits.requestBudgets[operation]) stop('request-budget');
          if ((state.attempts[cacheKey] || 0) >= limits.maxAttempts) stop('retry-budget', true);
          const isHttp = descriptor.kind === 'read-only-http';
          const prepared = isHttp ? readOnlyRequest(observationSources[operation].capability, await descriptor.prepare(structuredClone(request)), observationSources[operation].requestRegistration) : null;
          if (isHttp) {
            if (state.counts.httpAttempts >= limits.sourceAttempts) stop('source-attempt-budget', true);
            if (state.counts.decodedBytes >= limits.sourceBytes) stop('source-byte-budget', true);
            state.counts.httpAttempts += 1;
            if (http.kind === 'live') state.counts.sourceCalls += 1;
          }
          state.attempts[cacheKey] = (state.attempts[cacheKey] || 0) + 1;
          state.counts.operations[operation] += 1; await commit('request-count');
          const controller = new AbortController(); activeController = controller; let timer; let value; let sourceTask; let metadata;
          try {
            sourceTask = Promise.resolve().then(() => isHttp ? readHttp(prepared, controller.signal, operation)
              : descriptor.execute(structuredClone(request), { signal: controller.signal }));
            value = await Promise.race([
              sourceTask,
              new Promise((resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new CollectionError('operation-timeout', 'The source operation timed out.')); }, Math.min(limits.operationTimeoutMs, Math.max(1, deadline - now()))); }),
            ]);
            if (isHttp) { metadata = value.metadata; value = value.value; }
            clearTimeout(timer); checkDeadline();
            if ([401, 403, 429].includes(value?.status)) { state.counts.failures += 1; stop(`source-http-${value.status}`, true); }
            if (typeof value?.status === 'number' || ['source-unavailable', 'source-failure', 'unavailable', 'error'].includes(value?.status)) throw new CollectionError('source-response-failure', 'The source returned a failed status.');
          } catch (error) {
            clearTimeout(timer);
            if (isHttp) { controller.abort(); await sourceTask.catch(() => {}); }
            if (error.stop) { if (error.sticky) await commit('stop'); throw error; }
            if ([401, 403, 429].includes(error.status ?? error.statusCode)) { state.counts.failures += 1; stop(`source-http-${error.status ?? error.statusCode}`, true); }
            state.counts.failures += 1;
            if (error.code === 'operation-timeout') state.counts.timeouts += 1;
            await commit('source-failure');
            if (isHttp) stop(error.code === 'operation-timeout' ? 'operation-timeout' : 'source-failure', true);
            if (attempt + 1 === limits.maxAttempts) stop('source-failure', true);
            if (limits.retryDelayMs) await delay(Math.min(limits.retryDelayMs, Math.max(0, deadline - now())));
            continue;
          } finally { clearTimeout(timer); activeController = undefined; }
          // Projection, validation and persistence errors are never transport retries.
          // Cache hits return the original projected payload above; they neither project again
          // nor manufacture a new observation time. Offline projectors receive no HTTP metadata.
          const payload = descriptor.project ? await descriptor.project(value, request, metadata) : structuredClone(value);
          requireValue(Buffer.byteLength(JSON.stringify(payload)) <= 128 * 1024, 'operation-payload-budget', 'The operation response exceeds its bounded contract.');
          requireValue(!prepared || Object.values(prepared.headers).every((secret) => !JSON.stringify(payload).includes(secret)),
            'source-sensitive-projection', 'Ephemeral application headers cannot enter the response cache or checkpoint.');
          if (descriptor.cache === false) return structuredClone(payload);
          const previous = state.cache.length;
          state.cache = state.cache.filter((row) => row.expiresAt > now() && row.cacheKey !== cacheKey);
          state.counts.cacheEvictions += previous - state.cache.length;
          while (state.cache.length >= limits.cacheEntries) { state.cache.shift(); state.counts.cacheEvictions += 1; }
          state.cache.push({ cacheKey, operation, payload, payloadDigest: inputDigest(payload), expiresAt: now() + limits.cacheRetentionMs });
          await commit('cache'); return structuredClone(payload);
        }
      }
      const execute = async (operation, request) => {
        requireValue(names.includes(operation), 'unknown-operation', 'The operation is not part of this stage plan.');
        requireValue(!inFlight, 'operation-busy', 'Supported operation concurrency is one.');
        const task = perform(operation, request); inFlight = task;
        try { return await task; } finally { if (inFlight === task) inFlight = null; }
      };
      let stageState;
      if (stage) {
        const previous = state.stages[stage.id];
        requireValue(previous === undefined || previous.version === stage.version && previous.inputDigest === stage.inputDigest
          && object(previous.data), 'stage-incompatible', 'The stage version/input changed; do not mix its prior outcomes.');
        if (!previous) {
          requireValue(Object.keys(state.stages).length < 32, 'stage-budget', 'The finite run supports at most 32 declared stages.');
          state.stages[stage.id] = { version: stage.version, inputDigest: stage.inputDigest, data: structuredClone(stageInitialState) };
          await commit('stage-start');
        }
        stageState = state.stages[stage.id].data;
      }
      return await callback({ state, stageState, execute, commit, stop, checkDeadline });
    } catch (error) {
      if (error.stop && error.sticky && persist) await persist('stop');
      throw error;
    } finally {
      try { if (inFlight) { activeController?.abort(); await inFlight.catch(() => {}); } }
      finally { try { if (ownership) await ownership.release(); } finally { running = false; } }
    }
  } };
}

