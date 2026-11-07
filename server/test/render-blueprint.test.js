import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const yaml = await readFile(new URL('../../render.gcsp.yaml', import.meta.url), 'utf8');
const site = yaml.slice(yaml.indexOf('name: gcsp-site'));

// A file the site build copies but the filter omits would ship stale until some other change redeployed.
test('gcsp-site build filter covers exactly what its build copies', () => {
  const cp = site.match(/cp -R ([^\n]+(?:\n\s+[^\n&]+)*?) _site\//);
  assert.ok(cp, 'cp -R ... _site/ line not found in gcsp-site buildCommand');
  const copied = cp[1].split(/\s+/).filter(Boolean).map((p) => (p.includes('.') ? p : `${p}/**`));
  const block = site.match(/buildFilter:[^\n]*\n\s+paths:\n((?:\s+- [^\n]+\n)+)/);
  assert.ok(block, 'gcsp-site buildFilter.paths not found');
  const filtered = [...block[1].matchAll(/- (\S+)/g)].map((m) => m[1]);
  assert.deepEqual([...filtered].sort(), [...copied].sort());
});

test('gcsp-api waits for vehicle corpus readiness before deployment selection', () => {
  const api = yaml.slice(yaml.indexOf('name: gcsp-api'), yaml.indexOf('name: gcsp-site'));
  assert.match(api, /^    healthCheckPath: \/health\/vehicle-evidence$/m);
});
