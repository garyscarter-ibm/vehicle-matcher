import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTableComponent } from './data-table.component';

describe('canonical source data table', () => {
  afterEach(() => TestBed.resetTestingModule());
  function table() {
    const fixture = TestBed.createComponent(DataTableComponent);
    fixture.componentRef.setInput('caption', 'Renewal cases');
    fixture.componentRef.setInput('columns', [{ key: 'employee', label: 'Employee' }, { key: 'status', label: 'Status' }]);
    fixture.componentRef.setInput('rows', [{ id: 'case"[1]', label: 'Paula', cells: { employee: '<img src=x>', status: 'Open' } }]);
    fixture.detectChanges(); return fixture;
  }
  it('has source defaults with no implicit case action, a caption-labelled region and literal row headers', () => {
    const fixture = table(); const root: HTMLElement = fixture.nativeElement;
    const region = root.querySelector('[role=region]')!; const caption = root.querySelector('caption')!;
    expect(caption.textContent).toBe('Renewal cases'); expect(region.getAttribute('aria-labelledby')).toBe(caption.id); expect(region.getAttribute('tabindex')).toBe('0');
    expect(root.querySelectorAll('thead th[scope="col"]')).toHaveLength(2); expect(root.querySelector('button')).toBeNull(); expect(root.querySelector('.gcsp-table-wrap')).not.toBeNull(); expect(root.querySelector('.gcsp-table')).not.toBeNull();
    expect(root.querySelector('tbody th[scope="row"]')?.textContent).toContain('<img src=x>'); expect(root.querySelector('img')).toBeNull(); expect(root.querySelector('[data-label]')).toBeNull();
    for (const cell of Array.from(root.querySelectorAll('tbody td'))) for (const id of cell.getAttribute('headers')!.split(' ')) expect(root.querySelector(`[id="${id}"]`)).toBeTruthy();
  });
  it('adds explicit named source row actions, exact opened identity, callback index and safe focus restoration', () => {
    const fixture = table(); const selected = vi.fn(); const received: string[] = []; fixture.componentInstance.opened.subscribe(id => received.push(id));
    fixture.componentRef.setInput('rowAction', { name: (row: {label: string}) => `Open case for ${row.label}`, onSelect: selected }); fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button'); expect(button.textContent).toBe('Open'); expect(button.getAttribute('aria-label')).toBe('Open case for Paula'); expect(button.dataset['focusKey']).toBe('Open case for Paula');
    button.click(); expect(received).toEqual(['case"[1]']); expect(selected).toHaveBeenCalledWith(expect.objectContaining({ id: 'case"[1]' }), 0);
    expect(fixture.componentInstance.focusRow('case"[1]')).toBe(true); expect(document.activeElement).toBe(button); expect(fixture.componentInstance.focusRow('missing')).toBe(false);
    fixture.componentRef.setInput('disabled', true); fixture.detectChanges(); button.click(); expect(received).toHaveLength(1); expect(fixture.componentInstance.focusRow('case"[1]')).toBe(false);
  });
  it('preserves zero, numbers, missing labels, bands and source emphasis/winner cell semantics', () => {
    const fixture = table();
    fixture.componentRef.setInput('columns', ['name','zero','number','missing','band','plainBand','emphasis','noLabel'].map(key => ({ key, label: key, numeric: key !== 'name' })));
    fixture.componentRef.setInput('rows', [{ id: 'values', label: 'Values', cells: { name: { label: 'Row', winner: true }, zero: 0, number: 1234, missing: '', band: { label: 'Fewer than five', isBand: true, fewerThan: 5 }, plainBand: { label: 'Small group', isBand: true, fewerThan: Infinity }, emphasis: { label: 'Current car', emphasis: true, tone: 'success', winner: true }, noLabel: { label: null, emphasis: true, missing: false } } }]); fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement; const cells = root.querySelectorAll('tbody td');
    expect(cells[0].textContent).toBe('0'); expect(cells[1].textContent).toBe('1,234'); expect(cells[2].textContent).toBe('Not supplied'); expect(cells[2].classList.contains('is-missing')).toBe(true);
    expect(cells[3].classList.contains('is-band')).toBe(true); expect(cells[3].getAttribute('data-band')).toBe('true'); expect(cells[3].querySelector('[aria-hidden=true]')?.textContent).toBe('<5'); expect(cells[3].querySelector('.gcsp-vh')?.textContent).toBe('Fewer than five');
    expect(cells[4].textContent).toBe('Small group'); expect(cells[4].querySelector('[aria-hidden]')).toBeNull(); expect(cells[5].querySelector('strong.is-success')?.textContent).toBe('Current car'); expect(cells[5].classList.contains('is-winner')).toBe(true);
    expect(root.querySelector('tbody th')?.classList.contains('is-winner')).toBe(false); expect(cells[6].querySelector('strong.is-missing')?.textContent).toBe('Not supplied');
  });
  it('fills emphasized band values on the strong node and accepts explicit zero thresholds and missing flags', () => {
    const fixture = table(); fixture.componentRef.setInput('rows', [{ id: 'band', label: 'Band', cells: { employee: { label: 'Suppressed', isBand: true, fewerThan: 0, emphasis: true }, status: { label: 'Unknown', missing: true } } }]); fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement; expect(root.querySelector('th strong.is-band[data-band=true] [aria-hidden=true]')?.textContent).toBe('<0'); expect(root.querySelector('th.is-band')).toBeNull(); expect(root.querySelector('td.is-missing')?.textContent).toBe('Unknown');
  });
  it('makes stacking explicit and preserves numeric/detail, captionHidden/equalColumns and compare precedence', () => {
    const fixture = table(); fixture.componentRef.setInput('stack', true); fixture.componentRef.setInput('captionHidden', true); fixture.componentRef.setInput('equalColumns', true);
    fixture.componentRef.setInput('columns', [{ key: 'employee', label: 'Employee' }, { key: 'status', label: 'Points', numeric: true, detail: 'Monthly allowance' }]); fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement; expect(root.querySelector('.is-stack.has-equal-columns')).not.toBeNull(); expect(root.querySelector('table')?.getAttribute('role')).toBe('table'); expect(root.querySelector('tbody td[role=cell][data-label=Points]')).not.toBeNull();
    expect(root.querySelector('thead .is-numeric .gcsp-table-th-sub')?.textContent).toBe('Monthly allowance'); expect(root.querySelector('caption.gcsp-vh')).not.toBeNull(); expect(root.querySelector('tbody td.is-numeric')).not.toBeNull();
    fixture.componentRef.setInput('compare', true); fixture.detectChanges(); expect(root.querySelector('.is-compare.has-equal-columns')).not.toBeNull(); expect(root.querySelector('.is-stack')).toBeNull(); expect(root.querySelector('table')?.getAttribute('role')).toBeNull(); expect(root.querySelector('[data-label]')).toBeNull();
  });
  it('honors custom action header/label and per-row disabled values without row-shape inference', () => {
    const fixture = table(); fixture.componentRef.setInput('rows', [{ id: 'yes', label: 'One', cells: {} }, { id: 'no', label: 'Two', cells: {} }]);
    fixture.componentRef.setInput('rowAction', { header: 'Record', label: 'View record', name: (_: unknown, index: number) => `View record ${index}`, disabled: (_: unknown, index: number) => index === 1 }); fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement; expect(root.querySelector('thead th:last-child')?.textContent).toBe('Record'); const buttons = root.querySelectorAll<HTMLButtonElement>('button'); expect(buttons[0].textContent).toBe('View record'); expect(buttons[0].disabled).toBe(false); expect(buttons[1].disabled).toBe(true); expect(fixture.componentInstance.focusRow('no')).toBe(false);
    fixture.componentRef.setInput('rowAction', { disabled: true }); fixture.detectChanges(); expect(root.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
  });
  it('shares one supplied action name between accessible name and focus key', () => {
    const fixture = table(); let sequence = 0; fixture.componentRef.setInput('rowAction', { name: () => `Record ${++sequence}` }); fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button'); expect(button.getAttribute('aria-label')).toBe('Record 1'); expect(button.dataset['focusKey']).toBe('Record 1');
  });
  it('uses generated caption ids for an empty source id and valid header references for an action-only table', () => {
    const fixture = table(); fixture.componentRef.setInput('id', ''); fixture.componentRef.setInput('columns', []); fixture.componentRef.setInput('rowAction', {}); fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement; expect(root.querySelector('caption')!.id).not.toBe('-caption');
    for (const id of root.querySelector('tbody td')!.getAttribute('headers')!.split(' ')) expect(root.querySelector(`[id="${id}"]`)).not.toBeNull();
  });
  it('uses source empty/default values and colspan with optional action, unique ids and explicit id', () => {
    const first = table(); const second = table(); expect(first.nativeElement.querySelector('table').id).not.toBe(second.nativeElement.querySelector('table').id);
    first.componentRef.setInput('rows', []); first.detectChanges(); expect(first.nativeElement.textContent).toContain('Nothing to show'); expect(first.nativeElement.querySelector('td').colSpan).toBe(2);
    first.componentRef.setInput('id', 'history-table'); first.componentRef.setInput('columns', []); first.componentRef.setInput('stack', true); first.componentRef.setInput('emptyText', 'No history'); first.componentRef.setInput('rowAction', {}); first.detectChanges(); expect(first.nativeElement.querySelector('td').colSpan).toBe(1); expect(first.nativeElement.querySelector('td').getAttribute('role')).toBe('cell'); expect(first.nativeElement.textContent).toContain('No history'); expect(first.nativeElement.querySelector('caption').id).toBe('history-table-caption'); expect(first.nativeElement.querySelector('button')).toBeNull();
  });
});
