// Explicit read-only rendering snapshots. They supply no feasibility or mutation authority.
export const FIXTURE_NAMES = Object.freeze(['none', 'request', 'trigger', 'in-progress', 'waiting', 'resolved', 'closed', 'loading', 'unavailable', 'forbidden', 'stale-run']);
const now = '2026-11-05T12:00:00.000Z';
export function caseFixture(name = 'request') {
  const status = { waiting: 'remedy-proposed', resolved: 'resolved', closed: 'closed', 'in-progress': 'in-progress' }[name] ?? 'open';
  const reason = name === 'trigger' ? 'Your renewal deadline is approaching.' : 'My replacement may miss my contract end.';
  return { caseId: 'synthetic-renewal-paula', runId: 'synthetic-run', employeeId: 'synthetic-paula', employeeName: 'Paula Mason',
    renewalId: 'synthetic-renewal', version: 2, status, owner: { name: 'Scheme team', role: 'scheme-team' }, reason,
    trigger: { type: name === 'trigger' ? 'renewal-deadline' : 'employee-request' }, nextAction: 'Review the renewal options with Paula.',
    dueAt: '2026-11-06T12:00:00.000Z', renewalDeadline: '2026-11-20', openedAt: now, lastUpdatedAt: now, fictional: true,
    history: [{ at: now, actorId: 'synthetic-paula', actorRole: name === 'trigger' ? 'system' : 'employee', status: 'open', reason,
      nextAction: 'Scheme team to review your renewal.', dueAt: '2026-11-06T12:00:00.000Z' }],
    remedy: name === 'waiting' ? { type: 'preference-relaxation', decisionId: 'synthetic-decline', expectedBriefVersion: 3,
      path: 'preferences.body.value', value: 'suv', confirmationState: 'employee-confirmation-required' } : null,
    ...(name === 'waiting' ? { relaxation: { currentBriefVersion: 3, before: 'estate', applicable: true } } : {}) };
}
export function fixtureAdapter(name) {
  const refusal = { status: 'unavailable', code: 'read-only-visual-fixture', reason: 'This preview is read-only, so changes cannot be saved.' };
  return {
    async readHelp() { return { status: 'ok', value: { opensCase: false, automaticRecoveryPriority: false } }; },
    async readCases() {
      if (name === 'loading') return new Promise(() => {});
      if (['unavailable', 'forbidden', 'stale-run'].includes(name)) return { status: name };
      return { status: 'ok', value: { cases: name === 'none' ? [] : [caseFixture(name)], asOf: now, policyVersion: 'synthetic-policy' } };
    },
    requestHelp: async () => refusal, changeAfterDecline: async () => refusal,
  };
}
export const fixtureAccountAdapter = { async loadAccount() {
  return { status: 'ready', name: 'Paula Mason', context: 'Read-only preview' };
} };
