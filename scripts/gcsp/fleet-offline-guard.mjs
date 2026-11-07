import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
let installed = false;
function host(args) {
  const value = args[0];
  if (Array.isArray(value)) return host(value);
  if (typeof value === 'number') return typeof args[1] === 'string' ? args[1] : 'localhost';
  if (value instanceof URL) return value.hostname;
  if (typeof value === 'string') { try { return new URL(value).hostname; } catch { return value; } }
  return value?.hostname || value?.host || value?.servername || 'localhost';
}
/** Process-scoped audit instrumentation. No credentials/source provider is available to the verifier. */
export function installFleetOfflineGuard() {
  if (installed) throw new Error('An offline audit is already active in this process.');
  installed = true;
  const calls = []; const restores = [];
  function wrap(target, key, boundary, argumentsOf = (value) => value) {
    const original = target[key];
    target[key] = function (...args) {
      if (!loopback.has(host(argumentsOf(args)))) {
        calls.push(boundary); throw new Error(`Offline transport denied: ${boundary}`);
      }
      return Reflect.apply(original, this, args);
    };
    restores.push(() => { target[key] = original; });
  }
  for (const [target, key, label] of [[http, 'request', 'http.request'], [http, 'get', 'http.get'],
    [https, 'request', 'https.request'], [https, 'get', 'https.get'], [net.Socket.prototype, 'connect', 'net.Socket.connect'],
    [tls, 'connect', 'tls.connect']]) wrap(target, key, label);
  wrap(globalThis, 'fetch', 'fetch', (args) => [args[0]?.url || args[0]]);
  syncBuiltinESMExports();
  return { calls,
    control() {
      const before = calls.length;
      try { https.request('https://offline-boundary.invalid/'); } catch {
        if (calls.length === before + 1) { calls.pop(); return 'blocked'; }
      }
      throw new Error('Offline egress control failed.');
    },
    restore() { for (const restore of restores.reverse()) restore(); installed = false; syncBuiltinESMExports(); },
  };
}
