import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, ApplicationContext, SessionState } from '../auth/auth.port';
import { CaseClient, CaseClientResult, UpdateCaseCommand } from './case.client';
import { CaseList, CaseOptions, CaseRecord, CaseRefusalStatus } from './case.types';
import { CaseQueueStore } from './case-queue.store';

const at = '2026-11-14T12:00:00.000Z';
const context: ApplicationContext = { subject: 'greg', environmentId: 'isolated', runId: 'run-1', roles: ['greg'], policyVersion: 'policy-1', capabilities: [] };
function row(patch: Partial<CaseRecord> = {}): CaseRecord {
  return { caseId: 'renewal-12345678-current', runId: 'run-1', employeeId: 'paula', employeeName: 'Paula', renewalId: 'renewal-1',
    owner: { role: 'scheme-team', name: 'Greg' }, status: 'open', reason: 'Renewal delayed', trigger: { type: 'employee-request' },
    nextAction: 'Review renewal', dueAt: '2026-11-15T12:00:00.000Z', openedAt: at, lastUpdatedAt: at, renewalDeadline: '2026-12-01',
    renewalDeadlineState: 'known', policyVersion: 'policy-1', history: [], remedy: null, fictional: true, version: 3, ...patch };
}
function options(record = row()): CaseOptions {
  return { case: record, nextStatuses: ['in-progress', 'closed'], asOf: at, policyVersion: 'policy-1', automaticRecoveryPriority: false,
    options: { alternativeCars: { available: true, items: [{ type: 'alternative-car', orderUuid: 'exact-1', snapshot: { display: { name: 'BMW i4' } } }],
      needsConfirmation: [{ type: 'alternative-car', orderUuid: 'unknown-1', unknowns: ['boot'] }] },
      preferenceRelaxations: { available: false, items: [], reason: 'Preference producer unavailable' },
      laterRelease: { available: true, items: [{ type: 'later-release', releaseAt: '2026-12-03T12:00:00Z', source: 'review-1' }] },
      manualDecision: { available: true, type: 'manual-decision', requiresDecision: true },
      contractExtension: { available: true, type: 'contract-extension', contractEndDate: '2026-12-01', requiresUntil: true } } };
}
const ok = <T>(value: T): CaseClientResult<T> => ({ state: 'ready', value, replayed: false });
const list = (cases: readonly CaseRecord[] = [row()]): CaseList => ({ cases, asOf: at, policyVersion: 'policy-1' });
const refusal = (status: CaseRefusalStatus): CaseClientResult<never> => ({ state: 'refused', value: null,
  refusal: { status, code: status, reason: 'Server says refresh this case.', retryable: status === 'unavailable' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const fakeClient = () => ({
  readQueue: vi.fn<CaseClient['readQueue']>().mockResolvedValue(ok(list())),
  readOptions: vi.fn<CaseClient['readOptions']>().mockResolvedValue(ok(options())),
  prepareUpdate: vi.fn<CaseClient['prepareUpdate']>().mockImplementation(input => Object.freeze({ kind: 'update-case', input: Object.freeze(structuredClone(input)) })),
  updateCase: vi.fn<CaseClient['updateCase']>().mockResolvedValue(ok({ case: row({ status: 'in-progress', version: 4 }) })),
});

describe('Greg queue authority, review and readback', () => {
  let state = signal<SessionState>({ status: 'ready', context });
  let client = fakeClient(); let store: CaseQueueStore;
  const auth = { signIn: vi.fn(async (_returnTo: string) => {}), retry: vi.fn(async () => {}) };
  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000001' });
    state = signal<SessionState>({ status: 'ready', context }); client = fakeClient();
    TestBed.configureTestingModule({ providers: [CaseQueueStore, { provide: AuthPort, useValue: { ...auth, state } }, { provide: CaseClient, useValue: client }] });
    store = TestBed.inject(CaseQueueStore); TestBed.flushEffects();
  });
  afterEach(() => { store.dispose(); TestBed.resetTestingModule(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
  const ready = async () => { await vi.waitFor(() => expect(store.view().phase).toBe('ready')); };
  async function select() { await ready(); await store.open(row().caseId); }
  function draft() { store.edit('status', 'in-progress'); store.edit('reason', '  Reviewed the renewal  '); store.edit('nextAction', 'Call employee'); store.edit('dueAt', '2026-11-16T10:30'); }
  function reviewed(): UpdateCaseCommand { draft(); expect(store.review()).toBe(true); return store.view().review!; }

  it('keeps server queue order, selects by exact ID and prepares no command on read', async () => {
    await ready(); client.readQueue.mockResolvedValueOnce(ok(list([row({ caseId: 'z' }), row({ caseId: 'a' })])));
    await store.refresh(); expect(store.view().rows.map(r => r.caseId)).toEqual(['z', 'a']);
    expect(await store.open('not-in-queue')).toBe(false); expect(client.readOptions).not.toHaveBeenCalled();
    client.readOptions.mockResolvedValueOnce(ok(options(row({ caseId: 'z' })))); await store.open('z');
    expect(store.view().detail?.owner).toBe('Greg'); expect(store.view().options?.case.version).toBe(3);
    expect(client.prepareUpdate).not.toHaveBeenCalled(); expect(client.updateCase).not.toHaveBeenCalled();
  });
  it('uses only returned choices and never permits cars needing confirmation or unavailable preference commands', async () => {
    await select(); expect(store.choices().map(c => c.key)).toEqual(['car:0', 'later:0', 'manual', 'extension']);
    draft(); store.edit('remedyKey', 'unknown-1'); expect(store.review()).toBe(false); expect(store.view().errors.remedyKey).toBeTruthy();
    store.edit('remedyKey', 'car:0'); expect(store.review()).toBe(true); expect(store.view().review?.input.remedy).toEqual({ type: 'alternative-car', orderUuid: 'exact-1' });
  });
  it('reviews only current offered enum and bounded slider preference values without changing essentials', async () => {
    const original = options();
    client.readOptions.mockResolvedValueOnce(ok({ ...original, options: { ...original.options, preferenceRelaxations: { available: true, items: [
      { type: 'preference-relaxation', decisionId: 'decline-1', expectedBriefVersion: 2, path: 'preferences.body.value', before: ['hatchback'], valueType: 'enum', values: ['estate', 'saloon'] },
      { type: 'preference-relaxation', decisionId: 'decline-1', expectedBriefVersion: 2, path: 'preferences.size.value', before: 50, valueType: 'slider', minimum: 0, maximum: 100 },
    ] } } }));
    await select(); draft(); store.edit('remedyKey', 'preference:0');
    expect(store.review()).toBe(false); store.edit('preferenceValue', '9'); expect(store.review()).toBe(false);
    store.edit('preferenceValue', '0'); expect(store.review()).toBe(true);
    expect(store.view().review?.input.remedy).toEqual({ type: 'preference-relaxation', decisionId: 'decline-1', expectedBriefVersion: 2, path: 'preferences.body.value', value: 'estate' });
    expect(client.updateCase).not.toHaveBeenCalled(); store.cancelReview(); store.edit('remedyKey', 'preference:1');
    expect(store.view().draft.preferenceValue).toBe('');
    for (const value of ['', '50', '75.5', '101', 'invalid']) { store.edit('preferenceValue', value); expect(store.review()).toBe(false); }
    store.edit('preferenceValue', '75'); expect(store.review()).toBe(true);
    expect(store.view().review?.input.remedy).toMatchObject({ path: 'preferences.size.value', value: 75 });
  });
  it('reviews immutable current-version intent, cancels without POST and confirms only deliberately', async () => {
    await select(); const command = reviewed();
    expect(command.input).toMatchObject({ caseId: row().caseId, expectedVersion: 3, reason: 'Reviewed the renewal', dueAt: '2026-11-16T10:30:00.000Z' });
    store.edit('reason', 'changed after review'); expect(store.view().review).toBe(command); expect(client.updateCase).not.toHaveBeenCalled();
    store.cancelReview(); expect(store.view().review).toBeNull(); expect(await store.confirm()).toBe(false); expect(client.updateCase).not.toHaveBeenCalled();
    reviewed(); await store.confirm(); expect(client.updateCase).toHaveBeenCalledOnce();
  });
  it('rereads queue and options after acknowledgement and displays authoritative values', async () => {
    await select(); reviewed(); const current = row({ status: 'in-progress', reason: 'Server-normalised reason', version: 4 });
    client.readQueue.mockResolvedValueOnce(ok(list([current]))); client.readOptions.mockResolvedValueOnce(ok(options(current)));
    await store.confirm(); expect(client.readQueue).toHaveBeenCalledTimes(2); expect(client.readOptions).toHaveBeenCalledTimes(2);
    expect(store.view()).toMatchObject({ recorded: true, review: null, pending: false }); expect(store.view().detail?.source).toEqual(current);
  });
  it('retains acknowledgement when current readback is unavailable without presenting old options', async () => {
    await select(); reviewed(); client.readQueue.mockResolvedValueOnce(refusal('unavailable')); await store.confirm();
    expect(store.view()).toMatchObject({ recorded: true, phase: 'unavailable', options: null, review: null });
    expect(store.view().message).toContain('was recorded'); expect(store.view().message).toContain('Server says');
  });
  it('blocks duplicate submit, edit, selection, refresh and close during a pending write', async () => {
    await select(); const command = reviewed(); const write = deferred<Awaited<ReturnType<CaseClient['updateCase']>>>(); client.updateCase.mockReturnValueOnce(write.promise);
    const first = store.confirm(); expect(store.view().pending).toBe(true); expect(await store.confirm()).toBe(false); expect(await store.refresh()).toBe(false);
    expect(await store.open(row().caseId)).toBe(false); store.close(); store.edit('reason', 'ignored'); store.cancelReview();
    expect(store.view().review).toBe(command); expect(store.view().selected).toBe(row().caseId); expect(client.updateCase).toHaveBeenCalledOnce();
    write.resolve(ok({ case: row({ version: 4 }) })); await first;
  });
  it.each(['stale-version', 'conflict'] as const)('clears obsolete %s intent and requires fresh options and review', async status => {
    await select(); reviewed(); client.updateCase.mockResolvedValueOnce(refusal(status)); await store.confirm();
    expect(store.view()).toMatchObject({ detailPhase: 'stale', options: null, review: null, pending: false, canRetry: false });
    expect(await store.confirm()).toBe(false); client.readOptions.mockResolvedValueOnce(ok(options(row({ version: 7 })))); await store.refreshOptions();
    expect(reviewed().input.expectedVersion).toBe(7);
  });
  it('keeps unknown outcome intent and allows identical explicit retry only after both successful rereads', async () => {
    await select(); const command = reviewed(); client.updateCase.mockResolvedValueOnce({ state: 'failed', value: null, problem: 'timeout', writeOutcome: 'unknown' });
    await store.confirm(); expect(store.view()).toMatchObject({ uncertain: true, canRetry: false, options: null, recorded: false });
    expect(await store.retry()).toBe(false); expect(await store.open(row().caseId)).toBe(false);
    client.readOptions.mockResolvedValueOnce(refusal('unavailable')); await store.refresh(); expect(store.view().canRetry).toBe(false);
    await store.refresh(); expect(store.view().canRetry).toBe(true); expect(store.view().recorded).toBe(false);
    expect(client.updateCase).toHaveBeenCalledTimes(1); await store.retry();
    expect(client.updateCase.mock.calls.map(c => c[0])).toEqual([command, command]); expect(client.updateCase.mock.calls[1][0]).toBe(command);
  });
  it('treats thrown writes as unknown and never automatically replays after authentication recovery', async () => {
    await select(); reviewed(); client.updateCase.mockRejectedValueOnce(new Error('connection dropped')); await store.confirm();
    expect(store.view().uncertain).toBe(true); state.set({ status: 'signed-out' }); expect(store.view().review).toBeNull();
    TestBed.flushEffects(); state.set({ status: 'ready', context }); TestBed.flushEffects(); await ready();
    expect(store.view().review).toBeNull(); expect(client.updateCase).toHaveBeenCalledOnce();
  });
  it.each(['forbidden', 'unauthenticated'] as const)('removes all private values on %s', async status => {
    await select(); reviewed(); client.updateCase.mockResolvedValueOnce(refusal(status)); await store.confirm();
    expect(store.view()).toMatchObject({ rows: [], options: null, selected: null, review: null, phase: status === 'forbidden' ? 'denied' : 'auth-required' });
  });
  it.each([
    { subject: 'other' }, { runId: 'run-2' }, { employeeId: 'other' }, { environmentId: 'other' }, { policyVersion: 'other' },
    { roles: ['employee'] as const }, { roles: ['greg', 'presenter'] as const },
  ])('hides private state synchronously on context change %j', async patch => {
    await select(); reviewed(); state.set({ status: 'ready', context: { ...context, ...patch } });
    expect(store.view()).toMatchObject({ rows: [], options: null, selected: null, review: null, canConfirm: false }); expect(await store.confirm()).toBe(false);
  });
  it('ignores a late detail response after close and a late write after disposal', async () => {
    await ready(); const read = deferred<Awaited<ReturnType<CaseClient['readOptions']>>>(); client.readOptions.mockReturnValueOnce(read.promise);
    const opening = store.open(row().caseId); const signal = client.readOptions.mock.calls.at(-1)![1]!.signal!; store.close(); expect(signal.aborted).toBe(true);
    read.resolve(ok(options())); await opening; expect(store.view().selected).toBeNull();
    await store.open(row().caseId); reviewed(); const write = deferred<Awaited<ReturnType<CaseClient['updateCase']>>>(); client.updateCase.mockReturnValueOnce(write.promise);
    const sending = store.confirm(); store.dispose(); write.resolve(ok({ case: row() })); await sending;
    expect(store.view()).toMatchObject({ rows: [], review: null, options: null }); expect(client.readQueue).toHaveBeenCalledOnce();
  });
  it('does not allow late queue results from a former run to become current', async () => {
    await ready(); const read = deferred<Awaited<ReturnType<CaseClient['readQueue']>>>(); client.readQueue.mockReturnValueOnce(read.promise);
    const refreshing = store.refresh(); state.set({ status: 'ready', context: { ...context, runId: 'new-run' } });
    client.readQueue.mockResolvedValueOnce(ok(list([]))); TestBed.flushEffects(); read.resolve(ok(list())); await refreshing;
    await vi.waitFor(() => expect(store.view().phase).toBe('empty')); expect(store.view().rows).toEqual([]);
  });
  it('distinguishes unavailable, denied and a proven empty queue', async () => {
    await ready(); client.readQueue.mockResolvedValueOnce(refusal('unavailable')); await store.refresh(); expect(store.view().phase).toBe('unavailable');
    client.readQueue.mockResolvedValueOnce(ok(list([]))); await store.refresh(); expect(store.view().phase).toBe('empty');
    client.readQueue.mockResolvedValueOnce(ok(list([row({ runId: 'wrong' })]))); await store.refresh(); expect(store.view().phase).toBe('denied');
  });
  it('validates status, reason, action and UTC date against server time before preparing', async () => {
    await select(); expect(store.review()).toBe(false); expect(Object.keys(store.view().errors)).toEqual(['status', 'reason']);
    draft(); store.edit('status', 'resolved'); store.edit('reason', 'x'.repeat(2001)); store.edit('nextAction', ''); store.edit('dueAt', '2026-02-30T12:00');
    expect(store.review()).toBe(false); expect(store.view().errors).toMatchObject({ status: expect.any(String), reason: expect.any(String), nextAction: expect.any(String), dueAt: expect.any(String), remedyKey: expect.any(String) });
    draft(); store.edit('dueAt', '2026-11-14T12:00'); expect(store.review()).toBe(false); expect(client.prepareUpdate).not.toHaveBeenCalled();
  });
  it('requires manual text and future extension, and preserves the exact later release source', async () => {
    await select(); draft(); store.edit('remedyKey', 'manual'); expect(store.review()).toBe(false); store.edit('decision', 'Agreed by scheme team');
    expect(store.review()).toBe(true); expect(store.view().review?.input.remedy).toEqual({ type: 'manual-decision', decision: 'Agreed by scheme team' }); store.cancelReview();
    store.edit('remedyKey', 'extension'); store.edit('until', '2026-12-01'); expect(store.review()).toBe(false); store.edit('until', '2027-01-01');
    expect(store.review()).toBe(true); expect(store.view().review?.input.remedy).toEqual({ type: 'contract-extension', until: '2027-01-01' }); store.cancelReview();
    store.edit('remedyKey', 'later:0'); expect(store.review()).toBe(true); expect(store.view().review?.input.remedy).toEqual({ type: 'later-release', releaseAt: '2026-12-03T12:00:00Z', source: 'review-1' });
  });
  it('offers no review or command for terminal options', async () => {
    await ready(); client.readOptions.mockResolvedValueOnce(ok({ ...options(row({ status: 'closed' })), nextStatuses: [] })); await store.open(row().caseId);
    draft(); expect(store.review()).toBe(false); expect(client.prepareUpdate).not.toHaveBeenCalled();
  });
  it.each([{ caseId: 'wrong-case' }, { runId: 'wrong-run' }])('rejects mismatched selected options %j and clears private queue data', async patch => {
    await ready(); client.readOptions.mockResolvedValueOnce(ok(options(row(patch)))); await store.open(row().caseId);
    expect(store.view()).toMatchObject({ phase: 'denied', rows: [], options: null, selected: null }); expect(client.prepareUpdate).not.toHaveBeenCalled();
  });
});
