import assert from 'node:assert/strict';
import { mapVehicle } from '../mapping.js';
import { rankCars, TOP_MATCHES, MAX_SHOWN, ALTERNATIVES, CLUSTER_PTS, LISTING_SAMPLE } from '../engine.js';
import { brandTuning } from '../brands.js';
import { applyBespokeAnswers } from '../questions.js';
import { PREVIEW_COUNT, FIELD_MAX } from '../index.js';
import { startTestServer } from './helpers.js';

export function frozen(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}

export function poolsFor(input) {
  const pools = structuredClone(input.mapped);
  for (const brand of ['bmw', 'mini']) pools[brand] = input.raw[brand].map((v) => mapVehicle(v, brand));
  const exemplar = pools.bmw.find((c) => c.line === 'X3');
  pools.limits = Array.from({ length: 13 }, (_, group) => Array.from(
    { length: group === 0 ? 26 : 1 }, (_, member) => ({
      ...structuredClone(exemplar),
      id: `limit-${String(group + 1).padStart(2, '0')}-${member + 1}`,
      name: `Equal group ${String(group + 1).padStart(2, '0')}`,
      line: `Equal ${String(group + 1).padStart(2, '0')}`,
      priceMin: 30000 + member,
      priceMax: 30000 + member,
      features: member === 25 ? ['towbar'] : ['heatedSeats'],
      link: `https://stock.example.test/vehicle/limit-${group + 1}-${member + 1}`,
    }),
  )).flat();
  return pools;
}

export const groupIdentity = (c) => [c.line, c.body, c.fuel, c.zeroTo62, c.styleLine ?? ''].join('|');
export const rankProjection = (m) => ({
  id: m.car.id, group: groupIdentity(m.car), score: m.score, fit: m.fit, taste: m.taste,
  stretch: m.stretch, reasons: m.reasons, tradeOffs: m.tradeOffs,
});

export function correctBehaviourProjection(value) {
  if (Array.isArray(value)) return value.map(correctBehaviourProjection);
  if (!value || typeof value !== 'object') return value;
  const out = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, correctBehaviourProjection(v)]));
  const tourer = value.car?.body === 'tourer' || (typeof value.group === 'string' && value.group.includes('|tourer|'));
  if (tourer && Array.isArray(value.reasons)) {
    out.reasons = value.reasons.map((reason) => ['The undefined shape you asked for', 'The tourer shape you asked for'].includes(reason)
      ? '[tourer body-match explanation: correction boundary]' : reason);
  }
  return out;
}

