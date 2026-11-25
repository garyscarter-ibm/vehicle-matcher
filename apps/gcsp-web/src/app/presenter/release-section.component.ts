import { Component, OnDestroy, computed, effect, input, signal, untracked } from '@angular/core';
import { FactListComponent } from '../kit/fact-list.component';
import { CountBarsComponent } from '../kit/count-bars.component';
import { ReleaseGridComponent } from '../kit/release-grid.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { LoadingSkeletonComponent } from '../kit/loading-skeleton.component';
import { friendlyTime } from '../kit/friendly-time';
import { PresenterRelease } from './presenter.projections';

@Component({ selector: 'gcsp-presenter-release', host: { style: 'display: contents' }, imports: [FactListComponent, CountBarsComponent, ReleaseGridComponent, StatusScreenComponent, LoadingSkeletonComponent], template: `
  <section class="gcsp-console-release" aria-labelledby="presenter-release-title">
    <div class="gcsp-console-release-head"><h2 id="presenter-release-title">Today's release</h2><p class="gcsp-console-release-line">{{ releaseLine() }}</p></div>
    <div class="gcsp-console-release-body">
      @if (loading() || value()?.release) { <gcsp-release-grid [tiles]="tiles()" [loading]="loading()" [animate]="gridAnimate()" (settled)="gridSettled()" /> }
      @else { <gcsp-status-screen [title]="value() ? 'No cars released yet' : 'Release information unavailable'" [level]="3" [announcement]="null" /> }
    </div>
    <div class="gcsp-console-release-foot">
      @if (loading()) { <div gcspLoadingSkeleton label="Loading release totals" layout="stats" [role]="null"></div> }
      @else if (value()) { <gcsp-fact-list presentation="source" className="gcsp-release-totals" [rows]="totals()" /> }
    </div>
    @if (value()?.modelLines?.length) { <details class="gcsp-release-charts"><summary class="gcsp-release-charts-summary">Latest release stats</summary><div class="gcsp-release-charts-grid">
      <gcsp-count-bars label="Model line" [rows]="modelLines()" /><gcsp-count-bars label="Colour" [rows]="value()!.charts.colours" [limit]="8" otherLabel="Other colours" />
      <gcsp-count-bars label="Points a month" [rows]="points()" /><gcsp-count-bars label="Fuel" [rows]="value()!.charts.fuel" />
    </div></details> }
    <section class="gcsp-console-release gcsp-console-allocation" aria-labelledby="presenter-allocation-title"><div class="gcsp-console-release-head"><h2 id="presenter-allocation-title">Allocation</h2><p class="gcsp-console-release-line">Buddy offers · this run</p></div>
      <div class="gcsp-allocation-body">@if (loading()) { <div gcspLoadingSkeleton label="Loading allocation" layout="stats" [role]="null"></div> }
        @else if (value()?.allocation) { <gcsp-fact-list presentation="source" className="gcsp-allocation-totals" [rows]="allocation()" /> }
        @else { <gcsp-status-screen title="Allocation unavailable" message="Refresh the presenter readback to try again." [level]="3" [announcement]="null" /> }
      </div>
    </section>
  </section>
` })
export class ReleaseSectionComponent implements OnDestroy {
  readonly value = input<PresenterRelease | null>(null); readonly loading = input(false); readonly animate = input(false);
  readonly releaseLine = computed(() => this.value()?.release ? `Released ${friendlyTime(this.value()!.release!.releasedAt) ?? 'today'}` : this.value() ? 'Waiting for the next release' : '');
  readonly tiles = signal<readonly { id: string; imageSrc: string; label: string }[]>([]);
  readonly gridAnimate = signal(false);
  private readonly displayed = signal<readonly number[]>([0, 0, 0, 0, 0]);
  readonly totals = computed(() => ['Latest release', 'Total released', 'Unallocated', 'Buddy Allocated', 'Manually Allocated'].map((label, index) => ({ label, value: this.displayed()[index].toLocaleString('en-GB') })));
  private key: string | null = null; private first = true; private frame: number | null = null;
  private pendingCounts: readonly number[] | null = null; private generation = 0; private disposed = false;
  constructor() { effect(() => { const value = this.value(); const loading = this.loading(); const animate = this.animate(); untracked(() => this.update(value, loading, animate)); }); }
  private update(value: PresenterRelease | null, loading: boolean, animate: boolean): void {
    this.generation++; if (this.frame !== null) cancelAnimationFrame(this.frame); this.pendingCounts = null;
    if (loading) { this.gridAnimate.set(false); return; }
    const initial = this.first; this.first = false;
    if (!value?.release) { this.key = null; this.tiles.set([]); this.gridAnimate.set(false); this.displayed.set([0, 0, 0, 0, 0]); return; }
    const key = `${value.runId}:${value.release.trancheId || value.release.windowId}`;
    const end = [value.counts.released, value.counts.totalReleased, value.counts.onScheme, value.counts.buddyAllocated, value.counts.manuallyAllocated];
    if (key === this.key) { this.displayed.set(end); return; }
    this.key = key; let reduced = false; try { reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false; } catch { /* Motion is optional. */ }
    const motion = animate && !initial && !reduced && typeof requestAnimationFrame === 'function';
    this.gridAnimate.set(motion); this.displayed.set(motion ? [0, 0, 0, 0, 0] : end); this.pendingCounts = motion ? end : null;
    this.tiles.set(value.cars.map(car => ({ id: car.id, imageSrc: car.imageSrc ?? '', label: car.modelName ? [car.modelName, car.colourName].filter(Boolean).join(', ') : car.imageAlt || 'Car' })));
  }
  gridSettled(): void {
    const end = this.pendingCounts; if (!end || this.disposed) return; this.pendingCounts = null;
    const generation = this.generation; const start = performance.now();
    const count = (now: number) => { if (this.disposed || generation !== this.generation) return; const fraction = Math.min(1, (now - start) / 600); this.displayed.set(end.map(value => Math.round(value * fraction))); if (fraction < 1) this.frame = requestAnimationFrame(count); };
    this.frame = requestAnimationFrame(count);
  }
  ngOnDestroy(): void { this.disposed = true; this.generation++; if (this.frame !== null) cancelAnimationFrame(this.frame); }
  readonly allocation = computed(() => { const a = this.value()?.allocation; return a ? [{ label: 'Allocation Pending', value: a.pending }, { label: 'Allocation Declined', value: a.declined }, { label: 'Allocation Accepted', value: a.accepted }] : []; });
  readonly modelLines = computed(() => this.value()?.modelLines.map(row => ({ label: row.modelLine, count: row.count })) ?? []);
  readonly points = computed(() => this.value()?.charts.points.map(row => ({ ...row, label: /^\d+$/.test(row.label) ? `${Number(row.label).toLocaleString('en-GB')} points` : row.label })) ?? []);
}
