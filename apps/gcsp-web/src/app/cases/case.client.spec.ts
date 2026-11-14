import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort } from '../auth/auth.port';
import type { ApplicationContext, SessionState } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService } from '../auth/runtime-config';
import type { RuntimePublicConfig } from '../auth/runtime-config';
import { CaseClient } from './case.client';
import type { CaseCommandRemedy, HelpCaseCommand, UpdateCaseInput } from './case.client';
import type { CaseOptions, CaseRecord } from './case.types';

const at = '2026-07-14T10:00:00.123Z';
const config: RuntimePublicConfig = { schemaVersion: 1, environmentId: 'isolated', apiBaseUrl: 'https://api.example/api/gcsp/v1/',
  oidc: { authority: 'https://identity.example', clientId: 'portal', scope: 'openid',
    redirectUri: 'https://portal.example/gcsp/auth/callback', postLogoutRedirectUri: 'https://portal.example/gcsp/' } };
function context(role: 'employee' | 'greg' | 'presenter' = 'employee'): ApplicationContext {
  return { subject: role === 'employee' ? 'subject-paula' : `subject-${role}`, environmentId: 'isolated', runId: 'run-1',
    employeeId: role === 'employee' ? 'paula' : undefined, roles: [role], policyVersion: 'policy-1', capabilities: [] };
}
function row(changes: Partial<CaseRecord> = {}): CaseRecord {
  return { caseId: 'case-1', runId: 'run-1', employeeId: 'paula', employeeName: 'Paula Mason', renewalId: 'renewal-1',
    owner: { role: 'scheme-team', name: 'Scheme team' }, status: 'open', reason: 'Please review my renewal.',
    trigger: { type: 'employee-request' }, nextAction: 'Review renewal', dueAt: at, openedAt: at, lastUpdatedAt: at,
    renewalDeadline: '2026-08-01', renewalDeadlineState: 'known', policyVersion: 'policy-1', history: [], remedy: null,
    fictional: true, version: 1, ...changes };
}
const list = (cases = [row()]) => ({ cases, asOf: at, policyVersion: 'policy-1' });
const help = () => ({ opensCase: false, ownerRole: 'scheme-team', extensionPermitted: false, nextAction: 'Ask the scheme team.',
  automaticRecoveryPriority: false, policyVersion: 'policy-1', assumptions: [] });
