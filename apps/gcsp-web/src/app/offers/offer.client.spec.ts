import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService, RuntimePublicConfig } from '../auth/runtime-config';
import { OfferClient } from './offer.client';
import { offerCommandProducerFixtures } from './offer-command-producer.fixture';

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
    comparison: { schemaVersion: 1, currentBriefVersion: 6, requirements: [{ kind: 'preference', key: 'body', value: 'estate', importance: 1,
      previousFacts: { body: { status: 'unknown', value: null, unit: null, provenance: null } },
      nextFacts: { body: { status: 'unknown', value: null, unit: null, provenance: null } } }],
      previous: { offer: offer({ state: 'declined', offerState: 'rejected', holdState: 'released', availableActions: [], handoff: null, followup: { decisionId } }), scoreBasis: { kind: 'historical-quote', briefVersion: 5, policyVersion: 'policy-v2', quotedAt: now } },
      next: { offer: offer({ offerId: 'offer-2', quote: { ...(offer()['quote'] as object), quoteId: 'quote-2', briefVersion: 6 } }), scoreBasis: { kind: 'historical-quote', briefVersion: 6, policyVersion: 'policy-v2', quotedAt: now } } } };
}

function decisionReceipt(kind: 'accept' | 'decline', input: Record<string, unknown>): Record<string, unknown> {
  return { schemaVersion: 1, runId: 'run-1', offerId: String(input['offerId']), commandId: String(input['commandId']),
    requestedDecision: kind, decisionId, state: kind === 'accept' ? 'accepted' : 'declined', reason: kind === 'accept' ? 'accepted' : 'declined',
    offerState: kind === 'accept' ? 'accepted' : 'rejected', holdState: kind === 'accept' ? 'allocated' : 'released',
    offerVersion: 3, holdVersion: 5, quoteVersion: 3, quoteId: 'quote-1', policyVersion: 'policy-v2',
    expiresAt: '2026-11-14T11:00:00.000Z', serverNow: now, clockVersion: 'clock-v3', availableActions: [],
    operationId: null, reconciliationRequired: false, ...(kind === 'accept' ? { selection: commandHandoff() } : {}) };
}

// ManualOrderService's command projection, distinct from OfferAccessService's read selection.
function commandHandoff(state: 'acknowledged' | 'handoff-pending' | 'handoff-failed' = 'acknowledged') {
  const operationId = `selection:${'b'.repeat(64)}`;
  const names = ['HR approval', 'sales-manager approval', 'sent to ordering'];
  const acknowledged = state === 'acknowledged'; const failed = state === 'handoff-failed';
  const scope = { operationId, runId: 'run-1', orderUuid: 'stock-1' };
  return { schemaVersion: 1, operationId, operationState: acknowledged ? 'acknowledged' : failed ? 'handoff-failed' : 'unknown',
    selectionReceived: true, orderReference: 'GCSP-000001',
    selection: { schemaVersion: 1, orderReference: 'GCSP-000001', receivedAt: now, renewalId: null,
      source: { type: 'buddy-offer', holdId: 'hold-1', expectedHoldVersion: 4, expectedDraftVersion: 5 },
      quote: { ...(offer()['quote'] as object), runId: 'run-1', employeeId: 'employee-1', entitlementSlotId: 'slot-1', version: 3 },
      stock: { orderUuid: 'stock-1', orderNumber: '0123456', configurationId: 'configuration-1', facts: (offer()['quote'] as Record<string, unknown>)['facts'] },
      terms: { schemaVersion: 1, termsVersion: 'terms-v1', policyVersion: 'policy-v2', wording: 'Terms apply.', fictional: true,
        approvalStages: names, declarations: [{ id: 'terms', label: 'I accept the terms.', appliesTo: 'all' }] },
      declarations: { terms: true }, draft: { draftVersion: 5, choices: { mode: 'new' } },
      employee: { name: 'Synthetic employee' }, driver: { name: 'Synthetic driver' }, oldContract: null,
      sourceVersions: { employee: 1, brief: 5 },
      employeeAuthority: { employeeId: 'employee-1', principalId: 'employee-subject', companyId: 'company-1', gradeId: 'grade-1', schemeId: 'scheme-1', version: 1 },
      vehicleSlot: { runId: 'run-1', entitlementSlotId: 'slot-1', employeeId: 'employee-1', state: 'active', version: 1 }, reviewDetails: null },
    progress: { schemaVersion: 1, selectionState: state, approved: false, current: acknowledged ? names[0] : 'selection received',
      stages: [{ name: 'selection received', state: acknowledged ? 'complete' : failed ? 'failed' : 'pending' },
        ...names.map((name, index) => ({ name, state: acknowledged && index === 0 ? 'waiting' : 'not-started' }))] },
    order: acknowledged ? { status: 'confirmed', ...scope, configurationId: 'configuration-1', orderNumber: '0123456', orderStatus: names[0], fictional: true } : null,
    failure: failed ? { status: 'rejected', ...scope, reason: 'synthetic-ordering-refused', fictional: true } : null,
    view: { state: acknowledged ? 'awaiting-approval' : failed ? 'handoff-failed' : 'handoff-pending',
      action: acknowledged ? 'view-order' : failed ? 'contact-support' : 'check-status' } };
}

