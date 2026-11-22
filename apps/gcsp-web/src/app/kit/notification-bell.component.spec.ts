import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationBellComponent } from './notification-bell.component';
import { NotificationModel } from './notification-bell.types';

const current: NotificationModel = { status: 'ok', waiting: 1, note: null, rows: [{ key: 'offer:one', kind: 'offer', waiting: true,
  title: 'Your buddy found a car', car: 'BMW X2', detail: 'Reserved for you. Respond by 14:00.', image: { src: '/assets/brand-hero/bmw.jpg' },
  action: { label: 'View your offer', href: '/gcsp/offers/one', variant: 'button' } }] };
async function mount(model = current) {
  const fixture = TestBed.createComponent(NotificationBellComponent); fixture.componentRef.setInput('model', model);
  await fixture.whenStable(); const root: HTMLElement = fixture.nativeElement; document.body.append(root);
  return { fixture, root, trigger: root.querySelector<HTMLButtonElement>('.gcsp-bell-btn')!, panel: root.querySelector<HTMLElement>('.gcsp-bell-panel')! };
}
describe('native notification bell', () => {
  afterEach(() => vi.useRealTimers());
  it('preserves source classes, accessible disclosure, action and decorative thumbnail without clearing count', async () => {
    const { fixture, root, trigger, panel } = await mount();
    expect(trigger.getAttribute('aria-label')).toBe('Notifications, 1 car offer waiting'); expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBe(panel.id); expect(panel.hidden).toBe(true);
    expect(root.querySelector('img')?.alt).toBe(''); trigger.click(); await fixture.whenStable();
    expect(panel.hidden).toBe(false); expect(trigger.classList.contains('is-open')).toBe(true);
    const action = root.querySelector<HTMLAnchorElement>('.gcsp-bell-action')!;
    expect(action.classList.contains('vm-btn-primary')).toBe(true); expect(panel.textContent).toContain('Reserved for you. Respond by 14:00.');
    const navigate = vi.fn(); fixture.componentInstance.navigate.subscribe(navigate);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true }); action.dispatchEvent(event); await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith('/gcsp/offers/one'); expect(event.defaultPrevented).toBe(true);
    expect(panel.hidden).toBe(true); expect(root.querySelector('.gcsp-bell-badge')?.textContent).toBe('1'); root.remove();
  });
  it('closes on Escape and outside clicks, preserving deliberate outside focus', async () => {
    const { fixture, root, trigger, panel } = await mount();
    trigger.click(); await fixture.whenStable(); root.querySelector<HTMLAnchorElement>('a')!.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await fixture.whenStable();
    expect(panel.hidden).toBe(true); expect(document.activeElement).toBe(trigger);
    const outside = document.createElement('button'); document.body.append(outside);
    trigger.click(); await fixture.whenStable(); outside.focus(); outside.click(); await fixture.whenStable();
    expect(panel.hidden).toBe(true); expect(document.activeElement).toBe(outside);
    trigger.focus(); trigger.click(); await fixture.whenStable(); document.body.click(); await fixture.whenStable();
    expect(panel.hidden).toBe(true); expect(document.activeElement).toBe(trigger); outside.remove(); root.remove();
  });
  it('announces a new note once, hides it after six seconds or opening and cancels it on teardown', async () => {
    const { fixture, root, trigger } = await mount(); vi.useFakeTimers();
    const next = { ...current, note: { id: 'new', title: 'Your buddy found a car', text: 'BMW X2. Respond by 14:00.' } };
    fixture.componentRef.setInput('model', next); fixture.detectChanges(); await Promise.resolve(); fixture.detectChanges();
    const note = root.querySelector<HTMLElement>('.gcsp-bell-note')!;
    expect(note.hidden).toBe(false); expect(root.querySelector('[role="status"]')?.textContent).toContain('Your buddy found a car. BMW X2.');
    await vi.advanceTimersByTimeAsync(6000); fixture.detectChanges(); expect(note.hidden).toBe(true);
    fixture.componentRef.setInput('model', { ...next }); fixture.detectChanges(); expect(note.hidden).toBe(true);
    fixture.componentRef.setInput('model', { ...next, note: { ...next.note, id: 'another' } }); fixture.detectChanges();
    trigger.click(); fixture.detectChanges(); expect(note.hidden).toBe(true);
    fixture.componentInstance.close(false);
    const schedule = vi.spyOn(globalThis, 'setTimeout'); const cancel = vi.spyOn(globalThis, 'clearTimeout');
    fixture.componentRef.setInput('model', { ...next, note: { ...next.note, id: 'teardown' } }); fixture.detectChanges();
    const noteTimer = schedule.mock.results.at(-1)?.value;
    fixture.destroy(); expect(cancel).toHaveBeenCalledWith(noteTimer); schedule.mockRestore(); cancel.mockRestore(); root.remove();
  });
  it('renders empty/unavailable/expired states and restores trigger when a focused row disappears', async () => {
    const { fixture, root, trigger, panel } = await mount(); trigger.click(); await fixture.whenStable(); root.querySelector<HTMLAnchorElement>('a')!.focus();
    fixture.componentRef.setInput('model', { status: 'ok', waiting: 0, rows: [], note: null }); await fixture.whenStable();
    expect(panel.textContent).toContain('No notifications yet.'); expect(document.activeElement).toBe(trigger);
    fixture.componentRef.setInput('model', { status: 'unavailable', waiting: 1, rows: [], note: null }); await fixture.whenStable();
    expect(panel.textContent).toContain('Notifications are unavailable right now.'); expect(root.querySelector<HTMLElement>('.gcsp-bell-badge')!.hidden).toBe(true);
    fixture.componentRef.setInput('model', { ...current, waiting: 0, rows: [{ key: 'expired', kind: 'offer', title: 'Your offer expired.', action: { label: 'View expired offer', href: '/gcsp/offers/old', variant: 'link' } }] }); await fixture.whenStable();
    expect(root.querySelector('.gcsp-bell-link')?.textContent).toBe('View expired offer'); expect(root.querySelector('img')).toBeNull(); root.remove();
  });
});
