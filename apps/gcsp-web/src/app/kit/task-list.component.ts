import { Component, computed, input } from '@angular/core';
import { formatActivityTime as demoTime } from '../activity/activity.copy';
import { ButtonDirective } from './button.directive';

export interface TaskItem {
  readonly id: string;
  readonly label: string;
  readonly owner?: string;
  readonly status?: string;
  readonly tone?: string;
  readonly due?: string | null;
  readonly reason?: string;
  readonly detail?: string;
  readonly action?: { readonly label: string; readonly onSelect?: (id: string) => void; readonly disabled?: boolean; readonly reason?: string };
}
export interface TaskGroup { readonly heading?: string; readonly items?: readonly TaskItem[] }

let sequence = 0;
const tones = new Set(['todo', 'in-progress', 'overdue', 'failed', 'done']);

@Component({
  selector: 'section[gcspTaskList]',
  imports: [ButtonDirective],
  host: { class: 'gcsp-task-list', '[class.is-rows]': 'rows()', '[attr.aria-labelledby]': 'headingId' },
  template: `
    @switch (level()) {
      @case (1) { <h1 class="gcsp-task-heading" [id]="headingId">{{ heading() }}</h1> }
      @case (2) { <h2 class="gcsp-task-heading" [id]="headingId">{{ heading() }}</h2> }
      @case (3) { <h3 class="gcsp-task-heading" [id]="headingId">{{ heading() }}</h3> }
      @case (4) { <h4 class="gcsp-task-heading" [id]="headingId">{{ heading() }}</h4> }
      @case (5) { <h5 class="gcsp-task-heading" [id]="headingId">{{ heading() }}</h5> }
      @case (6) { <h6 class="gcsp-task-heading" [id]="headingId">{{ heading() }}</h6> }
    }
    @if (filledGroups().length) {
      @for (group of filledGroups(); track $index; let groupIndex = $index) {
        <div class="gcsp-task-group">
          @if (group.heading) {
            @switch (groupLevel()) {
              @case (2) { <h2 class="gcsp-task-group-heading">{{ group.heading }}</h2> }
              @case (3) { <h3 class="gcsp-task-group-heading">{{ group.heading }}</h3> }
              @case (4) { <h4 class="gcsp-task-group-heading">{{ group.heading }}</h4> }
              @case (5) { <h5 class="gcsp-task-group-heading">{{ group.heading }}</h5> }
              @case (6) { <h6 class="gcsp-task-group-heading">{{ group.heading }}</h6> }
            }
          }
          <ul class="gcsp-task-items">
            @for (item of group.items; track $index; let itemIndex = $index) {
              <li [class]="'gcsp-task is-' + tone(item)">
                <p class="gcsp-task-label">{{ item.label }}</p>
                @if (tone(item) === 'overdue' || tone(item) === 'failed') {
                  <p class="gcsp-task-flag"><strong>{{ tone(item) === 'overdue' ? 'Overdue' : 'Failed' }}</strong>@if (tone(item) === 'failed' && item.reason) {: {{ item.reason }}}</p>
                }
                @if (metadata(item); as text) { <p class="gcsp-task-meta">{{ text }}</p> }
                @if (item.detail) { <p class="gcsp-task-detail">{{ item.detail }}</p> }
                @if (item.action; as action) {
                  <button gcspButton presentation="source" type="button" [disabled]="actionDisabled(item)"
                    [attr.aria-describedby]="action.reason ? reasonId(groupIndex, itemIndex) : null"
                    (click)="select(item)">{{ action.label }}</button>
                  @if (action.reason) { <p class="gcsp-task-reason" [id]="reasonId(groupIndex, itemIndex)">{{ action.reason }}</p> }
                }
              </li>
            }
          </ul>
        </div>
      }
    } @else { <p class="gcsp-task-empty">{{ emptyText() }}</p> }
  `,
})
export class TaskListComponent {
  readonly heading = input('Tasks');
  readonly groups = input<readonly TaskGroup[]>([]);
  readonly emptyText = input('No tasks.');
  readonly level = input<1 | 2 | 3 | 4 | 5 | 6>(2);
  readonly rows = input(false);
  private readonly instanceId = ++sequence;
  readonly headingId = `gcsp-task-list-${this.instanceId}`;
  readonly filledGroups = computed(() => this.groups().filter(group => group.items?.length));
  readonly groupLevel = computed(() => Math.min(this.level() + 1, 6));

  tone(item: TaskItem): string { return tones.has(item.tone ?? '') ? item.tone! : 'todo'; }

  metadata(item: TaskItem): string | null {
    const due = typeof item.due === 'string' && Number.isFinite(Date.parse(item.due)) ? `Due ${demoTime(item.due)}` : null;
    const parts = [item.owner, this.tone(item) === 'failed' ? null : item.status, due].filter(Boolean);
    return parts.length ? `${parts.join('. ')}.` : null;
  }

  reasonId(group: number, item: number): string { return `gcsp-task-reason-${this.instanceId}-${group}-${item}`; }
  actionDisabled(item: TaskItem): boolean { return Boolean(item.action?.disabled) || typeof item.action?.onSelect !== 'function'; }
  select(item: TaskItem): void { if (!this.actionDisabled(item)) item.action?.onSelect?.(item.id); }
}
