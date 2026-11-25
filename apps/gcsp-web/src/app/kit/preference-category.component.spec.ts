import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { briefEditorFixture } from '../preferences/brief.fixtures';
import { PreferenceCategoryComponent } from './preference-category.component';

const mount = async (key = 'body') => {
  const fixture = TestBed.createComponent(PreferenceCategoryComponent);
  fixture.componentRef.setInput('id', `test-${key}`); fixture.componentRef.setInput('categoryKey', key);
  fixture.componentRef.setInput('definition', briefEditorFixture().context.accountPreferences.categories[key]);
  fixture.componentRef.setInput('open', true);
  await fixture.whenStable();
  return fixture;
};
describe('frozen category preference presenter', () => {
  it('renders source tile icons, bin and importance states with intent-only selection', async () => {
    const fixture = await mount(); const root: HTMLElement = fixture.nativeElement;
    fixture.componentRef.setInput('state', { state: 'considered', value: ['estate'], importance: 'high', exact: true }); await fixture.whenStable();
    expect(root.querySelector('.gcsp-prefs-tile.is-considered.is-important.is-open')).not.toBeNull();
    expect(root.querySelectorAll('.gcsp-icon')).toHaveLength(2);
    const choose = root.querySelector<HTMLButtonElement>('.vm-option')!;
    const emitted = vi.fn(); fixture.componentInstance.changed.subscribe(emitted); choose.click();
    expect(emitted).toHaveBeenCalledWith({ value: ['saloon', 'estate'] });
    expect(root.querySelector('.gcsp-prefs-open')?.getAttribute('aria-label')).toContain('really important');
  });
  it('shows an unset slider default without emitting and reports the chosen stop label', async () => {
    const fixture = await mount('economy'); const root: HTMLElement = fixture.nativeElement; const emitted = vi.fn(); fixture.componentInstance.changed.subscribe(emitted);
    const slider = root.querySelector<HTMLInputElement>('input[type=range]')!;
    expect(slider).not.toBeNull(); expect(slider.value).toBe('50'); expect(slider.getAttribute('aria-valuetext')).toBe('Medium');
    expect(root.querySelectorAll('.gcsp-prefs-stops span')).toHaveLength(3); expect(emitted).not.toHaveBeenCalled();
    slider.value = '100'; slider.dispatchEvent(new Event('input')); await fixture.whenStable();
    expect(slider.getAttribute('aria-valuetext')).toBe('More'); expect(emitted).toHaveBeenCalledWith({ value: 100 });
  });
  it('keeps controls and focus across quiet state updates and exposes Done as a close intent', async () => {
    const fixture = await mount('economy'); const root: HTMLElement = fixture.nativeElement; document.body.append(root);
    const slider = root.querySelector<HTMLInputElement>('input[type=range]')!;
    expect(slider).not.toBeNull(); slider.focus();
    fixture.componentRef.setInput('state', { state: 'considered', value: 50, importance: 'high', exact: true }); await fixture.whenStable();
    expect(root.querySelector('input[type=range]')).toBe(slider); expect(document.activeElement).toBe(slider);
    const done = Array.from(root.querySelectorAll('button')).find(b => b.textContent === 'Done'); expect(done).toBeTruthy(); root.remove();
  });
  it('guards unset/disabled importance and range intents while Done emits only a close intent', async () => {
    const fixture = await mount('economy'); const root: HTMLElement = fixture.nativeElement; const changed = vi.fn(); const closed = vi.fn(); fixture.componentInstance.changed.subscribe(changed); fixture.componentInstance.closed.subscribe(closed);
    const importance = root.querySelector<HTMLInputElement>('input[role=switch]')!; expect(importance.disabled).toBe(true);
    importance.dispatchEvent(new Event('change')); expect(changed).not.toHaveBeenCalled();
    fixture.componentRef.setInput('state', { state: 'considered', value: 50, importance: 'medium', exact: true }); await fixture.whenStable(); importance.click(); expect(changed).toHaveBeenCalledWith({ importance: 'high' });
    changed.mockClear(); fixture.componentRef.setInput('disabled', true); await fixture.whenStable();
    const slider = root.querySelector<HTMLInputElement>('input[type=range]')!; expect(slider.disabled).toBe(true); slider.value = '100'; slider.dispatchEvent(new Event('input')); expect(changed).not.toHaveBeenCalled();
    fixture.componentRef.setInput('disabled', false); await fixture.whenStable(); Array.from(root.querySelectorAll('button')).find(b => b.textContent === 'Done')!.click(); expect(closed).toHaveBeenCalledOnce(); expect(changed).not.toHaveBeenCalled();
  });
  it('requires removal confirmation and preserves separate keep/remove intents', async () => {
    const fixture = await mount(); const root: HTMLElement = fixture.nativeElement;
    fixture.componentRef.setInput('state', { state: 'considered', value: ['estate'], importance: 'medium', exact: true }); await fixture.whenStable();
    const requested = vi.fn(); const removed = vi.fn(); const kept = vi.fn(); fixture.componentInstance.removeRequested.subscribe(requested); fixture.componentInstance.removed.subscribe(removed); fixture.componentInstance.kept.subscribe(kept);
    root.querySelector<HTMLButtonElement>('.gcsp-prefs-remove')!.click(); expect(requested).toHaveBeenCalledOnce(); expect(removed).not.toHaveBeenCalled();
    fixture.componentRef.setInput('removing', true); await fixture.whenStable();
    const actions = root.querySelectorAll<HTMLButtonElement>('.gcsp-prefs-removal button'); actions[0].click(); expect(kept).toHaveBeenCalledOnce(); actions[1].click(); expect(removed).toHaveBeenCalledOnce();
  });
});
