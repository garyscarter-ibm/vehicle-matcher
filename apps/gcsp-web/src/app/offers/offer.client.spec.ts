import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService, RuntimePublicConfig } from '../auth/runtime-config';
import { OfferClient } from './offer.client';

const config: RuntimePublicConfig = {
  schemaVersion: 1,
  environmentId: 'dev',
  apiBaseUrl: 'https://api.example/api/gcsp/v1',
  oidc: { authority: 'https://identity.example', clientId: 'client', scope: 'openid profile',
    redirectUri: 'https://portal.example/gcsp/auth/callback', postLogoutRedirectUri: 'https://portal.example/gcsp/' },
};
const now = '2026-11-14T09:00:00.000Z';
const provenance = { sourceRef: 'fixture:offer', observedAt: now, version: 'source-v1', assurance: 'synthetic-scenario' };
const point = (value: number) => ({ value, unit: 'points' });
const fact = (status: 'known' | 'unknown', value: string | number | boolean | null, unit: string | null = null) =>
  ({ status, value, unit, provenance });
const comparison = { status: 'unavailable', reason: 'pinned-current-car-comparison-unavailable', comparisonAvailable: false,
  currentCar: null, unknowns: ['configuration', 'body', 'fuel', 'seats', 'boot', 'mpg', 'zeroTo62', 'points'] };

function offer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1, offerId: 'offer-1', runId: 'run-1', state: 'pending', reason: 'awaiting-decision',
    serverNow: now, clockVersion: 'clock-v3', expiresAt: '2026-11-14T11:00:00.000Z', offerVersion: 2, holdVersion: 4,
    offerState: 'active', holdState: 'active', availableActions: ['accept', 'decline'], followup: null,
    handoff: { termsVersion: 'terms-v1', termsDigest: 'terms-digest', wording: 'Terms apply.', fictional: true,
      mode: 'replacement', blocker: null, driver: null, returnMileage: { maximum: 500000, unit: 'mi' },
      documentSource: { terms: 'ordering.terms.v1', termsVersion: 'terms-v1', recordSource: 'employee-contract' },
      declarations: [{ id: 'terms', label: 'I accept the terms.' }], contact: { phone: '07700 900123', email: 'employee@example.invalid' },
      returnCar: { model: '3 Series', contractEndDate: '2026-12-31', currentOdometer: { value: 0, unit: 'mi' }, expectedReturnMileage: null } },
    selection: null,
    quote: { quoteId: 'quote-1', configurationId: 'configuration-1', orderUuid: 'stock-1', orderNumber: '0123456',
      briefVersion: 5, policyVersion: 'policy-v2', quotedAt: now, validUntil: '2026-11-14T12:00:00.000Z',
      revisions: { quote: 3, brief: 5, facts: 'facts-v1', policy: 'policy-v2', stock: 4 },
      facts: { contractVersion: 'vehicle-snapshot-v1', identityKind: 'exact-stock', candidateKey: 'source:stock-1',
        sourceNamespace: 'fixture:employee', snapshotVersion: 'snapshot-v1', observedAt: now, sourceKeys: { stockId: 'stock-1' },
        display: { name: 'BMW 3 Series', photo: '/assets/car.webp', images: [{ src: '/assets/car.webp', alt: 'BMW 3 Series', label: 'Front' }] },
        facts: { seats: fact('known', 0), mileage: fact('unknown', null, 'mi') } },
      decision: { gateStatus: 'eligible', score: 0, reasons: ['Matches the recorded brief.'], tradeOffs: [], blockers: [], unknowns: [] },
      terms: { kind: 'employee-scheme', termsVersion: 'terms-v1', validFrom: now, validUntil: '2026-11-14T12:00:00.000Z',
        points: point(0), allowanceInputs: { allowance: point(0) }, provenance },
      allowance: { allowance: point(0) } },
    comparison,
    ...overrides,
  };
}

function reasons(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { schemaVersion: 1, key: 'offer.declineReasons.v1', policyVersion: 'policy-v2',
    reasons: [{ code: 'body-style', label: 'Body style', attribute: 'body' }],
    provenance: { status: 'assumed', basis: 'reviewed policy', source: 'policy source', sourceDate: '2026-11-05' }, ...overrides };
}

