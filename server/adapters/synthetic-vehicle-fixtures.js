/** Tiny adapter inputs, explicitly fictional. No VIN, finance policy or authoritative fitted-equipment claim. */
import { createVehicleSnapshot, freezeVehicleData } from '../vehicles/index.js';

export function syntheticVehicleFixtures() {
  const observedAt = '2026-11-01T12:00:00.000Z';
  const fact = (value, unit = null) => ({ status: value === null ? 'unknown' : 'known', value, unit,
    provenance: { sourceRef: 'fixture:vehicle-facts-v1', observedAt, version: 'fixture-v1',
      assurance: value === null ? 'unknown' : 'synthetic-scenario' } });
  return freezeVehicleData([
    ['fixture-stock-001', 'Synthetic 3 Series Touring', 500, true],
    ['fixture-stock-002', 'Synthetic i4', 470, null],
  ].map(([stockId, name, boot, rearIsofix]) => createVehicleSnapshot({
    sourceNamespace: 'synthetic/vehicle-facts-v1', identityKind: 'exact-stock', sourceKeys: { stockId },
    snapshotVersion: 'fixture-v1', observedAt, display: { name },
    facts: { seats: fact(5, 'count'), boot: fact(boot, 'L'), frontIsofix: fact(null), rearIsofix: fact(rearIsofix) },
  })));
}
