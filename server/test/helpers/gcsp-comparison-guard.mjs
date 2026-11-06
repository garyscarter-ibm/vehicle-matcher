import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import dgram from 'node:dgram';
import dns from 'node:dns';
import child from 'node:child_process';
import workers from 'node:worker_threads';

export function installComparisonGuard(frozen) {
  const deny = () => { throw new Error('FUCQ-134 offline capability refused'); };
  const patch = (object, names) => { for (const key of names) if (key in object) object[key] = deny; };
  patch(net, ['connect', 'createConnection', 'createServer']);
  patch(net.Socket.prototype, ['connect']); patch(net.Server.prototype, ['listen']);
  patch(tls, ['connect', 'createServer']);
  for (const module of [http, https]) patch(module, ['request', 'get', 'createServer']);
  patch(http2, ['connect', 'createServer', 'createSecureServer']);
  patch(dgram, ['createSocket']);
  for (const module of [dns, dns.promises]) {
    patch(module, Object.keys(module).filter((name) => /^(lookup|resolve|reverse|setServers)/.test(name)));
    patch(module.Resolver?.prototype ?? {}, Object.getOwnPropertyNames(module.Resolver?.prototype ?? {})
      .filter((name) => /^(resolve|reverse|setServers)/.test(name)));
  }
  patch(child, ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']);
  patch(workers, ['Worker']); process.dlopen = deny;
  patch(globalThis, ['fetch', 'WebSocket', 'EventSource']);
  syncBuiltinESMExports();
  const verify = (url) => {
    if (!url.startsWith('file:')) throw new Error(`Unsupported module URL: ${url}`);
    const path = fs.realpathSync(fileURLToPath(url));
    const expected = frozen.files[path];
    if (!expected || path.endsWith('.node') || /[/\\]pg-native[/\\]/.test(path)) throw new Error(`Unfrozen module: ${path}`);
    const data = fs.readFileSync(path);
    if (createHash('sha256').update(data).digest('hex') !== expected) throw new Error(`Module drift: ${path}`);
    return { path, sha256: expected };
  };
  registerHooks({
    resolve(specifier, context, next) {
      const result = next(specifier, context);
      if (!result.url.startsWith('node:')) verify(result.url);
      return result;
    },
    load(url, context, next) {
      if (!url.startsWith('node:')) process.stdout.write(`# comparison-module ${JSON.stringify(verify(url))}\n`);
      return next(url, context);
    },
  });
}
