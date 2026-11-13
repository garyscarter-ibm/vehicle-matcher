import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PUBLIC_ENV_KEYS, validateRuntimeConfig, runtimeConfigFromEnv, contentSecurityPolicy } from '../../scripts/gcsp-runtime-config.mjs';

const producer = fileURLToPath(new URL('../../scripts/gcsp-runtime-config.mjs', import.meta.url));
const config = (id = 'isolated-dev') => ({
  schemaVersion: 1, environmentId: id, apiBaseUrl: `https://${id}-api.example/api/gcsp/v1`,
  oidc: { authority: `https://${id}-identity.example/realms/gcsp`, clientId: `${id}-public-client`, scope: 'openid profile email',
    redirectUri: `https://${id}-web.example/gcsp/auth/callback`, postLogoutRedirectUri: `https://${id}-web.example/gcsp/` },
});
const envFor = (value) => Object.fromEntries(Object.entries(PUBLIC_ENV_KEYS).map(([field, key]) => [key, value[field] ?? value.oidc[field]]));

test('runtime: two public environments map exactly and leave their inputs unchanged', () => {
  for (const id of ['isolated-dev', 'second-dev']) {
    const value = config(id); const original = structuredClone(value);
    const parsed = runtimeConfigFromEnv({ ...envFor(value), DATABASE_PASSWORD: 'never-public', GCSP_CLIENT_SECRET: 'never-public' });
    assert.deepEqual(parsed, value);
    assert.deepEqual(validateRuntimeConfig(value), value);
    assert.deepEqual(value, original);
    assert.notEqual(parsed.oidc, value.oidc);
    assert.doesNotMatch(JSON.stringify(parsed), /never-public|PASSWORD|SECRET/u);
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
  for (const field of ['clientSecret', 'accessToken', 'refreshToken', 'databaseUrl', 'unexpected']) {
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
