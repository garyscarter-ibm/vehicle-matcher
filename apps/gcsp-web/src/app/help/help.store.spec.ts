import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort } from '../auth/auth.port';
import type { ApplicationContext, SessionState } from '../auth/auth.port';
import { CaseClient } from '../cases/case.client';
import type { CaseClientResult, HelpCaseCommand } from '../cases/case.client';
import type { CaseDetailValue, CaseHelp, CaseList, CaseRecord } from '../cases/case.types';
import { HelpStore } from './help.store';

const at = '2026-11-14T12:00:00.000Z';
const context: ApplicationContext = { subject: 'paula-subject', environmentId: 'isolated', runId: 'run-1',
  employeeId: 'paula', roles: ['employee'], policyVersion: 'policy-1', capabilities: [] };
const help: CaseHelp = { opensCase: false, ownerRole: 'scheme-team', extensionPermitted: false,
  automaticRecoveryPriority: false, nextAction: 'Ask for help to open an owned renewal case.', policyVersion: 'policy-1', assumptions: [] };
function row(patch: Partial<CaseRecord> = {}): CaseRecord {
  return { caseId: 'renewal-12345678-current', runId: 'run-1', employeeId: 'paula', renewalId: 'renewal-1',
    owner: { role: 'scheme-team', name: 'Scheme team' }, status: 'open', reason: 'My renewal needs review.',
    trigger: { type: 'employee-request' }, nextAction: 'Review renewal', dueAt: at, openedAt: at, lastUpdatedAt: at,
    renewalDeadline: '2026-12-01', renewalDeadlineState: 'known', policyVersion: 'policy-1', history: [],
    remedy: null, fictional: true, version: 1, ...patch };
}
const ok = <T>(value: T): CaseClientResult<T> => ({ state: 'ready', value, replayed: false });
const list = (cases: readonly CaseRecord[] = []): CaseList => ({ cases, asOf: at, policyVersion: 'policy-1' });
const refused = (status: 'invalid' | 'forbidden' | 'unauthenticated' | 'stale-version' | 'conflict' | 'unavailable' | 'not-found'): CaseClientResult<never> =>
  ({ state: 'refused', value: null, refusal: { status, code: status, reason: 'Read the current case before continuing.', retryable: status === 'unavailable' } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const fakeClient = () => ({
  readHelp: vi.fn<CaseClient['readHelp']>().mockResolvedValue(ok(help)),
  readOwnCases: vi.fn<CaseClient['readOwnCases']>().mockResolvedValue(ok(list())),
  readOwnCase: vi.fn<CaseClient['readOwnCase']>().mockResolvedValue(ok({ case: row(), asOf: at, policyVersion: 'policy-1' })),
  prepareHelp: vi.fn<CaseClient['prepareHelp']>().mockImplementation(input => Object.freeze({ kind: 'request-help', input: Object.freeze({ ...input }) })),
  requestHelp: vi.fn<CaseClient['requestHelp']>().mockResolvedValue(ok({ case: row() })),
  readQueue: vi.fn(), readOptions: vi.fn(), updateCase: vi.fn(),
});

describe('employee HelpStore intent, readback and privacy boundary', () => {
  let state = signal<SessionState>({ status: 'ready', context });
  let client = fakeClient();
  let store: HelpStore;
  let auth: { state: typeof state; signIn: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}` });
    state = signal<SessionState>({ status: 'ready', context });
    client = fakeClient();
    auth = { state, signIn: vi.fn(async () => {}), retry: vi.fn(async () => {}) };
    TestBed.configureTestingModule({ providers: [HelpStore, { provide: AuthPort, useValue: auth }, { provide: CaseClient, useValue: client }] });
    store = TestBed.inject(HelpStore);
    TestBed.flushEffects();
  });
  afterEach(() => { store?.dispose(); TestBed.resetTestingModule(); vi.unstubAllGlobals(); });
  async function ready(): Promise<void> { await vi.waitFor(() => expect(['ready', 'empty']).toContain(store.view().phase)); }
  function review(reason = 'My renewal needs review.'): HelpCaseCommand {
    store.beginRequest(); store.setReason(reason); store.reviewRequest();
    const command = client.prepareHelp.mock.results.at(-1)?.value;
    if (!command || 'state' in command) throw new Error('No reviewed command');
    return command;
  }

  it('loads guidance and a proven empty list; Ask, review and cancel never POST', async () => {
    await ready();
    expect(store.view()).toMatchObject({ phase: 'empty', help, cases: [], canAsk: true });
    expect(client.prepareHelp).not.toHaveBeenCalled();
    review('  Please review my renewal.  ');
    expect(store.view().reviewReason).toBe('Please review my renewal.');
    store.cancelRequest();
    expect(store.view()).toMatchObject({ reviewReason: null, editing: false, canAsk: true });
    expect(client.requestHelp).not.toHaveBeenCalled();
    expect(client.readQueue).not.toHaveBeenCalled(); expect(client.readOptions).not.toHaveBeenCalled(); expect(client.updateCase).not.toHaveBeenCalled();
  });
  it('validates empty and overlong reasons before preparing a command', async () => {
    await ready(); store.beginRequest();
    for (const reason of ['   ', 'x'.repeat(2001)]) {
      store.setReason(reason); store.reviewRequest();
      expect(store.view().error).toContain('1 to 2,000');
      expect(client.prepareHelp).not.toHaveBeenCalled();
    }
    store.setReason('x'.repeat(2000)); store.reviewRequest();
    expect(store.view().reviewReason).toHaveLength(2000);
    expect(client.requestHelp).not.toHaveBeenCalled();
  });
  it('guards duplicate confirm and shows the current exact-case readback after acknowledgement', async () => {
    await ready(); const command = review();
    const response = deferred<CaseClientResult<CaseDetailValue>>();
    client.requestHelp.mockReturnValueOnce(response.promise);
    client.readOwnCases.mockResolvedValue(ok(list([row()])));
    client.readOwnCase.mockResolvedValue(ok({ case: row({ version: 2, status: 'in-progress', nextAction: 'Review the recorded remedy.' }), asOf: at, policyVersion: 'policy-1' }));
    const saving = store.confirm();
    expect(store.view().pending).toBe(true); store.cancelRequest();
    expect(await store.confirm()).toBe(false);
    expect(client.requestHelp).toHaveBeenCalledOnce();
    expect(client.requestHelp.mock.calls[0][0]).toBe(command);
    response.resolve(ok({ case: row() })); await saving;
    expect(store.view()).toMatchObject({ phase: 'ready', recorded: true, pending: false, draft: '', reviewReason: null });
    expect(store.view().cases[0].source).toMatchObject({ version: 2, status: 'in-progress' });
    expect(client.readOwnCase.mock.calls[0][0]).toBe(row().caseId);
  });
  it('does not replace a newer list row with an older exact read', async () => {
    await ready(); review();
    client.readOwnCases.mockResolvedValue(ok(list([row({ version: 4, status: 'resolved' })])));
    await store.confirm();
    expect(store.view().cases[0].source.version).toBe(4);
  });
  it('distinguishes a recorded POST from a failed current readback', async () => {
    await ready(); review();
    client.readOwnCase.mockResolvedValue(refused('unavailable'));
    await store.confirm();
    expect(store.view()).toMatchObject({ recorded: true, phase: 'unavailable', cases: [], reviewReason: null });
    expect(store.view().message).toContain('was recorded. Current case information is unavailable');
    expect(client.requestHelp).toHaveBeenCalledOnce();
    await store.refresh(); expect(client.requestHelp).toHaveBeenCalledOnce();
  });
  it('uses a new intent ID for a later deliberate request with the identical reason', async () => {
    await ready(); const first = review(); await store.confirm();
    const second = review(); await store.confirm();
    expect(first.input.reason).toBe(second.input.reason);
    expect(first.input.commandId).not.toBe(second.input.commandId);
    expect(client.requestHelp.mock.calls.map(call => call[0])).toEqual([first, second]);
  });
  it('requires readback before explicit same-object retry and never infers commitment from matching history', async () => {
    await ready(); const command = review();
    client.requestHelp.mockResolvedValueOnce({ state: 'failed', problem: 'timeout', value: null, writeOutcome: 'unknown' });
    await store.confirm();
    expect(store.view()).toMatchObject({ uncertain: true, canRetry: false, recorded: false, cases: [] });
    expect(await store.retryRequest()).toBe(false); expect(await store.confirm()).toBe(false);
    client.readOwnCases.mockResolvedValue(ok(list([row({ history: [{ at, actorId: 'paula', actorRole: 'employee',
      status: 'open', reason: command.input.reason, nextAction: 'Review renewal', dueAt: at, remedy: null }] })])));
    await store.refresh();
    expect(store.view()).toMatchObject({ uncertain: true, canRetry: true, recorded: false, canAsk: false, canConfirm: false });
    expect(store.view().message).toContain('unknown outcome');
    expect(client.requestHelp).toHaveBeenCalledOnce();
    await store.retryRequest();
    expect(client.requestHelp.mock.calls[1][0]).toBe(command);
    expect(store.view().recorded).toBe(true);
  });
  it('preserves an unknown intent through a failed check, with retry disabled until a successful check', async () => {
    await ready(); const command = review();
    client.requestHelp.mockResolvedValueOnce({ state: 'refused', value: null, writeOutcome: 'unknown', refusal: {
      status: 'unavailable', code: 'outcome-uncertain', reason: 'Check current state.', retryable: false, operationId: 'operation-1' } });
    await store.confirm();
    client.readHelp.mockResolvedValueOnce(refused('unavailable'));
    await store.refresh();
    expect(store.view()).toMatchObject({ uncertain: true, canRetry: false, draft: command.input.reason });
    expect(client.requestHelp).toHaveBeenCalledOnce();
    await store.refresh(); await store.retryRequest();
    expect(client.requestHelp.mock.calls[1][0]).toBe(command);
  });
  it.each(['invalid-response', 'scope-mismatch'] as const)('treats dispatched %s honestly and clears scope loss', async resultState => {
    await ready(); review();
    client.requestHelp.mockResolvedValueOnce({ state: resultState, value: null, writeOutcome: 'unknown' });
    await store.confirm();
    expect(store.view().recorded).toBe(false);
    expect(store.view().uncertain).toBe(resultState !== 'scope-mismatch');
    if (resultState === 'scope-mismatch') expect(store.view()).toMatchObject({ draft: '', reviewReason: null, cases: [] });
  });
  it('preserves the draft after a known not-sent failure and requires another review', async () => {
    await ready(); review();
    client.requestHelp.mockResolvedValueOnce({ state: 'failed', problem: 'configuration-unavailable', value: null, writeOutcome: 'not-sent' });
    await store.confirm();
    expect(store.view()).toMatchObject({ draft: 'My renewal needs review.', editing: true, reviewReason: null, uncertain: false });
    expect(store.view().message).not.toContain('recorded');
    await store.refresh(); store.reviewRequest();
    expect(client.requestHelp).toHaveBeenCalledOnce(); expect(store.view().canConfirm).toBe(true);
  });
  it.each(['stale-version', 'conflict'] as const)('invalidates the obsolete %s review until refresh and a new review', async status => {
    await ready(); const previous = review(); client.requestHelp.mockResolvedValueOnce(refused(status));
    await store.confirm();
    expect(store.view()).toMatchObject({ phase: 'stale', reviewReason: null, cases: [], canConfirm: false });
    await store.refresh();
    expect(store.view().canConfirm).toBe(false);
    const next = review(); expect(next.input.commandId).not.toBe(previous.input.commandId);
  });
  it('clears denial immediately and aborts an uncooperative sibling read', async () => {
    await ready(); review('Private draft.');
    const late = deferred<CaseClientResult<CaseList>>();
    client.readHelp.mockResolvedValueOnce(refused('forbidden'));
    client.readOwnCases.mockReturnValueOnce(late.promise);
    const reading = store.refresh();
    await vi.waitFor(() => expect(store.view().phase).toBe('denied'));
    expect(store.view()).toMatchObject({ draft: '', reviewReason: null, help: null, cases: [] });
    expect(client.readOwnCases.mock.calls.at(-1)?.[0]?.signal?.aborted).toBe(true);
    late.resolve(ok(list([row()]))); await reading;
    expect(store.view().cases).toEqual([]); expect(client.requestHelp).not.toHaveBeenCalled();
  });
  it.each(['subject', 'environmentId', 'runId', 'employeeId', 'policyVersion', 'roles'] as const)('clears private state and aborts pending work on %s replacement', async field => {
    await ready(); review('Private reason.');
    const late = deferred<CaseClientResult<CaseDetailValue>>(); client.requestHelp.mockReturnValueOnce(late.promise);
    const saving = store.confirm();
    const value = field === 'roles' ? ['greg'] : `new-${field}`;
    state.set({ status: 'ready', context: { ...context, [field]: value } as ApplicationContext });
    expect(store.view()).toMatchObject({ draft: '', reviewReason: null, cases: [], canConfirm: false });
    TestBed.flushEffects();
    expect(client.requestHelp.mock.calls[0][1]?.signal?.aborted).toBe(true);
    late.resolve(ok({ case: row() })); expect(await saving).toBe(false);
    expect(store.view().recorded).toBe(false);
  });
  it('does not revive an old prepared intent after A -> B -> a new ready A', async () => {
    await ready(); review();
    state.set({ status: 'ready', context: { ...context, subject: 'other' } });
    TestBed.flushEffects();
    state.set({ status: 'ready', context: { ...context } }); TestBed.flushEffects();
    await ready();
    expect(store.view()).toMatchObject({ draft: '', reviewReason: null, canConfirm: false, canRetry: false });
    expect(await store.confirm()).toBe(false); expect(client.requestHelp).not.toHaveBeenCalled();
  });
  it.each(['signed-out', 'denied', 'unavailable', 'loading'] as const)('removes all private fields immediately while auth is %s', async status => {
    await ready(); review('Private reason.');
    state.set({ status, message: 'Account unavailable.', retryable: true } as SessionState);
    expect(store.view()).toMatchObject({ draft: '', reviewReason: null, cases: [], help: null, canConfirm: false });
    TestBed.flushEffects(); expect(client.requestHelp).not.toHaveBeenCalled();
  });
  it('drops a denied command and never auto-submits after explicit authentication recovery', async () => {
    await ready(); review(); client.requestHelp.mockResolvedValueOnce(refused('unauthenticated'));
    await store.confirm();
    expect(store.view()).toMatchObject({ phase: 'auth-required', draft: '', reviewReason: null });
    await store.signIn(); expect(auth.signIn).toHaveBeenCalledWith('/gcsp/help');
    state.set({ status: 'ready', context: { ...context } }); TestBed.flushEffects(); await ready();
    expect(client.requestHelp).toHaveBeenCalledOnce(); expect(store.view().canConfirm).toBe(false);
  });
  it('does not turn read failures or foreign rows into an empty success', async () => {
    await ready(); client.readHelp.mockResolvedValueOnce(refused('unavailable'));
    await store.refresh(); expect(store.view()).toMatchObject({ phase: 'unavailable', cases: [], help: null, canAsk: false });
    client.readOwnCases.mockResolvedValueOnce(ok(list([row({ employeeId: 'another-employee' })])));
    await store.refresh(); expect(store.view()).toMatchObject({ phase: 'stale', cases: [], draft: '' });
  });
  it('clears and aborts a destroyed body; late acknowledged results cannot reload or repaint', async () => {
    await ready(); review();
    const late = deferred<CaseClientResult<CaseDetailValue>>(); client.requestHelp.mockReturnValueOnce(late.promise);
    const saving = store.confirm(); const reads = client.readOwnCases.mock.calls.length;
    store.dispose();
    expect(client.requestHelp.mock.calls[0][1]?.signal?.aborted).toBe(true);
    late.resolve(ok({ case: row() })); expect(await saving).toBe(false);
    expect(store.view()).toMatchObject({ cases: [], draft: '', reviewReason: null, recorded: false });
    expect(client.readOwnCases).toHaveBeenCalledTimes(reads);
  });
});
