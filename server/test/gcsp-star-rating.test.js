import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let dom; let mod; let tipMod;
before(async () => {
  dom = new JSDOM('<!doctype html><body class="gcsp"></body>', { url: 'https://example.test/', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'HTMLElement']) globalThis[name] = name === 'window' ? dom.window : dom.window[name];
  mod = await import('../../blocks/gcsp/kit/star-rating.js');
  tipMod = await import('../../blocks/gcsp/kit/help-tip.js');
});
beforeEach(() => document.body.replaceChildren());
after(() => dom.window.close());

const HELP = 'How highly do you rate your BMW 3 Series Touring 320i M Sport · Petrol?';
const pointer = (node, type, pointerType = 'mouse') => { const event = new window.Event(type, { bubbles: type !== 'pointerenter' && type !== 'pointerleave' }); event.pointerType = pointerType; node.dispatchEvent(event); };
const key = (node, name, extra = {}) => { const event = new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra }); node.dispatchEvent(event); return event; };
const keyup = (node, name) => node.dispatchEvent(new window.KeyboardEvent('keyup', { key: name, bubbles: true, cancelable: true }));
const mount = (options = {}) => {
  const changes = []; const rating = mod.starRating({ label: 'Rate your car', onChange: (next) => changes.push(next), ...options });
  document.body.append(rating.root); return { rating, changes, radios: [...rating.root.querySelectorAll('input[type="radio"]')], stars: [...rating.root.querySelectorAll('.gcsp-star')] };
};
const status = (rating) => rating.root.querySelector('[role="status"]');
const tip = (rating) => rating.root.querySelector('[role="tooltip"]');

test('a named group of five named radios, none selected for null', () => {
  const { rating, radios } = mount();
  assert.equal(rating.root.tagName, 'FIELDSET'); assert.equal(rating.root.querySelector('legend').textContent, 'Rate your car');
  assert.equal(radios.length, 5); assert.equal(new Set(radios.map((radio) => radio.name)).size, 1);
  assert.deepEqual(radios.map((radio) => radio.getAttribute('aria-label')), ['1 star: Not for me', '2 stars: Ready for a change', '3 stars: It’s okay', '4 stars: I really like it', '5 stars: I love it']);
  assert.equal(radios.some((radio) => radio.checked), false); assert.equal(rating.value(), null);
  assert.equal(rating.root.querySelectorAll('.gcsp-star.is-filled').length, 0);
  assert.equal(rating.root.querySelectorAll('.gcsp-star svg').length, 5); assert.equal(rating.root.querySelector('.gcsp-star svg path').getAttribute('d'), 'm12 2.8 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L2.9 9.4l6.3-.9Z');
});

test('an initial value checks and fills up to it; invalid values become null', () => {
  const { rating, radios, stars } = mount({ value: 4 });
  assert.equal(rating.value(), 4); assert.deepEqual(radios.map((radio) => radio.checked), [false, false, false, true, false]);
  assert.deepEqual(stars.map((star) => star.classList.contains('is-filled')), [true, true, true, true, false]);
  for (const bad of [0, 6, 2.5, '3', NaN, undefined, -1]) { document.body.replaceChildren(); assert.equal(mount({ value: bad }).rating.value(), null, String(bad)); }
  rating.update({ value: 9 }); assert.equal(rating.value(), null);
});

test('a click selects once, repaints, and keeps focus on the star', () => {
  const { rating, radios, stars, changes } = mount();
  radios[2].focus(); radios[2].click();
  assert.deepEqual(changes, [3]); assert.equal(rating.value(), 3); assert.equal(radios[2].checked, true);
  assert.deepEqual(stars.map((star) => star.classList.contains('is-filled')), [true, true, true, false, false]); assert.equal(document.activeElement, radios[2]);
});

test('a click on the selected star clears it without relying on change', () => {
  const { rating, radios, changes } = mount({ value: 4 });
  radios[3].click(); assert.deepEqual(changes, [null]); assert.equal(rating.value(), null); assert.equal(radios.some((radio) => radio.checked), false);
  radios[3].click(); assert.deepEqual(changes, [null, 4]);
});

test('Space on the selected star clears exactly once even if a click follows', () => {
  const { rating, radios, changes } = mount({ value: 2 });
  radios[1].focus(); const down = key(radios[1], ' '); assert.equal(down.defaultPrevented, true);
  radios[1].click(); keyup(radios[1], ' ');
  assert.deepEqual(changes, [null]); assert.equal(rating.value(), null);
  key(radios[1], ' '); keyup(radios[1], ' '); assert.deepEqual(changes, [null, 2]);
});

