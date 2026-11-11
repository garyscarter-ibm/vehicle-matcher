import { randomUUID } from 'node:crypto';
import { inputDigest, ok, OCCUPYING_STATES } from '../repository/index.js';
import { createVehicleSnapshot } from '../../vehicles/index.js';
import { modelBrowseFacts, DEMO_STOCK_NAMESPACE } from './demo-provider.js';

const VERSION = 'synthetic-model-facts-2026-11-11';
const OBSERVED_AT = '2026-11-11T00:00:00.000Z';
const NAMESPACES = new Set([DEMO_STOCK_NAMESPACE, 'synthetic:stock-generator.v1']);
const occupied = (row) => OCCUPYING_STATES.includes(row.state) || row.state === 'allocated';

// Persist new snapshots before fresh decisions: quotes and frozen allocation inputs
// must continue to match their stock facts exactly. Historical records are never enriched.
export async function upgradeRetainedModelFacts(tx, context, rows) {
  for (const table of ['stock', 'holds', 'claims', 'event_receipts']) {
    if (rows[table]) continue;
    const found = await tx.list(table); if (found.status !== 'ok') return found;
    rows[table] = found.value;
  }
  const protectedIds = new Set([...rows.holds, ...rows.claims].filter(occupied).map((row) => row.orderUuid));
  for (const receipt of rows.event_receipts.filter((row) => row.consumerId === 'buddy-allocation' && row.state === 'pending')) {
    const plan = receipt.outcome?.value?.plan;
    // Unknown retained plans fail closed. Supported legacy plans may have only contenders.
    if (!plan || plan.pool !== undefined && !Array.isArray(plan.pool)
      || plan.contenders !== undefined && !Array.isArray(plan.contenders)
      || !Array.isArray(plan.pool) && !Array.isArray(plan.contenders)) return ok({ repaired: 0 });
    for (const entry of [...(plan.pool ?? []), ...(plan.contenders ?? [])]) protectedIds.add(entry.orderUuid);
  }
  const changes = [];
  for (let index = 0; index < rows.stock.length; index += 1) {
    const row = rows.stock[index]; const snapshot = row.facts;
    if (!['available', 'released'].includes(row.state) || row.available !== true || row.held === true || row.allocated === true
      || protectedIds.has(row.orderUuid) || !NAMESPACES.has(snapshot?.sourceNamespace) || snapshot.identityKind !== 'exact-stock') continue;
    const key = snapshot.facts?.eligibilityModelKey;
    const reference = key?.status === 'known' ? modelBrowseFacts(key.value) : null;
    if (!reference) continue;
    const additions = Object.fromEntries(['zeroTo62', 'mpg'].filter((name) => reference[name]
      && (!snapshot.facts[name] || snapshot.facts[name].status === 'unknown')).map((name) => [name, {
      status: 'known', ...reference[name], provenance: {
        sourceRef: `docs/gcsp/stock-model-facts-2026-11-11.md#${encodeURIComponent(key.value)}`,
        observedAt: OBSERVED_AT, version: VERSION, assurance: 'synthetic-scenario',
      },
    }]));
    if (!Object.keys(additions).length) continue;
    const facts = createVehicleSnapshot({ ...snapshot, facts: { ...snapshot.facts, ...additions },
      snapshotVersion: `${snapshot.snapshotVersion}+${VERSION}:${inputDigest(additions).slice(0, 12)}` });
    const written = await tx.compareAndSwap({ table: 'stock', key: { runId: context.runId, orderUuid: row.orderUuid } }, row.version, { facts });
    if (written.status !== 'ok') return written;
    rows.stock[index] = written.value;
    changes.push({ orderUuid: row.orderUuid, fromVersion: row.version, toVersion: written.value.version,
      previousSnapshotVersion: snapshot.snapshotVersion, snapshotVersion: facts.snapshotVersion, added: Object.keys(additions) });
  }
  if (changes.length) {
    const recorded = await tx.insert('event_receipts', { runId: context.runId, consumerId: VERSION,
      eventId: inputDigest(changes), eventType: 'synthetic-stock-facts-upgraded', state: 'completed', outcome: ok({ version: VERSION, changes }) });
    if (recorded.status !== 'ok') return recorded;
  }
  return ok({ repaired: changes.length });
}

export async function adoptRetainedModelFacts({ repository, identity }) {
  const presenter = await identity.createPresenterSession(`${VERSION}:${randomUUID()}`);
  if (presenter.status !== 'ok') return presenter;
  const context = presenter.value.context;
  return repository.transaction(context, { commandId: `${VERSION}:${randomUUID()}`, inputDigest: inputDigest(VERSION) },
    (tx) => upgradeRetainedModelFacts(tx, context, {}));
}
