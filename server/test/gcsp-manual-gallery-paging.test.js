import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createManualGalleryFixture, createManualGalleryFixtureAdapter } from '../../blocks/gcsp/manual-gallery/fixtures.js';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'https://gallery.test/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true });
}
const { mountManualGallery, MANUAL_GALLERY_PAGE_SIZE, MANUAL_GALLERY_NARROW_PAGE_SIZE } = await import('../../blocks/gcsp/manual-gallery/gcsp-manual-gallery.js');
const { showMore } = await import('../../blocks/gcsp/kit/show-more.js');
const css = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const waitFor = async (check) => {
  for (let i = 0; i < 200; i += 1) { if (check()) return; await new Promise((done) => setImmediate(done)); }
  assert.ok(check(), 'Expected gallery state was not reached');
};

// The three fixture cars cloned up to `total`, with distinct names, order numbers and series.
function manyCars(total) {
  const envelope = createManualGalleryFixture(); const base = envelope.value.decisions[0];
  envelope.value.decisions = Array.from({ length: total }, (_, index) => {
    const car = structuredClone(base); const id = `paging-stock-${String(index).padStart(2, '0')}`;
    car.orderUuid = id; car.orderNumber = `90${String(index).padStart(5, '0')}`; car.configurationId = `paging-config-${index}`;
    car.candidateKey = `fixture:${id}`; car.snapshot.sourceKeys = { stockId: id }; car.snapshot.display.name = `BMW Test ${String(index).padStart(2, '0')}`;
    car.snapshot.facts.series.value = index % 2 ? '5 Series' : '3 Series'; car.claimInput.orderUuid = id; return car;
  });
  return envelope;
}
async function mount(t, total) {
  const root = document.createElement('div'); document.body.append(root);
  const adapter = { ...createManualGalleryFixtureAdapter(), browseStock: async () => manyCars(total) };
  const teardown = mountManualGallery(root, { adapter });
  t.after(() => { teardown(); root.remove(); });
  await waitFor(() => root.querySelectorAll('.vm-card').length > 0);
  return root;
}
const cards = (root) => [...root.querySelectorAll('.gcsp-gallery-grid .vm-card')];
const countLine = (root) => root.querySelector('.gcsp-show-more-count').textContent;
const moreButton = (root) => root.querySelector('.gcsp-show-more button');
function change(root, name, value) {
  const node = root.querySelector(`[name="${name}"]`); node.value = value;
  node.dispatchEvent(new window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

test('the gallery shows one page of cars with a count line and a real Show more cars button', async (t) => {
  const root = await mount(t, 20);
  assert.equal(MANUAL_GALLERY_PAGE_SIZE, 6); assert.equal(cards(root).length, 6);
  assert.equal(countLine(root), 'Showing 6 of 20 cars'); assert.equal(root.querySelector('.gcsp-show-more-count').getAttribute('role'), null);
  const more = moreButton(root); assert.equal(more.tagName, 'BUTTON'); assert.equal(more.textContent, 'Show more cars'); assert.equal(more.hidden, false);
    assert.match(root.textContent, /20 released cars · 20 eligible · 20 matching · 20 eligible matching/);
  assert.deepEqual(cards(root).map((card) => card.getAttribute('aria-label')), Array.from({ length: 6 }, (_, i) => `BMW Test 0${i}`));
});

test('at 600px and below the gallery pages three cars at a time and focuses card four (FUCQ-238)', async (t) => {
  window.matchMedia = (query) => ({ matches: query === '(max-width: 600px)', addEventListener() {}, removeEventListener() {} });
  t.after(() => { delete window.matchMedia; });
  const root = await mount(t, 20); assert.equal(MANUAL_GALLERY_NARROW_PAGE_SIZE, 3); assert.equal(cards(root).length, 3);
  assert.equal(countLine(root), 'Showing 3 of 20 cars');
  moreButton(root).click(); assert.equal(cards(root).length, 6); assert.equal(countLine(root), 'Showing 6 of 20 cars');
  assert.equal(document.activeElement, cards(root)[3]);
});

test('Show more cars reveals the next page, announces the count and focuses the first new card', async (t) => {
  const root = await mount(t, 20);
  moreButton(root).click(); assert.equal(cards(root).length, 12); assert.equal(countLine(root), 'Showing 12 of 20 cars');
  assert.equal(document.activeElement, cards(root)[6]); assert.equal(cards(root)[6].tabIndex, -1);
  assert.equal(cards(root)[6].getAttribute('aria-label'), 'BMW Test 06');
  moreButton(root).click(); assert.equal(cards(root).length, 18); assert.equal(document.activeElement, cards(root)[12]);
  moreButton(root).click(); assert.equal(cards(root).length, 20); assert.equal(countLine(root), 'Showing 20 of 20 cars');
  assert.equal(document.activeElement, cards(root)[18]); assert.equal(moreButton(root).hidden, true);
});

test('searching, sorting, filtering or reloading starts again at the first page', async (t) => {
  const root = await mount(t, 20);
  moreButton(root).click(); assert.equal(cards(root).length, 12);
  change(root, 'sort', 'points'); assert.equal(cards(root).length, 6); assert.equal(countLine(root), 'Showing 6 of 20 cars');
  moreButton(root).click(); change(root, 'query', 'BMW Test 1'); assert.equal(countLine(root), 'Showing 6 of 10 cars');
  moreButton(root).click(); assert.equal(cards(root).length, 10); assert.equal(moreButton(root).hidden, true);
  change(root, 'query', ''); assert.equal(cards(root).length, 6);
  moreButton(root).click(); root.querySelector('[data-nav="series"] [role="radio"]:nth-child(2)').click();
  assert.equal(cards(root).length, 6); assert.equal(countLine(root), 'Showing 6 of 10 cars');
});

test('a gallery that fits on one page has no paging control in the page', async (t) => {
  const root = await mount(t, 6);
  assert.equal(cards(root).length, 6); assert.equal(root.querySelector('.gcsp-show-more'), null);
});

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
  assert.match(css('blocks/gcsp/manual-gallery/gcsp-manual-gallery.css'), /@import "\.\.\/kit\/show-more\.css"/);
  assert.match(css('blocks/gcsp/kit/form-controls.css'), /\.gcsp-field select[^{]*\{[^}]*text-overflow: ellipsis[^}]*width: 100%[^}]*max-width: 100%/);
  assert.match(css('blocks/gcsp/shell/gcsp-shell.css'), /@media \(max-width: 400px\) \{[^\n]*\.gcsp-avatar \{ display: none; \}/); assert.match(css('blocks/gcsp/shell/gcsp-shell.css'), /\.gcsp-account-name \{[^}]*text-overflow: ellipsis/);
  assert.match(css('blocks/gcsp/shell/gcsp-shell.css'), /\.gcsp-content \.vm \{ padding-inline: 4px; \}/);
});

test('the component gallery example pages its list and wraps long values at word breaks', async () => {
  const { showMoreExample } = await import('../../blocks/gcsp/kit/form-controls-gallery.js');
  const section = showMoreExample(); document.body.append(section);
  const rows = () => section.querySelectorAll('li'); assert.equal(rows().length, 5);
  assert.equal(section.querySelector('.gcsp-show-more-count').textContent, 'Showing 5 of 14 cars');
  section.querySelector('.gcsp-show-more button').click(); assert.equal(rows().length, 10); assert.equal(document.activeElement, rows()[5]);
  assert.ok(section.querySelector('.vm-facts')); section.remove();
});
