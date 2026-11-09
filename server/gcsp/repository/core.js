import { createHash } from 'node:crypto';
import { CONTRACT_VERSION, TABLES, FOUNDATION_TABLES, OCCUPYING_STATES } from './schema.js';
export { CONTRACT_VERSION, TABLES, FOUNDATION_TABLES, OCCUPYING_STATES, createState } from './schema.js';
export const result = (status, content = {}) => ({ status, ...content, contractVersion: CONTRACT_VERSION });
export const ok = (value) => result('ok', { value });
const invalid = (code, field, reason) => result('invalid', { code, reasons: [{ field, reason }] });
const conflict = (reason, current = {}) => result('conflict', { reason, current });
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const identifier = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512;
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const jsonValue = (value, seen = new Set()) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  if (!Array.isArray(value) && !plain(value)) return false;
  seen.add(value);
  const valid = Object.entries(value).every(([key, item]) => !['__proto__', 'prototype', 'constructor'].includes(key) && jsonValue(item, seen));
  seen.delete(value);
  return valid;
};
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const inputDigest = (value) => {
  if (!jsonValue(value)) throw new TypeError('Digest input must be JSON data');
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
};
// Two strings are canonically equal exactly when identical; this keeps key scans cheap.
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' ? a === b : JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const matches = (row, filter) => Object.entries(filter).every(([key, value]) => equal(row[key], value));
const occupied = (row) => OCCUPYING_STATES.includes(row.state);
const summary = (row) => Object.fromEntries(['state', 'version', 'orderUuid', 'entitlementSlotId', 'capacity'].filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));
const stale = (table, key, expectedVersion, currentVersion) => result('stale-version', { expectedVersion, currentVersion, resource: { table, key } });
const notFound = (table) => result('not-found', { resourceType: table });
const contentRow = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => !['version', 'createdAt', 'updatedAt'].includes(key)));

function validateObject(table, value, kind) {
  if (typeof table !== 'string' || !Object.hasOwn(TABLES, table)) return invalid('unknown-table', 'table', 'Unknown storage table');
  const schema = TABLES[table];
  if (!plain(value) || !jsonValue(value)) return invalid('malformed-input', kind, 'Expected JSON object');
  if (Object.keys(value).some((key) => !schema.fields.includes(key))) return invalid('unknown-field', kind, 'Unknown storage field');
  if (kind === 'key' && (Object.keys(value).some((key) => !schema.key.includes(key)) || schema.key.some((key) => value[key] === undefined))) {
    return invalid('invalid-key', 'key', 'Use the complete primary key');
  }
  if (kind === 'row' || kind === 'key') {
    for (const key of schema.key) {
      if (['briefVersion'].includes(key) ? !positive(value[key]) : !identifier(value[key])) return invalid('invalid-key', key, 'Missing or malformed key');
    }
  }
  if (value.version !== undefined && !positive(value.version)) return invalid('invalid-version', 'version', 'Expected a positive integer');
  if (table === 'renewal_cases') {
    if (kind === 'row' && ['employeeId', 'renewalId'].some((key) => !identifier(value[key]))) return invalid('invalid-case-owner', 'employeeId/renewalId', 'A scoped employee and renewal are required');
    if (value.status !== undefined && !['open', 'in-progress', 'remedy-proposed', 'resolved', 'closed'].includes(value.status)) return invalid('invalid-state', 'status', 'Unknown renewal case state');
  }
  if (['holds', 'claims'].includes(table)) {
    if (value.state !== undefined && ![...OCCUPYING_STATES, 'released', 'expired', 'allocated', 'claim-failed'].includes(value.state)) return invalid('invalid-state', 'state', 'Unknown hold or claim state');
    if (value.type !== undefined && !['cart', 'buddy-offer'].includes(value.type)) return invalid('invalid-hold-type', 'type', 'Unknown hold type');
  }
  if (table === 'entitlement_slots' && ['capacity', 'employeeCapacity'].some((key) => value[key] !== undefined && !positive(value[key]))) return invalid('invalid-capacity', 'capacity', 'Capacity must be a positive integer');
  return null;
}
function validateRef(ref) {
  if (!plain(ref) || Object.keys(ref).some((key) => !['table', 'key'].includes(key))) return invalid('invalid-ref', 'ref', 'Expected table and key');
  return validateObject(ref.table, ref.key, 'key');
}
function scope(context, object) {
  return object.runId !== undefined && object.runId !== context.runId
    ? result('stale-run', { reason: 'The requested run differs from the current context' }) : null;
}
function contextError(context, state, write = false) {
  if (!plain(context) || !identifier(context.runId) || !identifier(context.environmentId) || !identifier(context.principalId)
    || !Array.isArray(context.roles) || !context.roles.every(identifier)) return invalid('invalid-context', 'context', 'A trusted run, environment and principal context is required');
  const run = state.tables.runs.find((row) => row.runId === context.runId);
  if (run && run.environmentId !== context.environmentId) return result('forbidden', { reason: 'Context environment does not own this run' });
  if (write && run && (run.status === 'historical' || run.current === false)) return result('stale-run', { reason: 'Historical runs cannot accept commands' });
  return null;
}

