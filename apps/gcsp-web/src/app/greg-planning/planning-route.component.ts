import { Component, viewChild } from '@angular/core';
import { GregNavigationComponent } from '../kit/greg-navigation.component';
import { OrderPlanComponent } from './order-plan.component';
import { PlanningStore } from './planning.store';
import { ProductionStatusComponent } from './production-status.component';

// Both panels share one route-scoped owner; leaving the route aborts and clears private state.
@Component({ selector: 'gcsp-planning-route', imports: [GregNavigationComponent, OrderPlanComponent, ProductionStatusComponent], providers: [PlanningStore],
  template: `<gcsp-greg-navigation #navigation page="next-order" [showIntro]="true" [panels]="{ 'next-order': nextOrder, orders: orderRequests }" />
    <ng-template #nextOrder><gcsp-order-plan [headingLevel]="2" (requested)="showOrders(navigation)" /></ng-template>
    <ng-template #orderRequests><gcsp-production-status (replanned)="showPlan(navigation)" /></ng-template>` })
export class PlanningRouteComponent {
  private readonly plan = viewChild(OrderPlanComponent);
  private readonly production = viewChild(ProductionStatusComponent);
  async showOrders(navigation: GregNavigationComponent): Promise<void> {
    await navigation.select('orders'); this.production()?.focusOutcome();
  }
  async showPlan(navigation: GregNavigationComponent): Promise<void> {
    await navigation.select('next-order'); this.plan()?.focusResult();
  }
}
