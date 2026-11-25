import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { StageListComponent } from './stage-list.component';

describe('source stage list', () => {
  it('keeps supplied order and names while wording every stage state', async () => {
    const fixture = TestBed.createComponent(StageListComponent);
    fixture.componentRef.setInput('heading', 'Your selection');
    fixture.componentRef.setInput('stages', [
      { name: 'selection received', state: 'complete' }, { name: 'HR approval', state: 'waiting' },
      { name: 'sent to ordering', state: 'not-started' }, { name: 'Sending request', state: 'pending' },
      { name: 'Ordering response', state: 'failed' }, { name: 'Unrecognised supplied state', state: 'future' },
    ]);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(Array.from(root.querySelectorAll('.gcsp-stage-name'), row => row.textContent)).toEqual([
      'selection received', 'HR approval', 'sent to ordering', 'Sending request', 'Ordering response', 'Unrecognised supplied state',
    ]);
    expect(Array.from(root.querySelectorAll('.gcsp-stage-state'), row => row.textContent)).toEqual([
      'Done', 'Waiting', 'Not started', 'Sending', 'Not accepted', 'Unknown',
    ]);
    expect(root.querySelector('.gcsp-stage-item.is-future')?.textContent).toContain('Unknown');
  });

  it('names each instance by its own heading at the supplied heading level', async () => {
    const first = TestBed.createComponent(StageListComponent);
    const second = TestBed.createComponent(StageListComponent);
    first.componentRef.setInput('heading', 'Your selection'); first.componentRef.setInput('level', 3);
    await first.whenStable(); await second.whenStable();
    const one: HTMLElement = first.nativeElement; const two: HTMLElement = second.nativeElement;
    const title = one.querySelector('h3.gcsp-stage-heading')!;
    expect(title?.textContent).toBe('Your selection');
    expect(one.querySelector('section')?.getAttribute('aria-labelledby')).toBe(title?.id);
    expect(title?.id).not.toBe(two.querySelector('h2')?.id);
    expect(two.querySelector('h2')?.textContent).toBe('Progress');
  });

  it('applies supplied labels without inferring or mutating a transition', async () => {
    const stages = Object.freeze([Object.freeze({ name: 'Exact stage', state: 'waiting' })]);
    const fixture = TestBed.createComponent(StageListComponent);
    fixture.componentRef.setInput('stages', stages); fixture.componentRef.setInput('labels', { waiting: 'Awaiting response' });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.is-waiting')?.textContent).toContain('Awaiting response');
    expect(stages).toEqual([{ name: 'Exact stage', state: 'waiting' }]);
    fixture.componentRef.setInput('stages', []); await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('.gcsp-stage-item')).toHaveLength(0);
  });
});