const decisionId = `offer-decision:${'a'.repeat(64)}`;
function savedChange(): Record<string, unknown> {
  return { schemaVersion: 1, state: 'change-saved', decisionId, briefVersion: 6, policyVersion: 'policy-v2',
    event: { receiptReference: 'brief-change:receipt-1', eventType: 'brief-changed', briefVersion: 6, occurredAt: now },
    change: { path: 'preferences.body.value', before: 'saloon', after: 'estate' } };
}

function followup(state: 'question' | 'change-saved' | 'waiting' | 'no-match' | 'ready'): Record<string, unknown> {
  const saved = savedChange();
  if (state === 'change-saved') return saved;
  if (state === 'question') return { schemaVersion: 1, state, decisionId, briefVersion: 5,
    question: { schemaVersion: 1, reasonCode: 'body-style', path: 'preferences.body.value', prompt: 'Which body style would you prefer?',
      control: { kind: 'options', options: [{ value: 'estate', label: 'Estate' }, { value: 'suv', label: 'SUV' }] }, currentValue: 'saloon',
      policyVersion: 'policy-v2', questionVersion: 'question-v1',
      provenance: { key: 'offer.followupQuestions.v1', status: 'assumed', basis: 'reviewed source', source: 'policy source', sourceDate: '2026-11-06' } } };
  if (state === 'waiting') return { schemaVersion: 1, state, decisionId, savedChange: saved };
  if (state === 'no-match') return { schemaVersion: 1, state, decisionId, savedChange: saved,
    evaluation: { evaluatedAt: now, carsChecked: 0, suitable: 0 } };
  return { schemaVersion: 1, state, decisionId, savedChange: saved,
    comparison: { schemaVersion: 1, currentBriefVersion: 6, requirements: [],
      previous: { offer: { state: 'declined' }, scoreBasis: { kind: 'historical-quote', briefVersion: 5, policyVersion: 'policy-v2', quotedAt: now } },
      next: { offer: { state: 'pending' }, scoreBasis: { kind: 'historical-quote', briefVersion: 6, policyVersion: 'policy-v2', quotedAt: now } } } };
}

