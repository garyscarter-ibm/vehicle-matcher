import { describe, expect, it } from 'vitest';
import { carOptionNames, caseRoleLabel, caseTime, parseCaseDetail, parseCaseHelp, parseCaseList, parseCaseOptions,
  projectCase, sortCases } from './case.projection';
import type { CaseOptions, CaseRecord, CaseScope } from './case.types';

const employee: CaseScope = { audience: 'employee', runId: 'run-1', employeeId: 'paula' };
const greg: CaseScope = { audience: 'scheme-team', runId: 'run-1' };
const at = '2026-07-14T10:00:00.123456789Z';
const ok = (value: unknown) => ({ status: 'ok', value });
const row = (changes: Partial<CaseRecord> = {}): CaseRecord => ({ caseId: 'renewal-12345678-abcd', runId: 'run-1',
  employeeId: 'paula', employeeName: 'Paula Mason', renewalId: 'renewal-1', owner: { role: 'scheme-team', name: 'Scheme team' },
  status: 'open', reason: 'My renewal needs attention.', trigger: { type: 'employee-request' }, nextAction: 'Review the renewal.',
  dueAt: at, openedAt: at, lastUpdatedAt: at, renewalDeadline: '2026-08-01', renewalDeadlineState: 'known', policyVersion: 'policy-1',
  history: [{ at, actorId: 'paula', actorRole: 'employee', status: 'open', reason: 'Original request', nextAction: 'Review the renewal.', dueAt: at, remedy: null }],
  remedy: null, fictional: true, version: 1, ...changes });
const list = (cases: readonly CaseRecord[] = [row()]) => ok({ cases, asOf: at, policyVersion: 'policy-1' });
const options = (changes: Partial<CaseOptions> = {}): CaseOptions => ({ case: row(), nextStatuses: ['in-progress', 'closed'],
  asOf: at, policyVersion: 'policy-1', automaticRecoveryPriority: false, options: {
    alternativeCars: { available: false, items: [], needsConfirmation: [], reason: 'Suitability is not connected.' },
    preferenceRelaxations: { available: false, items: [], reason: 'A recorded decline is required.' },
    laterRelease: { available: false, items: [], reason: 'No reviewed future release is recorded.' },
    manualDecision: { available: true, type: 'manual-decision', requiresDecision: true },
    contractExtension: { available: false, type: 'contract-extension', contractEndDate: null, requiresUntil: true, reason: 'Policy does not permit extension.' },
  }, ...changes });

