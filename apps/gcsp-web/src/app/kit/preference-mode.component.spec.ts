import { By } from '@angular/platform-browser';
import { HelpTipDirective } from './help-tip.directive';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { PreferenceModeComponent } from './preference-mode.component';
const mount = async () => { const f = TestBed.createComponent(PreferenceModeComponent); f.componentRef.setInput('id', 'mode'); f.componentRef.setInput('description', 'BMW Touring'); await f.whenStable(); return f; };
describe('source preference mode and help', () => {
  it('uses the canonical help port with source placement, retained activation and live description', async () => {
    const f = await mount(); const host = f.debugElement.query(By.directive(HelpTipDirective));
    expect(host).not.toBeNull();
    const help = host.injector.get(HelpTipDirective);
    expect(help.helpTipPlacement).toBe('below-start'); expect(help.helpTipDismissOnActivate).toBe(false);
    f.componentRef.setInput('description', 'BMW i4'); await f.whenStable();
    expect(f.nativeElement.querySelector('[role=tooltip]').textContent).toContain('BMW i4');
    expect(f.nativeElement.querySelectorAll('[role=tooltip]')).toHaveLength(1);
  });
  it('presents the alternative radios and emits controlled mode intent while hiding help', async () => {
    const f = await mount(); const root: HTMLElement = f.nativeElement; const changed = vi.fn(); f.componentInstance.toggled.subscribe(changed);
    const info = root.querySelector<HTMLButtonElement>('.gcsp-prefs-info')!; info.click(); await f.whenStable(); expect(root.querySelector<HTMLElement>('[role=tooltip]')!.hidden).toBe(false);
    root.querySelectorAll<HTMLInputElement>('input')[1].click(); await f.whenStable(); expect(changed).toHaveBeenCalledWith(true); expect(root.querySelector<HTMLElement>('[role=tooltip]')!.hidden).toBe(true);
    f.componentRef.setInput('on', true); await f.whenStable(); expect(root.querySelectorAll<HTMLInputElement>('input')[1].checked).toBe(true); expect(root.querySelector('.gcsp-prefs-same-summary')?.textContent).toContain('More like your BMW Touring');
  });
  it('dismisses help on Escape/outside pointer and releases dismissal after leaving', async () => {
    const f = await mount(); const root: HTMLElement = f.nativeElement; const info = root.querySelector<HTMLButtonElement>('button')!; const tip = root.querySelector<HTMLElement>('[role=tooltip]')!;
    info.focus(); await f.whenStable(); expect(tip.hidden).toBe(false);
    info.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await f.whenStable(); expect(tip.hidden).toBe(true);
    info.dispatchEvent(new Event('pointerenter')); await f.whenStable(); expect(tip.hidden).toBe(true);
    root.querySelector('.gcsp-prefs-mode')!.dispatchEvent(new FocusEvent('focusout', { relatedTarget: document.body, bubbles: true })); info.dispatchEvent(new Event('pointerenter')); await f.whenStable(); expect(tip.hidden).toBe(false);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); await f.whenStable(); expect(tip.hidden).toBe(true);
  });
  it('unchecks unavailable Same again, hides help and keeps custom preferences available', async () => {
    const f = await mount(); f.componentRef.setInput('on', true); f.componentRef.setInput('available', false); f.componentRef.setInput('reason', 'current-car-unidentified'); await f.whenStable(); const root: HTMLElement = f.nativeElement; const radios = root.querySelectorAll<HTMLInputElement>('input');
    expect([radios[0].checked, radios[0].disabled, radios[1].checked, radios[1].disabled]).toEqual([true, false, false, true]); expect(root.querySelector<HTMLButtonElement>('button')!.hidden).toBe(true); expect(root.querySelector('.gcsp-prefs-same-note')?.textContent).toBe('Your current car details are incomplete.');
    f.componentRef.setInput('disabled', true); await f.whenStable(); expect(radios[0].disabled).toBe(true);
  });
});
