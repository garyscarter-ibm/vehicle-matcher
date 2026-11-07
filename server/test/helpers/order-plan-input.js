// Explicit alternative resolved forecast and policy, not the canonical default producer.
export function planningInput() {
  return {
    runId: 'planning-test', asOf: '2026-11-06T00:00:00.000Z',
    versions: { forecast: 'explicit-joint-v1', policy: 'alternative-policy-v1', stock: 'stock-v1', supply: 'supply-v1', cohort: 'cohort-v1', catalog: 'catalog-v1' },
    forecast: { basis: 'explicit-alternative', horizonEnd: '2026-12-06T00:00:00.000Z', limitations: ['Synthetic joint choices for kernel validation.'], entitlements: [
      { entitlementId: 'flexible', employeeId: 'employee-a', renewalId: 'renewal-a', entitlementSlotId: 'slot-a', renewalAt: '2026-11-26T00:00:00.000Z', acceptableDerivativeIds: ['a', 'b'], gates: [] },
      { entitlementId: 'single', employeeId: 'employee-b', renewalId: 'renewal-b', entitlementSlotId: 'slot-b', renewalAt: '2026-11-26T00:00:00.000Z', acceptableDerivativeIds: ['a'], gates: [] },
    ] },
    catalog: [{ derivativeId: 'a', modelId: 'model-a', unitCostMinor: 10, leadTimeDays: 10 }, { derivativeId: 'b', modelId: 'model-b', unitCostMinor: 8, leadTimeDays: 10 }],
    stock: [], inbound: [], constraints: { horizonDays: 30, budgetMinor: 20, currency: 'GBP',
      modelBounds: [{ modelId: 'model-a', min: 0, max: 2 }, { modelId: 'model-b', min: 0, max: 2 }],
      derivativeBounds: [{ derivativeId: 'a', min: 0, max: 2 }, { derivativeId: 'b', min: 0, max: 2 }],
      objectiveWeights: { coverage: 100, unallocatedStock: 10, costMinor: 0 } },
  };
}
