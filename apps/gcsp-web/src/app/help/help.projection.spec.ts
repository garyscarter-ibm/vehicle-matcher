import { describe, expect, it } from 'vitest';
import { caseReadNotice, projectHelp } from './help.projection';
import type { CaseRecord, CaseScope } from '../cases/case.types';

const scope: CaseScope = { audience: 'employee', runId: 'run-1', employeeId: 'paula' };
const at = '2026-11-14T10:00:00Z';
const ok = (value: unknown) => ({ status: 'ok', value });
const help = ok({ opensCase: false, ownerRole: 'scheme-team', extensionPermitted: false, nextAction: 'Ask for help.',
  automaticRecoveryPriority: false, policyVersion: 'policy-1', assumptions: [{ key: 'renewalCase.owner.role', value: 'scheme-team' }] });
const row: CaseRecord = { caseId: 'renewal-12345678', runId: 'run-1', employeeId: 'paula', renewalId: 'renewal-1',
  owner: { role: 'scheme-team', name: 'Scheme team' }, status: 'open', reason: 'Help with renewal', trigger: { type: 'employee-request' },
  nextAction: 'Review renewal', dueAt: at, openedAt: at, lastUpdatedAt: at, renewalDeadline: null, renewalDeadlineState: 'unknown',
  policyVersion: 'policy-1', history: [], remedy: null, fictional: true, version: 1 };
const cases = (rows: readonly CaseRecord[] = [row]) => ok({ cases: rows, asOf: at, policyVersion: 'policy-1' });

describe('pure employee help composition', () => {
  it('distinguishes successful empty help from loading and retains actual policy instead of creating a case', () => {
    expect(projectHelp({ scope, help, cases: cases([]) })).toMatchObject({ state: 'empty', cases: [],
      help: { opensCase: false, ownerRole: 'scheme-team', extensionPermitted: false }, failure: null, notice: null });
    expect(projectHelp({ scope, help: null, cases: null })).toEqual({ state: 'not-loaded', help: null, cases: [], failure: null, notice: null });
  });

  it('projects current owned cases without exposing an action or fabricating a confirmation state', () => {
    const value = projectHelp({ scope, help, cases: cases() });
    expect(value).toMatchObject({ state: 'ready', cases: [{ caseId: row.caseId, owner: 'Scheme team', employee: null }] });
    expect(value).not.toHaveProperty('canSubmit');
    expect(value.cases[0].source).not.toHaveProperty('relaxation');
  });

  it.each(['help', 'cases'] as const)('clears all private displayed cases when %s is denied', (key) => {
    const denied = { status: 'forbidden', code: 'not-resource-owner', reason: 'This is not your case.', retryable: false, value: { cases: [row] } };
    const input = { scope, help, cases: cases(), [key]: denied };
    expect(projectHelp(input)).toEqual({ state: 'refused', help: null, cases: [],
      failure: { status: 'forbidden', code: 'not-resource-owner', reason: 'This is not your case.', retryable: false },
      notice: { title: 'You cannot open these cases', text: 'This is not your case.' } });
  });

  it('prefers definite access loss over another loading read and never presents an unavailable list as empty', () => {
    const failure = { status: 'unauthenticated', code: 'token-expired', reason: 'Sign in again.', retryable: false };
    expect(projectHelp({ scope, help: null, cases: failure })).toMatchObject({ state: 'refused', cases: [], notice: { title: 'Sign in to continue' } });
    expect(projectHelp({ scope, help, cases: { ...failure, status: 'unavailable', code: 'case-unavailable' } }).state).toBe('refused');
    expect(projectHelp({ scope, help, cases: ok({ cases: [] }) }).state).toBe('invalid-response');
  });

  it('clears mismatched account/run data and rejects using employee help as Greg or presenter', () => {
    expect(projectHelp({ scope, help, cases: cases([{ ...row, employeeId: 'someone-else' }]) })).toMatchObject({ state: 'scope-mismatch', help: null, cases: [] });
    expect(projectHelp({ scope: { audience: 'scheme-team', runId: 'run-1' }, help, cases: cases() })).toMatchObject({ state: 'scope-mismatch', cases: [] });
    expect(projectHelp({ scope: { audience: 'presenter', runId: 'run-1' } as unknown as CaseScope, help, cases: cases() }).state).toBe('scope-mismatch');
  });

  it('preserves uncertainty and stale outcomes as supplied reasons requiring current readback', () => {
    const uncertain = { status: 'unavailable' as const, code: 'outcome-uncertain', reason: 'The change may or may not have completed.', retryable: false, operationId: 'operation-1' };
    expect(projectHelp({ scope, help, cases: uncertain })).toMatchObject({ state: 'refused', cases: [], failure: uncertain,
      notice: { title: 'Check the current case', text: uncertain.reason } });
    expect(caseReadNotice({ state: 'refused', value: null, refusal: { status: 'stale-version', code: 'stale-version',
      reason: 'Refresh and review again.', retryable: false, action: 'refresh', expectedVersion: 1, currentVersion: 2 } }))
      .toEqual({ title: 'The case or your preferences have changed', text: 'Refresh and review again.' });
  });
});
