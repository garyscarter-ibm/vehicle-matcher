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

// FUCQ-180: the hosted runtime is opted in, and every live page gcsp-site redirects is one gcsp-api serves.
test('gcsp-api runs the GCSP runtime and declares its settings without committing secrets', () => {
  const api = yaml.slice(yaml.indexOf('name: gcsp-api'), yaml.indexOf('name: gcsp-site'));
  const value = (key) => api.match(new RegExp(`- key: ${key}\\b[^\\n]*\\n\\s+value: "?([^"\\n]+)"?`))?.[1];
  assert.equal(value('GCSP_RUNTIME'), '1');
  assert.equal(value('GCSP_REPOSITORY_MODE'), 'memory');
  assert.equal(value('GCSP_PUBLIC_ORIGIN'), value('GCSP_PUBLIC_BASE_URL'));
  for (const key of ['DEMO_ACCESS_KEY', 'GCSP_MAIL_TRANSPORT', 'GCSP_MAIL_FROM', 'GCSP_MAIL_FROM_NAME', 'GCSP_MAIL_RECIPIENTS', 'GCSP_BREVO_API_KEY']) {
    assert.match(api, new RegExp(`- key: ${key}\\b[^\\n]*\\n\\s+sync: false`), key);
  }
  for (const path of ['gcsp-*.html', 'blocks/**', 'assets/**']) assert.ok(api.includes(`- ${path}\n`), path);
});

test('gcsp-site redirects exactly the live pages gcsp-api serves, to GCSP_API_URL', async () => {
  const host = await readFile(new URL('../gcsp/host.js', import.meta.url), 'utf8');
  const session = [...host.match(/SESSION_PAGES = \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const served = [...session, '/gcsp/offer', '/gcsp-offer.html'];
  const routes = [...site.matchAll(/- type: redirect\n\s+source: (\S+)\n\s+destination: (\S+)/g)];
  const apiUrl = site.match(/- key: GCSP_API_URL[^\n]*\n\s+value: (\S+)/)[1];
  assert.deepEqual(routes.map((m) => m[1]).sort(), [...served].sort());
  for (const [, source, destination] of routes) assert.equal(destination, `${apiUrl}${source}`);
});
