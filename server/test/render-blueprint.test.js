import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runtimeConfigFromEnv } from '../../scripts/gcsp-runtime-config.mjs';

// FUCQ-533: one Blueprint per environment; every check runs on both files.
const blueprints = await Promise.all([['render.gcsp-buddy.yaml', 'gcsp-buddy'], ['render.gcsp-buddy-dev.yaml', 'gcsp-buddy-dev']]
  .map(async ([file, prefix]) => ({ file, prefix, yaml: await readFile(new URL(`../../${file}`, import.meta.url), 'utf8') })));
const service = (yaml, name) => yaml.match(new RegExp(`  - type: web\\n    name: ${name}\\n[\\s\\S]*?(?=\\n  - type: web|$)`))?.[0];
const each = (title, check) => {
  for (const { file, prefix, yaml } of blueprints) test(`${file}: ${title}`, () => check({ yaml, prefix, site: service(yaml, `${prefix}-site`) }));
};

// A file the site build copies but the filter omits would ship stale until some other change redeployed.
each('site build filter covers exactly what its build copies', ({ site }) => {
  const cp = site.match(/cp -R ([^\n]+(?:\n\s+[^\n&]+)*?) _site\//);
  assert.ok(cp, 'cp -R ... _site/ line not found in the site buildCommand');
  const copied = cp[1].split(/\s+/).filter(Boolean).map((p) => (p.includes('.') ? p : `${p}/**`));
  const block = site.match(/buildFilter:[^\n]*\n\s+paths:\n((?:\s+- [^\n]+\n)+)/);
  assert.ok(block, 'site buildFilter.paths not found');
  const filtered = [...block[1].matchAll(/- (\S+)/g)].map((m) => m[1]);
  assert.deepEqual([...filtered].sort(), [...copied].sort());
});

// FUCQ-482: the Node GCSP runtime and its database are retired; the Java API is the only GCSP API.
each('no Node GCSP runtime or legacy database remains in the GCSP blueprint', ({ yaml }) => {
  assert.doesNotMatch(yaml, /    name: gcsp-api\n/);
  assert.doesNotMatch(yaml, /runtime: node/);
  assert.doesNotMatch(yaml, /GCSP_RUNTIME/);
  assert.doesNotMatch(yaml, /^databases:/m);
  assert.doesNotMatch(yaml, /name: gcsp-db/);
  assert.doesNotMatch(yaml, /npm start/);
});

// FUCQ-482: the demo picker reads the Used Cars API, not the retired GCSP API.
each('site sends the demo picker to the Used Cars API', ({ site }) => {
  assert.match(site, /- key: GCSP_API_URL\b[^\n]*\n\s+value: https:\/\/bmw-matcher-api\.onrender\.com/);
  assert.doesNotMatch(site, /gcsp-api\.onrender\.com/);
});

// FUCQ-482: readiness stays DOWN while any required provider is none, so each one is configured.
each('every required Java provider is configured, not left at none', ({ yaml, prefix }) => {
  const java = service(yaml, `${prefix}-api`);
  const value = (key) => java.match(new RegExp(`- key: ${key}\\b[^\\n]*\\n\\s+value: ([^\\s#]+)`))?.[1];
  assert.equal(value('GCSP_REQUIRED_PROVIDERS'), 'identity,persistence,account,scenario,supply,allocation-candidates,ordering,approvals,documents,appointments,returns,production,evidence');
  const configured = { GCSP_SCENARIO_PROVIDER: 'demo', GCSP_SUPPLY_PROVIDER: 'demo', GCSP_ACCOUNT_PROVIDER: 'repository', GCSP_ALLOCATION_CANDIDATES_PROVIDER: 'recommendation',
    GCSP_ORDERING_PROVIDER: 'synthetic', GCSP_APPROVALS_PROVIDER: 'synthetic', GCSP_DOCUMENTS_PROVIDER: 'synthetic', GCSP_APPOINTMENTS_PROVIDER: 'synthetic',
    GCSP_PRODUCTION_PROVIDER: 'synthetic', GCSP_RETURNS_PROVIDER: 'synthetic', GCSP_VEHICLE_EVIDENCE_PROVIDER: 'lookup' };
  for (const [key, want] of Object.entries(configured)) assert.equal(value(key), want, key);
  for (const key of ['GCSP_MAIL_TRANSPORT', 'GCSP_PUBLIC_BASE_URL', 'GCSP_MAIL_FROM', 'GCSP_MAIL_FROM_NAME', 'GCSP_BREVO_API_KEY', 'GCSP_CODE_REVISION']) {
    assert.match(java, new RegExp(`- key: ${key}\\n\\s+sync: false`), key);
  }
  assert.doesNotMatch(java, /- key: GCSP_BREVO_[A-Z_]+[^\n]*\n\s+value:/);
});

each('site declares no redirects to retired gcsp-api pages', ({ site }) => {
  assert.doesNotMatch(site, /^    routes:/m);
  assert.doesNotMatch(site, /gcsp(?:-(?:login|greg|help)\.html|\/login)/);
});

// FUCQ-532: hosted sign-in uses the built-in demo issuer, so every identity value is committed and readiness can be UP.
const envValue = (yaml, key) => yaml.match(new RegExp(`- key: ${key}\\b[^\\n]*\\n\\s+value: ([^\\n]+)`, 'm'))?.[1].replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2');

each('API commits the demo issuer identity values and the web service matches them', ({ yaml, prefix }) => {
  const api = service(yaml, `${prefix}-api`);
  const web = service(yaml, `${prefix}-web`);
  const host = `https://${prefix}-api.onrender.com`;
  const origin = `https://${prefix}-web.onrender.com`;
  const want = { GCSP_IDENTITY_PROVIDER: 'oidc', GCSP_DEMO_IDP_ENABLED: 'true', GCSP_OIDC_ISSUER: `${host}/demo-idp`, GCSP_OIDC_JWKS_URI: `${host}/demo-idp/jwks`,
    GCSP_OIDC_AUDIENCE: 'gcsp-api', GCSP_OIDC_AUTHORIZED_PARTY: 'gcsp-web', GCSP_OIDC_REQUIRED_SCOPES: 'gcsp-api', GCSP_OIDC_ROLE_CLAIM: 'realm_access.roles',
    GCSP_ALLOWED_ORIGINS: origin, GCSP_DEMO_IDP_REDIRECT_URIS: `${origin}/gcsp/auth/callback`, GCSP_DEMO_IDP_POST_LOGOUT_REDIRECT_URIS: `${origin}/gcsp/` };
  for (const [key, value] of Object.entries(want)) assert.equal(envValue(api, key), value, key);
  assert.equal(envValue(api, 'GCSP_OIDC_JWKS_URI'), `${envValue(api, 'GCSP_OIDC_ISSUER')}/jwks`);
  assert.equal(envValue(web, 'GCSP_PUBLIC_OIDC_AUTHORITY'), envValue(api, 'GCSP_OIDC_ISSUER'));
  assert.equal(envValue(web, 'GCSP_PUBLIC_OIDC_CLIENT_ID'), envValue(api, 'GCSP_OIDC_AUTHORIZED_PARTY'));
  assert.equal(envValue(web, 'GCSP_PUBLIC_OIDC_REDIRECT_URI'), envValue(api, 'GCSP_DEMO_IDP_REDIRECT_URIS'));
  assert.equal(envValue(web, 'GCSP_PUBLIC_OIDC_POST_LOGOUT_REDIRECT_URI'), envValue(api, 'GCSP_DEMO_IDP_POST_LOGOUT_REDIRECT_URIS'));
  assert.ok(envValue(web, 'GCSP_PUBLIC_OIDC_SCOPE').split(' ').includes(envValue(api, 'GCSP_OIDC_REQUIRED_SCOPES')));
  assert.equal(envValue(web, 'GCSP_PUBLIC_API_BASE_URL'), `${host}/api/gcsp/v1`);
  for (const key of ['GCSP_ENVIRONMENT_ID', 'GCSP_RUN_ID', 'GCSP_POLICY_VERSION']) assert.match(api, new RegExp(`- key: ${key}\\n\\s+sync: false`), `${key} stays deployment-supplied`);
  assert.match(web, /- key: GCSP_PUBLIC_ENVIRONMENT_ID\n\s+sync: false/);
});

each('API accounts cover every demo person with matching roles and employee ids', ({ yaml, prefix }) => {
  const accounts = JSON.parse(envValue(service(yaml, `${prefix}-api`), 'GCSP_OIDC_ACCOUNTS'));
  assert.deepEqual(accounts.map((a) => a.subject), ['demo-paula', 'demo-alex', 'demo-sam', 'demo-jordan', 'demo-greg', 'demo-presenter']);
  assert.deepEqual(accounts.find((a) => a.subject === 'demo-greg'), { subject: 'demo-greg', roles: ['greg', 'employee'], employeeId: 'operator-greg' });
  assert.deepEqual(accounts.find((a) => a.subject === 'demo-presenter'), { subject: 'demo-presenter', roles: ['presenter'] });
});

// gcsp:assemble refuses a blank or invalid GCSP_PUBLIC_* value, so the committed ones must pass it.
each('web public values pass the deployed runtime configuration check', ({ yaml, prefix }) => {
  const web = service(yaml, `${prefix}-web`);
  const env = { GCSP_PUBLIC_ENVIRONMENT_ID: 'placeholder-environment' };
  for (const key of ['GCSP_PUBLIC_API_BASE_URL', 'GCSP_PUBLIC_OIDC_AUTHORITY', 'GCSP_PUBLIC_OIDC_CLIENT_ID', 'GCSP_PUBLIC_OIDC_SCOPE',
    'GCSP_PUBLIC_OIDC_REDIRECT_URI', 'GCSP_PUBLIC_OIDC_POST_LOGOUT_REDIRECT_URI']) {
    env[key] = envValue(web, key);
    assert.ok(env[key], `${key} is committed`);
  }
  const config = runtimeConfigFromEnv(env, { environment: 'deployed' });
  assert.equal(config.oidc.authority, `https://${prefix}-api.onrender.com/demo-idp`);
});
