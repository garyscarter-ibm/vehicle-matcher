import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
function host(args) {
  const value = args[0];
  if (Array.isArray(value)) return host(value);
  if (typeof value === 'number') return typeof args[1] === 'string' ? args[1] : 'localhost';
  if (value instanceof URL) return value.hostname;
  if (typeof value === 'string') { try { return new URL(value).hostname; } catch { return value; } }
  return value?.hostname || value?.host || value?.servername || 'localhost';
}
/** Blocks all external transport, with positive controls checked before resetting counters.
 * Named hooks instrument pre-transport credentials/content boundaries as well. */
export function offlineEgressGuard(t) {
  const calls = []; const restores = [];
  const record = (boundary) => { calls.push(boundary); throw new Error(`Offline boundary denied: ${boundary}`); };
  function wrap(target, key, boundary, args = (value) => value) {
    const original = target[key];
    target[key] = function (...values) {
      if (!loopback.has(host(args(values)))) return record(boundary);
      return Reflect.apply(original, this, values);
    };
    restores.push(() => { target[key] = original; });
  }
  for (const [target, key, label] of [[http, 'request', 'http.request'], [http, 'get', 'http.get'],
    [https, 'request', 'https.request'], [https, 'get', 'https.get'], [net.Socket.prototype, 'connect', 'net.Socket.connect'],
    [tls, 'connect', 'tls.connect']]) wrap(target, key, label);
  wrap(globalThis, 'fetch', 'fetch', (args) => [args[0]?.url || args[0]]);
  syncBuiltinESMExports();
  t.after(() => { for (const restore of restores.reverse()) restore(); syncBuiltinESMExports(); });
  return { calls, boundary: (name) => () => record(name),
    assertZero() { assert.deepEqual(calls, [], 'zero external/key/content boundary calls'); } };
}