test('Enter selects and clears, one change each', () => {
  const { rating, radios, changes } = mount();
  radios[4].focus(); key(radios[4], 'Enter'); assert.equal(rating.value(), 5); key(radios[4], 'Enter'); assert.equal(rating.value(), null);
  assert.deepEqual(changes, [5, null]);
});

test('arrows, Home and End move focus and select, clamped without wrapping', () => {
  const { rating, radios, changes } = mount();
  radios[0].focus(); key(radios[0], 'ArrowLeft'); assert.deepEqual(changes, [1]); assert.equal(document.activeElement, radios[0]);
  key(radios[0], 'ArrowRight'); assert.equal(document.activeElement, radios[1]); assert.equal(rating.value(), 2);
  key(radios[1], 'ArrowUp'); assert.equal(rating.value(), 3); key(radios[2], 'ArrowDown'); assert.equal(rating.value(), 2);
  key(radios[1], 'End'); assert.equal(document.activeElement, radios[4]); assert.equal(rating.value(), 5);
  key(radios[4], 'ArrowRight'); assert.equal(rating.value(), 5); key(radios[4], 'Home'); assert.equal(document.activeElement, radios[0]); assert.equal(rating.value(), 1);
  assert.deepEqual(changes, [1, 2, 3, 2, 5, 1]);
});

test('update repaints without onChange or moving focus', () => {
  const { rating, radios, changes } = mount({ value: 1 }); const outside = document.createElement('button'); document.body.append(outside); outside.focus();
  rating.update({ value: 5 }); assert.equal(rating.value(), 5); assert.equal(radios[4].checked, true); assert.deepEqual(changes, []); assert.equal(document.activeElement, outside);
  rating.update({ value: null }); assert.equal(radios.some((radio) => radio.checked), false);
});

test('disabled disables every radio', () => {
  const { rating, radios } = mount({ disabled: true }); assert.equal(radios.every((radio) => radio.disabled), true);
  rating.update({ disabled: false }); assert.equal(radios.some((radio) => radio.disabled), false);
});

test('pending, saved and failed announce once each, with no announcement on first paint', () => {
  const { rating, radios } = mount({ value: 4 }); assert.equal(status(rating).textContent, '');
  rating.update({ value: 4, status: 'pending' }); assert.equal(rating.root.getAttribute('aria-busy'), 'true'); assert.equal(radios.some((radio) => radio.disabled), false); assert.equal(status(rating).textContent, '');
  rating.update({ value: 4, status: 'saved' }); assert.equal(status(rating).textContent, 'Rating saved: 4 of 5'); assert.equal(rating.root.hasAttribute('aria-busy'), false); assert.equal(rating.root.dataset.status, 'saved');
  const writes = []; new window.MutationObserver(() => writes.push(1)).observe(status(rating), { childList: true, characterData: true, subtree: true });
  rating.update({ value: 4, status: 'saved' }); assert.equal(status(rating).textContent, 'Rating saved: 4 of 5');
  rating.update({ value: null, status: 'pending' }); rating.update({ value: null, status: 'saved' }); assert.equal(status(rating).textContent, 'Rating cleared');
  rating.update({ value: 4, status: 'pending' }); rating.update({ value: 4, status: 'saved' }); assert.equal(status(rating).textContent, 'Rating saved: 4 of 5');
});

test('a repeated identical saved update does not announce again, but pending then the same text does', () => {
  const lines = []; const { rating } = mount({ value: 3, announce: (text) => lines.push(text) });
  rating.update({ value: 3, status: 'saved' }); rating.update({ value: 3, status: 'saved' });
  rating.update({ value: 3, status: 'pending' }); rating.update({ value: 3, status: 'saved' });
  assert.deepEqual(lines, ['Rating saved: 3 of 5', 'Rating saved: 3 of 5']);
});

test('failed keeps the attempted value and announces once', () => {
  const lines = []; const { rating, radios } = mount({ announce: (text) => lines.push(text) });
  radios[2].click(); rating.update({ value: 3, status: 'pending' }); rating.update({ value: 3, status: 'failed' }); rating.update({ value: 3, status: 'failed' });
  assert.equal(rating.value(), 3); assert.equal(radios[2].checked, true); assert.deepEqual(lines, ['Rating not saved. Try again.']);
  assert.equal(rating.root.dataset.status, 'failed');
});

test('a caller announce replaces the own live region', () => {
  const lines = []; const { rating } = mount({ announce: (text) => lines.push(text) });
  assert.equal(status(rating), null); rating.update({ value: null, status: 'saved' }); assert.deepEqual(lines, ['Rating cleared']);
});

