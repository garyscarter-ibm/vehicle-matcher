import { NgTemplateOutlet } from '@angular/common';
import { Component, TemplateRef, computed, input } from '@angular/core';
import { formatActivityTime } from '../activity/activity.copy';
export { formatActivityTime as demoTime } from '../activity/activity.copy';
export interface TimelineEvent {
  readonly id?: string; readonly occurredAt?: string | null; readonly label: string; readonly detail?: string;
  readonly action?: TemplateRef<unknown> | null;
}
let sequence = 0;
@Component({ selector: 'gcsp-activity-timeline', imports: [NgTemplateOutlet], template: `
  <section class="gcsp-activity-timeline" [attr.aria-labelledby]="id">
    @switch (level()) {
      @case (1) { <h1 class="gcsp-timeline-heading" [id]="id">{{ heading() }}</h1> }
      @case (3) { <h3 class="gcsp-timeline-heading" [id]="id">{{ heading() }}</h3> }
      @case (4) { <h4 class="gcsp-timeline-heading" [id]="id">{{ heading() }}</h4> }
      @case (5) { <h5 class="gcsp-timeline-heading" [id]="id">{{ heading() }}</h5> }
      @case (6) { <h6 class="gcsp-timeline-heading" [id]="id">{{ heading() }}</h6> }
      @default { <h2 class="gcsp-timeline-heading" [id]="id">{{ heading() }}</h2> }
    }
    @if (note()) { <p class="gcsp-timeline-note">{{ note() }}</p> }
    @if (!rows().length) { <p class="gcsp-timeline-empty">{{ emptyText() }}</p> }
    @else { <ol class="gcsp-timeline-list">@for (event of rows(); track $index) {
      <li class="gcsp-timeline-event">
        @if (valid(event.occurredAt)) { <time class="gcsp-timeline-time" [attr.datetime]="event.occurredAt">{{ formatTime()(event.occurredAt!) }}</time> }
        @else { <span class="gcsp-timeline-time">Time not available</span> }
        <div class="gcsp-timeline-detail"><p class="gcsp-timeline-label">{{ event.label }}</p>
          @if (event.detail) { <p class="gcsp-timeline-description">{{ event.detail }}</p> }
          @if (event.action) { <ng-container [ngTemplateOutlet]="event.action" /> }
        </div>
      </li>
    }</ol> }
  </section>` })
export class ActivityTimelineComponent {
  readonly id = `gcsp-timeline-${++sequence}`;
  readonly events = input<readonly TimelineEvent[]>([]); readonly heading = input('Activity history'); readonly emptyText = input('No activity is recorded.');
  readonly level = input(2); readonly collapseRepeats = input(false); readonly formatTime = input<(instant: string) => string>(formatActivityTime); readonly note = input<string | null>(null);
  readonly rows = computed(() => {
    if (!this.collapseRepeats()) return this.events(); let last: string | null = null;
    return this.events().filter((event) => { const key = `${event.occurredAt}|${event.label}|${event.detail ?? ''}`; const keep = key !== last; last = key; return keep; });
  });
  valid(value: string | null | undefined): boolean { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
}
