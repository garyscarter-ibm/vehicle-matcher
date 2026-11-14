import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { BriefClient } from './brief.client';
import { BriefEditorStore } from './brief-editor.store';
import { briefEditorFixture, currentBriefFixture, preferenceSaveFixture } from './brief.fixtures';
import { BriefEngagementValue, BriefPreferenceSaveValue, BriefResult, BuddyView } from './brief.types';
const ready = (runId = 'run-1'): SessionState => ({ status: 'ready', context: { subject: 'subject-1', employeeId: 'employee-1', environmentId: 'dev', runId, roles: ['employee'], policyVersion: 'policy-v1', capabilities: [] } });
const tick = async () => { await Promise.resolve(); await Promise.resolve(); TestBed.tick(); };
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const buddyState = (state: BuddyView['state'], reason: BuddyView['reason'] = null, remaining = 0): BuddyView => ({
  state, reason, permissionVersion: 4, minimumCategories: 2, considered: 2 - remaining, remaining, sameAgain: false, canEngage: state === 'disengaged' && reason !== 'paused' && remaining === 0,
});
const engagement = (buddy: BuddyView, briefVersion = 5, draftVersion = 2): BriefEngagementValue => ({ briefVersion, draftVersion, buddy });
describe('shared native brief editor store', () => {
  const state = signal<SessionState>(ready());
  const client = { readEditor: vi.fn(), savePreferences: vi.fn(), preview: vi.fn(), saveDraft: vi.fn(), confirm: vi.fn(), engage: vi.fn(), pauseSearch: vi.fn(), resumeSearch: vi.fn(), disengage: vi.fn() };
  let store: BriefEditorStore;
  beforeEach(async () => {
    Object.values(client).forEach((fn) => fn.mockReset()); state.set(ready());
    client.readEditor.mockResolvedValue({ status: 'ok', value: briefEditorFixture() });
    client.savePreferences.mockResolvedValue({ status: 'ok', value: preferenceSaveFixture() });
    const reloaded = briefEditorFixture(); client.readEditor.mockImplementation(async () => ({ status: 'ok', value: { ...reloaded, initial: { ...reloaded.initial, briefVersion: store?.briefVersion() === 5 ? 5 : 4, draftVersion: store?.briefVersion() === 5 ? 3 : 2 } } }));
    TestBed.configureTestingModule({ providers: [{ provide: AuthPort, useValue: { state } }, { provide: BriefClient, useValue: client }] });
    store = undefined as unknown as BriefEditorStore; store = TestBed.inject(BriefEditorStore); TestBed.tick(); await tick();
  });
  it('shares one load and hides all old context immediately on identity/run/signout', async () => {
    await Promise.all([store.load(), store.load()]); expect(client.readEditor).toHaveBeenCalledTimes(1);
    const late = deferred<BriefResult<BriefPreferenceSaveValue>>(); client.savePreferences.mockReturnValue(late.promise);
    store.rate(5, 'contract-1'); state.set(ready('run-2'));
    expect(store.editor()).toBeNull(); TestBed.tick(); await tick();
    late.resolve({ status: 'ok', value: { ...preferenceSaveFixture(), currentCarRating: { contractId: 'contract-1', value: 5 } } }); await tick();
    expect(store.rating()?.value).toBeNull(); expect(client.readEditor).toHaveBeenCalledTimes(2);
    state.set({ status: 'signed-out' }); expect(store.editor()).toBeNull(); TestBed.tick(); expect(store.brief().preferences).toEqual({});
  });
  it('coalesces category changes and preserves a newer value, importance and rating against a late reply', async () => {
    const first = deferred<BriefResult<BriefPreferenceSaveValue>>(); client.savePreferences.mockReturnValueOnce(first.promise);
    store.change('economy', { value: 100 }); store.change('economy', { value: 0 }); store.change('economy', { importance: 'high' }); store.rate(4, 'contract-1');
    expect(client.savePreferences).toHaveBeenCalledTimes(1);
    const second = { ...preferenceSaveFixture(), draftVersion: 4, accountPreferences: { ...preferenceSaveFixture().accountPreferences, categories: { economy: { state: 'considered' as const, value: 0, importance: 'high' as const, exact: true } } }, currentCarRating: { contractId: 'contract-1', value: 4 } };
    client.savePreferences.mockResolvedValueOnce({ status: 'ok', value: second }); first.resolve({ status: 'ok', value: preferenceSaveFixture() }); await tick();
    expect(client.savePreferences).toHaveBeenCalledTimes(2); expect(client.savePreferences.mock.calls[1][0]).toMatchObject({ expectedBriefVersion: 4, expectedDraftVersion: 3, changes: { economy: { value: 0, importance: 'high' } }, currentCarRating: { value: 4 } });
    expect(store.category('economy')).toMatchObject({ value: 0, importance: 'high' }); expect(store.rating()?.value).toBe(4); expect(store.draftVersion()).toBe(4);
  });
  it('marks uncertain save, retains edits and explicitly retries the exact command ID', async () => {
    client.savePreferences.mockResolvedValueOnce({ status: 'unavailable', retryable: true }); store.change('economy', { value: 100 }); await tick();
    const command = client.savePreferences.mock.calls[0][0]; expect(store.failure()?.status).toBe('unavailable'); expect(store.category('economy')).toMatchObject({ value: 100 });
    expect(store.understanding()?.pending).toBe(true); store.retry(); await tick(); expect(client.savePreferences.mock.calls[1][0]).toEqual(command);
  });
  it('does not replay after 401 and locks stale edits until explicit reload', async () => {
    client.savePreferences.mockResolvedValueOnce({ status: 'unauthenticated', retryable: false }); store.rate(3, 'contract-1'); await tick();
    store.retry(); expect(client.savePreferences).toHaveBeenCalledTimes(1); expect(store.locked()).toBe(true);
    await store.reload(); client.savePreferences.mockResolvedValueOnce({ status: 'stale-version' }); store.change('economy', { value: 100 }); await tick();
    store.change('economy', { value: 0 }); store.retry(); expect(client.savePreferences).toHaveBeenCalledTimes(2); expect(store.category('economy')).toMatchObject({ value: 100 });
    await store.reload(); expect(store.category('economy')).toMatchObject({ value: 50 });
  });
  it('rolls back refused fields while allowing queued newer changes to continue', async () => {
    const first = deferred<BriefResult<BriefPreferenceSaveValue>>(); client.savePreferences.mockReturnValueOnce(first.promise);
    store.change('economy', { value: 100 }); store.rate(2, 'contract-1');
    first.resolve({ status: 'invalid', retryable: false }); await tick();
    expect(store.category('economy')).toMatchObject({ value: 50 }); expect(client.savePreferences).toHaveBeenCalledTimes(2);
    expect(client.savePreferences.mock.calls[1][0]).toMatchObject({ changes: {}, currentCarRating: { value: 2 } });
  });
  it('keeps category choices and importance while Same again disables edits', async () => {
    const first = deferred<BriefResult<BriefPreferenceSaveValue>>(); client.savePreferences.mockReturnValueOnce(first.promise);
    store.toggleSameAgain(true); store.change('economy', { value: 100 }); store.requestRemove('economy');
    expect(store.sameAgain()).toBe(true); expect(store.category('economy')).toMatchObject({ value: 50, importance: 'medium' }); expect(store.pendingRemoval()).toBeNull();
    first.resolve({ status: 'ok', value: { ...preferenceSaveFixture(), sameAgain: { available: true, on: true, contractId: 'contract-1' } } }); await tick();
    expect(store.sameAgain()).toBe(true); expect(store.brief().preferences['economy'].value).toBe(50);
  });
  it('requires explicit removal confirmation and a re-added value starts medium', async () => {
    store.requestRemove('economy'); store.keep(); expect(client.savePreferences).not.toHaveBeenCalled();
    client.savePreferences.mockResolvedValueOnce({ status: 'ok', value: { ...preferenceSaveFixture(), accountPreferences: { ...preferenceSaveFixture().accountPreferences, categories: { economy: { state: 'unset' } } } } });
    store.requestRemove('economy'); store.confirmRemove('economy'); await tick(); expect(client.savePreferences.mock.calls[0][0].changes).toEqual({ economy: null });
    store.change('economy', { value: 100 }); expect(client.savePreferences.mock.calls[1][0].changes).toEqual({ economy: { value: 100, importance: 'medium' } });
  });
  it('saves draft then confirms, preserving partial success and retrying only confirmation', async () => {
    client.saveDraft.mockResolvedValue({ status: 'ok', value: { draftVersion: 3, baseBriefVersion: 4, brief: briefEditorFixture().initial.brief } });
    client.confirm.mockResolvedValueOnce({ status: 'unavailable', retryable: true }).mockResolvedValueOnce({ status: 'ok', value: currentBriefFixture() });
    store.updatePreference('economy', { value: 80 }); const feedback = store.brief().currentCarFeedback;
    await store.saveFull(); expect(store.draftVersion()).toBe(3); expect(store.briefVersion()).toBe(4); expect(store.fullDirty()).toBe(true); expect(store.message()).toContain('Your draft was saved. Confirmation failed.');
    const confirm = client.confirm.mock.calls[0][0]; store.retry(); await tick();
    expect(client.saveDraft).toHaveBeenCalledTimes(1); expect(client.confirm.mock.calls[1][0]).toEqual(confirm); expect(store.fullState()).toBe('saved');
    expect(client.saveDraft.mock.calls[0][0].brief.currentCarFeedback).toEqual(feedback);
  });
  it('keeps newer full edits when a draft and confirmation complete late', async () => {
    const draft = deferred<unknown>(); client.saveDraft.mockReturnValue(draft.promise); client.confirm.mockResolvedValue({ status: 'ok', value: currentBriefFixture() });
    store.updatePreference('economy', { value: 80 }); const saving = store.saveFull(); store.updatePreference('economy', { importance: 70 });
    await store.saveFull(); expect(client.saveDraft).toHaveBeenCalledTimes(1);
    draft.resolve({ status: 'ok', value: { draftVersion: 3, baseBriefVersion: 4, brief: briefEditorFixture().initial.brief } }); await saving;
    expect(store.fullDirty()).toBe(true); expect(store.brief().preferences['economy']).toMatchObject({ value: 80, importance: 70 });
  });
  it('allows correction of invalid full saves and submits a fresh draft command', async () => {
    client.saveDraft.mockResolvedValueOnce({ status: 'invalid', code: 'invalid-brief' }).mockResolvedValueOnce({ status: 'ok', value: { draftVersion: 3, baseBriefVersion: 4, brief: briefEditorFixture().initial.brief } });
    client.confirm.mockResolvedValue({ status: 'ok', value: currentBriefFixture() });
    store.updateEssential('seats', 5); await store.saveFull(); const first = client.saveDraft.mock.calls[0][0];
    expect(store.failure()?.status).toBe('invalid'); store.updateEssential('seats', 2); expect(store.failure()).toBeNull();
    await store.saveFull(); expect(client.saveDraft.mock.calls[1][0].commandId).not.toBe(first.commandId); expect(client.saveDraft.mock.calls[1][0].brief.essentials.seats.value).toBe(2);
  });
  it('retains source rating/Same again timestamps and full local edits when composing a later full draft', async () => {
    const canonical = briefEditorFixture();
    const ratedAt = '2026-11-14T09:00:00.000Z'; const setAt = '2026-11-14T09:00:01.000Z';
    const source = { ...canonical, initial: { ...canonical.initial, draftVersion: 3, brief: { ...canonical.initial.brief, currentCarRating: { value: 4, contractId: 'contract-1', source: 'employee' as const, ratedAt }, sameAgain: { on: false, contractId: 'contract-1', source: 'employee' as const, setAt } } } };
    client.savePreferences.mockResolvedValueOnce({ status: 'ok', value: { ...preferenceSaveFixture(), currentCarRating: { value: 4, contractId: 'contract-1' } } });
    store.rate(4, 'contract-1'); await tick(); store.updatePreference('economy', { value: 80 });
    client.readEditor.mockResolvedValueOnce({ status: 'ok', value: source });
    client.saveDraft.mockResolvedValueOnce({ status: 'unavailable', retryable: true }); await store.saveFull();
    const draft = client.saveDraft.mock.calls[0][0]; expect(draft.brief.currentCarRating.ratedAt).toBe(ratedAt); expect(draft.brief.sameAgain.setAt).toBe(setAt); expect(draft.brief.preferences.economy.value).toBe(80);
  });
  it('refreshes compact projections only from authoritative readback after full confirmation', async () => {
    client.saveDraft.mockResolvedValue({ status: 'ok', value: { draftVersion: 3, baseBriefVersion: 4, brief: briefEditorFixture().initial.brief } });
    client.confirm.mockResolvedValue({ status: 'ok', value: currentBriefFixture() });
    const server = briefEditorFixture(); const categories = { economy: { state: 'considered' as const, value: 100, importance: 'high' as const, exact: false }, body: { state: 'unset' as const } };
    client.readEditor.mockResolvedValueOnce({ status: 'ok', value: { ...server, initial: { ...server.initial, briefVersion: 5, draftVersion: 3, accountPreferences: { ...server.initial.accountPreferences, categories } } } });
    store.updatePreference('economy', { value: 88, importance: 90 }); await store.saveFull();
    expect(client.readEditor).toHaveBeenCalledTimes(2); expect(store.category('economy')).toEqual(categories.economy); expect(store.briefVersion()).toBe(5);
  });
  it('adopts newer authoritative versions, brief and consent and uses them for the next compact command', async () => {
    client.saveDraft.mockResolvedValue({ status: 'ok', value: { draftVersion: 3, baseBriefVersion: 4, brief: briefEditorFixture().initial.brief } });
    client.confirm.mockResolvedValue({ status: 'ok', value: currentBriefFixture() });
    const server = briefEditorFixture(); const canonical = { ...server.initial.brief, preferences: { ...server.initial.brief.preferences, economy: { ...server.initial.brief.preferences['economy'], value: 25 } } };
    client.readEditor.mockResolvedValueOnce({ status: 'ok', value: { ...server, initial: { ...server.initial, briefVersion: 6, draftVersion: 4, brief: canonical, consent: { search: true, hold: false } } } });
    store.updatePreference('economy', { value: 88 }); await store.saveFull();
    expect(store.briefVersion()).toBe(6); expect(store.draftVersion()).toBe(4); expect(store.brief()).toEqual(canonical); expect(store.consent()).toEqual({ search: true, hold: false }); expect(store.fullDirty()).toBe(false);
    store.change('economy', { value: 100 }); expect(client.savePreferences.mock.calls[0][0]).toMatchObject({ expectedBriefVersion: 6, expectedDraftVersion: 4 });
    await tick();
  });
  it('keeps edits made during final readback and requires refresh when that readback is newer', async () => {
    client.saveDraft.mockResolvedValue({ status: 'ok', value: { draftVersion: 3, baseBriefVersion: 4, brief: briefEditorFixture().initial.brief } });
    client.confirm.mockResolvedValue({ status: 'ok', value: currentBriefFixture() });
    const readback = deferred<unknown>(); client.readEditor.mockReturnValueOnce(readback.promise);
    store.updatePreference('economy', { value: 88 }); const saving = store.saveFull(); await tick();
    expect(client.readEditor).toHaveBeenCalledTimes(2); store.updatePreference('economy', { value: 99 }); store.setConsent(true);
    const server = briefEditorFixture(); readback.resolve({ status: 'ok', value: { ...server, initial: { ...server.initial, briefVersion: 6, draftVersion: 4 } } }); await saving;
    expect(store.brief().preferences['economy'].value).toBe(99); expect(store.consent()).toEqual({ search: true, hold: true }); expect(store.fullDirty()).toBe(true);
    expect(store.failure()?.status).toBe('stale-version'); expect(store.locked()).toBe(true); expect(store.fullMessage()).toContain('Refresh and review');
    store.change('economy', { value: 0 }); await store.saveFull(); expect(client.savePreferences).not.toHaveBeenCalled(); expect(client.saveDraft).toHaveBeenCalledTimes(1);
  });
  it('retains edits made during final readback even when its versions match confirmation', async () => {
    client.saveDraft.mockResolvedValue({ status: 'ok', value: { draftVersion: 3, baseBriefVersion: 4, brief: briefEditorFixture().initial.brief } });
    client.confirm.mockResolvedValue({ status: 'ok', value: currentBriefFixture() });
    const readback = deferred<unknown>(); client.readEditor.mockReturnValueOnce(readback.promise);
    const saving = store.saveFull(); await tick(); store.updatePreference('economy', { value: 99 }); store.setConsent(true);
    const server = briefEditorFixture(); readback.resolve({ status: 'ok', value: { ...server, initial: { ...server.initial, briefVersion: 5, draftVersion: 3 } } }); await saving;
    expect(store.brief().preferences['economy'].value).toBe(99); expect(store.consent()).toEqual({ search: true, hold: true }); expect(store.fullDirty()).toBe(true); expect(store.locked()).toBe(false);
    expect(store.fullMessage()).toContain('Newer edits are still unsaved.');
  });
  it('uses independent position, importance and practical answers with server-only preview', async () => {
    store.updatePreference('economy', { value: 100 }); store.updatePreference('economy', { importance: 0 }); store.updateEssential('seats', 5);
    expect(store.brief().preferences['economy']).toMatchObject({ value: 100, importance: 0 }); expect(store.brief().essentials['seats']).toMatchObject({ value: 5, state: 'draft' });
    client.preview.mockResolvedValue({ status: 'ok', value: { state: 'no-stock', eligibleCount: 0, decisions: [], recommendations: [], versions: {} } });
    await store.requestPreview(); expect(client.preview.mock.calls[0][0]).toMatchObject({ kind: 'unsaved-draft', baseBriefVersion: 4, draftVersion: 2, brief: store.brief() });
    expect(store.preview()?.status).toBe('ok');
  });
  it('uses the server minimum and does not submit an under-minimum engagement', async () => {
    await store.runBuddyCommand('engage');
    expect(client.engage).not.toHaveBeenCalled(); expect(store.buddyFailure()).toMatchObject({ code: 'engagement-minimum', remaining: 1 });
    expect(store.buddyMessage()).toBe('Choose 1 more category to engage Buddy. Your preferences save automatically.');
  });
  it('runs the four commands in server order and preserves consent while search is paused', async () => {
    const initial = briefEditorFixture();
    client.readEditor.mockResolvedValueOnce({ status: 'ok', value: { ...initial, initial: { ...initial.initial, buddy: buddyState('disengaged', null, 0), consent: { search: false, hold: false } } } });
    await store.reload();
    client.engage.mockResolvedValueOnce({ status: 'ok', value: engagement(buddyState('engaged'), 5, 2) });
    client.pauseSearch.mockResolvedValueOnce({ status: 'ok', value: engagement(buddyState('disengaged', 'paused'), 6, 2) });
    client.resumeSearch.mockResolvedValueOnce({ status: 'ok', value: engagement(buddyState('engaged'), 7, 2) });
    client.disengage.mockResolvedValueOnce({ status: 'ok', value: engagement(buddyState('disengaged'), 8, 2) });
    const before = structuredClone(store.brief());
    await store.runBuddyCommand('engage'); await store.runBuddyCommand('pauseSearch');
    expect(store.editor()?.initial.buddy.reason).toBe('paused'); expect(store.consent()).toEqual({ search: true, hold: true });
    expect(store.buddyMessage()).toContain('Any held offer stays open until its deadline.');
    await store.runBuddyCommand('resumeSearch'); expect(store.consent()).toEqual({ search: true, hold: true });
    await store.runBuddyCommand('disengage');
    expect(store.consent()).toEqual({ search: false, hold: false }); expect(store.editor()?.initial.buddy.state).toBe('disengaged');
    expect(store.brief()).toEqual(before);
    expect([client.engage, client.pauseSearch, client.resumeSearch, client.disengage].map((fn) => fn.mock.calls[0][0])).toEqual([
      { commandId: expect.any(String), expectedBriefVersion: 4, expectedDraftVersion: 2 },
      { commandId: expect.any(String), expectedBriefVersion: 5, expectedDraftVersion: 2 },
      { commandId: expect.any(String), expectedBriefVersion: 6, expectedDraftVersion: 2 },
      { commandId: expect.any(String), expectedBriefVersion: 7, expectedDraftVersion: 2 },
    ]);
    for (const fn of [client.engage, client.pauseSearch, client.resumeSearch, client.disengage]) expect(fn.mock.calls[0][1]).toMatchObject({
      signal: expect.any(AbortSignal), expectedContextKey: JSON.stringify(['subject-1', 'dev', 'run-1', 'employee-1']),
    });
  });
  it('keeps a Buddy command ahead of compact edits, then flushes at its adopted versions', async () => {
    const editor = briefEditorFixture();
    client.readEditor.mockResolvedValueOnce({ status: 'ok', value: { ...editor, initial: { ...editor.initial, buddy: buddyState('engaged'), consent: { search: true, hold: true } } } });
    await store.reload();
    const response = deferred<BriefResult<BriefEngagementValue>>(); client.pauseSearch.mockReturnValueOnce(response.promise);
    const command = store.runBuddyCommand('pauseSearch'); expect(client.pauseSearch).toHaveBeenCalledOnce(); await store.runBuddyCommand('disengage');
    expect(client.disengage).not.toHaveBeenCalled();
    store.change('economy', { value: 100 }); expect(client.savePreferences).not.toHaveBeenCalled();
    response.resolve({ status: 'ok', value: engagement(buddyState('disengaged', 'paused'), 5, 2) }); await command; await tick();
    expect(client.savePreferences.mock.calls[0][0]).toMatchObject({ expectedBriefVersion: 5, expectedDraftVersion: 2, changes: { economy: { value: 100 } } });
    expect(client.disengage).not.toHaveBeenCalled();
  });
  it('blocks Buddy while a compact save is in flight and permits it at the saved versions', async () => {
    const save = deferred<BriefResult<BriefPreferenceSaveValue>>(); client.savePreferences.mockReturnValueOnce(save.promise);
    store.change('economy', { value: 100 }); await store.runBuddyCommand('engage'); expect(client.engage).not.toHaveBeenCalled();
    const saved = preferenceSaveFixture(); save.resolve({ status: 'ok', value: { ...saved, draftVersion: 3, buddy: buddyState('disengaged', null, 0) } }); await tick();
    client.engage.mockResolvedValueOnce({ status: 'ok', value: engagement(buddyState('engaged'), 5, 3) }); await store.runBuddyCommand('engage');
    expect(client.engage.mock.calls[0][0]).toMatchObject({ expectedBriefVersion: 4, expectedDraftVersion: 3 });
  });
  it('keeps full consent as one choice and prevents an immediate Buddy command', async () => {
    store.setConsent(true); expect(store.consent()).toEqual({ search: true, hold: true });
    expect(store.fullDirty()).toBe(true); await store.runBuddyCommand('engage'); expect(client.engage).not.toHaveBeenCalled();
  });
  it('preserves full preference inputs and the single consent choice during a saved-status reload', async () => {
    store.setConsent(true); store.updateEssential('seats', 5);
    const latest = briefEditorFixture(); client.readEditor.mockResolvedValueOnce({ status: 'ok', value: latest });
    await store.reloadBuddyStatus();
    expect(store.brief().essentials['seats'].value).toBe(5); expect(store.consent()).toEqual({ search: true, hold: true }); expect(store.fullDirty()).toBe(true);
    expect(store.fullMessage()).toContain('Your edits and Buddy choice are kept');
  });
  it.each([
    ['category value', (store: BriefEditorStore) => store.change('economy', { value: 100 })],
    ['category importance', (store: BriefEditorStore) => store.change('economy', { importance: 'high' })],
    ['category opening', (store: BriefEditorStore) => store.open('body')],
    ['rating', (store: BriefEditorStore) => store.rate(5, 'contract-1')],
    ['Same again', (store: BriefEditorStore) => store.toggleSameAgain(true)],
    ['removal request', (store: BriefEditorStore) => store.requestRemove('economy')],
    ['removal confirmation', (store: BriefEditorStore) => store.confirmRemove('economy')],
  ])('blocks %s during saved-status refresh and accepts edits at refreshed versions', async (kind, edit) => {
    if (kind === 'removal confirmation') store.requestRemove('economy');
    const before = { categories: structuredClone(store.categories()), rating: structuredClone(store.rating()), sameAgain: store.sameAgain(),
      openCategory: store.openCategory(), pendingRemoval: store.pendingRemoval(), brief: structuredClone(store.brief()) };
    const read = deferred<unknown>(); client.readEditor.mockReturnValueOnce(read.promise);
    const refreshing = store.reloadBuddyStatus();
    expect(store.buddyRefreshing()).toBe(true); expect(store.locked()).toBe(true);
    edit(store);
    expect({ categories: store.categories(), rating: store.rating(), sameAgain: store.sameAgain(),
      openCategory: store.openCategory(), pendingRemoval: store.pendingRemoval(), brief: store.brief() }).toEqual(before);
    expect(store.queuePending()).toBe(false); expect(client.savePreferences).not.toHaveBeenCalled();
    const latest = briefEditorFixture(); read.resolve({ status: 'ok', value: { ...latest,
      initial: { ...latest.initial, briefVersion: 8, draftVersion: 6 } } }); await refreshing;
    expect(store.locked()).toBe(false); expect(store.queueNeedsReview()).toBe(false);
    expect(store.category('economy')).toEqual(before.categories['economy']); expect(store.rating()).toEqual(before.rating); expect(store.sameAgain()).toBe(false);
    store.change('economy', { value: 100 }); await tick();
    expect(client.savePreferences).toHaveBeenCalledOnce(); expect(client.savePreferences.mock.calls[0][0]).toMatchObject({
      expectedBriefVersion: 8, expectedDraftVersion: 6, changes: { economy: { value: 100 } },
    });
    expect(client.savePreferences.mock.calls[0][0]).not.toHaveProperty('currentCarRating');
    expect(client.savePreferences.mock.calls[0][0]).not.toHaveProperty('sameAgain');
  });
  it('adopts authoritative saved consent on status reload when the full editor is untouched', async () => {
    const latest = briefEditorFixture();
    client.readEditor.mockResolvedValueOnce({ status: 'ok', value: { ...latest, initial: {
      ...latest.initial, briefVersion: 5, buddy: buddyState('engaged'), consent: { search: true, hold: true },
    } } });
    await store.reloadBuddyStatus();
    expect(store.consent()).toEqual({ search: true, hold: true }); expect(store.fullDirty()).toBe(false);
    expect(store.editor()?.initial.buddy.state).toBe('engaged'); expect(store.briefVersion()).toBe(5);
  });
  it('retries only an unavailable Buddy request with the same ID and exact versions', async () => {
    const editor = briefEditorFixture();
    client.readEditor.mockResolvedValueOnce({ status: 'ok', value: { ...editor, initial: { ...editor.initial, buddy: buddyState('disengaged', null, 0) } } });
    await store.reload();
    client.engage.mockResolvedValueOnce({ status: 'unavailable', retryable: true }).mockResolvedValueOnce({ status: 'ok', value: engagement(buddyState('engaged'), 5, 2) });
    await store.runBuddyCommand('engage'); const sent = client.engage.mock.calls[0][0]; store.retryBuddy(); await tick();
    expect(client.engage.mock.calls[1][0]).toEqual(sent); expect(store.editor()?.initial.buddy.state).toBe('engaged');
  });
  it('locks on stale or pending outcomes without claiming success or replaying', async () => {
    const editor = briefEditorFixture();
    client.readEditor.mockResolvedValueOnce({ status: 'ok', value: { ...editor, initial: { ...editor.initial, buddy: buddyState('disengaged', null, 0) } } });
    await store.reload(); client.engage.mockResolvedValueOnce({ status: 'pending', operationId: 'operation-9' });
    await store.runBuddyCommand('engage');
    expect(store.locked()).toBe(true); expect(store.editor()?.initial.buddy.state).toBe('disengaged'); expect(store.buddyOperationId()).toBe('operation-9');
    expect(store.buddyMessage()).toContain('operation-9'); store.retryBuddy(); expect(client.engage).toHaveBeenCalledOnce();
    const fresh = briefEditorFixture(); client.readEditor.mockResolvedValueOnce({ status: 'ok', value: { ...fresh, initial: { ...fresh.initial, buddy: buddyState('disengaged', null, 0) } } });
    await store.reloadBuddyStatus(); expect(store.locked()).toBe(false); expect(store.editor()?.initial.buddy.state).toBe('disengaged');
  });
  it('preserves compact edits through a stale Buddy reload and requires a deliberate retry', async () => {
    const editor = briefEditorFixture();
    client.readEditor.mockResolvedValueOnce({ status: 'ok', value: { ...editor, initial: { ...editor.initial, buddy: buddyState('disengaged', null, 0) } } });
    await store.reload(); const response = deferred<BriefResult<BriefEngagementValue>>(); client.engage.mockReturnValueOnce(response.promise);
    const pending = store.runBuddyCommand('engage'); store.change('economy', { value: 100 }); response.resolve({ status: 'stale-version', action: 'refresh' }); await pending;
    expect(store.locked()).toBe(true);
    const fresh = briefEditorFixture(); client.readEditor.mockResolvedValueOnce({ status: 'ok', value: { ...fresh, initial: { ...fresh.initial, briefVersion: 5, draftVersion: 3, buddy: buddyState('disengaged', null, 0) } } });
    await store.reloadBuddyStatus(); expect(store.locked()).toBe(false); expect(store.category('economy')).toMatchObject({ value: 100 });
    expect(store.queueNeedsReview()).toBe(true); expect(client.savePreferences).not.toHaveBeenCalled();
    store.retry(); await tick(); expect(client.savePreferences.mock.calls[0][0]).toMatchObject({ expectedBriefVersion: 5, expectedDraftVersion: 3, changes: { economy: { value: 100 } } });
  });
  it('announces the server minimum-loss transition after a compact save', async () => {
    const saved = preferenceSaveFixture(); client.savePreferences.mockResolvedValueOnce({ status: 'ok', value: { ...saved,
      buddy: { ...saved.buddy, state: 'disengaged', reason: 'minimum-lost' }, buddyTransition: 'minimum-lost' } });
    store.change('economy', { value: 100 }); await tick();
    expect(store.message()).toBe('Preferences saved. Buddy disengaged: choose at least 2 categories to engage again.');
  });
  it('drops a pending Buddy response after the employee context changes', async () => {
    const editor = briefEditorFixture();
    client.readEditor.mockResolvedValueOnce({ status: 'ok', value: { ...editor, initial: { ...editor.initial, buddy: buddyState('disengaged', null, 0) } } });
    await store.reload(); const response = deferred<BriefResult<BriefEngagementValue>>(); client.engage.mockReturnValueOnce(response.promise);
    const command = store.runBuddyCommand('engage'); state.set(ready('run-2')); TestBed.tick(); await tick();
    response.resolve({ status: 'ok', value: engagement(buddyState('engaged'), 5, 2) }); await command; await tick();
    expect(store.editor()?.initial.buddy.state).toBe('disengaged'); expect(store.briefVersion()).toBe(4);
    expect(client.engage).toHaveBeenCalledOnce();
    expect(client.engage.mock.calls[0][1].expectedContextKey).toBe(JSON.stringify(['subject-1', 'dev', 'run-1', 'employee-1']));
  });
});
