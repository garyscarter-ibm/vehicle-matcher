import { cloneJson, createReceiptIndex, createRepository, createState, ok, result } from './core.js';

// Stores are explicitly injected so reopen persistence cannot hide a missing durable provider.
export function createMemoryStore() {
  return { state: createState(), queue: Promise.resolve() };
}
const deepFreeze = (value) => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
};
// Committed state is deep-frozen, so a stray in-place write throws instead of leaking past a rollback.
const sealed = new WeakSet();
const seal = (state) => {
  if (sealed.has(state)) return state;
  for (const rows of Object.values(state.tables)) { if (!Object.isFrozen(rows)) { for (const row of rows) deepFreeze(row); Object.freeze(rows); } }
  Object.freeze(state.tables); Object.freeze(state); sealed.add(state);
  return state;
};
// Shared frozen rows; a transaction gets fresh table arrays and replaces rows rather than editing them.
const shallowCopy = (state) => ({ ...state, tables: Object.fromEntries(Object.entries(state.tables).map(([name, rows]) => [name, rows.slice()])) });
export function createMemoryRepository({ store, now, supportedTables, snapshot = 'shallow' } = {}) {
  // Rows are validated JSON. structuredClone's serializer buffers took start-up RSS past 512 MiB (FUCQ-190).
  const shallow = snapshot === 'shallow';
  const copy = shallow ? (state) => shallowCopy(seal(state)) : cloneJson;
  const valid = store && store.state?.tables && store.queue && typeof store.queue.then === 'function';
  const serialized = async (work) => {
    const predecessor = store.queue;
    let release;
    store.queue = new Promise((resolve) => { release = resolve; });
    await predecessor;
    try { return await work(); } finally { release(); }
  };
  return createRepository({
    now,
    supportedTables,
    // Deep snapshots copy every row, so only shared shallow rows can keep a receipt index between transactions.
    receiptIndex: shallow ? createReceiptIndex() : undefined,
    async open() {
      return valid ? ok({ provider: 'memory', migrationStatus: { current: true, appliedVersions: [], pendingVersions: [] } })
        : result('invalid', { code: 'missing-store', reasons: [{ field: 'store', reason: 'Inject a memory store explicitly' }] });
    },
    async migrationStatus() { return ok({ current: true, appliedVersions: [], pendingVersions: [] }); },
    // Reads only look up rows and return copies, so they can see frozen committed state directly.
    read(context, work) { return serialized(() => work(shallow ? seal(store.state) : copy(store.state))); },
    transaction(context, work) {
      return serialized(async () => {
        const draft = copy(store.state);
        const { commit, outcome } = await work(draft);
        if (commit) store.state = shallow ? seal(draft) : draft;
        return outcome;
      });
    },
    async close() { return ok({ closed: true }); },
  });
}
