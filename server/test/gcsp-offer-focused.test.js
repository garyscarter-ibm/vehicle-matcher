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

test('four overview facts lead to the full specification and all equipment in one details drawer', () => {
  const { root, view } = mount((model) => {
    model.card.members[0].facts.push({ label: 'Unusual supplied fact', value: 'Retain this value' });
    model.card.members[0].facts.find((fact) => fact.label === 'Options').items = Array.from({ length: 41 }, (_, index) => `Equipment ${index + 1}`);
  });
  assert.equal(root.querySelectorAll('.gcsp-vehicle-overview dt').length, 4);
  const entry = root.querySelector('.gcsp-vehicle-details-entry');
  assert.match(entry.textContent, /Full specification.*41 selected equipment items/);
  assert.equal(root.querySelector('.gcsp-vehicle-disclosures'), null);
  assert.equal(root.querySelector('[role="dialog"]'), null); entry.click();
  const spec = root.querySelector('.gcsp-vehicle-specification');
  assert.equal(spec.hidden, false); assert.match(spec.textContent, /Unusual supplied factRetain this value/);
  const equipment = root.querySelector('.gcsp-vehicle-equipment');
  assert.equal(equipment.hidden, true); assert.equal(equipment.querySelectorAll('li').length, 41);
  root.querySelector('[role="tab"][aria-controls="'+equipment.id+'"]').click(); assert.equal(equipment.hidden, false);
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
  assert.deepEqual(finishes.map((node) => node.querySelector('.gcsp-finish-value').textContent), ['Alpine White', 'Black Veganza']);
  assert.deepEqual(finishes.map((node) => node.querySelector('span').style.backgroundColor), ['rgb(244, 244, 242)', 'rgb(29, 29, 31)']);
  view.destroy();
});

test('long supplied finishes retain their values with distinct paint and upholstery labels', () => {
  const long = 'M Alcantara Veganza combination Black contrast stitching';
  const { root, view } = mount((model) => {
    model.card.members[0].display.name = 'BMW X2 M35i in Black Sapphire';
    model.card.members[0].facts.find((fact) => fact.label === 'Interior').value = long;
  });
  assert.equal(root.querySelector('.gcsp-vehicle-title').textContent, 'BMW X2 M35i in Black Sapphire');
  assert.deepEqual([...root.querySelectorAll('.gcsp-vehicle-summary .gcsp-finish-label')].map((node) => node.textContent), ['Paint', 'Upholstery']);
  assert.equal(root.querySelectorAll('.gcsp-vehicle-summary .gcsp-finish-value')[1].textContent, long);
  view.destroy();
});

test('details keyboard navigation, dismissal and reopen retain equipment and restore focus', () => {
  const { root, view } = mount((model) => { model.card.members[0].facts.find((fact) => fact.label === 'Options').items = Array.from({ length: 57 }, (_, i) => `Equipment ${i + 1}`); });
  const entry = root.querySelector('.gcsp-vehicle-details-entry'); entry.focus(); entry.click();
  const dialog = root.querySelector('[role="dialog"]');
  assert.equal(document.activeElement, dialog.querySelector('h2'));
  assert.equal(entry.hasAttribute('inert'), true); assert.equal(document.body.style.overflow, 'hidden');
  const first = dialog.querySelector('[role="tab"]'); first.focus();
  first.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(document.activeElement.textContent, 'Selected equipment (57)');
  assert.equal(dialog.querySelector('.gcsp-vehicle-equipment').hidden, false);
  assert.equal(dialog.querySelectorAll('.gcsp-vehicle-equipment li').length, 57);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(root.querySelector('[role="dialog"]'), null); assert.equal(document.activeElement, entry);
  assert.equal(entry.hasAttribute('inert'), false); assert.equal(document.body.style.overflow, '');
  entry.click(); assert.equal(root.querySelectorAll('.gcsp-vehicle-equipment li').length, 57);
  root.querySelector('.gcsp-side-drawer-backdrop').click(); assert.equal(document.activeElement, entry);
  entry.click(); root.querySelector('.gcsp-side-drawer-head button').click(); assert.equal(document.activeElement, entry);
  view.destroy();
});

test('clock reads preserve an open details tab; changed or terminal offers close it and teardown releases modal state', () => {
  const { root, view, model } = mount(); root.querySelector('.gcsp-vehicle-details-entry').click();
  root.querySelectorAll('[role="tab"]')[1].click(); const dialog = root.querySelector('[role="dialog"]');
  const equipment = root.querySelectorAll('[role="tab"]')[1]; equipment.focus();
  view.update({ ...model, countdown: '1:59' });
  assert.equal(root.querySelector('[role="dialog"]'), dialog); assert.equal(document.activeElement, equipment);
  assert.equal(equipment.getAttribute('aria-selected'), 'true');
  for (const state of ['expired', 'accepted', 'restarted', 'access-lapsed']) {
    view.update({ ...model, state }); assert.equal(root.querySelector('[role="dialog"]'), null);
    assert.equal(document.body.style.overflow, ''); assert.equal(document.querySelectorAll('[inert]').length, 0);
    view.update(model); root.querySelector('.gcsp-vehicle-details-entry').click();
  }
  const changed = structuredClone(model); changed.card.members[0].display.name = 'Changed exact car'; view.update(changed);
  assert.equal(root.querySelector('[role="dialog"]'), null);
  root.querySelector('.gcsp-vehicle-details-entry').click(); view.destroy();
  assert.equal(document.body.style.overflow, ''); assert.equal(document.querySelectorAll('[inert]').length, 0);
});

test('missing equipment and finishes remain explicitly unknown in car details', () => {
  const { root, view } = mount((model) => { model.card.members[0].facts = model.card.members[0].facts.filter((fact) => !['Options', 'Colour', 'Interior'].includes(fact.label)); });
  const entry = root.querySelector('.gcsp-vehicle-details-entry'); assert.match(entry.textContent, /Equipment not supplied/); entry.click();
  assert.match(root.querySelector('.gcsp-vehicle-summary').textContent, /Paint not supplied.*Upholstery not supplied/);
  assert.doesNotMatch(root.querySelector('.gcsp-vehicle-specification').textContent, /Not supplied/);
  root.querySelectorAll('[role="tab"]')[1].click();
  assert.equal(root.querySelector('.gcsp-vehicle-equipment').textContent, 'Equipment not supplied.');
  assert.doesNotMatch(root.querySelectorAll('[role="tab"]')[1].textContent, /\(0\)/);
  view.destroy();
});
