import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationContext, AuthPort, SessionState } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService, RuntimePublicConfig } from '../auth/runtime-config';
import { ActivityClient } from './activity.client';
import { ActivityOffer, ActivityProjection, ActivityState } from './activity.types';

const context: ApplicationContext = { subject: 'trusted-subject', roles: ['employee'], environmentId: 'isolated',
  runId: 'run/active', employeeId: 'employee-paula', policyVersion: 'policy-v7', capabilities: ['activity:read'] };
const config: RuntimePublicConfig = { schemaVersion: 1, environmentId: 'isolated', apiBaseUrl: 'https://api.example/api/gcsp/v1',
  oidc: { authority: 'https://issuer.example', clientId: 'public-client', scope: 'openid', redirectUri: 'https://portal.example/gcsp/auth/callback', postLogoutRedirectUri: 'https://portal.example/gcsp/' } };
const now = '2026-11-14T08:00:00.000Z';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ok = (value: unknown) => json({ status: 'ok', value });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

type OfferInput = Omit<ActivityOffer, 'displayState'>;
type ProjectionInput = Omit<ActivityProjection, 'currentOffer' | 'offers'> & {
  readonly currentOffer: OfferInput | null;
  readonly offers: readonly OfferInput[];
  readonly privateDetails?: unknown;
};

function offer(state = 'active'): OfferInput {
  return { offerRef: { offerId: 'offer-current' }, state, version: 12, briefVersion: 8,
    createdAt: '2020-01-01T00:00:00.000Z', holdId: 'hold-5', orderUuid: 'order-7', policyVersion: 'policy-v7',
    quoteId: 'quote-9', expiresAt: '2020-01-02T00:00:00.000Z', href: '/gcsp/offers/offer-current' };
}
function projection(patch: Partial<ProjectionInput> = {}): Record<string, unknown> {
  const currentOffer = offer();
  return { runId: context.runId, employeeId: context.employeeId, asOf: now, clockVersion: '31', briefVersion: 8,
    permission: { searchConsent: true, holdConsent: true, paused: false, permissionVersion: 8, canSearch: true, canHold: true },
    state: 'offer', lastSuccessfulCheck: { checkedAt: '2026-11-14T07:30:00.000Z', clockVersion: '30', carsChecked: 12,
      suitableCars: 0, exclusions: [{ essential: 'boot', requirement: { operator: 'gte', value: 430, unit: 'litres' }, cars: 9 }], outcome: 'no-match' },
    searchEvidence: { status: 'recorded', checks: 4 }, sourceStatus: 'ok', currentOffer, offers: [currentOffer],
    stateChanges: [{ eventId: 'brief:employee-paula:8', eventType: 'brief-changed', operation: 'paused',
      briefVersion: 8, previousBriefVersion: 7, occurredAt: '2026-11-14T07:00:00.000Z' }],
    stateChangesEvidence: { status: 'recorded', rejectedReceipts: 0 }, ...patch };
}
function sourceOffer(offerId: string, runId: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { schemaVersion: 1, offerId, runId, state: 'expired', reason: 'offer-expired', serverNow: now,
    expiresAt: '2026-11-13T08:00:00.000Z', clockVersion: '31', offerVersion: 12, holdVersion: 5,
    holdState: 'released', offerState: 'expired', availableActions: [], quote: { quoteId: 'quote-9', configurationId: 'config-9',
      orderUuid: 'order-7', orderNumber: '1234567', policyVersion: 'policy-v7', briefVersion: 8, quotedAt: now,
      validUntil: '2026-11-13T08:00:00.000Z', revisions: { quote: 9 }, facts: { contractVersion: 'vehicle-snapshot-v1',
        identityKind: 'exact-stock', candidateKey: 'candidate-3', sourceNamespace: 'approved-used', snapshotVersion: 'snapshot-2',
        observedAt: now, sourceKeys: { stockId: 'order-7' }, display: { name: 'BMW i4 M50', photo: '/assets/gcsp-vehicle-evidence/car.webp',
          images: [{ src: '/assets/gcsp-vehicle-evidence/car.webp', alt: 'BMW i4 M50', caption: 'Front three-quarter view',
            fidelity: 'confirmed-listing', sourceRef: 'listing-19', viewpoint: 'front-three-quarter', label: 'Front' }] } } }, ...patch };
}

