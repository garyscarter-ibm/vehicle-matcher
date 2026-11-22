import { Component, input } from '@angular/core';
import { formatActivityTime as demoTime } from '../activity/activity.copy';
import type { StageHeadingLevel } from './stage-list.component';

export interface StageTrackerItem {
  readonly label: string;
  readonly state: string;
  readonly at?: string;
  readonly owner?: string;
  readonly next?: string;
  readonly note?: string;
}

const STATE_TEXT = Object.freeze({ done: 'Done', current: 'Current step', upcoming: 'Not started', declined: 'Declined', blocked: 'Not updated' });
type TrackerState = keyof typeof STATE_TEXT;
let sequence = 0;

/** Ordered source stages keep supplied wording; unknown state has the source upcoming presentation. */
@Component({ selector: 'gcsp-stage-tracker', host: { style: 'display: contents' }, template: `
  <section class="gcsp-stage-tracker" [attr.aria-labelledby]="headingId">
    @switch (level()) {
      @case (1) { <h1 class="gcsp-stage-heading" [id]="headingId">{{ heading() }}</h1> }
      @case (2) { <h2 class="gcsp-stage-heading" [id]="headingId">{{ heading() }}</h2> }
      @case (3) { <h3 class="gcsp-stage-heading" [id]="headingId">{{ heading() }}</h3> }
      @case (4) { <h4 class="gcsp-stage-heading" [id]="headingId">{{ heading() }}</h4> }
      @case (5) { <h5 class="gcsp-stage-heading" [id]="headingId">{{ heading() }}</h5> }
      @case (6) { <h6 class="gcsp-stage-heading" [id]="headingId">{{ heading() }}</h6> }
    }
    <ol class="gcsp-stage-list">
      @for (stage of stages(); track $index) {
        <li [class]="'gcsp-stage is-' + stateFor(stage.state)" [attr.aria-current]="stateFor(stage.state) === 'current' || stateFor(stage.state) === 'blocked' ? 'step' : null">
          <p class="gcsp-stage-head"><span class="gcsp-stage-label">{{ stage.label }}</span>{{ ' ' }}<span class="gcsp-stage-state">{{ states[stateFor(stage.state)] }}</span></p>
          @if (stage.at; as at) { @if (validTime(at)) { <time class="gcsp-stage-time" [dateTime]="at">{{ formatTime(at) }}</time> } }
          @if (stage.owner) { <p class="gcsp-stage-owner">{{ stage.owner }}</p> }
          @if (stage.next) { <p class="gcsp-stage-next">Next: {{ stage.next }}</p> }
          @if (stage.note) { <p class="gcsp-stage-note">{{ stage.note }}</p> }
        </li>
      }
    </ol>
  </section>
` })
export class StageTrackerComponent {
  readonly heading = input('Progress');
  readonly stages = input<readonly StageTrackerItem[]>([]);
  readonly level = input<StageHeadingLevel>(2);
  readonly headingId = `gcsp-stage-tracker-${++sequence}`;
  readonly states = STATE_TEXT;
  readonly formatTime = demoTime;

  stateFor(value: string): TrackerState { return Object.hasOwn(STATE_TEXT, value) ? value as TrackerState : 'upcoming'; }
  validTime(value: string): boolean { return Number.isFinite(Date.parse(value)); }
}