// Shallow memory snapshots share rows and only append receipts or replace them in place (keys fixed),
// so positions indexed once stay exact for every later snapshot whose last indexed row is unchanged.
export const createReceiptIndex = () => ({ positions: new Map(), count: 0, last: undefined });
const receiptKey = (runId, consumerId, eventId) => `${runId}\u0000${consumerId}\u0000${eventId}`;
const isReceipt = (row, runId, consumerId, eventId) => row.runId === runId && row.consumerId === consumerId && row.eventId === eventId;
/** Position of the first receipt with this key in `receipts`, or -1; the index only ever shortcuts the scan. */
export function findReceipt(index, receipts, runId, consumerId, eventId) {
  if (index && [runId, consumerId, eventId].every((part) => typeof part === 'string')) {
    if (receipts.length < index.count || (index.count > 0 && receipts[index.count - 1] !== index.last)) { index.positions.clear(); index.count = 0; }
    for (; index.count < receipts.length; index.count += 1) {
      const row = receipts[index.count]; const key = receiptKey(row.runId, row.consumerId, row.eventId);
      if (!index.positions.has(key)) index.positions.set(key, index.count);
    }
    index.last = receipts[index.count - 1];
    const position = index.positions.get(receiptKey(runId, consumerId, eventId));
    if (position === undefined) return -1;
    if (isReceipt(receipts[position], runId, consumerId, eventId)) return position;
  }
  return receipts.findIndex((row) => isReceipt(row, runId, consumerId, eventId));
}
const RECEIPT_KEY = Object.freeze(['consumerId', 'eventId', 'runId']);

