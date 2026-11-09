import { FilePolicyProvider, snapshotVersions, PolicySourceError } from './file-provider.js';
import { inputDigest } from '../repository/core.js';

export const createMemoryPolicyStore = () => ({ runs: new Map(), locks: new Map() });

export class MemoryPolicyProvider {
  #store; #seedProvider; #snapshots = new WeakMap();
  constructor({ store = createMemoryPolicyStore(), seedProvider = new FilePolicyProvider() } = {}) {
    this.#store = store; this.#seedProvider = seedProvider;
  }

  async #records(read) {
    if (!read?.runId) throw new PolicySourceError('source-invalid');
    if (!this.#store.runs.has(read.runId)) {
      const [seed] = snapshotVersions(await this.#seedProvider.loadVersions(read));
      if (!this.#store.runs.has(read.runId)) this.#store.runs.set(read.runId, [{ seed, seedDigest: inputDigest(seed),
        sourceVersion: seed.policyVersion, publisher: 'reviewed-repository-seed', publishedAt: seed.effectiveFrom }]);
    }
    return this.#store.runs.get(read.runId);
  }

  // publish replaces the run's records array, so a cached snapshot is current until then (PolicyService caches by identity).
  async loadVersions(read) {
    const records = await this.#records(read);
    if (this.#snapshots.has(records)) return this.#snapshots.get(records);
    const snapshot = snapshotVersions(records.map(({ seed }) => seed));
    this.#snapshots.set(records, snapshot);
    return snapshot;
  }

  async publish(read, build) {
    const previous = this.#store.locks.get(read.runId) ?? Promise.resolve();
    let release;
    const lock = new Promise((resolve) => { release = resolve; });
    this.#store.locks.set(read.runId, lock);
    await previous;
    try {
      const records = await this.#records(read);
      const prepared = await build(structuredClone(records));
      if (prepared.record) this.#store.runs.set(read.runId, [...records, structuredClone(prepared.record)]);
      return prepared.outcome;
    } finally {
      release();
      if (this.#store.locks.get(read.runId) === lock) this.#store.locks.delete(read.runId);
    }
  }

  async close() { return { status: 'ok', contractVersion: '1.0.0', policyVersion: null, value: { closed: true } }; }
}
