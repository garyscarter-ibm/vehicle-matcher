import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort } from '../auth/auth.port';
import type { ApplicationContext, SessionState } from '../auth/auth.port';
import { GregClient } from './greg.client';
import { parseGregDemand } from './greg.projection';
import { GregStore } from './greg.store';
import type { GregDemand, GregPolicy, GregPreview, GregPublished, GregResult } from './greg.types';

const at = '2026-11-16T12:00:00.000Z'; const later = '2026-11-16T12:05:00.000Z';
const context: ApplicationContext = { subject: 'greg-subject', roles: ['greg', 'employee'], environmentId: 'isolated', runId: 'run-1', policyVersion: 'policy-1', capabilities: [] };
function demand(asOf = at): GregDemand {
  const versions = { brief: [], policy: ['policy-1'] };
  const cell = () => ({ count: { kind: 'band', fewerThan: 5, label: 'fewer than 5' }, versions });
  const result = parseGregDemand({ status: 'ok', value: { runId: 'run-1', asOf, projectionVersion: 'digest-1', basis: 'expressed-saved-demand',
    versions: { ...versions, revision: 1 }, privacy: { threshold: 5, thresholdKey: 'privacy', policyVersion: 'policy-1', status: 'assumed', withheld: false },
    demand: { activeBriefs: cell(), byModelLine: [], byBody: [], byFuel: [], essentials: [], unmet: { total: cell(), byGate: [] } },
    holds: { total: cell(), active: cell(), byState: [], byType: [] }, offers: { made: cell(), accepted: cell(), declined: cell(), expired: cell(), selected: cell(), declinedByReason: [] },
    stock: { byModelLine: [], source: { status: 'unavailable' } } } }, 'run-1');
  if (result.state !== 'ready') throw new Error('Invalid hand-authored fixture'); return result.value;
}
function policy(): GregPolicy {
  return { state: 'draft', activeVersion: 'policy-1', activeVersionLabel: 'Reviewed policy', versionNames: { 'policy-1': 'Reviewed policy' }, asOf: at,
    effectiveFrom: '2026-11-01T00:00:00Z', weightsAdoptionRequired: false, historyMessage: 'Published versions preserve existing quotes and offers.',
    heldOffers: { count: null, message: 'Refresh to see active offers keeping their earlier terms.' },
    fields: ['body', 'fuel', 'sportiness', 'comfort', 'economy', 'size'].map(key => ({ id: `weight:${key}`, key, kind: 'weight', label: `${key} weight`,
      value: 1, minimum: 0, step: 1, unitLabel: 'Relative weight', unit: 'relative-weight', source: 'reference', sourceDate: '2026-11-01', basis: 'Reviewed.', status: 'assumed',
      presentationRange: { minimum: 0, maximum: 10, step: 1, assumptionKey: 'greg.publish.editor.v1', source: 'reference', sourceDate: '2026-11-01', basis: 'Presentation only.', status: 'assumed', unit: 'relative-weight' } })) };
}
function preview(asOf = later): GregPreview {
  const fit = { employeesWithEligibleStock: { kind: 'band' as const, fewerThan: 5, label: 'fewer than 5' },
    scoredBriefs: { kind: 'band' as const, fewerThan: 5, label: 'fewer than 5' }, meanBestScore: { status: 'suppressed' as const, fewerThan: 5 } };
  return { preview: true, activeVersion: 'policy-1', asOf, differences: [{ id: 'weight:body', before: 1, after: 2, unit: 'relative-weight' }],
    active: { demand: demand(asOf), fit }, draft: { demand: demand(asOf), fit }, heldOffers: { count: null, message: 'Existing offers retain terms.' } };
}
const ok = <T>(value: T): GregResult<T> => ({ state: 'ready', value });
const unsupported = (): GregResult<never> => ({ state: 'refused', value: null, httpStatus: 422,
  refusal: { status: 'unsupported', code: 'preview-unavailable', reason: 'Policy preview is not available on this service yet.', retryable: false } });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fakeClient() {
  return { loadDemand: vi.fn<GregClient['loadDemand']>().mockResolvedValue(ok(demand())), readPolicy: vi.fn<GregClient['readPolicy']>().mockResolvedValue(ok(policy())),
    preview: vi.fn<GregClient['preview']>().mockResolvedValue(unsupported()),
    preparePublish: vi.fn<GregClient['preparePublish']>().mockImplementation(input => Object.freeze({ kind: 'publish-policy', input: Object.freeze({ ...input,
      changes: Object.freeze(input.changes.map(c => Object.freeze({ ...c }))) }) })),
    publish: vi.fn<GregClient['publish']>().mockResolvedValue({ state: 'failed', value: null, problem: 'timeout', writeOutcome: 'unknown' }) };
}

