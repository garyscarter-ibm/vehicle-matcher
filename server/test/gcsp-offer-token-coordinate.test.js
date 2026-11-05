import test from 'node:test';
import assert from 'node:assert/strict';
import { mintOfferToken, verifyOfferToken } from '../gcsp/offers/offer-token.js';

test('offer link carries the encoded public run coordinate while the token remains in its fragment', () => {
  const binding = { environmentId: 'trusted-environment', runId: 'run:earlier/a&b', offerId: 'offer:one/a&b' };
  const minted = mintOfferToken(binding);
  const url = new URL(minted.offerLink, 'https://configured-landing.invalid');
  assert.equal(url.origin, 'https://configured-landing.invalid');
  assert.equal(url.searchParams.get('runId'), binding.runId);
  assert.equal(url.searchParams.get('offerId'), binding.offerId);
  assert.equal(url.searchParams.has('token'), false);
  assert.equal(url.searchParams.has('environmentId'), false);
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  assert.equal(verifyOfferToken(token, binding, minted.tokenHash), true);
  assert.equal(JSON.stringify(minted.tokenMetadata).includes(token), false);
});

for (const key of ['environmentId', 'runId', 'offerId']) {
  test(`changing the public ${key} coordinate cannot authenticate the original token`, () => {
    const binding = { environmentId: 'trusted-environment', runId: 'run-original', offerId: 'offer-original' };
    const minted = mintOfferToken(binding);
    const token = new URLSearchParams(new URL(minted.offerLink, 'https://configured-landing.invalid').hash.slice(1)).get('token');
    assert.equal(verifyOfferToken(token, { ...binding, [key]: `${binding[key]}-changed` }, minted.tokenHash), false);
  });
}
