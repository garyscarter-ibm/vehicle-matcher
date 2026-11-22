import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, computed, inject, input, output } from '@angular/core';
import { ButtonDirective } from './button.directive';

export interface DataTableColumn { readonly key: string; readonly label: string; readonly numeric?: boolean; readonly detail?: string }
export interface DataTableValueObject {
  readonly label?: string | number | boolean | null; readonly isBand?: boolean; readonly fewerThan?: number | null;
  readonly missing?: boolean; readonly emphasis?: boolean; readonly tone?: string; readonly winner?: boolean;
}
export type DataTableValue = string | number | boolean | DataTableValueObject | null | undefined;
export interface DataTableRow { readonly id: string; readonly label: string; readonly cells: Readonly<Record<string, DataTableValue>> }
export interface DataTableRowAction {
  readonly header?: string; readonly label?: string; readonly name?: (row: DataTableRow, index: number) => string | null | undefined;
  readonly onSelect?: (row: DataTableRow, index: number) => void;
  readonly disabled?: boolean | ((row: DataTableRow, index: number) => boolean);
}
interface ReadValue { readonly label: string; readonly isBand: boolean; readonly fewerThan: number | null; readonly missing: boolean }
/** Frozen metric-tile readValue semantics, used by the source table's fillValue contract. */
export function readValue(value: DataTableValue): ReadValue {
  if (value === null || value === undefined || value === '') return { label: 'Not supplied', isBand: false, fewerThan: null, missing: true };
  if (typeof value === 'object') {
    const label = value.label === null || value.label === undefined || value.label === '' ? null : String(value.label);
    if (label === null) return { label: 'Not supplied', isBand: false, fewerThan: null, missing: true };
    const isBand = !!value.isBand;
    return { label, isBand, fewerThan: isBand && Number.isFinite(value.fewerThan) ? value.fewerThan! : null, missing: value.missing === true };
  }
  return { label: typeof value === 'number' ? value.toLocaleString('en-GB') : String(value), isBand: false, fewerThan: null, missing: false };
}
let serial = 0;
/** Source table options with an explicit Angular row envelope; actions are opt-in. */
@Component({ selector: 'gcsp-data-table', imports: [NgTemplateOutlet, ButtonDirective], styleUrl: './data-table.component.css', template: `
  <ng-template #valueContent let-value>@if (value.isBand && value.fewerThan !== null) {<span aria-hidden="true">{{ '<' + value.fewerThan }}</span><span class="gcsp-vh">{{ value.label }}</span>} @else {{{ value.label }}}</ng-template>
  <ng-template #cellContent let-cell>@if (cell.emphasis) {<strong [class.is-success]="cell.tone === 'success'" [class.is-band]="cell.read.isBand" [attr.data-band]="cell.read.isBand ? 'true' : null" [class.is-missing]="cell.read.missing"><ng-container [ngTemplateOutlet]="valueContent" [ngTemplateOutletContext]="{ $implicit: cell.read }" /></strong>} @else {<ng-container [ngTemplateOutlet]="valueContent" [ngTemplateOutletContext]="{ $implicit: cell.read }" />}</ng-template>
  <div class="gcsp-table-wrap" tabindex="0" role="region" [attr.aria-labelledby]="tableId() + '-caption'" [class.is-stack]="stacked()" [class.is-compare]="compare()" [class.has-equal-columns]="equalColumns()">
    <table class="gcsp-table" [id]="tableId()" [attr.role]="stacked() ? 'table' : null"><caption [id]="tableId() + '-caption'" [class]="captionHidden() ? 'gcsp-vh' : 'gcsp-table-caption'">{{ caption() }}</caption>
      <thead [attr.role]="stacked() ? 'rowgroup' : null"><tr [attr.role]="stacked() ? 'row' : null">@for (column of columns(); track column.key; let i = $index) {
        <th class="gcsp-table-th" scope="col" [id]="tableId() + '-col-' + i" [class.is-numeric]="column.numeric" [attr.role]="stacked() ? 'columnheader' : null">{{ column.label }}@if (column.detail) { <span class="gcsp-table-th-sub">{{ column.detail }}</span> }</th>
      }@if (rowAction(); as action) {<th class="gcsp-table-th" scope="col" [id]="tableId() + '-action'" [attr.role]="stacked() ? 'columnheader' : null">{{ action.header ?? 'Action' }}</th>}</tr></thead>
      <tbody [attr.role]="stacked() ? 'rowgroup' : null">@for (view of renderedRows(); track view.row.id; let rowIndex = $index) {
        <tr [attr.role]="stacked() ? 'row' : null">@for (cell of view.cells; track cell.column.key; let i = $index) {
          @if (i === 0) {<th class="gcsp-table-rowhead" scope="row" [id]="tableId() + '-row-' + rowIndex" [attr.headers]="tableId() + '-col-' + i" [class.is-numeric]="cell.column.numeric" [class.is-band]="!cell.emphasis && cell.read.isBand" [attr.data-band]="!cell.emphasis && cell.read.isBand ? 'true' : null" [class.is-missing]="!cell.emphasis && cell.read.missing" [attr.role]="stacked() ? 'rowheader' : null"><ng-container [ngTemplateOutlet]="cellContent" [ngTemplateOutletContext]="{ $implicit: cell }" /></th>}
          @else {<td class="gcsp-table-td" [attr.headers]="tableId() + '-col-' + i + ' ' + tableId() + '-row-' + rowIndex" [class.is-numeric]="cell.column.numeric" [class.is-winner]="cell.winner" [class.is-band]="!cell.emphasis && cell.read.isBand" [attr.data-band]="!cell.emphasis && cell.read.isBand ? 'true' : null" [class.is-missing]="!cell.emphasis && cell.read.missing" [attr.role]="stacked() ? 'cell' : null" [attr.data-label]="stacked() ? cell.column.label : null"><ng-container [ngTemplateOutlet]="cellContent" [ngTemplateOutletContext]="{ $implicit: cell }" /></td>}
        }@if (rowAction(); as action) {<td class="gcsp-table-td gcsp-table-actioncell" [attr.headers]="tableId() + '-action' + (columns().length ? ' ' + tableId() + '-row-' + rowIndex : '')" [attr.role]="stacked() ? 'cell' : null"><button gcspButton class="vm-btn vm-btn-ghost gcsp-table-action" variant="ghost" type="button" [disabled]="view.disabled" [attr.data-row-id]="view.row.id" [attr.aria-label]="view.name" [attr.data-focus-key]="view.name" (click)="select(view.row, rowIndex)">{{ action.label ?? 'Open' }}</button></td>}</tr>
      } @empty {<tr [attr.role]="stacked() ? 'row' : null"><td class="gcsp-table-empty" [attr.colspan]="span()" [attr.role]="stacked() ? 'cell' : null">{{ emptyLabel() ?? emptyText() }}</td></tr>}</tbody>
    </table>
  </div>
` })
export class DataTableComponent {
  readonly caption = input(''); readonly columns = input<readonly DataTableColumn[]>([]); readonly rows = input<readonly DataTableRow[]>([]);
  readonly stack = input(false); readonly compare = input(false); readonly captionHidden = input(false); readonly equalColumns = input(false);
  readonly rowAction = input<DataTableRowAction | null>(null); readonly disabled = input(false); readonly emptyText = input('Nothing to show'); readonly emptyLabel = input<string | undefined>(undefined);
  private readonly generatedId = `gcsp-table-${++serial}`; readonly id = input(this.generatedId); readonly tableId = computed(() => this.id() || this.generatedId); readonly opened = output<string>();
  readonly stacked = computed(() => this.stack() && !this.compare()); readonly span = computed(() => Math.max(this.columns().length + (this.rowAction() ? 1 : 0), 1));
  readonly renderedRows = computed(() => this.rows().map((row, index) => ({ row, name: this.rowAction()?.name?.(row, index) || null, disabled: this.rowDisabled(row, index), cells: this.columns().map(column => {
    const value = row.cells[column.key]; const properties = value && typeof value === 'object' ? value : null;
    return { column, read: readValue(value), emphasis: !!properties?.emphasis, tone: properties?.tone, winner: properties?.winner === true };
  }) })));
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  rowDisabled(row: DataTableRow, index: number): boolean { const disabled = this.rowAction()?.disabled; return this.disabled() || (typeof disabled === 'function' ? !!disabled(row, index) : !!disabled); }
  select(row: DataTableRow, index: number): void { if (!this.rowAction() || this.rowDisabled(row, index)) return; this.rowAction()?.onSelect?.(row, index); this.opened.emit(row.id); }
  focusRow(id: string): boolean {
    const button = Array.from(this.host.nativeElement.querySelectorAll<HTMLButtonElement>('button[data-row-id]')).find(item => item.dataset['rowId'] === id && !item.disabled);
    button?.focus(); return !!button;
  }
}
