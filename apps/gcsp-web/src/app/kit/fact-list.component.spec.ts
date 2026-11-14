import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { FactListComponent, FactRow } from './fact-list.component';

async function render(rows: readonly FactRow[], hideMissing = '') {
  const fixture = TestBed.createComponent(FactListComponent);
  fixture.componentRef.setInput('rows', rows);
  fixture.componentRef.setInput('hideMissing', hideMissing);
  await fixture.whenStable();
  return fixture;
}

describe('FactListComponent', () => {
  it('renders semantic definition pairs with source-formatted strings and units', async () => {
    const fixture = await render([{ label: 'Collection', value: '14 November 2026' }, { label: 'Points', value: 1234.5, unit: 'points a month' }]);
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelectorAll('dl > div')).toHaveLength(2);
    expect(Array.from(root.querySelectorAll('dt')).map(node => node.textContent)).toEqual(['Collection', 'Points']);
    expect(Array.from(root.querySelectorAll('dd')).map(node => node.textContent)).toEqual(['14 November 2026', '1,234.5 points a month']);
  });

  it('treats zero and false as supplied and preserves caller whitespace', async () => {
    const fixture = await render([{ label: 'Zero', value: 0, unit: 'g/km' }, { label: 'Flag', value: false }, { label: 'Source', value: ' ' }]);
    expect([...fixture.nativeElement.querySelectorAll('dd')].map((node: HTMLElement) => node.textContent)).toEqual(['0 g/km', 'false', ' ']);
    expect(fixture.nativeElement.querySelector('.is-missing')).toBeNull();
  });

  it.each([null, undefined, ''])('marks %s missing without appending a supplied unit', async value => {
    const fixture = await render([{ label: 'CO2', value, unit: 'g/km' }]);
    expect(fixture.nativeElement.querySelector('dd').textContent).toBe('Not supplied');
    expect(fixture.nativeElement.querySelector('dd').classList.contains('is-missing')).toBe(true);
  });

  it('uses explicit missing labels and falls back for an empty missing label', async () => {
    const fixture = await render([{ label: 'Points', value: null, unit: 'points', missingLabel: 'Monthly points not supplied' }, { label: 'Fuel', value: null, missingLabel: '' }]);
    expect(fixture.nativeElement.textContent).toContain('Monthly points not supplied');
    expect(fixture.nativeElement.textContent).toContain('Not supplied');
  });

  it('omits missing rows with just one summary', async () => {
    const fixture = await render([{ label: 'Known', value: 'Electric' }, { label: 'Missing', value: null }, { label: 'Also missing', value: '' }], 'More facts not supplied');
    expect(fixture.nativeElement.querySelectorAll('dt')).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('p')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('p').textContent).toBe('More facts not supplied');
  });

  it('renders only the summary when every fact is missing', async () => {
    const fixture = await render([{ label: 'Missing', value: null }], 'Facts not supplied');
    expect(fixture.nativeElement.querySelector('dl')).toBeNull();
    expect(fixture.nativeElement.querySelector('p').textContent).toBe('Facts not supplied');
  });

  it('does not show a summary with no missing rows or an empty input', async () => {
    const fixture = await render([{ label: 'Known', value: 0 }], 'Facts not supplied');
    expect(fixture.nativeElement.querySelector('p')).toBeNull();
    fixture.componentRef.setInput('rows', []);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('dt')).toHaveLength(0);
    expect(fixture.nativeElement.querySelector('p')).toBeNull();
  });

  it('safely renders long labels, values, units, missing labels and summary text', async () => {
    const source = '<img src=x onerror=alert(1)>' + 'LongUnbrokenVehicleName'.repeat(25);
    const fixture = await render([{ label: source, value: source, unit: '<b>unit</b>' }, { label: 'Missing', value: null, missingLabel: '<script>bad()</script>' }]);
    expect(fixture.nativeElement.querySelector('img, script, b')).toBeNull();
    expect(fixture.nativeElement.querySelector('dt').textContent).toBe(source);
    expect(fixture.nativeElement.querySelector('dd').textContent).toBe(source + ' <b>unit</b>');
    fixture.componentRef.setInput('hideMissing', '<b>Missing facts</b>');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('p').textContent).toBe('<b>Missing facts</b>');
    expect(fixture.nativeElement.querySelector('b')).toBeNull();
  });

  it('updates repeated inputs without mutating frozen rows and tears down', async () => {
    const rows = Object.freeze([Object.freeze({ label: 'Missing', value: null }), Object.freeze({ label: 'Known', value: 1 })]);
    const fixture = await render(rows, 'Other facts not supplied');
    fixture.componentRef.setInput('rows', [{ label: 'Changed', value: 'Supplied' }]);
    fixture.componentRef.setInput('hideMissing', '');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('dt').textContent).toBe('Changed');
    expect(fixture.nativeElement.querySelector('p')).toBeNull();
    expect(rows[0].value).toBeNull();
    fixture.destroy();
    expect(fixture.componentRef.hostView.destroyed).toBe(true);
  });
});