describe('Java case/help source contracts and frozen display projection', () => {
  it('accepts the actual v1 list without a fabricated contract version, preserving nanosecond wire time and provenance', () => {
    const result = parseCaseList(list(), employee);
    expect(result).toMatchObject({ state: 'ready', replayed: false, value: { asOf: at, cases: [{ version: 1, fictional: true }] } });
    if (result.state !== 'ready') throw new Error('Expected a valid list');
    expect(result.value).not.toHaveProperty('contractVersion');
    expect(result.value.cases[0]).not.toHaveProperty('schemaVersion');
    expect(result.value.cases[0].dueAt).toBe(at);
  });

  it('distinguishes not loaded, proven empty, malformed rows and duplicate case identities', () => {
    expect(parseCaseList(null, employee).state).toBe('not-loaded');
    expect(parseCaseList(list([]), employee)).toMatchObject({ state: 'ready', value: { cases: [] } });
    for (const value of [[], { status: 'ok', value: { cases: [] } }, list([row(), row()]),
      list([row({ version: 0 })]), list([row({ version: Number.MAX_SAFE_INTEGER + 1 })]),
      list([row({ renewalDeadline: '2026-02-30' })]), list([row({ dueAt: '2026-07-14T10:00:00' })]),
      list([row({ status: 'invented' as CaseRecord['status'] })])]) {
      expect(parseCaseList(value, employee)).toEqual({ state: 'invalid-response', value: null });
    }
  });

  it('checks the whole private list against employee/run scope but lets Greg see different employees in this run', () => {
    const mixed = list([row(), row({ caseId: 'another-case', employeeId: 'another', employeeName: 'Another employee' })]);
    expect(parseCaseList(mixed, employee)).toEqual({ state: 'scope-mismatch', value: null });
    expect(parseCaseList(mixed, greg).state).toBe('ready');
    expect(parseCaseList(list([row({ runId: 'retired-run' })]), greg).state).toBe('scope-mismatch');
    expect(parseCaseList(list(), { audience: 'presenter', runId: 'run-1' } as unknown as CaseScope).state).toBe('scope-mismatch');
    expect(parseCaseList(list([row({ employeeName: undefined })]), greg).state).toBe('scope-mismatch');
  });

  it('supports both exact GET and command readback shapes without inferring success from a failed command', () => {
    expect(parseCaseDetail({ ...ok({ case: row() }), replayed: true }, employee, row().caseId)).toMatchObject({ state: 'ready', replayed: true });
    expect(parseCaseDetail(ok({ case: row(), asOf: at, policyVersion: 'policy-1' }), employee).state).toBe('ready');
    expect(parseCaseDetail(ok({ case: row(), asOf: at }), employee).state).toBe('invalid-response');
    expect(parseCaseDetail(ok({ case: row() }), employee, 'another-case').state).toBe('scope-mismatch');
    expect(parseCaseDetail({ ...ok({ case: row() }), replayed: false }, employee).state).toBe('invalid-response');
    expect(parseCaseDetail({ status: 'pending', value: { case: row() } }, employee).state).toBe('invalid-response');
  });

  it.each(['invalid', 'unauthenticated', 'forbidden', 'not-found', 'stale-version', 'conflict', 'unavailable'] as const)(
    'preserves %s refusal evidence and discards any attached private success payload', (status) => {
      const failure = { status, code: status, reason: 'Supplied server reason', retryable: false };
      expect(parseCaseList({ ...failure, value: { cases: [row()] }, case: row(), history: row().history }, employee))
        .toEqual({ state: 'refused', value: null, refusal: failure });
    });

  it('keeps stale versions, field reasons and uncertain operation identity distinct from saved/empty', () => {
    const stale = { status: 'stale-version', code: 'stale-version', reason: 'Refresh this case.', retryable: false,
      action: 'refresh', expectedVersion: 2, currentVersion: 3, reasons: [{ field: 'version', reason: 'It changed.' }] };
    expect(parseCaseList(stale, employee)).toEqual({ state: 'refused', value: null, refusal: stale });
    const uncertain = { status: 'unavailable', code: 'outcome-uncertain', reason: 'Check before retrying.', retryable: false, operationId: 'same-operation' };
    expect(parseCaseDetail({ ...uncertain, value: { case: row() } }, employee)).toEqual({ state: 'refused', value: null, refusal: uncertain });
    expect(parseCaseList({ ...stale, currentVersion: '3' }, employee).state).toBe('invalid-response');
    expect(parseCaseList({ ...stale, reasons: [{ reason: 'Missing field' }] }, employee).state).toBe('invalid-response');
  });

  it('retains server transition order and unavailable remedy reasons without manufacturing frontend permissions', () => {
    const source = options({ nextStatuses: ['closed'] });
    const result = parseCaseOptions(ok(source), greg, row().caseId);
    expect(result).toMatchObject({ state: 'ready', value: { nextStatuses: ['closed'], options: source.options } });
    expect(parseCaseOptions(ok(source), employee, row().caseId).state).toBe('scope-mismatch');
    expect(parseCaseOptions(ok(source), greg, 'another-case').state).toBe('scope-mismatch');
    const malformed = { ...source, options: { ...source.options, alternativeCars: { available: true, items: [], needsConfirmation: [] } } };
    expect(parseCaseOptions(ok(malformed), greg, row().caseId).state).toBe('invalid-response');
    expect(parseCaseOptions(ok({ ...source, nextStatuses: ['closed', 'closed'] }), greg, row().caseId).state).toBe('invalid-response');
  });

  it('preserves exact car identities, pending confirmation evidence and reviewed future-release source', () => {
    const source = options();
    const value: CaseOptions = { ...source, options: { ...source.options,
      alternativeCars: { available: true, items: [{ type: 'alternative-car', orderUuid: 'exact-stock-1' }],
        needsConfirmation: [{ type: 'alternative-car', orderUuid: 'exact-stock-2', unknowns: [{ field: 'timing' }] }] },
      laterRelease: { available: true, items: [{ type: 'later-release', releaseAt: '2026-07-15T10:00:00Z', source: 'Reviewed source record' }] } } };
    const result = parseCaseOptions(ok(value), greg, row().caseId);
    expect(result).toMatchObject({ state: 'ready', value: { options: value.options } });
    expect(parseCaseOptions(ok({ ...value, options: { ...value.options,
      alternativeCars: { ...value.options.alternativeCars, needsConfirmation: [{ type: 'alternative-car', orderUuid: 'exact-stock-2' }] } } }), greg, row().caseId).state)
      .toBe('invalid-response');
  });

  it('requires the actual help policy flags and employee authority, without enabling extension by default', () => {
    const value = { opensCase: false, ownerRole: 'scheme-team', extensionPermitted: false, nextAction: 'Ask for help.',
      automaticRecoveryPriority: false, policyVersion: 'policy-1', assumptions: [] };
    expect(parseCaseHelp(ok(value), employee)).toMatchObject({ state: 'ready', value });
    for (const change of [{ opensCase: true }, { automaticRecoveryPriority: true }, { extensionPermitted: undefined }]) {
      expect(parseCaseHelp(ok({ ...value, ...change }), employee).state).toBe('invalid-response');
    }
    expect(parseCaseHelp(ok(value), greg).state).toBe('scope-mismatch');
  });

  it('uses the named owner, latest supplied update, employee-safe actors and audience-specific time without inventing missing facts', () => {
    const value = row({ reason: '', nextAction: '', dueAt: null, renewalDeadline: null,
      history: [...row().history, { ...row().history[0], actorId: 'greg-subject', actorRole: 'scheme-team', reason: 'We are reviewing this.' }] });
    const display = projectCase(value, employee)!;
    expect(display).toMatchObject({ owner: 'Scheme team', employee: null, reference: '12345678', status: 'Open' });
    expect(display.facts).toContainEqual({ label: 'Reason', value: 'Not supplied' });
    expect(display.facts).toContainEqual({ label: 'Latest update', value: 'We are reviewing this.' });
    expect(display.facts).toContainEqual({ label: 'Renewal deadline (calendar date)', value: 'Needs confirmation' });
    expect(display.history[0]).toContainEqual({ label: 'Actor', value: 'You' });
    expect(display.history[1]).toContainEqual({ label: 'Actor', value: 'Scheme team' });
    expect(caseTime(at, 'employee')).toBe('14 Jul 2026, 11:00');
    expect(caseTime(at, 'scheme-team')).toBe('2026-07-14 10:00:00.123 UTC');
    expect(projectCase(value, greg)!.history[1]).toContainEqual({ label: 'Actor', value: 'greg-subject' });
    expect(projectCase(value, { ...employee, runId: 'retired' })).toBeNull();
    expect(caseRoleLabel('new-owner-role')).toBe('New owner role');
  });

  it('shows recorded remedies and exact Greg references without treating a remedy as an employee confirmation', () => {
    const value = row({ status: 'resolved', remedy: { type: 'alternative-car', orderUuid: 'exact-stock' } });
    expect(projectCase(value, employee)!.remedy).toEqual({ title: 'Recorded remedy', facts: [{ label: 'Recorded car', value: 'Car details not supplied' }] });
    expect(projectCase(value, greg)!.remedy!.facts).toContainEqual({ label: 'Exact car reference', value: 'exact-stock' });
    const evidence = row({ remedy: { type: 'preference-relaxation', expectedBriefVersion: 4 } });
    expect(projectCase(evidence, employee)!.remedy).toEqual({ title: 'Proposed remedy', facts: [{ label: 'Remedy', value: 'Preference relaxation' }] });
    expect(projectCase(evidence, employee)).not.toHaveProperty('canConfirm');
  });

  it('matches frozen deadline/status ordering with deterministic case-id ties and no mutation', () => {
    const rows = [row({ caseId: 'z', status: 'closed', renewalDeadline: '2026-01-01' }), row({ caseId: 'b', status: 'in-progress' }),
      row({ caseId: 'a', status: 'in-progress' }), row({ caseId: 'd', status: 'open', renewalDeadline: null }),
      row({ caseId: 'c', status: 'remedy-proposed', renewalDeadline: '2026-07-01' })];
    expect(sortCases(rows).map((r) => r.caseId)).toEqual(['c', 'a', 'b', 'd', 'z']);
    expect(sortCases(rows, 'status').map((r) => r.caseId)).toEqual(['d', 'a', 'b', 'c', 'z']);
    expect(rows.map((r) => r.caseId)).toEqual(['z', 'b', 'a', 'd', 'c']);
  });

  it('disambiguates same-name exact cars using supplied known facts, then exact references', () => {
    const car = (orderUuid: string, colour?: string) => ({ orderUuid, snapshot: { display: { name: 'BMW i4' },
      facts: { colour: { status: colour ? 'known' : 'unknown', value: colour ?? null } } } });
    expect(carOptionNames([car('one', 'Blue'), car('two', 'Red')])).toEqual(['BMW i4, Blue', 'BMW i4, Red']);
    expect(carOptionNames([car('one'), car('two')])).toEqual(['BMW i4, reference one', 'BMW i4, reference two']);
    expect(carOptionNames([{ orderUuid: 'three' }])).toEqual(['Car details not supplied, reference three']);
  });
});
