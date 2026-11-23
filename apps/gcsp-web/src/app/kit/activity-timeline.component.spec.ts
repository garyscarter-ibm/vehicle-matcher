import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ActivityTimelineComponent, demoTime } from './activity-timeline.component';
import { formatActivityTime } from '../activity/activity.copy';
@Component({ imports: [ActivityTimelineComponent], template: `<ng-template #action><button>Supplied action</button></ng-template><gcsp-activity-timeline [level]="3" heading="Recent activity" note="Supplied note" [events]="[{ label: 'First', occurredAt: '2026-07-01T10:00:00Z', action }, { label: 'Second', occurredAt: 'invalid' }]" />` })
class TimelineHost {}
describe('source activity timeline', () => {
  it('keeps supplied order, heading level, note, action and invalid-time semantics', async () => {
    const fixture = TestBed.createComponent(TimelineHost); await fixture.whenStable(); const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('h3.gcsp-timeline-heading')?.textContent).toBe('Recent activity'); expect(root.querySelector('.gcsp-timeline-note')?.textContent).toBe('Supplied note');
    expect(Array.from(root.querySelectorAll('.gcsp-timeline-label')).map((node) => node.textContent)).toEqual(['First', 'Second']);
    expect(root.querySelector('time')?.getAttribute('datetime')).toBe('2026-07-01T10:00:00Z'); expect(root.querySelector('.gcsp-timeline-time')?.textContent).toContain('11:00');
    expect(root.textContent).toContain('Time not available'); expect(root.querySelector('button')?.textContent).toBe('Supplied action'); fixture.destroy();
  });
  it('aliases the shared UK/DST formatter and collapses only adjacent identical rows', async () => {
    expect(demoTime).toBe(formatActivityTime); expect(demoTime('2026-01-01T10:00:00Z')).toContain('10:00'); expect(demoTime('2026-07-01T10:00:00Z')).toContain('11:00');
    const fixture = TestBed.createComponent(ActivityTimelineComponent); const event = { label: 'Checked', occurredAt: '2026-11-22T10:00:00Z', detail: 'Four cars' };
    fixture.componentRef.setInput('events', [event, event, { ...event, detail: 'Five cars' }, event]); fixture.componentRef.setInput('collapseRepeats', true); await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('li')).toHaveLength(3); fixture.componentRef.setInput('events', []); await fixture.whenStable(); expect(fixture.nativeElement.textContent).toContain('No activity is recorded.'); fixture.destroy();
  });
});
