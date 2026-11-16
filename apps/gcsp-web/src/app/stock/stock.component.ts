import { DOCUMENT } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, Injector, input, output, untracked } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { FactListComponent } from '../kit/fact-list.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { MediaGalleryComponent, MediaGalleryImage } from '../kit/media-gallery.component';
import { OptionListComponent } from '../kit/option-list.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { VehicleCardAction, VehicleCardComponent } from '../kit/vehicle-card.component';
import { stockFactRows, stockFilterOptions } from './stock.presentation';
import { StockControls, StockNavigationSnapshot, StockSort, StockStore } from './stock.store';
import { StockCar, StockData, StockDisplayFact } from './stock.types';

const states: Readonly<Record<string, readonly [string, string]>> = {
  loading: ['Loading released cars', 'Checking the available stock.'],
  'no-suitable-stock': ['No eligible cars', 'The released cars are shown below with their eligibility.'],
  'empty-stock': ['No released stock', 'There are no released cars to browse yet.'],
  'nothing-released-yet': ['No released stock', 'There are no released cars to browse yet.'],
  'no-visible-releases': ['No released cars are visible to you yet', 'Refresh availability to check again.'],
  'empty-search': ['No cars match these filters', 'Try another search or clear your filters.'],
  'choices-invalid': ['Check your choices', 'Return to your choices before browsing cars.'],
  'context-refresh': ['Your choices or stock have changed', 'Refresh availability before reviewing a car.'],
  'car-taken': ['This car is no longer available', 'Refresh availability to see the released cars.'],
  'source-unavailable': ['Stock is unavailable', 'The stock source could not be reached. Try again.'],
  denied: ['Released stock is not available to this account', 'Use your own employee sign-in to browse released cars.'],
  'authentication-required': ['Sign in to browse released cars', 'Return after signing in with your employee account.'],
  'authentication-unavailable': ['Sign-in is unavailable', 'Try signing in again when the service is available.'],
};

@Component({
  selector: 'gcsp-stock',
  imports: [ButtonDirective, FactListComponent, LabelledFieldComponent, MediaGalleryComponent, OptionListComponent,
    ScreenIntroComponent, StatusScreenComponent, VehicleCardComponent],
  providers: [StockStore],
  templateUrl: './stock.component.html',
  styleUrl: './stock.component.css',
})
export class StockComponent {
  readonly store = inject(StockStore);
  readonly navigation = input<unknown>(null);
  readonly reviewUnavailableReason = input<string | null>(null);
  readonly navigationChange = output<{ readonly snapshot: StockNavigationSnapshot | null; readonly replace: boolean }>();
  readonly review = output<StockCar['review']>();
  readonly back = output<void>();
  readonly options = computed(() => stockFilterOptions(this.store.allCars(), this.store.series(), this.store.bodies(), this.store.controls()));
  readonly message = computed(() => states[this.store.state()] ?? null);
  readonly allowance = computed(() => {
    const values = [...new Set(this.store.allCars().map(car => car.cost.allowance).filter(value => value !== null))];
    return values.length === 1 ? `Your allowance: ${values[0]!.toLocaleString('en-GB')} points a month` : 'Your allowance: see the terms for each car';
  });
  readonly countText = computed(() => {
    const c = this.store.counts();
    return `${c.records} released cars · ${c.eligible} eligible · ${c.visible} matching · ${c.visibleEligible} eligible matching`;
  });
  readonly detailRows = computed(() => {
    const car = this.store.selectedCar();
    return car ? stockFactRows([...Object.values(car.fields), ...car.emissions,
      this.fact('Monthly scheme cost', car.cost.value, 'points a month'), this.fact('Available allowance', car.cost.allowance, 'points a month'),
      this.fact('Scheme contribution', car.contribution?.amount ?? null, car.contribution ? `${car.contribution.currency}/${car.contribution.period}` : null)]) : [];
  });
  readonly detailSections = computed(() => {
    const detail = this.store.detail();
    if (!detail) return [];
    return [
      { title: 'Exact vehicle facts', rows: stockFactRows(detail.exactFacts) },
      { title: 'Model reference facts', rows: stockFactRows(detail.referenceFacts) },
      { title: 'Other supplied facts', rows: stockFactRows(detail.unclassifiedFacts) },
      ...(['equipment', 'specifications', 'historic'] as const).map((key, i) => ({
        title: ['Configured equipment and options', 'Specifications', 'Vehicle history'][i],
        rows: stockFactRows([this.fact(['Configured equipment and options', 'Specifications', 'Vehicle history'][i],
          detail[key]?.status === 'known' ? detail[key]!.value : null), this.fact('Source and assurance', detail[key]?.provenance ?? null)]),
      })),
      { title: 'Scheme terms and sources', rows: stockFactRows([this.fact('Supplied scheme terms', detail.terms as StockData)]) },
      { title: 'Images and source information', rows: stockFactRows([this.fact('Image source', detail.media.provenance ?? null),
        this.fact('Snapshot source', detail.snapshot.sourceNamespace), this.fact('Snapshot observed', detail.snapshot['observedAt'] as StockData ?? null),
        this.fact('Snapshot version', detail.snapshot.snapshotVersion)]) },
    ];
  });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private restored: unknown = undefined;
  private lastNavigation = '';
  private detailOrigin: string | null = null;

