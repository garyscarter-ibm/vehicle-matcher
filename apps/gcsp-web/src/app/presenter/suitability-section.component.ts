import { ChangeDetectorRef, Component, ElementRef, OnDestroy, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { DataTableColumn, DataTableComponent, DataTableRow } from '../kit/data-table.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { LoadingSkeletonComponent } from '../kit/loading-skeleton.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { friendlyTime } from '../kit/friendly-time';
import { reasonText, words } from '../preferences/brief.copy';
import { PresenterClient } from './presenter.client';
import { PresenterControls } from './presenter.types';
import { PresenterSuitability, SuitabilityCar, SuitabilityCell, SuitabilityEvidence } from './presenter.projections';

let sequence = 0;
@Component({ selector: 'gcsp-presenter-suitability', host: { style: 'display: contents' }, imports: [ButtonDirective, DataTableComponent, LabelledFieldComponent, LoadingSkeletonComponent, StatusScreenComponent], templateUrl: './suitability-section.component.html' })
export class SuitabilitySectionComponent implements OnDestroy {
  readonly controls = input.required<PresenterControls>(); readonly busy = input(false);
  readonly id = `gcsp-suitability-${++sequence}`; readonly opened = signal(false);
  readonly value = signal<PresenterSuitability | null>(null); readonly reading = signal(false); readonly failed = signal(false);
  readonly release = signal<'all' | 'latest'>('all'); readonly selected = signal<{ car: string; buddy: string } | null>(null);
  readonly columns = computed<readonly DataTableColumn[]>(() => [{ key: 'car', label: 'Released car' }, ...this.value()?.buddies.map(buddy => ({ key: buddy.id, label: buddy.name, detail: `Brief ${buddy.briefVersion}` })) ?? []]);
  readonly rows = computed<readonly DataTableRow[]>(() => this.value()?.cars.map(car => ({ id: car.id, label: car.name, cells: { car: car.name } })) ?? []);
  readonly inspected = computed(() => { const selected = this.selected(); const value = this.value(); if (!selected || !value) return null; const car = value.cars.find(row => row.id === selected.car); const buddy = value.buddies.find(row => row.id === selected.buddy); const cell = car?.cells.find(row => row.employeeId === selected.buddy); return car && buddy && cell ? { car, buddy, cell } : null; });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef); private readonly detector = inject(ChangeDetectorRef);
  private readonly client = inject(PresenterClient); private abort: AbortController | null = null; private generation = 0;
  private page = 1; private buddyPage = 1; private run: string | null = null; private destroyed = false;
  constructor() { effect(() => { const controls = this.controls(); const busy = this.busy(); untracked(() => {
    this.abort?.abort(); this.generation++; this.reading.set(false); this.value.set(null);
    if (this.run !== controls.runId) { this.run = controls.runId; this.page = this.buddyPage = 1; this.release.set('all'); this.selected.set(null); this.opened.set(false); }
    if (!busy && this.opened()) void this.refresh();
  }); }); }
  toggle(event: Event): void { const open = (event.target as HTMLDetailsElement).open; this.opened.set(open); if (open && !this.value() && !this.busy()) void this.refresh(); }
  changeRelease(event: Event): void { this.release.set((event.target as HTMLSelectElement).value === 'latest' ? 'latest' : 'all'); this.page = this.buddyPage = 1; this.selected.set(null); void this.refresh(); }
  async refresh(): Promise<void> {
    if (this.destroyed || this.busy() || this.reading() || !this.opened()) return;
    this.abort?.abort(); const abort = new AbortController(); this.abort = abort; const generation = ++this.generation;
    this.reading.set(true); this.failed.set(false);
    const result = await this.client.readSuitability(this.page, this.buddyPage, this.release(), { signal: abort.signal }).catch(() => ({ state: 'failed' as const, value: null, problem: 'suitability-unavailable' }));
    if (this.destroyed || abort.signal.aborted || generation !== this.generation) return;
    this.reading.set(false);
    if (result.state !== 'ready' || result.value.runId !== this.controls().runId) { this.value.set(null); this.selected.set(null); this.failed.set(true); return; }
    this.value.set(result.value); this.page = result.value.paging.cars.page; this.buddyPage = result.value.paging.buddies.page;
    if (!this.inspected()) this.selected.set(null);
  }
  async turn(axis: 'cars' | 'buddies', amount: number): Promise<void> { const meta = this.value()?.paging[axis]; if (!meta || this.reading()) return; const page = meta.page + amount; if (page < 1 || page > meta.pages) return; if (axis === 'cars') this.page = page; else this.buddyPage = page; this.selected.set(null); await this.refresh();
    if (this.destroyed) return;
    this.detector.detectChanges(); const button = this.host.nativeElement.querySelector<HTMLButtonElement>(`[data-page-action="${axis}-${amount < 0 ? 'Previous' : 'Next'}"]`);
    const target = button?.disabled ? button.parentElement?.querySelector<HTMLElement>('button:not(:disabled)') ?? this.host.nativeElement.querySelector<HTMLElement>('[role="region"]') : button;
    target?.focus();
  }
  car(row: DataTableRow): SuitabilityCar { return this.value()!.cars.find(car => car.id === row.id)!; }
  cell(row: DataTableRow, column: DataTableColumn): SuitabilityCell { return this.car(row).cells.find(cell => cell.employeeId === column.key)!; }
  passed(cell: SuitabilityCell): boolean { return cell.gateStatus === 'eligible' && !cell.blockers?.length; }
  score(cell: SuitabilityCell): string { return cell.state === 'evaluated' && this.passed(cell) && cell.score !== null && cell.score !== undefined ? `${cell.score}/100` : '–'; }
  check(cell: SuitabilityCell): string { return cell.state !== 'evaluated' ? 'Not evaluated' : cell.blockers?.length || cell.gateStatus === 'ineligible' ? 'Blocked' : cell.gateStatus === 'needs-confirmation' ? 'Needs confirmation' : cell.score === null ? 'Passed · unscored' : 'Passed checks'; }
  person(id: string | undefined): string { return [...this.value()?.buddies ?? [], ...this.value()?.people ?? []].find(person => person.id === id)?.name ?? 'another employee'; }
  status(cell: SuitabilityCell): string { if (cell.state === 'evaluated' && this.passed(cell) && cell.outcome?.state === 'assigned') return cell.outcome.employeeId === cell.employeeId ? 'Matched in this check' : `Matched to ${this.person(cell.outcome.employeeId)}`; return this.check(cell); }
  select(row: DataTableRow, column: DataTableColumn): void { this.selected.set({ car: row.id, buddy: column.key }); }
  pressed(row: DataTableRow, column: DataTableColumn): boolean { return this.selected()?.car === row.id && this.selected()?.buddy === column.key; }
  availability(car: SuitabilityCar): string { return car.availability.state === 'available' ? 'Available' : car.availability.state === 'reserved' ? 'Reserved' : car.availability.state === 'allocated' ? 'Allocated' : 'Unavailable'; }
  carNow(car: SuitabilityCar): string { const current = car.availability; return current.state === 'available' ? 'Available on the scheme.' : ['reserved', 'allocated'].includes(current.state) ? `${current.state === 'reserved' ? 'Reserved for' : 'Allocated to'} ${current.employeeName ?? 'another employee'}${current.route === 'manual' ? ' through a manual selection' : ' through Buddy'}.` : 'Currently unavailable.'; }
  order(rule: string | null | undefined): string { return ({ renewalDueThenFitThenSeededLottery: 'Earlier renewal date, then better fit, then a repeatable draw to break a tie.', fitThenRenewalDueThenSeededLottery: 'Better fit, then earlier renewal date, then a repeatable draw to break a tie.' } as Record<string, string>)[rule ?? ''] ?? 'The allocation order is not available.'; }
  explanation(entry: SuitabilityEvidence, kind: string): string {
    if (entry.code === 'declined-unchanged') return 'This car was declined and the brief has not changed.';
    if (entry.code === 'renewal-deadline-unknown') return 'The renewal date is not confirmed, so this Buddy could not enter the allocation.';
    const text = reasonText(entry, kind).replace(/\bYour\b/g, 'The employee’s').replace(/\byour\b/g, 'the employee’s').replace(/\bYou are\b/g, 'The employee is').replace(/\bYou have\b/g, 'The employee has').replace(/\bYou do not have\b/g, 'The employee does not have');
    const requirement = entry.requirement; if (requirement?.value === undefined) return text;
    const operator = ({ atLeast: 'at least', gte: 'at least', min: 'at least', eq: 'is', in: 'one of', lte: 'at most', atMost: 'at most' } as Record<string, string>)[requirement.operator ?? ''] ?? '';
    return `${text} ${words(entry.field)} ${operator} ${[requirement.value].flat().join(', ')}${requirement.unit && requirement.unit !== 'count' ? ` ${requirement.unit}` : ''}.`;
  }
  readonly time = friendlyTime;
  ngOnDestroy(): void { this.destroyed = true; this.generation++; this.abort?.abort(); }
}
