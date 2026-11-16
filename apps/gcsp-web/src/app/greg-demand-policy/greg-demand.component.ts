import { Component, computed, inject } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
import { ButtonDirective } from '../kit/button.directive';
import { FactListComponent } from '../kit/fact-list.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { GregStore } from './greg.store';
import type { GregGroup } from './greg.types';

let sequence = 0;
@Component({
  selector: 'gcsp-greg-demand',
  imports: [ButtonDirective, FactListComponent, ScreenIntroComponent, StatusScreenComponent],
  templateUrl: './greg-demand.component.html', styleUrl: './greg-demand.component.css',
})
export class GregDemandComponent {
  readonly store = inject(GregStore);
  readonly authenticationUnavailable = computed(() => this.auth.state().status === 'unavailable');
  private readonly auth = inject(AuthPort);
  readonly view = this.store.view;
  readonly id = `gcsp-greg-demand-${++sequence}`;
  readonly meta = computed(() => {
    const d = this.view().demand;
    return d ? [{ label: 'As of', value: this.time(d.asOf) }, { label: 'Policy versions', value: d.versions.policy.join(', ') || 'None supplied' },
      { label: 'Brief versions', value: d.versions.brief.join(', ') || 'None yet' }, { label: 'Projection reference', value: d.projectionVersion },
      { label: 'Revision', value: d.versions.revision }, ...(d.versions.clock === undefined ? [] : [{ label: 'Clock version', value: d.versions.clock }])] : [];
  });
  readonly headline = computed(() => {
    const d = this.view().demand;
    return d ? [{ label: 'Active briefs', count: d.demand.activeBriefs.count }, { label: 'Briefs with no suitable car', count: d.demand.unmet.total.count },
      { label: 'Offers made', count: d.offers.made.count }, { label: 'Selected', count: d.offers.selected.count }] : [];
  });
  readonly groups = computed(() => {
    const d = this.view().demand?.demand;
    return d ? [{ key: 'model', caption: 'By model line', label: 'Model line', rows: d.byModelLine },
      { key: 'body', caption: 'By body style', label: 'Body style', rows: d.byBody }, { key: 'fuel', caption: 'By fuel type', label: 'Fuel type', rows: d.byFuel }] : [];
  });
  readonly offers = computed(() => {
    const o = this.view().demand?.offers;
    return o ? [{ label: 'Offers made', count: o.made.count }, { label: 'Accepted', count: o.accepted.count }, { label: 'Declined', count: o.declined.count },
      { label: 'Expired', count: o.expired.count }, { label: 'Selected', count: o.selected.count }] : [];
  });
  readonly status = computed(() => this.view().demandMessage || (this.view().demandState === 'loading' ? 'Loading the demand figures.' : ''));
  time(value: string): string { return new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London', timeZoneName: 'short' }); }
  gateLabel(row: GregGroup): string {
    const stock = this.view().demand?.stock;
    return row.code !== 'no-released-stock' || !stock?.unavailable ? row.label
      : stock.source.reason === 'stale' ? 'Stock data too old to use' : 'Stock source unavailable';
  }
}