  constructor() {
    const window = this.document.defaultView;
    const resize = () => this.store.setViewportWidth(window?.innerWidth ?? 1024);
    resize();
    window?.addEventListener('resize', resize);
    inject(DestroyRef).onDestroy(() => window?.removeEventListener('resize', resize));
    effect(() => {
      const navigation = this.navigation();
      const snapshot = this.store.navigationSnapshot();
      if (snapshot && navigation !== this.restored) {
        this.restored = navigation;
        untracked(() => { this.store.restoreNavigation(navigation); });
      }
    });
    effect(() => {
      const snapshot = this.store.navigationSnapshot();
      const signature = JSON.stringify(snapshot);
      if (signature !== this.lastNavigation) {
        this.lastNavigation = signature;
        untracked(() => this.navigationChange.emit({ snapshot, replace: true }));
      }
    });
  }

  releaseTime(value: string): string { return new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/London' }); }
  private fact(label: string, value: unknown, unit: string | null = null): StockDisplayFact {
    return { key: label, label, value: (value ?? null) as StockData, unit, status: value == null ? 'unknown' : 'known', missingLabel: 'Not supplied' };
  }
  images(car: StockCar): readonly MediaGalleryImage[] {
    const images = car.media.images.map(image => ({ ...image, alt: image.alt ?? undefined, caption: image.caption ?? undefined }));
    if (!car.media.src) return images;
    const primary = images.find(image => image.src === car.media.src)
      ?? { src: car.media.src, alt: car.media.alt, caption: car.media.caption ?? undefined };
    return [primary, ...images.filter(image => image.src !== primary.src)];
  }
  cardFacts(car: StockCar) { return stockFactRows([car.fields['exterior'], car.fields['interior'], car.fields['engine'],
    car.fields['transmission'], car.emissions[1], car.fields['earliestCollection']]); }
  line(car: StockCar): string { return typeof car.fields['model'].value === 'string' ? car.fields['model'].value : ''; }
  eligibility(car: StockCar): string {
    return car.gateStatus === 'eligible' ? 'Eligible' : car.gateStatus === 'ineligible' ? 'Not eligible' : 'Needs confirmation';
  }
  setControls(patch: Partial<StockControls>): void { this.store.setControls(patch); this.publish(); }
  sort(value: string): void { this.setControls({ sort: value as StockSort }); }
  clearFilters(): void { this.setControls({ query: '', series: '', body: '' }); this.focus(() => this.document.getElementById('stock-query')); }
  showMore(): void {
    const first = this.store.pageCars().length;
    this.store.showMore(); this.publish();
    this.focus(() => this.host.nativeElement.querySelectorAll<HTMLElement>('gcsp-vehicle-card article')[first]);
  }
  activate(event: VehicleCardAction): void {
    const car = this.store.allCars().find(car => car.id === event.memberId);
    if (!car) return;
    if (event.action === 'review') { if (car.reviewAvailable && !this.reviewUnavailableReason()) this.review.emit(car.review); return; }
    this.detailOrigin = car.id; this.store.openDetail(car.id); this.publish();
    this.focus(() => this.host.nativeElement.querySelector<HTMLElement>('[data-detail-heading]'));
  }
  closeDetail(): void {
    const id = this.detailOrigin ?? this.store.selectedId();
    this.store.closeDetail(); this.publish();
    this.focus(() => Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[data-details-id]')).find(node => node.dataset['detailsId'] === id)
      ?? this.host.nativeElement.querySelector<HTMLElement>('#stock-query'));
  }
  async reload(): Promise<void> { await this.store.reload(); }
  reviewDetail(): void { const car = this.store.selectedCar(); if (car?.reviewAvailable && !this.reviewUnavailableReason()) this.review.emit(car.review); }
  private publish(): void {
    const snapshot = this.store.navigationSnapshot();
    this.lastNavigation = JSON.stringify(snapshot);
    this.navigationChange.emit({ snapshot, replace: false });
  }
  private focus(target: () => HTMLElement | null | undefined): void {
    afterNextRender(() => target()?.focus(), { injector: this.injector });
  }
}
