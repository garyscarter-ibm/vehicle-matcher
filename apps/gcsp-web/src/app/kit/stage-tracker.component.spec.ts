import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { StageTrackerComponent } from './stage-tracker.component';

describe('source stage tracker', () => {
  it('keeps source stage order and identifies current or blocked steps in text', async () => {
    const fixture = TestBed.createComponent(StageTrackerComponent);
    fixture.componentRef.setInput('stages', [
      { label: 'Selection received', state: 'done' }, { label: 'HR approval', state: 'current' },
      { label: 'Ordering', state: 'upcoming' }, { label: 'Driver check', state: 'declined' },
      { label: 'Appointment', state: 'blocked' }, { label: 'Supplied unknown', state: 'future' },
    ]);
    await fixture.whenStable(); const root: HTMLElement = fixture.nativeElement;
    expect(Array.from(root.querySelectorAll('.gcsp-stage-label'), node => node.textContent)).toEqual([
      'Selection received', 'HR approval', 'Ordering', 'Driver check', 'Appointment', 'Supplied unknown',
    ]);
    expect(Array.from(root.querySelectorAll('.gcsp-stage-state'), node => node.textContent)).toEqual([
      'Done', 'Current step', 'Not started', 'Declined', 'Not updated', 'Not started',
    ]);
    expect(Array.from(root.querySelectorAll('[aria-current="step"] .gcsp-stage-label'), node => node.textContent)).toEqual(['HR approval', 'Appointment']);
    expect(root.querySelectorAll('.gcsp-stage.is-upcoming')).toHaveLength(2);
  });

  it('renders valid instants with the shared London formatter and keeps supplied supporting text', async () => {
    const fixture = TestBed.createComponent(StageTrackerComponent);
    fixture.componentRef.setInput('stages', [
      { label: 'Winter', state: 'done', at: '2026-11-22T12:30:00.000Z', owner: 'Ordering team', next: 'Choose your appointment', note: 'Recorded by ordering.' },
      { label: 'Summer', state: 'current', at: '2026-07-14T12:30:00.000Z' },
      { label: 'Unknown time', state: 'upcoming', at: 'not an instant' },
    ]);
    await fixture.whenStable(); const root: HTMLElement = fixture.nativeElement;
    expect(Array.from(root.querySelectorAll('time'), node => [node.getAttribute('datetime'), node.textContent])).toEqual([
      ['2026-11-22T12:30:00.000Z', '22 Nov 2026, 12:30'], ['2026-07-14T12:30:00.000Z', '14 Jul 2026, 13:30'],
    ]);
    expect(root.querySelector('.gcsp-stage-owner')?.textContent).toBe('Ordering team');
    expect(root.querySelector('.gcsp-stage-next')?.textContent).toBe('Next: Choose your appointment');
    expect(root.querySelector('.gcsp-stage-note')?.textContent).toBe('Recorded by ordering.');
  });

  it('uses a unique source heading association and removes absent optional content on update', async () => {
    const fixture = TestBed.createComponent(StageTrackerComponent);
    fixture.componentRef.setInput('heading', 'Order progress'); fixture.componentRef.setInput('level', 3);
    fixture.componentRef.setInput('stages', [{ label: 'Approval', state: 'current', owner: 'HR' }]);
    await fixture.whenStable(); const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('h3')?.textContent).toBe('Order progress');
    expect(root.querySelector('section')?.getAttribute('aria-labelledby')).toBe(root.querySelector('h3')?.id);
    fixture.componentRef.setInput('stages', [{ label: 'Approval', state: 'done' }]); await fixture.whenStable();
    expect(root.querySelector('[aria-current]')).toBeNull();
    expect(root.querySelector('.gcsp-stage-owner')).toBeNull();
  });
});
