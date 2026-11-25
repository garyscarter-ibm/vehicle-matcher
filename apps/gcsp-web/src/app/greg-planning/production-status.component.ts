import { afterNextRender, Component, computed, effect, ElementRef, inject, Injector, output, signal } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { FactListComponent } from '../kit/fact-list.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { DataTableComponent, DataTableColumn, DataTableRow } from '../kit/data-table.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { PlanningStore } from './planning.store';

@Component({ selector: 'gcsp-production-status', imports: [ButtonDirective, FactListComponent, StatusScreenComponent, DataTableComponent, LabelledFieldComponent],
  templateUrl: './production-status.component.html', styleUrl: './production-status.component.css' })
export class ProductionStatusComponent {
  readonly store = inject(PlanningStore);
  readonly model = signal(''); readonly derivative = signal(''); readonly quantity = signal('1');
  readonly models = computed(() => [...new Set(this.store.orders()?.choices.map(c => c.model) ?? [])]);
  readonly chosenModel = computed(() => this.models().includes(this.model()) ? this.model() : this.models()[0] ?? '');
  readonly derivatives = computed(() => this.store.orders()?.choices.filter(c => c.model === this.chosenModel()).map(c => c.derivative) ?? []);
  readonly chosenDerivative = computed(() => this.derivatives().includes(this.derivative()) ? this.derivative() : this.derivatives()[0] ?? '');
  readonly columns: readonly DataTableColumn[] = [{ key: 'car', label: 'Car' }, { key: 'stage', label: 'Stage' },
    { key: 'requested', label: 'Requested', numeric: true }, { key: 'confirmed', label: 'Confirmed', numeric: true },
    { key: 'released', label: 'Released', numeric: true }, { key: 'timing', label: 'Expected / delayed' }];
  readonly tableRows = computed<readonly DataTableRow[]>(() => this.store.production()?.requests.map(r => {
    const raw = this.store.orders()?.requests.find(o => o.requestId === r.id);
    const quantity = (label: string) => r.facts.find(f => f.label === label)?.value ?? null;
    const timing = raw ? [raw.supplies.length ? `Confirmed: ${raw.supplies.map(s => `${s.quantity} due ${this.date(s.eligibleFrom)}`).join('; ')}` : '',
      raw.delayUntil ? `${raw.outstandingQuantity} delayed until ${this.date(raw.delayUntil)}: ${raw.reason ?? ''}` : ''].filter(Boolean).join('. ') : '';
    return { id: r.id, label: `${r.model} ${r.derivative}`, cells: { car: `${r.model} ${r.derivative}`, stage: r.stage,
      requested: quantity('Requested'), confirmed: quantity('Confirmed'), released: quantity('Released to stock'), timing: timing || r.message || 'Awaiting production response' } };
  }) ?? []);
  readonly queueRequests = computed(() => this.store.orders()?.requests.filter(r => r.supplies.some(s => !s.queued)) ?? []);
  constructor() { effect(() => { this.store.scope(); this.model.set(''); this.derivative.set(''); this.quantity.set('1'); }); }
  text(event: Event): string { return (event.target as HTMLInputElement).value; }
  date(value: string | null): string { return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-GB',
    { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).format(new Date(value)) : 'Date unavailable'; }
  async requestCars(event: SubmitEvent): Promise<void> {
    event.preventDefault(); if (!(event.target as HTMLFormElement).reportValidity()) return;
    await this.store.requestCars(this.chosenModel(), this.chosenDerivative(), this.quantity()); this.focusOutcome();
  }
  readonly replanned = output<void>();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  async replan(): Promise<void> { await this.store.refresh(); this.replanned.emit(); }
  async retry(): Promise<void> { await this.store.retrySubmission(); this.focusOutcome(); }
  focusOutcome(): void { afterNextRender(() => (this.host.nativeElement.querySelector<HTMLElement>('[data-order-result], [data-production-result]')
    ?? this.host.nativeElement.querySelector<HTMLElement>('#production-title'))?.focus(), { injector: this.injector }); }
}
