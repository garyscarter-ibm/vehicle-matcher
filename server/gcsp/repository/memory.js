import { cloneJson, createReceiptIndex, createRepository, createState, ok, result, sealState as seal, shallowState as shallowCopy } from './core.js';

// Stores are explicitly injected so reopen persistence cannot hide a missing durable provider.
export function createMemoryStore() {
  return { state: createState(), queue: Promise.resolve() };
}
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
