import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { HappenedFeedComponent } from './happened-feed.component';
import { OutboxMessage } from '../outbox/outbox.client';
afterEach(() => { TestBed.resetTestingModule(); sessionStorage.removeItem('gcsp:presenter-feed:feed-unit'); });
describe('presenter What happened composition', () => {
  it('keeps release and captured-mail events in source order and opens the safe shared drawer', async () => {
    const fixture = TestBed.createComponent(HappenedFeedComponent);
    fixture.componentRef.setInput('controls', {runId: 'feed-unit',startsAt: '2026-11-16T09:00:00Z',now: '2026-11-17T11:30:00Z',lastTick: {runId: 'feed-unit',tickId: 'tick',now: '2026-11-17T11:30:00Z',outcomes: [{handlerId: 'stock-release',outcome: {status: 'ok',value: {runId: 'feed-unit',tickId: 'tick',kind: 'stock-released',orderUuids: ['car-1']}}}]}});
    const message: OutboxMessage = {jobId: 'mail-1',messageKind: 'offer',state: 'sent',transport: 'captured',attempts: 1,error: null,nextAttemptAt: null,time: '2026-11-17T11:30:00Z',recipient: {employeeId: 'paula',name: 'Paula Mason'},subject: 'Your reserved car',htmlBody: '<p>Actual captured email</p>',textBody: 'Actual captured email',offerLink: '/gcsp/offers/offer-1'};
    fixture.componentRef.setInput('messages', [message]); await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement; const details = root.querySelector('details')!; details.open = true;
    expect(Array.from(root.querySelectorAll('.gcsp-timeline-label')).map(node => node.textContent)).toEqual(['Offer email captured','1 car released','Scheme started']);
    expect(root.querySelector('.gcsp-timeline-heading')).toBeNull();
    const open = root.querySelector<HTMLButtonElement>('[data-job-id="mail-1"]')!; open.click(); await fixture.whenStable();
    const drawer = root.querySelector<HTMLElement>('.gcsp-side-drawer')!; expect(drawer.hidden).toBe(false);
    expect(drawer.textContent).toContain('Your reserved car'); expect(drawer.textContent).toContain('Captured, not sent'); expect(drawer.querySelector('iframe')?.getAttribute('sandbox')).toBe('');
    fixture.componentRef.setInput('messages', []); await fixture.whenStable(); expect(drawer.hidden).toBe(true); expect(drawer.textContent).not.toContain('Actual captured email');
  });
});
