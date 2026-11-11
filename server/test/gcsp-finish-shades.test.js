import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installDom } from './dom-harness.js';
import { PolicyService } from '../gcsp/policy/index.js';
import { projectFinishShades, finishShadeModule } from '../../scripts/project-finish-shades.mjs';
import { FINISH_SHADES } from '../../blocks/gcsp/kit/finish-shades-data.js';
import { finishShade } from '../../blocks/gcsp/kit/finish-shades.js';
import { finishLabel } from '../../blocks/gcsp/kit/vehicle-decision.js';

const read = { runId: 'finish-shade-test', asOf: '2026-11-11T12:00:00.000Z', policyVersion: FINISH_SHADES.policyVersion };
let dom;
before(() => { dom = installDom(); });
after(() => dom.window.close());

test('the shipped shared catalogue is the current PolicyService projection', async () => {
  const projected = await projectFinishShades(new PolicyService(), read);
  assert.deepEqual(FINISH_SHADES, projected);
  assert.equal(await readFile(new URL('../../blocks/gcsp/kit/finish-shades-data.js', import.meta.url), 'utf8'), finishShadeModule(projected));
  assert.ok(Object.keys(projected.paint).length >= 20);
  assert.ok(Object.keys(projected.upholstery).length >= 20);
});

test('a canonical family correction changes the projection and shared resolver without a second table edit', async () => {
  const seed = structuredClone((await new PolicyService().getPolicySnapshot(read)).value);
  seed.assumptions.find((entry) => entry.key === 'stock.paintColourFamilies.v1').value.familyByCode.P0300 = 'blue';
  const changed = new PolicyService({ provider: { loadVersions: async () => [seed] } });
  const mapping = await projectFinishShades(changed, read);
  assert.equal(finishShade({ label: 'Paint', value: 'Alpine White' }, mapping), 'blue');
  assert.equal(finishShade({ label: 'Paint', value: 'Alpine White solid' }, mapping), 'blue');
  assert.notEqual(mapping.sourceDigest, FINISH_SHADES.sourceDigest);
});

test('known paint and trim use exact shared names with only case and whitespace normalisation', () => {
  for (const [label, value, expected] of [
    ['Paint', 'Alpine White', 'white'], ['Colour', '  PORTIMAO\nBLUE metallic  ', 'blue'],
    ['Paint', 'Storm Bay', 'grey'], ['Paint', 'Thundernight', 'purple'],
    ['Paint', 'BMW Individual Frozen Portimao Blue', 'blue'],
    ['Upholstery', 'Black Veganza', 'black'], ['Interior', 'Cognac Perforated Sensatec', 'brown'],
    ['Interior', 'Oyster with Grey contrast stitching Vernasca leather', 'beige'],
    ['Interior', 'Black with Red Highlight Vernasca Leather', 'black'],
  ]) assert.equal(finishShade({ label, value }), expected, `${label}: ${value}`);
});

test('missing, unlisted, generic and ambiguous finishes never guess from colour words or another finish kind', () => {
  for (const [label, value] of [
    ['Paint', 'BMW Individual Paintwork'], ['Paint', 'Individual Paintwork'], ['Paint', 'Unlisted blue paint'],
    ['Paint', 'Black Veganza'], ['Interior', 'Alpine White'], ['Interior', 'Black and red custom leather'],
    ['Upholstery', 'Veganza perforated Coral Red/Black'], ['Interior', 'BMW Individual Merino leather in Black and Atlas Grey'],
    ['Interior', 'Sensatec perforated with Tacora Red decor stitching'], ['Paint', null], ['Paint', '__proto__'],
    ['Unrelated fact', 'Alpine White'],
  ]) assert.equal(finishShade({ label, value }), null, `${label}: ${value}`);
  assert.equal(finishShade(), null);
});

test('explicit supplied supported shades take precedence and unsupported supplied shades remain neutral', () => {
  assert.equal(finishShade({ label: 'Paint', value: 'Alpine White', shade: ' BLACK ' }), 'black');
  for (const shade of ['unknown', '__proto__', 'toString', 5, {}]) {
    assert.equal(finishShade({ label: 'Paint', value: 'Alpine White', shade }), null);
  }
});

test('the shared component paints white/black accents, preserves labels and hides decorative circles from assistive technology', () => {
  for (const [label, value, expected] of [['Paint', 'Alpine White', 'rgb(244, 244, 242)'], ['Upholstery', 'Black Veganza', 'rgb(29, 29, 31)']]) {
    const node = finishLabel({ label, value }); const circle = node.querySelector('.gcsp-finish-swatch');
    assert.equal(node.textContent, value); assert.equal(circle.style.backgroundColor, expected);
    assert.equal(circle.getAttribute('aria-hidden'), 'true'); assert.equal(circle.classList.contains('is-unknown'), false);
  }
  const unknown = finishLabel({ label: 'Paint', value: 'BMW Individual Paintwork' });
  assert.equal(unknown.textContent, 'BMW Individual Paintwork');
  assert.equal(unknown.querySelector('.gcsp-finish-swatch').classList.contains('is-unknown'), true);
});

test('unavailable, incompatible and conflicting policy mapping fails generation instead of shipping fallback guesses', async () => {
  await assert.rejects(projectFinishShades({ getAssumption: async () => ({ status: 'unavailable' }) }, read), /unavailable/);
  const policy = new PolicyService();
  const conflicting = { getAssumption: async (key, request) => {
    const result = await policy.getAssumption(key, request);
    if (key === 'presentation.finishShades.v1') result.value.value.paintAliases['Alpine White'] = 'P0475';
    return result;
  } };
  await assert.rejects(projectFinishShades(conflicting, read), /conflicting label/);
});
