import assert from 'node:assert/strict';
import { installDom, resetDom, loadMode, mountMode, settle } from './dom-harness.js';

export async function captureClientContract(input, records) {
  const dom = installDom();
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const nativeFetch = globalThis.fetch;
  const calls = [];
  let brand;
  const out = {};
  const base = 'http://retail-compat.invalid';
  globalThis.fetch = async (url, init) => {
    const { origin, pathname } = new URL(url);
    assert.equal(origin, base, 'Client capture must use injected offline transport only');
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ path: pathname, ...(body ? { body } : {}) });
    let response;
    if (pathname === '/api/questions') response = records[`${brand}/questions`].response.body;
    else if (pathname === '/api/pool') response = records[`${brand}/pool`].response.body;
    else if (pathname === '/api/match') response = records[`${input.cases.find((c) => c.brand === brand).id}/match`].response.body;
    else if (pathname === '/api/nearby') response = { nearby: [], unmet: {} };
    else throw new Error(`Unexpected client endpoint: ${pathname}`);
    return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const questionnaire = await loadMode('questionnaire');
    for (const h of input.hashes) {
      resetDom();
      brand = h.brand;
      calls.length = 0;
      window.history.replaceState(null, '', h.hash);
      const stage = mountMode(questionnaire, { base, brand });
      await settle(stage, (s) => s.querySelector('.vm-card-name'));
      const matchCalls = calls.filter((c) => c.path === '/api/match');
      assert.equal(matchCalls.length, 1, `${h.id}: decoded share link must request results once`);
      out[h.id] = { hash: h.hash, transmittedAnswers: matchCalls[0].body.answers };
    }
    resetDom();
    brand = 'bmw';
    calls.length = 0;
    window.history.replaceState(null, '', '#m=invalid');
    const intro = mountMode(questionnaire, { base, brand });
    await settle(intro, (s) => s.querySelector('.vm-intro:not(.vm-intro-skeleton)'));
    out['invalid-hash'] = { matchRequests: calls.filter((c) => c.path === '/api/match').length, showsIntro: true };

    const guessWho = await loadMode('guess-who');
    for (const key of ['bmw', 'mini', 'ford', 'honda', 'motorrad', 'ferrari']) {
      resetDom();
      brand = key;
      calls.length = 0;
      window.history.replaceState(null, '', '/');
      const stage = mountMode(guessWho, { base, brand, scope: 'national' });
      const pool = records[`${brand}/pool`].response.body;
      await settle(stage, (s) => s.querySelectorAll('.vm-gw-cell').length === pool.n);
      const initialIds = [...stage.querySelectorAll('.vm-gw-cell')].map((c) => pool.id[Number(c.dataset.i)]);
      const chip = [...stage.querySelectorAll('.vm-gw-chip')]
        .find((c) => /fuel/i.test(c.querySelector('.vm-gw-chip-label')?.textContent));
      assert.ok(chip, `${brand}: fixture must offer a fuel filter`);
      chip.click();
      const ev = [...stage.querySelectorAll('.vm-option')].find((b) => /electric/i.test(b.textContent));
      // Ferrari has PHEV and petrol only; choose petrol as its manual filter.
      const option = ev || [...stage.querySelectorAll('.vm-option')].find((b) => /petrol/i.test(b.textContent));
      assert.ok(option, `${brand}: manual fuel choice exists`);
      const filterFuel = ev ? 'ev' : 'petrol';
      option.click();
      stage.querySelector('.vm-gw-pop-done').click();
      const wantedIds = pool.id.filter((_, i) => pool.fuels[pool.fuel[i]] === filterFuel);
      await settle(stage, (s) => s.querySelectorAll('.vm-gw-cell').length === wantedIds.length);
      const filteredIds = [...stage.querySelectorAll('.vm-gw-cell')].map((c) => pool.id[Number(c.dataset.i)]);
      assert.deepEqual([...filteredIds].sort(), [...wantedIds].sort(), `${brand}: full-pool manual fuel filter`);
      assert.deepEqual(calls.map((c) => c.path), ['/api/pool'], `${brand}: Guess Who must fetch the full pool once and filter locally`);
      out[`${brand}/guess-who`] = { initialIds, filterFuel, filteredIds, requests: calls.map((c) => c.path), showsScores: !!stage.querySelector('.vm-score') };
    }
  } finally {
    globalThis.fetch = nativeFetch;
    dom.window.close();
  }
  return out;
}
