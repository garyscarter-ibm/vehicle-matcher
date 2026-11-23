import { Component, computed, input } from '@angular/core';
import { formatActivityTime as demoTime } from '../activity/activity.copy';
import { ButtonDirective } from './button.directive';

export interface SlotPickerSlot { readonly slotId?: string; readonly start?: string | null }

let sequence = 0;
const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/London' });

function dayText(date: Date): string {
  const parts = Object.fromEntries(day.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts['weekday']} ${parts['day']} ${parts['month']} ${parts['year']}`;
}

interface SlotRow<T> { readonly slot: T; readonly time: string; readonly name: string }

@Component({
  selector: 'ul[gcspSlotPicker]',
  imports: [ButtonDirective],
  host: { '[class]': "'gcsp-slot-picker' + (className() ? ' ' + className() : '')" },
  template: `
    @for (group of days(); track group.text; let dayIndex = $index) {
      <li class="gcsp-slot-day">
        <p class="gcsp-slot-day-heading" [id]="dayId(dayIndex)">{{ group.text }}</p>
        <ul class="gcsp-slot-times" [attr.aria-labelledby]="dayId(dayIndex)">
          @for (row of group.rows; track $index) {
            <li class="gcsp-slot-time">
              @if (hasPicker()) {
                <button gcspButton presentation="source" variant="ghost" type="button" [disabled]="disabled()"
                  [attr.aria-label]="row.name" [attr.data-focus-key]="row.name" (click)="pick(row.slot)">{{ row.time }}</button>
              } @else { <span>{{ row.time }}</span> }
            </li>
          }
        </ul>
      </li>
    }
  `,
})
export class SlotPickerComponent<T extends SlotPickerSlot = SlotPickerSlot> {
  readonly slots = input<readonly T[]>([]);
  readonly actionLabel = input('Request');
  readonly onPick = input<((slot: T) => void) | undefined>();
  readonly disabled = input(false);
  readonly className = input('');
  private readonly instanceId = ++sequence;
  readonly hasPicker = computed(() => typeof this.onPick() === 'function');
  readonly days = computed(() => {
    const grouped = new Map<string, SlotRow<T>[]>();
    for (const slot of this.slots()) {
      const start = slot?.start;
      // Missing values are unavailable, rather than JavaScript's inferred epoch.
      if (typeof start !== 'string' || !start.trim()) continue;
      const date = new Date(start);
      if (!Number.isFinite(date.getTime())) continue;
      const text = dayText(date);
      const rows = grouped.get(text) ?? [];
      rows.push({ slot, time: clock.format(date), name: `${this.actionLabel()} ${demoTime(start)}` });
      grouped.set(text, rows);
    }
    return Array.from(grouped, ([text, rows]) => ({ text, rows }));
  });

  dayId(index: number): string { return `gcsp-slot-day-${this.instanceId}-${index}`; }
  pick(slot: T): void { if (!this.disabled()) this.onPick()?.(slot); }
}
