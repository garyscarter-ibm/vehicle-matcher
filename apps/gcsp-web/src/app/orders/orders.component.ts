import { Component, computed, effect, ElementRef, inject, OnDestroy, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LiveRefreshService } from '../live-refresh.service';
import { AuthPort } from '../auth/auth.port';
import { safeReturnTo } from '../auth/route-policy';
import { formatActivityTime as demoTime } from '../activity/activity.copy';
import type { EvidenceRecord } from '../account/account.types';
import { ButtonDirective } from '../kit/button.directive';
import { FactListComponent, FactRow } from '../kit/fact-list.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { StageTrackerComponent } from '../kit/stage-tracker.component';
import type { StageTrackerItem } from '../kit/stage-tracker.component';
import { TaskListComponent } from '../kit/task-list.component';
import type { TaskGroup, TaskItem } from '../kit/task-list.component';
import { SlotPickerComponent } from '../kit/slot-picker.component';
import { ActivityTimelineComponent } from '../kit/activity-timeline.component';
import type { TimelineEvent } from '../kit/activity-timeline.component';
import { OrdersActions, OrdersActionState, OrderAction } from './orders.actions';
import { OrdersClient } from './orders.client';
import { OrdersController, OrdersControllerState } from './orders.controller';
import type { LifecycleResult, OfferedSlot, OrderAppointment, OrderReturnPlan, OwnedStep, ProducerSection } from './orders.types';
import type { OrdersReadContext } from './orders.read-port';

const stageStates: Readonly<Record<string, StageTrackerItem['state']>> = Object.freeze({
  approved: 'done', pending: 'current', declined: 'declined', 'not-started': 'upcoming',
});
const itemStatuses: Readonly<Record<string, string>> = Object.freeze({
  'not-started': 'Not started', 'waiting-for-employee': 'Waiting for you', 'in-progress': 'In progress',
  complete: 'Complete', failed: 'Failed',
});
const itemOwners: Readonly<Record<string, string>> = Object.freeze({ employee: 'You', 'scheme-team': 'Scheme team', retailer: 'Retailer' });
const ownerNames: Readonly<Record<string, string>> = Object.freeze({ employee: 'you', retailer: 'retailer', 'scheme-team': 'scheme team' });
const ownersWithoutArticle = new Set(['HR', 'ordering', 'you']);
const withOwner = (owner: string | null | undefined): string | undefined => {
  const name = owner ? ownerNames[owner] ?? owner : undefined;
  return name ? `With ${ownersWithoutArticle.has(name) ? name : `the ${name}`}` : undefined;
};
const sentence = (text: string): string => text ? text[0].toUpperCase() + text.slice(1) : '';
const itemTone = (status: string, overdue: boolean): string => status === 'failed' ? 'failed'
  : status === 'complete' ? 'done' : overdue ? 'overdue' : status === 'in-progress' ? 'in-progress' : 'todo';
const slotText = (slot: OfferedSlot | null | undefined): string | null => typeof slot?.start === 'string' && Number.isFinite(Date.parse(slot.start))
  ? demoTime(slot.start) : null;
const when = (prefix: string, slot: OfferedSlot | null | undefined): string => {
  const text = slotText(slot); return text ? `${prefix} ${text}` : prefix;
};
const dated = (label: string, instant: unknown): string => {
  const text = typeof instant === 'string' && Number.isFinite(Date.parse(instant)) ? demoTime(instant) : null;
  return text ? `${label}: ${text}` : `${label}.`;
};
const handoverHistoryLabels: Readonly<Record<string, string>> = Object.freeze({ requested: 'Requested', 'change-proposed': 'New time proposed',
  scheduled: 'Booked', completed: 'Handover complete', 'no-show': 'Handover missed' });
const returnHistoryLabels: Readonly<Record<string, string>> = Object.freeze({ requested: 'Return requested', 'change-proposed': 'New return time proposed',
  scheduled: 'Return booked', returned: 'Returned', 'return-missed': 'Return missed' });
