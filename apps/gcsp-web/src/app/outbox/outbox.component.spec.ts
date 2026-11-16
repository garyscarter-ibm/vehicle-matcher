import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { OutboxClient, OutboxMessage, OutboxResult } from './outbox.client';
import { OutboxComponent } from './outbox.component';

const session = (runId = 'run-1', subject = 'presenter-1'): SessionState => ({ status: 'ready', context: {
  subject, roles: ['presenter'], environmentId: 'dev', runId, policyVersion: 'policy-1', capabilities: [],
} });
const message = (overrides: Partial<OutboxMessage> = {}): OutboxMessage => ({
  jobId: 'mail-1', messageKind: 'replacement-offer', state: 'sent', transport: 'captured', attempts: 1, error: null,
  nextAttemptAt: null, time: '2026-11-05T09:20:00Z', recipient: { employeeId: 'employee-1', name: 'Actual recipient' },
  subject: 'Your reserved car', textBody: 'Offer text', htmlBody: '<p>Actual offer body</p>',
  offerLink: '/gcsp/offers/offer-1', ...overrides,
});
const ok = (messages: readonly OutboxMessage[] = [message()], runId = 'run-1'): OutboxResult => ({ status: 'ok', value: { runId, messages } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

describe('presenter captured email inspection', () => {
  let fixture: ComponentFixture<OutboxComponent> | undefined;
  let authState: ReturnType<typeof signal<SessionState>>;
  let read: ReturnType<typeof vi.fn<OutboxClient['read']>>;
  beforeEach(async () => {
    authState = signal(session()); read = vi.fn<OutboxClient['read']>().mockResolvedValue(ok());
    await TestBed.configureTestingModule({ imports: [OutboxComponent], providers: [
      { provide: AuthPort, useValue: { state: authState } }, { provide: OutboxClient, useValue: { read } },
    ] }).compileComponents();
  });
  afterEach(() => { fixture?.destroy(); fixture = undefined; TestBed.resetTestingModule(); });
  const root = () => fixture!.nativeElement as HTMLElement;
  const text = () => root().textContent ?? '';
  const button = (label: string) => Array.from(root().querySelectorAll('button')).find((node) => node.textContent?.trim() === label)!;
  const rows = () => Array.from(root().querySelectorAll<HTMLButtonElement>('.gcsp-mail-row'));
  async function settled() {
    await vi.waitFor(() => expect(fixture!.componentInstance.view()).not.toBe('loading'));
    await fixture!.whenStable(); fixture!.detectChanges();
  }
  async function render() { fixture = TestBed.createComponent(OutboxComponent); fixture.detectChanges(); await settled(); }
  function filter(id: string, value: string) {
    const control = root().querySelector<HTMLSelectElement>(`#outbox-${id}`)!;
    control.value = value; control.dispatchEvent(new Event('change', { bubbles: true })); fixture!.detectChanges();
  }

  it('shows loading until the finite current-run read completes', async () => {
    const pending = deferred<OutboxResult>(); read.mockReturnValueOnce(pending.promise);
    fixture = TestBed.createComponent(OutboxComponent); fixture.detectChanges();
    expect(text()).toContain('Loading captured emails'); expect(root().querySelector('.gcsp-mail')).toBeNull();
    expect(button('Refresh').disabled).toBe(true); pending.resolve(ok()); await settled();
    expect(read).toHaveBeenCalledOnce(); expect(Object.keys(read.mock.calls[0][0]!)).toEqual(['signal']);
    expect(text()).toContain('Actual recipient'); expect(root().querySelectorAll('h1')).toHaveLength(1);
  });
  it('shows an empty current read without inventing offer or delivery facts', async () => {
    read.mockResolvedValueOnce(ok([])); await render();
    expect(text()).toContain('No emails yet'); expect(text()).toContain('No captured messages were returned for this run.');
    expect(root().querySelector('iframe')).toBeNull(); expect(root().querySelector('select')).toBeNull();
    expect(button('Refresh').disabled).toBe(false);
  });
  it('orders returned rows newest first, puts unknown times last and opens the first', async () => {
    read.mockResolvedValueOnce(ok([message({ jobId: 'old', subject: 'Older', time: '2026-11-01T09:00:00Z' }),
      message({ jobId: 'unknown', subject: 'Unknown time', time: null }), message({ jobId: 'new', subject: 'Newest' })]));
    await render(); expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('Newest'), expect.stringContaining('Older'), expect.stringContaining('Unknown time')]);
    expect(root().querySelector('.gcsp-mail-heading')?.textContent).toBe('Newest');
    expect(text()).toContain('3 messages returned for this run, newest first.');
  });
  it('uses actual employee identity when no recipient name exists', async () => {
    read.mockResolvedValueOnce(ok([message({ recipient: { employeeId: 'employee-actual', name: null } })])); await render();
    expect(text()).toContain('employee-actual'); expect(text()).not.toContain('@');
  });
  it('filters returned state, recipient and kind locally and can clear filtered empty', async () => {
    read.mockResolvedValueOnce(ok([message(), message({ jobId: 'mail-2', messageKind: 'reminder', state: 'retrying',
      recipient: { employeeId: 'employee-2', name: 'Second recipient' } })])); await render();
    filter('state', 'retrying'); expect(rows()).toHaveLength(1); expect(rows()[0].textContent).toContain('Second recipient');
    filter('recipient', 'employee-1'); expect(text()).toContain('No matching emails'); expect(root().querySelector('iframe')).toBeNull();
    button('Clear filters').click(); fixture!.detectChanges(); expect(rows()).toHaveLength(2);
    filter('kind', 'reminder'); expect(rows()).toHaveLength(1); expect(read).toHaveBeenCalledOnce();
  });
  it('keeps unknown delivery states filterable without claiming a known state', async () => {
    read.mockResolvedValueOnce(ok([message({ state: 'provider-awaiting-proof' }), message({ jobId: 'mail-2' })])); await render();
    filter('state', 'provider-awaiting-proof'); expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain('Delivery status unknown'); expect(read).toHaveBeenCalledOnce();
  });
  it('moves native row selection focus to the selected email heading', async () => {
    read.mockResolvedValueOnce(ok([message(), message({ jobId: 'mail-2', subject: 'Second email' })])); await render();
    rows()[1].click(); fixture!.detectChanges(); await fixture!.whenStable();
    expect(root().querySelector('.gcsp-mail-heading')?.textContent).toBe('Second email');
    expect(document.activeElement).toBe(root().querySelector('.gcsp-mail-heading'));
    expect(rows()[1].getAttribute('aria-current')).toBe('true'); expect(rows()[0].hasAttribute('aria-current')).toBe(false);
  });
  it('refreshes only on request and retains a matching selection and local filters', async () => {
    const messages = [message(), message({ jobId: 'mail-2', subject: 'Second email' })]; read.mockResolvedValue(ok(messages)); await render();
    rows()[1].click(); fixture!.detectChanges(); filter('kind', 'replacement-offer');
    button('Refresh').click(); fixture!.detectChanges(); await settled();
    expect(read).toHaveBeenCalledTimes(2); expect(root().querySelector('.gcsp-mail-heading')?.textContent).toBe('Second email');
    expect((root().querySelector('#outbox-kind') as HTMLSelectElement).value).toBe('replacement-offer');
    expect(Array.from(root().querySelectorAll('button')).map((b) => b.textContent?.trim())).not.toContain('Send');
    expect(text()).not.toContain('Retry delivery'); expect(text()).not.toContain('Act as');
  });
  it('chooses the newest remaining returned row when refresh removes selection', async () => {
    await render(); read.mockResolvedValueOnce(ok([message({ jobId: 'new-mail', subject: 'New email' })]));
    button('Refresh').click(); fixture!.detectChanges(); await settled();
    expect(root().querySelector('.gcsp-mail-heading')?.textContent).toBe('New email');
  });
  it.each([
    ['captured', 'Captured, not sent', 'No email has been sent.'],
    ['configured', 'Accepted by email provider', 'Provider acceptance does not confirm inbox receipt.'],
    [null, 'Delivery status unknown', 'Email delivery has not been confirmed.'],
  ] as const)('renders truthful sent delivery semantics for %s transport', async (transport, label, note) => {
    read.mockResolvedValueOnce(ok([message({ transport })])); await render();
    expect(rows()[0].textContent).toContain(label); expect(text()).toContain(note);
    expect(root().querySelector('.gcsp-mail-status')?.textContent?.trim()).not.toBe('Sent');
  });
  it.each([['pending', 'Preparing'], ['sending', 'Sending']] as const)('keeps %s delivery unconfirmed', async (state, label) => {
    read.mockResolvedValueOnce(ok([message({ state, htmlBody: null, textBody: null, subject: null })])); await render();
    expect(rows()[0].textContent).toContain(label); expect(text()).toContain('Delivery is not yet confirmed.');
    expect(text()).toContain('Email content is not available.'); expect(root().querySelector('iframe')).toBeNull();
  });
  it('shows retries, fixed error copy, attempt count and next UK demo-clock time', async () => {
    read.mockResolvedValueOnce(ok([message({ state: 'retrying', attempts: 3, error: 'provider-timeout', nextAttemptAt: '2026-07-05T09:30:00Z' })])); await render();
    expect(text()).toContain('3 attempts.'); expect(text()).toContain('The email provider timed out. Acceptance is not confirmed.');
    expect(text()).toContain('5 Jul 2026, 10:30 BST'); expect(text()).toContain('Demo clock: 5 Nov 2026, 09:20 GMT');
    const details = Array.from(root().querySelectorAll('details')); expect(details).toHaveLength(2); expect(details.every((d) => !d.open)).toBe(true);
  });
  it('shows failed attempts with safe fallback copy and unavailable timestamps', async () => {
    read.mockResolvedValueOnce(ok([message({ state: 'failed', error: 'unrecognised-provider-code', attempts: 2, time: null })])); await render();
    expect(text()).toContain('No further attempts will be made.'); expect(text()).toContain('for a reason that is not listed.');
    expect(text()).not.toContain('unrecognised-provider-code'); expect(text()).toContain('Time not available');
  });
  it('isolates sanitized HTML inside an empty sandbox and treats plain text as text', async () => {
    read.mockResolvedValueOnce(ok([message({ htmlBody: '<p>Body</p><script>window.attack=true</script><img src="x" onerror="attack()">',
      textBody: '<img src=x onerror=attack()>', subject: '<img src=x onerror=attack()>' })])); await render();
    const frame = root().querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe(''); expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.srcdoc).toContain('<p>Body</p>'); expect(frame.srcdoc).not.toContain('<script'); expect(frame.srcdoc).not.toContain('onerror');
    expect(root().querySelector('script')).toBeNull(); expect(root().querySelector('.gcsp-mail-text img')).toBeNull();
    expect(root().querySelector('.gcsp-mail-text')?.textContent).toBe('<img src=x onerror=attack()>');
  });
  it.each(['/gcsp/offers/right?from=email#offer', 'https://offers.example.test/gcsp/offers/right'])('exposes safe supplied offer link %s without action authority', async (offerLink) => {
    read.mockResolvedValueOnce(ok([message({ offerLink })])); await render();
    const link = root().querySelector<HTMLAnchorElement>('.gcsp-mail-offer a')!;
    expect(link.getAttribute('href')).toBe(offerLink); expect(link.target).toBe('_blank'); expect(link.rel).toBe('noopener noreferrer');
    expect(link.textContent).toContain('Open the offer'); expect(read).toHaveBeenCalledOnce();
  });
  it.each(['//evil.example/path', 'javascript:alert(1)', 'http://insecure.example/path', 'https://user:pass@example.test/path',
    '/\\evil.example/path', '/gcsp/offers/\nright', ' https://example.test/path', 'data:text/html,attack', 'not-a-link'])('refuses unsafe offer link %j', async (offerLink) => {
    read.mockResolvedValueOnce(ok([message({ offerLink })])); await render();
    expect(root().querySelector('.gcsp-mail-offer a')).toBeNull(); expect(text()).toContain('Offer link not available');
  });
  it('handles missing body, subject, link and next-attempt timestamp without fabricated details', async () => {
    read.mockResolvedValueOnce(ok([message({ subject: null, textBody: null, htmlBody: null, offerLink: null, state: 'retrying', nextAttemptAt: null })])); await render();
    expect(text()).toContain('Email not created yet'); expect(text()).toContain('Email content is not available.');
    expect(text()).toContain('Offer link not available'); expect(text()).toContain('Time not available'); expect(root().querySelector('iframe')).toBeNull();
  });
  it('offers a read retry for retryable unavailable, clearing previous sensitive content', async () => {
    await render(); read.mockResolvedValueOnce({ status: 'unavailable', code: 'private-provider-details', retryable: true });
    button('Refresh').click(); fixture!.detectChanges(); await settled();
    expect(text()).toContain('Captured emails are unavailable'); expect(text()).not.toContain('Actual recipient'); expect(text()).not.toContain('private-provider-details');
    button('Retry').click(); fixture!.detectChanges(); await settled(); expect(read).toHaveBeenCalledTimes(3); expect(rows()).toHaveLength(1);
  });
  it.each(['authentication-required', 'forbidden', 'stale-run', 'account-changed', 'unavailable'] as const)('clears content and does not offer automatic recovery for %s', async (status) => {
    await render(); read.mockResolvedValueOnce({ status, code: 'private-failure', retryable: false });
    button('Refresh').click(); fixture!.detectChanges(); await settled();
    expect(rows()).toHaveLength(0); expect(root().querySelector('iframe')).toBeNull(); expect(root().querySelector('select')).toBeNull();
    expect(button('Retry')).toBeUndefined(); expect(button('Refresh').disabled).toBe(true); expect(read).toHaveBeenCalledTimes(2);
  });
  it('refuses a mismatched successful run read rather than rendering its messages', async () => {
    read.mockResolvedValueOnce(ok([message()], 'other-run')); await render();
    expect(text()).toContain('The scenario has restarted'); expect(text()).not.toContain('Actual recipient');
  });
  it('masks messages synchronously on account change, aborts the old read and discards its late result', async () => {
    await render(); filter('recipient', 'employee-1');
    const late = deferred<OutboxResult>(); const current = deferred<OutboxResult>();
    read.mockReturnValueOnce(late.promise).mockReturnValueOnce(current.promise);
    button('Refresh').click(); fixture!.detectChanges(); const oldSignal = read.mock.calls[1][0]!.signal!;
    authState.set(session('run-2', 'presenter-2'));
    expect(fixture!.componentInstance.messages()).toEqual([]); expect(fixture!.componentInstance.selected()).toBeNull();
    fixture!.detectChanges(); expect(oldSignal.aborted).toBe(true);
    late.resolve(ok([message({ subject: 'Old account secret' })])); await Promise.resolve(); fixture!.detectChanges();
    expect(text()).not.toContain('Old account secret'); expect(fixture!.componentInstance.recipientFilter()).toBe('');
    current.resolve(ok([message({ jobId: 'new-account-mail', subject: 'Current account email' })], 'run-2')); await settled();
    expect(text()).toContain('Current account email'); expect(text()).not.toContain('Old account secret');
  });
  it('clears messages on sign-out and never reads for an employee-only session', async () => {
    await render(); authState.set({ status: 'signed-out' }); expect(fixture!.componentInstance.messages()).toEqual([]);
    fixture!.detectChanges(); expect(text()).toContain('Sign in to open captured emails'); expect(root().querySelector('iframe')).toBeNull();
    authState.set({ status: 'ready', context: { subject: 'employee', roles: ['employee'], employeeId: 'employee-1', environmentId: 'dev', runId: 'run-1', policyVersion: 'p', capabilities: [] } });
    fixture!.detectChanges(); expect(text()).toContain('Only the presenter'); expect(read).toHaveBeenCalledOnce();
  });
  it('aborts pending work on destruction and ignores a subsequent successful result', async () => {
    const pending = deferred<OutboxResult>(); read.mockReturnValueOnce(pending.promise);
    fixture = TestBed.createComponent(OutboxComponent); fixture.detectChanges(); const component = fixture.componentInstance;
    const signal = read.mock.calls[0][0]!.signal!; fixture.destroy(); fixture = undefined; expect(signal.aborted).toBe(true);
    pending.resolve(ok()); await Promise.resolve(); expect(component.messages()).toEqual([]); expect(component.selected()).toBeNull();
  });
});
