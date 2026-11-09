// dataTable: a real <table> in a keyboard-scrollable region. Cells are strings, numbers, { label, isBand } or { label, emphasis } (bold).
import { el } from '../../vehicle-matcher/ui.js';
import { fillValue } from './metric-tile.js';

let uid = 0;

/**
 * { caption, columns: [{ key, label, numeric }], rows: [{ [key]: value }], emptyText, id } -> the scroll region (div).
 * The first column's cells are row headers. No rows shows one row with emptyText.
 */
export function dataTable({ caption, columns = [], rows = [], emptyText = 'Nothing to show', id } = {}) {
  const base = id || `gcsp-table-${++uid}`;
  const captionId = `${base}-caption`;
  const region = el('div', 'gcsp-table-wrap');
  region.setAttribute('role', 'region');
  region.tabIndex = 0;
  region.setAttribute('aria-labelledby', captionId);
  const table = el('table', 'gcsp-table');
  table.id = base;
  const cap = el('caption', 'gcsp-table-caption', caption);
  cap.id = captionId;
  const headRow = el('tr');
  for (const column of columns) {
    const th = el('th', `gcsp-table-th${column.numeric ? ' is-numeric' : ''}`, column.label);
    th.scope = 'col';
    headRow.append(th);
  }
  const head = el('thead');
  head.append(headRow);
  const body = el('tbody');
  if (!rows.length) {
    const cell = el('td', 'gcsp-table-empty', emptyText);
    cell.colSpan = Math.max(columns.length, 1);
    const row = el('tr');
    row.append(cell);
    body.append(row);
  }
  for (const data of rows) {
    const row = el('tr');
    columns.forEach((column, i) => {
      const first = i === 0;
      const cell = el(first ? 'th' : 'td', `${first ? 'gcsp-table-rowhead' : 'gcsp-table-td'}${column.numeric ? ' is-numeric' : ''}`);
      if (first) cell.scope = 'row';
      const value = data[column.key];
      if (value?.emphasis) { const strong = el('strong'); fillValue(strong, value); cell.append(strong); } else fillValue(cell, value);
      row.append(cell);
    });
    body.append(row);
  }
  table.append(cap, head, body);
  region.append(table);
  return region;
}
