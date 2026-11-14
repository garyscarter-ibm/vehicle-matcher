import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PUBLIC_ENV_KEYS = Object.freeze({
  environmentId: 'GCSP_PUBLIC_ENVIRONMENT_ID',
  apiBaseUrl: 'GCSP_PUBLIC_API_BASE_URL',
  authority: 'GCSP_PUBLIC_OIDC_AUTHORITY',
  clientId: 'GCSP_PUBLIC_OIDC_CLIENT_ID',
  scope: 'GCSP_PUBLIC_OIDC_SCOPE',
  redirectUri: 'GCSP_PUBLIC_OIDC_REDIRECT_URI',
  postLogoutRedirectUri: 'GCSP_PUBLIC_OIDC_POST_LOGOUT_REDIRECT_URI',
});

const fail = (field, reason) => { throw new Error(`GCSP runtime configuration: ${field} ${reason}`); };
const cleanString = (value, field) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || value !== value.trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    fail(field, 'must be a nonempty string of at most 2048 characters without surrounding whitespace or control characters');
  }
};
function exactKeys(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(field, 'must be a plain object');
  for (const key of Reflect.ownKeys(value)) {
    if (!keys.includes(key)) fail(field, 'contains an unsupported field; only public configuration fields are allowed');
  }
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(`${field}.${key}`, 'is required');
}
function publicUrl(value, field, environment) {
  cleanString(value, field);
  if (!/^https?:\/\//u.test(value) || /[\\\s]/u.test(value)) fail(field, 'must be an absolute HTTP(S) URL without whitespace or backslashes');
  let url;
  try { url = new URL(value); } catch { fail(field, 'must be a valid absolute URL'); }
  if (url.username || url.password || value.includes('?') || value.includes('#')) fail(field, 'must not contain credentials, query parameters or a fragment');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(environment === 'local' && loopback)) {
    fail(field, 'requires HTTPS (local HTTP is allowed only for localhost, 127.0.0.1 or [::1])');
  }
  return url;
}

export function validateRuntimeConfig(config, { environment = 'deployed' } = {}) {
  if (!['local', 'deployed'].includes(environment)) fail('environment', 'must be local or deployed');
  exactKeys(config, ['schemaVersion', 'environmentId', 'apiBaseUrl', 'oidc'], 'config');
  if (config.schemaVersion !== 1) fail('schemaVersion', 'must equal 1');
  cleanString(config.environmentId, 'environmentId');
  exactKeys(config.oidc, ['authority', 'clientId', 'scope', 'redirectUri', 'postLogoutRedirectUri'], 'oidc');
  cleanString(config.oidc.clientId, 'oidc.clientId');
  cleanString(config.oidc.scope, 'oidc.scope');
  if (!config.oidc.scope.split(' ').includes('openid') || /[^\x21\x23-\x5b\x5d-\x7e ]/u.test(config.oidc.scope)) {
    fail('oidc.scope', 'must contain the openid scope and space-separated OAuth scope tokens');
  }
  const api = publicUrl(config.apiBaseUrl, 'apiBaseUrl', environment);
  if (!api.pathname.endsWith('/api/gcsp/v1')) fail('apiBaseUrl', 'must end with /api/gcsp/v1 without a trailing slash');
  publicUrl(config.oidc.authority, 'oidc.authority', environment);
  const callback = publicUrl(config.oidc.redirectUri, 'oidc.redirectUri', environment);
  const logout = publicUrl(config.oidc.postLogoutRedirectUri, 'oidc.postLogoutRedirectUri', environment);
  if (callback.pathname !== '/gcsp/auth/callback') fail('oidc.redirectUri', 'must use /gcsp/auth/callback');
  if (logout.pathname !== '/gcsp/') fail('oidc.postLogoutRedirectUri', 'must use /gcsp/');
  if (callback.origin !== logout.origin) fail('oidc.postLogoutRedirectUri', 'must share the redirectUri frontend origin');
  return {
    schemaVersion: 1, environmentId: config.environmentId, apiBaseUrl: config.apiBaseUrl,
    oidc: { ...config.oidc },
  };
}

export function runtimeConfigFromEnv(env = process.env, options) {
  const get = (field) => {
    const value = env[PUBLIC_ENV_KEYS[field]];
    if (typeof value !== 'string' || !value.trim()) fail(PUBLIC_ENV_KEYS[field], 'is required');
    return value;
  };
  const config = { schemaVersion: 1, environmentId: get('environmentId'), apiBaseUrl: get('apiBaseUrl'), oidc: {} };
  for (const field of ['authority', 'clientId', 'scope', 'redirectUri', 'postLogoutRedirectUri']) config.oidc[field] = get(field);
  return validateRuntimeConfig(config, options);
}

export function contentSecurityPolicy(config, options) {
  const valid = validateRuntimeConfig(config, options);
  const apiOrigin = new URL(valid.apiBaseUrl).origin;
  const oidcOrigin = new URL(valid.oidc.authority).origin;
  const connect = [...new Set(["'self'", apiOrigin, oidcOrigin])].join(' ');
  // frame-ancestors must be supplied by an HTTP header, never a meta element.
  return ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "font-src 'self'", "img-src 'self' data: blob: https:", `connect-src ${connect}`,
    "frame-src 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'"].join('; ');
}

async function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--output', '--environment', '--config'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--') || Object.hasOwn(options, key)) {
      throw new Error('Usage: node scripts/gcsp-runtime-config.mjs --output <path> --environment <local|deployed> [--config <json-path>]');
    }
    options[key] = args[i + 1];
  }
  if (!options['--output'] || !options['--environment']) throw new Error('GCSP runtime configuration: --output and --environment are required');
  const validation = { environment: options['--environment'] };
  let config;
  if (options['--config']) {
    const source = await readFile(resolve(options['--config']), 'utf8');
    let parsed;
    try { parsed = JSON.parse(source); } catch { fail('--config', 'must contain valid public configuration JSON'); }
    config = validateRuntimeConfig(parsed, validation);
  } else config = runtimeConfigFromEnv(process.env, validation);
  await writeFile(resolve(options['--output']), `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
