import { ChangeDetectorRef, Component, ElementRef, OnDestroy, computed, inject, viewChild } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { DataTableComponent, DataTableColumn, DataTableRow } from '../kit/data-table.component';
import { ErrorSummaryComponent } from '../kit/error-summary.component';
import { FactListComponent } from '../kit/fact-list.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { carOptionNames, caseNotice, caseTime } from './case.projection';
import { CaseQueueStore, QueueDraft } from './case-queue.store';

let serial = 0;
@Component({
  selector: 'gcsp-case-queue',
  imports: [ButtonDirective, DataTableComponent, ErrorSummaryComponent, FactListComponent, LabelledFieldComponent, ScreenIntroComponent, StatusScreenComponent],
  providers: [CaseQueueStore], templateUrl: './case-queue.component.html', styleUrl: './case-queue.component.css',
})
export class CaseQueueComponent implements OnDestroy {
  readonly store = inject(CaseQueueStore);
  readonly view = this.store.view;
  readonly id = `gcsp-cases-${++serial}`;
  readonly notice = caseNotice;
  readonly time = (value: string) => caseTime(value, 'scheme-team');
  readonly columns: readonly DataTableColumn[] = [
    { key: 'employee', label: 'Employee' }, { key: 'deadline', label: 'Renewal deadline (calendar date)' },
    { key: 'trigger', label: 'Opened from' }, { key: 'reason', label: 'Reason' }, { key: 'status', label: 'Status' },
    { key: 'owner', label: 'Owner' }, { key: 'due', label: 'Due (UTC)' },
  ];
  readonly rows = computed<readonly DataTableRow[]>(() => this.view().rows.map(row => ({ id: row.caseId, label: row.employee || row.reference,
    cells: { employee: `${row.employee} · ${row.reference}`, deadline: row.source.renewalDeadline || 'Needs confirmation',
      trigger: row.facts.find(f => f.label === 'Opened from')?.value || 'Not supplied', reason: row.source.reason,
      status: row.status, owner: row.owner, due: caseTime(row.source.dueAt, 'scheme-team') } })));
  readonly errors = computed(() => Object.entries(this.view().errors).map(([field, message]) => ({ controlId: this.control(field), message })));
  readonly textFields = [{ key: 'reason' as const, label: 'Reason for this update' }, { key: 'nextAction' as const, label: 'Next action' }];
  readonly needsConfirmation = computed(() => {
    const cars = this.view().options?.options.alternativeCars.needsConfirmation || [];
    return carOptionNames(cars).map((name, i) => `${name}: ${cars[i].unknowns?.map(String).join(', ') || 'suitability needs confirmation'}`);
  });
  readonly reviewFacts = computed(() => {
    const input = this.view().review?.input;
    if (!input) return [];
    const remedy = input.remedy;
    return [{ label: 'Case reference', value: this.view().detail?.reference || input.caseId },
      { label: 'Employee', value: this.view().detail?.employee || 'See selected case' },
      { label: 'Status', value: this.store.statusLabel(input.status) }, { label: 'Reason', value: input.reason },
      { label: 'Next action', value: input.nextAction }, { label: 'Due (UTC)', value: this.time(input.dueAt) },
      { label: 'Remedy', value: remedy?.type === 'manual-decision' ? `Manual decision: ${remedy.decision}`
        : remedy?.type === 'contract-extension' ? `Contract extension until ${remedy.until}`
        : remedy?.type === 'later-release' ? `Later release: ${this.time(remedy.releaseAt)}; source: ${remedy.source}`
        : remedy?.type === 'alternative-car' ? `${this.store.choices().find(c => typeof c.remedy === 'object' && c.remedy.type === 'alternative-car' && c.remedy.orderUuid === remedy.orderUuid)?.label || 'Alternative car'}; exact reference: ${remedy.orderUuid}`
        : 'Keep the current recorded remedy' }];
  });
  private readonly table = viewChild(DataTableComponent);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly detector = inject(ChangeDetectorRef);
  private destroyed = false;
  control(field: string): string { return `${this.id}-${field}`; }
  described(field: keyof QueueDraft): string | null { return this.view().errors[field] ? `${this.control(field)}-error` : null; }
  edit(field: keyof QueueDraft, event: Event): void { this.store.edit(field, (event.target as HTMLInputElement).value); }
  async open(caseId: string): Promise<void> {
    const result = this.store.open(caseId); this.focus('[data-case-status]');
    if (await result) this.focus(this.view().detail ? '[data-case-heading]' : '[data-case-status]');
  }
  close(): void {
    const selected = this.view().selected; this.store.close(); this.detector.detectChanges();
    if (selected && !this.view().selected && !this.table()?.focusRow(selected)) this.focus('[data-case-status]');
  }
  review(event: Event): void {
    event.preventDefault(); this.store.review();
    this.focus(this.view().review ? '[data-case-review]' : 'gcsp-error-summary section');
  }
  cancelReview(): void { this.store.cancelReview(); this.focus('[data-case-editor] select'); }
  async perform(action: 'refresh' | 'refreshOptions' | 'confirm' | 'retry'): Promise<void> {
    const result = this.store[action](); this.focus('[data-case-status]');
    if (await result) this.focus('[data-case-status]');
  }
  ngOnDestroy(): void { this.destroyed = true; this.store.dispose(); }
  private focus(selector: string): void {
    if (this.destroyed) return;
    this.detector.detectChanges(); this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}
