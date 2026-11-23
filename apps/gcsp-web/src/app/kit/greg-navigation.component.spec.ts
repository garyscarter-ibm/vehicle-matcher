import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { GregNavigationComponent, GregView } from './greg-navigation.component';

@Component({ imports: [GregNavigationComponent], template: `<gcsp-greg-navigation [page]="page" [panels]="{ dashboard: demand, policy: policy }" /><ng-template #demand>Saved demand</ng-template><ng-template #policy>Policy draft</ng-template>` })
class Host { readonly page = inject(ActivatedRoute).snapshot.data['page'] as GregView; }

describe('shared Greg dashboard navigation', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([
    { path: 'greg', component: Host, data: { page: 'dashboard' } },
    { path: 'greg/plan', component: Host, data: { page: 'next-order' } },
    { path: 'greg/cases', component: Host, data: { page: 'cases' } },
    { path: 'comparison', component: Host, data: { page: 'comparison' } },
  ])] }));
  it('connects all six source-order controls to existing routes without losing unrelated query context', async () => {
    const harness = await RouterTestingHarness.create('/greg?brand=mini'); const router = TestBed.inject(Router);
    const buttons = () => harness.routeNativeElement!.querySelectorAll<HTMLButtonElement>('[role=tab]');
    expect(Array.from(buttons(), button => button.textContent)).toEqual(['Next order', 'Demand and supply', 'Policy', 'Order requests', 'Route comparison', 'Renewal cases']);
    const expected = ['/greg/plan?brand=mini', '/greg?brand=mini', '/greg?brand=mini#policy', '/greg/plan?brand=mini#gcsp-order-requests', '/comparison?brand=mini', '/greg/cases?brand=mini'];
    for (let index = 0; index < expected.length; index++) {
      buttons()[index].click(); await harness.fixture.whenStable(); harness.detectChanges();
      expect(router.url).toBe(expected[index]); expect(buttons()[index].getAttribute('aria-selected')).toBe('true');
    }
  });
  it('reflects direct fragments, query selections and history while retaining both local panels', async () => {
    const harness = await RouterTestingHarness.create('/greg#policy');
    const selected = () => harness.routeNativeElement!.querySelector('[role=tab][aria-selected=true]')?.textContent;
    expect(selected()).toBe('Policy'); expect(harness.routeNativeElement!.textContent).toContain('Saved demand'); expect(harness.routeNativeElement!.textContent).toContain('Policy draft');
    const policy = harness.routeNativeElement!.querySelector('[role=tabpanel]:not([hidden])');
    await harness.navigateByUrl('/greg?view=policy'); expect(selected()).toBe('Policy');
    expect(harness.routeNativeElement!.querySelector('[role=tabpanel]:not([hidden])')).toBe(policy);
    await harness.navigateByUrl('/greg'); expect(selected()).toBe('Demand and supply');
    await harness.navigateByUrl('/greg/plan#gcsp-order-requests'); expect(selected()).toBe('Order requests');
    await harness.navigateByUrl('/greg/plan?view=orders'); expect(selected()).toBe('Order requests');
  });
});