export function createTransaction(context, state, now = () => new Date().toISOString(), supportedTables = FOUNDATION_TABLES, receiptIndex = undefined) {
  let failure;
  let active = true;
  const remember = (outcome, lookup = false) => {
    if (outcome.status !== 'ok' && outcome.status !== 'pending' && !(lookup && outcome.status === 'not-found')) failure ||= outcome;
    return structuredClone(outcome);
  };
  const guarded = (operation, lookup = false) => async (...args) => {
    if (!active) return invalid('transaction-closed', 'transaction', 'Transaction has finished');
    if (failure) return structuredClone(failure);
    return remember(operation(...args), lookup);
  };
  const supported = (table) => TABLES[table] && !supportedTables.includes(table) ? invalid('unsupported-table', 'table', 'Table requires an additional migration') : null;
  const rows = (table) => state.tables[table].filter((row) => row.runId === context.runId);
  const receiptPosition = (consumerId, eventId) => findReceipt(receiptIndex, state.tables.event_receipts, context.runId, consumerId, eventId);
  // An exact receipt key in this run, looked up through the index; any other key keeps the plain scan.
  const exactReceipt = (table, key) => table === 'event_receipts' && key.runId === context.runId
    && Object.keys(key).sort().join() === RECEIPT_KEY.join() && typeof key.consumerId === 'string' && typeof key.eventId === 'string';
  const locate = (table, key) => {
    if (!exactReceipt(table, key)) return rows(table).find((item) => matches(item, key));
    const position = receiptPosition(key.consumerId, key.eventId);
    return position < 0 ? undefined : state.tables.event_receipts[position];
  };
  const get = (ref) => {
    const error = validateRef(ref) || supported(ref.table) || scope(context, ref.key);
    if (error) return error;
    const row = locate(ref.table, ref.key);
    return row ? ok(row) : notFound(ref.table);
  };
  const list = (table, filter = {}) => {
    const error = validateObject(table, filter, 'filter') || supported(table) || scope(context, filter);
    if (error) return error;
    return ok(rows(table).filter((row) => matches(row, filter)));
  };
  const constraint = (table, row, previous) => {
    const schema = TABLES[table];
    if (table !== 'runs' && !state.tables.runs.some((run) => run.runId === context.runId)) return conflict('missing-run');
    for (const fields of schema.unique) {
      const candidates = table === 'runs' ? state.tables.runs : rows(table);
      if (fields.includes('$current')) {
        if ((row.current === true || row.status === 'active') && candidates.some((other) => other !== previous && other.runId !== row.runId && other.environmentId === row.environmentId && (other.current === true || other.status === 'active'))) return conflict('current-run-exists');
      } else if (fields.every((key) => row[key] !== undefined) && candidates.some((other) => other !== previous && fields.every((key) => equal(other[key], row[key])))) return conflict('unique-key', { table, fields });
    }
    for (const [target, field] of schema.refs) {
      if (row[field] !== undefined && !rows(target).some((other) => other[field] === row[field])) return conflict('missing-reference', { table: target });
    }
    if (table === 'renewal_cases' && ['open', 'in-progress', 'remedy-proposed'].includes(row.status)
      && rows(table).some((other) => other !== previous && other.employeeId === row.employeeId && other.renewalId === row.renewalId
        && ['open', 'in-progress', 'remedy-proposed'].includes(other.status))) return conflict('active-renewal-case-exists');
    if (table === 'claims') {
      const hold = rows('holds').find((item) => item.holdId === row.holdId);
      if (!hold || ['orderUuid', 'employeeId', 'entitlementSlotId'].some((key) => hold[key] !== row[key])) return conflict('claim-hold-mismatch');
    }
    if (['holds', 'claims'].includes(table) && occupied(row)) {
      const counterpart = table === 'holds' ? 'claims' : 'holds';
      if (rows(counterpart).some((other) => other.orderUuid === row.orderUuid && other.holdId !== row.holdId && occupied(other))) return conflict('car-occupied', { orderUuid: row.orderUuid });
      if (rows(table).some((other) => other !== previous && other.orderUuid === row.orderUuid && occupied(other))) return conflict('car-occupied', { orderUuid: row.orderUuid });
      const stock = rows('stock').find((item) => item.orderUuid === row.orderUuid);
      if (stock && (stock.state === 'allocated' || stock.status === 'allocated' || stock.allocated === true)) return conflict('stock-unavailable', summary(stock));
      const slot = rows('entitlement_slots').find((item) => item.entitlementSlotId === row.entitlementSlotId);
      if (!slot || slot.employeeId !== row.employeeId) return conflict('slot-ownership');
      if (!positive(slot.capacity)) return invalid('invalid-capacity', 'capacity', 'Slot must configure its positive capacity');
      if (rows(table).filter((item) => item !== previous && item.entitlementSlotId === row.entitlementSlotId && occupied(item)).length >= slot.capacity) return conflict('slot-capacity', summary(slot));
      if (slot.employeeCapacity !== undefined && (!positive(slot.employeeCapacity) || rows(table).filter((item) => item !== previous && item.employeeId === row.employeeId && occupied(item)).length >= slot.employeeCapacity)) return conflict('employee-capacity');
    }
    return null;
  };
  const insert = (table, input) => {
    const error = validateObject(table, input, 'row') || supported(table) || scope(context, input);
    if (error) return error;
    if (table === 'runs' && input.environmentId !== context.environmentId) return result('forbidden', { reason: 'Run environment differs from context' });
    const schema = TABLES[table];
    const replayId = inputDigest(Object.fromEntries(schema.key.map((key) => [key, input[key]])));
    const digest = inputDigest(contentRow(input));
    const originalAt = receiptPosition(`repository:insert:${table}`, replayId);
    const original = originalAt < 0 ? undefined : state.tables.event_receipts[originalAt];
    if (original) {
      if (original.inputDigest !== digest) return conflict('idempotency-input-changed');
      const outcome = structuredClone(original.outcome);
      // Rehydrate only from the digest-validated original command, never the mutable job.
      if (table === 'notification_outbox' && original.inputVersions?.offerLinkFromInsertInput === 1) {
        outcome.value.payload.offerLink = structuredClone(input.payload.offerLink);
      }
      return outcome;
    }
    const keyOf = Object.fromEntries(schema.key.map((key) => [key, input[key]]));
    const existing = exactReceipt(table, keyOf) ? locate(table, keyOf) : rows(table).find((row) => schema.key.every((key) => equal(row[key], input[key])));
    if (existing) return equal(contentRow(existing), contentRow(input)) ? ok(existing) : conflict('duplicate-key', summary(existing));
    const timestamp = now();
    const row = { ...structuredClone(input), version: input.version ?? 1, createdAt: input.createdAt ?? timestamp, updatedAt: input.updatedAt ?? timestamp };
    const violation = constraint(table, row);
    if (violation) return violation;
    state.tables[table].push(row);
    if (table !== 'event_receipts') {
      const outcome = structuredClone(ok(row));
      const omitLink = table === 'notification_outbox' && plain(row.payload) && Object.hasOwn(row.payload, 'offerLink');
      if (omitLink) delete outcome.value.payload.offerLink;
      state.tables.event_receipts.push({ runId: context.runId, consumerId: `repository:insert:${table}`, eventId: replayId,
        inputDigest: digest, state: 'completed', outcome, ...(omitLink ? { inputVersions: { offerLinkFromInsertInput: 1 } } : {}),
        version: 1, createdAt: timestamp, updatedAt: timestamp });
    }
    return ok(row);
  };
  const cas = (ref, expectedVersion, patch) => {
    const error = validateRef(ref) || supported(ref.table) || scope(context, ref.key) || validateObject(ref.table, patch, 'patch');
    if (error) return error;
    if (!positive(expectedVersion)) return invalid('invalid-version', 'expectedVersion', 'Expected a positive integer');
    if (ref.table === 'runs' && patch.environmentId !== undefined && patch.environmentId !== context.environmentId) return result('forbidden', { reason: 'Run environment differs from context' });
    const schema = TABLES[ref.table];
    if (Object.keys(patch).some((key) => [...schema.key, 'version', 'createdAt', 'updatedAt'].includes(key))) return invalid('immutable-field', 'patch', 'Identity and version fields cannot be patched');
    const found = get(ref);
    if (found.status !== 'ok') return found;
    const previous = locate(ref.table, ref.key);
    if (previous.version !== expectedVersion) return stale(ref.table, ref.key, expectedVersion, previous.version);
    if (schema.immutable) return invalid('immutable-row', 'table', 'Append a new historical version');
    if (['holds', 'claims'].includes(ref.table) && !occupied(previous) && occupied({ ...previous, ...patch })) return conflict('terminal-state');
    const row = { ...previous, ...structuredClone(patch), version: previous.version + 1, updatedAt: now() };
    const violation = constraint(ref.table, row, previous);
    if (violation) return violation;
    const position = state.tables[ref.table].indexOf(previous);
    state.tables[ref.table][position] = row;
    if (receiptIndex && ref.table === 'event_receipts' && position === receiptIndex.count - 1) receiptIndex.last = row;
    return ok(row);
  };
  const recordReceipt = (receipt) => {
    if (!plain(receipt) || !identifier(receipt.consumerId) || !identifier(receipt.eventId) || !identifier(receipt.inputDigest) || receipt.outcome === undefined) return invalid('invalid-receipt', 'receipt', 'Receipt IDs, digest and outcome are required');
    const error = scope(context, receipt);
    if (error) return error;
    const existingAt = receiptPosition(receipt.consumerId, receipt.eventId);
    const existing = existingAt < 0 ? undefined : state.tables.event_receipts[existingAt];
    if (existing) return existing.inputDigest === receipt.inputDigest ? ok(existing) : conflict('idempotency-input-changed');
    return insert('event_receipts', { ...receipt, runId: context.runId });
  };
  const enqueue = (job) => {
    if (!plain(job) || !identifier(job.idempotencyKey) || !identifier(job.inputDigest)) return invalid('invalid-job', 'job', 'Outbox key and input digest are required');
    const error = scope(context, job);
    if (error) return error;
    const existing = rows('notification_outbox').find((row) => row.idempotencyKey === job.idempotencyKey);
    if (existing) return existing.inputDigest === job.inputDigest ? ok(existing) : conflict('idempotency-input-changed');
    return insert('notification_outbox', { ...job, runId: context.runId });
  };
  const conditionalClaim = (input) => {
    if (!plain(input) || !jsonValue(input)) return invalid('invalid-claim', 'input', 'Expected claim input');
    const allowed = ['runId', 'orderUuid', 'holdId', 'claimId', 'employeeId', 'entitlementSlotId', 'renewalId', 'type', 'state', 'phase', 'expiresAt', 'policyVersion', 'quoteId', 'operationId', 'expectedStockVersion', 'expectedSlotVersion'];
    if (Object.keys(input).some((key) => !allowed.includes(key))) return invalid('unknown-field', 'input', 'Unknown claim field');
    const error = scope(context, input);
    if (error) return error;
    for (const key of ['orderUuid', 'holdId', 'claimId', 'employeeId', 'entitlementSlotId', 'expiresAt', 'policyVersion', 'quoteId']) {
      if (!identifier(input[key])) return invalid('invalid-claim', key, 'Required claim field');
    }
    if (!['cart', 'buddy-offer'].includes(input.type) || !Number.isFinite(Date.parse(input.expiresAt)) || !/Z$/.test(input.expiresAt)) return invalid('invalid-claim', 'type/expiresAt', 'Expected hold type and UTC expiry');
    if (!positive(input.expectedStockVersion) || !positive(input.expectedSlotVersion)) return invalid('invalid-version', 'expectedVersions', 'Expected positive stock and slot versions');
    if (input.state !== undefined && !OCCUPYING_STATES.includes(input.state)) return invalid('invalid-claim', 'state', 'New claim must occupy the car');
    const stock = rows('stock').find((row) => row.orderUuid === input.orderUuid);
    const slot = rows('entitlement_slots').find((row) => row.entitlementSlotId === input.entitlementSlotId);
    if (!stock) return notFound('stock');
    if (!slot) return notFound('entitlement_slots');
    if (stock.version !== input.expectedStockVersion) return stale('stock', { runId: context.runId, orderUuid: input.orderUuid }, input.expectedStockVersion, stock.version);
    if (slot.version !== input.expectedSlotVersion) return stale('entitlement_slots', { runId: context.runId, entitlementSlotId: input.entitlementSlotId }, input.expectedSlotVersion, slot.version);
    if (rows('holds').some((row) => row.orderUuid === input.orderUuid && occupied(row)) || rows('claims').some((row) => row.orderUuid === input.orderUuid && occupied(row))) return conflict('car-occupied', summary(stock));
    if (stock.state && stock.state !== 'available' || stock.status && stock.status !== 'available' || stock.available === false || stock.allocated === true) return conflict('stock-unavailable', summary(stock));
    if (slot.employeeId !== input.employeeId) return result('forbidden', { reason: 'Entitlement slot does not belong to employee' });
    const quote = rows('quotes').find((row) => row.quoteId === input.quoteId);
    if (!quote || quote.orderUuid !== input.orderUuid || quote.policyVersion !== input.policyVersion || quote.employeeId && quote.employeeId !== input.employeeId) return conflict('quote-mismatch');
    const { expectedStockVersion, expectedSlotVersion, claimId, ...holdInput } = input;
    const hold = insert('holds', { ...holdInput, runId: context.runId, state: input.state ?? 'active' });
    if (hold.status !== 'ok') return hold;
    const claim = insert('claims', { runId: context.runId, claimId, holdId: input.holdId, orderUuid: input.orderUuid, employeeId: input.employeeId, entitlementSlotId: input.entitlementSlotId, type: input.type, state: input.state ?? 'active', expiresAt: input.expiresAt, policyVersion: input.policyVersion, quoteId: input.quoteId });
    if (claim.status !== 'ok') return claim;
    const stockWrite = cas({ table: 'stock', key: { runId: context.runId, orderUuid: input.orderUuid } }, expectedStockVersion, { state: 'held' });
    if (stockWrite.status !== 'ok') return stockWrite;
    const slotWrite = cas({ table: 'entitlement_slots', key: { runId: context.runId, entitlementSlotId: input.entitlementSlotId } }, expectedSlotVersion, {});
    if (slotWrite.status !== 'ok') return slotWrite;
    return ok({ hold: hold.value, claim: claim.value, stockVersion: stockWrite.value.version, slotVersion: slotWrite.value.version });
  };
  return {
    tx: Object.freeze({ get: guarded(get, true), list: guarded(list, true), insert: guarded(insert), compareAndSwap: guarded(cas), conditionalClaim: guarded(conditionalClaim),
      getReceipt: guarded((consumerId, eventId) => !identifier(consumerId) || !identifier(eventId) ? invalid('invalid-receipt', 'receipt', 'Receipt IDs are required') : get({ table: 'event_receipts', key: { runId: context.runId, consumerId, eventId } }), true),
      recordReceipt: guarded(recordReceipt), enqueueNotification: guarded(enqueue) }),
    finish: () => { active = false; return failure; },
  };
}

