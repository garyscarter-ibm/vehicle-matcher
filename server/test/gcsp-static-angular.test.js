import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PUBLIC_ENV_KEYS, validateRuntimeConfig, runtimeConfigFromEnv, contentSecurityPolicy } from '../../scripts/gcsp-runtime-config.mjs';
import { assembleGcspStatic, GCSP_FIXED_ROUTES } from '../../scripts/build-gcsp-static.mjs';

const producer = fileURLToPath(new URL('../../scripts/gcsp-runtime-config.mjs', import.meta.url));
const config = (id = 'isolated-dev') => ({
  schemaVersion: 1, environmentId: id, apiBaseUrl: `https://${id}-api.example/api/gcsp/v1`,
  oidc: { authority: `https://${id}-identity.example/realms/gcsp`, clientId: `${id}-public-client`, scope: 'openid profile email',
    redirectUri: `https://${id}-web.example/gcsp/auth/callback`, postLogoutRedirectUri: `https://${id}-web.example/gcsp/` },
});
const envFor = (value) => Object.fromEntries(Object.entries(PUBLIC_ENV_KEYS).map(([field, key]) => [key, value[field] ?? value.oidc[field]]));

test('runtime: two public environments map exactly and leave their inputs unchanged', () => {
  for (const id of ['isolated-dev', 'second-dev']) {
    const value = config(id); value.oidc.scope = 'openid profile gcsp-api';
    const original = structuredClone(value);
    const parsed = runtimeConfigFromEnv({ ...envFor(value), DATABASE_PASSWORD: 'never-public', GCSP_CLIENT_SECRET: 'never-public',
      GCSP_IDENTITY_PROVIDER: 'oidc', GCSP_OIDC_ISSUER: value.oidc.authority,
      GCSP_OIDC_JWKS_URI: `${value.oidc.authority}/protocol/openid-connect/certs`,
      GCSP_OIDC_AUDIENCE: 'backend-only-audience', GCSP_OIDC_AUTHORIZED_PARTY: value.oidc.clientId,
      GCSP_OIDC_REQUIRED_SCOPES: 'gcsp-api', GCSP_OIDC_ROLE_CLAIM: 'realm_access.roles',
      GCSP_OIDC_ACCOUNTS: '[{"subject":"backend-only-subject","roles":["greg"]}]',
      GCSP_ENVIRONMENT_ID: id, GCSP_RUN_ID: 'backend-only-run', GCSP_POLICY_VERSION: 'backend-only-policy' });
    assert.deepEqual(parsed, value);
    assert.deepEqual(validateRuntimeConfig(value), value);
    assert.deepEqual(value, original);
    assert.notEqual(parsed.oidc, value.oidc);
    assert.doesNotMatch(JSON.stringify(parsed), /never-public|PASSWORD|SECRET|backend-only|GCSP_OIDC|realm_access/u);
  }
  const missing = envFor(config()); delete missing.GCSP_PUBLIC_OIDC_CLIENT_ID;
  assert.throws(() => runtimeConfigFromEnv(missing), /GCSP_PUBLIC_OIDC_CLIENT_ID is required/u);
});

test('runtime: local HTTP is explicit and restricted to loopback URLs', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    const value = config();
    value.apiBaseUrl = `http://${hostname}:8080/api/gcsp/v1`;
    value.oidc.authority = `http://${hostname}:9000/realms/local`;
    value.oidc.redirectUri = `http://${hostname}:4200/gcsp/auth/callback`;
    value.oidc.postLogoutRedirectUri = `http://${hostname}:4200/gcsp/`;
    assert.deepEqual(validateRuntimeConfig(value, { environment: 'local' }), value);
    assert.throws(() => validateRuntimeConfig(value), /requires HTTPS/u);
    assert.match(contentSecurityPolicy(value, { environment: 'local' }), /connect-src 'self' http:/u);
  }
  assert.throws(() => validateRuntimeConfig(config(), { environment: 'production' }), /must be local or deployed/u);
});

