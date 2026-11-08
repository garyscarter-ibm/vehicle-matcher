// Test-only TLS material stays inside the launching supervisor's owned TMPDIR.
import { execFile } from 'node:child_process';
import { request } from 'node:https';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function createLocalHttpsFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'gcsp-local-https-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const keyFile = join(root, 'localhost.key'); const certFile = join(root, 'localhost.crt');
  const configFile = join(root, 'openssl.cnf');
  await writeFile(configFile, '[req]\nprompt=no\ndistinguished_name=subject\nx509_extensions=server\n'
    + '[subject]\nCN=localhost\n[server]\nsubjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n');
  try {
    await new Promise((done, reject) => execFile('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyFile, '-out', certFile, '-days', '1', '-config', configFile],
    { timeout: 10000, maxBuffer: 8192 }, (error) => error ? reject(new Error('Local TLS fixture generation failed.')) : done()));
  } catch { throw new Error('Local TLS fixture generation failed.'); }
  const ca = await readFile(certFile);
  // A local CA is trusted for this client only; ordinary certificate and hostname checks remain enabled.
  const fetch = (input, init = {}) => new Promise((done, reject) => {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.hostname !== 'localhost') { reject(new Error('Expected local HTTPS.')); return; }
    const req = request(url, { ca, servername: url.hostname, rejectUnauthorized: true, agent: false, method: init.method || 'GET',
      headers: init.headers, signal: init.signal }, (res) => {
      const chunks = []; let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) { res.destroy(new Error('Local HTTPS response exceeded its bound.')); return; }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        const headers = new Headers();
        for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
        done(new Response([204, 304].includes(res.statusCode) || init.method === 'HEAD' ? null : Buffer.concat(chunks),
          { status: res.statusCode, headers }));
      });
    });
    req.setTimeout(init.timeoutMs ?? 5000, () => req.destroy(new Error('Local HTTPS request timed out.')));
    req.on('error', reject); req.end(init.body);
  });
  return { configuration: { keyFile, certFile }, ca, fetch };
}
