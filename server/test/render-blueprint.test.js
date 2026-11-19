import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const yaml = await readFile(new URL('../../render.gcsp.yaml', import.meta.url), 'utf8');
const service = (name) => yaml.match(new RegExp(`  - type: web\\n    name: ${name}\\n[\\s\\S]*?(?=\\n  - type: web|$)`))?.[0];
const site = service('gcsp-site');

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

// FUCQ-482: the Node GCSP runtime and its database are retired; the Java API is the only GCSP API.
test('no Node GCSP runtime or legacy database remains in the GCSP blueprint', () => {
  assert.doesNotMatch(yaml, /    name: gcsp-api\n/);
  assert.doesNotMatch(yaml, /runtime: node/);
  assert.doesNotMatch(yaml, /GCSP_RUNTIME/);
  assert.doesNotMatch(yaml, /^databases:/m);
  assert.doesNotMatch(yaml, /name: gcsp-db/);
  assert.doesNotMatch(yaml, /npm start/);
});

// FUCQ-482: the demo picker reads the Used Cars API, not the retired GCSP API.
test('gcsp-site sends the demo picker to the Used Cars API', () => {
  assert.match(site, /- key: GCSP_API_URL\b[^\n]*\n\s+value: https:\/\/bmw-matcher-api\.onrender\.com/);
  assert.doesNotMatch(site, /gcsp-api\.onrender\.com/);
});

// FUCQ-482: readiness stays DOWN while any required provider is none, so each one is configured.
test('every required Java provider is configured, not left at none', () => {
  const java = yaml.slice(yaml.indexOf('  - type: web\n    name: gcsp-java-api\n'), yaml.indexOf('  - type: web\n    name: gcsp-angular-dev\n'));
  const value = (key) => java.match(new RegExp(`- key: ${key}\\b[^\\n]*\\n\\s+value: ([^\\s#]+)`))?.[1];
  assert.equal(value('GCSP_REQUIRED_PROVIDERS'), 'identity,persistence,account,scenario,supply,allocation-candidates,ordering,approvals,documents,appointments,returns,production,evidence');
  const configured = { GCSP_SCENARIO_PROVIDER: 'demo', GCSP_SUPPLY_PROVIDER: 'demo', GCSP_ACCOUNT_PROVIDER: 'repository', GCSP_ALLOCATION_CANDIDATES_PROVIDER: 'recommendation',
    GCSP_ORDERING_PROVIDER: 'synthetic', GCSP_APPROVALS_PROVIDER: 'synthetic', GCSP_DOCUMENTS_PROVIDER: 'synthetic', GCSP_APPOINTMENTS_PROVIDER: 'synthetic',
    GCSP_PRODUCTION_PROVIDER: 'synthetic', GCSP_RETURNS_PROVIDER: 'synthetic', GCSP_VEHICLE_EVIDENCE_PROVIDER: 'lookup' };
  for (const [key, want] of Object.entries(configured)) assert.equal(value(key), want, key);
  assert.match(java, /- key: GCSP_IDENTITY_PROVIDER\n\s+sync: false/);
  for (const key of ['GCSP_MAIL_TRANSPORT', 'GCSP_PUBLIC_BASE_URL', 'GCSP_MAIL_FROM', 'GCSP_MAIL_FROM_NAME', 'GCSP_BREVO_API_KEY', 'GCSP_CODE_REVISION']) {
    assert.match(java, new RegExp(`- key: ${key}\\n\\s+sync: false`), key);
  }
  assert.doesNotMatch(java, /- key: GCSP_BREVO_[A-Z_]+[^\n]*\n\s+value:/);
});

test('gcsp-site declares no redirects to retired gcsp-api pages', () => {
  assert.doesNotMatch(site, /^    routes:/m);
  assert.doesNotMatch(site, /gcsp(?:-(?:login|greg|help)\.html|\/login)/);
});