describe('native employee activity client', () => {
  const state = signal<SessionState>({ status: 'ready', context });
  const getAccessToken = vi.fn(async (): Promise<string | null> => 'access-token');
  const fetcher = vi.fn<typeof fetch>();
  const load = vi.fn(async () => config);
  let client: ActivityClient;

  beforeEach(() => {
    state.set({ status: 'ready', context }); getAccessToken.mockReset().mockResolvedValue('access-token');
    fetcher.mockReset(); load.mockReset().mockResolvedValue(config);
    TestBed.configureTestingModule({ providers: [
      { provide: AuthPort, useValue: { state, getAccessToken, retry: vi.fn() } },
      { provide: RuntimeConfigService, useValue: { load } }, { provide: PORTAL_FETCH, useValue: fetcher },
    ] });
    client = TestBed.inject(ActivityClient);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('reads the current employee snapshot without a command and preserves backend search evidence', async () => {
    const input = projection({ privateDetails: { token: 'never-return-this' } }); fetcher.mockResolvedValueOnce(ok(input));
    const result = await client.readActivity(); expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value).toMatchObject({ runId: context.runId, employeeId: context.employeeId, asOf: now, clockVersion: '31',
      briefVersion: 8, state: 'offer', sourceStatus: 'ok', searchEvidence: { status: 'recorded', checks: 4 },
      lastSuccessfulCheck: { outcome: 'no-match', carsChecked: 12, suitableCars: 0, exclusions: [{ essential: 'boot', cars: 9 }] } });
    expect(result.value.currentOffer).toMatchObject({ offerRef: { offerId: 'offer-current' }, version: 12, briefVersion: 8,
      state: 'active', displayState: 'active', expiresAt: '2020-01-02T00:00:00.000Z' });
    expect(result.value).not.toHaveProperty('privateDetails');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(`${config.apiBaseUrl}/activity`);
    expect(fetcher.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/json', Authorization: 'Bearer access-token' } }));
    expect(fetcher.mock.calls[0][1]?.body).toBeUndefined();
  });

  it('retains live, pending and terminal offer states and their exact versions', async () => {
    for (const [sourceState, activityState, displayState] of [
      ['active', 'offer', 'active'], ['decision-pending', 'offer', 'decision-pending'], ['release-pending', 'offer', 'release-pending'],
      ['accepted', 'offer-closed', 'accepted'], ['expired', 'offer-closed', 'expired'], ['declined', 'offer-closed', 'declined'],
    ] as const) {
      const row = offer(sourceState); fetcher.mockResolvedValueOnce(ok(projection({ state: activityState as ActivityState, currentOffer: row, offers: [row] })));
      const result = await client.readActivity(); expect(result.status).toBe('ok');
      if (result.status !== 'ok') continue;
      expect(result.value.currentOffer).toMatchObject({ state: sourceState, displayState, version: 12, briefVersion: 8,
        holdId: 'hold-5', orderUuid: 'order-7', policyVersion: 'policy-v7', quoteId: 'quote-9' });
    }
  });

  it('keeps unfamiliar offer states unavailable instead of presenting them as active', async () => {
    const row = offer('awaiting-stock-custody'); fetcher.mockResolvedValueOnce(ok(projection({ currentOffer: row, offers: [row] })));
    const result = await client.readActivity(); expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.value.currentOffer).toMatchObject({ state: 'awaiting-stock-custody', displayState: 'unavailable', version: 12 });
  });

  it('retains no-brief, no-match and delayed-source outcomes as supplied', async () => {
    const cases = [
      { input: projection({ state: 'no-brief', briefVersion: null, permission: null, currentOffer: null, offers: [],
        lastSuccessfulCheck: null, searchEvidence: { status: 'not-recorded', reason: 'no-search-check-yet' }, sourceStatus: 'not-checked' }),
        expected: { state: 'no-brief', lastSuccessfulCheck: null, sourceStatus: 'not-checked' } },
      { input: projection({ state: 'searching', currentOffer: null, offers: [], sourceStatus: 'delayed',
        lastSuccessfulCheck: { checkedAt: '2026-11-14T07:30:00.000Z', carsChecked: 12, suitableCars: 0,
          exclusions: [{ essential: 'boot', requirement: { value: 430 }, cars: 9 }], outcome: 'no-match' } }),
        expected: { state: 'searching', sourceStatus: 'delayed', lastSuccessfulCheck: { outcome: 'no-match' } } },
    ];
    for (const row of cases) {
      fetcher.mockResolvedValueOnce(ok(row.input)); const result = await client.readActivity(); expect(result.status).toBe('ok');
      if (result.status === 'ok') expect(result.value).toMatchObject(row.expected);
    }
  });

  it('fails malformed successful projections, unsafe versions and false HTTP success closed', async () => {
    const base = projection();
    const malformed = [
      { ...base, briefVersion: Number.MAX_SAFE_INTEGER + 1 },
      { ...base, clockVersion: '' },
      { ...base, permission: { ...base['permission'] as object, permissionVersion: 0 } },
      { ...base, currentOffer: { ...offer(), version: Number.MAX_SAFE_INTEGER + 1 } },
      { ...base, lastSuccessfulCheck: { ...(base['lastSuccessfulCheck'] as object), suitableCars: 99 } },
      { ...base, state: 'expired-by-client-clock' },
    ];
    for (const value of malformed) {
      fetcher.mockResolvedValueOnce(ok(value));
      expect(await client.readActivity()).toMatchObject({ status: 'unavailable', code: 'activity-projection-invalid' });
    }
    fetcher.mockResolvedValueOnce(json({ status: 'ok' }));
    expect(await client.readActivity()).toMatchObject({ status: 'unavailable', code: 'activity-response-invalid' });
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: base }, 503));
    expect(await client.readActivity()).toMatchObject({ status: 'unavailable', httpStatus: 503 });
  });

  it('rejects activity responses for a different run or employee before returning any facts', async () => {
    for (const patch of [{ runId: 'other-run' }, { employeeId: 'other-employee' }]) {
      fetcher.mockResolvedValueOnce(ok({ ...projection(), ...patch }));
      expect(await client.readActivity()).toEqual({ status: 'unavailable', code: 'activity-response-scope-mismatch', retryable: false });
    }
  });

  it('requires an authenticated employee, a bearer token and a matching runtime environment', async () => {
    state.set({ status: 'signed-out' }); expect((await client.readActivity()).status).toBe('authentication-required');
    state.set({ status: 'ready', context: { ...context, roles: ['presenter'] } }); expect((await client.readActivity()).status).toBe('forbidden');
    state.set({ status: 'ready', context });
    for (const token of [null, '', 'has whitespace']) {
      getAccessToken.mockResolvedValueOnce(token); expect((await client.readActivity()).status).toBe('authentication-required');
    }
    load.mockResolvedValueOnce({ ...config, environmentId: 'other-environment' });
    expect(await client.readActivity()).toMatchObject({ status: 'unavailable', code: 'activity-environment-mismatch' });
    load.mockRejectedValueOnce(new Error('private config details'));
    expect(await client.readActivity()).toMatchObject({ status: 'unavailable', code: 'activity-transport-unavailable' });
    expect(fetcher).not.toHaveBeenCalled();
    load.mockResolvedValueOnce(config);
    fetcher.mockRejectedValueOnce(new Error('private network details'));
    expect(await client.readActivity()).toMatchObject({ status: 'unavailable', code: 'activity-transport-unavailable' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('keeps typed HTTP outcomes and safe version/action hints without private response fields', async () => {
    const cases = [
      { http: 401, body: { status: 'unauthenticated', code: 'token-expired', retryable: false }, expected: { status: 'authentication-required', code: 'token-expired', httpStatus: 401 } },
      { http: 403, body: { status: 'forbidden', code: 'employee-required', retryable: false }, expected: { status: 'forbidden', httpStatus: 403 } },
      { http: 409, body: { status: 'stale-version', code: 'brief-stale', retryable: false, expectedVersion: 7, currentVersion: 8,
        action: 'refresh', reasons: [{ field: 'brief', reason: 'reload' }], debug: { employee: 'private' } },
        expected: { status: 'stale-version', expectedVersion: 7, currentVersion: 8, action: 'refresh', reasons: [{ field: 'brief', reason: 'reload' }] } },
      { http: 202, body: { status: 'pending', operationId: 'operation-17', reason: 'release-pending', retryable: true },
        expected: { status: 'pending', operationId: 'operation-17', httpStatus: 202 } },
      { http: 422, body: { status: 'unsupported', code: 'provider-not-supported' }, expected: { status: 'unsupported', httpStatus: 422 } },
      { http: 503, body: { status: 'refused', code: 'evidence-unavailable', retryable: true }, expected: { status: 'refused', httpStatus: 503 } },
    ];
    for (const row of cases) {
      fetcher.mockResolvedValueOnce(json(row.body, row.http));
      const result = await client.readActivity(); expect(result).toMatchObject(row.expected);
      expect(result).not.toHaveProperty('debug'); expect(result).not.toHaveProperty('value');
    }
  });

  it('does not retry or renew after 401 for either a read or a command', async () => {
    fetcher.mockResolvedValue(json({ status: 'unauthenticated', code: 'token-expired' }, 401));
    expect((await client.readActivity()).status).toBe('authentication-required');
    expect((await client.command('engage', { commandId: 'stable-1', expectedBriefVersion: 8, expectedDraftVersion: 3 })).status).toBe('authentication-required');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'POST']);
    expect(getAccessToken).toHaveBeenCalledTimes(2);
  });

  it('drops a late read when the signed-in run or role changes during the request', async () => {
    for (const change of [{ runId: 'new-run' }, { roles: ['greg'] as const }]) {
      state.set({ status: 'ready', context }); const response = deferred<Response>(); fetcher.mockReturnValueOnce(response.promise);
      const pending = client.readActivity(); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
      state.set({ status: 'ready', context: { ...context, ...change } }); response.resolve(ok(projection()));
      expect(await pending).toMatchObject({ status: 'authentication-required', code: 'activity-scope-changed' });
      fetcher.mockClear();
    }
  });

  it('does not send a request if the account changes while obtaining the bearer token', async () => {
    const token = deferred<string | null>(); getAccessToken.mockReturnValueOnce(token.promise);
    const pending = client.readActivity(); await vi.waitFor(() => expect(getAccessToken).toHaveBeenCalled());
    state.set({ status: 'ready', context: { ...context, employeeId: 'different-employee' } }); token.resolve('other-account-token');
    expect(await pending).toMatchObject({ status: 'authentication-required', code: 'activity-scope-changed' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads owned offer display through an encoded path and preserves only source display metadata', async () => {
    const offerId = 'offer/id &x'; const runId = context.runId;
    fetcher.mockResolvedValueOnce(ok(sourceOffer(offerId, runId)));
    expect(await client.readOfferDisplay({ offerId, runId })).toEqual({ status: 'ok', value: {
      offerRef: { offerId }, title: 'BMW i4 M50', images: [{ src: '/assets/gcsp-vehicle-evidence/car.webp', alt: 'BMW i4 M50',
        caption: 'Front three-quarter view', fidelity: 'confirmed-listing', sourceRef: 'listing-19', viewpoint: 'front-three-quarter', label: 'Front' }],
    } });
    expect(fetcher.mock.calls[0][0]).toBe(`${config.apiBaseUrl}/offers/offer%2Fid%20%26x?runId=run%2Factive`);
    expect(fetcher.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/json', Authorization: 'Bearer access-token' } }));
  });

  it('refuses an offer from another identity or run and a missing display without changing activity state', async () => {
    const activity = projection(); fetcher.mockResolvedValueOnce(ok(activity));
    const first = await client.readActivity(); expect(first.status).toBe('ok');
    fetcher.mockResolvedValueOnce(ok(sourceOffer('other-offer', context.runId)));
    expect(await client.readOfferDisplay({ offerId: 'offer-current', runId: context.runId })).toMatchObject({ status: 'unavailable' });
    fetcher.mockResolvedValueOnce(ok(sourceOffer('offer-current', 'other-run')));
    expect(await client.readOfferDisplay({ offerId: 'offer-current', runId: context.runId })).toMatchObject({ status: 'unavailable' });
    fetcher.mockResolvedValueOnce(ok(sourceOffer('offer-current', context.runId, { quote: { quoteId: 'missing-display' } })));
    expect(await client.readOfferDisplay({ offerId: 'offer-current', runId: context.runId })).toMatchObject({ status: 'unavailable' });
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'GET', 'GET', 'GET']);
    expect(first).toMatchObject({ status: 'ok', value: { state: 'offer', currentOffer: { state: 'active', version: 12 } } });
  });

  it('rejects a caller-supplied offer run that differs from the authenticated run before I/O', async () => {
    expect(await client.readOfferDisplay({ offerId: 'offer-current', runId: 'stale-run' })).toMatchObject({ status: 'stale-run' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads editor versions only and requires a positive brief and a nonnegative draft version', async () => {
    fetcher.mockResolvedValueOnce(ok({ initial: { briefVersion: 8, draftVersion: 0 }, preferences: { private: true } }));
    expect(await client.readControlVersions()).toEqual({ status: 'ok', value: { briefVersion: 8, draftVersion: 0 } });
    for (const initial of [{ briefVersion: 0, draftVersion: 0 }, { briefVersion: Number.MAX_SAFE_INTEGER + 1, draftVersion: 1 },
      { briefVersion: 8, draftVersion: -1 }]) {
      fetcher.mockResolvedValueOnce(ok({ initial }));
      expect(await client.readControlVersions()).toMatchObject({ status: 'unavailable', code: 'activity-editor-versions-invalid' });
    }
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(Array(4).fill(`${config.apiBaseUrl}/brief/editor`));
    expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('sends only the caller command and exact versioned body, without an editor read or hidden retry', async () => {
    const input = { commandId: 'stable-pause-1', expectedBriefVersion: 8, expectedDraftVersion: 3 };
    fetcher.mockResolvedValueOnce(ok({ briefVersion: 9, draftVersion: 3, operationId: 'command-9', privateRecord: 'drop-me' }));
    expect(await client.command('pause-search', input)).toEqual({ status: 'ok', value: { briefVersion: 9, draftVersion: 3,
      operationId: 'command-9' } });
    expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][0]).toBe(`${config.apiBaseUrl}/brief/pause-search`);
    expect(fetcher.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/json', Authorization: 'Bearer access-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(input) }));
    expect(fetcher.mock.calls[0][1]?.body).toBe(JSON.stringify(input));
  });

  it('rejects unsupported commands, extra fields, invalid versions and missing stable ids before I/O', async () => {
    const valid = { commandId: 'stable-1', expectedBriefVersion: 8, expectedDraftVersion: 3 };
    const cases = [
      ['pause' as never, valid], ['engage', { ...valid, commandId: ' ' }], ['resume-search', { ...valid, extra: true }],
      ['disengage', { ...valid, expectedBriefVersion: Number.MAX_SAFE_INTEGER + 1 }], ['engage', { ...valid, expectedDraftVersion: -1 }],
    ] as const;
    for (const [operation, input] of cases) expect(await client.command(operation, input as never)).toMatchObject({ status: 'invalid' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds requests, aborts transport, removes the caller listener, and reports timeout separately', async () => {
    const already = new AbortController(); already.abort();
    expect(await client.readActivity({ signal: already.signal })).toMatchObject({ status: 'aborted' });
    expect(fetcher).not.toHaveBeenCalled();
    const caller = new AbortController(); const response = deferred<Response>(); fetcher.mockReturnValueOnce(response.promise);
    const pending = client.readActivity({ signal: caller.signal }); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    const requestSignal = fetcher.mock.calls[0][1]?.signal; caller.abort();
    expect(await pending).toMatchObject({ status: 'aborted', code: 'activity-request-aborted' });
    expect(requestSignal?.aborted).toBe(true); response.resolve(ok(projection()));
    vi.useFakeTimers(); fetcher.mockReturnValueOnce(new Promise<Response>(() => {}));
    const timed = client.command('engage', { commandId: 'stable-timeout', expectedBriefVersion: 8, expectedDraftVersion: 3 });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)); await vi.advanceTimersByTimeAsync(10_001);
    expect(await timed).toMatchObject({ status: 'unavailable', code: 'activity-timeout', retryable: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