test('runtime: unsupported and secret-bearing configuration fields fail closed', () => {
  for (const field of ['clientSecret', 'accessToken', 'refreshToken', 'databaseUrl', 'audience', 'jwksUri', 'accounts', 'roleClaim', 'unexpected']) {
    for (const target of ['root', 'oidc']) {
      const value = config(); (target === 'root' ? value : value.oidc)[field] = 'sensitive-value';
      assert.throws(() => validateRuntimeConfig(value), (error) => /unsupported field/u.test(error.message) && !error.message.includes('sensitive-value'));
    }
  }
  for (const value of [null, [], 'config', { ...config(), schemaVersion: '1' }]) assert.throws(() => validateRuntimeConfig(value));
  const missing = config(); delete missing.oidc.authority;
  assert.throws(() => validateRuntimeConfig(missing), /oidc.authority is required/u);
  for (const bad of ['', ' ', '\nvalue', 'value\u0000', ' value', 'value ']) {
    const value = config(); value.environmentId = bad;
    assert.throws(() => validateRuntimeConfig(value), /environmentId/u);
    value.environmentId = 'dev'; value.oidc.clientId = bad;
    assert.throws(() => validateRuntimeConfig(value), /oidc.clientId/u);
  }
});

test('runtime: every URL rejects unsafe schemes, remote HTTP, credentials, query and fragment', () => {
  const fields = ['apiBaseUrl', 'authority', 'redirectUri', 'postLogoutRedirectUri'];
  for (const field of fields) {
    for (const bad of ['javascript:alert(1)', '//host.example/path', 'http://remote.example/path', 'http://localhost.evil.example/path',
      'https://user:password@host.example/path', 'https://host.example/path?x=1', 'https://host.example/path?',
      'https://host.example/path#secret', 'https://host.example/path#', 'https://host.example/with space', 'https://host.example\\path',
      'https://host.example/\npath']) {
      const value = config(); (field === 'apiBaseUrl' ? value : value.oidc)[field] = bad;
      assert.throws(() => validateRuntimeConfig(value, { environment: 'local' }), undefined, `${field}: ${bad}`);
    }
  }
});

test('runtime: versioned API and registered frontend callback paths and scopes are required', () => {
  for (const bad of ['https://api.example', 'https://api.example/api/gcsp/v1/', 'https://api.example/api/gcsp/v2']) {
    const value = config(); value.apiBaseUrl = bad;
    assert.throws(() => validateRuntimeConfig(value), /must end with \/api\/gcsp\/v1/u);
  }
  for (const [field, bad] of [['redirectUri', 'https://isolated-dev-web.example/other'],
    ['postLogoutRedirectUri', 'https://isolated-dev-web.example/gcsp'], ['postLogoutRedirectUri', 'https://other.example/gcsp/']]) {
    const value = config(); value.oidc[field] = bad; assert.throws(() => validateRuntimeConfig(value));
  }
  for (const bad of ['profile', 'notopenid', 'openid-extra profile', 'profile\topenid', 'openid "bad"', 'openid \\bad']) {
    const value = config(); value.oidc.scope = bad; assert.throws(() => validateRuntimeConfig(value), /oidc.scope/u);
  }
  const minimal = config(); minimal.oidc.scope = 'openid'; assert.deepEqual(validateRuntimeConfig(minimal), minimal);
});

