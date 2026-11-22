import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, Role, SessionState } from '../auth/auth.port';
import { sessionGuard } from '../auth/route.guards';
import { StatePageComponent } from '../pages/state-page.component';
import { ShellComponent } from './shell.component';
import { NotificationSource } from '../activity/notification.source';
import { NotificationModel } from '../kit/notification-bell.types';
@Component({ template: '<p>Private saved car for Alice</p>' })
class PrivateBody {}
describe('native portal shell', () => {
  const state = signal<SessionState>({ status: 'signed-out' });
  const signOut = vi.fn(async () => {}); const retry = vi.fn(async () => {});
  beforeEach(() => { signOut.mockClear(); retry.mockReset(); state.set({ status: 'signed-out' }); TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'private', component: PrivateBody, canActivate: [sessionGuard], data: { roles: ['employee'] } }, { path: 'account', component: PrivateBody, canActivate: [sessionGuard], data: { roles: ['employee'] } }, { path: 'access-denied', component: StatePageComponent, data: { kind: 'denied' } }, { path: 'unavailable', component: StatePageComponent, data: { kind: 'unavailable' } }]), { provide: AuthPort, useValue: { state, recovery: signal(null), signOut, initialize: async () => {}, retry, signIn: async () => {} } }] }); });
  const ready = (roles: readonly Role[]): SessionState => ({ status: 'ready', context: { subject: 'own', roles, environmentId: 'isolated', runId: 'run', policyVersion: 'v1', capabilities: [] } });
  const settle = async (fixture: { whenStable(): Promise<unknown> }) => { await fixture.whenStable(); await TestBed.inject(Router).navigated; await new Promise((done) => setTimeout(done)); await fixture.whenStable(); };
  it('shows the employee bell before account, coordinates disclosures and clears scoped data immediately', async () => {
    let update!: (model: NotificationModel, key: string) => void; const stop = vi.fn();
    TestBed.overrideProvider(NotificationSource, { useValue: { connect: (next: typeof update) => { update = next; return stop; } } });
    const first = ready(['employee']); if (first.status !== 'ready') throw new Error('test setup');
    state.set({ ...first, context: { ...first.context, employeeId: 'paula' } });
    const fixture = TestBed.createComponent(ShellComponent); await fixture.whenStable(); const root: HTMLElement = fixture.nativeElement;
    update({ status: 'ok', waiting: 1, rows: [], note: null }, JSON.stringify(['own', 'isolated', 'run', 'paula'])); await fixture.whenStable();
    const bell = root.querySelector<HTMLButtonElement>('.gcsp-bell-btn')!; const account = root.querySelector<HTMLDetailsElement>('details')!;
    expect(root.querySelector('header')?.children[3].classList.contains('gcsp-bell')).toBe(true);
    account.open = true; bell.click(); await fixture.whenStable(); expect(account.open).toBe(false);
    account.open = true; account.dispatchEvent(new Event('toggle')); await fixture.whenStable(); expect(bell.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('.gcsp-bell-badge')?.textContent).toBe('1');
    state.set({ ...first, context: { ...first.context, employeeId: 'other' } }); fixture.detectChanges();
    expect(root.querySelector<HTMLElement>('.gcsp-bell-badge')?.hidden).toBe(true);
    state.set({ status: 'signed-out' }); await fixture.whenStable(); expect(root.querySelector('.gcsp-bell')).toBeNull();
    fixture.destroy(); expect(stop).toHaveBeenCalledOnce();
  });
  it('reauthorizes the retained route when unavailable context recovers to a Greg-only principal', async () => {
    state.set({ status: 'unavailable', message: 'No connection', retryable: true }); retry.mockImplementation(async () => { state.set(ready(['greg'])); });
    const fixture = TestBed.createComponent(ShellComponent); const router = TestBed.inject(Router); await router.navigateByUrl('/account'); await settle(fixture); const root: HTMLElement = fixture.nativeElement;
    expect(root.textContent).toContain('Account unavailable'); expect(router.url).toBe('/account'); document.body.append(root);
    Array.from(root.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Try again')!.click(); await settle(fixture);
    expect(retry).toHaveBeenCalledOnce(); expect(root.textContent).not.toContain('Private saved car for Alice'); expect(router.url).toBe('/access-denied');
    try { await settle(fixture); await new Promise((done) => requestAnimationFrame(done)); expect(document.activeElement?.textContent).toContain('Access not available'); expect(root.textContent).toContain('Go to your home'); } finally { root.remove(); }
  });
  it('keeps the allowed return when unavailable context recovers to an employee', async () => {
    state.set({ status: 'unavailable', message: 'No connection', retryable: true }); retry.mockImplementation(async () => { state.set(ready(['employee'])); });
    const fixture = TestBed.createComponent(ShellComponent); const router = TestBed.inject(Router); await router.navigateByUrl('/account?tab=saved'); await settle(fixture);
    await fixture.componentInstance.retryAccount(); await settle(fixture);
    expect(fixture.nativeElement.textContent).toContain('Private saved car for Alice'); expect(router.url).toBe('/account?tab=saved');
  });
  it.each([[['greg'] as Role[]], [['presenter'] as Role[]], [['employee', 'presenter'] as Role[]]])('reauthorizes a restored session whose roles changed to %j', async (roles) => {
    state.set(ready(['employee'])); const fixture = TestBed.createComponent(ShellComponent); const router = TestBed.inject(Router); await router.navigateByUrl('/account'); await settle(fixture);
    expect(fixture.nativeElement.textContent).toContain('Private saved car for Alice');
    state.set({ status: 'loading' }); window.dispatchEvent(new Event('pagehide')); await settle(fixture);
    state.set(ready(roles)); expect(fixture.nativeElement.textContent).not.toContain('Private saved car for Alice'); await settle(fixture);
    expect(fixture.nativeElement.textContent).not.toContain('Private saved car for Alice'); expect(router.url).toBe('/access-denied');
  });
  it('restores the same route when a restored session keeps its roles', async () => {
    state.set(ready(['employee'])); const fixture = TestBed.createComponent(ShellComponent); const router = TestBed.inject(Router); await router.navigateByUrl('/account'); await settle(fixture);
    state.set({ status: 'loading' }); await settle(fixture); state.set(ready(['employee', 'greg'])); await settle(fixture);
    expect(fixture.nativeElement.textContent).toContain('Private saved car for Alice'); expect(router.url).toBe('/account');
  });
  it('removes a guarded private body immediately when auth is invalidated before navigation', async () => {
    state.set({ status: 'ready', context: { subject: 'alice', roles: ['employee'], environmentId: 'isolated', runId: 'run', policyVersion: 'v1', capabilities: [] } });
    const fixture = TestBed.createComponent(ShellComponent); await fixture.whenStable(); const router = TestBed.inject(Router); await router.navigateByUrl('/private'); await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Private saved car for Alice');
    state.set({ status: 'loading' }); window.dispatchEvent(new Event('pagehide')); expect(fixture.nativeElement.textContent).not.toContain('Private saved car for Alice'); await fixture.whenStable(); expect(fixture.nativeElement.textContent).toContain('Loading your account'); expect(router.url).toBe('/private');
    state.set({ status: 'unavailable', message: 'Cannot reach your account. Please try again.', retryable: true }); await fixture.whenStable(); expect(fixture.nativeElement.textContent).toContain('Account unavailable'); expect(fixture.nativeElement.textContent).toContain('Try again'); expect(fixture.nativeElement.textContent).not.toContain('Private saved car for Alice');
    state.set({ status: 'signed-out' }); await fixture.whenStable(); expect(fixture.nativeElement.textContent).toContain('Sign in'); expect(fixture.nativeElement.textContent).not.toContain('Private saved car for Alice');
  });
  it('shows unavailable on direct private entry with the full shell', async () => {
    state.set({ status: 'unavailable', message: 'No connection', retryable: true }); const fixture = TestBed.createComponent(ShellComponent); await fixture.whenStable(); await TestBed.inject(Router).navigateByUrl('/private'); await fixture.whenStable(); expect(fixture.nativeElement.textContent).toContain('Account unavailable'); expect(fixture.nativeElement.textContent).toContain('Try again');
  });
  it('does not show private identity or navigation without trusted ready context', async () => { const fixture = TestBed.createComponent(ShellComponent); await fixture.whenStable(); expect(fixture.nativeElement.querySelector('nav')).toBeNull(); expect(fixture.nativeElement.querySelector('details')).toBeNull(); expect(fixture.nativeElement.querySelector('.gcsp-skip').getAttribute('href')).toBe('#gcsp-main'); });
  it('composes the real roles, discloses account actions and clears when context changes', async () => {
    state.set({ status: 'ready', context: { subject: 'own', roles: ['employee', 'greg'], environmentId: 'isolated', runId: 'run', policyVersion: 'v1', capabilities: [], displayName: 'A person' } });
    const fixture = TestBed.createComponent(ShellComponent); await fixture.whenStable(); const root: HTMLElement = fixture.nativeElement;
    expect(Array.from(root.querySelectorAll('.gcsp-nav-label')).map((el) => el.textContent?.trim())).toEqual(['Your cars', 'Order progress', 'Employee car ordering', 'Process comparisons', 'Show labels']);
    const toggle = root.querySelector<HTMLButtonElement>('.gcsp-menu-toggle')!; toggle.click(); await fixture.whenStable(); expect(toggle.getAttribute('aria-expanded')).toBe('true');
    root.querySelector<HTMLButtonElement>('.gcsp-account-signout')!.click(); await fixture.whenStable(); expect(signOut).toHaveBeenCalledOnce();
    state.set({ status: 'signed-out' }); await fixture.whenStable(); expect(root.textContent).not.toContain('A person'); expect(root.querySelector('nav')).toBeNull();
  });
  it('focuses main without following the base-relative skip fragment from a direct route', async () => {
    const previousUrl = window.location.href;
    const base = document.createElement('base'); base.href = '/gcsp/'; document.head.prepend(base);
    window.history.replaceState(null, '', '/gcsp/account');
    const fixture = TestBed.createComponent(ShellComponent); await fixture.whenStable(); const root: HTMLElement = fixture.nativeElement;
    document.body.append(root);
    try {
      const currentUrl = window.location.href; const link = root.querySelector<HTMLAnchorElement>('.gcsp-skip')!;
      expect(new URL(link.href).pathname).toBe('/gcsp/');
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      expect(link.dispatchEvent(click)).toBe(false); expect(click.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(root.querySelector('main')); expect(window.location.href).toBe(currentUrl);
    } finally { base.remove(); root.remove(); window.history.replaceState(null, '', previousUrl); }
  });
  it('closes the open narrow menu with Escape and restores the Menu focus', async () => {
    state.set({ status: 'ready', context: { subject: 'own', roles: ['employee'], environmentId: 'isolated', runId: 'run', policyVersion: 'v1', capabilities: [] } });
    const fixture = TestBed.createComponent(ShellComponent); await fixture.whenStable(); const root: HTMLElement = fixture.nativeElement;
    document.body.append(root);
    const toggle = root.querySelector<HTMLButtonElement>('.gcsp-menu-toggle')!; toggle.click(); await fixture.whenStable();
    const link = root.querySelector<HTMLAnchorElement>('nav a')!; link.focus();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); link.dispatchEvent(escape); await fixture.whenStable();
    expect(escape.defaultPrevented).toBe(true); expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('.gcsp-menu-open')).toBeNull(); expect(document.activeElement).toBe(toggle); root.remove();
  });
  it('renders decorative supplied-name initials and a neutral avatar without profile facts', async () => {
    const context = { subject: 'private-subject', roles: ['employee'] as const, environmentId: 'isolated', runId: 'run', policyVersion: 'v1', capabilities: [] };
    state.set({ status: 'ready', context: { ...context, displayName: "Anne-Marie O'Neil (team)" } });
    const fixture = TestBed.createComponent(ShellComponent); await fixture.whenStable(); const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.gcsp-avatar')?.textContent).toBe('AO'); expect(root.querySelector('.gcsp-avatar')?.getAttribute('aria-hidden')).toBe('true');
    state.set({ status: 'ready', context }); await fixture.whenStable();
    expect(root.querySelector('.gcsp-avatar')?.textContent).toBe('?'); expect(root.querySelector('.gcsp-account-name')?.textContent).toBe('Account');
    expect(root.textContent).not.toContain('private-subject');
  });
});
