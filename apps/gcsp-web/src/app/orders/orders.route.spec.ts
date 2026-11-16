import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { StatePageComponent } from '../pages/state-page.component';
import { routes } from '../routes';
import { OrdersClient } from './orders.client';
import { OrdersComponent } from './orders.component';

const context = { subject: 'subject', roles: ['employee'] as const, environmentId: 'dev', runId: 'run',
  employeeId: 'employee', policyVersion: 'policy', capabilities: [] };

describe('employee orders route composition', () => {
  const state = signal<SessionState>({ status: 'ready', context });
  const readOrders = vi.fn(async () => ({ status: 'ok', value: { orders: [], failed: [], failedCount: 0,
    nextAfter: null, pageEvidence: [] } }));
  const readOrder = vi.fn(async () => ({ status: 'not-found', retryable: false }));
  const execute = vi.fn();
  beforeEach(() => {
    state.set({ status: 'ready', context }); vi.clearAllMocks();
    TestBed.configureTestingModule({ providers: [provideRouter(routes),
      { provide: AuthPort, useValue: { state, initialize: vi.fn(async () => {}) } },
      { provide: OrdersClient, useValue: {
        context: () => state().status === 'ready' ? { ...context, employeeAuthority: true } : null,
        readOrders, readOrder, execute,
      } },
    ] });
  });
  afterEach(() => TestBed.resetTestingModule());

  it('opens the native lazy screen from the existing employee orders URL', async () => {
    const harness = await RouterTestingHarness.create();
    const screen = await harness.navigateByUrl('/orders', OrdersComponent);
    await vi.waitFor(() => expect(screen.state()?.phase).toBe('settled'));
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Order progress');
    expect(harness.routeNativeElement?.textContent).toContain('No orders to track');
    expect(harness.routeNativeElement?.textContent).not.toContain('This page is not available yet.');
    expect(screen.state()?.requestedOrderUuid).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it('retains exact order queries through direct entry and same-route navigation without a write', async () => {
    const harness = await RouterTestingHarness.create();
    const first = await harness.navigateByUrl('/orders?orderUuid=provider-order-A', OrdersComponent);
    await vi.waitFor(() => expect(first.state()?.phase).toBe('settled'));
    expect(first.state()?.requestedOrderUuid).toBe('provider-order-A');
    const second = await harness.navigateByUrl('/orders?orderUuid=provider-order-B', OrdersComponent);
    await vi.waitFor(() => expect(second.state()?.requestedOrderUuid).toBe('provider-order-B'));
    await vi.waitFor(() => expect(second.state()?.phase).toBe('settled'));
    expect(second).toBe(first);
    expect(TestBed.inject(Router).url).toBe('/orders?orderUuid=provider-order-B');
    expect(readOrders).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
  });

  it('sends signed-out direct entry to sign-in with the exact safe return URL', async () => {
    state.set({ status: 'signed-out' });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/orders?orderUuid=provider-order-A', StatePageComponent);
    expect(TestBed.inject(Router).url).toBe('/sign-in?returnTo=%2Fgcsp%2Forders%3ForderUuid%3Dprovider-order-A');
    expect(readOrders).not.toHaveBeenCalled(); expect(readOrder).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['greg', 'presenter'] as const)('denies %s-only entry before lifecycle reads', async (role) => {
    state.set({ status: 'ready', context: { ...context, roles: [role] } });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/orders', StatePageComponent);
    expect(TestBed.inject(Router).url).toBe('/access-denied');
    expect(readOrders).not.toHaveBeenCalled(); expect(readOrder).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