export async function captureRetailContract(input) {
  assert.equal(Number(process.env.TASTE_SHARE ?? 0.2), input.tasteShare,
    'Retail baseline requires TASTE_SHARE=0.2 (80/20). Use the captured configuration; do not retune expectations.');
  assert.ok(!process.env.DEMO_ACCESS_KEY, 'Run the offline baseline without DEMO_ACCESS_KEY; do not expose its value.');
  const pools = poolsFor(input);
  const out = {};
  out.mapping = Object.fromEntries(['bmw', 'mini'].map((brand) => [brand, pools[brand]]));
  out.limits = { TOP_MATCHES, MAX_SHOWN, ALTERNATIVES, CLUSTER_PTS, LISTING_SAMPLE, PREVIEW_COUNT, FIELD_MAX };
  let selectedPool;
  let nearbyMode = 'stock';
  const calls = [];
  const server = await startTestServer({
    fetchRetailerStock: async (brand, retailer, scope) => {
      calls.push({ dependency: 'stock', brand, retailer, scope });
      return structuredClone(pools[selectedPool || brand]);
    },
    fetchNearbyStock: async (brand, retailer) => {
      calls.push({ dependency: 'nearby', brand, retailer });
      if (nearbyMode === 'failure') throw new Error('fixed offline nearby failure');
      if (nearbyMode === 'empty') return [];
      return structuredClone(pools[brand]);
    },
    enrichColours: async (brand, cars) => {
      calls.push({ dependency: 'enrich', brand, ids: cars.map((c) => c.id) });
      for (const c of cars) c.colour = { colour: 'Blue', manufacturerColour: `Fixture Blue ${c.id}` };
      return cars;
    },
    fetchDealerDirectory: async () => {
      calls.push({ dependency: 'directory' });
      return new Map(input.location.directory);
    },
    geocodePostcode: async (postcode) => {
      calls.push({ dependency: 'geocode', postcode });
      if (postcode === 'FAIL') throw new Error('fixed offline geocoder failure');
      return postcode === input.location.postcode ? structuredClone(input.location.place) : null;
    },
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    assert.equal(new URL(url).origin, server.base, `Offline baseline blocked unexpected fetch origin: ${new URL(url).origin}`);
    return nativeFetch(url, init);
  };
  const request = async (key, path, body) => {
    calls.length = 0;
    const res = await fetch(`${server.base}${path}`, {
      method: body ? 'POST' : 'GET',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(3000),
    });
    out[key] = JSON.parse(JSON.stringify({
      request: { method: body ? 'POST' : 'GET', path, ...(body ? { body } : {}) },
      response: { status: res.status, body: await res.json() }, calls,
    }));
    return out[key].response.body;
  };
  try {
    for (const brand of ['bmw', 'mini', 'ford', 'honda', 'motorrad', 'ferrari']) {
      await request(`${brand}/questions`, `/api/questions?brand=${brand}`);
      await request(`${brand}/pool`, `/api/pool?brand=${brand}&scope=national&retailer=fixture-retailer`);
    }
    for (const c of input.cases) {
      selectedPool = c.pool;
      const answers = applyBespokeAnswers(c.brand, c.answers);
      out[`${c.id}/rank`] = {
        foldedAnswers: answers,
        ranked: rankCars(answers, pools[c.pool || c.brand], brandTuning(c.brand)).map(rankProjection),
      };
      const body = { brand: c.brand, retailer: 'fixture-retailer', scope: 'national', answers: c.answers };
      await request(`${c.id}/match`, '/api/match', body);
      if (['bmw-partial', 'mini-partial', 'bmw-limit-tie'].includes(c.id)) {
        await request(`${c.id}/preview-listings`, '/api/preview', body);
        await request(`${c.id}/preview-groups`, '/api/preview', { ...body, group: true });
        await request(`${c.id}/field-default`, '/api/field', body);
        await request(`${c.id}/field-clamped`, '/api/field', { ...body, size: 999 });
        await request(`${c.id}/field-two-enriched`, '/api/field', { ...body, size: 2, enrich: true });
      }
      if (c.id.endsWith('rescue') || c.id === 'bmw-contradictory') await request(`${c.id}/nearby`, '/api/nearby', body);
    }
    selectedPool = undefined;
    const nearbyBody = { brand: 'mini', answers: input.cases.find((c) => c.id === 'mini-contradictory-rescue').answers };
    nearbyMode = 'failure';
    await request('nearby/failure', '/api/nearby', nearbyBody);
    nearbyMode = 'empty';
    await request('nearby/confirmed-empty', '/api/nearby', nearbyBody);
    await request('defaults/pool-invalid-brand-scope', '/api/pool?brand=unknown&scope=typo');
    await request('defaults/match-legacy-band', '/api/match', { answers: input.hashes[0].answers });
    for (const h of input.hashes) {
      await request(`${h.id}/match`, '/api/match', { brand: h.brand, answers: h.answers });
    }
    await request('validation/missing-answers', '/api/preview', {});
    await request('validation/invalid-budget', '/api/field', { answers: { budget: 'invalid' } });
    await request('health', '/health');
    for (const postcode of [input.location.postcode, 'INVALID', 'FAIL']) {
      await request(`geocode/${postcode}`, `/api/geocode?postcode=${encodeURIComponent(postcode)}`);
    }
  } finally {
    globalThis.fetch = nativeFetch;
    await server.close();
  }
  return correctBehaviourProjection(JSON.parse(JSON.stringify(out)));
}
