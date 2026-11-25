import { ChangeDetectorRef, Component, OnDestroy, TemplateRef, ViewChild, computed, effect, inject, input, signal, untracked, viewChildren } from '@angular/core';
import { ActivityTimelineComponent, TimelineEvent } from '../kit/activity-timeline.component';
import { ButtonDirective } from '../kit/button.directive';
import { SideDrawerComponent } from '../kit/side-drawer.component';
import { MailDetailComponent } from '../kit/mail-detail.component';
import { friendlyTime } from '../kit/friendly-time';
import { OutboxMessage } from '../outbox/outbox.client';
import { PresenterControls } from './presenter.types';
import { releasedThisTick } from './basic-model';

interface RecordedTick { readonly tickId: string; readonly at: string; readonly released: number | null; readonly lapsed: number }
@Component({ selector: 'gcsp-presenter-happened', host: { style: 'display: contents' }, imports: [ActivityTimelineComponent, ButtonDirective, SideDrawerComponent, MailDetailComponent], template: `
  <section class="gcsp-happened" aria-label="What happened"><details class="gcsp-happened-fold"><summary class="gcsp-happened-summary">What happened</summary><div class="gcsp-happened-slot">
    @for (message of offers(); track message.jobId) { <ng-template #emailAction><button gcspButton variant="ghost" type="button" [attr.data-job-id]="message.jobId" [attr.aria-label]="'View email, ' + time(message.time)" (click)="open(message, $event)">View email</button></ng-template> }
    <gcsp-activity-timeline heading="What happened" [headingHidden]="true" [events]="events()" [formatTime]="time" />
  </div></details>@if (unavailable()) { <p class="gcsp-note">Captured emails could not be loaded.</p> }</section>
  <gcsp-side-drawer [title]="selected()?.subject || 'Email not created yet'" context="Captured email" (closed)="selectedId.set(null)">
    @if (selected(); as message) { <div class="gcsp-happened-mail"><gcsp-mail-detail [message]="message" [showHeading]="false" /></div> }
  </gcsp-side-drawer>
` })
export class HappenedFeedComponent implements OnDestroy {
  readonly controls = input.required<PresenterControls>(); readonly messages = input<readonly OutboxMessage[]>([]); readonly unavailable = input(false);
  readonly selectedId = signal<string | null>(null); readonly history = signal<readonly RecordedTick[]>([]);
  readonly selected = computed(() => this.messages().find(row => row.jobId === this.selectedId()) ?? null);
  readonly offers = computed(() => this.messages().filter(message => message.messageKind === 'offer' && message.time && Number.isFinite(Date.parse(message.time))));
  private readonly actions = viewChildren<TemplateRef<unknown>>('emailAction');
  @ViewChild(SideDrawerComponent) private drawer!: SideDrawerComponent;
  private readonly detector = inject(ChangeDetectorRef); private run: string | null = null;
  readonly time = (instant: string | null): string => friendlyTime(instant) ?? 'Time not available';
  readonly events = computed<readonly TimelineEvent[]>(() => {
    const controls = this.controls(); const history = this.history();
    const rows: TimelineEvent[] = [{ id: 'started', occurredAt: controls.startsAt, label: !controls.lastTick && !history.some(row => (row.released ?? 0) > 0) ? 'Scheme started, no cars on the scheme yet' : 'Scheme started' }];
    for (const tick of history) { if ((tick.released ?? 0) > 0) rows.push({ id: `released-${tick.tickId}`, occurredAt: tick.at, label: `${tick.released} ${tick.released === 1 ? 'car' : 'cars'} released` }); if (tick.lapsed > 0) rows.push({ id: `lapsed-${tick.tickId}`, occurredAt: tick.at, label: tick.lapsed === 1 ? 'Hold lapsed' : `${tick.lapsed} holds lapsed` }); }
    this.offers().forEach((message, index) => rows.push({ id: `email-${message.jobId}`, occurredAt: message.time, action: this.actions()[index], label: message.state === 'sent' ? message.transport === 'captured' ? 'Offer email captured' : 'Offer email sent' : message.state === 'failed' ? 'Offer email not delivered' : 'Offer email waiting to send' }));
    return rows.map((row, index) => ({ row, index })).sort((a, b) => Date.parse(b.row.occurredAt ?? '') - Date.parse(a.row.occurredAt ?? '') || b.index - a.index).map(entry => entry.row);
  });
  constructor() {
    effect(() => { const controls = this.controls(); untracked(() => {
      if (controls.runId !== this.run) { this.drawer?.close(false); this.selectedId.set(null); this.run = controls.runId; this.history.set(this.load(controls.runId)); }
      const tick = controls.lastTick; if (!tick || this.history().some(row => row.tickId === tick.tickId)) return;
      const outcome = tick.outcomes.find(row => row.handlerId === 'buddy-expiry')?.outcome;
      const value = outcome?.['status'] === 'ok' ? outcome['value'] as Record<string, unknown> | undefined : undefined;
      const expired = value?.['expired']; const lapsed = Array.isArray(expired) ? expired.length : Number.isSafeInteger(expired) && Number(expired) >= 0 ? Number(expired) : 0;
      this.history.update(rows => [...rows, { tickId: tick.tickId, at: tick.now, released: releasedThisTick(controls), lapsed }]);
      try { sessionStorage.setItem(`gcsp:presenter-feed:${controls.runId}`, JSON.stringify(this.history())); } catch { /* Storage is optional. */ }
    }); });
    effect(() => { const selected = this.selected(); if (!selected) untracked(() => this.drawer?.close(false)); });
  }
  open(message: OutboxMessage, event: Event): void { this.selectedId.set(message.jobId); this.detector.detectChanges(); this.drawer.open(event.currentTarget as HTMLElement); }
  private load(run: string): readonly RecordedTick[] {
    try { const value: unknown = JSON.parse(sessionStorage.getItem(`gcsp:presenter-feed:${run}`) ?? '[]'); return Array.isArray(value) ? value.filter((row): row is RecordedTick => row && typeof row.tickId === 'string' && typeof row.at === 'string' && Number.isFinite(Date.parse(row.at)) && (row.released === null || Number.isSafeInteger(row.released) && row.released >= 0) && Number.isSafeInteger(row.lapsed) && row.lapsed >= 0) : []; } catch { return []; }
  }
  ngOnDestroy(): void { this.drawer?.close(false); }
}
