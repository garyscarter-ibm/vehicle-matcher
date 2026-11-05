import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installDom, resetDom } from './dom-harness.js';
import { matchCard, previewTile, listingsOf, mediaWell } from '../../blocks/vehicle-matcher/modes/result-card.js';
import { formatTerm } from '../../blocks/vehicle-matcher/ui.js';
import { employeeCardFixture } from '../../blocks/vehicle-matcher/employee-card-fixture.js';
import { createSharedKitEmployeeFixture } from './helpers/shared-kit-fixture.js';


let dom;
let exactListingExample;
let employeeDecisionExample;
before(async () => {
  dom = installDom();
  ({ exactListingExample, employeeDecisionExample } = await import('../../blocks/vehicle-matcher/component-gallery.js'));
});
after(() => dom.window.close());
beforeEach(() => resetDom());
const fixture = () => structuredClone(employeeCardFixture);

test('legacy retail signatures retain listing identity, price, odometer, dealer and unknown treatment', () => {
  const match = exactListingExample();
  assert.equal(listingsOf(match), match.listings);
  const card = matchCard(match, { big: true }); document.body.append(card);
  assert.match(card.textContent, /£30,000/);
  assert.match(card.textContent, /10,000 miles/);
  assert.equal(card.querySelector('.vm-card-link').textContent, `View at ${match.listings[0].retailerName} ›`);
  assert.match(card.querySelector('.vm-card-link').textContent, /View at/);
  assert.equal(card.querySelector('.vm-score').textContent, '96%');
  assert.equal(previewTile(match).tagName, 'A');
  assert.match(previewTile(match).textContent, /£30,000/);
  assert.equal(mediaWell({ name: 'Unknown car' }).media.querySelector('.vm-card-soon').textContent, 'Images coming soon');
});

test('typed terms never infer points from purchase money or invent unknown values', () => {
  assert.equal(formatTerm({ kind: 'purchase-money', currency: 'GBP', value: 32000 }), '£32,000');
  assert.equal(formatTerm({ kind: 'purchase-money', value: 32000 }), 'Terms not supplied');
  assert.equal(formatTerm({ kind: 'points-monthly', value: 1100, allowance: 1300 }), '1,100 points a month · 1,300 points a month allowance');
  assert.equal(formatTerm({ kind: 'points-monthly', value: null, allowance: null }), 'Monthly points cost not supplied · monthly points allowance not supplied');
  assert.equal(formatTerm({ kind: 'purchase-money', currency: 'GBP', value: null }), 'Purchase price not supplied');
});

test('exact selection updates every field, decision, term, media and callback together without replacing focused picker', () => {
  const view = fixture(); const second = view.members[1];
  second.display.line = 'Second exact line';
  second.terms = [{ kind: 'points-monthly', value: 1400, allowance: 1200 }];
  second.decision.tradeOffs = ['Second exact trade-off'];
  let selected; let actionMember;
  const card = matchCard(null, { view, onListingSelect: (member) => { selected = member; }, onAction: (action, member) => { actionMember = member; } });
  document.body.append(card);
  assert.equal(listingsOf(null, { view }), view.members);
  assert.match(card.textContent, /1,100 points a month/);
  assert.ok(card.querySelector('.vm-media-caption'));
  const choice = card.querySelectorAll('.vm-pick-opt')[1]; choice.focus(); choice.click();
  assert.equal(document.activeElement, choice);
  assert.equal(choice.getAttribute('aria-pressed'), 'true');
  assert.equal(selected, second);
  assert.equal(card.dataset.memberId, second.id);
  assert.equal(card.querySelector('.vm-card-name').textContent, second.display.name);
  assert.equal(card.querySelector('.vm-card-line').textContent, 'Second exact line');
  assert.equal(card.querySelector('.vm-card-photo'), null);
  assert.equal(card.querySelector('.vm-media-caption'), null);
  assert.match(card.textContent, /1,400 points a month · 1,200 points a month allowance/);
  assert.doesNotMatch(card.textContent, /1,100 points a month/);
  assert.match(card.textContent, /Not eligible/);
  assert.match(card.textContent, /Second exact trade-off/);
  assert.equal(card.querySelector('.vm-fact-value').textContent, '4 count');
  assert.equal(card.querySelector('.vm-score').hidden, true);
  card.querySelector('[data-action-id="inspect"]').click();
  assert.equal(actionMember, second);
});

