import { Component, OnDestroy, TemplateRef, computed, inject, viewChild } from '@angular/core';
import { GregNavigationComponent } from '../kit/greg-navigation.component';
import { GregDemandComponent } from './greg-demand.component';
import { GregPolicyComponent } from './greg-policy.component';
import { GregStore } from './greg.store';

@Component({
  selector: 'gcsp-greg-route',
  imports: [GregNavigationComponent, GregDemandComponent, GregPolicyComponent],
  providers: [GregStore],
  template: `<div class="greg-tabs"><gcsp-greg-navigation page="dashboard" [showIntro]="true" lede="What employees have saved and confirmed they need, set against released stock and the outcomes of offers." [panels]="panels()" /></div>
    <ng-template #demand><gcsp-greg-demand /></ng-template><ng-template #policy><gcsp-greg-policy /></ng-template>`,
  styles: `:host { display: block; min-width: 0; }`,
})
export class GregRouteComponent implements OnDestroy {
  readonly store = inject(GregStore);
  private readonly demand = viewChild<TemplateRef<unknown>>('demand');
  private readonly policy = viewChild<TemplateRef<unknown>>('policy');
  readonly panels = computed(() => ({ dashboard: this.demand(), policy: this.policy() }));
  ngOnDestroy(): void { this.store.dispose(); }
}
