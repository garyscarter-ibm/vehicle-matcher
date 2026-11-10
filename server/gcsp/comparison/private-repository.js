import { setImmediate } from 'node:timers/promises';
import { createMemoryStore } from '../repository/memory.js';
import { createReceiptIndex, createRepository, ok, result } from '../repository/core.js';

function shareImmutableRows() {
  const normalized = new WeakMap(); const ids = new WeakMap(); const pool = new Map();
  let nextId = 0;
  const collected = new FinalizationRegistry(({ signature, reference }) => {
    if (pool.get(signature) === reference) pool.delete(signature);
  });
  const atom = (value) => value !== null && typeof value === 'object' ? ['reference', ids.get(value)]
    : [typeof value, Object.is(value, -0) ? '-0' : value];
  function intern(value) {
    if (value === null || typeof value !== 'object') return value;
    if (normalized.has(value)) return normalized.get(value);
    const array = Array.isArray(value); const keys = Object.keys(value);
    const children = keys.map((key) => intern(value[key]));
    const prototype = Object.getPrototypeOf(value);
    // Child IDs identify exact canonical values; ordered keys and typed primitives make this collision-free.
    const signature = JSON.stringify([array ? 'array' : prototype === null ? 'null-object' : 'object',
      keys.map((key, index) => [key, atom(children[index])])]);
    let canonical = pool.get(signature)?.deref();
    if (!canonical) {
      canonical = keys.every((key, index) => value[key] === children[index]) ? value
        : array ? [...children] : Object.fromEntries(keys.map((key, index) => [key, children[index]]));
      if (prototype === null && Object.getPrototypeOf(canonical) !== null) Object.setPrototypeOf(canonical, null);
      Object.freeze(canonical); ids.set(canonical, ++nextId);
      const reference = new WeakRef(canonical); pool.set(signature, reference);
      collected.register(canonical, { signature, reference });
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
