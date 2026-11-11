import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, resetDom } from './dom-harness.js';
import { mediaGallery } from '../../blocks/gcsp/kit/media-gallery.js';
import { readFile } from 'node:fs/promises';

const catalogue = JSON.parse(await readFile(new URL('../data/gcsp/vehicle-evidence/display-images.v1.json', import.meta.url)));
const fallback = catalogue.configurations.slice(0, 3).map((row, index) => ({ src: `/${row.image.asset}`, fidelity: row.image.fidelity, label: ['Front exterior', 'Rear exterior', 'Interior'][index] }));
const images = () => Object.values(catalogue.galleries ?? {})[0]?.map((image) => ({ src: `/${image.asset}`, fidelity: image.fidelity, label: image.label })) ?? fallback;
let dom;
before(() => { dom = installDom(); });
after(() => dom.window.close());
beforeEach(() => resetDom());
const mount = (supplied = images()) => {
  const gallery = mediaGallery({ name: 'BMW 3 Series Touring with a long Individual specification', images: supplied });
  const scope = document.createElement('main'); scope.className = 'gcsp'; scope.append(gallery.root); document.body.append(scope);
  gallery.root.querySelector('.vm-card-photo')?.dispatchEvent(new window.Event('load'));
  return gallery;
};

test('thumbnail changes the feature in place and magnifier opens that selected view', () => {
  const gallery = mount();
  gallery.root.querySelectorAll('.gcsp-media-gallery-thumbs button')[1].click();
  const feature = gallery.root.querySelector('.gcsp-media-gallery-feature .vm-card-photo');
  feature.dispatchEvent(new window.Event('load'));
  assert.equal(feature.getAttribute('src'), images()[1].src);
  assert.match(feature.alt, /rear exterior/i);
  const opener = gallery.root.querySelector('.gcsp-media-gallery-enlarge');
  opener.click();
  const dialog = gallery.root.querySelector('dialog');
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector('img').getAttribute('src'), images()[1].src);
  assert.equal(dialog.querySelector('.gcsp-media-gallery-position').textContent, '2 of 3');
  assert.equal(dialog.querySelectorAll('[aria-pressed="true"]').length, 1);
  gallery.destroy();
});

test('viewer arrow keys wrap, strip synchronizes, focus is contained and Escape restores opener', () => {
  const gallery = mount();
  const opener = gallery.root.querySelector('.gcsp-media-gallery-enlarge'); opener.focus(); opener.click();
  const dialog = gallery.root.querySelector('dialog');
  dialog.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.equal(gallery.selectedIndex, 2);
  assert.equal(dialog.querySelector('.gcsp-media-gallery-position').textContent, '3 of 3');
  dialog.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(gallery.selectedIndex, 0);
  const last = [...dialog.querySelectorAll('button')].at(-1); last.focus();
  last.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(document.activeElement, dialog.querySelector('.gcsp-media-gallery-close'));
  dialog.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(dialog.open, false); assert.equal(document.activeElement, opener);
  gallery.destroy();
});

test('empty and single galleries have useful image fallbacks and no phantom navigation', () => {
  const empty = mount([]);
  assert.match(empty.root.textContent, /No image for this car yet/);
  assert.equal(empty.root.querySelector('button'), null);
  const single = mount(images().slice(0, 1));
  assert.equal(single.root.querySelector('.gcsp-media-gallery-thumbs'), null);
  single.root.querySelector('.gcsp-media-gallery-enlarge').click();
  assert.equal(single.root.querySelector('.gcsp-media-gallery-previous'), null);
  assert.equal(single.root.querySelector('.gcsp-media-gallery-next'), null);
  assert.equal(single.root.querySelector('.gcsp-media-gallery-strip'), null);
  single.destroy(); empty.destroy();
});

test('broken image hides magnifier and broken icons while other views remain selectable', () => {
  const gallery = mount();
  gallery.root.querySelector('.gcsp-media-gallery-feature .vm-card-photo').dispatchEvent(new window.Event('error'));
  assert.equal(gallery.root.querySelector('.gcsp-media-gallery-enlarge').hidden, true);
  assert.equal(gallery.root.querySelector('.gcsp-media-gallery-feature .vm-card-photo'), null);
  assert.match(gallery.root.textContent, /Image unavailable/);
  gallery.root.querySelectorAll('.gcsp-media-gallery-thumbs button')[1].click();
  gallery.root.querySelector('.gcsp-media-gallery-feature .vm-card-photo').dispatchEvent(new window.Event('load'));
  assert.equal(gallery.root.querySelector('.gcsp-media-gallery-enlarge').hidden, false);
  gallery.destroy();
});

test('unknown remote and falsely exact sources cannot enter a gallery', () => {
  const gallery = mount([{ src: 'https://private.invalid/signed?key=secret', fidelity: 'exact' }]);
  assert.equal(gallery.root.querySelector('img'), null);
  assert.equal(gallery.root.querySelector('button'), null);
  gallery.destroy();
});
