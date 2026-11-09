import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom; let rangeBar; let rangeBarExample;
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>');
  globalThis.document = dom.window.document;
  ({ rangeBar } = await import('../../blocks/gcsp/kit/range-bar.js'));
  ({ rangeBarExample } = await import('../../blocks/gcsp/kit/form-controls-gallery.js'));
});
after(() => dom?.window.close());

const percent = (value) => `${Math.round(value * 100)}%`;
const place = (node, selector, property) => node.querySelector(selector).style.getPropertyValue(property);

test('rangeBar is a figure labelled by its heading, with no interactive elements', () => {
  const node = rangeBar({ label: 'Coverage before renewal', level: 2, rows: [{ label: 'Buddy route', mean: 0.7, min: 0.6, max: 0.8 }] });
  const heading = node.querySelector('h2');
  assert.equal(node.tagName, 'FIGURE');
  assert.equal(heading.textContent, 'Coverage before renewal');
  assert.equal(heading.className, 'gcsp-range-bar-heading');
  assert.equal(node.getAttribute('aria-labelledby'), heading.id);
  assert.match(heading.id, /^gcsp-range-bar-\d+$/);
  assert.equal(node.querySelector('a, button, input, select, textarea, [tabindex]'), null);
  assert.equal(rangeBar({ label: 'Named', id: 'route-share' }).querySelector('h3').id, 'route-share');
  assert.equal(rangeBar({ label: 'Default level' }).querySelector('h3').textContent, 'Default level');
});

test('each row is one list item with its label and value text, and the track is hidden from assistive technology', () => {
  const node = rangeBar({ label: 'Coverage', format: percent, rows: [
    { label: "Today's release route", mean: 0.62, min: 0.58, max: 0.66 },
    { label: 'Buddy route', mean: 0.74, min: 0.7, max: 0.79 }] });
  const items = [...node.querySelectorAll('ul > li.gcsp-range-bar-row')];
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.querySelector('.gcsp-range-bar-label').textContent), ["Today's release route", 'Buddy route']);
  assert.deepEqual(items.map((item) => item.querySelector('.gcsp-range-bar-value').textContent), ['62% (58% to 66%)', '74% (70% to 79%)']);
  assert.ok(items.every((item) => item.querySelector('.gcsp-range-bar-track').getAttribute('aria-hidden') === 'true'));
});

test('positions are percentages of the supplied scale, set as custom properties on the span and marker', () => {
  const node = rangeBar({ label: 'Scale', scale: { min: 0, max: 1 }, rows: [{ label: 'A', mean: 0.5, min: 0.25, max: 0.75 }] });
  assert.equal(place(node, '.gcsp-range-bar-span', '--gcsp-range-start'), '25%');
  assert.equal(place(node, '.gcsp-range-bar-span', '--gcsp-range-end'), '75%');
  assert.equal(place(node, '.gcsp-range-bar-mean', '--gcsp-range-mean'), '50%');
  const thirds = rangeBar({ label: 'Thirds', scale: { min: 0, max: 3 }, rows: [{ label: 'B', mean: 1, min: 0, max: 2 }] });
  assert.equal(place(thirds, '.gcsp-range-bar-mean', '--gcsp-range-mean'), '33.33%');
});

test('without a scale, the rows share the smallest min to the largest max', () => {
  const node = rangeBar({ label: 'Computed', rows: [{ label: 'A', mean: 4, min: 2, max: 6 }, { label: 'B', mean: 7, min: 4, max: 10 }] });
  const [a, b] = [...node.querySelectorAll('.gcsp-range-bar-row')];
  assert.equal(place(a, '.gcsp-range-bar-span', '--gcsp-range-start'), '0%');
  assert.equal(place(a, '.gcsp-range-bar-span', '--gcsp-range-end'), '50%');
  assert.equal(place(b, '.gcsp-range-bar-span', '--gcsp-range-start'), '25%');
  assert.equal(place(b, '.gcsp-range-bar-span', '--gcsp-range-end'), '100%');
  assert.equal(place(b, '.gcsp-range-bar-mean', '--gcsp-range-mean'), '62.5%');
});

