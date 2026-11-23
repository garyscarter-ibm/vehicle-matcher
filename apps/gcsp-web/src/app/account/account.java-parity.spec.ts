import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService, RuntimePublicConfig } from '../auth/runtime-config';
import { BriefClient } from '../preferences/brief.client';
import { AccountClient } from './account.client';
import { AccountComponent } from './account.component';
import { AccountProjection } from './account.types';
// The Java-owned goldens that AccountHttpTest and RepositoryHttpTest assert GET manual/account against.
import alex from '../../../../../services/gcsp-api/src/test/resources/account/node-baseline/alex.json';
import alexNotYetEligible from '../../../../../services/gcsp-api/src/test/resources/account/node-baseline/alex-not-yet-eligible.json';
import alexOrderingClosed from '../../../../../services/gcsp-api/src/test/resources/account/node-baseline/alex-ordering-closed.json';
import jordan from '../../../../../services/gcsp-api/src/test/resources/account/node-baseline/jordan.json';
import jordanAbsent from '../../../../../services/gcsp-api/src/test/resources/account/node-baseline/jordan-absent.json';
import paula from '../../../../../services/gcsp-api/src/test/resources/account/node-baseline/paula.json';
import paulaNoContract from '../../../../../services/gcsp-api/src/test/resources/account/node-baseline/paula-no-contract.json';
import paulaSlotDisabled from '../../../../../services/gcsp-api/src/test/resources/account/node-baseline/paula-slot-disabled.json';
import sam from '../../../../../services/gcsp-api/src/test/resources/account/node-baseline/sam.json';
import samAccountForeign from '../../../../../services/gcsp-api/src/test/resources/account/node-baseline/sam-account-foreign.json';
import samDriverInvalid from '../../../../../services/gcsp-api/src/test/resources/account/node-baseline/sam-driver-invalid.json';

interface Golden {
  readonly context: { readonly environmentId: string; readonly runId: string; readonly employeeId: string; readonly policyVersion: string };
  readonly expected: { readonly status: string; readonly value?: AccountProjection; readonly contractVersion?: string; readonly [key: string]: unknown };
}
const raw: Record<string, unknown> = { alex, 'alex-not-yet-eligible': alexNotYetEligible, 'alex-ordering-closed': alexOrderingClosed, jordan,
  'jordan-absent': jordanAbsent, paula, 'paula-no-contract': paulaNoContract, 'paula-slot-disabled': paulaSlotDisabled, sam,
  'sam-account-foreign': samAccountForeign, 'sam-driver-invalid': samDriverInvalid };
