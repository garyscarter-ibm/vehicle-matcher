import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'https://gallery.test/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true });
}
const { showMore } = await import('../../blocks/gcsp/kit/show-more.js');
const css = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('showMore names singular and plural counts and hides the button once everything is shown', () => {
  let presses = 0; const paging = showMore({ onShowMore: () => { presses += 1; } });
  paging.update({ shown: 6, total: 20 }); assert.equal(paging.root.querySelector('.gcsp-show-more-count').textContent, 'Showing 6 of 20 cars');
  assert.equal(paging.button.hidden, false); paging.button.click(); assert.equal(presses, 1);
  paging.update({ shown: 1, total: 1 }); assert.equal(paging.root.querySelector('.gcsp-show-more-count').textContent, 'Showing 1 of 1 car');
  assert.equal(paging.button.hidden, true);
  const custom = showMore({ nouns: ['order', 'orders'], label: 'Show more orders' }); custom.update({ shown: 2, total: 1200 });
  assert.equal(custom.root.textContent, 'Showing 2 of 1,200 ordersShow more orders');
});

test('narrow layout rules: one-column fact grids, break-word values, kit paging styles and the shell gutter', () => {
  const kit = css('blocks/vehicle-matcher/gcsp-kit.css'); const employee = css('blocks/gcsp/employee/gcsp-employee.css');
  assert.match(kit, /\.gcsp \.vm-facts \{[^}]*minmax\(min\(100%, 150px\), 1fr\)/);
  assert.match(kit, /\.gcsp \.vm-fact-value \{[^}]*overflow-wrap: break-word/); assert.doesNotMatch(kit, /\.vm-fact-value \{[^}]*overflow-wrap: anywhere/);
  assert.match(employee, /\.gcsp-card \.vm-facts \{[^}]*repeat\(auto-fit, minmax\(max\(140px, 40%\), 1fr\)\)/);
  assert.doesNotMatch(employee, /\.gcsp-card \.vm-facts \{[^}]*repeat\(2,/);
  assert.match(css('blocks/gcsp/kit/show-more.css'), /\.gcsp \.gcsp-show-more-count/);
  assert.match(css('blocks/gcsp/kit/form-controls.css'), /\.gcsp-field select[^{]*\{[^}]*text-overflow: ellipsis[^}]*width: 100%[^}]*max-width: 100%/);
  assert.match(css('blocks/gcsp/shell/gcsp-shell.css'), /@media \(max-width: 400px\) \{[^\n]*\.gcsp-avatar \{ display: none; \}/); assert.match(css('blocks/gcsp/shell/gcsp-shell.css'), /@import "\.\/account-menu\.css"/);
  assert.match(css('blocks/gcsp/shell/account-menu.css'), /\.gcsp-account-name \{[^}]*text-overflow: ellipsis/);
  assert.match(css('blocks/gcsp/shell/gcsp-shell.css'), /\.gcsp-content \.vm \{ padding-inline: var\(--gcsp-space-1\); \}/);
});

test('the component gallery example pages its list and wraps long values at word breaks', async () => {
  const { showMoreExample } = await import('../../blocks/gcsp/kit/form-controls-gallery.js');
  const section = showMoreExample(); document.body.append(section);
  const rows = () => section.querySelectorAll('li'); assert.equal(rows().length, 5);
  assert.equal(section.querySelector('.gcsp-show-more-count').textContent, 'Showing 5 of 14 cars');
  section.querySelector('.gcsp-show-more button').click(); assert.equal(rows().length, 10); assert.equal(document.activeElement, rows()[5]);
  assert.ok(section.querySelector('.vm-facts')); section.remove();
});
