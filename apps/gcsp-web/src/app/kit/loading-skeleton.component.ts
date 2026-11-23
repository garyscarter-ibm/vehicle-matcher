import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input } from '@angular/core';

const layouts = {
  page: ['title', 'line', 'line-short', 'card', 'rows'],
  form: ['title', 'line', 'panel', 'panel'], timeline: ['title', 'card-text', 'rows'],
  card: ['title', 'card'], feature: ['title', 'feature', 'panel', 'rows'],
  console: ['title', 'line-short', 'actions', 'panel', 'rows'], section: ['rows'],
  'release-grid': ['tiles'], stats: ['stats'], bars: ['bars'],
  offer: ['offer-header', 'offer-card', 'panel', 'rows'], media: ['media'],
} as const;

@Component({
  selector: 'div[gcspLoadingSkeleton]', imports: [NgTemplateOutlet],
  host: { class: 'gcsp-skeleton', 'aria-busy': 'true', '[attr.data-layout]': 'activeLayout()', '[attr.role]': 'null' },
  templateUrl: './loading-skeleton.component.html',
})
export class LoadingSkeletonComponent {
  readonly label = input('Loading');
  readonly layout = input('page');
  readonly statusRole = input<string | null>('status', { alias: 'role' });
  readonly items = input<number | null>();
  readonly labels = input<readonly string[] | null>();
  readonly activeLayout = computed(() => Object.hasOwn(layouts, this.layout()) ? this.layout() as keyof typeof layouts : 'page');
  readonly blocks = computed(() => layouts[this.activeLayout()]);
  readonly tiles = computed(() => Array.from({ length: this.items() ?? 100 }, (_, index) => index));
  readonly bars = computed(() => Array.from({ length: this.items() ?? 3 }, (_, index) => index));
  readonly statLabels = computed(() => this.labels() ?? Array.from({ length: this.items() ?? 5 }, () => ''));
  readonly cardLines = ['line-short', 'heading', 'line', 'line', 'button'];
  readonly offerLines = ['heading', 'line', 'line-short', 'clock', 'actions'];
}
