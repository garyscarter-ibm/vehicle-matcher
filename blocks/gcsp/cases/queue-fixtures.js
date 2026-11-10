import { caseFixture } from './fixtures.js';
// Explicit synthetic rendering snapshots, never feasibility or mutation authority.
export const QUEUE_FIXTURE_NAMES = Object.freeze(['populated', 'empty', 'loading', 'unavailable', 'forbidden', 'stale-run', 'unavailable-options']);
const now = '2026-11-05T12:00:00.000Z';
export function queueCaseFixtures() {
  return ['request', 'in-progress', 'waiting', 'resolved', 'closed'].map((name, index) => ({ ...caseFixture(name),
    caseId: `synthetic-case-${index}`, employeeId: `synthetic-employee-${index}`, employeeName: `Employee ${index + 1}`,
    renewalDeadline: `2026-11-${String(20 - index).padStart(2, '0')}` }));
}
export function queueOptionsFixture(c = queueCaseFixtures()[0]) {
  return { case: structuredClone(c), nextStatuses: ['in-progress', 'remedy-proposed'], asOf: now,
    policyVersion: 'synthetic-policy', automaticRecoveryPriority: false, options: {
      alternativeCars: { available: true, items: [{ type: 'alternative-car', orderUuid: 'synthetic-exact-car', configurationId: 'synthetic-configuration',
        snapshot: { display: { name: 'BMW iX1' } } }] },
      preferenceRelaxations: { available: true, items: [{ type: 'preference-relaxation', decisionId: 'synthetic-decline', expectedBriefVersion: 3,
        path: 'preferences.body.value', before: 'estate', valueType: 'enum', values: ['estate', 'suv'] },
      { type: 'preference-relaxation', decisionId: 'synthetic-decline', expectedBriefVersion: 3,
        path: 'preferences.range.value', before: 250, valueType: 'slider', minimum: 100, maximum: 400, unit: 'miles' }] },
      laterRelease: { available: true, items: [{ type: 'later-release', releaseAt: '2026-11-10T09:15:00.000Z', source: 'Reviewed release' }] },
      manualDecision: { available: true, type: 'manual-decision', requiresDecision: true },
      contractExtension: { available: true, type: 'contract-extension', contractEndDate: '2026-11-20', requiresUntil: true },
    } };
}
export function queueFixtureAdapter(name = 'populated') {
  const cases = queueCaseFixtures();
  const refusal = { status: 'unavailable', code: 'read-only-visual-fixture', reason: 'This preview is read-only, so changes cannot be saved.' };
  return {
    async listCases() {
      if (name === 'loading') return new Promise(() => {});
      if (['unavailable', 'forbidden', 'stale-run'].includes(name)) return { status: name };
      return { status: 'ok', value: { cases: name === 'empty' ? [] : structuredClone(cases), asOf: now, policyVersion: 'synthetic-policy' } };
    },
    async readOptions({ caseId }) {
      const c = cases.find((item) => item.caseId === caseId);
      if (!c) return { status: 'unavailable', reason: 'This case is not available.' };
      const value = queueOptionsFixture(c);
      if (name === 'unavailable-options') for (const key of ['alternativeCars', 'preferenceRelaxations', 'laterRelease', 'contractExtension'])
        value.options[key] = { available: false, reason: 'Not available yet.', items: [] };
      if (['resolved', 'closed'].includes(c.status)) value.nextStatuses = [];
      return { status: 'ok', value };
    },
    updateCase: async () => refusal,
  };
}
