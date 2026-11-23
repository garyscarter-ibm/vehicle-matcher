import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { BriefClient } from './brief.client';
import { briefEditorFixture, preferenceSaveFixture } from './brief.fixtures';
import { CurrentCarRatingComponent } from './current-car-rating.component';

describe('current-car source rating composition', () => {
  let fixture: ComponentFixture<CurrentCarRatingComponent>;
  let state: ReturnType<typeof signal<SessionState>>;
  const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
  const client = { readEditor: vi.fn(), savePreferences: vi.fn() };
  beforeEach(() => {
    client.readEditor.mockReset().mockResolvedValue({ status: 'ok', value: briefEditorFixture() });
    client.savePreferences.mockReset().mockResolvedValue({ status: 'unavailable', retryable: true });
    state = signal<SessionState>({ status: 'ready', context: { subject: 's', environmentId: 'dev', runId: 'r', employeeId: 'e', roles: ['employee'], capabilities: [], policyVersion: 'policy' } });
    TestBed.configureTestingModule({ providers: [{ provide: BriefClient, useValue: client }, { provide: AuthPort, useValue: { state } }] });
  });
  afterEach(() => fixture?.destroy());
  const mount = async (contractId = 'contract-1') => {
    fixture = TestBed.createComponent(CurrentCarRatingComponent); fixture.componentRef.setInput('contractId', contractId);
    fixture.componentRef.setInput('carDescription', 'BMW M Sport Petrol'); fixture.componentRef.setInput('overlay', true); fixture.componentRef.setInput('pill', true);
    await fixture.whenStable(); return fixture.nativeElement as HTMLElement;
  };
  it('keeps exact current-contract gating and places source question/help on the photo pill', async () => {
    const root = await mount('other'); expect(root.querySelector('fieldset')).toBeNull();
    fixture.componentRef.setInput('contractId', 'contract-1'); await fixture.whenStable();
    expect(root.querySelector('fieldset')?.className).toContain('gcsp-star-rating-overlay gcsp-star-rating-pill');
    expect(root.querySelector('legend')?.textContent).toBe('How highly do you rate your BMW M Sport Petrol?');
    expect(root.querySelector('[role=tooltip]')?.textContent).toBe('How highly do you rate your BMW M Sport Petrol?');
  });
  it('routes rating, same-command retry and reload through the unchanged store', async () => {
    const root = await mount(); root.querySelectorAll<HTMLInputElement>('input')[3].click(); await fixture.whenStable();
    expect(client.savePreferences.mock.calls[0][0].currentCarRating).toEqual({ contractId: 'contract-1', value: 4 });
    expect(root.textContent).toContain('Rating not saved');
    root.querySelector<HTMLButtonElement>('button[aria-label="Try saving your rating again"]')!.click(); await fixture.whenStable();
    expect(client.savePreferences).toHaveBeenCalledTimes(2); expect(client.savePreferences.mock.calls[1][0].commandId).toBe(client.savePreferences.mock.calls[0][0].commandId);
    Array.from(root.querySelectorAll('button')).find((button) => button.textContent === 'Reload preferences')!.click(); await fixture.whenStable();
    expect(client.readEditor).toHaveBeenCalledTimes(2);
  });
  const settle = async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); await fixture.whenStable(); };
  const status = (root: HTMLElement) => root.querySelector('fieldset')?.getAttribute('data-status');
  const succeed = () => client.savePreferences.mockImplementation(async (command) => ({ status: 'ok', value: { ...preferenceSaveFixture(),
    draftVersion: command.expectedDraftVersion + 1, currentCarRating: command.currentCarRating ?? fixture.componentInstance.store.editor()!.initial.currentCarRating } }));
  it('keeps unrelated initial/category failures out of the rating lane while retaining global recovery', async () => {
    const root = await mount(); fixture.componentInstance.store.change('economy', { value: 100 }); await fixture.whenStable();
    expect(status(root)).toBe('idle'); expect(root.querySelector('[role=status]')?.textContent).not.toContain('Rating');
    expect(root.querySelector('button[aria-label="Try saving your rating again"]')).toBeNull();
    expect(Array.from(root.querySelectorAll('button')).map((button) => button.textContent)).toContain('Reload preferences');
    expect(Array.from(root.querySelectorAll('button')).map((button) => button.textContent)).toContain('Try again');
  });
  it('does not reinterpret a completed rating when a later category command queues or fails', async () => {
    succeed(); const root = await mount(); root.querySelectorAll<HTMLInputElement>('input')[3].click(); await fixture.whenStable();
    expect(status(root)).toBe('saved');
    const category = deferred(); client.savePreferences.mockReturnValueOnce(category.promise);
    fixture.componentInstance.store.change('economy', { value: 100 }); await fixture.whenStable(); expect(status(root)).toBe('idle');
    category.resolve({ status: 'unavailable', retryable: true }); await settle(); expect(status(root)).toBe('idle');
    expect(root.querySelector('[role=status]')?.textContent).not.toContain('Rating');
  });
  it('tracks its own pending/failed/retried save outcome and resets on explicit reload', async () => {
    const save = deferred(); client.savePreferences.mockReturnValueOnce(save.promise); const root = await mount();
    root.querySelectorAll<HTMLInputElement>('input')[3].click(); await fixture.whenStable(); expect(status(root)).toBe('pending');
    save.resolve({ status: 'unavailable', retryable: true }); await settle(); expect(status(root)).toBe('failed');
    succeed(); root.querySelector<HTMLButtonElement>('button[aria-label="Try saving your rating again"]')!.click(); await fixture.whenStable();
    expect(status(root)).toBe('saved'); expect(client.savePreferences.mock.calls[1][0].commandId).toBe(client.savePreferences.mock.calls[0][0].commandId);
    await fixture.componentInstance.store.reload(); await fixture.whenStable(); expect(status(root)).toBe('idle');
  });
  it('keeps a rating queued behind a failed unrelated command pending until a retry actually sends it', async () => {
    const category = deferred(); client.savePreferences.mockReturnValueOnce(category.promise); const root = await mount();
    fixture.componentInstance.store.change('economy', { value: 100 }); await fixture.whenStable();
    root.querySelectorAll<HTMLInputElement>('input')[3].click(); await fixture.whenStable();
    expect(client.savePreferences).toHaveBeenCalledTimes(1); expect(client.savePreferences.mock.calls[0][0].currentCarRating).toBeUndefined();
    category.resolve({ status: 'unavailable', retryable: true }); await settle(); expect(status(root)).toBe('pending');
    succeed(); Array.from(root.querySelectorAll('button')).find((button) => button.textContent === 'Try again')!.click(); await fixture.whenStable();
    expect(client.savePreferences.mock.calls[1][0].currentCarRating).toEqual({ contractId: 'contract-1', value: 4 }); expect(status(root)).toBe('saved');
  });
  it('does not reopen a refused rating operation when a later category command fails', async () => {
    client.savePreferences.mockResolvedValueOnce({ status: 'invalid', retryable: false }); const root = await mount();
    root.querySelectorAll<HTMLInputElement>('input')[3].click(); await fixture.whenStable(); expect(status(root)).toBe('failed');
    expect(fixture.componentInstance.store.failure()).toBeNull(); expect(root.querySelector('button')).toBeNull();
    fixture.componentInstance.store.change('economy', { value: 100 }); await fixture.whenStable();
    expect(status(root)).toBe('idle'); expect(root.querySelector('[role=status]')?.textContent).not.toContain('Rating');
  });
  it('recognizes its own failure after an earlier category save succeeds in the shared queue', async () => {
    const category = deferred(); client.savePreferences.mockReturnValueOnce(category.promise); const root = await mount();
    fixture.componentInstance.store.change('economy', { value: 100 }); await fixture.whenStable();
    root.querySelectorAll<HTMLInputElement>('input')[3].click(); await fixture.whenStable();
    category.resolve({ status: 'ok', value: preferenceSaveFixture() }); await settle();
    expect(client.savePreferences).toHaveBeenCalledTimes(2); expect(client.savePreferences.mock.calls[1][0].currentCarRating).toEqual({ contractId: 'contract-1', value: 4 });
    expect(status(root)).toBe('failed');
  });
  it('resets the local lane on contract mismatch and a new authenticated scope, ignoring old outcomes', async () => {
    succeed(); const root = await mount(); root.querySelectorAll<HTMLInputElement>('input')[3].click(); await fixture.whenStable(); expect(status(root)).toBe('saved');
    fixture.componentRef.setInput('contractId', 'other'); await fixture.whenStable(); expect(root.querySelector('fieldset')).toBeNull();
    fixture.componentRef.setInput('contractId', 'contract-1'); await fixture.whenStable(); expect(status(root)).toBe('idle');
    const save = deferred(); client.savePreferences.mockReturnValueOnce(save.promise); root.querySelectorAll<HTMLInputElement>('input')[4].click(); await fixture.whenStable(); expect(status(root)).toBe('pending');
    state.set({ status: 'ready', context: { subject: 'new', environmentId: 'dev', runId: 'new-run', employeeId: 'new', roles: ['employee'], capabilities: [], policyVersion: 'policy' } }); await fixture.whenStable();
    expect(status(root)).toBe('idle'); save.resolve({ status: 'unavailable', retryable: true }); await settle(); expect(status(root)).toBe('idle');
  });

});
