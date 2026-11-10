import { setImmediate } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { createMemoryStore } from '../repository/memory.js';
import { createReceiptIndex, createRepository, ok, result } from '../repository/core.js';

function shareImmutableRows() {
  const normalized = new WeakMap(); const ids = new WeakMap(); const pool = new Map();
  let nextId = 0;
  const collected = new FinalizationRegistry(({ key, reference }) => {
    const bucket = pool.get(key);
    if (!bucket) return;
    const index = bucket.indexOf(reference);
    if (index !== -1) bucket.splice(index, 1);
    if (!bucket.length) pool.delete(key);
  });
  const atom = (value) => value !== null && typeof value === 'object' ? ['reference', ids.get(value)]
    : [typeof value, Object.is(value, -0) ? '-0' : value];
  function intern(value) {
    if (value === null || typeof value !== 'object') return value;
    if (normalized.has(value)) return normalized.get(value);
    const array = Array.isArray(value); const keys = Object.keys(value);
    const children = keys.map((key) => intern(value[key]));
    const prototype = Object.getPrototypeOf(value);
    // Keep only compact bucket keys; retaining full signatures duplicates the immutable row content.
    const signature = JSON.stringify([array ? 'array' : prototype === null ? 'null-object' : 'object',
      keys.map((key, index) => [key, atom(children[index])])]);
    const key = createHash('sha256').update(signature).digest('hex').slice(0, 16);
    const bucket = pool.get(key) ?? [];
    let canonical;
    for (let index = bucket.length - 1; index >= 0; index -= 1) {
      const candidate = bucket[index].deref();
      if (!candidate) { bucket.splice(index, 1); continue; }
      // A hash only selects a bucket: canonical children, ordered keys and kind must match exactly.
      if (Array.isArray(candidate) !== array || Object.getPrototypeOf(candidate) !== prototype) continue;
      const candidateKeys = Object.keys(candidate);
      if (candidateKeys.length === keys.length && keys.every((key, index) =>
        key === candidateKeys[index] && Object.is(candidate[key], children[index]))) {
        canonical = candidate; break;
      }
    }
    if (!canonical) {
      canonical = keys.every((key, index) => value[key] === children[index]) ? value
        : array ? [...children] : Object.fromEntries(keys.map((key, index) => [key, children[index]]));
      if (prototype === null && Object.getPrototypeOf(canonical) !== null) Object.setPrototypeOf(canonical, null);
      Object.freeze(canonical); ids.set(canonical, ++nextId);
      const reference = new WeakRef(canonical); bucket.push(reference); pool.set(key, bucket);
      collected.register(canonical, { key, reference });
    }
    normalized.set(value, canonical); normalized.set(canonical, canonical);
    return canonical;
  }
  return intern;
}

export function createComparisonStore() {
  const store = createMemoryStore(); const intern = shareImmutableRows();
  let committed = store.state;
  Object.defineProperty(store, 'state', { enumerable: true,
    get() { return committed; },
    set(state) {
      // State/table-array versions stay outside the pool; only new immutable row subtrees need normalization.
      const tables = Object.fromEntries(Object.entries(state.tables).map(([name, rows]) => [name, Object.freeze(rows.map(intern))]));
      committed = Object.freeze({ ...state, tables: Object.freeze(tables) });
    } });
  store.state = committed;
  return store;
}

function terminalRepository(target) {
  const subscriptions = new Set(); let transactions = 0;
  const unavailable = () => result('unavailable', { reason: 'Repository is unavailable', retryable: true });
  const methods = Object.fromEntries(Object.keys(target).map((name) => [name, async (...args) => {
    if (!target) return unavailable();
    const outcome = await target[name](...args);
    // WeakRef dereferences live through the current job; periodically yield so obsolete rows can collect.
    if (name === 'transaction' && ++transactions % 64 === 0) await setImmediate();
    return outcome;
  }]));
  return Object.freeze({ ...methods,
    afterCommit(observer) {
      if (!target) return () => false;
      let unsubscribe = target.afterCommit(observer);
      const remove = () => { const current = unsubscribe; unsubscribe = undefined; subscriptions.delete(remove); return current?.(); };
      subscriptions.add(remove); return remove;
    },
    async close() {
      if (!target) return ok({ closed: true });
      const closing = target; target = null;
      for (const unsubscribe of subscriptions) unsubscribe();
      return closing.close();
    },
  });
}

export function createComparisonRepository({ now, store = createComparisonStore() } = {}) {
  const receiptIndex = createReceiptIndex();
  const serialized = async (work) => {
    const predecessor = store.queue; let release;
    store.queue = new Promise((resolve) => { release = resolve; });
    await predecessor;
    try { return await work(); } finally { release(); }
  };
  return terminalRepository(createRepository({ now, receiptIndex,
    async open() { return ok({ provider: 'memory', migrationStatus: { current: true, appliedVersions: [], pendingVersions: [] } }); },
    async migrationStatus() { return ok({ current: true, appliedVersions: [], pendingVersions: [] }); },
    read(context, work) { return serialized(() => work(store.state)); },
    transaction(context, work) {
      return serialized(async () => {
        const state = store.state;
        const draft = { ...state, tables: Object.fromEntries(Object.entries(state.tables).map(([name, rows]) => [name, rows.slice()])) };
        const { commit, outcome } = await work(draft);
        if (commit) {
          const indexedLast = draft.tables.event_receipts[receiptIndex.count - 1];
          store.state = draft;
          // Normalization preserves every receipt position; follow its replacement without rebuilding the index.
          if (indexedLast === receiptIndex.last) receiptIndex.last = store.state.tables.event_receipts[receiptIndex.count - 1];
        }
        return outcome;
      });
    },
    async close() { return ok({ closed: true }); },
  }));
}
