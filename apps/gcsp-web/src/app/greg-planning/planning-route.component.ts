import { Component } from '@angular/core';
import { OrderPlanComponent } from './order-plan.component';
import { PlanningStore } from './planning.store';
import { ProductionStatusComponent } from './production-status.component';

/** Both sections share one route-scoped owner; leaving the route aborts and clears private state. */
@Component({ selector: 'gcsp-planning-route', imports: [OrderPlanComponent, ProductionStatusComponent], providers: [PlanningStore],
  template: `<gcsp-order-plan #plan (requested)="production.focusOutcome()" /><gcsp-production-status #production (replanned)="plan.focusResult()" />` })
export class PlanningRouteComponent {}