test('runtime: CSP admits only configured API/OIDC connection origins and supported static resources', () => {
  const value = config(); const csp = contentSecurityPolicy(value);
  const directives = Object.fromEntries(csp.split('; ').map((entry) => { const [name, ...sources] = entry.split(' '); return [name, sources]; }));
  assert.deepEqual(directives['connect-src'], ["'self'", 'https://isolated-dev-api.example', 'https://isolated-dev-identity.example']);
  assert.deepEqual(directives['frame-src'], ["'none'"]);
  assert.deepEqual(directives['form-action'], ["'self'"]);
  assert.deepEqual(directives['script-src'], ["'self'"]);
  assert.deepEqual(directives['style-src'], ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(directives['font-src'], ["'self'"]);
  assert.deepEqual(directives['img-src'], ["'self'", 'data:', 'blob:', 'https:']);
  assert.deepEqual(directives['base-uri'], ["'self'"]);
  assert.deepEqual(directives['object-src'], ["'none'"]);
  assert.equal(directives['frame-ancestors'], undefined);
  assert.doesNotMatch(csp, /unsafe-eval|\*|realms\/gcsp/u);
  const second = contentSecurityPolicy(config('second-dev'));
  assert.doesNotMatch(second, /isolated-dev/u);
  assert.match(second, /https:\/\/second-dev-identity.example/u);
});

test('runtime: schema keeps exact public field shape and useful string/URL/scope constraints', async () => {
  const schema = JSON.parse(await readFile(new URL('../../_config/gcsp-runtime-config.schema.json', import.meta.url), 'utf8'));
  const value = config();
  for (const [shape, input] of [[schema, value], [schema.properties.oidc, value.oidc]]) {
    assert.equal(shape.additionalProperties, false);
    assert.deepEqual([...shape.required].sort(), Object.keys(input).sort());
    assert.deepEqual(Object.keys(shape.properties).sort(), Object.keys(input).sort());
  }
  assert.equal(schema.properties.schemaVersion.const, 1);
  const string = new RegExp(schema.$defs.publicString.pattern, 'u');
  const url = new RegExp(schema.$defs.publicUrl.pattern, 'u');
  for (const good of ['a', 'environment-dev', 'public client']) assert.ok(string.test(good));
  for (const bad of ['', ' x', 'x ', 'x\n', 'x\u0000']) assert.equal(string.test(bad), false);
  for (const good of [value.apiBaseUrl, value.oidc.authority, 'http://[::1]:4200/gcsp/']) assert.ok(url.test(good));
  for (const bad of ['//host/path', 'https://user@host/path', 'https://host/path?x', 'https://host/path#x', 'https://host/path\\x']) assert.equal(url.test(bad), false);
  for (const field of ['apiBaseUrl', 'redirectUri', 'postLogoutRedirectUri', 'scope']) {
    const definition = field === 'apiBaseUrl' ? schema.properties[field] : schema.properties.oidc.properties[field];
    for (const rule of definition.allOf.filter((item) => item.pattern)) assert.ok(new RegExp(rule.pattern, 'u').test(value[field] ?? value.oidc[field]));
  }
});

test('runtime: CLI validates before writing and writes public JSON without modifying its input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gcsp-runtime-'));
  try {
    const input = join(root, 'input.json'); const output = join(root, 'runtime-config.json');
    const value = config(); const text = JSON.stringify(value);
    await writeFile(input, text);
    const run = (args, env = process.env) => spawnSync(process.execPath, [producer, ...args], { encoding: 'utf8', env, timeout: 10000, maxBuffer: 64 * 1024 });
    const failure = run(['--output', output, '--environment', 'deployed'], {});
    assert.equal(failure.status, 1); assert.match(failure.stderr, /GCSP_PUBLIC_ENVIRONMENT_ID is required/u);
    await assert.rejects(readFile(output), { code: 'ENOENT' });
    await writeFile(input, '{"clientSecret":"never-echo-this" malformed');
    const malformed = run(['--output', output, '--environment', 'deployed', '--config', input]);
    assert.equal(malformed.status, 1); assert.match(malformed.stderr, /must contain valid public configuration JSON/u);
    assert.doesNotMatch(malformed.stderr, /never-echo-this/u);
    await assert.rejects(readFile(output), { code: 'ENOENT' });
    await writeFile(input, text);
    const success = run(['--output', output, '--environment', 'deployed', '--config', input]);
    assert.equal(success.status, 0, success.stderr); assert.equal(success.stdout, '');
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), value);
    assert.equal(await readFile(input, 'utf8'), text);
    const duplicate = run(['--output', output, '--environment', 'deployed', '--config', input]);
    assert.equal(duplicate.status, 1); assert.match(duplicate.stderr, /EEXIST/u);
    const envOutput = join(root, 'env-runtime.json');
    const envRun = run(['--output', envOutput, '--environment', 'deployed'], envFor(config('second-dev')));
    assert.equal(envRun.status, 0, envRun.stderr);
    assert.deepEqual(JSON.parse(await readFile(envOutput, 'utf8')), config('second-dev'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function compiledFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'gcsp-artifact-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const browser = join(root, 'browser'); const appRoot = join(root, 'app');
  await mkdir(join(browser, 'media'), { recursive: true });
  await mkdir(join(browser, 'assets/brand-logos'), { recursive: true }); await mkdir(appRoot);
  const entries = {
    'index.html': '<!doctype html><html><head><base href="/gcsp/"><link rel="stylesheet" href="styles-ABCDEF12.css"></head><body><link rel="modulepreload" href="chunk-ABCDEF12.js"><script type="module" src="main-ABCDEF12.js"></script></body></html>',
    'main-ABCDEF12.js': 'import "./chunk-ABCDEF12.js"; export const gallery = () => import("./lazy-ABCDEF12.js");',
    'chunk-ABCDEF12.js': 'export const angularFixture = true;', 'lazy-ABCDEF12.js': 'export const galleryFixture = true;',
    'styles-ABCDEF12.css': '@font-face{font-family:Fixture;src:url("./media/font-ABCDEF12.woff2")}body{font-family:Fixture}',
    'media/font-ABCDEF12.woff2': Buffer.from([0, 1, 2, 3, 255]),
    'assets/brand-logos/bmwgroup-bmw-mini.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  };
  for (const [file, bytes] of Object.entries(entries)) await writeFile(join(browser, file), bytes);
  const pkg = { engines: { node: 'test-node', npm: 'test-npm' }, dependencies: { '@angular/core': 'test-angular' }, devDependencies: { '@angular/build': 'test-builder' } };
  for (const [file, value] of Object.entries({ 'package.json': pkg, 'package-lock.json': { lockfileVersion: 3, fixture: true }, 'angular.json': { fixture: true } })) await writeFile(join(appRoot, file), JSON.stringify(value));
  return { root, browser, appRoot, entries, revision: 'fixture-source-revision', compilerTools: { node: 'fixture-node', npm: 'fixture-npm' }, config: config() };
}

test('artifact: same compiled bytes assemble deterministically with two public configurations', async (t) => {
  const fixture = await compiledFixture(t);
  const first = await assembleGcspStatic({ ...fixture, output: join(fixture.root, 'first') });
  const repeat = await assembleGcspStatic({ ...fixture, output: join(fixture.root, 'repeat') });
  assert.deepEqual(first, repeat);
  const secondConfig = config('second-dev');
  const second = await assembleGcspStatic({ ...fixture, output: join(fixture.root, 'second'), config: secondConfig });
  assert.deepEqual(first.compiledInputs, second.compiledInputs);
  assert.deepEqual(first.compiler, second.compiler);
  assert.deepEqual(first.compiler.tools, { node: 'fixture-node', npm: 'fixture-npm' });
  assert.equal(first.compiler.inputs.length, 3);
  assert.ok(first.compiler.inputs.every((input) => /^[a-f0-9]{64}$/u.test(input.sha256)));
  assert.equal(first.sourceRevision, 'fixture-source-revision');
  for (const [file, bytes] of Object.entries(fixture.entries)) {
    assert.deepEqual(await readFile(join(fixture.browser, file)), Buffer.from(bytes), `${file}: input unchanged`);
    if (file !== 'index.html') {
      for (const variant of ['first', 'second']) assert.deepEqual(await readFile(join(fixture.root, variant, 'gcsp', file)), Buffer.from(bytes), file);
      assert.equal(first.files.find((entry) => entry.path === `gcsp/${file}`).sha256, second.files.find((entry) => entry.path === `gcsp/${file}`).sha256);
    }
  }
  const html = await readFile(join(fixture.root, 'second/gcsp/index.html'), 'utf8');
  const meta = html.indexOf('http-equiv="Content-Security-Policy"');
  assert.ok(meta > 0 && meta < html.indexOf('<link') && meta < html.indexOf('<script'));
  assert.match(html, /<base href="\/gcsp\/">/u);
  assert.match(html, /https:\/\/second-dev-api.example/u); assert.doesNotMatch(html, /isolated-dev-api/u);
  assert.deepEqual(JSON.parse(await readFile(join(fixture.root, 'second/gcsp/runtime-config.json'), 'utf8')), secondConfig);
  assert.equal(first.files.length, Object.keys(fixture.entries).length + 1);
});

test('artifact: missing initial/lazy scripts, styles, fonts and logo fail before output is written', async (t) => {
  const fixture = await compiledFixture(t);
  for (const file of ['main-ABCDEF12.js', 'lazy-ABCDEF12.js', 'styles-ABCDEF12.css', 'media/font-ABCDEF12.woff2', 'assets/brand-logos/bmwgroup-bmw-mini.svg']) {
    await rm(join(fixture.browser, file));
    const output = join(fixture.root, 'missing');
    await assert.rejects(assembleGcspStatic({ ...fixture, output }), /Missing (?:compiled dependency|required compiled brand logo)/u, file);
    await assert.rejects(readFile(join(output, 'gcsp/index.html')), { code: 'ENOENT' });
    await writeFile(join(fixture.browser, file), fixture.entries[file]);
  }
});

test('artifact: incorrect base, inline scripts, unsafe dependencies and unhashed caches fail closed', async (t) => {
  const fixture = await compiledFixture(t); const index = fixture.entries['index.html'];
  for (const [html, message] of [[index.replace('/gcsp/', '/other/'), /base href/u],
    [index.replace('</head>', '<script>alert(1)</script></head>'), /external-script CSP/u],
    [index.replace('styles-ABCDEF12.css', '../outside.css'), /escapes \/gcsp\//u]]) {
    await writeFile(join(fixture.browser, 'index.html'), html);
    await assert.rejects(assembleGcspStatic({ ...fixture, output: join(fixture.root, 'invalid') }), message);
  }
  await writeFile(join(fixture.browser, 'index.html'), index);
  await writeFile(join(fixture.browser, 'unhashed.js'), 'export const stale = true;');
  await assert.rejects(assembleGcspStatic({ ...fixture, output: join(fixture.root, 'invalid') }), /must be hashed/u);
  await rm(join(fixture.browser, 'unhashed.js'));
  await symlink(join(fixture.browser, 'main-ABCDEF12.js'), join(fixture.browser, 'linked-ABCDEF12.js'));
  await assert.rejects(assembleGcspStatic({ ...fixture, output: join(fixture.root, 'invalid') }), /must not contain symlinks/u);
});

test('artifact: output ownership and source/compiler identity are explicit', async (t) => {
  const fixture = await compiledFixture(t); const output = join(fixture.root, 'nonempty');
  await mkdir(output); await writeFile(join(output, 'preserved'), 'keep');
  await assert.rejects(assembleGcspStatic({ ...fixture, output }), /new or empty directory/u);
  assert.equal(await readFile(join(output, 'preserved'), 'utf8'), 'keep');
  await assert.rejects(assembleGcspStatic({ ...fixture, output: fixture.browser }), /separate from/u);
  await assert.rejects(assembleGcspStatic({ ...fixture, output: join(fixture.root, 'new'), revision: '' }), /source revision/u);
  await assert.rejects(assembleGcspStatic({ ...fixture, output: join(fixture.root, 'new'), compilerTools: undefined }), /toolchain versions/u);
});

test('artifact: incomplete producer output cannot omit bootstrap, stylesheet or font declarations', async (t) => {
  const fixture = await compiledFixture(t); const index = fixture.entries['index.html'];
  for (const html of [index.replace(/<script[^>]*><\/script>/u, ''), index.replace(/<link rel="stylesheet"[^>]*>/u, '')]) {
    await writeFile(join(fixture.browser, 'index.html'), html);
    await assert.rejects(assembleGcspStatic({ ...fixture, output: join(fixture.root, 'invalid') }), /requires a packaged module script and stylesheet/u);
  }
  await writeFile(join(fixture.browser, 'index.html'), index);
  await writeFile(join(fixture.browser, 'styles-ABCDEF12.css'), 'body{color:black}');
  await assert.rejects(assembleGcspStatic({ ...fixture, output: join(fixture.root, 'invalid') }), /requires a packaged WOFF\/WOFF2 font/u);
});

test('artifact: dev blueprint has independent builds, exact fixed routes and disjoint cache policies', async () => {
  const yaml = await readFile(new URL('../../render.gcsp.yaml', import.meta.url), 'utf8');
  const proposed = await readFile(new URL('../../services/gcsp-api/render-service.proposed.yaml', import.meta.url), 'utf8');
  const java = yaml.slice(yaml.indexOf('  - type: web\n    name: gcsp-java-api\n'), yaml.indexOf('  - type: web\n    name: gcsp-angular-dev\n'));
  assert.ok(java.startsWith(proposed.slice(proposed.indexOf('  - type: web'), proposed.indexOf('    envVars:'))), 'supplied Java build/runtime foundation is preserved');
  assert.match(java, /^    dockerContext: \.\s*(?:#.*)?$/mu);
  const dockerfile = await readFile(new URL('../../services/gcsp-api/Dockerfile', import.meta.url), 'utf8');
  const retainedInputs = [...dockerfile.matchAll(/^COPY (server\/\S+) \S+$/gmu)].map((match) => match[1]);
  assert.ok(retainedInputs.length > 0, 'the current Java image consumes retained policy inputs');
  for (const input of retainedInputs) {
    const filter = input.endsWith('/') ? `${input}**` : input;
    assert.ok(java.includes(`        - ${filter}\n`), `${input}: changed image input triggers a Java rebuild`);
  }
  const javaKeys = [...java.matchAll(/^      - key: (GCSP_[A-Z_]+|JAVA_OPTS)$/gmu)].map((match) => match[1]);
  assert.equal(new Set(javaKeys).size, javaKeys.length, 'identity and persistence share one environment setting');
  const proposedIdentityKeys = [...proposed.matchAll(/^      # - key: (GCSP_(?:OIDC_[A-Z_]+|ENVIRONMENT_ID|RUN_ID|POLICY_VERSION))$/gmu)].map((match) => match[1]);
  assert.equal(proposedIdentityKeys.length, 10, 'inspect a changed authoritative identity contract before updating the blueprint');
  for (const key of ['GCSP_IDENTITY_PROVIDER', ...proposedIdentityKeys]) {
    assert.match(java, new RegExp(`- key: ${key}\\n\\s+sync: false`, 'u'), `${key} remains deployment-supplied`);
  }
  assert.match(java, /branch: gcsp-poc-dev/u);
  assert.doesNotMatch(java, /^\s+plan:|fromDatabase:|name: gcsp-db\b|apps\/gcsp-web|gcsp:compile/mu);
  for (const key of ['GCSP_DATABASE_URL', 'GCSP_DATABASE_USER', 'GCSP_DATABASE_PASSWORD', 'GCSP_EXPECTED_DATABASE', 'GCSP_ENVIRONMENT_ID']) {
    assert.match(java, new RegExp(`- key: ${key}\\n\\s+sync: false`, 'u'), `${key} must be supplied for the isolated Java database`);
  }
  assert.match(java, /- key: GCSP_RESET_ALLOWED\n\s+value: "true"/u);
  assert.match(java, /- key: GCSP_DATABASE_POOL_SIZE\n\s+value: "10"/u);
  for (const key of ['GCSP_SUPPLY_PROVIDER', 'GCSP_ACCOUNT_PROVIDER', 'GCSP_DOCUMENTS_PROVIDER', 'GCSP_APPROVALS_PROVIDER']) {
    assert.match(java, new RegExp(`- key: ${key}\\n\\s+value: none`, 'u'), `${key} keeps its existing unavailable default`);
  }
  for (const key of ['GCSP_SUPPLY_TRANCHE_PLAN_FILE', 'GCSP_SUPPLY_POLICY_FILE', 'GCSP_ACCOUNT_HR_SNAPSHOT_PATH', 'GCSP_APPROVALS_POLICY_FILE']) {
    assert.doesNotMatch(java, new RegExp(`^      - key: ${key}$`, 'mu'), `${key} is not a required deployment input`);
    assert.match(java, new RegExp(`^      # - key: ${key}\\n      #   sync: false$`, 'mu'), `${key} is documented for optional deployment configuration`);
  }
  const proposedMailKeys = [...proposed.matchAll(/^      # - key: (GCSP_(?:MAIL_[A-Z_]+|PUBLIC_BASE_URL|BREVO_API_KEY))$/gmu)].map((match) => match[1]);
  assert.deepEqual(proposedMailKeys, ['GCSP_MAIL_TRANSPORT', 'GCSP_PUBLIC_BASE_URL', 'GCSP_MAIL_FROM', 'GCSP_MAIL_FROM_NAME', 'GCSP_BREVO_API_KEY']);
  for (const key of [...proposedMailKeys, 'GCSP_NOTIFY_DRAIN_INTERVAL']) {
    assert.ok(!javaKeys.includes(key), `${key} remains an unselected option`);
  }
  assert.match(java, /^      # - key: GCSP_MAIL_TRANSPORT\n      #   value: brevo$/mu);
  for (const key of proposedMailKeys.filter((key) => key !== 'GCSP_MAIL_TRANSPORT')) {
    assert.match(java, new RegExp(`^      # - key: ${key}\\n      #   sync: false$`, 'mu'), `${key} has no committed value`);
  }
  assert.match(java, /Angular HTTPS base serving \/gcsp\/offers\/:offerId, not the API host/u);
  assert.match(java, /^      # - key: GCSP_NOTIFY_DRAIN_INTERVAL\n      #   value: 5s$/mu);
  const properties = await readFile(new URL('../../services/gcsp-api/src/main/resources/application.properties', import.meta.url), 'utf8');
  assert.match(properties, /^gcsp\.documents\.provider=\$\{GCSP_DOCUMENTS_PROVIDER:none\}$/mu);
  assert.match(properties, /^gcsp\.mail\.transport=\$\{GCSP_MAIL_TRANSPORT:\}$/mu);
  assert.match(properties, /^gcsp\.notify\.drain-interval=\$\{GCSP_NOTIFY_DRAIN_INTERVAL:5s\}$/mu);
  assert.match(properties, /^gcsp\.approvals\.provider=\$\{GCSP_APPROVALS_PROVIDER:none\}$/mu);
  assert.match(properties, /^gcsp\.approvals\.policy-file=\$\{GCSP_APPROVALS_POLICY_FILE:\}$/mu);
  const site = yaml.slice(yaml.indexOf('  - type: web\n    name: gcsp-angular-dev\n'));
  assert.match(site, /branch: gcsp-poc-dev/u); assert.match(site, /value: "24\.22\.3"/u);
  assert.match(site, /npm install --global npm@11\.19\.1/u);
  assert.match(site, /- key: SKIP_INSTALL_DEPS\n\s+value: "true"/u);
  assert.match(site, /npm run gcsp:compile/u); assert.match(site, /npm run gcsp:assemble/u);
  assert.doesNotMatch(site, /gradle|mvn|docker|services\/gcsp-api/u);
  const rewrites = [...site.matchAll(/- type: rewrite\n\s+source: (\S+)\n\s+destination: (\S+)/gu)];
  assert.deepEqual(rewrites.map((match) => match[1]), GCSP_FIXED_ROUTES);
  assert.ok(rewrites.every((match) => match[2] === '/gcsp/index.html' && !/[*:]/u.test(match[1])));
  for (const path of ['/gcsp/runtime-config.json', '/gcsp/missing.js', '/gcsp/media/missing.woff2', '/api/gcsp/v1/context', '/gcsp/offers/missing.js']) assert.ok(!GCSP_FIXED_ROUTES.includes(path));
  const headers = [...site.matchAll(/- path: (\S+)\n\s+name: (\S+)\n\s+value: ([^\n]+)/gu)].map(([, path, name, value]) => ({ path, name, value }));
  const caches = headers.filter((header) => header.name === 'Cache-Control');
  assert.equal(new Set(caches.map((header) => header.path)).size, caches.length);
  for (const path of ['/gcsp/index.html', '/gcsp/runtime-config.json', ...GCSP_FIXED_ROUTES]) assert.equal(caches.find((header) => header.path === path)?.value, 'no-store');
  for (const path of ['/gcsp/*.js', '/gcsp/*.css', '/gcsp/media/*']) assert.equal(caches.find((header) => header.path === path)?.value, 'public, max-age=31536000, immutable');
  assert.equal(caches.find((header) => header.path === '/gcsp/assets/*')?.value, 'no-cache');
  assert.ok(headers.some((header) => header.name === 'Content-Security-Policy' && header.value === '"frame-ancestors \'none\'"'));
  assert.ok(headers.some((header) => header.name === 'Referrer-Policy' && header.value === 'no-referrer'));
  for (const key of Object.values(PUBLIC_ENV_KEYS)) assert.match(site, new RegExp(`- key: ${key}\\n\\s+sync: false`, 'u'));
  for (const input of ['apps/gcsp-web/**', 'blocks/gcsp/shell/**', 'designs/**', 'scripts/build-gcsp-static.mjs', 'scripts/assemble-site.mjs', 'scripts/gcsp-runtime-config.mjs', '_config/gcsp-runtime-config.schema.json', 'package.json', 'package-lock.json', 'render.gcsp.yaml']) assert.ok(site.includes(`- ${input}\n`), input);
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['gcsp:compile'], /npm --prefix apps\/gcsp-web run build/u);
  assert.equal(pkg.scripts['gcsp:assemble'], 'node scripts/build-gcsp-static.mjs');
});
