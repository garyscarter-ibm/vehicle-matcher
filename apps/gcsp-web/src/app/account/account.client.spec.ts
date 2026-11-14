import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationContext, AuthPort, SessionState } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService, RuntimePublicConfig } from '../auth/runtime-config';
import { AccountClient } from './account.client';
import { AccountOrder, AccountOrdersPage, latestOrder, orderVehicle } from './account.preview';
import { accountSnapshot, savedDraft } from './account.test-data';
import { DiscardDraftCommand, SaveDraftCommand, SaveNotificationEmailCommand } from './account.types';

const context: ApplicationContext = { subject: 'trusted-subject', roles: ['employee'], environmentId: 'isolated',
  runId: 'demo-ecbf8fbcd78d4f7316302db1afd2a440', employeeId: 'employee-paula', policyVersion: 'gcsp-policy-v1', capabilities: ['account:read'] };
const config: RuntimePublicConfig = { schemaVersion: 1, environmentId: 'isolated', apiBaseUrl: 'https://api.example/api/gcsp/v1',
  oidc: { authority: 'https://issuer.example', clientId: 'public-client', scope: 'openid', redirectUri: 'https://portal.example/gcsp/auth/callback', postLogoutRedirectUri: 'https://portal.example/gcsp/' } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ok = (value: unknown) => json({ status: 'ok', value });
const page = (orders: readonly AccountOrder[] = [], extra: Partial<AccountOrdersPage> = {}): AccountOrdersPage => ({ orders, failed: [], failedCount: 0, nextAfter: null, ...extra });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const command = (): SaveDraftCommand => ({ commandId: 'deliberate-command', expectedDraftVersion: 2,
  expectedContextVersion: accountSnapshot().contextVersion!, choices: savedDraft().choices });

describe('native signed-in account client', () => {
  const state = signal<SessionState>({ status: 'ready', context });
  const getAccessToken = vi.fn(async (): Promise<string | null> => 'access-token'); const retry = vi.fn();
  const fetcher = vi.fn<typeof fetch>(); const load = vi.fn(async () => config);
  let client: AccountClient;
  beforeEach(() => {
    state.set({ status: 'ready', context }); getAccessToken.mockReset().mockResolvedValue('access-token'); retry.mockReset();
    fetcher.mockReset(); load.mockReset().mockResolvedValue(config);
    TestBed.configureTestingModule({ providers: [{ provide: AuthPort, useValue: { state, getAccessToken, retry } },
      { provide: RuntimeConfigService, useValue: { load } }, { provide: PORTAL_FETCH, useValue: fetcher }] });
    client = TestBed.inject(AccountClient);
  });
  afterEach(() => { vi.useRealTimers(); });
  it('uses fixed full-v1 paths, bearer credentials and no authority query/body on every read', async () => {
    const input = accountSnapshot(); const stock = { total: 0, cars: [], decisions: [], versions: { draft: 3, context: input.contextVersion } };
    fetcher.mockResolvedValueOnce(ok(input)).mockResolvedValueOnce(ok(savedDraft())).mockResolvedValueOnce(ok({ version: 0, deliveryEmail: null })).mockResolvedValueOnce(ok(stock));
    expect(await client.readAccount()).toEqual({ status: 'ok', value: input }); expect((await client.readDraft()).status).toBe('ok');
    expect(await client.readNotificationEmail()).toEqual({ status: 'ok', value: { version: 0, deliveryEmail: null } });
    expect(await client.readStock()).toEqual({ status: 'ok', value: stock });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['account', 'draft', 'notification-email', 'stock'].map((path) => `${config.apiBaseUrl}/manual/${path}`));
    for (const [, options] of fetcher.mock.calls) {
      expect(options).toEqual(expect.objectContaining({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json', Authorization: 'Bearer access-token' } }));
      expect(options?.body).toBeUndefined(); expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
  });
  it('reads preview paths through the same bearer boundary and uses only the trusted run for owned offer detail', async () => {
    const offers = { offers: [{ offerId: 'offer/id?with-query', runId: context.runId }] };
    const orders = page([{ orderUuid: 'exact-stock', entitlementSlotId: 'slot', source: { orderNumber: 'supplied' } }]);
    const snapshot = { selection: { stock: { orderUuid: 'exact-stock', facts: { display: { name: 'BMW i4' } } } }, retainedFact: 'source' };
    fetcher.mockResolvedValueOnce(ok(offers)).mockResolvedValueOnce(ok({ state: 'pending', runId: context.runId }))
      .mockResolvedValueOnce(ok(orders)).mockResolvedValueOnce(ok(snapshot));
    expect(await client.readOffers()).toEqual({ status: 'ok', value: { offers: [{ ...offers.offers[0], state: 'pending' }] } });
    expect(await client.readOrders()).toEqual({ status: 'ok', value: { ...orders, pageEvidence: [{ after: null, nextAfter: null, failedCount: 0 }] } }); expect(await client.readOrder()).toEqual({ status: 'ok', value: snapshot });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([`${config.apiBaseUrl}/offers/current`,
      `${config.apiBaseUrl}/offers/offer%2Fid%3Fwith-query?runId=${encodeURIComponent(context.runId)}`, `${config.apiBaseUrl}/orders/progress/all`, `${config.apiBaseUrl}/manual/order`]);
    for (const [, options] of fetcher.mock.calls) { expect(options).toMatchObject({ method: 'GET', credentials: 'omit', headers: { Authorization: 'Bearer access-token' } }); expect(options?.body).toBeUndefined(); }
  });
  it('keeps empty previews distinct from failed reads and rejects embedded foreign offer authority before detail fetch', async () => {
    fetcher.mockResolvedValueOnce(ok({ offers: [] })).mockResolvedValueOnce(ok(page()));
    expect(await client.readOffers()).toEqual({ status: 'ok', value: { offers: [] } }); expect(await client.readOrders()).toEqual({ status: 'ok', value: { orders: [], failed: [], failedCount: 0, nextAfter: null, pageEvidence: [{ after: null, nextAfter: null, failedCount: 0 }] } });
    fetcher.mockClear(); fetcher.mockResolvedValueOnce(ok({ offers: [{ offerId: 'private', runId: 'foreign-run' }] }));
    expect(await client.readOffers()).toEqual({ status: 'unavailable', code: 'account-response-scope-mismatch', retryable: false }); expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockResolvedValueOnce(ok({ offers: [{ offerId: 'own', runId: context.runId }] })).mockResolvedValueOnce(json({ status: 'forbidden', contractVersion: '1' }, 403));
    expect(await client.readOffers()).toEqual({ status: 'forbidden', contractVersion: '1', httpStatus: 403 });
    fetcher.mockResolvedValueOnce(ok({ offers: [{ offerId: 'own', runId: context.runId }] })).mockResolvedValueOnce(ok({ state: 'pending', offerId: 'different' }));
    expect(await client.readOffers()).toEqual({ status: 'unavailable', code: 'account-response-offer-mismatch', retryable: false });
  });
  it('drops late preview facts and a newest-offer response when the signed-in scope changes', async () => {
    const detail = deferred<Response>();
    fetcher.mockResolvedValueOnce(ok({ offers: [{ offerId: 'own', runId: context.runId }] })).mockReturnValueOnce(detail.promise);
    const pending = client.readOffers(); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    state.set({ status: 'ready', context: { ...context, employeeId: 'different' } }); detail.resolve(ok({ state: 'pending', private: 'old facts' }));
    expect((await pending).status).toBe('account-changed');
    state.set({ status: 'ready', context }); fetcher.mockResolvedValueOnce(ok({ orders: [{ orderUuid: 'private', entitlementSlotId: 'slot', source: { employeeId: 'foreign' } }] }));
    expect((await client.readOrders()).status).toBe('unavailable');
  });
  it('reads an encoded, immutable page query without caller-selected authority', async () => {
    const token = deferred<string | null>(); getAccessToken.mockReturnValueOnce(token.promise);
    const query = { after: 'uuid/with?query&unicode=é', limit: 100 }; fetcher.mockResolvedValueOnce(ok(page()));
    const pending = client.readOrdersPage(query); query.after = 'changed'; query.limit = 1; token.resolve('access-token');
    expect(await pending).toEqual({ status: 'ok', value: page() });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(`${config.apiBaseUrl}/orders/progress/all?after=uuid%2Fwith%3Fquery%26unicode%3D%C3%A9&limit=100`);
    expect(options).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer access-token' } });
    expect(options?.body).toBeUndefined();
    fetcher.mockClear();
    for (const bad of [{ after: '' }, { after: 'x'.repeat(201) }, { after: 'bad\n' }, { after: null },
      { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { employeeId: 'other' }, { runId: 'old' }]) {
      expect((await client.readOrdersPage(bad as Parameters<AccountClient['readOrdersPage']>[0])).status).toBe('invalid');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('continues through empty owned pages and selects newest only from the exhausted collection', async () => {
    const old = { orderUuid: 'z-old', entitlementSlotId: 'slot', source: { receivedAt: '2026-11-01T00:00:00Z' } };
    const newest = { orderUuid: 'a-new', entitlementSlotId: 'slot', source: { receivedAt: '2026-11-02T00:00:00Z' } };
    fetcher.mockResolvedValueOnce(ok(page([], { nextAfter: 'cursor-1', asOf: 'time-1', contractVersion: 'lifecycle.stages.v1' })))
      .mockResolvedValueOnce(ok(page([old], { nextAfter: 'cursor-2', asOf: 'time-2' })))
      .mockResolvedValueOnce(json({ status: 'ok', contractVersion: 'envelope-v1', value: page([newest]) }));
    const result = await client.readOrders(); expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('Complete list expected');
    expect(result.value.orders).toEqual([old, newest]); expect(latestOrder(result.value.orders)).toEqual(newest);
    expect(result.value).not.toHaveProperty('asOf'); expect(result.value.nextAfter).toBeNull();
    expect(result.value.pageEvidence).toEqual([
      { after: null, nextAfter: 'cursor-1', failedCount: 0, asOf: 'time-1', contractVersion: 'lifecycle.stages.v1' },
      { after: 'cursor-1', nextAfter: 'cursor-2', failedCount: 0, asOf: 'time-2' },
      { after: 'cursor-2', nextAfter: null, failedCount: 0, envelopeContractVersion: 'envelope-v1' },
    ]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([`${config.apiBaseUrl}/orders/progress/all`,
      `${config.apiBaseUrl}/orders/progress/all?after=cursor-1`, `${config.apiBaseUrl}/orders/progress/all?after=cursor-2`]);
  });
  it('retains bounded per-row failures with exact counts and never calls the incomplete list successful', async () => {
    const failed = Array.from({ length: 20 }, (_, i) => ({ orderUuid: `bad-${i}`, status: 'unavailable', code: 'selection-source-invalid' }));
    const own = { orderUuid: 'good', entitlementSlotId: 'slot' };
    fetcher.mockResolvedValueOnce(ok(page([own], { failed, failedCount: 35, nextAfter: 'later' })))
      .mockResolvedValueOnce(ok(page([], { failed, failedCount: 30 })));
    const result = await client.readOrders(); expect(result).toMatchObject({ status: 'unavailable', code: 'account-orders-incomplete',
      partial: { orders: [own], failedCount: 65, nextAfter: null }, failedAfter: 'later' });
    if (result.status === 'ok') throw new Error('Incomplete collection');
    expect(result.partial?.failed).toEqual(failed); expect(result.partial?.pageEvidence.map((p) => p.failedCount)).toEqual([35, 30]);
    expect(result).not.toHaveProperty('value');
  });
  it('retains a collection envelope version only when every page supplies the same version', async () => {
    for (const laterVersion of ['v1', 'v2', undefined]) {
      fetcher.mockResolvedValueOnce(json({ status: 'ok', contractVersion: 'v1', value: page([], { nextAfter: 'later' }) }))
        .mockResolvedValueOnce(json({ status: 'ok', ...(laterVersion === undefined ? {} : { contractVersion: laterVersion }), value: page() }));
      const result = await client.readOrders(); expect(result.status).toBe('ok');
      if (laterVersion === 'v1') expect(result).toHaveProperty('contractVersion', 'v1');
      else expect(result).not.toHaveProperty('contractVersion');
    }
  });
  it('preserves an exact later-page failure and preceding rows with the unconsumed cursor', async () => {
    const own = { orderUuid: 'good', entitlementSlotId: 'slot' };
    fetcher.mockResolvedValueOnce(ok(page([own], { nextAfter: 'later' }))).mockResolvedValueOnce(json({ status: 'unavailable',
      code: 'database-unavailable', reason: 'Try later', retryable: true, operationId: 'source-operation', value: { private: 'discard' } }, 503));
    expect(await client.readOrders()).toMatchObject({ status: 'unavailable', code: 'database-unavailable', reason: 'Try later', retryable: true,
      operationId: 'source-operation', httpStatus: 503, failedAfter: 'later', partial: { orders: [own], nextAfter: 'later' } });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(retry).not.toHaveBeenCalled();
  });
  it('refuses repeated cursors and malformed page metadata without manufacturing completeness', async () => {
    fetcher.mockResolvedValueOnce(ok(page([], { nextAfter: 'repeat' }))).mockResolvedValueOnce(ok(page([], { nextAfter: 'repeat' })));
    expect(await client.readOrders()).toMatchObject({ status: 'unavailable', code: 'account-orders-cursor-repeated', partial: { nextAfter: 'repeat' } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const invalid of [{ orders: [] }, page([], { nextAfter: '' }), page([], { failedCount: -1 }),
      page([], { failed: [{ orderUuid: 'bad', status: 'unavailable', code: 'bad' }], failedCount: 0 })]) {
      fetcher.mockResolvedValueOnce(ok(invalid));
      expect(await client.readOrders()).toMatchObject({ status: 'unavailable', code: 'account-response-invalid' });
    }
  });
  it('retains actual flat acknowledged/refused snapshots and scoped pending values without fabricating vehicle facts', async () => {
    const snapshot = { schemaVersion: 1, operationId: 'operation', status: 'acknowledged', selection: { orderUuid: 'exact', orderNumber: null,
      configurationId: 'config', receivedAt: null }, progress: { selectionState: 'acknowledged' } };
    for (const status of ['acknowledged', 'refused']) {
      const value = { ...snapshot, status }; fetcher.mockResolvedValueOnce(ok(value));
      expect(await client.readOrder()).toEqual({ status: 'ok', value }); expect(orderVehicle(value, 'exact')).toBeNull();
    }
    for (const extra of [{ value: snapshot }, { value: null }, {}]) {
      const response = { status: 'pending', operationId: 'operation', code: 'handoff-pending', retryable: false, ...extra };
      fetcher.mockResolvedValueOnce(json(response, 202)); expect(await client.readOrder()).toEqual({ ...response, httpStatus: 202 });
    }
    fetcher.mockResolvedValueOnce(json({ status: 'pending', operationId: 'operation', value: { selection: { orderUuid: 123 } } }, 202));
    expect((await client.readOrder()).status).toBe('unavailable');
    fetcher.mockResolvedValueOnce(json({ status: 'pending', operationId: 'operation', value: { ...snapshot, employeeId: 'foreign' } }, 202));
    expect(await client.readOrder()).toEqual({ status: 'unavailable', code: 'account-response-scope-mismatch', retryable: false });
    fetcher.mockResolvedValueOnce(json({ status: 'pending', operationId: 'operation', value: snapshot }, 202));
    expect(await client.saveDraft(command())).toEqual({ status: 'pending', operationId: 'operation', httpStatus: 202 });
  });
  it('drops all accumulated facts when any auth scope part changes during the second page', async () => {
    for (const delta of [{ subject: 'new' }, { employeeId: 'new' }, { environmentId: 'new' }, { runId: 'new' }]) {
      state.set({ status: 'ready', context }); fetcher.mockClear(); const later = deferred<Response>();
      fetcher.mockResolvedValueOnce(ok(page([{ orderUuid: 'private', entitlementSlotId: 'slot' }], { nextAfter: 'later' }))).mockReturnValueOnce(later.promise);
      const result = client.readOrders(); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      state.set({ status: 'ready', context: { ...context, ...delta } }); later.resolve(ok(page()));
      expect(await result).toEqual({ status: 'account-changed', code: 'account-context-changed', retryable: false });
    }
  });
  it('drops accumulated rows on a second-page authentication or embedded ownership refusal', async () => {
    for (const response of [json({ status: 'unauthenticated', code: 'expired' }, 401),
      ok(page([{ orderUuid: 'foreign', entitlementSlotId: 'slot', employeeId: 'other' }]))]) {
      fetcher.mockResolvedValueOnce(ok(page([{ orderUuid: 'private', entitlementSlotId: 'slot' }], { nextAfter: 'later' }))).mockResolvedValueOnce(response);
      const result = await client.readOrders(); expect(result.status).not.toBe('ok'); expect(result).not.toHaveProperty('partial'); expect(result).not.toHaveProperty('value');
    }
  });
  it('does not fetch the next page after scope change while reading credentials or public configuration', async () => {
    for (const phase of ['config', 'token']) {
      state.set({ status: 'ready', context }); fetcher.mockClear(); load.mockClear(); getAccessToken.mockClear();
      const gate = deferred<RuntimePublicConfig>(); const token = deferred<string | null>();
      if (phase === 'config') load.mockResolvedValueOnce(config).mockReturnValueOnce(gate.promise);
      else getAccessToken.mockResolvedValueOnce('access-token').mockReturnValueOnce(token.promise);
      fetcher.mockResolvedValueOnce(ok(page([{ orderUuid: 'private', entitlementSlotId: 'slot' }], { nextAfter: 'later' })));
      const result = client.readOrders(); await vi.waitFor(() => expect(phase === 'config' ? load : getAccessToken).toHaveBeenCalledTimes(2));
      state.set({ status: 'signed-out' }); gate.resolve(config); token.resolve('other-token');
      expect((await result).status).toBe('account-changed'); expect(fetcher).toHaveBeenCalledOnce();
    }
  });
  it('cancels a later page without exposing accumulated rows, even if transport resolves late', async () => {
    const stopped = new AbortController(); stopped.abort(); expect((await client.readOrders({ signal: stopped.signal })).status).toBe('aborted'); expect(fetcher).not.toHaveBeenCalled();
    const caller = new AbortController(); const later = deferred<Response>();
    fetcher.mockResolvedValueOnce(ok(page([{ orderUuid: 'private', entitlementSlotId: 'slot' }], { nextAfter: 'later' }))).mockReturnValueOnce(later.promise);
    const result = client.readOrders({ signal: caller.signal }); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    caller.abort(); expect(await result).toEqual({ status: 'aborted', code: 'account-request-aborted', retryable: false });
    expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true); later.resolve(ok(page()));
  });
  it('uses one finite deadline for all pages and retains the completed-page checkpoint', async () => {
    vi.useFakeTimers();
    fetcher.mockImplementationOnce(async () => { await new Promise((resolve) => setTimeout(resolve, 6000)); return ok(page([], { nextAfter: 'later' })); })
      .mockReturnValueOnce(new Promise<Response>(() => {}));
    const result = client.readOrders(); await vi.advanceTimersByTimeAsync(6001); expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await result).toMatchObject({ status: 'unavailable', code: 'account-timeout', retryable: true, failedAfter: 'later',
      partial: { nextAfter: 'later', pageEvidence: [{ after: null, nextAfter: 'later', failedCount: 0 }] } });
  });
  it('retains the documented compact stock availability projection without importing a legacy controller', async () => {
    const value = { payloadShape: 'manual-stock-compact-v1', carIds: ['exact-car'], sharedVersionKeys: ['policy'], total: 1,
      decisions: [{ orderUuid: 'exact-car', versions: {} }], versions: { draft: 3, context: 'source-context', policy: 'retained' } };
    fetcher.mockResolvedValueOnce(ok(value)); expect(await client.readStock()).toEqual({ status: 'ok', value });
  });
  it('retains a supplied envelope contract revision on successful and refused outcomes', async () => {
    const envelope = { status: 'ok', value: accountSnapshot(), contractVersion: '1.0.0' };
    fetcher.mockResolvedValueOnce(json(envelope)); expect(await client.readAccount()).toEqual(envelope);
    const failure = { status: 'stale-version', resource: 'manual-draft', contractVersion: '1.0.0' };
    fetcher.mockResolvedValueOnce(json(failure, 409)); expect(await client.readDraft()).toEqual({ ...failure, httpStatus: 409 });
  });
  it('POSTs exact intentional draft, discard and owned notification command bodies with CAS versions', async () => {
    const draft = command(); const discard = { commandId: 'discard', expectedDraftVersion: 3 };
    const email = { commandId: 'email', expectedVersion: 0, deliveryEmail: 'own-notification@example.test' };
    fetcher.mockResolvedValueOnce(ok(savedDraft())).mockResolvedValueOnce(ok({ draftVersion: 4, discarded: true }))
      .mockResolvedValueOnce(ok({ version: 1, deliveryEmail: email.deliveryEmail }));
    await client.saveDraft(draft); await client.discardDraft(discard); await client.saveNotificationEmail(email);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['draft', 'draft/discard', 'notification-email'].map((path) => `${config.apiBaseUrl}/manual/${path}`));
    [draft, discard, email].forEach((expected, index) => {
      const options = fetcher.mock.calls[index][1]; expect(options?.method).toBe('POST'); expect(JSON.parse(options?.body as string)).toEqual(expected);
      expect(options?.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer access-token', 'Content-Type': 'application/json' });
    });
    expect(retry).not.toHaveBeenCalled();
  });
  it('preserves all registered manual option fields without adding identity or source authority', async () => {
    const input = { ...command(), choices: { ...command().choices, driverId: 'driver:employee-paula', contractOptionId: 'six-month-8000',
      requestedCollectionDate: '2026-11-12', collectionLocationId: 'demo-collection-centre', brand: 'bmw',
      contact: { phone: '01632 960000', email: 'own@example.test' }, expectedReturnMileage: 0, specialRequirements: '' } };
    fetcher.mockResolvedValueOnce(ok(savedDraft({ draftStage: 'complete', choices: input.choices })));
    expect((await client.saveDraft(input)).status).toBe('ok'); expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual(input);
  });
  it('rejects unregistered authority fields and missing deliberate command/CAS inputs before I/O', async () => {
    for (const bad of [{ ...command(), commandId: '   ' }, { ...command(), expectedDraftVersion: -1 }, { ...command(), expectedContextVersion: '' },
      { ...command(), employeeId: 'another-employee' }, { ...command(), choices: { ...command().choices, runId: 'another-run' } },
      { ...command(), choices: { ...command().choices, contact: { phone: '01632 960000', email: 'a@example.test', employeeId: 'other' } } }]) {
      expect((await client.saveDraft(bad as SaveDraftCommand)).status).toBe('invalid');
    }
    expect((await client.discardDraft({ commandId: 'discard', expectedDraftVersion: 3, employeeId: 'other' } as DiscardDraftCommand)).status).toBe('invalid');
    expect((await client.saveNotificationEmail({ commandId: 'email', expectedVersion: 0, deliveryEmail: null, runId: 'other' } as SaveNotificationEmailCommand)).status).toBe('invalid');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('takes an immutable command snapshot before awaiting credentials', async () => {
    const token = deferred<string | null>(); getAccessToken.mockReturnValueOnce(token.promise);
    const input = { ...command(), commandId: 'original' }; const pending = client.saveDraft(input);
    input.commandId = 'changed-after-click'; token.resolve('access-token'); fetcher.mockResolvedValueOnce(ok(savedDraft()));
    await pending; expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string).commandId).toBe('original');
  });
  it('never renews or automatically replays a read or any command on 401', async () => {
    fetcher.mockImplementation(async () => json({ status: 'unauthenticated', code: 'expired-token', retryable: false }, 401));
    for (const invoke of [() => client.readAccount(), () => client.saveDraft(command()), () => client.discardDraft({ commandId: 'discard', expectedDraftVersion: 3 }),
      () => client.saveNotificationEmail({ commandId: 'email', expectedVersion: 0, deliveryEmail: null })]) {
      const before = fetcher.mock.calls.length; expect(await invoke()).toEqual({ status: 'authentication-required', code: 'expired-token', retryable: false, httpStatus: 401 });
      expect(fetcher.mock.calls.length).toBe(before + 1);
    }
    expect(retry).not.toHaveBeenCalled();
  });
  it('keeps typed denial, provider failure and stale field/action/operation evidence without private upstream messages', async () => {
    const cases = [
      { status: 'forbidden', code: 'wrong-role', retryable: false, httpStatus: 403 },
      { status: 'unavailable', code: 'provider-unavailable', reason: 'missing-required-evidence', retryable: true, operationId: 'durable-operation', httpStatus: 503 },
      { status: 'stale-version', resource: 'manual-draft', expectedVersion: 2, currentVersion: 3, action: 'refresh',
        view: { state: 'conflict', editable: false, action: 'refresh-review' }, reasons: [{ field: 'draft', reason: 'reload' }], httpStatus: 409 },
      { status: 'not-found', resourceType: 'manual-draft', httpStatus: 200 },
    ];
    for (const expected of cases) {
      fetcher.mockResolvedValueOnce(json({ ...expected, message: 'private upstream details', debug: 'private record' }, expected.httpStatus));
      expect(await client.readDraft()).toEqual(expected);
    }
    expect(retry).not.toHaveBeenCalled();
  });
  it('contains malformed JSON, malformed data, invalid failures and false HTTP success', async () => {
    const input = accountSnapshot();
    for (const response of [new Response('<html>SPA fallback</html>'), json({ status: 'ok', value: null }), ok({ ...input, actions: 'invalid' }),
      ok({ ...input, drivers: [{}] }), ok({ ...input, account: { ...input.account, company: 42 } }),
      ok({ ...input, account: { ...input.account, contact: 'invalid' } }), ok({ ...input, contracts: [{ contractId: 'car', schemeId: 'scheme', media: 'invalid' }] }),
      ok({ ...input, currentCarRelationships: [{ currentCar: { kind: 'unknown' } }] }), json({ status: 'ok', value: input }, 503),
      json({ status: 'unavailable', code: 'provider', retryable: 'yes' }, 503)]) {
      fetcher.mockResolvedValueOnce(response); expect(await client.readAccount()).toEqual({ status: 'unavailable', code: 'account-response-invalid', retryable: true });
    }
    fetcher.mockResolvedValueOnce(ok({ draftVersion: 0, choices: {} })); expect((await client.readDraft()).status).toBe('unavailable');
    fetcher.mockResolvedValueOnce(ok({ version: -1, deliveryEmail: null })); expect((await client.readNotificationEmail()).status).toBe('unavailable');
    fetcher.mockResolvedValueOnce(json({}, 401)); expect((await client.readAccount()).status).toBe('authentication-required');
    fetcher.mockResolvedValueOnce(json({}, 403)); expect((await client.readAccount()).status).toBe('forbidden');
  });
  it('makes no request without a signed-in employee, valid access token and matching configured environment', async () => {
    for (const session of [{ status: 'signed-out' }, { status: 'ready', context: { ...context, roles: ['presenter'], employeeId: undefined } }] as SessionState[]) {
      state.set(session); expect((await client.readAccount()).status).toBe('authentication-required');
    }
    state.set({ status: 'ready', context });
    for (const token of [null, '', 'contains whitespace']) { getAccessToken.mockResolvedValueOnce(token); expect((await client.readAccount()).status).toBe('authentication-required'); }
    getAccessToken.mockRejectedValueOnce(new Error('provider credential failure')); expect((await client.readAccount()).status).toBe('authentication-required');
    load.mockResolvedValueOnce({ ...config, environmentId: 'running-production' }); expect((await client.readAccount()).status).toBe('unavailable');
    load.mockRejectedValueOnce(new Error('missing public settings')); expect((await client.readAccount()).status).toBe('unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects conflicts embedded anywhere in employee/run/environment evidence before exposing private facts', async () => {
    const input = accountSnapshot();
    for (const value of [{ ...input, account: { ...input.account, employeeId: 'other-employee' } },
      { ...input, histories: [{ schemeId: 'scheme', entries: [{ contractId: 'secret', schemeId: 'scheme', employeeId: 'other-employee' }] }] },
      { ...input, versions: { source: { runId: 'old-run' } } }, { ...input, drivers: [{ driverId: 'driver', environmentId: 'another-environment' }] }]) {
      fetcher.mockResolvedValueOnce(ok(value)); const result = await client.readAccount();
      expect(result).toEqual({ status: 'unavailable', code: 'account-response-scope-mismatch', retryable: false }); expect(result).not.toHaveProperty('value');
    }
    fetcher.mockResolvedValueOnce(json({ status: 'conflict', current: { employeeId: 'other-employee', contact: 'private' } }, 409));
    expect(await client.readAccount()).toEqual({ status: 'unavailable', code: 'account-response-scope-mismatch', retryable: false });
  });
  it('drops late reads and command receipts when subject, employee, environment or run changes', async () => {
    for (const delta of [{ subject: 'different-subject' }, { employeeId: 'different-employee' }, { environmentId: 'different-environment' }, { runId: 'different-run' }]) {
      state.set({ status: 'ready', context }); const response = deferred<Response>(); fetcher.mockReturnValueOnce(response.promise);
      const pending = client.readAccount(); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
      state.set({ status: 'ready', context: { ...context, ...delta } }); response.resolve(ok(accountSnapshot()));
      expect(await pending).toEqual({ status: 'account-changed', code: 'account-context-changed', retryable: false }); fetcher.mockClear();
    }
    state.set({ status: 'ready', context }); const response = deferred<Response>(); fetcher.mockReturnValueOnce(response.promise);
    const saving = client.saveDraft(command()); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled()); state.set({ status: 'signed-out' }); response.resolve(ok(savedDraft()));
    expect((await saving).status).toBe('account-changed');
  });
  it('does not send a command if the account changes while obtaining credentials', async () => {
    const token = deferred<string | null>(); getAccessToken.mockReturnValueOnce(token.promise);
    const saving = client.saveDraft(command()); await vi.waitFor(() => expect(getAccessToken).toHaveBeenCalled());
    state.set({ status: 'ready', context: { ...context, employeeId: 'other' } }); token.resolve('other-account-token');
    expect((await saving).status).toBe('account-changed'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('honours caller cancellation and finite timeout, including an uncooperative transport', async () => {
    const caller = new AbortController(); caller.abort(); expect((await client.readAccount({ signal: caller.signal })).status).toBe('aborted'); expect(fetcher).not.toHaveBeenCalled();
    const active = new AbortController(); const response = deferred<Response>(); fetcher.mockReturnValueOnce(response.promise);
    const pending = client.readAccount({ signal: active.signal }); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    const requestSignal = fetcher.mock.calls[0][1]?.signal; active.abort(); expect((await pending).status).toBe('aborted'); expect(requestSignal?.aborted).toBe(true);
    response.resolve(ok(accountSnapshot()));
    vi.useFakeTimers(); fetcher.mockReturnValueOnce(new Promise<Response>(() => {}));
    const timed = client.saveDraft(command()); await vi.advanceTimersByTimeAsync(10001);
    expect(await timed).toEqual({ status: 'unavailable', code: 'account-timeout', retryable: false }); expect(retry).not.toHaveBeenCalled();
  });
  it('retains transport failure as unavailable with no automatic write retry', async () => {
    fetcher.mockRejectedValueOnce(new Error('private network details'));
    expect(await client.saveDraft(command())).toEqual({ status: 'unavailable', code: 'account-transport-unavailable', retryable: false }); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('reconciles and resumes a matching saved draft without another write, and keeps notification email independent', async () => {
    const account = accountSnapshot(); fetcher.mockResolvedValueOnce(ok(savedDraft()));
    expect(await client.startJourney({ account, action: account.actions[0], commandId: 'start' })).toEqual({ status: 'ok', value: savedDraft() });
    expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][1]?.method).toBe('GET');
    fetcher.mockResolvedValueOnce(ok({ version: 1, deliveryEmail: 'notifications@example.test' })); await client.readNotificationEmail();
    expect(account.account?.contact?.email).toBe('paula.mason@gcsp-demo.com');
  });
  it('starts only a server-permitted action, with fresh draft CAS and deliberate stale-context review', async () => {
    const account = accountSnapshot(); const action = account.actions[0];
    expect((await client.startJourney({ account, action: { ...action, slotId: 'other-slot' }, commandId: 'bad' })).status).toBe('invalid'); expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(json({ status: 'not-found', resourceType: 'manual-draft' })).mockResolvedValueOnce(ok(savedDraft({ draftVersion: 1 })));
    expect((await client.startJourney({ account, action, commandId: 'start-new' })).status).toBe('ok');
    expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string)).toEqual({ commandId: 'start-new', expectedDraftVersion: 0, expectedContextVersion: account.contextVersion, choices: savedDraft().choices });
    fetcher.mockClear(); fetcher.mockResolvedValueOnce(ok(savedDraft({ contextVersion: 'old', requiresRefresh: true })));
    expect((await client.startJourney({ account, action, commandId: 'unreviewed' })).status).toBe('stale-version'); expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockClear(); fetcher.mockResolvedValueOnce(ok(savedDraft({ contextVersion: 'old', requiresRefresh: true }))).mockResolvedValueOnce(ok(savedDraft({ draftVersion: 4 })));
    expect((await client.startJourney({ account, action, commandId: 'reviewed', reviewedContextVersion: account.contextVersion })).status).toBe('ok');
    expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string).expectedDraftVersion).toBe(3);
  });
});
