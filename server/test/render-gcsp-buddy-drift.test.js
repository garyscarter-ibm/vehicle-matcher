import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

// FUCQ-533: one Blueprint per environment. Each file names its own branch and never changes at the switch.
const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
const live = await read('render.gcsp-buddy.yaml');
const dev = await read('render.gcsp-buddy-dev.yaml');
const names = (yaml) => [...yaml.matchAll(/^  - type: web\n    name: (\S+)\n(?:    [^\n]*\n)*?    branch: (\S+)$/gmu)].map(([, name, branch]) => [name, branch]);

test('each gcsp-buddy Blueprint declares its own three services on its own branch', () => {
  assert.deepEqual(names(live), [['gcsp-buddy-site', 'gcsp-poc'], ['gcsp-buddy-api', 'gcsp-poc'], ['gcsp-buddy-web', 'gcsp-poc']]);
  assert.deepEqual(names(dev), [['gcsp-buddy-dev-site', 'gcsp-poc-dev'], ['gcsp-buddy-dev-api', 'gcsp-poc-dev'], ['gcsp-buddy-dev-web', 'gcsp-poc-dev']]);
  // Normalising would hide a live name or branch inside the dev file, and the reverse.
  assert.doesNotMatch(dev, /gcsp-buddy-(?:api|web|site)\b|gcsp-poc(?!-dev)\b|render\.gcsp-buddy\.yaml/u);
  assert.doesNotMatch(live, /gcsp-buddy-dev|gcsp-poc-dev/u);
});

test('the two gcsp-buddy Blueprints differ only in service names, derived hostnames and branch', () => {
  const normalised = dev.replaceAll('gcsp-buddy-dev', 'gcsp-buddy').replaceAll('gcsp-poc-dev', 'gcsp-poc');
  assert.equal(normalised, live);
});

test('each API is on Starter and the static services carry no plan', () => {
  for (const yaml of [live, dev]) {
    assert.deepEqual([...yaml.matchAll(/^\s+plan: (\S+)/gmu)].map((match) => match[1]), ['starter']);
    assert.match(yaml, /    name: gcsp-buddy(?:-dev)?-api\n    runtime: docker\n    plan: starter\b/u);
    assert.doesNotMatch(yaml, /no tier (?:is )?selected/u);
    assert.doesNotMatch(yaml, /gcsp-java-api|gcsp-angular-dev|name: gcsp-site\b|render\.gcsp\.yaml|^databases:/mu);
  }
});

test('the single-file Blueprint is gone', async () => {
  await assert.rejects(access(new URL('../../render.gcsp.yaml', import.meta.url)), { code: 'ENOENT' });
});