test('accept and reserve fail closed for ineligible, confirmation-needed, unknown or absent decisions despite caller enablement', () => {
  for (const gateStatus of ['eligible', 'ineligible', 'needs-confirmation', 'unrecognised', null]) {
    const view = fixture(); view.members = [view.members[0]];
    view.members[0].decision = gateStatus ? { gateStatus, score: 99 } : null;
    view.members[0].actions = ['accept', 'reserve'].map((kind) => ({ id: kind, kind, label: kind, disabled: false }));
    let calls = 0;
    const card = matchCard(null, { view, onAction: () => { calls += 1; } });
    for (const control of card.querySelectorAll('[data-action-id]')) {
      assert.equal(control.disabled, gateStatus !== 'eligible');
      if (control.disabled) assert.ok(card.querySelector(`#${control.getAttribute('aria-describedby')}`).textContent);
      control.click();
    }
    assert.equal(calls, gateStatus === 'eligible' ? 2 : 0);
  }
});

test('explicit facts preserve zero and unknown units; preview shares the same exact gate and callback contract', () => {
  const view = fixture(); view.members = [view.members[2]];
  view.members[0].facts.push({ label: 'Confirmed zero', value: 0, unit: 'mi' });
  const tile = previewTile(null, { view });
  assert.match(tile.textContent, /Not supplied \(count\)/);
  assert.match(tile.textContent, /Not supplied \(L\)/);
  assert.match(tile.textContent, /0 mi/);
  assert.match(tile.textContent, /The exact number of seats needs confirmation/);
  assert.equal(tile.querySelector('[data-action-id="reserve"]').disabled, true);
  assert.ok([...tile.querySelectorAll('[data-action-id]')].every((control) => control.disabled));
  assert.throws(() => matchCard(null, { view: { members: [] } }), /exact members/);
});

test('representative media caption and alt disappear on broken images and never transfer to absent imagery', () => {
  const view = fixture();
  const { media, showPhoto } = mediaWell(null, '', { view: view.members[0] });
  assert.equal(media.querySelector('img').alt, 'Representative BMW brand image');
  media.querySelector('img').dispatchEvent(new dom.window.Event('error'));
  assert.equal(media.querySelector('.vm-media-caption'), null);
  assert.equal(media.classList.contains('has-photo'), false);
  const replacement = { name: 'New exact car', caption: 'New representative caption' };
  showPhoto('/new.jpg', replacement);
  const stale = media.querySelector('img');
  showPhoto('/newer.jpg', replacement);
  stale.dispatchEvent(new dom.window.Event('error'));
  assert.equal(media.querySelector('.vm-media-caption').textContent, replacement.caption);
  assert.equal(media.classList.contains('has-photo'), true);
  showPhoto(null, {});
  assert.equal(media.querySelector('.vm-media-caption'), null);
  assert.equal(media.querySelector('.vm-card-line').textContent, '');
});

test('callback actions own effects, fixture input stays unchanged, and gallery Reserve gives its preview reason', () => {
  const view = fixture(); const original = structuredClone(view); let actionMember;
  const card = matchCard(null, { view, onAction: (action, member) => { actionMember = member; } });
  card.querySelector('[data-action-id="feedback"]').click();
  assert.equal(actionMember, view.members[0]);
  assert.deepEqual(view, original);
  const gallery = employeeDecisionExample();
  assert.match(gallery.textContent, /Reserving is not part of this preview/);
  assert.equal(gallery.querySelector('[data-action-id="reserve"]').disabled, true);
  assert.equal(gallery.querySelectorAll('.vm-status').length, 3);
  gallery.querySelector('[data-action-id="feedback"]').click();
  assert.match(gallery.querySelector('[role="status"]').textContent, /Nothing is saved or reserved/);
  gallery.querySelector('.vm-brief-undo').click();
  assert.match(gallery.querySelector('[role="status"]').textContent, /Local feedback undone/);
});

test('committed browser fixture equals actual FUCQ-29 decisions and canonical PolicyService provenance', async () => {
  assert.deepEqual(employeeCardFixture, await createSharedKitEmployeeFixture());
  assert.deepEqual(employeeCardFixture.members.map((member) => member.decision.gateStatus), ['eligible', 'ineligible', 'needs-confirmation']);
  for (const member of employeeCardFixture.members) {
    assert.equal(member.terms[0].provenance.version, employeeCardFixture.versions.policy);
    assert.ok(member.facts.every((row) => row.provenance.sourceRef));
  }
});

test('explicit shared paths and single gallery remain CSP-safe and own no HTTP or persistence', async () => {
  for (const path of ['ui.js', 'modes/result-card.js', 'employee-card-fixture.js']) {
    const source = await readFile(new URL(`../../blocks/vehicle-matcher/${path}`, import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
    assert.doesNotMatch(code, /\beval\s*\(|new\s+Function\b|\bset(?:Timeout|Interval)\s*\(\s*['"`]|\.setAttribute\(\s*['"]on[a-z]+['"]/);
    assert.doesNotMatch(code, /\bfetch\s*\(|\b(?:localStorage|sessionStorage|XMLHttpRequest)\b/);
  }
});