function decisionReceipt(kind: 'accept' | 'decline', input: Record<string, unknown>): Record<string, unknown> {
  return { schemaVersion: 1, runId: 'run-1', offerId: String(input['offerId']), commandId: String(input['commandId']),
    requestedDecision: kind, decisionId, state: kind === 'accept' ? 'accepted' : 'declined', reason: kind === 'accept' ? 'accepted' : 'declined',
    offerState: kind === 'accept' ? 'accepted' : 'rejected', holdState: kind === 'accept' ? 'allocated' : 'released',
    offerVersion: 3, holdVersion: 5, quoteVersion: 3, quoteId: 'quote-1', policyVersion: 'policy-v2',
    expiresAt: '2026-11-14T11:00:00.000Z', serverNow: now, clockVersion: 'clock-v3', availableActions: [],
    operationId: null, reconciliationRequired: false, ...(kind === 'accept' ? { selection: null } : {}) };
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const context = (subject = 'employee-subject', runId = 'run-1') => ({ status: 'ready' as const,
  context: { subject, roles: ['employee'] as const, environmentId: 'dev', runId, employeeId: 'employee-1', policyVersion: 'policy-v2', capabilities: [] } });
const contextKey = (subject = 'employee-subject', runId = 'run-1') => JSON.stringify([subject, 'dev', runId, 'employee-1']);

describe('Angular offer API client', () => {
  let state: ReturnType<typeof signal<SessionState>>;
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  let getAccessToken: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
  let load: ReturnType<typeof vi.fn<() => Promise<RuntimePublicConfig>>>;
  let client: OfferClient;

  beforeEach(() => {
    TestBed.resetTestingModule();
    state = signal<SessionState>(context());
    fetcher = vi.fn<typeof fetch>();
    getAccessToken = vi.fn(async () => 'access-token');
    load = vi.fn(async () => config);
    TestBed.configureTestingModule({ providers: [
      { provide: AuthPort, useValue: { state, getAccessToken } },
      { provide: RuntimeConfigService, useValue: { load } },
      { provide: PORTAL_FETCH, useValue: fetcher },
    ] });
    client = TestBed.inject(OfferClient);
  });

  it('reads the exact encoded offer selector with bearer auth, no cookies, and the source projection intact', async () => {
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: offer({ offerId: 'offer/one' }) }));
    const result = await client.readOffer('offer/one');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value.quote.configurationId).toBe('configuration-1');
    expect(result.value.quote.facts.sourceKeys.stockId).toBe('stock-1');
    expect(result.value.quote.facts.facts['seats'].value).toBe(0);
    expect(result.value.quote.facts.facts['mileage'].status).toBe('unknown');
    expect(Object.hasOwn(result.value.quote.facts.facts, 'body')).toBe(false);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`${config.apiBaseUrl}/offers/offer%2Fone?runId=run-1`);
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error' });
    expect(init?.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer access-token' });
    expect(init).not.toHaveProperty('body');
  });

  it('keeps accepted, declined, expired and superseded offers as their returned terminal states', async () => {
    for (const [stateName, offerState, holdState] of [
      ['accepted', 'accepted', 'allocated'], ['declined', 'rejected', 'released'], ['expired', 'expired', 'expired'], ['superseded', 'superseded', 'released'],
    ]) {
      const value = offer({ state: stateName, offerState, holdState, availableActions: [], handoff: null,
        ...(stateName === 'declined' ? { followup: { decisionId } } : {}) });
      fetcher.mockResolvedValueOnce(json({ status: 'ok', value }));
      const result = await client.readOffer('offer-1');
      expect(result.status === 'ok' && result.value.state).toBe(stateName);
    }
  });

  it('fails closed on a malformed projection and does not treat an HTTP error body as success', async () => {
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: { ...offer(), employeeId: 'private' } }));
    expect((await client.readOffer('offer-1')).status).toBe('unavailable');
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: offer() }, 503));
    expect((await client.readOffer('offer-1')).status).toBe('unavailable');
  });

  it('accepts only the versioned server reason registry and preserves its policy provenance', async () => {
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: reasons() }));
    const result = await client.readDecisionReasons('offer/one', 'run-1');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.value.provenance.sourceDate).toBe('2026-11-05');
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${config.apiBaseUrl}/offers/offer%2Fone/decision-reasons?runId=run-1`);

    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: reasons({ key: 'client-copy' }) }));
    expect((await client.readDecisionReasons('offer-1', 'run-1')).status).toBe('unavailable');
    const duplicateReason = { code: 'body-style', label: 'Body style', attribute: 'body' };
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: reasons({ reasons: [duplicateReason, duplicateReason] }) }));
    expect((await client.readDecisionReasons('offer-1', 'run-1')).status).toBe('unavailable');
  });

  it('serializes accept and decline with only their source-defined fields', async () => {
    const accept = { offerId: 'offer/one', runId: 'run-1', commandId: 'command-accept', decision: 'accept' as const,
      expectedOfferVersion: 2, expectedHoldVersion: 4, expectedQuoteVersion: 3, termsDigest: 'terms-digest',
      declarations: { terms: true as const }, expectedReturnMileage: 0 };
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: decisionReceipt('accept', accept) }));
    expect((await client.decide(accept)).status).toBe('ok');
    const [acceptUrl, acceptInit] = fetcher.mock.calls[0];
    expect(acceptUrl).toBe(`${config.apiBaseUrl}/offers/offer%2Fone/decision`);
    expect(JSON.parse(String(acceptInit?.body))).toEqual({ commandId: 'command-accept', runId: 'run-1', decision: 'accept',
      expectedOfferVersion: 2, expectedHoldVersion: 4, expectedQuoteVersion: 3, termsDigest: 'terms-digest',
      declarations: { terms: true }, expectedReturnMileage: 0 });
    expect(acceptInit).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error' });

    const decline = { offerId: 'offer-1', runId: 'run-1', commandId: 'command-decline', decision: 'decline' as const,
      expectedOfferVersion: 2, expectedHoldVersion: 4, expectedQuoteVersion: 3, reasonCode: 'body-style' };
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: decisionReceipt('decline', decline) }));
    expect((await client.decide(decline)).status).toBe('ok');
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ commandId: 'command-decline', runId: 'run-1',
      decision: 'decline', reasonCode: 'body-style', expectedOfferVersion: 2, expectedHoldVersion: 4, expectedQuoteVersion: 3 });
  });

  it('rejects unknown authority fields and caller run mismatches before dispatch', async () => {
    const injected = { offerId: 'offer-1', runId: 'run-1', commandId: 'command-1', decision: 'decline', reasonCode: 'body-style',
      expectedOfferVersion: 2, expectedHoldVersion: 4, expectedQuoteVersion: 3, employeeId: 'other-employee' };
    expect((await client.decide(injected as never)).status).toBe('invalid');
    const wrongRun = { ...injected, employeeId: undefined, runId: 'another-run' };
    delete (wrongRun as Record<string, unknown>)['employeeId'];
    expect((await client.decide(wrongRun as never)).status).toBe('invalid');
    expect(fetcher).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('requires an employee mapping and refuses presenter-only access before token or fetch', async () => {
    state.set({ status: 'ready', context: { ...context().context, roles: ['presenter'], employeeId: undefined } });
    expect((await client.readOffer('offer-1')).status).toBe('denied');
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('preserves a typed refusal and never replays a command after 401', async () => {
    const decline = { offerId: 'offer-1', runId: 'run-1', commandId: 'command-1', decision: 'decline' as const,
      expectedOfferVersion: 2, expectedHoldVersion: 4, expectedQuoteVersion: 3, reasonCode: 'body-style' };
    fetcher.mockResolvedValueOnce(json({ status: 'unauthenticated', code: 'token-expired', retryable: false }, 401));
    expect(await client.decide(decline)).toEqual({ status: 'unauthenticated', code: 'token-expired', retryable: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getAccessToken).toHaveBeenCalledTimes(1);

    fetcher.mockResolvedValueOnce(json({ status: 'stale-version', expectedVersion: 2, currentVersion: 3,
      action: 'refresh', resourceType: 'offer' }, 409));
    expect(await client.decide(decline)).toEqual({ status: 'stale-version', expectedVersion: 2, currentVersion: 3,
      action: 'refresh', resourceType: 'offer' });
  });

  it('discards a request when the signed-in context changes while the token is pending', async () => {
    let finish!: (token: string | null) => void;
    getAccessToken.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = client.readOffer('offer-1', { expectedContextKey: contextKey() });
    state.set(context('another-subject'));
    finish('new-account-token');
    expect((await pending).status).toBe('unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('discards a successful response that arrives after the signed-in run changes', async () => {
    let finish!: (response: Response) => void;
    fetcher.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = client.readOffer('offer-1', { expectedContextKey: contextKey() });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    state.set(context('employee-subject', 'run-2'));
    finish(json({ status: 'ok', value: offer() }));
    expect((await pending).status).toBe('unavailable');
  });

  it('reads every server follow-up state, including savedChange on unavailable responses', async () => {
    for (const stateName of ['question', 'change-saved', 'waiting', 'no-match', 'ready'] as const) {
      fetcher.mockResolvedValueOnce(json({ status: 'ok', value: followup(stateName) }));
      expect((await client.readFollowup(decisionId)).status).toBe('ok');
    }
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${config.apiBaseUrl}/offer-followup?decisionId=${encodeURIComponent(decisionId)}`);

    fetcher.mockResolvedValueOnce(json({ status: 'unavailable', code: 'followup-evaluation-unavailable', retryable: true,
      savedChange: savedChange() }, 503));
    const unavailableResult = await client.readFollowup(decisionId);
    expect(unavailableResult.status).toBe('unavailable');
    if (unavailableResult.status === 'unavailable') expect(unavailableResult.savedChange?.state).toBe('change-saved');
  });

  it('confirms the exact follow-up command once and requires an operation ID for HTTP 202', async () => {
    const input = { commandId: 'followup-command', decisionId, expectedBriefVersion: 5, questionVersion: 'question-v1', value: 'estate' };
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: followup('change-saved') }));
    expect((await client.confirmFollowup(input)).status).toBe('ok');
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${config.apiBaseUrl}/offer-followup/confirm`);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(input);

    fetcher.mockResolvedValueOnce(json({ status: 'pending' }, 202));
    expect((await client.confirmFollowup(input)).status).toBe('unavailable');
    fetcher.mockResolvedValueOnce(json({ status: 'pending', operationId: 'followup-operation', operationType: 'brief-change',
      runId: 'run-1', decisionId, commandId: input.commandId }, 202));
    expect(await client.confirmFollowup(input)).toMatchObject({ status: 'pending', operationId: 'followup-operation' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
