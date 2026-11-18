import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('scoped offer sources and stylesheet obey embed CSP and composition styling boundaries', async () => {
  for (const file of ['offer-projection.js', 'followup-entry.js', 'fixtures.js']) {
    const text = await readFile(new URL(`../../blocks/gcsp/offer/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /\bon[a-z]+\s*=|\beval\s*\(|new\s+Function\s*\(|set(?:Timeout|Interval)\s*\(\s*['"`]/i);
  }
  const css = await readFile(new URL('../../blocks/gcsp/offer/gcsp-offer.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.vm-card|\.vm-btn|#[\da-f]{3,8}\b/i);
  assert.match(css, /minmax\(0, 1fr\)/);
});

// FUCQ-275: the comparison table is a kit dataTable, so its kit stylesheet must be in the offer page's chain.
test('offer stylesheet loads shared feature, comparison and equal-column styling', async () => {
  const css = await readFile(new URL('../../blocks/gcsp/offer/gcsp-offer.css', import.meta.url), 'utf8');
  const feature = await readFile(new URL('../../blocks/gcsp/kit/vehicle-decision.css', import.meta.url), 'utf8');
  const compare = await readFile(new URL('../../blocks/gcsp/kit/data-table-compare.css', import.meta.url), 'utf8');
  assert.match(css, /vehicle-decision\.css/); assert.match(css, /max-width: 1680px/);
  assert.match(feature, /@import "\.\/data-table-compare\.css"/);
  assert.match(compare, /table-layout: fixed/); assert.match(compare, /:not\(\.has-equal-columns\)/);
  assert.match(compare, /has-equal-columns \.gcsp-table-th-sub \{ display: block/);
});
