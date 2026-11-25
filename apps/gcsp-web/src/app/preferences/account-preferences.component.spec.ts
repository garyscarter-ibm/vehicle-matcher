import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort } from '../auth/auth.port';
import { BriefClient } from './brief.client';
import { briefEditorFixture, preferenceSaveFixture } from './brief.fixtures';
import { AccountPreferencesComponent } from './account-preferences.component';

describe('source account preferences composition', () => {
  const client = { readEditor: vi.fn(), savePreferences: vi.fn() };
  beforeEach(() => {
    client.readEditor.mockReset().mockResolvedValue({ status: 'ok', value: briefEditorFixture() });
    client.savePreferences.mockReset().mockResolvedValue({ status: 'ok', value: preferenceSaveFixture() });
    TestBed.configureTestingModule({ providers: [{ provide: BriefClient, useValue: client }, { provide: AuthPort, useValue: { state: signal({ status: 'ready', context: { subject: 's', environmentId: 'dev', runId: 'r', employeeId: 'e', roles: ['employee'] } }) } }] });
  });
  it('composes the source mode, completeness segments and a shared panel after the tile grid', async () => {
    const fixture = TestBed.createComponent(AccountPreferencesComponent); await fixture.whenStable(); const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.gcsp-prefs.gcsp-prefs-choice')).not.toBeNull();
    expect(root.querySelector('.gcsp-understanding[data-kind="input-completeness"]')).not.toBeNull();
    expect(root.querySelector('.gcsp-understanding-value')?.getAttribute('aria-label')).toBe('Buddy understanding 50 out of 99');
    const tiles = root.querySelector('.gcsp-prefs-tiles')!; expect(tiles.querySelectorAll('.gcsp-prefs-tile')).toHaveLength(2);
    fixture.componentInstance.store.open('economy'); await fixture.whenStable();
    const panel = root.querySelector('.gcsp-prefs-panel')!; expect(panel).not.toBeNull(); expect(tiles.contains(panel)).toBe(false);
    const done = Array.from(panel.querySelectorAll('button')).find(b => b.textContent === 'Done')!; done.click(); await fixture.whenStable();
    expect(fixture.componentInstance.store.openCategory()).toBeNull(); expect(document.activeElement?.classList.contains('gcsp-prefs-open')).toBe(true);
  });
  it('keeps saved categories while switching modes and dismisses help on toggle', async () => {
    const fixture = TestBed.createComponent(AccountPreferencesComponent); fixture.componentRef.setInput('carDescription', 'BMW Touring'); await fixture.whenStable(); const root: HTMLElement = fixture.nativeElement;
    const categories = fixture.componentInstance.store.categories();
    const saved = preferenceSaveFixture(); client.savePreferences.mockResolvedValueOnce({ status: 'ok', value: { ...saved, sameAgain: { available: true, on: true, contractId: 'contract-1' }, accountPreferences: { ...saved.accountPreferences, sameAgain: true } } });
    root.querySelector<HTMLButtonElement>('.gcsp-prefs-info')!.click(); await fixture.whenStable(); expect(root.querySelector<HTMLElement>('[role=tooltip]')!.hidden).toBe(false);
    root.querySelectorAll<HTMLInputElement>('.gcsp-prefs-mode-option input')[1].click(); await fixture.whenStable();
    expect(root.querySelector<HTMLElement>('.gcsp-prefs-tiles')!.hidden).toBe(true); expect(root.querySelector<HTMLElement>('[role=tooltip]')!.hidden).toBe(true);
    expect(fixture.componentInstance.store.categories()).toEqual(categories); expect(root.textContent).toContain('More like your BMW Touring');
  });
  it('keeps the open slider through quiet updates and returns confirmation focus to its category', async () => {
    const fixture = TestBed.createComponent(AccountPreferencesComponent); await fixture.whenStable(); const root: HTMLElement = fixture.nativeElement; const store = fixture.componentInstance.store;
    store.open('economy'); await fixture.whenStable(); const slider = root.querySelector<HTMLInputElement>('input[type=range]')!; slider.focus();
    store.categories.update(categories => ({ ...categories, economy: { state: 'considered', value: 50, importance: 'high', exact: true } })); await fixture.whenStable();
    expect(root.querySelector('input[type=range]')).toBe(slider); expect(document.activeElement).toBe(slider);
    root.querySelectorAll<HTMLButtonElement>('.gcsp-prefs-remove')[1].click(); await fixture.whenStable();
    const keep = root.querySelector<HTMLButtonElement>('.gcsp-prefs-removal button')!; expect(document.activeElement).toBe(keep); keep.click(); await fixture.whenStable();
    expect(document.activeElement).toBe(root.querySelectorAll('.gcsp-prefs-remove')[1]); expect(store.pendingRemoval()).toBeNull();
    root.querySelectorAll<HTMLButtonElement>('.gcsp-prefs-remove')[1].click(); await fixture.whenStable();
    root.querySelectorAll<HTMLButtonElement>('.gcsp-prefs-removal button')[1].click(); await fixture.whenStable();
    expect(document.activeElement).toBe(root.querySelectorAll('.gcsp-prefs-open')[1]); expect(store.pendingRemoval()).toBeNull();
  });
  it('marks the projected meter unsaved after a failed save without changing its value', async () => {
    const fixture = TestBed.createComponent(AccountPreferencesComponent); await fixture.whenStable();
    client.savePreferences.mockResolvedValue({ status: 'unavailable', retryable: true });
    fixture.componentInstance.store.change('body', { value: ['estate'] }); await new Promise(r => setTimeout(r, 0)); await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement; expect(root.querySelector('.gcsp-understanding.is-pending')).not.toBeNull();
    expect(root.querySelector('.gcsp-understanding-value')?.getAttribute('aria-label')).toBe('Buddy understanding 99 out of 99 (not saved)');
    expect(fixture.componentInstance.store.understanding()?.value).toBe(100);
  });
});
