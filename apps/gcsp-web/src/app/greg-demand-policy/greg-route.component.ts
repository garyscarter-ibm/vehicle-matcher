import { Component, OnDestroy, TemplateRef, computed, inject, viewChild } from '@angular/core';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { TabsComponent } from '../kit/tabs.component';
import type { GcspTabItem } from '../kit/tabs.component';
import { GregDemandComponent } from './greg-demand.component';
import { GregPolicyComponent } from './greg-policy.component';
import { GregStore } from './greg.store';

@Component({
  selector: 'gcsp-greg-route',
  imports: [ScreenIntroComponent, TabsComponent, GregDemandComponent, GregPolicyComponent],
  providers: [GregStore],
  template: `<gcsp-screen-intro title="Employee car ordering" lede="Review saved demand and released stock, then preview and publish changes to scheme policy." />
    <div class="greg-tabs"><gcsp-tabs label="Employee car ordering" [items]="tabs()" /></div>
    <ng-template #demand><gcsp-greg-demand /></ng-template><ng-template #policy><gcsp-greg-policy /></ng-template>`,
  styles: `:host { display: block; min-width: 0; } .greg-tabs { margin-block-start: var(--gcsp-space-5); }`,
})
export class GregRouteComponent implements OnDestroy {
  readonly store = inject(GregStore);
  private readonly demand = viewChild<TemplateRef<unknown>>('demand');
  private readonly policy = viewChild<TemplateRef<unknown>>('policy');
  readonly tabs = computed<readonly GcspTabItem[]>(() => {
    const demand = this.demand(); const policy = this.policy();
    return demand && policy ? [{ id: 'demand', label: 'Demand and supply', content: demand }, { id: 'policy', label: 'Policy', content: policy }] : [];
  });
  ngOnDestroy(): void { this.store.dispose(); }
}
