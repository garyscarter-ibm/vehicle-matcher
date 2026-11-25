import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { OutboxMessage } from '../outbox/outbox.client';
import { MailDetailComponent } from './mail-detail.component';

afterEach(() => TestBed.resetTestingModule());
describe('shared captured email detail', () => {
  it('preserves safe sanitized sandboxed HTML, plain text, status and offer link handling', async () => {
    const fixture = TestBed.createComponent(MailDetailComponent);
    const message: OutboxMessage = { jobId: 'mail-1', messageKind: 'offer', state: 'sent', transport: 'captured', attempts: 1, error: null, nextAttemptAt: null, time: '2026-11-16T11:30:00Z', recipient: { employeeId: 'paula', name: 'Paula Mason' }, subject: 'Your car offer', textBody: 'Your car is ready.', htmlBody: '<p>Your car</p><script>window.bad=true</script>', offerLink: 'javascript:alert(1)' };
    fixture.componentRef.setInput('message', message); await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement; const frame = root.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe(''); expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.getAttribute('srcdoc')).toContain('<p>Your car</p>'); expect(frame.getAttribute('srcdoc')).not.toContain('<script');
    expect(root.textContent).toContain('Captured, not sent'); expect(root.querySelector('a')).toBeNull();
    fixture.componentRef.setInput('message', { ...message, offerLink: '/gcsp/offers/offer-1' });
    fixture.componentRef.setInput('showHeading', false); await fixture.whenStable();
    expect(root.querySelector('h2')).toBeNull(); expect(root.querySelector('a')?.getAttribute('href')).toBe('/gcsp/offers/offer-1');
    expect(root.querySelector('pre')?.textContent).toBe('Your car is ready.');
  });
});