describe('route scoped Greg store', () => {
  let state = signal<SessionState>({ status: 'ready', context }); let client = fakeClient(); let store: GregStore;
  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000001' });
    state = signal<SessionState>({ status: 'ready', context }); client = fakeClient();
    TestBed.configureTestingModule({ providers: [GregStore, { provide: AuthPort, useValue: { state, retry: vi.fn(), signIn: vi.fn() } }, { provide: GregClient, useValue: client }] });
    store = TestBed.inject(GregStore); TestBed.flushEffects();
  });
  afterEach(() => { store.dispose(); TestBed.resetTestingModule(); vi.unstubAllGlobals(); });
  async function ready() { await vi.waitFor(() => expect(store.view().policyState).toBe('ready')); }
  async function review() { await ready(); store.setField('weight:body', '2'); client.preview.mockResolvedValueOnce(ok(preview())); await store.previewChanges(); expect(store.view().canPublish).toBe(true); }
  function published(patch: Partial<GregPublished> = {}): GregPublished {
    const input = client.preparePublish.mock.calls.at(-1)![0];
    return { state: 'published', accepted: true, policyVersion: input.policyVersion, effectiveFrom: input.effectiveFrom, publisher: 'greg-subject', publishedAt: later,
      heldOffers: { count: null, message: 'Refresh held offers.' }, activationRequired: true,
      activation: { status: 'pending', policyVersion: input.policyVersion, retryable: true, reason: 'Activation pending.', outcome: 'unavailable' }, ...patch };
  }

  it('loads independent server reads without making a policy, count or clock default', async () => {
    await ready(); expect(store.view().demandState).toBe('ready'); expect(store.view().policy?.heldOffers.count).toBeNull();
    expect(store.view().policy).not.toHaveProperty('clockVersion'); expect(store.view().demand?.stock).toMatchObject({ unavailable: true, empty: false });
    expect(store.view()).toMatchObject({ canPublish: false, canPreview: false }); expect(client.publish).not.toHaveBeenCalled();
  });
  it('requires real preview and keeps edits usable after the actual Java unsupported response', async () => {
    await ready(); store.setField('weight:body', '2'); expect(store.view().canPreview).toBe(true); await store.previewChanges();
    expect(store.view()).toMatchObject({ policyState: 'unsupported', canPublish: false, canEdit: true, canPreview: true });
    expect(store.view().message).toContain('not available on this service yet'); expect(store.view().fields[0].draft).toBe('2');
    expect(await store.publishPreview()).toBe(false); expect(client.preparePublish).not.toHaveBeenCalled(); expect(client.publish).not.toHaveBeenCalled();
    store.setField('weight:body', '3'); expect(store.view().fields[0].draft).toBe('3'); expect(store.view().canPreview).toBe(true);
  });
  it('validates whole numbers and no-op edits while preserving values outside the display range', async () => {
    await ready();
    for (const raw of ['-1', '1.5', '1e2', '', '9007199254740992']) {
      store.setField('weight:body', raw); expect(store.view().canPreview).toBe(false); expect(store.view().fields[0].error).toContain('whole number');
    }
    store.setField('weight:body', '1'); expect(store.view().canPreview).toBe(false);
    store.setField('weight:body', '999'); expect(store.view().fields[0]).toMatchObject({ draft: '999', outsideRange: true, error: '' }); expect(store.view().canPreview).toBe(true);
    store.setField('unknown:field', '2'); expect(store.view().fields).toHaveLength(6);
  });
  it('uses the later real preview instant, then invalidates it on edit or refresh', async () => {
    await review(); expect(store.view().preview?.asOf).toBe(later);
    store.setField('weight:body', '3'); expect(store.view()).toMatchObject({ preview: null, canPublish: false });
    store.setField('weight:body', '2'); client.preview.mockResolvedValueOnce(ok(preview())); await store.previewChanges();
    await store.refresh(); expect(store.view()).toMatchObject({ preview: null, canPublish: false });
  });
  it('rejects a stale version, altered differences or mixed preview times', async () => {
    await ready(); store.setField('weight:body', '2');
    for (const value of [{ ...preview(), activeVersion: 'other' }, { ...preview(), differences: [{ id: 'weight:body', before: 9, after: 2, unit: 'relative-weight' }] },
      { ...preview(), draft: { ...preview().draft, demand: demand(at) } }]) {
      client.preview.mockResolvedValueOnce(ok(value)); await store.previewChanges(); expect(store.view().canPublish).toBe(false);
    }
    expect(client.publish).not.toHaveBeenCalled();
  });
  it('ignores a late preview when draft input changes while it is loading', async () => {
    await ready(); store.setField('weight:body', '2'); const pending = deferred<GregResult<GregPreview>>(); client.preview.mockReturnValueOnce(pending.promise);
    const work = store.previewChanges(); store.setField('weight:body', '3'); pending.resolve(ok(preview())); await work;
    expect(store.view().fields[0].draft).toBe('3'); expect(store.view()).toMatchObject({ preview: null, canPublish: false, pending: false });
  });
  it('retains an unknown original payload and does not offer unsupported reconciliation or replay', async () => {
    await review(); await store.publishPreview(); const command = client.preparePublish.mock.results[0].value;
    expect(command).not.toHaveProperty('state'); if ('state' in command) throw new Error('No command');
    expect(command.input.effectiveFrom).toBe(later); expect(command.input.changes).toEqual([{ id: 'weight:body', value: 2 }]);
    expect(store.view()).toMatchObject({ uncertain: true, retainedCommand: command.input, canPublish: false, canRetry: false, canEdit: false });
    await store.refresh(); expect(store.view().retainedCommand).toBe(command.input); expect(store.view().canRetry).toBe(false);
    expect(await store.retryPublication()).toBe(false); expect(client.publish).toHaveBeenCalledOnce(); expect(store.view().message).toContain('cannot reconcile');
  });
  it('shows accepted pending activation with unknown held offers and requires readback before an identical deliberate retry', async () => {
    await review(); client.publish.mockImplementation(async () => ok(published())); const reads = client.loadDemand.mock.calls.length;
    await store.publishPreview(); const command = client.publish.mock.calls[0][0];
    expect(store.view().publication?.heldOffers.count).toBeNull(); expect(store.view().message).toContain('Activation is pending'); expect(store.view().canRetry).toBe(false);
    expect(client.loadDemand).toHaveBeenCalledTimes(reads + 1); expect(client.publish).toHaveBeenCalledOnce();
    client.readPolicy.mockResolvedValueOnce(ok({ ...policy(), asOf: later }));
    await store.refresh(); expect(store.view().canRetry).toBe(true); await store.retryPublication();
    expect(client.publish.mock.calls[1][0]).toBe(command); expect(client.publish.mock.calls[1][0].input.effectiveFrom).toBe(later);
    client.publish.mockImplementation(async () => { const value = published(); const blocked: GregPublished = { ...value, activation: { status: 'pending',
      policyVersion: value.policyVersion, retryable: false, reason: 'Activation retry unavailable.', outcome: 'unsupported' } }; return ok(blocked); });
    client.readPolicy.mockResolvedValue(ok({ ...policy(), asOf: later })); await store.refresh(); await store.retryPublication(); await store.refresh();
    expect(store.view().canRetry).toBe(false); expect(await store.retryPublication()).toBe(false); expect(client.publish).toHaveBeenCalledTimes(3);
  });
  it('never calls accepted publication active without explicit activation proof', async () => {
    await review(); client.publish.mockImplementation(async () => ok(published({ activation: undefined, activationRequired: undefined })));
    await store.publishPreview(); expect(store.view().message).toContain('could not be confirmed'); expect(store.view().canRetry).toBe(false);
  });
  it('hides private data synchronously on session change and ignores old responses', async () => {
    await ready(); const pending = deferred<GregResult<GregPolicy>>(); client.readPolicy.mockReturnValueOnce(pending.promise);
    const work = store.refresh(); state.set({ status: 'signed-out' }); expect(store.view().policy).toBeNull(); expect(store.view().demand).toBeNull();
    TestBed.flushEffects(); pending.resolve(ok(policy())); await work; expect(store.view().policy).toBeNull();
    for (const roles of [['employee'], ['presenter'], ['greg', 'presenter']] as const) {
      state.set({ status: 'ready', context: { ...context, roles } }); TestBed.flushEffects(); expect(store.view()).toMatchObject({ policyState: 'denied', demand: null, policy: null, canPublish: false });
    }
  });
  it('keeps demand visible when only the policy read is unavailable and clears everything for denied authority', async () => {
    await ready(); client.readPolicy.mockResolvedValueOnce({ state: 'refused', value: null, refusal: { status: 'unavailable', code: 'policy-unavailable', reason: 'Policy source unavailable.', retryable: true } });
    await store.refresh(); expect(store.view()).toMatchObject({ demandState: 'ready', policyState: 'unavailable', policy: null }); expect(store.view().demand).not.toBeNull();
    client.readPolicy.mockResolvedValueOnce({ state: 'refused', value: null, refusal: { status: 'forbidden', code: 'role-required', reason: 'Access refused.', retryable: false } });
    await store.refresh(); expect(store.view()).toMatchObject({ demand: null, policy: null, policyState: 'denied', demandState: 'denied' });
  });
  it('disposes pending work and removes all private data and commands', async () => {
    await review(); const pending = deferred<GregResult<GregPublished>>(); client.publish.mockReturnValueOnce(pending.promise);
    const work = store.publishPreview(); const options = client.publish.mock.calls[0][1]; store.dispose();
    expect(options?.signal?.aborted).toBe(true); expect(store.view()).toMatchObject({ demand: null, policy: null, retainedCommand: null });
    pending.resolve({ state: 'failed', value: null, problem: 'aborted', writeOutcome: 'unknown' }); await work; expect(store.view().retainedCommand).toBeNull();
  });
});
