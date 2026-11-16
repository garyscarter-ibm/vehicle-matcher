import { Component, computed, effect, ElementRef, inject, OnDestroy, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthPort } from '../auth/auth.port';
import { safeReturnTo } from '../auth/route-policy';
import type { EvidenceRecord } from '../account/account.types';
import { ButtonDirective } from '../kit/button.directive';
import { FactListComponent, FactRow } from '../kit/fact-list.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { OrdersActions, OrdersActionState, OrderAction } from './orders.actions';
import { OrdersClient } from './orders.client';
import { OrdersController, OrdersControllerState } from './orders.controller';
import type { LifecycleResult, OfferedSlot, OwnedStep, ProducerSection } from './orders.types';
import type { OrdersReadContext } from './orders.read-port';

const contextKey = (c: OrdersReadContext | null): string | null => c
  ? JSON.stringify([c.subject, c.environmentId, c.runId, c.employeeId, c.employeeAuthority]) : null;

@Component({
  selector: 'gcsp-orders',
  imports: [RouterLink, ButtonDirective, FactListComponent, LabelledFieldComponent, ScreenIntroComponent, StatusScreenComponent],
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
  private readonly controller = new OrdersController(this.client, () => this.client.context(), (state) => this.state.set(state));
  private readonly commands = new OrdersActions(this.client, () => this.controller.state, () => this.client.context(), (state) => this.action.set(state));
  readonly model = computed(() => this.contextKey() && this.state()?.context
    && contextKey(this.state()!.context) === this.contextKey() ? this.state()!.projection : null);
  readonly orders = computed(() => { const s = this.state(); return this.model() && s?.orders?.status === 'ok' ? s.orders.value.orders : []; });
  readonly busy = computed(() => this.action().busy || this.state()?.phase === 'loading');
  readonly photo = computed(() => { const p = this.model(); return p?.selection.order?.orderUuid !== this.failedImage() ? p?.vehicle?.photo : undefined; });
  readonly stageRows = computed(() => {
    const p = this.model(); const stages = p?.stages.value;
    const rows = (stages?.stages ?? []).map((step) => ({ label: this.words(step.stage), state: this.words(step.state), at: step.at,
      current: step.stage === stages?.currentStage, complete: step.state === 'approved', failed: step.state === 'declined' }));
    if (stages && !stages.stages.some((step) => step.stage.toLowerCase() === 'handover')) {
      const a = p?.appointment.value; const d = p?.documents.value;
      rows.push({ label: 'Handover booked', state: a?.booked ? 'Booked' : a && a.state !== 'not-requested' ? this.words(a.state) : 'Not started',
        at: null, current: false, complete: a?.booked === true, failed: false });
      rows.push({ label: 'Ready for handover', state: d ? d.readiness.ready ? 'Ready' : 'Not ready' : 'Not supplied',
        at: null, current: false, complete: d?.readiness.ready === true, failed: false });
    }
    return rows;
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
  constructor() {
    effect(() => {
      const context = this.contextKey(); const order = this.params().get('orderUuid') ?? undefined;
      untracked(() => { this.commands.contextChanged(); this.controller.contextChanged(); this.failedImage.set(null); if (context) void this.controller.load(order); });
    });
  }
  refresh(): void {
    if (this.action().busy) return;
    this.commands.refreshing(); void this.controller.refresh();
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
    await this.commands.confirm();
    if (this.action().result) await this.controller.refresh();
    this.focusSection();
  }
  private focusSection(): void { queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>('.order-notice, .order-actions-heading')?.focus()); }
  signIn(): void { this.commands.contextChanged(); this.controller.contextChanged(); void this.auth.signIn(safeReturnTo('/gcsp' + this.router.url)); }
  imageFailed(): void { this.failedImage.set(this.model()?.selection.order?.orderUuid ?? null); }
  ngOnDestroy(): void { this.commands.dispose(); this.controller.dispose(); }
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
