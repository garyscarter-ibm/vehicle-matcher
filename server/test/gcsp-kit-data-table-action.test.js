import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
let dataTable; let dom;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://kit.test/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'Node'])
    Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true, writable: true });
  ({ dataTable } = await import('../../blocks/gcsp/kit/data-table.js'));
});
after(() => dom.window.close());
const columns = [{ key: 'name', label: 'Employee' }, { key: 'status', label: 'Status' }];
const rows = [{ name: 'Paula (fictional)', status: 'Open' }, { name: 'Sam', status: 'Closed' }];
test('dataTable rowAction: a named button per row calls onSelect with the row and its index', () => {
  const calls = [];
  const region = dataTable({ caption: 'Cases', columns, rows, stack: true, rowAction: { label: 'Open', name: (row) => `Open case for ${row.name}`,
    onSelect: (row, i) => calls.push([row.name, i]), disabled: (row) => row.status === 'Closed' } });
  assert.deepEqual([...region.querySelectorAll('thead th')].map((th) => [th.textContent, th.scope, th.getAttribute('role')]),
    [['Employee', 'col', 'columnheader'], ['Status', 'col', 'columnheader'], ['Action', 'col', 'columnheader']]);
  const buttons = [...region.querySelectorAll('tbody .gcsp-table-action')];
  assert.deepEqual(buttons.map((b) => [b.type, b.textContent, b.getAttribute('aria-label'), b.disabled]),
    [['button', 'Open', 'Open case for Paula (fictional)', false], ['button', 'Open', 'Open case for Sam', true]]);
  assert.equal(buttons[0].closest('td').getAttribute('role'), 'cell'); assert.equal(buttons[0].closest('td').dataset.label, undefined);
  buttons[0].click(); buttons[1].click(); assert.deepEqual(calls, [['Paula (fictional)', 0]]);
});
test('dataTable rowAction: absent by default, a header can be named, and the empty row spans the action column', () => {
  assert.equal(dataTable({ caption: 'Plain', columns, rows }).querySelector('.gcsp-table-action'), null);
  assert.equal(dataTable({ caption: 'Plain', columns, rows }).querySelectorAll('thead th').length, 2);
  const named = dataTable({ caption: 'N', columns, rows, rowAction: { header: 'Open a case', label: 'Open' } });
  assert.equal(named.querySelectorAll('thead th')[2].textContent, 'Open a case');
  assert.equal(dataTable({ caption: 'E', columns, rows: [], rowAction: { label: 'Open' } }).querySelector('td').colSpan, 3);
  const css = readFileSync(new URL('../../blocks/gcsp/kit/gcsp-kit.css', import.meta.url), 'utf8');
  assert.match(css, /\.gcsp-table-actioncell::before \{ content: none; \}/);
});
