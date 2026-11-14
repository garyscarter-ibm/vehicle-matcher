import { isDeepStrictEqual } from 'node:util';
import { cloneJson, createRepository, createState, isScopeMiss, ok, TABLES } from '../../gcsp/repository/core.js';

// FUCQ-424 oracle: a declared transaction first runs on only runs plus its declared keys, then on the full
// state, which alone commits. Records scope misses and any partial/full difference, so declarations are proven.
export function createStrictScopeRepository() {
  let state = createState(); let stamp; let queue = Promise.resolve();
  const report = { scoped: [], misses: [], differences: [] };
  const id = (table, key) => JSON.stringify([table, ...TABLES[table].key.map((field) => key[field])]);
  const serialized = (work) => { const next = queue.then(work); queue = next.catch(() => {}); return next; };
  const partialOf = (scope) => {
    const ids = new Set(scope.map(({ table, key }) => id(table, key))); const partial = createState();
    partial.tables.runs = cloneJson(state.tables.runs);
    for (const table of new Set(scope.map((ref) => ref.table))) partial.tables[table] = cloneJson(state.tables[table].filter((row) => ids.has(id(table, row))));
    return Object.assign(partial, { scope });
  };
  const repository = createRepository({
    now: () => stamp,
    async open() { return ok({ provider: 'strict-scope' }); },
    async migrationStatus() { return ok({ current: true }); },
    read(context, work) { return serialized(() => work(cloneJson(state))); },
    transaction(context, work, scope) {
      return serialized(async () => {
        stamp = new Date().toISOString();
        let partial;
        const commandId = scope?.find((ref) => ref.key.consumerId === 'command:transaction')?.key.eventId;
        if (scope) {
          report.scoped.push(commandId);
          try { partial = await work(partialOf(scope)); } catch (error) { if (!isScopeMiss(error)) throw error; report.misses.push(commandId); }
        }
        const draft = cloneJson(state);
        const done = await work(draft);
        if (partial && !isDeepStrictEqual(partial, done)) report.differences.push(commandId);
        if (done.commit) state = draft;
        return done.outcome;
      });
    },
    async close() { return ok({ closed: true }); },
  });
  return { repository, report };
}
