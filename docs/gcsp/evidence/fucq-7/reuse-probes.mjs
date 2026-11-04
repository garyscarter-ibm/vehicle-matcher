// Offline evidence for FUCQ-7. Synthetic cars exercise existing production code.
import { once } from 'node:events';
import { CARS } from '../../../../server/data.js';
import { rankCars, groupListings, matchCars } from '../../../../server/engine.js';
import { buildServer } from '../../../../server/index.js';
import { installDom } from '../../../../server/test/dom-harness.js';

const answers = {
  budget: [25000, 35000], bodyStyles: ['estate'], fuel: ['petrol'],
  charging: 'none', primaryUse: 'roadtrips', people: 'solo', mileage: 12000,
  style: '1', priorities: ['comfort', 'economy'],
};
const base = {
  ...CARS[0], id: 'probe-a', name: 'BMW Probe Touring', line: 'Probe',
  body: 'estate', fuel: 'petrol', priceMin: 30000, priceMax: 30000,
  seats: 5, boot: 560, zeroTo62: 7, sizeClass: 3, mpg: 48,
  tags: ['cruiser', 'efficient', 'practical'], transmission: 'auto',
  features: ['heatedSeats'], colour: 'Blue', mileage: 10000,
};
const describe = m => ({
  id: m.car.id, score: m.score, fit: m.fit, taste: m.taste,
  stretch: m.stretch, reasons: m.reasons, tradeOffs: m.tradeOffs,
});
const out = {
  inputs: 'Synthetic vehicles; existing deterministic engine and real card DOM; no upstream calls.',
};
out.softConstraints = rankCars(
  { ...answers, fuel: ['diesel'], bodyStyles: ['suv'] },
  [{ ...base, fuel: 'ev', evRange: 250 }],
).map(describe);
out.retailStretch = rankCars(answers, [{ ...base, priceMin: 39000, priceMax: 39000 }]).map(describe);
out.emptyEngine = matchCars(answers, []);
out.emptyEngineHasAlternatives = Object.hasOwn(out.emptyEngine, 'alternatives');

const siblings = [
  base,
  { ...base, id: 'probe-b', features: ['parkingCamera'], priceMin: 39000, priceMax: 39000, colour: 'Red' },
];
const scoredSiblings = rankCars(answers, siblings);
const grouped = groupListings(scoredSiblings)[0];
out.grouped = {
  individual: scoredSiblings.map(describe), union: grouped.car.features,
  listings: grouped.listings.map(c => ({ id: c.id, features: c.features, price: c.priceMin })),
};
installDom();
const { matchCard } = await import('../../../../blocks/vehicle-matcher/modes/result-card.js');
const card = matchCard(grouped, { big: true, brand: 'bmw' });
document.body.append(card);
card.querySelectorAll('.vm-pick-opt')[1].click();
out.selectedSecondListing = {
  scoreBadge: card.querySelector('.vm-score')?.textContent,
  specs: card.querySelector('.vm-specs')?.textContent,
  reasons: card.querySelector('.vm-reasons')?.textContent,
  actualScoreForSecondListing: scoredSiblings.find(m => m.car.id === 'probe-b').score,
};

const largePool = Array.from({ length: 13 }, (_, i) => ({
  ...base, id: `cap-${i}`, name: `BMW Probe ${String(i).padStart(2, '0')}`,
  line: `Probe ${i}`, features: i === 12 ? ['towbar'] : [],
}));
const capped = matchCars(answers, largePool);
out.resultCaps = {
  eligible: capped.searched.eligible, clusterSize: capped.clusterSize,
  shown: capped.matches.length, alternatives: capped.alternatives.length,
  towbarPresentInReturnedListings: [...capped.matches, ...capped.alternatives]
    .some(m => m.listings.some(c => c.features.includes('towbar'))),
};
const { likesToAnswers } = await import('../../../../blocks/vehicle-matcher/modes/match-signal.js');
out.inferredCharging = {
  before: answers.charging,
  after: likesToAnswers([{ ...base, fuel: 'ev' }, { ...base, fuel: 'ev' }], answers).charging,
};

const { createPreviewFeed, PREVIEW_DEBOUNCE_MS } = await import('../../../../blocks/vehicle-matcher/modes/preview-feed.js');
const originalFetch = globalThis.fetch;
let resolveFetch;
let callbackAfterCancel = false;
globalThis.fetch = () => new Promise(resolve => { resolveFetch = resolve; });
const preview = createPreviewFeed({ api: 'http://offline.invalid', brand: 'bmw' });
preview.schedule(answers, () => { callbackAfterCancel = true; });
await new Promise(resolve => setTimeout(resolve, PREVIEW_DEBOUNCE_MS + 20));
preview.cancel();
resolveFetch({ ok: true, json: async () => ({ matches: [] }) });
await new Promise(resolve => setTimeout(resolve, 20));
globalThis.fetch = originalFetch;
out.previewCallbackAfterCancel = callbackAfterCancel;

// Isolate the known empty-result API failure and abort its unanswered request.
let unhandled;
const capture = e => { unhandled = e.message; };
process.on('unhandledRejection', capture);
const server = buildServer({
  fetchRetailerStock: async () => [], fetchNearbyStock: async () => [],
  enrichColours: async (_brand, cars) => cars,
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/match`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brand: 'bmw', answers }), signal: AbortSignal.timeout(1000),
  });
  out.emptyApi = { status: response.status, body: await response.json() };
} catch (e) {
  out.emptyApi = { clientError: e.name, serverUnhandledRejection: unhandled };
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  process.removeListener('unhandledRejection', capture);
}
console.log(JSON.stringify(out, null, 2));
