import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReleaseGridComponent } from './release-grid.component';

afterEach(() => { TestBed.resetTestingModule(); vi.unstubAllGlobals(); });
describe('source releaseGrid port', () => {
  it('preloads before painting, retains a single roving focus stop and clamps arrows and row ends', async () => {
    const fixture = TestBed.createComponent(ReleaseGridComponent); document.body.append(fixture.nativeElement);
    fixture.componentRef.setInput('columns', 2); fixture.componentRef.setInput('animate', false);
    fixture.componentRef.setInput('preload', async () => new Set(['car.webp']));
    fixture.componentRef.setInput('tiles', Array.from({ length: 5 }, (_, i) => ({ id: String(i), imageSrc: 'car.webp', label: `Car ${i}` })));
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const cells = Array.from(root.querySelectorAll<HTMLElement>('[role=gridcell]'));
    expect(root.querySelectorAll('[role=row]')).toHaveLength(3);
    expect(cells.map(cell => cell.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    expect(cells[0].querySelector('img')?.alt).toBe('');
    cells[0].focus(); cells[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(cells[2]);
    cells[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(cells[4]);
    cells[4].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(cells[4]);
    expect(root.querySelector('.gcsp-release-tip')?.textContent).toBe('Car 4');
    fixture.destroy(); root.remove();
  });
  it('uses text for failed images and ignores an old pending preload after replacement', async () => {
    let finish!: (value: Set<string>) => void;
    const fixture = TestBed.createComponent(ReleaseGridComponent);
    fixture.componentRef.setInput('animate', false);
    fixture.componentRef.setInput('preload', () => new Promise<Set<string>>(resolve => { finish = resolve; }));
    fixture.componentRef.setInput('tiles', [{ id: 'old', imageSrc: 'old.webp', label: 'Old car' }]); fixture.detectChanges();
    fixture.componentRef.setInput('tiles', []); fixture.detectChanges(); finish(new Set(['old.webp']));
    await fixture.whenStable(); expect(fixture.nativeElement.querySelector('[role=gridcell]')).toBeNull();
    fixture.componentRef.setInput('preload', async () => new Set());
    fixture.componentRef.setInput('tiles', [{ id: 'new', imageSrc: '', label: 'BMW long model name' }]);
    await fixture.whenStable(); expect(fixture.nativeElement.querySelector('.gcsp-release-tile-label').textContent).toBe('BMW long model name');
  });
  it('settles a motion release after the cascade and cancels a superseded cascade', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const fixture = TestBed.createComponent(ReleaseGridComponent); const settled = vi.fn(); fixture.componentInstance.settled.subscribe(settled);
    fixture.componentRef.setInput('tiles', [{id: 'one',imageSrc: '',label: 'BMW Touring'}]); await fixture.whenStable();
    expect(settled).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce(), {timeout: 1600});
    fixture.componentRef.setInput('tiles', [{id: 'two',imageSrc: '',label: 'MINI Cooper'}]); await fixture.whenStable();
    fixture.componentRef.setInput('loading', true); await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 1250)); expect(settled).toHaveBeenCalledOnce();
    fixture.destroy();
  });

});
