import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { SlotPickerComponent, SlotPickerSlot } from './slot-picker.component';

@Component({
  imports: [SlotPickerComponent],
  template: `<ul gcspSlotPicker [slots]="slots()" [actionLabel]="actionLabel()" [onPick]="onPick()" [disabled]="disabled()" [className]="className()"></ul>`,
})
class SlotHarness {
  readonly slots = input<readonly SlotPickerSlot[]>([]);
  readonly actionLabel = input('Request');
  readonly onPick = input<((slot: SlotPickerSlot) => void) | undefined>();
  readonly disabled = input(false);
  readonly className = input('');
}

async function render(slots: readonly SlotPickerSlot[] = [], onPick?: (slot: SlotPickerSlot) => void) {
  const fixture = TestBed.createComponent(SlotHarness);
  fixture.componentRef.setInput('slots', slots);
  fixture.componentRef.setInput('onPick', onPick);
  await fixture.whenStable();
  return fixture;
}

describe('SlotPickerComponent source port', () => {
  it('groups valid slots by London day while preserving first day and within-day supplied order', async () => {
    const slots = Object.freeze([
      Object.freeze({ slotId: 'next-day', start: '2026-07-02T23:30:00Z' }),
      Object.freeze({ slotId: 'earlier-day', start: '2026-07-02T08:00:00Z' }),
      Object.freeze({ slotId: 'same-day', start: '2026-07-03T00:15:00Z' }),
      Object.freeze({ slotId: 'invalid', start: 'not-a-date' }),
      Object.freeze({ slotId: 'missing' }),
      Object.freeze({ slotId: 'null', start: null }),
    ]);
    const fixture = await render(slots);
    const root: HTMLElement = fixture.nativeElement.querySelector('ul');
    expect([root.tagName, root.className]).toEqual(['UL', 'gcsp-slot-picker']);
    expect(Array.from(root.querySelectorAll('.gcsp-slot-day-heading')).map(node => node.textContent)).toEqual(['Fri 3 Jul 2026', 'Thu 2 Jul 2026']);
    expect(Array.from(root.querySelectorAll('.gcsp-slot-times')).map(node => Array.from(node.querySelectorAll('span')).map(time => time.textContent))).toEqual([['00:30', '01:15'], ['09:00']]);
    expect(root.querySelectorAll('.gcsp-slot-time')).toHaveLength(3);
    expect(slots[0].slotId).toBe('next-day');
  });

  it('names each day list with a unique visible heading across component instances', async () => {
    const fixture = await render([{ slotId: 'one', start: '2026-11-23T09:00:00Z' }]);
    const other = await render([{ slotId: 'two', start: '2026-11-23T10:00:00Z' }]);
    const list = fixture.nativeElement.querySelector('.gcsp-slot-times') as HTMLElement;
    const otherList = other.nativeElement.querySelector('.gcsp-slot-times') as HTMLElement;
    const id = list.getAttribute('aria-labelledby')!;
    expect(id).toBeTruthy();
    expect(fixture.nativeElement.querySelector(`#${id}`)?.textContent).toBe('Mon 23 Nov 2026');
    expect(otherList.getAttribute('aria-labelledby')).not.toBe(id);
  });

  it('uses native source ghost buttons with complete names and focus keys and returns the exact slot', async () => {
    const offered = Object.freeze({ slotId: 'exact/version-4', start: '2026-07-02T08:00:00Z', location: 'Malvern', version: 4 });
    const picked: SlotPickerSlot[] = [];
    const fixture = await render([offered], slot => picked.push(slot));
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect([button.type, button.className, button.textContent]).toEqual(['button', 'vm-btn vm-btn-ghost', '09:00']);
    expect(button.getAttribute('aria-label')).toBe('Request 2 Jul 2026, 09:00');
    expect(button.dataset['focusKey']).toBe('Request 2 Jul 2026, 09:00');
    expect(button.hasAttribute('tabindex')).toBe(false);
    expect(picked).toEqual([]);
    document.body.append(fixture.nativeElement);
    button.focus();
    expect(document.activeElement).toBe(button);
    button.click();
    expect(picked).toHaveLength(1);
    expect(picked[0]).toBe(offered);
    fixture.nativeElement.remove();
  });

  it('updates action names and disables every offered native control without calling the owner', async () => {
    const picked: SlotPickerSlot[] = [];
    const fixture = await render([{ slotId: 'one', start: '2026-11-23T09:00:00Z' }, { slotId: 'two', start: '2026-11-23T10:00:00Z' }], slot => picked.push(slot));
    fixture.componentRef.setInput('disabled', true);
    fixture.componentRef.setInput('actionLabel', 'Choose return');
    fixture.componentRef.setInput('className', 'source-slots');
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement.querySelector('ul');
    expect(root.className).toBe('gcsp-slot-picker source-slots');
    const buttons = Array.from(root.querySelectorAll('button'));
    expect(buttons.map(button => button.disabled)).toEqual([true, true]);
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual(['Choose return 23 Nov 2026, 09:00', 'Choose return 23 Nov 2026, 10:00']);
    for (const button of buttons) button.click();
    expect(picked).toEqual([]);
    fixture.componentRef.setInput('onPick', undefined);
    await fixture.whenStable();
    expect(root.querySelector('button')).toBeNull();
    expect(Array.from(root.querySelectorAll('.gcsp-slot-time > span')).map(node => node.textContent)).toEqual(['09:00', '10:00']);
  });

  it('uses London daylight saving time and clears replaced inputs without synthetic slots', async () => {
    const fixture = await render([{ slotId: 'before', start: '2026-03-29T00:30:00Z' }, { slotId: 'after', start: '2026-03-29T01:30:00Z' }]);
    const root: HTMLElement = fixture.nativeElement.querySelector('ul');
    expect(root.querySelector('.gcsp-slot-day-heading')?.textContent).toBe('Sun 29 Mar 2026');
    expect(Array.from(root.querySelectorAll('span')).map(node => node.textContent)).toEqual(['00:30', '02:30']);
    fixture.componentRef.setInput('slots', []);
    await fixture.whenStable();
    expect(root.children).toHaveLength(0);
  });
});