const acceptInput = { offerId: 'offer-1', runId: 'run-1', commandId: 'command-accept', decision: 'accept' as const,
  expectedOfferVersion: 2, expectedHoldVersion: 4, expectedQuoteVersion: 3, termsDigest: 'terms-digest', declarations: { terms: true as const } };

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

  it('preserves the source partial comparison when no current-car facts were recorded', async () => {
    const missing = { ...comparison, status: 'partial', reason: 'current-car-facts-unavailable',
      currentCar: { model: '3 Series', source: { mode: 'dated-snapshot', sourceVersion: 'current-contract-v1', observedAt: now } } };
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: offer({ comparison: missing }) }));
    const result = await client.readOffer('offer-1');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value.comparison).toEqual(missing);
    expect(result.value.comparison.currentCar).not.toHaveProperty('facts');
    expect(result.value.quote.configurationId).toBe('configuration-1');
    expect(result.value.quote.terms.points.value).toBe(0);
  });

  it('requires comparison facts and unknowns to partition the source keys with a pinned observation time', async () => {
    const partial = { status: 'partial', reason: 'current-car-facts-recorded', comparisonAvailable: true,
      currentCar: { model: '3 Series', source: { mode: 'dated-snapshot', sourceVersion: 'current-contract-v1', observedAt: now },
        facts: { seats: { value: 5, unit: null } } }, unknowns: comparison.unknowns.filter((key) => key !== 'seats') };
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: offer({ comparison: partial }) }));
    expect((await client.readOffer('offer-1')).status).toBe('ok');
    for (const malformed of [
      { ...partial, unknowns: comparison.unknowns },
      { ...partial, unknowns: [] },
      { ...partial, comparisonAvailable: false },
      { ...partial, currentCar: { ...partial.currentCar, facts: { seats: { value: 0, unit: null } } } },
      { ...partial, currentCar: { ...partial.currentCar, source: { ...partial.currentCar.source, observedAt: '2026-11-14T10:00:00.000Z' } } },
    ]) {
      fetcher.mockResolvedValueOnce(json({ status: 'ok', value: offer({ comparison: malformed }) }));
      expect((await client.readOffer('offer-1')).status).toBe('unavailable');
    }
  });

  it('types source explanation strings and nested requirement/fact records without losing zero values', async () => {
    const quote = offer()['quote'] as Record<string, unknown>;
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: offer({ quote: { ...quote,
      decision: { ...(quote['decision'] as object), reasons: ['Recorded explanation.',
        { field: 'seats', fact: fact('known', 0), requirement: { value: 5, operator: 'gte', unit: null } }] } } }) }));
    const result = await client.readOffer('offer-1');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const [message, detail] = result.value.quote.decision.reasons;
    if (typeof message === 'string') expect(message.startsWith('Recorded')).toBe(true);
    if (typeof detail === 'string') throw new Error('Expected a typed source explanation record.');
    expect(detail.fact?.value).toBe(0);
    expect(detail.requirement?.value).toBe(5);
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

  it.each(['acknowledged', 'handoff-pending', 'handoff-failed'] as const)(
    'preserves accepted receipt and separate %s ordering progress without claiming approval', async (progressState) => {
      const raw = commandHandoff(progressState);
      fetcher.mockResolvedValueOnce(json({ status: 'ok', value: { ...decisionReceipt('accept', acceptInput), selection: raw } }));
      const result = await client.decide(acceptInput);
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.value.state).toBe('accepted');
      expect(result.value.selection?.progress.selectionState).toBe(progressState);
      expect(result.value.selection?.progress.approved).toBe(false);
      expect(result.value.selection?.operationState).toBe(raw.operationState);
      expect(result.value.selection?.selectionReceived).toBe(true);
      expect(result.value.selection?.view).toEqual(raw.view);
      expect(result.value.selection?.order).toEqual(raw.order);
      expect(result.value.selection?.failure).toEqual(raw.failure);
      expect(result.value.selection?.selection.stock.orderNumber).toBe('0123456');
      expect(result.value.selection?.selection.quote.quoteId).toBe('quote-1');
      expect(result.value.selection?.selection).not.toHaveProperty('employeeAuthority');
      expect(result.value.selection?.selection).not.toHaveProperty('driver');
      expect(result.value.selection?.selection.stock).not.toHaveProperty('facts');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

  it.each(offerCommandProducerFixtures)('reads the actual $state producer receipt', async ({ input, receipt, state: progressState }) => {
    state.set({ status: 'ready', context: { ...context().context, runId: input.runId, employeeId: receipt.selection.selection.employeeAuthority.employeeId } });
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: receipt }));
    const result = await client.decide(input);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value.decisionId).toBe(receipt.decisionId);
    expect(result.value.selection?.progress.selectionState).toBe(progressState);
    expect(result.value.selection?.progress.approved).toBe(false);
    expect(result.value.selection?.view).toEqual(receipt.selection.view);
    expect(result.value.selection?.order).toEqual(receipt.selection.order);
    expect(result.value.selection?.failure).toEqual(receipt.selection.failure);
    expect(result.value.selection?.selection.quote.quoteId).toBe(receipt.quoteId);
    expect(result.value.selection?.selection.stock).toEqual({ orderUuid: receipt.selection.selection.stock.orderUuid,
      orderNumber: receipt.selection.selection.stock.orderNumber, configurationId: receipt.selection.selection.stock.configurationId });
    expect(result.value.selection?.selection).not.toHaveProperty('employeeAuthority');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects mismatched ordering identities and contradictory progress without replay', async () => {
    const baseline = commandHandoff();
    for (const selection of [
      { ...baseline, operationId: `selection:${'c'.repeat(64)}` },
      { ...baseline, selection: { ...baseline.selection, quote: { ...baseline.selection.quote, quoteId: 'other-quote' } } },
      { ...baseline, selection: { ...baseline.selection, quote: { ...baseline.selection.quote, runId: 'other-run' } } },
      { ...baseline, selection: { ...baseline.selection, stock: { ...baseline.selection.stock, orderUuid: 'other-stock' } } },
      { ...baseline, selection: { ...baseline.selection, quote: { ...baseline.selection.quote, employeeId: 'other-employee' } } },
      { ...baseline, view: { state: 'handoff-pending', action: 'check-status' } },
      { ...baseline, progress: { ...baseline.progress, approved: true } },
      { ...baseline, order: { ...baseline.order!, runId: 'other-run' } },
      { ...baseline, order: { ...baseline.order!, orderStatus: 'approved' } },
    ]) {
      fetcher.mockResolvedValueOnce(json({ status: 'ok', value: { ...decisionReceipt('accept', acceptInput), selection } }));
      expect((await client.decide(acceptInput)).status).toBe('unavailable');
    }
    expect(fetcher).toHaveBeenCalledTimes(9);
  });

  it('binds command receipts to the requested offer, run and command identity', async () => {
    for (const override of [
      { offerId: 'other-offer' }, { runId: 'other-run' }, { commandId: 'other-command' },
      { decisionId: 'unrecognised-decision' }, { requestedDecision: 'decline' },
    ]) {
      fetcher.mockResolvedValueOnce(json({ status: 'ok', value: { ...decisionReceipt('accept', acceptInput), ...override } }));
      expect((await client.decide(acceptInput)).status).toBe('unavailable');
    }
    expect(fetcher).toHaveBeenCalledTimes(5);
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

  it('validates the real nested offer projections and score pins before declaring a follow-up ready', async () => {
    const ready = followup('ready');
    const comparison = ready['comparison'] as Record<string, unknown>;
    const previous = comparison['previous'] as Record<string, unknown>;
    const next = comparison['next'] as Record<string, unknown>;
    const nextOffer = next['offer'] as Record<string, unknown>;
    for (const malformed of [
      { ...comparison, next: { ...next, offer: { state: 'pending' } } },
      { ...comparison, previous: { ...previous, offer: { state: 'declined' } } },
      { ...comparison, next: { ...next, offer: { ...nextOffer, runId: 'another-run' } } },
      { ...comparison, next: { ...next, scoreBasis: { kind: 'historical-quote', briefVersion: 7, policyVersion: 'policy-v2', quotedAt: now } } },
      { ...comparison, next: { ...next, offer: { ...nextOffer, offerId: 'offer-1' } } },
      { ...comparison, currentBriefVersion: 7 },
      { ...comparison, previous: { ...previous, offer: { ...(previous['offer'] as object), runId: 'other-run' } },
        next: { ...next, offer: { ...nextOffer, runId: 'other-run' } } },
    ]) {
      fetcher.mockResolvedValueOnce(json({ status: 'ok', value: { ...ready, comparison: malformed } }));
      expect((await client.readFollowup(decisionId)).status).toBe('unavailable');
    }
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
