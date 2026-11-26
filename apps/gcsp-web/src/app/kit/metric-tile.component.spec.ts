import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { DataTableValue } from './data-table.component';
import { MetricTileComponent } from './metric-tile.component';

describe('frozen source metric tile', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render(value: DataTableValue = 1234, size?: string, note?: string) {
    const fixture = TestBed.createComponent(MetricTileComponent);
    fixture.componentRef.setInput('label', 'Expressed demand');
    fixture.componentRef.setInput('value', value);
    if (size !== undefined) fixture.componentRef.setInput('size', size);
    if (note !== undefined) fixture.componentRef.setInput('note', note);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  it('renders the missing shared primitive as the standard source tile with ordered label and figure', () => {
    const { root } = render();
    const tile = root.querySelector('div.gcsp-tile.gcsp-tile-standard')!;
    expect(Array.from(tile.children, child => [child.tagName, child.className, child.textContent]))
      .toEqual([['P', 'gcsp-tile-label', 'Expressed demand'], ['P', 'gcsp-tile-figure', '1,234']]);
    expect(tile.hasAttribute('data-band')).toBe(false);
  });

  it.each(['headline', 'standard', 'compact'])('preserves the %s source size class', size => {
    const { root } = render(42, size);
    expect(root.querySelector('.gcsp-tile')?.className).toBe(`gcsp-tile gcsp-tile-${size}`);
  });

  it.each(['', 'unknown'])('falls back to standard for the unsupported size %j', size => {
    expect(render(42, size).root.querySelector('.gcsp-tile')?.className).toBe('gcsp-tile gcsp-tile-standard');
  });

  it('appends only a truthy optional note after the figure and updates it', () => {
    const { root, fixture } = render(0, 'headline', 'Across model lines');
    expect(root.querySelector('.gcsp-tile')?.lastElementChild?.className).toBe('gcsp-tile-note');
    expect(root.querySelector('.gcsp-tile-note')?.textContent).toBe('Across model lines');
    fixture.componentRef.setInput('note', ''); fixture.detectChanges();
    expect(root.querySelector('.gcsp-tile-note')).toBeNull();
  });

  it.each([
    { value: 0, label: '0', missing: false },
    { value: 12345, label: '12,345', missing: false },
    { value: null, label: 'Not supplied', missing: true },
    { value: undefined, label: 'Not supplied', missing: true },
    { value: '', label: 'Not supplied', missing: true },
    { value: { label: null }, label: 'Not supplied', missing: true },
    { value: { label: 'Unavailable', missing: true }, label: 'Unavailable', missing: true },
  ])('preserves numeric or missing value $label ($value)', ({ value, label, missing }) => {
    // Pass undefined explicitly after creation because render's default supplies a normal count.
    const { root, fixture } = render();
    fixture.componentRef.setInput('value', value); fixture.detectChanges();
    const figure = root.querySelector('.gcsp-tile-figure')!;
    expect(figure.textContent).toBe(label);
    expect(figure.classList.contains('is-missing')).toBe(missing);
    expect(figure.hasAttribute('data-band')).toBe(false);
  });

  it.each([5, 0])('shows a privacy threshold %s visually and speaks the supplied label only', fewerThan => {
    const { root } = render({ label: 'Suppressed small group', isBand: true, fewerThan });
    expect(root.querySelector('.gcsp-tile')?.getAttribute('data-band')).toBe('true');
    const figure = root.querySelector('.gcsp-tile-figure.is-band[data-band=true]')!;
    expect(figure.querySelector('[aria-hidden=true]')?.textContent).toBe(`<${fewerThan}`);
    expect(figure.querySelector('.gcsp-vh')?.textContent).toBe('Suppressed small group');
    expect(figure.querySelectorAll('span')).toHaveLength(2);
  });

  it.each([
    { label: 'At least five', isBand: true },
    { label: '5 or more', isBand: true, fewerThan: Infinity },
    { label: 'Small group', isBand: true, fewerThan: NaN },
  ])('keeps the band label $label opaque without a finite fewerThan', value => {
    const { root } = render(value);
    const figure = root.querySelector('.gcsp-tile-figure.is-band[data-band=true]')!;
    expect(figure.textContent).toBe(value.label);
    expect(figure.querySelector('span')).toBeNull();
    expect(root.querySelector('.gcsp-tile')?.getAttribute('data-band')).toBe('true');
  });

  it('does not treat an exact count as a band merely because it has fewerThan', () => {
    const { root } = render({ label: '12', fewerThan: 5 });
    expect(root.querySelector('.gcsp-tile-figure')?.textContent).toBe('12');
    expect(root.querySelector('[data-band]')).toBeNull();
  });

  it('escapes label, figure, note and supplied privacy text', () => {
    const { root, fixture } = render('<img src=x>', 'compact', '<script>note</script>');
    fixture.componentRef.setInput('label', '<b>Demand</b>'); fixture.detectChanges();
    expect(root.querySelector('.gcsp-tile-label')?.textContent).toBe('<b>Demand</b>');
    expect(root.querySelector('.gcsp-tile-figure')?.textContent).toBe('<img src=x>');
    expect(root.querySelector('.gcsp-tile-note')?.textContent).toBe('<script>note</script>');
    fixture.componentRef.setInput('value', { label: '<img src=private>', isBand: true, fewerThan: 5 }); fixture.detectChanges();
    expect(root.querySelector('.gcsp-vh')?.textContent).toBe('<img src=private>');
    expect(root.querySelector('img, script, b')).toBeNull();
  });
});
