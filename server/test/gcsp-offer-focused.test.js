import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, resetDom } from './dom-harness.js';
import { createOfferView } from '../../blocks/gcsp/offer/offer-view.js';
import { offerFixture } from '../../blocks/gcsp/offer/fixtures.js';
import { mediaGallery } from '../../blocks/gcsp/kit/media-gallery.js';

let dom;
before(() => { dom = installDom(); });
after(() => dom.window.close());
beforeEach(() => resetDom());
function mount(change = () => {}) {
  const root = document.createElement('div'); document.body.append(root);
  const model = { ...offerFixture('fuller-offer').value, canReviewAccept: true, canDecline: true, countdown: '2:00' };
  change(model);
  const view = createOfferView(root, { links: { cars: '/gcsp-account.html' } }); view.update(model);
  return { root, view, model };
}

test('the full supplied comparison has four benefits and five tradeoffs without a pending footer', () => {
  const { root, view } = mount();
  assert.equal(root.querySelectorAll('.gcsp-highlight-benefits .gcsp-highlight').length, 4);
  assert.equal(root.querySelectorAll('.gcsp-highlight-tradeoffs .gcsp-highlight').length, 5);
  assert.match(root.querySelector('.gcsp-highlight-benefits').textContent, /300 fewer points.*Available by Tuesday 1 December 2026.*body style.*fuel preference/);
  assert.match(root.querySelector('.gcsp-highlight-tradeoffs').textContent, /30 litres less.*Less sporty.*Less comfortable.*More economical than you prefer.*Larger/);
  assert.equal(root.querySelector('[data-offer-action="refresh"]'), null);
  assert.doesNotMatch(root.textContent, /Buddy history|Check current state/);
  assert.equal(root.querySelector('[data-offer-action="accept"]').textContent, 'Review & accept');
  assert.equal(root.querySelector('.gcsp-offer-header a').getAttribute('href'), '/gcsp-account.html');
  assert.equal(root.querySelector('.gcsp-vehicle-summary .gcsp-countdown').textContent, '2h 00m');
  assert.deepEqual([...root.querySelectorAll('td.is-winner')].map((cell) => cell.textContent), ['295 points', '440 litres']);
  view.destroy();
});

test('four overview facts retain the full specification and all equipment in native disclosures', () => {
  const { root, view } = mount((model) => {
    model.card.members[0].facts.push({ label: 'Unusual supplied fact', value: 'Retain this value' });
    model.card.members[0].facts.find((fact) => fact.label === 'Options').items = Array.from({ length: 41 }, (_, index) => `Equipment ${index + 1}`);
  });
  assert.equal(root.querySelectorAll('.gcsp-vehicle-overview dt').length, 4);
  const spec = root.querySelector('.gcsp-vehicle-specification');
  assert.equal(spec.open, false); assert.match(spec.textContent, /Unusual supplied factRetain this value/);
  const equipment = root.querySelector('.gcsp-vehicle-equipment');
  assert.equal(equipment.open, false); assert.equal(equipment.querySelectorAll('li').length, 41);
  view.destroy();
});

test('the exact deadline uses UK local time and the grouped timer updates without resetting gallery selection', () => {
  const { root, view, model } = mount((model) => { model.expiresAt = '2027-06-21T12:30:00.000Z'; });
  assert.match(root.querySelector('.gcsp-decision-deadline').textContent, /Held until 13:30.*Monday,? 21 June 2027/);
  const gallery = root.querySelector('.gcsp-media-gallery');
  const rear = gallery.querySelectorAll('.gcsp-media-gallery-thumbs button')[1]; rear.click(); rear.focus();
  view.update({ ...model, now: '2027-06-21T10:31:00.000Z', countdown: '1:59' });
  assert.equal(root.querySelector('.gcsp-media-gallery'), gallery);
  assert.equal(rear.getAttribute('aria-pressed'), 'true'); assert.equal(document.activeElement, rear);
  assert.equal(root.querySelector('.gcsp-countdown').textContent, '1h 59m');
  assert.equal(gallery.querySelector('.vm-card-photo').alt, model.card.members[0].media.images[1].alt);
  view.destroy();
});

test('image-only pickers retain names and synchronized selection while the existing gallery default retains captions', () => {
  const images = offerFixture('fuller-offer').value.card.members[0].media.images;
  const gallery = mediaGallery({ name: 'BMW Touring', images, presentation: 'picker', fit: 'contain' });
  document.body.append(gallery.root);
  const buttons = [...gallery.root.querySelectorAll('.gcsp-media-gallery-thumbs button')];
  assert.deepEqual(buttons.map((button) => button.textContent), ['', '', '']);
  assert.deepEqual(buttons.map((button) => button.getAttribute('aria-label')), images.map((image) => `${image.label} of BMW Touring`));
  buttons[2].click(); gallery.root.querySelector('.gcsp-media-gallery-enlarge').click();
  assert.equal(gallery.root.querySelector('dialog img').getAttribute('src'), images[2].src);
  assert.equal(gallery.root.querySelector('dialog [aria-pressed="true"]').getAttribute('aria-label'), 'Interior of BMW Touring');
  const original = mediaGallery({ name: 'BMW Touring', images });
  assert.deepEqual([...original.root.querySelectorAll('.gcsp-media-gallery-thumbs button')].map((button) => button.textContent), images.map((image) => image.label));
  gallery.destroy(); original.destroy();
});

test('the fuller offer uses the shared white paint and black upholstery mapping without fixture-only shades', () => {
  const { root, view, model } = mount();
  assert.ok(model.card.members[0].facts.filter((fact) => ['Colour', 'Interior'].includes(fact.label)).every((fact) => fact.shade === undefined));
  const finishes = [...root.querySelectorAll('.gcsp-vehicle-summary .gcsp-finish')];
  assert.deepEqual(finishes.map((node) => node.textContent), ['Alpine White', 'Black Veganza']);
  assert.deepEqual(finishes.map((node) => node.querySelector('span').style.backgroundColor), ['rgb(244, 244, 242)', 'rgb(29, 29, 31)']);
  view.destroy();
});
