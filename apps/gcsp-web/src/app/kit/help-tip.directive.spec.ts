import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { HelpTipDirective, helpTip } from './help-tip.directive';

@Component({ imports: [HelpTipDirective], template: `<div [gcspHelpTip]="text()" helpTipId="angular-help" [helpTipDismissOnActivate]="false"><button>Information</button></div>` })
class Harness { text = signal('First description'); }
const pointer = (type: string, pointerType = 'mouse') => { const event = new Event(type, { bubbles: true }); Object.defineProperty(event, 'pointerType', { value: pointerType }); return event; };

describe('source help tip', () => {
  const create = (dismissOnActivate = true) => {
    const host = document.createElement('div'); const trigger = document.createElement('button'); host.append(trigger); document.body.append(host);
    trigger.setAttribute('aria-describedby', 'existing');
    const tip = helpTip({ host, triggers: [trigger], text: '<b>Plain help</b>', id: 'help', placement: 'above-end', dismissOnActivate });
    return { host, trigger, tip, destroy: () => { tip.destroy(); host.remove(); } };
  };
  it('keeps plain text, source placement, existing descriptions and complete cleanup', () => {
    const { host, trigger, tip, destroy } = create();
    expect(tip.root.className).toBe('gcsp-help-tip gcsp-help-tip-above-end'); expect(tip.root.querySelector('b')).toBeNull();
    expect(trigger.getAttribute('aria-describedby')).toBe('existing help'); expect(tip.root.hidden).toBe(true);
    trigger.focus(); expect(tip.root.hidden).toBe(false); host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); expect(tip.root.hidden).toBe(true);
    trigger.dispatchEvent(pointer('pointerenter')); expect(tip.root.hidden).toBe(true);
    trigger.blur(); host.dispatchEvent(pointer('pointerleave')); trigger.dispatchEvent(pointer('pointerenter')); expect(tip.root.hidden).toBe(false);
    document.body.dispatchEvent(pointer('pointerdown')); expect(tip.root.hidden).toBe(true);
    tip.setText('Updated help'); expect(tip.root.textContent).toBe('Updated help'); destroy(); expect(trigger.getAttribute('aria-describedby')).toBe('existing'); expect(host.querySelector('[role=tooltip]')).toBeNull();
  });
  it('ignores touch hover, retains keyboard help on pointer exit and supports activation help', () => {
    const { host, trigger, tip, destroy } = create(false);
    trigger.dispatchEvent(pointer('pointerenter', 'touch')); expect(tip.root.hidden).toBe(true);
    trigger.focus(); host.dispatchEvent(pointer('pointerleave')); expect(tip.root.hidden).toBe(false);
    trigger.click(); expect(tip.root.hidden).toBe(false); trigger.blur(); expect(tip.root.hidden).toBe(true);
    trigger.click(); expect(tip.root.hidden).toBe(false); destroy();
  });
  it('reuses the canonical directive with below-start default and changing input text', async () => {
    const fixture = TestBed.createComponent(Harness); await fixture.whenStable(); const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[role=tooltip]')?.className).toContain('gcsp-help-tip-below-start');
    fixture.componentInstance.text.set('Changed description'); await fixture.whenStable();
    expect(root.querySelector('[role=tooltip]')?.textContent).toBe('Changed description');
    fixture.destroy();
  });
});