type ReadinessGroup = { readonly heading: string; readonly labels: readonly string[] };

const contextKey = (c: OrdersReadContext | null): string | null => c
  ? JSON.stringify([c.subject, c.environmentId, c.runId, c.employeeId, c.employeeAuthority]) : null;

@Component({
  selector: 'gcsp-orders',
  imports: [RouterLink, ButtonDirective, FactListComponent, LabelledFieldComponent, ScreenIntroComponent, StatusScreenComponent,
    StageTrackerComponent, TaskListComponent, SlotPickerComponent, ActivityTimelineComponent],
  templateUrl: './orders.component.html', styleUrl: './orders.component.css',
})
export class OrdersComponent implements OnDestroy {
  private readonly auth = inject(AuthPort);
  private readonly client = inject(OrdersClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  readonly contextKey = computed(() => contextKey(this.client.context()));
  readonly state = signal<OrdersControllerState | null>(null);
  readonly action = signal<OrdersActionState>({ review: null, busy: false, result: null });
  readonly failedImage = signal<string | null>(null);
  private opener: HTMLElement | null = null;
  private readonly returnPickers = new Map<string, (slot: OfferedSlot) => void>();
  readonly appointmentPicker = (slot: OfferedSlot): void => this.pickAppointment(slot);
  private disposed = false;
  private refreshEpoch = 0;
  readonly refreshMessage = signal('');
  private readonly controller = new OrdersController(this.client, () => this.client.context(), (state) => this.state.set(state));
  private readonly commands = new OrdersActions(this.client, () => this.controller.state, () => this.client.context(), (state) => this.action.set(state));
  readonly model = computed(() => this.contextKey() && this.state()?.context
    && contextKey(this.state()!.context) === this.contextKey() ? this.state()!.projection : null);
  readonly orders = computed(() => { const s = this.state(); return this.model() && s?.orders?.status === 'ok' ? s.orders.value.orders : []; });
  readonly busy = computed(() => this.action().busy || this.state()?.phase === 'loading');
  readonly photo = computed(() => { const p = this.model(); return p?.selection.order?.orderUuid !== this.failedImage() ? p?.vehicle?.photo : undefined; });
  readonly stageRows = computed<readonly StageTrackerItem[]>(() => {
    const p = this.model(); const stages = p?.stages.state === 'ok' ? p.stages.value : null;
    if (!p || !stages) return [];
    const rows: StageTrackerItem[] = stages.stages.map((step) => {
      const here = step.stage === stages.currentStage;
      const blocked = here && step.state === 'pending' && !!stages.blocked;
      return { label: sentence(step.stage), state: blocked ? 'blocked' : stageStates[step.state] ?? 'upcoming',
        at: typeof step.at === 'string' ? step.at : undefined, owner: here ? withOwner(stages.owner) : undefined,
        next: here ? stages.nextStep ?? undefined : undefined, note: blocked ? stages.blocked?.reason ?? undefined : undefined };
    });
    if (stages.stages.some((step) => step.stage.toLowerCase() === 'handover')) return rows;

    const appointment = p.appointment.state === 'ok' ? p.appointment.value : null;
    const documents = p.documents.state === 'ok' ? p.documents.value : null;
    const handover = this.handoverStep(appointment);
    const ready: StageTrackerItem = { label: 'Ready for handover', state: documents?.readiness.ready === true || appointment?.state === 'completed'
      ? 'done' : handover.state === 'done' ? 'current' : 'upcoming' };
    const later = [handover, ready];
    const open = appointment?.state === 'not-requested' && appointment.eligibility?.eligible !== false;
    const focus = open ? handover : later.slice().reverse().find((step) => step.state === 'current');
    if (focus) Object.assign(focus, { owner: withOwner(appointment?.owner), next: appointment?.nextStep ?? undefined });
    const sourceRows = open || later.some((step) => step.state !== 'upcoming')
      ? rows.map((step) => ({ ...step, owner: undefined, next: undefined })) : rows;
    return [...sourceRows, ...later];
  });
  readonly documentChecklist = computed<{ groups: readonly TaskGroup[]; readiness: readonly ReadinessGroup[] }>(() => {
    const p = this.model(); const d = p?.documents.state === 'ok' ? p.documents.value : null;
    if (!p || !d) return { groups: [], readiness: [] };
    const mine: TaskItem[] = d.tasks.map((task) => {
      const item = d.items.find((candidate) => candidate.itemId === task.itemId);
      const listedForAction = task.actionable && p.actions.documentTaskIds.includes(task.itemId);
      const canAct = listedForAction && this.canAct('documents');
      return { id: task.itemId, label: task.label || item?.label || this.words(task.itemId), status: itemStatuses[task.status],
        tone: itemTone(task.status, task['overdue'] === true), due: task.status === 'complete' ? undefined
          : typeof task['dueAt'] === 'string' ? task['dueAt'] : undefined,
        reason: item?.reason ?? undefined, detail: task.actionable ? 'Acknowledgement, not a signature' : this.fact(task['acknowledgement'], 'label') || undefined,
        action: listedForAction ? { label: task.action || 'Acknowledge', disabled: !canAct,
          onSelect: canAct ? (id: string) => this.prepare({ kind: 'acknowledge', itemId: id }) : undefined } : undefined };
    });
    const others: TaskItem[] = d.items.filter((item) => item.owner !== 'employee').map((item) => ({
      id: item.itemId, label: item.label || this.words(item.itemId), owner: itemOwners[item.owner] ?? item.owner,
      status: itemStatuses[item.status], tone: itemTone(item.status, item['overdue'] === true),
      due: item.status === 'complete' ? undefined : typeof item['dueAt'] === 'string' ? item['dueAt'] : undefined,
      reason: item.reason ?? undefined,
    }));
    const listed = new Set([...mine, ...others].map((item) => item.id));
    const label = (id: string): string => d.items.find((item) => item.itemId === id)?.label || this.words(id);
    const readiness = !d.readiness.ready ? [
      { heading: 'Needs attention', labels: d.readiness.failed.filter((id) => !listed.has(id)).map(label) },
      { heading: 'Still to do', labels: d.readiness.blocking.filter((id) => !d.readiness.failed.includes(id) && !listed.has(id)).map(label) },
    ].filter((group) => group.labels.length) : [];
    return { groups: [{ heading: 'Your tasks', items: mine }, { heading: 'Being handled by others', items: others }], readiness };
  });
  readonly notice = computed(() => {
    const result = this.action().result; if (!result) return '';
    if (result.status === 'ok') return 'Update recorded. Refresh to read the latest provider status.';
    if (['pending', 'uncertain'].includes(result.status)) return 'Waiting for confirmation of your update. Refresh status before taking another action.';
    if (['authentication-required', 'unauthenticated', 'account-changed', 'stale-run'].includes(result.status)) return 'Your session has changed. Sign in again, then review the latest order.';
    if (['conflict', 'stale-version'].includes(result.status)) return result.reason || 'These details changed. Refresh and review the latest order.';
    return result.reason || `Update ${this.words(result.status).toLowerCase()}. Refresh before trying another action.`;
  });
  readonly relationshipRows = computed<readonly FactRow[]>(() => {
    const rel = this.model()?.relationship.value; if (!rel) return [{ label: 'Current car', value: null }];
    const current = rel.currentCar;
    const rows: FactRow[] = [{ label: 'Current car', value: current === null ? 'None' : current.kind === 'contract'
      ? current.contractId : current.orderUuid === this.model()?.selection.order?.orderUuid ? this.model()?.vehicle?.name ?? current.orderUuid : current.orderUuid }];
    if (current?.kind === 'order') rows.push({ label: 'VIN', value: current.vin });
    if (rel.oldCar) rows.push({ label: 'Previous car status', value: this.words(this.shown(rel.oldCar['status'])) });
    if (rel.newCar) rows.push({ label: 'New car status', value: this.words(this.shown(rel.newCar['status'])) });
    return rows;
  });
  private readonly stopLiveRefresh = inject(LiveRefreshService).subscribe(() => this.autoRefresh());

  constructor() {
    effect(() => {
      const context = this.contextKey(); const order = this.params().get('orderUuid') ?? undefined;
      untracked(() => { this.refreshEpoch++; this.refreshMessage.set(''); this.commands.contextChanged(); this.controller.contextChanged(); this.failedImage.set(null); if (context) void this.controller.load(order); });
    });
  }
  refresh(): void {
    if (this.action().busy) return;
    this.refreshEpoch++; this.refreshMessage.set(''); this.commands.refreshing(); void this.controller.refresh();
  }
  private progressKey(state: OrdersControllerState): string | null {
    const progress = state.projection;
    if (state.phase !== 'settled' || !progress?.selection.order
      || progress.stages.state !== 'ok'
      || [progress.stages, progress.documents, progress.appointment, progress.returnPlan].some((part) => ['stale-run', 'identity-mismatch', 'authentication-required', 'unauthenticated', 'account-changed'].includes(part.state))) return null;
    return JSON.stringify([progress.stages, progress.documents, progress.appointment, progress.returnPlan],
      (key, value) => key === 'asOf' ? undefined : value);
  }
  private async autoRefresh(): Promise<void> {
    const state = this.controller.state; const context = this.contextKey(); const requested = this.params().get('orderUuid');
    if (this.disposed || !context || state.phase !== 'settled' || this.action().busy || this.action().review) return;
    const before = this.progressKey(state); const epoch = ++this.refreshEpoch;
    this.refreshMessage.set('');
    await this.controller.refresh();
    if (this.disposed || epoch !== this.refreshEpoch || context !== this.contextKey() || requested !== this.params().get('orderUuid')) return;
    const after = this.progressKey(this.controller.state);
    if (after !== null && after !== before) this.refreshMessage.set('Order progress updated.');
  }
  selectOrder(event: Event): void {
    if (this.action().busy) return;
    const orderUuid = (event.target as HTMLSelectElement).value;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { orderUuid: orderUuid || null }, queryParamsHandling: 'merge' });
  }
  prepare(action: OrderAction): void {
    if (this.commands.prepare(action)) {
      const active = this.host.nativeElement.ownerDocument.activeElement;
      this.opener = active instanceof HTMLElement && this.host.nativeElement.contains(active) ? active : null;
      queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>('.order-review')?.focus());
    }
  }
  cancel(): void {
    this.commands.cancel();
    if (this.opener?.isConnected) queueMicrotask(() => this.opener?.focus()); else this.focusSection();
  }
  async confirm(): Promise<void> {
    this.refreshEpoch++; this.refreshMessage.set('');
    await this.commands.confirm();
    if (this.action().result) await this.controller.refresh();
    this.focusSection();
  }
  private focusSection(): void { queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>('.order-notice, .order-actions-heading')?.focus()); }
  appointmentSlots(value: Pick<OrderAppointment, 'offeredSlots'>, permittedIds: readonly string[]): readonly OfferedSlot[] {
    const permitted = new Set(permittedIds);
    return value.offeredSlots.filter((slot) => permitted.has(slot.slotId));
  }
  returnSlots(value: Pick<OrderReturnPlan, 'offeredSlots'>, choiceId: string, permitted: readonly { readonly choiceId: string; readonly slotIds: readonly string[] }[]): readonly OfferedSlot[] {
    const ids = permitted.find((choice) => choice.choiceId === choiceId)?.slotIds;
    if (!ids?.length) return [];
    const allowed = new Set(ids);
    return (value.offeredSlots[choiceId] ?? []).filter((slot) => allowed.has(slot.slotId));
  }
  returnPicker(choiceId: string): (slot: OfferedSlot) => void {
    let picker = this.returnPickers.get(choiceId);
    if (!picker) {
      picker = (slot) => this.pickReturn(choiceId, slot);
      this.returnPickers.set(choiceId, picker);
    }
    return picker;
  }
  private pickAppointment(slot: OfferedSlot): void {
    const p = this.model(); const a = p?.appointment.state === 'ok' ? p.appointment.value : null;
    if (!p || !a || !p.actions.appointment.requestSlotIds.includes(slot.slotId)
      || !a.offeredSlots.some((offered) => offered.slotId === slot.slotId) || !this.canAct('appointment')) return;
    this.prepare({ kind: 'request-appointment', slotId: slot.slotId });
  }
  private pickReturn(choiceId: string, slot: OfferedSlot): void {
    const p = this.model(); const r = p?.returnPlan.state === 'ok' ? p.returnPlan.value : null;
    const action = p?.actions.returnPlan.choices.find((choice) => choice.choiceId === choiceId);
    if (!p || !r || !action?.slotIds.includes(slot.slotId)
      || !r.choices.some((choice) => choice.id === choiceId && choice.available)
      || !r.offeredSlots[choiceId]?.some((offered) => offered.slotId === slot.slotId) || !this.canAct('return')) return;
    this.prepare({ kind: 'request-return', choice: choiceId, slotId: slot.slotId });
  }
  appointmentState(value: OrderAppointment): string {
    if (value.state === 'scheduled' && value.booked) return 'Handover booked';
    if (value.state === 'completed') return dated('Handover complete', value.outcome?.['at']);
    if (value.state === 'no-show') return dated('Handover missed', value.slot?.start);
    return this.words(value.state);
  }
  appointmentDetail(value: OrderAppointment): string | null {
    if (value.state === 'scheduled' && value.booked) return when('Booked for', value.slot);
    if (value.state === 'change-proposed') return `${when('New time proposed:', value.proposedSlot)}. Not booked yet.`;
    if (value.state === 'requested' || value.state === 'scheduled') return `${when('Requested', value.requestedSlot)}. Not booked yet.`;
    return null;
  }
  earlierMissed(value: OrderAppointment): string | null {
    const previous = value['previousAttempts'];
    if (typeof value['attempt'] !== 'number' || value['attempt'] <= 1 || !Array.isArray(previous)) return null;
    const missed = previous.filter((row) => row && typeof row === 'object' && (row as EvidenceRecord)['state'] === 'no-show').at(-1);
    const slot = missed && typeof missed === 'object' ? (missed as EvidenceRecord)['slot'] : null;
    const start = slot && typeof slot === 'object' ? (slot as EvidenceRecord)['start'] : undefined;
    return missed ? dated('Earlier handover missed', start) : null;
  }
  historyEvents(history: readonly EvidenceRecord[] | undefined, forReturn = false): readonly TimelineEvent[] {
    const labels = forReturn ? returnHistoryLabels : handoverHistoryLabels;
    return (history ?? []).map((row, index) => {
      const state = row['appointmentState'] ?? row['state'];
      const key = typeof state === 'string' ? state : '';
      return { id: `${String(state)}-${index}`, occurredAt: typeof row['at'] === 'string' ? row['at'] : null,
        label: labels[key] ?? 'Update recorded' };
    });
  }
  returnState(value: OrderReturnPlan): string {
    if (value.state === 'returned') return dated('Returned', value.outcome?.['at']);
    if (value.state === 'return-missed') {
      const direct = this.recordSlot(value['slot']);
      const outcome = value.outcome?.['appointment'];
      const nested = outcome && typeof outcome === 'object' ? this.recordSlot((outcome as EvidenceRecord)['slot']) : null;
      return dated('Return missed', direct?.start ?? nested?.start);
    }
    return this.words(value.state || 'Not planned');
  }
  returnDetail(value: OrderReturnPlan): string | null {
    if (value.state === 'return-scheduled' && value.scheduled) return when('Return booked:', this.recordSlot(value['slot']));
    if (value.state === 'return-requested' && value.appointment?.state === 'change-proposed')
      return `${when('New return time proposed:', value.proposedSlot)}. Not booked yet.`;
    if (value.state === 'return-requested') return `${when('Return requested', this.recordSlot(value['requestedSlot']))}. Not booked yet.`;
    return null;
  }
  private recordSlot(value: unknown): OfferedSlot | null { return value && typeof value === 'object' ? value as OfferedSlot : null; }
  returnActionLabel(choiceId: string): string { return choiceId === 'same-visit' ? 'Request return at handover,' : 'Request return'; }
  private handoverStep(appointment: OrderAppointment | null): StageTrackerItem {
    const step: StageTrackerItem = { label: 'Handover booked', state: 'upcoming' };
    if (!appointment) return step;
    const booked = appointment.state === 'scheduled' && appointment.booked === true;
    if (appointment.state === 'not-requested') return step;
    if (booked) return { ...step, state: 'done', note: when('Booked for', appointment.slot) };
    if (appointment.state === 'completed') return { ...step, state: 'done', note: dated('Handover complete', appointment.outcome?.['at']) };
    if (appointment.state === 'no-show') return { ...step, state: 'current', note: dated('Handover missed', appointment.slot?.start) };
    if (appointment.state === 'requested' || appointment.state === 'scheduled') {
      return { ...step, state: 'current', note: `${when('Requested', appointment.requestedSlot)}. Not booked yet.` };
    }
    if (appointment.state === 'change-proposed') {
      return { ...step, state: 'current', note: `${when('New time proposed:', appointment.proposedSlot)}. Not booked yet.` };
    }
    return step;
  }
  signIn(): void { this.commands.contextChanged(); this.controller.contextChanged(); void this.auth.signIn(safeReturnTo('/gcsp' + this.router.url)); }
  imageFailed(): void { this.failedImage.set(this.model()?.selection.order?.orderUuid ?? null); }
  ngOnDestroy(): void { this.stopLiveRefresh(); this.disposed = true; this.refreshEpoch++; this.commands.dispose(); this.controller.dispose(); }
  shown(value: unknown): string { return typeof value === 'string' || typeof value === 'number' ? String(value) : ''; }
  words(value: string): string { return value.replace(/[-_]/g, ' ').replace(/^./, (letter) => letter.toUpperCase()); }
  owner(value: string | null | undefined): string { return value === 'employee' ? 'You' : this.words(value ?? '') || 'Not supplied'; }
  time(value: unknown): string {
    return typeof value === 'string' && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : 'Time not supplied';
  }
  slot(slot: OfferedSlot | null | undefined): string { return slot ? this.time(slot.start) : 'Time not supplied'; }
  ownership(value: OwnedStep): readonly FactRow[] { return [{ label: 'Owner', value: this.owner(value.owner) }, { label: 'Next step', value: value.nextStep }]; }
  sectionMessage(section: ProducerSection<unknown, unknown>): string {
    if (section.state === 'not-loaded') return this.state()?.phase === 'loading' ? 'Loading…' : 'Details not supplied.';
    if (section.state === 'not-open') return 'Documents and checks open once your order is sent to ordering.';
    if (section.state === 'identity-mismatch') return 'These details could not be matched to your order.';
    return this.failureMessage(section.envelope);
  }
  failureMessage(result: LifecycleResult<unknown> | null | undefined): string {
    if (!result) return 'Loading…'; if (result.status === 'ok') return '';
    if (result.status === 'pending' || result.status === 'uncertain') return result.reason || 'Waiting for provider confirmation.';
    if (result.status === 'forbidden') return 'These details are not available to you.';
    if (result.status === 'authentication-required' || result.status === 'unauthenticated') return 'Sign in again to read these details.';
    return result.reason || `${this.words(result.status)}. Refresh to check the latest status.`;
  }
  fact(record: unknown, name: string): string { return this.shown(record && typeof record === 'object' ? (record as EvidenceRecord)[name] : undefined); }
  canAct(resource: 'documents' | 'appointment' | 'return'): boolean {
    return !this.busy() && !this.action().review && !this.action().result && !this.commands.locked(resource);
  }
}
