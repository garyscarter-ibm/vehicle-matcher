// Explicit synthetic TEST input for the actual stock pull producer. This is not
// the BMW corpus, a default/reset profile, or a replacement repository writer.
import { createSyntheticStockProvider } from '../../gcsp/stock/index.js';
import { createVehicleSnapshot } from '../../vehicles/index.js';
import { result } from '../../gcsp/repository/index.js';

export function createCompositionTestProfile() {
  const profiles = new Map();
  const calls = [];
  return {
    calls,
    async prepare(runtime, context) {
      const authenticated = await runtime.identity.requireRole(context, 'employee');
      if (authenticated.status !== 'ok') throw Error('TEST preparation requires the real employee.');
      const account = await runtime.manualRead.readAccount(context);
      const time = await runtime.clock.now(context);
      if (account.status !== 'ok' || account.value.state !== 'ready' || time.status !== 'ok') {
        throw Error('TEST preparation requires the actual prepared manual context and clock.');
      }
      if (profiles.has(context.runId)) throw Error('TEST run profile is immutable after preparation.');
      const observedAt = time.value.now;
      const version = `TEST-composition:${context.runId}`;
      const fact = (value, unit = null) => ({ status: 'known', value, unit,
        provenance: { sourceRef: 'TEST:runtime-composition', observedAt, version, assurance: 'synthetic-scenario' } });
      const orderUuid = 'f1000000-0000-4000-8000-000000000001';
      const car = {
        orderUuid, orderNumber: '9100001', configurationId: 'RjcwOlMx', corpusVersion: 'TEST-only-v1', revision: 1,
        visibility: { companyIds: [context.companyId], schemeIds: [context.schemeId], employeeIds: [context.employeeId] },
        availability: { availableUntil: '2027-01-01T00:00:00.000Z' },
        facts: createVehicleSnapshot({ sourceNamespace: 'TEST:runtime-composition', identityKind: 'exact-stock',
          sourceKeys: { stockId: orderUuid }, snapshotVersion: version, observedAt,
          display: { name: 'Synthetic TEST composition car' }, facts: {
            eligibilityModelKey: fact('F70 Sports Hatch|120'), body: fact('hatch'), fuel: fact('petrol'),
            seats: fact(5, 'count'), boot: fact(380, 'L'), sizeClass: fact(2, 'ordinal-1-5'),
            insuranceGroup: fact(25, 'insurance-group'), zeroTo62: fact(7, 's'),
            mpg: fact(45, 'mpg-imperial'), tags: fact(['cruiser']),
          } }),
      };
      profiles.set(context.runId, createSyntheticStockProvider({ runId: context.runId, version,
        label: 'Synthetic TEST composition input; not F77/F78', windows: [{ windowId: 'TEST-noon',
          availableAt: '2026-11-05T12:00:00.000Z', supplyId: null, stock: [car] }] }));
      return structuredClone(car);
    },
    async pull(request) {
      calls.push({ runId: request.runId, eventId: request.eventId, asOf: request.asOf });
      return profiles.has(request.runId) ? profiles.get(request.runId).pull(request)
        : result('unavailable', { reason: 'No synthetic TEST input was prepared for this run.', retryable: true });
    },
  };
}
