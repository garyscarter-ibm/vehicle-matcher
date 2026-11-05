import { createRepository, createState, ok, result } from './core.js';

// Stores are explicitly injected so reopen persistence cannot hide a missing durable provider.
export function createMemoryStore() {
  return { state: createState(), queue: Promise.resolve() };
}
export function createMemoryRepository({ store, now, supportedTables } = {}) {
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
    async open() {
      return valid ? ok({ provider: 'memory', migrationStatus: { current: true, appliedVersions: [], pendingVersions: [] } })
        : result('invalid', { code: 'missing-store', reasons: [{ field: 'store', reason: 'Inject a memory store explicitly' }] });
    },
    async migrationStatus() { return ok({ current: true, appliedVersions: [], pendingVersions: [] }); },
    read(context, work) { return serialized(() => work(structuredClone(store.state))); },
    transaction(context, work) {
      return serialized(async () => {
        const snapshot = structuredClone(store.state);
        const { commit, outcome } = await work(snapshot);
        if (commit) store.state = snapshot;
        return outcome;
      });
    },
    async close() { return ok({ closed: true }); },
  });
}
