import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
let dom; let activityOffer; let NO_IMAGE_TEXT;
before(async () => { dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true }); globalThis.document = dom.window.document;
  ({ activityOffer } = await import('../../blocks/gcsp/activity/activity-offer.js'));
  ({ NO_IMAGE_TEXT } = await import('../../blocks/gcsp/kit/plain-copy.js')); });
after(() => dom?.window.close()); beforeEach(() => document.body.replaceChildren());
const picture = { src: '/assets/brand-hero/bmw.jpg', alt: 'BMW brand scene', kind: 'representative' };
test('no offer and absent imagery stay meaningful; untrusted network sources never become images', () => {
  assert.equal(activityOffer(), null, 'no offer draws nothing');
  const bad = activityOffer({ offer: { state: 'active' }, display: { title: 'BMW offer', images: [{ ...picture, src: 'https://remote.example/car.jpg' }] } });
  assert.equal(bad.querySelector('img'), null); assert.match(bad.textContent, /No image for this car yet/); assert.match(bad.textContent, /found a car/);
  const falseExact = activityOffer({ offer: { state: 'active' }, display: { images: [{ ...picture, kind: 'exact' }] } });
  assert.equal(falseExact.querySelector('img'), null); assert.match(falseExact.textContent, /No image for this car yet/);
  assert.equal(NO_IMAGE_TEXT, 'No image for this car yet'); assert.equal(falseExact.querySelector('.vm-card-soon').textContent, NO_IMAGE_TEXT);
  assert.doesNotMatch(bad.textContent, /Image unavailable/);
});
test('multiple representative images use native controls; failed image removes false alt/caption without losing offer facts', () => {
  const display = { title: 'Synthetic BMW offer', images: [picture, { ...picture }] };
  const original = structuredClone(display); const node = activityOffer({ offer: { state: 'active' }, display }); document.body.append(node);
  assert.doesNotMatch(node.textContent, /Representative/); assert.equal(node.querySelectorAll('[data-image]').length, 2);
  const second = node.querySelector('[data-image="1"]'); second.focus(); second.click();
  assert.equal(document.activeElement, second); assert.equal(second.getAttribute('aria-pressed'), 'true');
  assert.equal(node.querySelector('img').alt, picture.alt);
  node.querySelector('img').dispatchEvent(new dom.window.Event('error'));
  assert.equal(node.querySelector('img'), null); assert.equal(node.querySelector('.vm-media-caption'), null);
  assert.match(node.textContent, /Synthetic BMW offer/); assert.match(node.textContent, /No image for this car yet/); assert.deepEqual(display, original);
});
const I5 = '/assets/gcsp-vehicle-evidence/fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe.webp';
const corpus = { src: I5, alt: 'i5 Touring', fidelity: 'representative-configuration' };
test('approved corpus images render with only a supplied caption; unapproved src or wrong fidelity stay placeholders', () => {
  const ok = activityOffer({ offer: { state: 'active' }, display: { images: [corpus] } });
  assert.equal(ok.querySelector('img').getAttribute('src'), I5);
  assert.equal(ok.querySelector('.vm-media-caption'), null);
  const own = activityOffer({ offer: { state: 'active' }, display: { images: [{ ...corpus, caption: 'Reviewed caption' }] } });
  assert.match(own.textContent, /Reviewed caption/);
  for (const image of [{ ...corpus, src: '/assets/gcsp-vehicle-evidence/other.webp' }, { ...corpus, fidelity: undefined },
    { ...corpus, fidelity: 'exact' }, { ...corpus, fidelity: undefined, kind: 'exact' }]) {
    const node = activityOffer({ offer: { state: 'active' }, display: { images: [image] } });
    assert.equal(node.querySelector('img'), null); assert.match(node.textContent, /No image for this car yet/);
  }
});
test('client image allowlist mirrors the server approved corpus exactly', async () => {
  const { APPROVED_CORPUS_IMAGES } = await import('../../server/gcsp/vehicle-evidence/registered-corpus-images.js');
  const { approvedImages } = await import('../../blocks/gcsp/activity/activity-offer.js');
  const client = [...approvedImages].filter(([, fidelity]) => fidelity !== 'representative').sort();
  assert.deepEqual(client, APPROVED_CORPUS_IMAGES.map((image) => [`/${image.asset}`, image.fidelity]).sort());
});

test('new Touring catalogue imagery reaches activity without admitting unreviewed paths or false exact claims', async () => {
  const { modelDisplayImage } = await import('../gcsp/vehicle-evidence/display-images.js');
  const image = await modelDisplayImage('G21 Touring|320i');
  const display = { title: 'BMW 3 Series Touring 320i', images: [{ src: `/${image.asset}`, alt: 'BMW 3 Series Touring', fidelity: image.fidelity }] };
  const node = activityOffer({ offer: { state: 'active' }, display });
  assert.equal(node.querySelector('img')?.getAttribute('src'), display.images[0].src);
  const falseExact = structuredClone(display); falseExact.images[0].fidelity = 'exact';
  assert.equal(activityOffer({ offer: { state: 'active' }, display: falseExact }).querySelector('img'), null);
});
