import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService, RuntimePublicConfig } from '../auth/runtime-config';
import { BriefClient } from './brief.client';
import { briefEditorFixture, currentBriefFixture, preferenceSaveFixture } from './brief.fixtures';

const config: RuntimePublicConfig = {
  schemaVersion: 1,
  environmentId: 'isolated-dev',
  apiBaseUrl: 'https://api.example/api/gcsp/v1',
  oidc: {
    authority: 'https://identity.example', clientId: 'public-client', scope: 'openid profile',
    redirectUri: 'https://portal.example/gcsp/auth/callback', postLogoutRedirectUri: 'https://portal.example/gcsp/',
  },
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const brief = {
  schemaVersion: 1 as const,
  preferences: { economy: { value: 70, importance: 50, valueState: 'draft' as const, importanceState: 'draft' as const, source: 'employee' } },
  essentials: { seats: { value: null, operator: 'gte', unit: 'seats', state: 'needs-confirmation' as const, source: 'policy:brief.editor.v1' } },
};
const editor = briefEditorFixture();

describe('Angular brief API client', () => {
  const fetcher = vi.fn<typeof fetch>();
  const getAccessToken = vi.fn(async (): Promise<string | null> => 'access-token');
  const load = vi.fn(async () => config);
  let client: BriefClient;

  beforeEach(() => {
    fetcher.mockReset();
    getAccessToken.mockReset().mockResolvedValue('access-token');
    load.mockReset().mockResolvedValue(config);
    TestBed.configureTestingModule({ providers: [
      { provide: AuthPort, useValue: { getAccessToken } },
      { provide: RuntimeConfigService, useValue: { load } },
      { provide: PORTAL_FETCH, useValue: fetcher },
    ] });
    client = TestBed.inject(BriefClient);
  });

  it('uses the exact replacement read suffixes with bearer auth and no cookie authority', async () => {
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: editor }));
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: currentBriefFixture() }));
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: { versions: [] } }));
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: { draftVersion: 2, baseBriefVersion: 4, brief } }));

    expect((await client.readEditor()).status).toBe('ok');
    expect((await client.readCurrent()).status).toBe('ok');
    expect((await client.readHistory()).status).toBe('ok');
    expect((await client.readDraft()).status).toBe('ok');

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `${config.apiBaseUrl}/brief/editor`, `${config.apiBaseUrl}/brief`,
      `${config.apiBaseUrl}/brief/history`, `${config.apiBaseUrl}/brief/draft`,
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error' });
      expect(init?.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer access-token' });
      expect(init).not.toHaveProperty('body');
    }
  });

  it('sends only source payloads to the supported POST suffixes without adding trusted context', async () => {
    const command = { commandId: 'command-1', expectedBriefVersion: 4, expectedDraftVersion: 2 };
    const requests: Array<{ path: string; invoke: () => Promise<unknown>; body: object }> = [
      { path: '/brief/preview', invoke: () => client.preview({ kind: 'unsaved-draft', baseBriefVersion: 4, draftVersion: 2, brief }), body: { kind: 'unsaved-draft', baseBriefVersion: 4, draftVersion: 2, brief } },
      { path: '/brief/preferences', invoke: () => client.savePreferences({ ...command, changes: { economy: { value: 70, importance: 'high' } }, currentCarRating: { contractId: 'contract-1', value: 4 }, sameAgain: { contractId: 'contract-1', on: false } }), body: { ...command, changes: { economy: { value: 70, importance: 'high' } }, currentCarRating: { contractId: 'contract-1', value: 4 }, sameAgain: { contractId: 'contract-1', on: false } } },
      { path: '/brief/draft', invoke: () => client.saveDraft({ ...command, brief }), body: { ...command, brief } },
      { path: '/brief/confirm', invoke: () => client.confirm({ ...command, consent: { search: true, hold: true } }), body: { ...command, consent: { search: true, hold: true } } },
      { path: '/brief/engage', invoke: () => client.engage(command), body: command },
      { path: '/brief/pause-search', invoke: () => client.pauseSearch(command), body: command },
      { path: '/brief/resume-search', invoke: () => client.resumeSearch(command), body: command },
      { path: '/brief/disengage', invoke: () => client.disengage(command), body: command },
      { path: '/brief/change-after-decline', invoke: () => client.changeAfterDecline({ commandId: 'command-2', expectedBriefVersion: 4, decisionId: 'decision-1', change: { path: 'preferences.economy.value', value: 80 } }), body: { commandId: 'command-2', expectedBriefVersion: 4, decisionId: 'decision-1', change: { path: 'preferences.economy.value', value: 80 } } },
    ];
    fetcher.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      const payload = init?.body ? JSON.parse(String(init.body)) as object : undefined;
      const value = path.endsWith('/preferences') ? preferenceSaveFixture()
        : path.endsWith('/draft') ? { draftVersion: 3, baseBriefVersion: 4, brief }
          : path.endsWith('/confirm') || path.endsWith('/change-after-decline')
            ? currentBriefFixture()
            : path.endsWith('/preview') ? { state: 'no-stock', eligibleCount: 0, decisions: [], recommendations: [], versions: {} }
              : { commandId: (payload as { commandId?: string } | undefined)?.commandId };
      return json({ status: 'ok', value });
    });

    for (const request of requests) expect((await request.invoke() as { status: string }).status).toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(requests.length);
    for (const [index, request] of requests.entries()) {
      const [url, init] = fetcher.mock.calls[index];
      expect(url).toBe(`${config.apiBaseUrl}${request.path}`);
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('omit');
      expect(init?.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer access-token', 'Content-Type': 'application/json' });
      expect(JSON.parse(String(init?.body))).toEqual(request.body);
      for (const authority of ['runId', 'environmentId', 'employeeId', 'subject', 'principalId', 'policyVersion']) {
        expect(JSON.stringify(JSON.parse(String(init?.body)))).not.toContain(`"${authority}"`);
      }
    }
  });

  it('rejects injected context authority at runtime and leaves the caller input untouched', async () => {
    const input = Object.freeze({ commandId: 'command-1', expectedBriefVersion: 4, expectedDraftVersion: 2, runId: 'client-run' });
    expect((await client.engage(input)).status).toBe('invalid');
    expect(fetcher).not.toHaveBeenCalled();
    expect(input.runId).toBe('client-run');

    const valid = Object.freeze({ commandId: 'command-2', expectedBriefVersion: 4, expectedDraftVersion: 2 });
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: {} }));
    await client.engage(valid);
    expect(valid).toEqual({ commandId: 'command-2', expectedBriefVersion: 4, expectedDraftVersion: 2 });
  });

  it('keeps typed stale, failed and pending outcomes without reflecting private message text', async () => {
    const stale = { status: 'stale-version', resource: 'draft', expectedVersion: 2, currentVersion: 3, action: 'refresh', retryable: false, contractVersion: '1.0.0' };
    fetcher.mockResolvedValueOnce(json({ ...stale, message: 'private provider details' }, 409));
    expect(await client.saveDraft({ commandId: 'c1', expectedBriefVersion: 4, expectedDraftVersion: 2, brief })).toEqual(stale);

    const failed = { status: 'invalid', code: 'invalid-preferences', reasons: [{ field: 'changes.economy', reason: 'Choose a registered value.' }], retryable: false };
    fetcher.mockResolvedValueOnce(json(failed, 400));
    expect(await client.savePreferences({ commandId: 'c2', expectedBriefVersion: 4, expectedDraftVersion: 2, changes: { economy: { value: 70 } } })).toEqual(failed);

    const pending = { status: 'pending', operationId: 'op-1', currentVersions: { brief: 4 }, retryable: true };
    fetcher.mockResolvedValueOnce(json(pending, 202));
    expect(await client.changeAfterDecline({ commandId: 'c3', expectedBriefVersion: 4, decisionId: 'd1', change: { path: 'preferences.economy.value', value: 80 } })).toEqual(pending);
  });

  it('returns unavailable for malformed editor success, non-JSON responses and network errors', async () => {
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: { ...editor, initial: { ...editor.initial, draftVersion: -1 } } }));
    expect((await client.readEditor()).status).toBe('unavailable');
    fetcher.mockResolvedValueOnce(new Response('<html>fallback</html>', { status: 200 }));
    expect((await client.readHistory()).status).toBe('unavailable');
    fetcher.mockRejectedValueOnce(new Error('private network detail'));
    expect((await client.readCurrent()).status).toBe('unavailable');
  });

  it('rejects nested malformed success before any presenter can dereference it', async () => {
    const invalidEditors = [
      { ...editor, context: { ...editor.context, accountPreferences: {} } },
      { ...editor, context: { ...editor.context, accountPreferences: { ...editor.context.accountPreferences, categories: { body: null } } } },
      { ...editor, initial: { ...editor.initial, accountPreferences: { ...editor.initial.accountPreferences, categories: { body: { state: 'considered', value: ['estate'], importance: 'urgent' } } } } },
      { ...editor, initial: { ...editor.initial, brief: { ...editor.initial.brief, preferences: { economy: null } } } },
      { ...editor, initial: { ...editor.initial, currentCarRating: { value: 6, contractId: 'contract-1' } } },
    ];
    for (const value of invalidEditors) { fetcher.mockResolvedValueOnce(json({ status: 'ok', value })); expect((await client.readEditor()).status).toBe('unavailable'); }
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: { ...preferenceSaveFixture(), accountPreferences: {} } }));
    expect((await client.savePreferences({ commandId: 'c1', expectedBriefVersion: 4, expectedDraftVersion: 2, changes: { economy: { value: 100 } } })).status).toBe('unavailable');
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: { state: 'recommendations', eligibleCount: 1, decisions: [null], recommendations: [], versions: {} } }));
    expect((await client.preview({ kind: 'unsaved-draft', baseBriefVersion: 4, draftVersion: 2, brief })).status).toBe('unavailable');
  });

  it('preserves the source minimum and Buddy readback on a refusal', async () => {
    const refusal = { status: 'invalid', code: 'engagement-minimum', buddy: editor.initial.buddy, remaining: 1, considered: 1, minimumCategories: 2 };
    fetcher.mockResolvedValueOnce(json(refusal, 400));
    expect(await client.engage({ commandId: 'c1', expectedBriefVersion: 4, expectedDraftVersion: 2 })).toEqual(refusal);
  });

  it('cancels an old edit awaiting a token before it can reach the API', async () => {
    let finish!: (token: string) => void;
    getAccessToken.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const controller = new AbortController();
    const result = client.savePreferences({ commandId: 'old-command', expectedBriefVersion: 4, expectedDraftVersion: 2, changes: { economy: { value: 100 } } }, { signal: controller.signal });
    controller.abort(); finish('new-account-token');
    expect((await result).status).toBe('unavailable'); expect(fetcher).not.toHaveBeenCalled();
  });

  it('checks the captured context before sending even when auth changes before its reset effect runs', async () => {
    const state = signal({ status: 'ready' as const, context: { subject: 'old-subject', environmentId: 'dev', runId: 'run-1', employeeId: 'employee-1' } });
    TestBed.resetTestingModule(); TestBed.configureTestingModule({ providers: [{ provide: AuthPort, useValue: { state, getAccessToken } }, { provide: RuntimeConfigService, useValue: { load } }, { provide: PORTAL_FETCH, useValue: fetcher }] });
    client = TestBed.inject(BriefClient);
    let finish!: (token: string) => void; getAccessToken.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = client.savePreferences({ commandId: 'old-command', expectedBriefVersion: 4, expectedDraftVersion: 2, changes: { economy: { value: 100 } } }, { expectedContextKey: JSON.stringify(['old-subject', 'dev', 'run-1', 'employee-1']) });
    state.set({ status: 'ready', context: { subject: 'new-subject', environmentId: 'dev', runId: 'run-1', employeeId: 'employee-1' } }); finish('new-account-token');
    const result = await pending; expect(result.status).toBe('unavailable'); expect(fetcher).not.toHaveBeenCalled(); expect(getAccessToken).toHaveBeenCalledOnce();
  });

  it('does not call the API without a token or replay a POST after 401', async () => {
    getAccessToken.mockResolvedValueOnce(null);
    expect(await client.readEditor()).toEqual({ status: 'unauthenticated', code: 'authentication-required', retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();

    fetcher.mockResolvedValueOnce(json({ status: 'unauthenticated', code: 'expired-token', retryable: false }, 401));
    const result = await client.engage({ commandId: 'c1', expectedBriefVersion: 4, expectedDraftVersion: 2 });
    expect(result).toEqual({ status: 'unauthenticated', code: 'expired-token', retryable: false });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(getAccessToken).toHaveBeenCalledTimes(2);
  });
});
