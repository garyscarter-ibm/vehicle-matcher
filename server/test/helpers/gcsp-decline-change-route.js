// Drives the decline, one confirmed change and second offer journey through the actual HTTP routes.
import assert from 'node:assert/strict';

const good = (response) => { assert.equal(response.status, 200, JSON.stringify(response.json)); assert.equal(response.json.status, 'ok', JSON.stringify(response.json)); return response.json.value; };

// A small cookie jar keyed by cookie name, so presenter and employee sessions coexist.
export function createRouteClient({ fetch, origin }) {
  const jar = new Map();
  const absorb = (lines) => {
    for (const line of lines) {
      const [pair] = line.split(';'); const at = pair.indexOf('=');
      if (pair.slice(at + 1) === '') jar.delete(pair.slice(0, at)); else jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
  };
  const request = async (url, body, { method = body === undefined ? 'GET' : 'POST' } = {}) => {
    // Reset and tick run the real release and allocation, which can exceed the fixture's default bound.
    const response = await fetch(`${origin}${url}`, { timeoutMs: 60000, method, headers: { Origin: origin,
      Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    absorb(response.headers.getSetCookie?.() ?? []);
    return { status: response.status, json: await response.json() };
  };
  return { request, seed: absorb, cookie: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
}

export async function resetIntoDecline(client, commandId) {
  const catalogue = good(await client.request('/api/gcsp/presenter/scenarios'));
  const entry = catalogue.scenarios.find((row) => row.scenarioId === 'decline-then-change');
  assert.equal(entry.availability.available, true);
  const current = good(await client.request('/api/gcsp/presenter/scenarios/current'));
  const reset = good(await client.request('/api/gcsp/presenter/scenarios/reset', { commandId, expectedRunId: current.runId,
    expectedRunVersion: current.runVersion, scenarioId: entry.scenarioId, scenarioVersion: entry.scenarioVersion,
    fixtureVersion: entry.fixtureVersion, policyVersion: entry.policyVersion }));
  return { entry, reset };
}

// Presenter tick through the presenter controls route (advance then tick, one command).
export async function presenterTick(client, commandId, mode = { mode: 'step' }) {
  const state = good(await client.request('/api/gcsp/presenter/controls'));
  return good(await client.request('/api/gcsp/presenter/controls/tick', { commandId, expectedClockVersion: state.clockVersion, ...mode }));
}

/** Reset, then Paula declines, confirms one change, the presenter ticks and the second offer arrives. */
export async function runDeclineChangeRoute(client, { label, tick = { mode: 'step' }, change }) {
  const { entry, reset } = await resetIntoDecline(client, `${label}-reset`);
  assert.equal(reset.startState.status, 'ok', JSON.stringify(reset.startState));
  const runId = reset.runId;
  good(await client.request('/api/gcsp/session/switch', { principalId: 'demo-paula', commandId: `${label}-paula` }));
  const first = good(await client.request('/api/gcsp/offers/current'));
  const firstOffer = first.offers.find((offer) => offer.runId === runId && offer.offerId === reset.startState.firstOfferId);
  assert.ok(firstOffer, 'Paula holds the first offer produced by the actual services');
  const query = `?runId=${encodeURIComponent(runId)}`; const path = `/api/gcsp/offers/${encodeURIComponent(firstOffer.offerId)}`;
  const before = good(await client.request(path + query));
  const reasons = good(await client.request(`${path}/decision-reasons${query}`));
  assert.ok(reasons.reasons.some((reason) => reason.code === 'body-style'));
  const decision = good(await client.request(`${path}/decision`, { commandId: `${label}-decline`, runId, decision: 'decline',
    expectedOfferVersion: before.offerVersion, expectedHoldVersion: before.holdVersion,
    expectedQuoteVersion: before.quote.revisions.quote, reasonCode: 'body-style' }));
  const reloaded = good(await client.request(path + query));
  const selector = `?decisionId=${encodeURIComponent(reloaded.followup.decisionId)}`;
  const question = good(await client.request(`/api/gcsp/offer-followup${selector}`));
  assert.equal(question.state, 'question');
  const saved = good(await client.request('/api/gcsp/offer-followup/confirm', { commandId: `${label}-change`,
    decisionId: reloaded.followup.decisionId, expectedBriefVersion: question.briefVersion,
    questionVersion: question.question.questionVersion, value: change ?? entry.inputs.change.value }));
  const waiting = good(await client.request(`/api/gcsp/offer-followup${selector}`));
  const ticked = await presenterTick(client, `${label}-tick`, tick);
  const ready = good(await client.request(`/api/gcsp/offer-followup${selector}`));
  const later = good(await client.request('/api/gcsp/offers/current'));
  return { entry, reset, runId, firstOffer, before, decision, reloaded, question, saved, waiting, ticked, ready, later, selector };
}