test('the kit sends no network requests', () => {
  const real = globalThis.fetch; let calls = 0; globalThis.fetch = () => { calls += 1; throw new Error('no network'); };
  try {
    const { rating, radios } = mount({ help: HELP }); radios[0].focus(); radios[0].click(); radios[0].click(); rating.update({ value: 2, status: 'saved' }); rating.destroy();
  } finally { globalThis.fetch = real; }
  assert.equal(calls, 0);
});

test('overlay adds the pinned class and a root that is otherwise a positioning context', () => {
  assert.equal(mount({ overlay: true }).rating.root.classList.contains('gcsp-star-rating-overlay'), true);
  document.body.replaceChildren(); assert.equal(mount().rating.root.classList.contains('gcsp-star-rating-overlay'), false);
  const css = readFileSync(new URL('../../blocks/gcsp/kit/star-rating.css', import.meta.url), 'utf8');
  assert.match(css, /\.gcsp-star-rating-overlay \{ position: absolute; right: var\(--gcsp-space-2\); bottom: var\(--gcsp-space-2\)/); assert.match(css, /\.gcsp-star-rating \{ position: relative/);
});

test('help tip is wired by aria-describedby and keeps existing ids', () => {
  const host = document.createElement('div'); const a = document.createElement('button'); a.setAttribute('aria-describedby', 'other'); const b = document.createElement('button'); host.append(a, b); document.body.append(host);
  const helper = tipMod.helpTip({ host, triggers: [a, b], text: 'Help', id: 'tip-1' });
  assert.equal(a.getAttribute('aria-describedby'), 'other tip-1'); assert.equal(b.getAttribute('aria-describedby'), 'tip-1');
  assert.equal(helper.root.getAttribute('role'), 'tooltip'); assert.equal(helper.root.id, 'tip-1'); assert.equal(helper.root.hidden, true); assert.equal(helper.root.parentNode, host);
  helper.setText('<b>x</b>'); assert.equal(helper.root.textContent, '<b>x</b>'); assert.equal(helper.root.querySelector('b'), null);
  helper.destroy(); assert.equal(a.getAttribute('aria-describedby'), 'other'); assert.equal(b.hasAttribute('aria-describedby'), false); assert.equal(host.querySelector('[role="tooltip"]'), null);
});

test('the rating tip shows on keyboard focus and on mouse hover, not on touch', () => {
  const { rating, radios } = mount({ help: HELP }); assert.equal(tip(rating).textContent, HELP); assert.equal(tip(rating).hidden, true);
  assert.ok(radios.every((radio) => radio.getAttribute('aria-describedby') === tip(rating).id));
  pointer(radios[0], 'pointerenter', 'touch'); assert.equal(tip(rating).hidden, true);
  pointer(radios[0], 'pointerenter', 'mouse'); assert.equal(tip(rating).hidden, false); pointer(rating.root, 'pointerleave'); assert.equal(tip(rating).hidden, true);
  radios[1].focus(); assert.equal(tip(rating).hidden, false);
  radios[1].blur(); assert.equal(tip(rating).hidden, true);
});

test('a focus caused by a pointerdown on a star does not open the tip', () => {
  const { rating, radios } = mount({ help: HELP });
  pointer(radios[2], 'pointerdown', 'touch'); radios[2].focus(); assert.equal(tip(rating).hidden, true);
});

test('the tip stays while the pointer moves onto it and hides when the host is left', () => {
  const { rating, radios } = mount({ help: HELP });
  pointer(rating.root, 'pointerenter'); pointer(radios[4], 'pointerenter'); pointer(tip(rating), 'pointerenter');
  assert.equal(tip(rating).hidden, false); pointer(rating.root, 'pointerleave'); assert.equal(tip(rating).hidden, true);
});

test('pointer leaving keeps the tip while a star holds keyboard focus', () => {
  const { rating, radios } = mount({ help: HELP }); radios[0].focus(); pointer(rating.root, 'pointerleave'); assert.equal(tip(rating).hidden, false);
});

test('Escape and an outside pointerdown dismiss it; an inside pointerdown does not', () => {
  const { rating, radios } = mount({ help: HELP }); radios[0].focus(); assert.equal(tip(rating).hidden, false);
  pointer(rating.root, 'pointerdown'); assert.equal(tip(rating).hidden, false);
  key(radios[0], 'Escape'); assert.equal(tip(rating).hidden, true);
  radios[0].blur(); radios[0].focus(); assert.equal(tip(rating).hidden, false);
  pointer(document.body, 'pointerdown'); assert.equal(tip(rating).hidden, true);
});

test('activation dismisses it, and arrow moves do not bring it back until focus and pointer leave', () => {
  const { rating, radios } = mount({ help: HELP }); radios[0].focus(); assert.equal(tip(rating).hidden, false);
  key(radios[0], 'Enter'); assert.equal(tip(rating).hidden, true);
  key(radios[0], 'ArrowRight'); assert.equal(document.activeElement, radios[1]); assert.equal(tip(rating).hidden, true);
  radios[2].focus(); assert.equal(tip(rating).hidden, true); pointer(radios[2], 'pointerenter'); assert.equal(tip(rating).hidden, true);
  radios[2].blur(); radios[2].dispatchEvent(new window.FocusEvent('focusout', { bubbles: true, relatedTarget: null })); pointer(rating.root, 'pointerleave');
  radios[3].focus(); assert.equal(tip(rating).hidden, false);
});

test('a mouse click dismisses it and it stays shut while the pointer stays over the rating', () => {
  const { rating, radios } = mount({ help: HELP }); pointer(rating.root, 'pointerenter'); pointer(radios[0], 'pointerenter'); assert.equal(tip(rating).hidden, false);
  radios[0].click(); assert.equal(tip(rating).hidden, true); pointer(radios[1], 'pointerenter'); assert.equal(tip(rating).hidden, true);
  pointer(rating.root, 'pointerleave'); pointer(radios[1], 'pointerenter'); assert.equal(tip(rating).hidden, false);
});

test('dismissOnActivate false shows the tip on a trigger click', () => {
  const host = document.createElement('div'); const info = document.createElement('button'); host.append(info); document.body.append(host);
  const helper = tipMod.helpTip({ host, triggers: [info], text: 'Info', id: 'tip-2', dismissOnActivate: false });
  info.click(); assert.equal(helper.root.hidden, false); helper.dismiss(); assert.equal(helper.root.hidden, true); info.click(); assert.equal(helper.root.hidden, false);
});

test('the document listener lives only while the tip is shown, and destroy removes it', () => {
  const adds = []; const removes = [];
  const add = document.addEventListener.bind(document); const remove = document.removeEventListener.bind(document);
  document.addEventListener = (type, fn, ...rest) => { adds.push(type); return add(type, fn, ...rest); };
  document.removeEventListener = (type, fn, ...rest) => { removes.push(type); return remove(type, fn, ...rest); };
  try {
    const { rating, radios } = mount({ help: HELP }); assert.equal(adds.filter((type) => type === 'pointerdown').length, 0);
    radios[0].focus(); assert.equal(adds.filter((type) => type === 'pointerdown').length, 1);
    rating.destroy(); assert.equal(removes.filter((type) => type === 'pointerdown').length, 1);
    pointer(document.body, 'pointerdown'); radios[1].focus(); assert.equal(tip(rating), null);
  } finally { document.addEventListener = add; document.removeEventListener = remove; }
});

test('the modules use no innerHTML, eval, new Function, string timers or em dashes', () => {
  for (const file of ['star-rating.js', 'help-tip.js', 'star-rating.css', 'help-tip.css', 'rating-gallery.js']) {
    const source = readFileSync(new URL(`../../blocks/gcsp/kit/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /innerHTML|eval\(|new Function|setTimeout|setInterval/, file); assert.equal(source.includes('—'), false, `${file} em dash`);
  }
});

test('onRetry shows visible Rating not saved text and a Try again button only while failed, and calls it', () => {
  let calls = 0;
  const { rating } = mount({ value: 3, onRetry: () => { calls += 1; } });
  const failed = rating.root.querySelector('.gcsp-star-failed'); const retry = failed.querySelector('.vm-btn');
  assert.equal(retry.textContent, 'Try again'); assert.equal(retry.getAttribute('aria-label'), 'Try saving your rating again');
  assert.equal(failed.querySelector('span').textContent, 'Rating not saved'); assert.equal(failed.hidden, true); assert.equal(retry.type, 'button');
  rating.update({ value: 3, status: 'failed' }); assert.equal(failed.hidden, false);
  retry.click(); assert.equal(calls, 1);
  rating.update({ status: 'pending' }); assert.equal(failed.hidden, true);
  rating.update({ status: 'failed' }); assert.equal(failed.hidden, false);
  rating.update({ status: 'saved' }); assert.equal(failed.hidden, true);
});

test('without onRetry a failed rating adds no button', () => {
  const { rating } = mount({ value: 3 });
  rating.update({ status: 'failed' }); assert.equal(rating.root.querySelector('.vm-btn'), null);
});
