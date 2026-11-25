import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, Injector, input, signal, untracked } from '@angular/core';
import { AuthPort, SessionState } from '../auth/auth.port';
import { GregOrders } from '../greg-planning/greg-orders.model';
import { ButtonDirective } from '../kit/button.directive';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { PresenterClient } from './presenter.client';
import { PresenterCommand, PresenterCommandValue, PresenterProductionInput, PresenterResult } from './presenter.types';

@Component({ selector: 'gcsp-production-controls', imports: [ButtonDirective, LabelledFieldComponent], template: `
  <section class="gcsp gcsp-orders gcsp-panel" aria-labelledby="presenter-production-heading" [attr.aria-busy]="pending() || reading()">
    <div class="gcsp-orders-header"><h2 id="presenter-production-heading">Production controls</h2>
      <button gcspButton variant="ghost" type="button" [disabled]="!permitted() || pending() || reading()" (click)="refresh()">Refresh Production requests</button></div>
    <p role="status" aria-live="polite" tabindex="-1" data-production-control-result>{{ notice() }}</p>
    @if (projection(); as value) {
      @if (value.providerMode === 'synthetic' && value.providerStatus === 'available') {
        <form class="gcsp-orders-form" (submit)="save($event)"><div class="gcsp-orders-fields">
          <gcsp-labelled-field controlId="presenter-production-request" label="Request"><select id="presenter-production-request" required [value]="selected()?.requestId ?? ''" [disabled]="locked() || !requests().length" (change)="requestId.set(text($event))">
            @for (request of requests(); track request.requestId) { <option [value]="request.requestId">{{ request.model }} {{ request.derivative }}: {{ request.outstandingQuantity }} outstanding</option> }
          </select></gcsp-labelled-field>
          <gcsp-labelled-field controlId="presenter-production-action" label="Production response"><select id="presenter-production-action" [value]="action()" [disabled]="locked() || !requests().length" (change)="action.set(text($event) === 'delay' ? 'delay' : 'confirm')"><option value="confirm">Confirm now</option><option value="delay">Delay outstanding quantity</option></select></gcsp-labelled-field>
          @if (action() === 'confirm') {
            <gcsp-labelled-field controlId="presenter-production-quantity" label="Quantity to confirm"><input id="presenter-production-quantity" type="number" min="1" [max]="selected()?.outstandingQuantity ?? 1" step="1" required [value]="quantity()" [disabled]="locked() || !requests().length" (input)="quantity.set(text($event))" /></gcsp-labelled-field>
          } @else {
            <gcsp-labelled-field controlId="presenter-production-date" label="Delay until"><input id="presenter-production-date" type="date" required [value]="delayUntil()" [disabled]="locked() || !requests().length" (input)="delayUntil.set(text($event))" /></gcsp-labelled-field>
            <gcsp-labelled-field controlId="presenter-production-reason" label="Delay reason"><input id="presenter-production-reason" type="text" maxlength="500" required [value]="reason()" [disabled]="locked() || !requests().length" (input)="reason.set(text($event))" /></gcsp-labelled-field>
          }
        </div><button gcspButton type="submit" [disabled]="locked() || !selected()">Save production response</button></form>
        @if (!requests().length) { <p class="gcsp-note">No outstanding Production requests.</p> }
      } @else { <p class="gcsp-note">Production responses are unavailable for the current provider.</p> }
    }
    @if (retained() && permitted()) { <button gcspButton variant="ghost" type="button" [disabled]="pending() || reading()" (click)="retry()">Retry same production response</button> }
  </section>`, styles: [':host { display:block; min-width:0; } [data-production-control-result]:focus { outline:3px solid var(--gcsp-focus, var(--gcsp-accent)); outline-offset:3px; }'] })
