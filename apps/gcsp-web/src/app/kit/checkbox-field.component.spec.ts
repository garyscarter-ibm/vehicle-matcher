import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { CheckboxFieldComponent } from './checkbox-field.component';

@Component({
  imports: [CheckboxFieldComponent],
  template: '<div gcspCheckboxField class="caller-layout" [controlId]="controlId()" [label]="label()" [checked]="checked()" [disabled]="disabled()" [describedBy]="describedBy()" [switch]="asSwitch()" (checkedChange)="changes.push($event)"></div>',
})
class CheckboxHost {
  readonly controlId = signal('driver-declaration');
  readonly label = signal('The nominated driver and licence details are correct.');
  readonly checked = signal(false);
  readonly disabled = signal(false);
  readonly describedBy = signal<string | null>(null);
  readonly asSwitch = signal(false);
  readonly changes: boolean[] = [];
}

const fixtures: ComponentFixture<CheckboxHost>[] = [];
afterEach(() => { fixtures.splice(0).forEach(fixture => fixture.destroy()); TestBed.resetTestingModule(); });
const create = () => { const fixture = TestBed.createComponent(CheckboxHost); fixtures.push(fixture); return fixture; };
async function render(setup?: (host: CheckboxHost) => void) {
  const fixture = create(); setup?.(fixture.componentInstance); await fixture.whenStable(); fixture.detectChanges();
  const root = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[gcspCheckboxField]')!;
  return { fixture, host: fixture.componentInstance, root, control: root.querySelector<HTMLInputElement>('input')! };
}

describe('source checkboxField', () => {
  it('keeps the source checkbox order, native type and associated literal label', async () => {
    const { root, control, host } = await render();
    expect(root.tagName).toBe('DIV'); expect(root.classList.contains('gcsp-check')).toBe(true);
    expect(root.classList.contains('caller-layout')).toBe(true); expect(root.classList.contains('gcsp-switch')).toBe(false);
    expect(Array.from(root.children, node => node.tagName)).toEqual(['INPUT', 'LABEL']);
    expect(control.type).toBe('checkbox'); expect(control.id).toBe('driver-declaration'); expect(control.checked).toBe(false);
    expect(control.getAttribute('role')).toBeNull();
    expect(root.querySelector('label')?.htmlFor).toBe(control.id); expect(root.querySelector('label')?.textContent).toBe(host.label());
  });

  it('keeps the switch label before its checked native switch and supplied descriptions', async () => {
    const { root, control } = await render(host => { host.asSwitch.set(true); host.checked.set(true); host.describedBy.set('declaration-hint declaration-error'); });
    expect(root.classList.contains('gcsp-switch')).toBe(true);
    expect(Array.from(root.children, node => node.tagName)).toEqual(['LABEL', 'INPUT']);
    expect(control.getAttribute('role')).toBe('switch'); expect(control.checked).toBe(true);
    expect(control.getAttribute('aria-describedby')).toBe('declaration-hint declaration-error');
    expect(root.querySelector('label')?.htmlFor).toBe('driver-declaration');
  });

  it('emits only boolean native change intent and leaves saved state to the caller', async () => {
    const { fixture, host, control } = await render(); expect(host.changes).toEqual([]);
    control.click(); expect(host.changes).toEqual([true]); expect(host.checked()).toBe(false);
    host.checked.set(true); fixture.detectChanges(); await fixture.whenStable();
    expect(control.checked).toBe(true); expect(host.changes).toEqual([true]);
    control.click(); expect(host.changes).toEqual([true, false]);
  });

  it('updates supplied state without remounting the control or emitting a change', async () => {
    const { fixture, host, root, control } = await render();
    host.checked.set(true); host.disabled.set(true); host.describedBy.set('pending-reason'); fixture.detectChanges();
    expect(root.querySelector('input')).toBe(control); expect(control.checked).toBe(true); expect(control.disabled).toBe(true);
    expect(control.getAttribute('aria-describedby')).toBe('pending-reason'); expect(host.changes).toEqual([]);
  });

  it('refuses native and synthetic change intent while disabled, then permits a deliberate click', async () => {
    const { fixture, host, control } = await render(host => host.disabled.set(true));
    control.click(); control.dispatchEvent(new Event('change')); expect(host.changes).toEqual([]); expect(control.checked).toBe(false);
    host.disabled.set(false); fixture.detectChanges(); control.click(); expect(host.changes).toEqual([true]);
  });

  it('omits absent descriptions and removes a description when the caller clears it', async () => {
    const { fixture, host, control } = await render(); expect(control.getAttribute('aria-describedby')).toBeNull();
    host.describedBy.set('help-text'); fixture.detectChanges(); expect(control.getAttribute('aria-describedby')).toBe('help-text');
    host.describedBy.set(''); fixture.detectChanges(); expect(control.getAttribute('aria-describedby')).toBeNull();
  });

  it('requires a nonempty caller field ID like the source helper', () => {
    const fixture = create(); fixture.componentInstance.controlId.set('');
    expect(() => fixture.detectChanges()).toThrowError('A unique field id is required.');
  });

  it('renders supplied label markup as text', async () => {
    const literal = '<img src=x onerror=alert(1)>Driver details';
    const { root } = await render(host => host.label.set(literal));
    expect(root.querySelector('label')?.textContent).toBe(literal); expect(root.querySelector('img')).toBeNull();
  });
});