test('a row whose min and max are equal reads as its mean alone, and a flat computed scale stays finite', () => {
  const node = rangeBar({ label: 'Flat', rows: [{ label: 'Only', mean: 5, min: 5, max: 5 }] });
  assert.equal(node.querySelector('.gcsp-range-bar-value').textContent, '5');
  assert.equal(place(node, '.gcsp-range-bar-mean', '--gcsp-range-mean'), '50%');
  assert.doesNotMatch(node.innerHTML, /NaN|Infinity/);
});

test('a null or non-finite mean is marked missing, with an empty track and Not observed', () => {
  const node = rangeBar({ label: 'Gap', scale: { min: 0, max: 1 }, rows: [
    { label: 'Buddy route', mean: null, min: null, max: null },
    { label: 'Non-finite mean', mean: Number.NaN, min: 0.2, max: 0.4 }] });
  for (const row of node.querySelectorAll('li')) {
    assert.ok(row.classList.contains('is-missing'));
    assert.equal(row.querySelector('.gcsp-range-bar-value').textContent, 'Not observed');
    assert.equal(row.querySelector('.gcsp-range-bar-track').children.length, 0);
    assert.equal(row.querySelector('.gcsp-range-bar-span'), null);
    assert.equal(row.querySelector('.gcsp-range-bar-mean'), null);
  }
});

test('values outside a supplied scale are clamped to 0 to 100 per cent', () => {
  const node = rangeBar({ label: 'Clamp', scale: { min: 0, max: 10 }, rows: [
    { label: 'High', mean: 12, min: -2, max: 11 },
    { label: 'Low', mean: -5, min: -6, max: 3 }] });
  const [high, low] = [...node.querySelectorAll('.gcsp-range-bar-row')];
  assert.equal(place(high, '.gcsp-range-bar-span', '--gcsp-range-start'), '0%');
  assert.equal(place(high, '.gcsp-range-bar-span', '--gcsp-range-end'), '100%');
  assert.equal(place(high, '.gcsp-range-bar-mean', '--gcsp-range-mean'), '100%');
  assert.equal(place(low, '.gcsp-range-bar-span', '--gcsp-range-end'), '30%');
  assert.equal(place(low, '.gcsp-range-bar-mean', '--gcsp-range-mean'), '0%');
});

test('the only inline style is the range custom properties, set through the CSSOM', () => {
  const node = rangeBar({ label: 'CSP', rows: [{ label: 'A', mean: 0.5, min: 0.2, max: 0.9 }, { label: 'B', mean: null }] });
  assert.equal(node.querySelectorAll('[style]').length, 2);
  for (const element of [node, ...node.querySelectorAll('*')]) {
    const style = element.getAttribute('style') ?? '';
    for (const declaration of style.split(';').map((part) => part.trim()).filter(Boolean)) {
      assert.match(declaration, /^--gcsp-range-(start|end|mean):/);
    }
  }
});

test('the gallery section shows a share, an overlapping count and a missing mean under one Range bar heading', () => {
  const section = rangeBarExample();
  assert.equal(section.querySelector('h2').textContent, 'Range bar');
  const figures = [...section.querySelectorAll('figure.gcsp-range-bar')];
  assert.equal(figures.length, 3);
  assert.match(figures[0].textContent, /62% \(58% to 66%\)/);
  assert.match(figures[1].textContent, /12 \(9 to 15\)/);
  assert.match(figures[2].textContent, /Not observed/);
});

test('no em dash appears in any text the kit writes, including the gallery section', () => {
  const node = rangeBar({ label: 'Text', rows: [{ label: 'Route', mean: 0.5, min: 0.4, max: 0.6 }, { label: 'Missing', mean: null }] });
  for (const text of [node.textContent, rangeBarExample().textContent]) assert.doesNotMatch(text, new RegExp(String.fromCharCode(0x2014)));
});