export class ProductionControlsComponent {
  readonly active = input(true);
  private readonly auth = inject(AuthPort); private readonly client = inject(PresenterClient);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef); private readonly injector = inject(Injector);
  private readonly owner = signal<string | null>(null); private readonly value = signal<GregOrders | null>(null);
  readonly scope = computed(() => { const state = this.auth.state(); return state.status === 'ready' && state.context.roles.includes('presenter')
    ? JSON.stringify([state.context.subject, state.context.environmentId, state.context.runId]) : null; });
  readonly permitted = computed(() => !!this.scope());
  readonly projection = computed(() => this.scope() && this.scope() === this.owner() ? this.value() : null);
  readonly requests = computed(() => this.projection()?.requests.filter(r => r.outstandingQuantity > 0) ?? []);
  readonly requestId = signal(''); readonly action = signal<'confirm' | 'delay'>('confirm'); readonly quantity = signal('1');
  readonly delayUntil = signal(''); readonly reason = signal('');
  readonly selected = computed(() => this.requests().find(r => r.requestId === this.requestId()) ?? this.requests()[0] ?? null);
  readonly pending = signal(false); readonly reading = signal(false);
  private readonly command = signal<PresenterCommand | null>(null);
  readonly retained = computed(() => this.scope() && this.scope() === this.owner() ? this.command() : null);
  readonly locked = computed(() => !this.active() || !this.permitted() || this.pending() || this.reading() || !!this.retained());
  private readonly noticeValue = signal('Loading Production requests.');
  readonly notice = computed(() => this.permitted() ? this.noticeValue() : 'A current presenter login is required.');
  private controller = new AbortController(); private generation = 0; private readEpoch = 0;
  private session: SessionState | null = null; private destroyed = false; private reprepare = false;
  constructor() {
    effect(() => { const state = this.auth.state(); const active = this.active(); untracked(() => {
      if (state === this.session) { if (active) void this.refresh(); } else this.changeSession(state, active);
    }); });
    inject(DestroyRef).onDestroy(() => { this.destroyed = true; this.generation++; this.controller.abort(); });
  }
  private changeSession(state: SessionState, active: boolean): void {
    if (state === this.session) return; this.session = state; this.generation++; this.controller.abort(); this.controller = new AbortController();
    this.value.set(null); this.pending.set(false); this.reading.set(false);
    const scope = this.scope();
    if (state.status === 'signed-out' || state.status === 'denied' || state.status === 'ready' && !scope) {
      this.owner.set(null); this.command.set(null); this.clearFields(); return;
    }
    if (!scope) return;
    if (scope !== this.owner()) { this.owner.set(scope); this.command.set(null); this.clearFields(); }
    else if (this.command()) this.reprepare = true;
    this.noticeValue.set(this.command() ? 'The earlier response is retained. Deliberately retry the same response if still intended.' : 'Loading Production requests.');
    if (active) void this.refresh();
  }
  private clearFields(): void { this.requestId.set(''); this.action.set('confirm'); this.quantity.set('1'); this.delayUntil.set(''); this.reason.set(''); this.reprepare = false; }
  text(event: Event): string { return (event.target as HTMLInputElement).value; }
  async refresh(): Promise<void> {
    if (!this.permitted() || this.pending() || this.destroyed) return;
    const generation = this.generation; const epoch = ++this.readEpoch; this.reading.set(true);
    try { const result = await this.client.readProduction({ signal: this.controller.signal });
      if (this.destroyed || generation !== this.generation || epoch !== this.readEpoch) return;
      this.value.set(result.state === 'ready' ? result.value : null);
      if (result.state !== 'ready') this.noticeValue.set(this.problem(result));
      else if (!this.command() && this.noticeValue() === 'Loading Production requests.') this.noticeValue.set('Production requests up to date.');
    } catch { if (generation === this.generation) { this.value.set(null); this.noticeValue.set('Production requests could not be loaded. Refresh to retry.'); } }
    finally { if (generation === this.generation && epoch === this.readEpoch) this.reading.set(false); }
  }
  async save(event: SubmitEvent): Promise<void> {
    event.preventDefault(); if (this.locked() || !(event.target as HTMLFormElement).reportValidity()) return;
    const selected = this.selected(); if (!selected) return;
    const base = { commandId: globalThis.crypto.randomUUID(), requestId: selected.requestId, expectedVersion: selected.version };
    const input: PresenterProductionInput = this.action() === 'confirm' ? { ...base, action: 'confirm', quantity: Number(this.quantity()) }
      : { ...base, action: 'delay', delayUntil: `${this.delayUntil()}T00:00:00.000Z`, reason: this.reason() };
    const prepared = this.client.prepareProduction(input);
    if ('state' in prepared) { this.noticeValue.set('Check the Production response and try again.'); this.focus(); return; }
    await this.send(prepared);
  }
  async retry(): Promise<void> {
    let command = this.retained(); if (!command || command.kind !== 'production' || this.pending() || this.reading()) return;
    if (this.reprepare) { const prepared = this.client.prepareProduction(command.input);
      if ('state' in prepared) { this.noticeValue.set('Refresh your presenter sign-in before retrying.'); return; }
      command = prepared; this.reprepare = false;
    }
    await this.send(command);
  }
  private async send(command: PresenterCommand): Promise<void> {
    const generation = this.generation; this.command.set(command); this.pending.set(true); this.noticeValue.set('Saving Production response.');
    let result: PresenterResult<PresenterCommandValue>;
    try { result = await this.client.submit(command, { signal: this.controller.signal }); }
    catch { result = { state: 'failed', value: null, problem: 'transport-unavailable', writeOutcome: 'unknown' }; }
    if (this.destroyed || generation !== this.generation) return;
    this.pending.set(false);
    if (result.state === 'ready') {
      const outcome = 'requests' in result.value && command.kind === 'production'
        ? result.value.requests.find(r => r.requestId === command.input.requestId)?.outcome : null;
      const settled = outcome !== null && outcome !== undefined && ['applied', 'unchanged', 'closed'].includes(outcome);
      if (settled) this.command.set(null);
      this.noticeValue.set(settled ? 'Production response saved. Refreshing its status.' : 'Production has not settled the response. Deliberately retry the same response to continue.');
      await this.refresh();
      if (this.destroyed || generation !== this.generation) return;
      if (settled && command.kind === 'production') this.noticeValue.set(this.projection()?.requests.find(r => r.requestId === command.input.requestId)?.message
        ?? 'Production response saved. Current request status is unavailable; refresh to check it.');
    }
    else { this.noticeValue.set(this.problem(result));
      if (result.writeOutcome !== 'unknown' && !(result.state === 'refused' && ['pending', 'unavailable'].includes(result.refusal.status))) this.command.set(null);
      if (!this.command()) await this.refresh();
    }
    if (!this.destroyed && generation === this.generation) this.focus();
  }
  private problem(result: PresenterResult<unknown>): string { return result.state === 'refused' ? result.refusal.reason
    : result.writeOutcome === 'unknown' ? 'The Production outcome is not known. Deliberately retry the same response to continue.'
    : 'Production is unavailable. Refresh your sign-in and requests before trying again.'; }
  private focus(): void { afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('[data-production-control-result]')?.focus(), { injector: this.injector }); }
}
