import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
import { ButtonDirective } from '../kit/button.directive';
import { FactListComponent } from '../kit/fact-list.component';
import { DataTableComponent, DataTableColumn, DataTableRow, DataTableValueObject } from '../kit/data-table.component';
import { MetricTileComponent } from '../kit/metric-tile.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { GregStore } from './greg.store';
import type { GregCount, GregGroup } from './greg.types';

let sequence = 0;
@Component({
  selector: 'gcsp-greg-demand',
  imports: [NgTemplateOutlet, ButtonDirective, DataTableComponent, FactListComponent, MetricTileComponent, StatusScreenComponent],
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
    return d ? [{ key: 'model', caption: 'By model line', label: 'Model line', rows: this.countRows(d.byModelLine) },
      { key: 'body', caption: 'By body style', label: 'Body style', rows: this.countRows(d.byBody) }, { key: 'fuel', caption: 'By fuel type', label: 'Fuel type', rows: this.countRows(d.byFuel) }] : [];
  });
  readonly offers = computed(() => {
    const o = this.view().demand?.offers;
    return o ? [{ label: 'Offers made', count: o.made.count }, { label: 'Accepted', count: o.accepted.count }, { label: 'Declined', count: o.declined.count },
      { label: 'Expired', count: o.expired.count }, { label: 'Selected', count: o.selected.count }] : [];
  });
  readonly essentialColumns: readonly DataTableColumn[] = [{ key: 'name', label: 'Requirement' }, { key: 'state', label: 'State' }, { key: 'count', label: 'Briefs', numeric: true }];
  readonly unmetColumns: readonly DataTableColumn[] = [{ key: 'name', label: 'Gate' }, { key: 'effect', label: 'Effect' }, { key: 'count', label: 'Briefs', numeric: true }];
  readonly stockColumns: readonly DataTableColumn[] = [{ key: 'name', label: 'Model line' }, { key: 'released', label: 'Released', numeric: true },
    { key: 'held', label: 'Held', numeric: true }, { key: 'allocated', label: 'Allocated', numeric: true }];
  readonly declineColumns: readonly DataTableColumn[] = [{ key: 'name', label: 'Reason' }, { key: 'count', label: 'Declined', numeric: true }];
  readonly essentialRows = computed<readonly DataTableRow[]>(() => (this.view().demand?.demand.essentials ?? []).map((row, index) => ({ id: `essential-${index}`, label: row.label,
    cells: { name: row.label, state: row.state === 'confirmed' ? 'Confirmed' : 'Needs confirmation', count: this.countValue(row.count) } })));
  readonly unmetRows = computed<readonly DataTableRow[]>(() => (this.view().demand?.demand.unmet.byGate ?? []).map((row, index) => ({ id: `gate-${index}`, label: this.gateLabel(row),
    cells: { name: this.gateLabel(row), effect: row.severityLabel, count: this.countValue(row.count) } })));
  readonly stockRows = computed<readonly DataTableRow[]>(() => (this.view().demand?.stock.byModelLine ?? []).map((row, index) => ({ id: `stock-${index}`, label: row.label,
    cells: { name: row.label, released: this.countValue(row.released.count), held: this.countValue(row.held.count), allocated: this.countValue(row.allocated.count) } })));
  readonly declineRows = computed(() => this.countRows(this.view().demand?.offers.declinedByReason ?? []));
  groupColumns(label: string): readonly DataTableColumn[] { return [{ key: 'name', label }, { key: 'count', label: 'Briefs', numeric: true }]; }
  countValue(count: GregCount): DataTableValueObject {
    return { label: count.label, isBand: count.kind === 'band', ...(count.kind === 'band' && count.fewerThan !== undefined ? { fewerThan: count.fewerThan } : {}) };
  }
  private countRows(rows: readonly GregGroup[]): readonly DataTableRow[] {
    return rows.map((row, index) => ({ id: `${row.key}-${index}`, label: row.label, cells: { name: row.label, count: this.countValue(row.count) } }));
  }
  readonly status = computed(() => this.view().demandMessage || (this.view().demandState === 'loading' ? 'Loading the demand figures.' : ''));
  time(value: string): string { return new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London', timeZoneName: 'short' }); }
  gateLabel(row: GregGroup): string {
    const stock = this.view().demand?.stock;
    return row.code !== 'no-released-stock' || !stock?.unavailable ? row.label
      : stock.source.reason === 'stale' ? 'Stock data too old to use' : 'Stock source unavailable';
  }
}
