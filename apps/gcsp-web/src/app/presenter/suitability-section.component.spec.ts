import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PresenterClient } from './presenter.client';
import { SuitabilitySectionComponent } from './suitability-section.component';
const at = '2026-11-16T11:30:00Z';
const recorded = { evaluatedAt: at, briefVersion: 1, policyVersion: 'one', allocationRule: 'renewalDueThenFitThenSeededLottery' };
const cell = { employeeId: 'paula', state: 'evaluated', gateStatus: 'eligible', score: 84, blockers: [], unknowns: [], reasons: [{ code: 'preference-fit', field: 'body', desired: 'estate', score: 100 }], outdated: false, recorded, outcome: { state: 'assigned', employeeId: 'paula' } };
const matrix = { runId: 'matrix-run', asOf: at, release: 'all', policy: { version: 'one', minimumFit: null, allocationRule: recorded.allocationRule }, paging: { cars: {page: 1,pages: 1,total: 1,size: 8}, buddies: {page: 1,pages: 1,total: 1,size: 4} }, buddies: [{id: 'paula',name: 'Paula Mason',briefVersion: 1}], people: [], cars: [{id: 'car-1',name: 'BMW 330e Touring',colour: 'Blue',orderNumber: 'A123',availability: {state: 'reserved',employeeId: 'paula',employeeName: 'Paula Mason',route: 'buddy'},cells: [cell]}] };
afterEach(() => TestBed.resetTestingModule());
describe('recorded presenter suitability composition', () => {
  it('reads lazily, preserves per-pair identity and opens the recorded explanation without commanding', async () => {
    const read = vi.fn().mockResolvedValue({state: 'ready',value: matrix});
    TestBed.configureTestingModule({providers: [{provide: PresenterClient,useValue: {readSuitability: read}}]});
    const fixture = TestBed.createComponent(SuitabilitySectionComponent); fixture.componentRef.setInput('controls', {runId: 'matrix-run',clockVersion: 1}); await fixture.whenStable();
    expect(read).not.toHaveBeenCalled(); const root: HTMLElement = fixture.nativeElement; const details = root.querySelector('details')!;
    details.open = true; details.dispatchEvent(new Event('toggle')); await fixture.whenStable();
    expect(read).toHaveBeenCalledWith(1,1,'all',expect.objectContaining({signal: expect.any(AbortSignal)}));
    const button = root.querySelector<HTMLButtonElement>('.gcsp-suitability-cell')!; expect(button.getAttribute('aria-label')).toContain('BMW 330e Touring, order A123, Paula Mason: 84/100');
    button.click(); await fixture.whenStable(); expect(button.getAttribute('aria-pressed')).toBe('true');
    const explanation = root.querySelector('.gcsp-suitability-details')!.textContent!;
    expect(explanation).toContain('Recorded checks and preferences'); expect(explanation).toContain('matched to Paula Mason'); expect(explanation).toContain('Reserved for Paula Mason through Buddy'); expect(explanation).not.toContain(at);
    fixture.componentRef.setInput('controls', {runId: 'another-run',clockVersion: 1}); await fixture.whenStable();
    expect(fixture.componentInstance.selected()).toBeNull(); expect(details.open).toBe(false); expect(root.textContent).not.toContain('84/100');
  });
  it('shows unavailable instead of invented evaluations and clears a failed read', async () => {
    const read = vi.fn().mockResolvedValue({state: 'failed',value: null,problem: 'unavailable'});
    TestBed.configureTestingModule({providers: [{provide: PresenterClient,useValue: {readSuitability: read}}]});
    const fixture = TestBed.createComponent(SuitabilitySectionComponent); fixture.componentRef.setInput('controls', {runId: 'matrix-run',clockVersion: 1}); await fixture.whenStable();
    const details = fixture.nativeElement.querySelector('details'); details.open = true; details.dispatchEvent(new Event('toggle')); await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Car suitability unavailable'); expect(fixture.nativeElement.querySelector('.gcsp-suitability-cell')).toBeNull();
  });
});
