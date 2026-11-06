import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { hostname } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { inputDigest } from '../../server/gcsp/repository/core.js';
import { CollectionError, requireValue } from './configuration-key.mjs';

export const COLLECTION_SESSION_VERSION = '1';
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => inputDigest(a) === inputDigest(b);
const bounded = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const version = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9.-]{0,95}$/.test(value);
const freshCounts = (names) => ({ sourceCalls: 0, operations: Object.fromEntries(names.map((n) => [n, 0])),
  cacheHits: Object.fromEntries(names.map((n) => [n, 0])), failures: 0, timeouts: 0, substitutions: 0, cacheEvictions: 0 });

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
export async function createCollectionSession({ identity: stageIdentity, operations, limits, statePath,
  initialState = {}, validateState = () => {}, now = Date.now, onPhase = async () => {} } = {}) {
  const names = Object.keys(operations || {}).sort();
  requireValue(object(stageIdentity) && object(initialState) && names.length > 0 && names.length <= 16
    && names.every((name) => /^[a-z][a-z0-9-]{0,31}$/.test(name) && object(operations[name])
      && version(operations[name].sourceId) && version(operations[name].sourceVersion)
      && operations[name].kind === 'offline' && typeof operations[name].execute === 'function')
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
  requireValue(typeof statePath === 'string' && isAbsolute(statePath), 'explicit-path-required', 'Supply an absolute owned checkpoint path.');
  const sources = Object.fromEntries(names.map((name) => [name, { sourceId: operations[name].sourceId,
    sourceVersion: operations[name].sourceVersion, kind: operations[name].kind }]));
  const identity = { toolVersion: COLLECTION_SESSION_VERSION, stage: structuredClone(stageIdentity), sources,
    limitsDigest: inputDigest(limits) };
  inputDigest(initialState);
  let running = false;
  return { async withCheckpoint(callback, { stage, initialState: stageInitialState = {} } = {}) {
    requireValue(stage === undefined || object(stage) && version(stage.id) && version(stage.version)
      && typeof stage.inputDigest === 'string' && /^[a-f0-9]{64}$/.test(stage.inputDigest) && object(stageInitialState),
    'invalid-stage', 'A stage has its own ID, version, input digest and optional data, separate from run identity.');
    requireValue(!running, 'checkpoint-busy', 'This session already owns an active checkpoint.'); running = true;
    let ownership; let state; let inFlight = null; let activeController;
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
          && ['sourceCalls', 'failures', 'timeouts', 'substitutions', 'cacheEvictions'].every((field) => bounded(state.counts[field], 0, Number.MAX_SAFE_INTEGER))
          && state.counts.sourceCalls === 0 && Number.isFinite(state.deadlineAt)
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
      const stop = (reason, sticky = false) => { if (sticky) state.halted = reason; const error = new CollectionError(reason, 'The bounded stage stopped with an incomplete checkpoint.'); error.stop = true; error.sticky = sticky; throw error; };
      const checkDeadline = () => { if (now() >= deadline) stop('deadline'); };
      async function perform(operation, request) {
        if (state.halted) stop(state.halted, true);
        checkDeadline(); const descriptor = operations[operation];
        const cacheKey = inputDigest({ operation, ...sources[operation], request });
        const cached = state.cache.find((row) => row.cacheKey === cacheKey && row.expiresAt > now());
        if (cached) { state.counts.cacheHits[operation] += 1; return structuredClone(cached.payload); }
        for (let attempt = 0; attempt < limits.maxAttempts; attempt += 1) {
          checkDeadline();
          if (state.counts.operations[operation] >= limits.requestBudgets[operation]) stop('request-budget');
          if ((state.attempts[cacheKey] || 0) >= limits.maxAttempts) stop('retry-budget', true);
          state.attempts[cacheKey] = (state.attempts[cacheKey] || 0) + 1;
          state.counts.operations[operation] += 1; await commit('request-count');
          const controller = new AbortController(); activeController = controller; let timer; let value;
          try {
            value = await Promise.race([
              Promise.resolve().then(() => descriptor.execute(structuredClone(request), { signal: controller.signal })),
              new Promise((resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new CollectionError('operation-timeout', 'The source operation timed out.')); }, Math.min(limits.operationTimeoutMs, Math.max(1, deadline - now()))); }),
            ]);
            clearTimeout(timer); checkDeadline();
            if ([401, 403, 429].includes(value?.status)) { state.counts.failures += 1; stop(`source-http-${value.status}`, true); }
            if (typeof value?.status === 'number' || ['source-unavailable', 'source-failure', 'unavailable', 'error'].includes(value?.status)) throw new CollectionError('source-response-failure', 'The source returned a failed status.');
          } catch (error) {
            clearTimeout(timer);
            if (error.stop) { if (error.sticky) await commit('stop'); throw error; }
            if ([401, 403, 429].includes(error.status ?? error.statusCode)) { state.counts.failures += 1; stop(`source-http-${error.status ?? error.statusCode}`, true); }
            state.counts.failures += 1;
            if (error.code === 'operation-timeout') state.counts.timeouts += 1;
            await commit('source-failure');
            if (attempt + 1 === limits.maxAttempts) stop('source-failure', true);
            if (limits.retryDelayMs) await delay(Math.min(limits.retryDelayMs, Math.max(0, deadline - now())));
            continue;
          } finally { clearTimeout(timer); activeController = undefined; }
          // Projection, validation and persistence errors are never transport retries.
          const payload = descriptor.project ? await descriptor.project(value, request) : structuredClone(value);
          requireValue(Buffer.byteLength(JSON.stringify(payload)) <= 128 * 1024, 'operation-payload-budget', 'The operation response exceeds its bounded contract.');
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
    } finally {
      try { if (inFlight) { activeController?.abort(); await inFlight.catch(() => {}); } }
      finally { try { if (ownership) await ownership.release(); } finally { running = false; } }
    }
  } };
}

