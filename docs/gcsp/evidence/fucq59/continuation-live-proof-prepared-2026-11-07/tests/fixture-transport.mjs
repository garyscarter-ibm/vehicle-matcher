/** Scripted safe source protocol, never native fetch or source evidence. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export function fixtureTransport(plan, root) {
  const retained = JSON.parse(readFileSync(join(root, 'docs/gcsp/evidence/fucq59/canonical-source-live-2026-11-06/options.json')));
  const model = { modelCode: 'T5MJ', agModelCode: '72HH', modelRange: 'G61', steering: 'RL', orderDate: '2026-11-01', effectDate: '2027-01-05' };
  const tree = Object.fromEntries(['5', 'I'].map((group) => [group, { modelRanges: { G61E: { models: { T5MJ: model } } } }]));
  const options = Object.fromEntries(retained.report.candidates[0].definitions.map((row) => [row.code, { option: row.code, optionType: row.optionType }]));
  return async (input) => {
    const url = new URL(input); let value;
    if (url.pathname.includes('/configure/')) return new Response('<script src="settings.fixture.json"></script>', { headers: { 'content-type': 'text/html' } });
    if (url.pathname.includes('/settings.')) value = { APP: { backend: {
      settingsVehicleTree: { 'x-api-key': 'synthetic-tree' }, settingsLocalisation: { 'x-api-key': 'synthetic-options' }, settingsRuleSolver: { 'x-api-key': 'synthetic-solver' } } } };
    else if (url.pathname.includes('/vehicle-trees/')) value = tree;
    else if (url.pathname.includes('/options/')) value = options;
    else {
      const codes = url.searchParams.get('included-elements').split(',');
      const elements = Object.fromEntries([...codes, 'S0230'].sort().map((code) => [code, { code, type: 'option' }]));
      value = { constructible: true, configuration: { modelCode: plan.models[0], elements }, configurationChanges: {
        addedElements: { S0230: elements.S0230 }, removedElements: {}, ignoredElements: {} } };
    }
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  };
}
