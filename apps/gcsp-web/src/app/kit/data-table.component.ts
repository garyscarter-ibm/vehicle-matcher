import { Component, ElementRef, inject, input, output } from '@angular/core';
import { ButtonDirective } from './button.directive';

export interface DataTableColumn { readonly key: string; readonly label: string }
export interface DataTableRow { readonly id: string; readonly label: string; readonly cells: Readonly<Record<string, string>> }
let serial = 0;
/** Native table and one named row action; narrow labels preserve the same table data. */
@Component({ selector: 'gcsp-data-table', imports: [ButtonDirective], styleUrl: './data-table.component.css', template: `
  <div class="table-wrap" tabindex="0" role="region" [attr.aria-label]="caption()">
    <table><caption>{{ caption() }}</caption>
      <thead><tr>@for (column of columns(); track column.key; let i = $index) {
        <th scope="col" [id]="id + '-col-' + i">{{ column.label }}</th>
      }<th scope="col" [id]="id + '-action'">Action</th></tr></thead>
      <tbody>@for (row of rows(); track row.id; let rowIndex = $index) {
        <tr>@for (column of columns(); track column.key; let i = $index) {
          @if (i === 0) { <th scope="row" [id]="id + '-row-' + rowIndex" [attr.headers]="id + '-col-' + i">{{ row.cells[column.key] || 'Not supplied' }}</th> }
          @else { <td [attr.headers]="id + '-col-' + i + ' ' + id + '-row-' + rowIndex" [attr.data-label]="column.label">{{ row.cells[column.key] || 'Not supplied' }}</td> }
        }<td class="action" [attr.headers]="id + '-action ' + id + '-row-' + rowIndex"><button gcspButton variant="ghost" type="button"
          [disabled]="disabled()" [attr.data-row-id]="row.id" [attr.aria-label]="'Open case for ' + row.label" (click)="opened.emit(row.id)">Open</button></td></tr>
      } @empty { <tr><td [attr.colspan]="columns().length + 1">{{ emptyLabel() }}</td></tr> }</tbody>
    </table>
  </div>
` })
export class DataTableComponent {
  readonly caption = input.required<string>();
  readonly columns = input.required<readonly DataTableColumn[]>();
  readonly rows = input.required<readonly DataTableRow[]>();
  readonly disabled = input(false);
  readonly emptyLabel = input('No cases to show.');
  readonly opened = output<string>();
  readonly id = `gcsp-table-${++serial}`;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  focusRow(id: string): boolean {
    const button = Array.from(this.host.nativeElement.querySelectorAll<HTMLButtonElement>('button[data-row-id]'))
      .find(item => item.dataset['rowId'] === id && !item.disabled);
    button?.focus(); return !!button;
  }
}