const golden = (name: string): Golden => structuredClone(raw[name]) as Golden;
const base = 'https://api.example/api/gcsp/v1';
const appBase = 'https://portal.example/gcsp/';
const carSelector = '.gcsp-feature[data-contract-id]';
const ready = (g: Golden): SessionState => ({ status: 'ready', context: { subject: `sub-${g.context.employeeId}`, roles: ['employee'],
  environmentId: g.context.environmentId, runId: g.context.runId, employeeId: g.context.employeeId, policyVersion: g.context.policyVersion, capabilities: ['account:read'] } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
// AccountResource sends { status, value } on 200 and the bare refusal (no contractVersion) on 503.
const accountResponse = (g: Golden): Response => {
  if (g.expected.status === 'ok') return json({ status: 'ok', value: g.expected.value });
  const { contractVersion: _unused, ...refusal } = g.expected;
  return json(refusal, 503);
};
const unconfigured = () => json({ status: 'unavailable', code: 'account-provider-not-configured', reason: 'Account data is not available on this service yet.', retryable: false }, 503);

describe('account screen over the Java account goldens', () => {
  let fixture: ComponentFixture<AccountComponent> | undefined;
  let state: ReturnType<typeof signal<SessionState>>;
  let byToken: Map<string, () => Response>;
  let requests: { path: string; token: string | null }[];
  let baseElement: HTMLBaseElement;
  let previousBase: { element: HTMLBaseElement; href: string | null } | null;
  beforeEach(() => {
    const existing = document.querySelector('base');
    previousBase = existing ? { element: existing, href: existing.getAttribute('href') } : null;
    baseElement = existing ?? document.createElement('base'); baseElement.href = appBase;
    if (!existing) document.head.append(baseElement);
    state = signal<SessionState>({ status: 'signed-out' }); byToken = new Map(); requests = [];
    const config = (environmentId: string): RuntimePublicConfig => ({ schemaVersion: 1, environmentId, apiBaseUrl: base,
      oidc: { authority: 'https://issuer.example', clientId: 'public-client', scope: 'openid', redirectUri: 'https://portal.example/gcsp/auth/callback', postLogoutRedirectUri: 'https://portal.example/gcsp/' } });
    const token = async () => { const s = state(); return s.status === 'ready' ? `token-${s.context.employeeId}` : null; };
    // Like Java, the fake server knows the caller only from the bearer token; no request names an employee.
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input)); const path = url.pathname.slice('/api/gcsp/v1/'.length) + url.search;
      const bearer = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /, '') ?? null; requests.push({ path, token: bearer });
      if (path === 'manual/account') return byToken.get(bearer ?? '')?.() ?? json({ status: 'unauthenticated', code: 'authentication-required' }, 401);
      if (path === 'manual/draft') return json({ status: 'not-found', resourceType: 'manual-draft' });
      if (path === 'manual/notification-email') return json({ status: 'ok', value: { deliveryEmail: null, version: 0 } });
      if (path === 'offers/current') return json({ status: 'ok', value: { offers: [] } });
      if (path === 'orders/progress/all') return json({ status: 'ok', value: { orders: [], failed: [], failedCount: 0, nextAfter: null } });
      if (path === 'manual/order') return json({ status: 'not-found', code: 'not-found', reason: 'You have no selection yet.', retryable: false }, 404);
      return json({ status: 'not-found', code: 'route-not-found' }, 404);
    });
    TestBed.configureTestingModule({ providers: [provideRouter([]),
      { provide: AuthPort, useValue: { state, recovery: signal(null), getAccessToken: token, signIn: vi.fn(), retry: vi.fn() } },
      { provide: RuntimeConfigService, useValue: { load: async () => config(state().status === 'ready' ? (state() as Extract<SessionState, { status: 'ready' }>).context.environmentId : 'none') } },
      { provide: PORTAL_FETCH, useValue: fetcher },
      { provide: BriefClient, useValue: { readEditor: vi.fn().mockResolvedValue({ status: 'unavailable' }) } }] });
  });
  afterEach(() => {
    fixture?.destroy(); fixture = undefined; vi.restoreAllMocks();
    if (!previousBase) baseElement.remove();
    else if (previousBase.href === null) previousBase.element.removeAttribute('href');
    else previousBase.element.setAttribute('href', previousBase.href);
  });

  const serve = (g: Golden, response: () => Response = () => accountResponse(g)) => byToken.set(`token-${g.context.employeeId}`, response);
  const root = (): HTMLElement => fixture!.nativeElement;
  const text = () => root().textContent ?? '';
  const button = (label: string) => Array.from(root().querySelectorAll('button')).find((item) => item.textContent?.trim() === label);
  const idle = async () => {
    for (let round = 0; round < 60; round++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0)); await fixture!.whenStable(); fixture!.detectChanges();
      const c = fixture!.componentInstance;
      if (!c.loading() && !c.previewLoading() && !c.emailBusy() && c.model()) return c;
    }
    throw new Error('account screen did not settle');
  };
  const mount = async (g: Golden) => {
    state.set(ready(g)); fixture = TestBed.createComponent(AccountComponent); document.body.append(fixture.nativeElement);
    fixture.detectChanges(); return idle();
  };
  const days = (asOf: string, end: string) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${asOf.slice(0, 10)}T00:00:00Z`)) / 86400000);

  it.each([
    { name: 'paula', notice: null, action: 'Choose a replacement', terms: '1,100 / 1,300' },
    { name: 'alex', notice: null, action: 'Choose a replacement', terms: '1,100 / 1,000' },
    { name: 'jordan', notice: null, action: 'Start a new order', terms: null },
    { name: 'paula-no-contract', notice: 'Your current contract is missing', action: null, terms: '1,100 / 1,300' },
    { name: 'paula-slot-disabled', notice: 'No ordering entitlement', action: null, terms: '1,100 / 1,300' },
    { name: 'alex-not-yet-eligible', notice: 'Replacement is not available yet', action: null, terms: '1,100 / 1,000' },
    { name: 'alex-ordering-closed', notice: 'Too late to order before renewal', action: null, terms: '1,100 / 1,000' },
    { name: 'sam', notice: 'Ordering is not supported for this scheme', action: null, terms: '1,100 / 1,300' },
  ])('$name: shows the Java account facts, current car, image, terms and permitted action', async ({ name, notice, action, terms }) => {
    const g = golden(name); const value = g.expected.value!; serve(g);
    const component = await mount(g);
    expect(component.projection()).toEqual(value);
    expect(root().querySelector('h1')?.textContent).toBe('Your cars');
    const identity = value.account!;
    expect(root().querySelector('.account-details strong')?.textContent).toBe(identity.name);
    expect(text()).toContain(identity.employeeNumber!);
    for (const driver of value.drivers ?? []) expect(text()).toContain(driver.name!);
    expect(text()).not.toContain(identity.companyId!); expect(text()).not.toContain(value.contextVersion!);

    const cars = Array.from(root().querySelectorAll(carSelector));
    expect(cars).toHaveLength((value.contracts ?? []).length);
    expect(cars.map((car) => car.getAttribute('data-contract-id'))).toEqual((value.contracts ?? []).map((row) => row.contractId));
    expect(cars.map((car) => car.querySelector('.gcsp-vehicle-title')?.textContent)).toEqual((value.contracts ?? []).map((row) => row.model));
    (value.contracts ?? []).forEach((row, index) => {
      const img = cars[index].querySelector('img'); const media = row.media as { src?: string; alt?: string } | null | undefined;
      // Java goldens name packaged repository assets; the Angular app serves them below its base.
      if (media?.src) expect(media.src).toMatch(/^\/assets\/gcsp-vehicle-evidence\/[0-9a-f]{64}\.webp$/);
      expect(img?.src ?? null).toBe(media?.src ? new URL(media.src.slice(1), appBase).href : null);
      if (media?.alt) expect(img?.getAttribute('alt')).toBe(media.alt);
      expect(cars[index].textContent).toContain(`Contract ends in ${days(value.asOf!, row.contractEndDate!)} days`);
      expect(cars[index].querySelector('.gcsp-account-car-facts dd')?.textContent).toBe(terms);
    });
    if (!(value.contracts ?? []).length) {
      expect(text()).toContain('No current car');
      expect(text()).toContain(`Your allowance is ${(value.allowance!['value'] as number).toLocaleString('en-GB')} points a month.`);
    }
    const historySection = root().querySelector('.gcsp-account-history')!;
    const historyRows = Array.from(historySection.querySelectorAll('tbody tr'));
    const historyEntries = (value.histories ?? []).flatMap((history) => history.entries.map((row) => ({ model: row.model, scheme: history.label })));
    expect(historyRows).toHaveLength(historyEntries.length);
    expect(historyRows.map((row) => ({ model: row.querySelector('th[scope="row"]')?.textContent,
      scheme: row.querySelector('[data-label="Scheme"]')?.textContent }))).toEqual(historyEntries);
    const historyOnly = (value.histories ?? []).filter((history) => history.entries.length && history['orderingSupported'] === false).map((history) => history.label);
    if (value.state === 'unsupported-scheme' || !historyOnly.length) expect(historySection.querySelector('.gcsp-synthetic')).toBeNull();
    else {
      const names = historyOnly.length === 1 ? historyOnly[0] : `${historyOnly.slice(0, -1).join(', ')} and ${historyOnly.at(-1)}`;
      expect(historySection.querySelector('.gcsp-synthetic')?.textContent)
        .toBe(`${names} ${historyOnly.length === 1 ? 'shows' : 'show'} history only; you can't order through ${historyOnly.length === 1 ? 'it' : 'them'} here.`);
    }

    if (notice) { expect(text()).toContain(notice); expect(root().querySelector('a[href="/help"]')).not.toBeNull(); expect(button('Refresh')).toBeDefined(); }
    else { expect(button('Refresh')).toBeUndefined(); expect(text()).not.toContain('Your account is unavailable'); }
    for (const label of ['Choose a replacement', 'Start a new order']) {
      if (label === action) expect(button(label)?.disabled).toBe(false); else expect(button(label)).toBeUndefined();
    }
    expect(text()).toContain('No orders to track.');
    expect(requests.every((row) => row.token === `token-${g.context.employeeId}` && !row.path.includes(g.context.employeeId))).toBe(true);
  });

  it('jordan-absent: states the missing HR account and renders no invented identity, car or details', async () => {
    const g = golden('jordan-absent'); serve(g);
    const component = await mount(g);
    expect(component.projection()).toEqual(g.expected.value);
    expect(text()).toContain('Your HR account is missing'); expect(text()).toContain('Contact HR support to check your employee account.');
    expect(root().querySelector('a[href="/help"]')).not.toBeNull();
    expect(root().querySelector(carSelector)).toBeNull(); expect(root().querySelector('.account-details')).toBeNull();
    expect(button('Start a new order')).toBeUndefined(); expect(button('Choose a replacement')).toBeUndefined();
    expect(requests.map((row) => row.path).sort()).toEqual(['manual/account', 'manual/draft']);
  });

  it.each([
    { name: 'sam-account-foreign', response: (g: Golden) => accountResponse(g) },
    { name: 'sam-driver-invalid', response: (g: Golden) => accountResponse(g) },
    { name: 'provider not configured', response: () => unconfigured() },
  ])('$name: an authoritative refusal is shown as unavailable with nothing rendered from it', async ({ name, response }) => {
    const g = golden(name === 'provider not configured' ? 'sam' : name); serve(g, () => response(g));
    const component = await mount(g);
    expect(component.projection()).toBeNull();
    expect(component.model()?.failure).toMatchObject({ status: 'unavailable', httpStatus: 503,
      code: name === 'provider not configured' ? 'account-provider-not-configured' : g.expected['code'] });
    expect(text()).toContain('Your account is unavailable'); expect(text()).toContain('Refresh to try again, or contact scheme support.');
    expect(button('Refresh')).toBeDefined();
    expect(root().querySelector(carSelector)).toBeNull(); expect(root().querySelector('.account-details')).toBeNull();
    expect(text()).not.toContain('Sam Patel'); expect(text()).not.toContain('No current car');
    expect(requests.map((row) => row.path).sort()).toEqual(['manual/account', 'manual/draft']);
  });

  it('switching the signed-in employee replaces the account; no fact from the previous employee remains', async () => {
    const first = golden('paula'); const second = golden('alex'); serve(first); serve(second);
    await mount(first);
    expect(Array.from(root().querySelectorAll(carSelector), (car) => car.getAttribute('data-contract-id')))
      .toEqual((first.expected.value!.contracts ?? []).map((row) => row.contractId));
    expect(text()).toContain(first.expected.value!.account!.employeeNumber!);
    requests = []; state.set(ready(second)); fixture!.detectChanges();
    const component = await idle();
    expect(component.projection()).toEqual(second.expected.value);
    expect(Array.from(root().querySelectorAll(carSelector), (car) => car.getAttribute('data-contract-id')))
      .toEqual((second.expected.value!.contracts ?? []).map((row) => row.contractId));
    expect(text()).toContain('Alex Brennan'); expect(text()).toContain(second.expected.value!.account!.employeeNumber!);
    expect(text()).not.toContain('Paula Mason'); expect(text()).not.toContain(first.expected.value!.account!.employeeNumber!);
    expect(requests.length).toBeGreaterThan(0); expect(requests.every((row) => row.token === 'token-employee-alex')).toBe(true);
  });

  it('another employee’s Java account in a response is refused, not shown', async () => {
    const signedIn = golden('paula'); const other = golden('alex'); serve(signedIn, () => accountResponse(other));
    const component = await mount(signedIn);
    expect(component.projection()).toBeNull();
    expect(component.model()?.failure).toMatchObject({ status: 'unavailable', code: 'account-response-scope-mismatch' });
    expect(text()).toContain('Your account is unavailable');
    expect(text()).not.toContain('Alex Brennan'); expect(text()).not.toContain(other.expected.value!.account!.employeeNumber!);
    expect(root().querySelector(carSelector)).toBeNull();
  });
});
