// dataTable: a real <table> in a keyboard-scrollable region. Cells are strings, numbers, { label, isBand }, { label, emphasis } (bold) or { label, missing }.
// rowAction adds a last column with one button per row.
import { el, button } from '../../vehicle-matcher/ui.js';
import { fillValue } from './metric-tile.js';

let uid = 0;

/**
 * { caption, columns: [{ key, label, numeric, detail }], rows: [{ [key]: value }], emptyText, id, stack, compare } -> the scroll region (div).
 * First column cells are row headers. `stack` adds data-label and explicit roles so CSS can stack rows under 640 px.
 * `rowAction: { header = 'Action', label = 'Open', name(row, i), onSelect(row, i), disabled }` adds a button per row named by `name`.
 * `compare` keeps row header | value | value as columns at any width, wrapping long values; `detail` names a column's subject.
 */
export function dataTable({ caption, columns = [], rows = [], emptyText = 'Nothing to show', id, stack = false, compare = false, rowAction } = {}) {
  const base = id || `gcsp-table-${++uid}`;
  const captionId = `${base}-caption`;
  const region = el('div', 'gcsp-table-wrap');
  region.setAttribute('role', 'region');
  region.tabIndex = 0;
  region.setAttribute('aria-labelledby', captionId);
  if (compare) { stack = false; region.classList.add('is-compare'); }
  if (stack) region.classList.add('is-stack');
  const table = el('table', 'gcsp-table');
  table.id = base;
  const cap = el('caption', 'gcsp-table-caption', caption);
  cap.id = captionId;
  const headRow = el('tr');
  const span = columns.length + (rowAction ? 1 : 0);
  for (const column of [...columns, ...(rowAction ? [{ label: rowAction.header ?? 'Action' }] : [])]) {
    const th = el('th', `gcsp-table-th${column.numeric ? ' is-numeric' : ''}`, column.label);
    th.scope = 'col';
    if (column.detail) th.append(' ', el('span', 'gcsp-table-th-sub', column.detail));
    if (stack) th.setAttribute('role', 'columnheader');
    headRow.append(th);
  }
  const head = el('thead');
  head.append(headRow);
  const body = el('tbody');
  if (!rows.length) {
    const cell = el('td', 'gcsp-table-empty', emptyText);
    cell.colSpan = Math.max(span, 1);
    const row = el('tr');
    if (stack) { cell.setAttribute('role', 'cell'); row.setAttribute('role', 'row'); }
    row.append(cell);
    body.append(row);
  }
  rows.forEach((data, index) => {
    const row = el('tr');
    if (stack) row.setAttribute('role', 'row');
    columns.forEach((column, i) => {
      const first = i === 0;
      const cell = el(first ? 'th' : 'td', `${first ? 'gcsp-table-rowhead' : 'gcsp-table-td'}${column.numeric ? ' is-numeric' : ''}`);
      if (first) cell.scope = 'row';
      if (stack) { cell.setAttribute('role', first ? 'rowheader' : 'cell'); if (!first) cell.dataset.label = column.label; }
      const value = data[column.key];
      if (value?.emphasis) { const strong = el('strong'); fillValue(strong, value); cell.append(strong); } else fillValue(cell, value);
      row.append(cell);
    });
    if (rowAction) {
      const cell = el('td', 'gcsp-table-td gcsp-table-actioncell');
      if (stack) cell.setAttribute('role', 'cell');
      const disabled = typeof rowAction.disabled === 'function' ? !!rowAction.disabled(data, index) : !!rowAction.disabled;
      const action = button({ label: rowAction.label ?? 'Open', variant: 'ghost', disabled, onClick: () => rowAction.onSelect?.(data, index) });
      action.classList.add('gcsp-table-action');
      const name = rowAction.name?.(data, index); if (name) action.setAttribute('aria-label', name);
      cell.append(action); row.append(cell);
    }
    body.append(row);
  });
  if (stack) { table.setAttribute('role', 'table'); head.setAttribute('role', 'rowgroup'); body.setAttribute('role', 'rowgroup'); headRow.setAttribute('role', 'row'); }
  table.append(cap, head, body);
  region.append(table);
  return region;
}