// Callers still get only `unavailable`; the log names the operation and a class-like error name, never messages or rows.
const diagnose = (operation, error) => { try { const name = error?.name;
  console.error(`gcsp-repository unavailable: operation=${operation} error=${typeof name === 'string' && /^[A-Za-z][\w.]{0,63}$/.test(name) ? name : 'unrecognised'}`); } catch { /* never mask the safe result */ } };
export function createRepository(backend) {
  let opened = false;
  const commitObservers = new Set();
  const unavailable = () => result('unavailable', { reason: 'Repository is unavailable', retryable: true });
  const safe = async (operation, work) => { try { return await work(); } catch (error) { diagnose(operation, error); return unavailable(); } };
  return Object.freeze({
    // Backend composition only. Observers run after the provider releases its
    // transaction/lock; their failures cannot undo or replace committed results.
    afterCommit(observer) {
      if (typeof observer !== 'function') throw new TypeError('Supply a commit observer.');
      commitObservers.add(observer);
      return () => commitObservers.delete(observer);
    },
    async open(options = {}) {
      return safe('open', async () => { const outcome = await backend.open(options); opened = outcome.status === 'ok'; return outcome; });
    },
    async migrationStatus() { return opened ? safe('migrationStatus', () => backend.migrationStatus()) : unavailable(); },
    async currentRun(environmentId) {
      if (!opened) return unavailable();
      if (!identifier(environmentId)) return invalid('invalid-environment', 'environmentId', 'Supply an environment');
      return safe('currentRun', () => backend.read({ environmentId, runId: 'repository:current-run' }, async (state) => {
        const current = state.tables.runs.filter((row) => row.environmentId === environmentId && row.current === true && row.status === 'active');
        return current.length === 1 ? ok(current[0]) : current.length ? conflict('multiple-current-runs') : notFound('runs');
      }));
    },
    // One backend transaction retires the old run, seeds the replacement and records the reset receipt.
    // Only this operation crosses run scopes; normal CRUD remains scoped to its trusted context.
    async resetRun(context, command, { expectedCurrentRunId, expectedRunVersion, nextRun, rows } = {}) {
      if (!opened) return unavailable();
      if (!plain(command) || !identifier(command.commandId) || !identifier(command.inputDigest)
        || !plain(nextRun) || !identifier(nextRun.runId) || nextRun.environmentId !== context?.environmentId
        || nextRun.current !== true || nextRun.status !== 'active'
        || !(expectedCurrentRunId === null || identifier(expectedCurrentRunId) && positive(expectedRunVersion))
        || !Array.isArray(rows) || rows.some((entry) => !Array.isArray(entry) || entry.length !== 2
          || !['employees', 'entitlement_slots', 'stock'].includes(entry[0]) || !plain(entry[1]))) {
        return invalid('invalid-reset', 'reset', 'Supply a complete run transition and fixture rows');
      }
      return safe('resetRun', () => backend.transaction(context, async (state) => {
        const refused = contextError(context, state);
        if (refused) return { commit: false, outcome: refused };
        const receipt = state.tables.event_receipts.find((row) => row.runId === context.runId
          && row.consumerId === 'command:reset-run' && row.eventId === command.commandId);
        if (receipt) return { commit: false, outcome: receipt.inputDigest === command.inputDigest
          ? structuredClone(receipt.outcome) : conflict('idempotency-input-changed') };
        const current = state.tables.runs.find((row) => row.environmentId === context.environmentId && (row.current === true || row.status === 'active'));
        if ((current?.runId ?? null) !== expectedCurrentRunId || current && current.runId !== context.runId) {
          return { commit: false, outcome: result('stale-run', { reason: 'The current run has changed' }) };
        }
        if (state.tables.runs.some((row) => row.runId === nextRun.runId)) return { commit: false, outcome: conflict('run-id-exists') };
        if (current) {
          const previous = createTransaction(context, state, backend.now, backend.supportedTables, backend.receiptIndex);
          const retired = await previous.tx.compareAndSwap({ table: 'runs', key: { runId: current.runId } }, expectedRunVersion, { current: false, status: 'historical' });
          if (retired.status !== 'ok') return { commit: false, outcome: retired };
          // Only reset crosses historical scopes. Retire outstanding jobs in
          // this same atomic transition so they cannot revive in a later run.
          for (const job of state.tables.notification_outbox.filter((row) => row.runId === current.runId && !['sent', 'stale'].includes(row.state))) {
            const changed = await previous.tx.compareAndSwap({ table: 'notification_outbox', key: { runId: current.runId, jobId: job.jobId } }, job.version,
              { state: 'stale', outcome: { ...job.outcome, error: 'stale-run', nextAttemptAt: null } });
            if (changed.status !== 'ok') { previous.finish(); return { commit: false, outcome: changed }; }
          }
          previous.finish();
        }
        const nextContext = { ...context, runId: nextRun.runId };
        const seed = createTransaction(nextContext, state, backend.now, backend.supportedTables, backend.receiptIndex);
        let outcome = await seed.tx.insert('runs', nextRun);
        for (const [table, row] of rows) {
          if (outcome.status !== 'ok') break;
          if (row.runId !== undefined && row.runId !== nextRun.runId) { outcome = result('stale-run', { reason: 'Fixture belongs to another run' }); break; }
          outcome = await seed.tx.insert(table, { ...row, runId: nextRun.runId });
        }
        const failure = seed.finish();
        if (failure || outcome.status !== 'ok') return { commit: false, outcome: failure || outcome };
        const stored = ok({ previousRunId: expectedCurrentRunId, runId: nextRun.runId, now: nextRun.clockInstant ?? null, versions: nextRun.versions ?? {} });
        const recorder = createTransaction(context, state, backend.now, backend.supportedTables, backend.receiptIndex);
        const recorded = await recorder.tx.recordReceipt({ consumerId: 'command:reset-run', eventId: command.commandId, inputDigest: command.inputDigest, state: 'completed', outcome: stored });
        recorder.finish();
        return { commit: recorded.status === 'ok', outcome: recorded.status === 'ok' ? stored : recorded };
      }));
    },
    async transaction(context, command, work) {
      if (!opened) return unavailable();
      if (!plain(command) || !identifier(command.commandId) || !identifier(command.inputDigest) || typeof work !== 'function') return invalid('invalid-command', 'command', 'Command ID, digest and callback are required');
      let committed = false;
      const outcome = await safe('transaction', () => backend.transaction(context, async (state) => {
        const refused = contextError(context, state);
        if (refused) return { commit: false, outcome: refused };
        const consumerId = 'command:transaction';
        const receiptAt = findReceipt(backend.receiptIndex, state.tables.event_receipts, context.runId, consumerId, command.commandId);
        const receipt = receiptAt < 0 ? undefined : state.tables.event_receipts[receiptAt];
        if (receipt) return { commit: false, outcome: receipt.inputDigest === command.inputDigest ? structuredClone(receipt.outcome) : conflict('idempotency-input-changed') };
        const historical = contextError(context, state, true);
        if (historical) return { commit: false, outcome: historical };
        const session = createTransaction(context, state, backend.now, backend.supportedTables, backend.receiptIndex);
        let outcome;
        try { outcome = await work(session.tx); } catch (error) { diagnose('transaction.work', error); session.finish(); return { commit: false, outcome: unavailable() }; }
        const failure = session.finish();
        if (failure) return { commit: false, outcome: failure };
        if (!plain(outcome) || !identifier(outcome.status) || !jsonValue(outcome)) return { commit: false, outcome: invalid('invalid-outcome', 'work', 'Callback must return a contract outcome') };
        if (!['ok', 'pending'].includes(outcome.status)) return { commit: false, outcome: { ...outcome, contractVersion: CONTRACT_VERSION } };
        if ((outcome.status === 'ok' && !Object.hasOwn(outcome, 'value')) || (outcome.status === 'pending' && !['operationId', 'operationType', 'lastKnownState'].every((key) => identifier(outcome[key])))) return { commit: false, outcome: invalid('invalid-outcome', 'work', 'Callback must return a complete contract outcome') };
        const storedOutcome = { ...structuredClone(outcome), contractVersion: CONTRACT_VERSION };
        const recorder = createTransaction(context, state, backend.now, backend.supportedTables, backend.receiptIndex);
        const recorded = await recorder.tx.recordReceipt({ consumerId, eventId: command.commandId, inputDigest: command.inputDigest, state: 'completed', outcome: storedOutcome });
        recorder.finish();
        committed = recorded.status === 'ok';
        return committed ? { commit: true, outcome: storedOutcome } : { commit: false, outcome: recorded };
      }));
      if (committed && ['ok', 'pending'].includes(outcome.status)) {
        await Promise.allSettled([...commitObservers].map((observer) => Promise.resolve().then(() => observer({
          context: structuredClone(context), commandId: command.commandId,
        }))));
      }
      return outcome;
    },
    async read(context, ref) {
      if (!opened) return unavailable();
      return safe('read', () => backend.read(context, async (state) => {
        const error = contextError(context, state);
        if (error) return error;
        const session = createTransaction(context, state, backend.now, backend.supportedTables, backend.receiptIndex);
        const outcome = await session.tx.get(ref); session.finish(); return outcome;
      }));
    },
    async query(context, table, filter = {}) {
      if (!opened) return unavailable();
      return safe('query', () => backend.read(context, async (state) => {
        const error = contextError(context, state);
        if (error) return error;
        const session = createTransaction(context, state, backend.now, backend.supportedTables, backend.receiptIndex);
        const outcome = await session.tx.list(table, filter); session.finish(); return outcome;
      }));
    },
    async close() { return safe('close', async () => { opened = false; commitObservers.clear(); return backend.close(); }); },
  });
}
