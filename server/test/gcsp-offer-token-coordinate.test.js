import test from 'node:test';
import assert from 'node:assert/strict';
import { mintOfferToken, verifyOfferToken, resolveOfferLandingUrl } from '../gcsp/offers/offer-token.js';

test('offer link carries the encoded public run coordinate while the token remains in its fragment', () => {
  const binding = { environmentId: 'trusted-environment', runId: 'run:earlier/a&b', offerId: 'offer:one/a&b' };
  const minted = mintOfferToken(binding);
  const url = new URL(minted.offerLink, 'https://configured-landing.invalid');
  assert.equal(url.origin, 'https://configured-landing.invalid');
  assert.equal(url.pathname, '/gcsp/offer');
  assert.equal(url.searchParams.get('runId'), binding.runId);
  assert.equal(url.searchParams.get('offerId'), binding.offerId);
  assert.equal(url.searchParams.has('token'), false);
  assert.equal(url.searchParams.has('environmentId'), false);
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  assert.equal(verifyOfferToken(token, binding, minted.tokenHash), true);
  assert.equal(JSON.stringify(minted.tokenMetadata).includes(token), false);
});

for (const offerLandingUrl of ['/employee/offers/review.html?brand=mini', 'https://static.example/gcsp/review.html?brand=mini']) {
  test(`trusted landing configuration preserves destination and public coordinates (${offerLandingUrl})`, () => {
    const binding = { environmentId: 'trusted-environment', runId: 'run:earlier/a&b', offerId: 'offer:one/a&b' };
    const minted = mintOfferToken(binding, { offerLandingUrl });
    assert.equal(minted.offerLink.startsWith('/'), offerLandingUrl.startsWith('/'));
    const expected = new URL(offerLandingUrl, 'https://local.example');
    const url = new URL(minted.offerLink, 'https://local.example');
    assert.equal(url.origin, expected.origin); assert.equal(url.pathname, expected.pathname);
    assert.equal(url.searchParams.get('brand'), 'mini');
    assert.equal(url.searchParams.get('runId'), binding.runId); assert.equal(url.searchParams.get('offerId'), binding.offerId);
    assert.deepEqual([...url.searchParams.keys()].sort(), ['brand', 'offerId', 'runId']);
    const token = new URLSearchParams(url.hash.slice(1)).get('token');
    assert.equal(verifyOfferToken(token, binding, minted.tokenHash), true);
    assert.equal(verifyOfferToken(token, { ...binding, environmentId: 'another-environment' }, minted.tokenHash), false);
    assert.equal(minted.offerLink.split('#')[0].includes(token), false);
    assert.equal(JSON.stringify(minted.tokenMetadata).includes(token), false);
  });
}

test('landing configuration cannot replace token custody or supply public offer coordinates', () => {
  for (const value of ['', null, 'gcsp-offer.html', '//foreign.example/offer', 'http://static.example/offer',
    'javascript:alert(1)', 'https://user:secret@static.example/offer', '/offer#token=old',
    '/offer?token=old', '/offer?offerId=old', '/offer?runId=old', '/offer\\\\elsewhere', '/offer\n']) {
    assert.throws(() => resolveOfferLandingUrl(value), { name: 'TypeError' });
  }
});

for (const key of ['environmentId', 'runId', 'offerId']) {
  test(`changing the public ${key} coordinate cannot authenticate the original token`, () => {
    const binding = { environmentId: 'trusted-environment', runId: 'run-original', offerId: 'offer-original' };
    const minted = mintOfferToken(binding);
    const token = new URLSearchParams(new URL(minted.offerLink, 'https://configured-landing.invalid').hash.slice(1)).get('token');
    assert.equal(verifyOfferToken(token, { ...binding, [key]: `${binding[key]}-changed` }, minted.tokenHash), false);
  });
}
