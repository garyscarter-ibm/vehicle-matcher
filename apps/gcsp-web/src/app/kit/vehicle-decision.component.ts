import { NgTemplateOutlet } from '@angular/common';
import { Component, input } from '@angular/core';
import { FinishLabelComponent } from './finish-label.component';
import { FinishLabelData } from './finish-shades';

/** Source decision layout only. Exact facts, media, details and commands remain the caller's. */
@Component({ selector: 'gcsp-vehicle-decision', imports: [NgTemplateOutlet, FinishLabelComponent], host: { style: 'display: contents' }, template: `
  <ng-template #heading>
    @if (kicker()) { <p class="gcsp-vehicle-kicker" [class.gcsp-vehicle-context]="layout() === 'focused'">{{ kicker() }}</p> }
    <div class="vm-card-head">
      <h2 class="vm-card-name" [class.gcsp-vehicle-title]="layout() === 'focused'">{{ name() || 'Car name not supplied' }}</h2>
      <span class="vm-score" hidden title="Preference match score"></span>
    </div>
    <div class="gcsp-finishes" [class.gcsp-vehicle-meta]="layout() === 'focused'">
      @for (finish of finishes(); track $index) {
        <gcsp-finish-label [label]="finish.label" [value]="finish.value ?? null" [shade]="finish.shade" [labelled]="layout() === 'focused'" />
      }
    </div>
  </ng-template>
  <article class="vm-card vm-card-explicit gcsp-vehicle-decision" [class.gcsp-vehicle-focused]="layout() === 'focused'">
    <div class="gcsp-vehicle-summary" [class.gcsp-vehicle-copy]="layout() === 'focused'">
      @if (layout() === 'focused') { <div class="gcsp-vehicle-heading"><ng-container [ngTemplateOutlet]="heading" /></div> }
      @else { <ng-container [ngTemplateOutlet]="heading" /> }
      <div class="vm-card-terms">
        @if (finite(points())) {
          <p class="gcsp-points"><strong class="gcsp-points-n">{{ number(points()) }}</strong> points a month</p>
          @if (finite(allowance())) { <p class="vm-specs">{{ number(allowance()) }} points a month allowance</p> }
        } @else {
          <p class="vm-specs">Monthly points cost not supplied · {{ finite(allowance()) ? number(allowance()) + ' points a month allowance' : 'monthly points allowance not supplied' }}</p>
        }
        @if (contribution()) { <p class="vm-specs gcsp-vehicle-contribution">{{ contribution() }}</p> }
      </div>
      @if (pointsDifference()) { <p class="gcsp-vehicle-saving">{{ pointsDifference() }}</p> }
      <ng-content select="[decisionDeadline]" />
      <ng-content select="[decisionActions]" />
      <ng-content select="[decisionNote]" />
    </div>
    <ng-content select="[decisionMedia]" />
    <div class="gcsp-vehicle-details">
      <h3 class="gcsp-h3 gcsp-vehicle-details-title">Vehicle details</h3>
      <div class="gcsp-finishes">
        @for (finish of finishes(); track $index) {
          <gcsp-finish-label [label]="finish.label" [value]="finish.value ?? null" [shade]="finish.shade" />
        }
      </div>
      <ng-content select="[decisionOverview]" />
      <ng-content select="[decisionDetails]" />
    </div>
  </article>
` })
export class VehicleDecisionComponent {
  readonly name = input('');
  readonly kicker = input('');
  readonly finishes = input<readonly FinishLabelData[]>([]);
  readonly points = input<number | null>(null);
  readonly allowance = input<number | null>(null);
  readonly contribution = input<string | null>(null);
  readonly pointsDifference = input<string | null>(null);
  readonly layout = input<'default' | 'focused'>('default');
  readonly finite = (value: number | null): boolean => Number.isFinite(value);
  readonly number = (value: number | null): string => value?.toLocaleString('en-GB') ?? '';
}