function options(): CaseOptions {
  return { case: row(), nextStatuses: ['closed', 'in-progress'], asOf: at, policyVersion: 'policy-1', automaticRecoveryPriority: false,
    options: { alternativeCars: { available: false, items: [], needsConfirmation: [], reason: 'Suitability is not connected.' },
      preferenceRelaxations: { available: false, items: [], reason: 'A recorded decline is required.' },
      laterRelease: { available: false, items: [], reason: 'No reviewed release is recorded.' },
      manualDecision: { available: true, type: 'manual-decision', requiresDecision: true },
      contractExtension: { available: false, type: 'contract-extension', contractEndDate: null, requiresUntil: true, reason: 'Not permitted.' } } };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ok = (value: unknown, replayed = false) => json({ status: 'ok', value, ...(replayed ? { replayed: true } : {}) });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function update(changes: Partial<UpdateCaseInput> = {}): UpdateCaseInput {
  return { commandId: 'update-1', caseId: 'case-1', expectedVersion: 1, status: 'in-progress',
    reason: 'Reviewed by scheme team.', nextAction: 'Confirm the available remedy.', dueAt: at, ...changes };
}

describe('CaseClient actual Java routes, immutable intent and private request lifecycle', () => {
  let state = signal<SessionState>({ status: 'ready', context: context() });
  let fetcher = vi.fn<typeof fetch>();
  let getAccessToken = vi.fn<() => Promise<string | null>>();
  let load = vi.fn<() => Promise<RuntimePublicConfig>>();
  let retry = vi.fn();
  let client: CaseClient;
  const makeClient = () => runInInjectionContext(Injector.create({ providers: [
    { provide: AuthPort, useValue: { state, getAccessToken, retry } },
    { provide: RuntimeConfigService, useValue: { load } }, { provide: PORTAL_FETCH, useValue: fetcher },
  ] }), () => new CaseClient());
  function helpCommand(input = { commandId: 'help-1', reason: 'My renewal needs attention.' }): HelpCaseCommand {
    const result = client.prepareHelp(input); if ('state' in result) throw new Error(result.problem); return result;
  }
  function updateCommand(input = update()) {
    const result = client.prepareUpdate(input); if ('state' in result) throw new Error(result.problem); return result;
  }
  beforeEach(() => {
    state = signal<SessionState>({ status: 'ready', context: context() });
    fetcher = vi.fn<typeof fetch>(); getAccessToken = vi.fn<() => Promise<string | null>>().mockResolvedValue('access-token');
    load = vi.fn<() => Promise<RuntimePublicConfig>>().mockResolvedValue(config); retry = vi.fn(); client = makeClient();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('reads help and a proven empty employee list over bearer GETs without identity queries, cookies or invented version tags', async () => {
    fetcher.mockResolvedValueOnce(ok(help())).mockResolvedValueOnce(ok(list([])));
    expect(await client.readHelp()).toMatchObject({ state: 'ready', value: help() });
    expect(await client.readOwnCases()).toMatchObject({ state: 'ready', value: { cases: [] } });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://api.example/api/gcsp/v1/help', 'https://api.example/api/gcsp/v1/cases']);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json', Authorization: 'Bearer access-token' } });
      expect(init?.body).toBeUndefined(); expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('encodes exactly one case selector and requires the actual GET metadata and matching case', async () => {
    const id = 'case/one?employeeId=other&runId=old=é';
    fetcher.mockResolvedValueOnce(ok({ case: row({ caseId: id }), asOf: at, policyVersion: 'policy-1' }));
    expect((await client.readOwnCase(id)).state).toBe('ready');
    expect(fetcher.mock.calls[0][0]).toBe(`https://api.example/api/gcsp/v1/cases?caseId=${encodeURIComponent(id)}`);
    fetcher.mockResolvedValueOnce(ok({ case: row() }));
    expect((await client.readOwnCase('case-1')).state).toBe('invalid-response');
    fetcher.mockResolvedValueOnce(ok({ case: row({ caseId: 'other-case' }), asOf: at, policyVersion: 'policy-1' }));
    expect(await client.readOwnCase('case-1')).toMatchObject({ state: 'scope-mismatch', value: null });
  });

  it('lets Greg list different employees in this run without inventing an employee identity', async () => {
    state.set({ status: 'ready', context: context('greg') });
    const cases = [row(), row({ caseId: 'case-2', employeeId: 'other', employeeName: 'Other employee' })];
    fetcher.mockResolvedValueOnce(ok(list(cases))).mockResolvedValueOnce(ok(options()));
    expect(await client.readQueue()).toMatchObject({ state: 'ready', value: { cases } });
    expect(await client.readOptions('case-1')).toMatchObject({ state: 'ready', value: options() });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://api.example/api/gcsp/v1/scheme-team/cases', 'https://api.example/api/gcsp/v1/scheme-team/cases/options?caseId=case-1']);
  });

  it.each(['employee', 'greg', 'presenter'] as const)('gates the opposite audience and presenter locally for %s', async (role) => {
    state.set({ status: 'ready', context: context(role) });
    if (role !== 'employee') {
      expect(await client.readHelp()).toMatchObject({ state: 'failed', problem: 'role-required', value: null });
      expect(await client.readOwnCases()).toMatchObject({ problem: 'role-required' });
      expect(client.prepareHelp({ commandId: 'h', reason: 'Help' })).toMatchObject({ problem: 'role-required' });
    }
    if (role !== 'greg') {
      expect(await client.readQueue()).toMatchObject({ problem: 'role-required' });
      expect(await client.readOptions('case-1')).toMatchObject({ problem: 'role-required' });
      expect(client.prepareUpdate(update())).toMatchObject({ problem: 'role-required' });
    }
    expect(fetcher).not.toHaveBeenCalled(); expect(getAccessToken).not.toHaveBeenCalled();
  });

  it.each(['signed-out', 'loading', 'denied', 'unavailable'] as const)('sends nothing while auth is %s', async (status) => {
    state.set({ status, message: 'Unavailable', retryable: true } as SessionState);
    expect(await client.readOwnCases()).toMatchObject({ state: 'failed', value: null });
    expect(fetcher).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
  });

  it.each(['subject', 'environmentId', 'runId', 'employeeId', 'policyVersion'] as const)('requires trusted %s before employee transport', async (field) => {
    state.set({ status: 'ready', context: { ...context(), [field]: '' } });
    expect(await client.readOwnCases()).toMatchObject({ problem: 'context-unavailable' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('prepares without transport and sends frozen help bytes only for explicit confirmation or the same-intent retry', async () => {
    const input = { commandId: 'help-1', reason: 'Original reason\nSecond line.' };
    const command = helpCommand(input); input.reason = 'Mutated after review';
    expect(Object.isFrozen(command)).toBe(true); expect(Object.isFrozen(command.input)).toBe(true);
    expect(fetcher).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(ok({ case: row() })).mockResolvedValueOnce(ok({ case: row() }, true));
    expect(await client.requestHelp(command)).toMatchObject({ state: 'ready', replayed: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await client.requestHelp(command)).toMatchObject({ state: 'ready', replayed: true });
    const bodies = fetcher.mock.calls.map(([, init]) => init?.body);
    expect(bodies).toEqual([JSON.stringify({ commandId: 'help-1', reason: 'Original reason\nSecond line.' }), bodies[0]]);
    expect(fetcher.mock.calls[0]).toMatchObject(['https://api.example/api/gcsp/v1/cases', { method: 'POST', headers: { 'Content-Type': 'application/json' } }]);
    expect(JSON.parse(String(bodies[0]))).not.toHaveProperty('runId');
  });

  it.each<CaseCommandRemedy>([
    { type: 'manual-decision', decision: 'Agreed decision' }, { type: 'contract-extension', until: '2027-02-01' },
    { type: 'later-release', releaseAt: '2026-12-05T10:00:00+01:00', source: 'Recorded release' },
    { type: 'alternative-car', orderUuid: 'exact-stock-1' },
  ])('sends only the reviewed %s remedy fields and leaves clock, suitability and transition permission to Java', async (remedy) => {
    state.set({ status: 'ready', context: context('greg') });
    const input = update({ dueAt: '2026-01-01T10:00:00+01:00', remedy });
    const command = updateCommand(input);
    expect(Object.isFrozen(command.input.remedy)).toBe(true);
    fetcher.mockResolvedValueOnce(ok({ case: row({ status: 'in-progress', version: 2 }) }));
    expect((await client.updateCase(command)).state).toBe('ready');
    expect(fetcher.mock.calls[0]).toMatchObject(['https://api.example/api/gcsp/v1/scheme-team/cases/update', { method: 'POST', body: JSON.stringify(input) }]);
  });

  it('keeps an omitted remedy omitted and rejects an update receipt for another case', async () => {
    state.set({ status: 'ready', context: context('greg') });
    fetcher.mockResolvedValueOnce(ok({ case: row({ caseId: 'another' }) }));
    expect(await client.updateCase(updateCommand())).toMatchObject({ state: 'scope-mismatch', value: null, writeOutcome: 'unknown' });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).not.toHaveProperty('remedy');
  });

  it('does not accept forged intents, another client instance or an old intent after recovery to the same identity', async () => {
    const command = helpCommand();
    expect(await client.requestHelp({ ...command })).toMatchObject({ problem: 'unrecognized-command', writeOutcome: 'not-sent' });
    expect(await makeClient().requestHelp(command)).toMatchObject({ problem: 'unrecognized-command' });
    state.set({ status: 'signed-out' }); state.set({ status: 'ready', context: context() });
    expect(await client.requestHelp(command)).toMatchObject({ problem: 'context-changed', writeOutcome: 'not-sent' });
    expect(fetcher).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled();
  });

  it.each(['', ' ', 'x'.repeat(129), 'bad\nselector'])('refuses invalid selectors before any request: %s', async (id) => {
    expect(await client.readOwnCase(id)).toMatchObject({ problem: 'invalid-selector' });
    expect(await client.readOptions(id)).toMatchObject({ problem: 'invalid-selector' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects malformed/oversized commands, caller authority and display-only remedy evidence without transport', () => {
    for (const input of [{ commandId: '', reason: 'Help' }, { commandId: 'h', reason: ' ' }, { commandId: 'h', reason: 'x'.repeat(2001) },
      { commandId: 'h', reason: 'Help', employeeId: 'other' }]) {
      expect(client.prepareHelp(input)).toMatchObject({ problem: 'invalid-command' });
    }
    state.set({ status: 'ready', context: context('greg') });
    for (const changes of [{ expectedVersion: 0 }, { expectedVersion: 1.2 }, { caseId: '' }, { dueAt: '2026-12-05' },
      { status: 'invented' }, { reason: 'x'.repeat(2001) }, { nextAction: '' }, { runId: 'foreign' },
      { remedy: null }, { remedy: { type: 'preference-relaxation', path: 'preferences.body' } },
      { remedy: { type: 'alternative-car', orderUuid: 'car', snapshot: { name: 'Not a command field' } } }]) {
      expect(client.prepareUpdate({ ...update(), ...changes } as UpdateCaseInput)).toMatchObject({ problem: 'invalid-command' });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'invalid', 'invalid-case-command'], [401, 'unauthenticated', 'authentication-required'],
    [403, 'forbidden', 'not-resource-owner'], [404, 'not-found', 'not-found'],
    [409, 'stale-version', 'stale-version'], [409, 'conflict', 'command-conflict'],
    [503, 'unavailable', 'case-unavailable'], [503, 'unavailable', 'outcome-uncertain'],
  ] as const)('preserves HTTP%s %s evidence and strips attached private data', async (http, status, code) => {
    const refusal = { status, code, reason: 'Server evidence', retryable: false, action: 'refresh',
      expectedVersion: 1, currentVersion: 2, reasons: [{ field: 'reason', reason: 'Review it' }], operationId: 'recorded-operation' };
    fetcher.mockResolvedValueOnce(json({ ...refusal, value: { case: row() }, case: row(), history: ['private'] }, http));
    const result = await client.requestHelp(helpCommand());
    expect(result).toMatchObject({ state: 'refused', value: null, refusal, httpStatus: http });
    expect(result).not.toHaveProperty('case'); expect(result).not.toHaveProperty('history');
    if (code === 'outcome-uncertain') expect(result).toHaveProperty('writeOutcome', 'unknown');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(retry).not.toHaveBeenCalled();
  });

  it.each([
    [200, null], [200, { status: 'ok', value: { cases: [] } }], [200, { status: 'ok', value: list(), replayed: false }],
    [403, { status: 'ok', value: list() }], [200, { status: 'forbidden', code: 'forbidden', reason: 'Denied', retryable: false }],
    [202, { status: 'pending', value: list() }],
  ] as const)('does not turn malformed or HTTP-mismatched%s responses into ready/empty', async (http, body) => {
    fetcher.mockResolvedValueOnce(json(body, http));
    expect(await client.readOwnCases()).toMatchObject({ state: 'invalid-response', value: null, httpStatus: http });
  });

  it('labels malformed JSON on a dispatched write as unknown and performs no automatic retry', async () => {
    fetcher.mockResolvedValueOnce(new Response('{bad-json', { status: 200 }));
    expect(await client.requestHelp(helpCommand())).toMatchObject({ state: 'invalid-response', httpStatus: 200, writeOutcome: 'unknown' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([{ employeeId: 'foreign' }, { runId: 'retired' }])('drops the whole employee response on foreign scope %j', async (changes) => {
    fetcher.mockResolvedValueOnce(ok(list([row(), row({ caseId: 'case-2', ...changes })])));
    expect(await client.readOwnCases()).toMatchObject({ state: 'scope-mismatch', value: null });
  });

  it('does not let Greg read another run despite valid employee names', async () => {
    state.set({ status: 'ready', context: context('greg') }); fetcher.mockResolvedValueOnce(ok(list([row({ runId: 'retired' })])));
    expect(await client.readQueue()).toMatchObject({ state: 'scope-mismatch', value: null });
  });

  it('refuses config/environment and token failures before transport', async () => {
    load.mockRejectedValueOnce(new Error('No settings'));
    expect(await client.readHelp()).toMatchObject({ problem: 'configuration-unavailable' });
    load.mockResolvedValueOnce({ ...config, environmentId: 'production' });
    expect(await client.readHelp()).toMatchObject({ problem: 'environment-mismatch' });
    for (const token of [null, '', 'two tokens']) {
      getAccessToken.mockResolvedValueOnce(token);
      expect(await client.readHelp()).toMatchObject({ problem: 'access-token-unavailable' });
    }
    getAccessToken.mockRejectedValueOnce(new Error('Auth expired'));
    expect(await client.readHelp()).toMatchObject({ problem: 'access-token-unavailable' });
    expect(fetcher).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled();
  });

  it.each(['subject', 'environmentId', 'runId', 'employeeId', 'roles'] as const)('guards a %s change while acquiring the token before POST', async (field) => {
    const command = helpCommand(); const token = deferred<string | null>(); const started = deferred<void>();
    getAccessToken.mockImplementationOnce(() => { started.resolve(); return token.promise; });
    const pending = client.requestHelp(command); await started.promise;
    state.set({ status: 'ready', context: { ...context(), [field]: field === 'roles' ? ['presenter'] : 'changed' } });
    token.resolve('access-token');
    expect(await pending).toMatchObject({ problem: 'context-changed', writeOutcome: 'not-sent' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a genuinely late old-session result after A -> B -> a new A with identical identity values', async () => {
    const headers = deferred<Response>(); const sent = deferred<void>();
    fetcher.mockImplementationOnce(() => { sent.resolve(); return headers.promise; });
    const pending = client.readOwnCases(); await sent.promise;
    state.set({ status: 'ready', context: { ...context(), employeeId: 'other' } });
    state.set({ status: 'ready', context: context() }); headers.resolve(ok(list()));
    expect(await pending).toMatchObject({ state: 'failed', value: null, problem: 'context-changed' });
  });

  it('captures scope values rather than retaining mutable authority by reference', async () => {
    const mutable = { ...context() }; state.set({ status: 'ready', context: mutable });
    const headers = deferred<Response>(); const sent = deferred<void>();
    fetcher.mockImplementationOnce(() => { sent.resolve(); return headers.promise; });
    const pending = client.readOwnCases(); await sent.promise;
    mutable.runId = 'changed'; headers.resolve(ok(list()));
    expect(await pending).toMatchObject({ problem: 'context-changed', value: null });
  });

  it('settles an already-aborted confirmation without sending it', async () => {
    const abort = new AbortController(); abort.abort();
    expect(await client.requestHelp(helpCommand(), { signal: abort.signal })).toMatchObject({ problem: 'aborted', writeOutcome: 'not-sent' });
    expect(fetcher).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
  });

  it('bounds a stalled config load and prevents a late config from starting a write', async () => {
    vi.useFakeTimers(); const configGate = deferred<RuntimePublicConfig>(); load.mockReturnValueOnce(configGate.promise);
    const pending = client.requestHelp(helpCommand()); await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toMatchObject({ problem: 'timeout', writeOutcome: 'not-sent' });
    configGate.resolve(config); await Promise.resolve(); await Promise.resolve();
    expect(getAccessToken).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds a stalled token and does not send when it eventually resolves', async () => {
    vi.useFakeTimers(); const token = deferred<string | null>(); getAccessToken.mockReturnValueOnce(token.promise);
    const pending = client.requestHelp(helpCommand()); await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toMatchObject({ problem: 'timeout', writeOutcome: 'not-sent' });
    token.resolve('late-token'); await Promise.resolve(); await Promise.resolve(); expect(fetcher).not.toHaveBeenCalled();
  });

  it('settles cancellation even if fetch ignores abort, preserves unknown write outcome and sends only on explicit same-intent retry', async () => {
    const headers = deferred<Response>(); const sent = deferred<void>(); const abort = new AbortController(); const command = helpCommand();
    fetcher.mockImplementationOnce(() => { sent.resolve(); return headers.promise; });
    const pending = client.requestHelp(command, { signal: abort.signal }); await sent.promise; abort.abort();
    expect(await pending).toMatchObject({ problem: 'aborted', value: null, writeOutcome: 'unknown' });
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    headers.resolve(ok({ case: row() })); await Promise.resolve(); await Promise.resolve(); expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(ok({ case: row() }, true)); expect(await client.requestHelp(command)).toMatchObject({ state: 'ready', replayed: true });
    expect(fetcher.mock.calls[1][1]?.body).toBe(fetcher.mock.calls[0][1]?.body);
  });

  it('bounds stalled response bodies and discards private data returned after timeout', async () => {
    vi.useFakeTimers(); const body = deferred<unknown>();
    fetcher.mockResolvedValueOnce({ status: 200, ok: true, json: () => body.promise } as Response);
    const pending = client.readOwnCases(); await vi.advanceTimersByTimeAsync(10_001);
    const result = await pending; expect(result).toMatchObject({ problem: 'timeout', value: null, httpStatus: 200 });
    body.resolve({ status: 'ok', value: list() }); await Promise.resolve(); await Promise.resolve();
    expect(result.value).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rechecks scope after asynchronous body parsing and preserves unknown outcome on transport loss', async () => {
    const body = deferred<unknown>(); const reading = deferred<void>();
    fetcher.mockResolvedValueOnce({ status: 200, ok: true, json: () => { reading.resolve(); return body.promise; } } as Response);
    const pending = client.readOwnCases(); await reading.promise;
    state.set({ status: 'ready', context: { ...context(), runId: 'new-run' } }); body.resolve({ status: 'ok', value: list() });
    expect(await pending).toMatchObject({ problem: 'context-changed', value: null });
    state.set({ status: 'ready', context: context() }); fetcher.mockRejectedValueOnce(new TypeError('Network lost'));
    expect(await client.requestHelp(helpCommand())).toMatchObject({ problem: 'transport-unavailable', writeOutcome: 'unknown' });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(retry).not.toHaveBeenCalled();
  });
});
