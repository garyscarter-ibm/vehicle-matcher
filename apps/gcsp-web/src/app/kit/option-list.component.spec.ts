import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { OptionListComponent, OptionListOption } from './option-list.component';

const choices: readonly OptionListOption[] = Object.freeze([
  Object.freeze({ value: '', label: 'All cars', sub: '12 cars' }),
  Object.freeze({ value: 'off', label: 'Unavailable', disabled: true }),
  Object.freeze({ value: 'estate', label: 'Touring', sub: '2 cars' }),
  Object.freeze({ value: 'old', label: 'Coupe (not currently available)', sub: '0 cars' }),
]);

@Component({ imports: [OptionListComponent], template: `<form (submit)="submits = submits + 1"><gcsp-option-list groupId="body" label="Body style" [options]="options" [value]="value" (valueChange)="value = $event; changes.push($event)" /></form>` })
class Host {
  options = choices;
  value: string | null = '';
  changes: string[] = [];
  submits = 0;
}

async function render(value: string | null = '', options = choices, disabled = false) {
  const fixture = TestBed.createComponent(OptionListComponent);
  fixture.componentRef.setInput('groupId', 'series');
  fixture.componentRef.setInput('label', 'Series');
  fixture.componentRef.setInput('options', options);
  fixture.componentRef.setInput('value', value);
  fixture.componentRef.setInput('disabled', disabled);
  const emitted: string[] = [];
  fixture.componentInstance.valueChange.subscribe(next => emitted.push(next));
  await fixture.whenStable();
  document.body.append(fixture.nativeElement);
  return { fixture, emitted, buttons: () => [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[] };
}

function key(button: HTMLButtonElement, value: string) {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
  button.dispatchEvent(event);
  return event;
}

describe('OptionListComponent', () => {
  it('names its group, renders count labels and native button radios', async () => {
    const { fixture, emitted, buttons } = await render('old');
    const group = fixture.nativeElement.querySelector('[role="radiogroup"]');
    expect(group.id).toBe('series');
    expect(group.getAttribute('aria-label')).toBe('Series');
    expect(buttons().every(button => button.type === 'button' && button.getAttribute('role') === 'radio')).toBe(true);
    expect(buttons()[3].textContent).toContain('0 cars');
    expect(buttons()[3].getAttribute('aria-checked')).toBe('true');
    expect(buttons().map(button => button.tabIndex)).toEqual([-1, -1, -1, 0]);
    expect(emitted).toEqual([]);
  });

  it('emits explicit clicks without locally changing the controlled value', async () => {
    const { fixture, emitted, buttons } = await render();
    buttons()[2].click();
    await fixture.whenStable();
    expect(emitted).toEqual(['estate']);
    expect(buttons()[0].getAttribute('aria-checked')).toBe('true');
    expect(buttons()[2].getAttribute('aria-checked')).toBe('false');
    expect(fixture.componentInstance.value()).toBe('');
  });

  it('accepts host feedback and does not submit a surrounding form', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const buttons = fixture.nativeElement.querySelectorAll('button');
    buttons[2].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.value).toBe('estate');
    expect(fixture.componentInstance.changes).toEqual(['estate']);
    expect(buttons[2].getAttribute('aria-checked')).toBe('true');
    expect(fixture.componentInstance.submits).toBe(0);
  });

  it.each([
    ['ArrowRight', 0, 2], ['ArrowDown', 2, 3], ['ArrowLeft', 2, 0], ['ArrowUp', 0, 3],
    ['ArrowRight', 3, 0], ['ArrowLeft', 0, 3], ['Home', 3, 0], ['End', 0, 3],
  ] as const)('%s focuses and emits the enabled destination', async (name, from, to) => {
    const { emitted, buttons } = await render();
    buttons()[from].focus();
    expect(key(buttons()[from], name).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons()[to]);
    expect(emitted).toEqual([choices[to].value]);
  });

  it.each(['Tab', ' ', 'Enter', 'Escape', 'a'])('leaves %s default behavior to the browser', async name => {
    const { emitted, buttons } = await render();
    buttons()[0].focus();
    expect(key(buttons()[0], name).defaultPrevented).toBe(false);
    expect(emitted).toEqual([]);
    expect(document.activeElement).toBe(buttons()[0]);
  });

  it('uses native per-option disabled semantics and rejects synthetic activation', async () => {
    const { fixture, emitted, buttons } = await render('off');
    expect(buttons()[1].disabled).toBe(true);
    expect(buttons()[1].getAttribute('aria-checked')).toBe('true');
    expect(buttons()[0].tabIndex).toBe(0);
    buttons()[1].click();
    buttons()[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(key(buttons()[1], 'ArrowRight').defaultPrevented).toBe(false);
    await fixture.whenStable();
    expect(emitted).toEqual([]);
  });

  it('disables the whole group without discarding selection', async () => {
    const { fixture, emitted, buttons } = await render('estate', choices, true);
    expect(fixture.nativeElement.querySelector('[role="radiogroup"]').getAttribute('aria-disabled')).toBe('true');
    expect(buttons().every(button => button.disabled && button.tabIndex === -1)).toBe(true);
    expect(buttons()[2].getAttribute('aria-checked')).toBe('true');
    buttons()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(key(buttons()[0], 'End').defaultPrevented).toBe(false);
    expect(emitted).toEqual([]);
    fixture.componentRef.setInput('disabled', false);
    await fixture.whenStable();
    expect(buttons()[2].tabIndex).toBe(0);
  });

  it('retains an absent restored value with a valid unselected tab entry', async () => {
    const { fixture, emitted, buttons } = await render('missing');
    expect(buttons().every(button => button.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(buttons()[0].tabIndex).toBe(0);
    expect(fixture.componentInstance.value()).toBe('missing');
    fixture.componentRef.setInput('options', [...choices, { value: 'missing', label: 'Saved series (not currently available)', sub: '0 cars' }]);
    await fixture.whenStable();
    expect(buttons()[4].getAttribute('aria-checked')).toBe('true');
    expect(buttons()[4].tabIndex).toBe(0);
    expect(emitted).toEqual([]);
  });

  it('keeps stable buttons and focus across cloned/reordered inputs without emissions', async () => {
    const { fixture, emitted, buttons } = await render('estate');
    const touring = buttons()[2]; touring.focus();
    fixture.componentRef.setInput('options', [...choices].reverse().map(option => ({ ...option })));
    await fixture.whenStable();
    expect(buttons()[1]).toBe(touring);
    expect(document.activeElement).toBe(touring);
    expect(touring.tabIndex).toBe(0);
    expect(emitted).toEqual([]);
    fixture.componentRef.setInput('value', 'old');
    fixture.componentRef.setInput('options', choices.map(option => ({ ...option, sub: 'Updated count' })));
    await fixture.whenStable();
    expect(buttons()[3].tabIndex).toBe(0);
    expect(buttons()[3].textContent).toContain('Updated count');
    expect(emitted).toEqual([]);
    expect(choices[2].sub).toBe('2 cars');
  });

  it('returns removed-option focus to the valid tab entry without emitting', async () => {
    const { fixture, emitted, buttons } = await render('estate');
    buttons()[2].focus();
    fixture.componentRef.setInput('options', choices.filter(option => option.value !== 'estate'));
    await fixture.whenStable();
    expect(document.activeElement).toBe(buttons()[0]);
    expect(fixture.componentInstance.value()).toBe('estate');
    expect(buttons().every(button => button.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(emitted).toEqual([]);
  });

  it('does not steal focus from outside the group during input updates', async () => {
    const { fixture, buttons } = await render('estate');
    const outside = document.createElement('button'); document.body.append(outside);
    buttons()[2].focus(); outside.focus();
    fixture.componentRef.setInput('options', [...choices].reverse());
    await fixture.whenStable();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('handles empty/all-disabled options and teardown', async () => {
    const { fixture, emitted, buttons } = await render(null, choices.map(option => ({ ...option, disabled: true })));
    expect(buttons().every(button => button.tabIndex === -1)).toBe(true);
    fixture.componentRef.setInput('options', []);
    await fixture.whenStable();
    expect(buttons()).toHaveLength(0);
    expect(emitted).toEqual([]);
    fixture.destroy();
    expect(fixture.componentRef.hostView.destroyed).toBe(true);
  });

  it('escapes supplied group names, labels, values and sub text', async () => {
    const text = '<img src=x onerror=alert(1)>' + 'LongUnbrokenSeries'.repeat(20);
    const { fixture, buttons } = await render(text, [{ value: text, label: text, sub: '<b>0 cars</b>' }]);
    fixture.componentRef.setInput('label', '<script>Series</script>');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('img, b, script')).toBeNull();
    expect(buttons()[0].textContent).toContain(text);
    expect(buttons()[0].textContent).toContain('<b>0 cars</b>');
    expect(buttons()[0].getAttribute('aria-checked')).toBe('true');
    expect(fixture.nativeElement.querySelector('[role="radiogroup"]').getAttribute('aria-label')).toBe('<script>Series</script>');
  });
});
