import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { DataTableComponent } from './data-table.component';
describe('shared native case table', () => {
  afterEach(() => TestBed.resetTestingModule());
  function table() {
    const fixture = TestBed.createComponent(DataTableComponent);
    fixture.componentRef.setInput('caption', 'Renewal cases');
    fixture.componentRef.setInput('columns', [{ key: 'employee', label: 'Employee' }, { key: 'status', label: 'Status' }]);
    fixture.componentRef.setInput('rows', [{ id: 'case"[1]', label: 'Paula', cells: { employee: '<img src=x>', status: 'Open' } }]);
    fixture.detectChanges(); return fixture;
  }
  it('associates caption, column and row headers and renders literal cells with narrow labels', () => {
    const fixture = table(); const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('caption')?.textContent).toBe('Renewal cases'); expect(root.querySelectorAll('thead th[scope="col"]')).toHaveLength(3);
    expect(root.querySelector('tbody th[scope="row"]')?.textContent).toContain('<img src=x>'); expect(root.querySelector('img')).toBeNull();
    for (const cell of Array.from(root.querySelectorAll('tbody td'))) for (const id of cell.getAttribute('headers')!.split(' ')) expect(root.querySelector(`[id="${id}"]`)).toBeTruthy();
    expect(root.querySelector('td[data-label="Status"]')?.textContent).toContain('Open');
  });
  it('emits the exact ID from one named Open and returns focus without selector interpolation', () => {
    const fixture = table(); const received: string[] = []; fixture.componentInstance.opened.subscribe(id => received.push(id));
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button'); expect(button.getAttribute('aria-label')).toBe('Open case for Paula'); button.click();
    expect(received).toEqual(['case"[1]']); expect(fixture.componentInstance.focusRow('case"[1]')).toBe(true); expect(document.activeElement).toBe(button);
    expect(fixture.componentInstance.focusRow('missing')).toBe(false); fixture.componentRef.setInput('disabled', true); fixture.detectChanges();
    button.click(); expect(received).toHaveLength(1); expect(fixture.componentInstance.focusRow('case"[1]')).toBe(false);
  });
  it('shows the supplied empty state and uses unique IDs across instances', () => {
    const first = table(); const second = table(); expect(first.componentInstance.id).not.toBe(second.componentInstance.id);
    first.componentRef.setInput('rows', []); first.detectChanges(); expect(first.nativeElement.textContent).toContain('No cases to show.'); expect(first.nativeElement.querySelector('button')).toBeNull();
  });
});
