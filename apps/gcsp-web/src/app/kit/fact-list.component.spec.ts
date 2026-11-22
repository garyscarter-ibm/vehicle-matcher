import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { FactListComponent, FactRow } from './fact-list.component';

async function render(rows: readonly FactRow[], hideMissing = '', source = false, className = '') {
  const fixture = TestBed.createComponent(FactListComponent);
  fixture.componentRef.setInput('rows', rows);
  fixture.componentRef.setInput('hideMissing', hideMissing);
  if (source) { fixture.componentRef.setInput('presentation', 'source'); fixture.componentRef.setInput('className', className); }
  await fixture.whenStable();
  return fixture;
}

describe('FactListComponent', () => {
  it('renders supplied source pair and overview facts with the canonical row and value classes', async () => {
    const rows = Object.freeze([Object.freeze({ label: 'Boot', value: 490, unit: 'litres' }),
      Object.freeze({ label: 'Zero', value: 0 }), Object.freeze({ label: 'Flag', value: false }), Object.freeze({ label: 'Source', value: ' ' })]);
    const fixture = await render(rows, '', true, 'vm-facts-pair gcsp-vehicle-overview');
    const root: HTMLElement = fixture.nativeElement;
    const list = root.querySelector('dl.vm-facts.vm-facts-pair.gcsp-vehicle-overview')!;
    expect(list).not.toBeNull();
    expect(list.querySelectorAll('.vm-fact')).toHaveLength(4);
    expect(Array.from(list.querySelectorAll('.vm-fact-label'), node => node.textContent)).toEqual(['Boot', 'Zero', 'Flag', 'Source']);
    expect(Array.from(list.querySelectorAll('.vm-fact-value'), node => node.textContent)).toEqual(['490 litres', '0', 'false', ' ']);
    expect(root.querySelector('.vm-facts-wrap, .vm-facts-more, .gcsp-facts')).toBeNull();
    expect(rows[0].value).toBe(490);
  });

  it('keeps source missing labels separate from supplied units', async () => {
    const fixture = await render([{ label: 'Points', value: null, unit: 'points', missingLabel: 'Monthly points not supplied' },
      { label: 'Fuel', value: '', missingLabel: '' }, { label: 'CO2', value: undefined, unit: 'g/km' }], '', true);
    expect(Array.from(fixture.nativeElement.querySelectorAll('.vm-fact-value.is-missing'), (node: Element) => node.textContent))
      .toEqual(['Monthly points not supplied', 'Not supplied', 'Not supplied']);
  });

  it.each([
    { rows: [{ label: 'Known', value: 0 }, { label: 'Missing', value: null }], wrapped: true, list: true, labels: ['Known'], summary: 'Other facts not supplied' },
    { rows: [{ label: 'Missing', value: null }], wrapped: true, list: false, labels: [], summary: 'Other facts not supplied' },
    { rows: [{ label: 'Known', value: false }], wrapped: false, list: true, labels: ['Known'], summary: undefined },
    { rows: [], wrapped: false, list: true, labels: [], summary: undefined },
  ])('uses the source hidden-missing wrapper only when facts were omitted: %j', async ({ rows, wrapped, list, labels, summary }) => {
    const fixture = await render(rows, 'Other facts not supplied', true, 'vm-facts-pair');
    const root: HTMLElement = fixture.nativeElement;
    expect(Boolean(root.querySelector('.vm-facts-wrap'))).toBe(wrapped);
    expect(Boolean(root.querySelector('dl.vm-facts.vm-facts-pair'))).toBe(list);
    expect(Array.from(root.querySelectorAll('.vm-fact-label'), node => node.textContent)).toEqual(labels);
    expect(root.querySelector('.gcsp-note.vm-facts-more')?.textContent).toBe(summary);
    expect(root.querySelectorAll('.vm-facts-more')).toHaveLength(summary ? 1 : 0);
    if (wrapped && list) expect(root.querySelector('.vm-facts-wrap > dl + .vm-facts-more')).not.toBeNull();
  });

  it('retains the default presentation when switching back from the explicit source variant', async () => {
    const fixture = await render([{ label: 'Known', value: 0 }, { label: 'Missing', value: null }], 'Other facts not supplied', true, 'vm-facts-pair');
    fixture.componentRef.setInput('presentation', 'default'); await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.gcsp-facts > .gcsp-fact dt')?.textContent).toBe('Known');
    expect(root.querySelector('.gcsp-facts-more')?.textContent).toBe('Other facts not supplied');
    expect(root.querySelector('.vm-facts, .vm-facts-wrap, .vm-facts-more')).toBeNull();
  });

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
