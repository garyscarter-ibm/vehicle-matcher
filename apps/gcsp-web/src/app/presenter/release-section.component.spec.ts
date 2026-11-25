import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReleaseGridComponent } from '../kit/release-grid.component';
import { PresenterRelease } from './presenter.projections';
import { ReleaseSectionComponent } from './release-section.component';
const release = (tranche = 'one', count = 10): PresenterRelease => ({ runId: 'release-unit', release: {trancheId: tranche,windowId: tranche,releasedAt: '2026-11-17T11:30:00Z'},cars: [{id: tranche,imageSrc: null,imageAlt: 'BMW Touring',modelName: 'BMW Touring',colourName: 'Blue'}],counts: {released: count,totalReleased: count,onScheme: count,buddyAllocated: 0,manuallyAllocated: 0},allocation: {pending: 0,declined: 0,accepted: 0},modelLines: [{modelLine: 'Touring',count}],charts: {colours: [{label: 'Blue',count}],points: [],fuel: []} });
afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('source release-section orchestration', () => {
  it('does not replay equal run/tranche reads and restores a same-key loading grid without animation', async () => {
    const fixture = TestBed.createComponent(ReleaseSectionComponent); fixture.componentRef.setInput('value', release()); fixture.componentRef.setInput('animate', true); await fixture.whenStable();
    const grid: ReleaseGridComponent = fixture.debugElement.query(By.directive(ReleaseGridComponent)).componentInstance;
    const initial = grid.tiles(); expect(grid.animate()).toBe(false);
    fixture.componentRef.setInput('value', release()); await fixture.whenStable(); expect(grid.tiles()).toBe(initial);
    fixture.componentRef.setInput('loading', true); await fixture.whenStable();
    fixture.componentRef.setInput('value', release('one', 12)); fixture.componentRef.setInput('loading', false); await fixture.whenStable();
    expect(grid.tiles()).toBe(initial); expect(grid.animate()).toBe(false);
    expect(fixture.nativeElement.querySelector('.gcsp-release-totals .vm-fact-value').textContent).toBe('12');
  });
  it('counts new motion-allowed release totals over 600 ms after the grid settles, and reduced motion paints final counts', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {frames.push(callback);return frames.length;});
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    vi.stubGlobal('matchMedia', () => ({matches: false}));
    const fixture = TestBed.createComponent(ReleaseSectionComponent); fixture.componentRef.setInput('value', release()); fixture.componentRef.setInput('animate', true); await fixture.whenStable();
    fixture.componentRef.setInput('value', release('two', 20)); await fixture.whenStable();
    const grid: ReleaseGridComponent = fixture.debugElement.query(By.directive(ReleaseGridComponent)).componentInstance;
    const shown = () => fixture.nativeElement.querySelector('.gcsp-release-totals .vm-fact-value').textContent;
    expect(grid.animate()).toBe(true); expect(shown()).toBe('0');
    grid.settled.emit(); frames.at(-1)!(1300); fixture.detectChanges(); expect(shown()).toBe('10');
    frames.at(-1)!(1600); fixture.detectChanges(); expect(shown()).toBe('20');
    vi.stubGlobal('matchMedia', () => ({matches: true})); fixture.componentRef.setInput('value', release('three', 30)); await fixture.whenStable();
    expect(grid.animate()).toBe(false); expect(shown()).toBe('30');
  });
});
