import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import dns from 'node:dns';
import { createLocalHttpsFixture } from './helpers/local-https.js';

// FUCQ-216: a busy event loop outlived the ::1 happy-eyeballs attempt, then 127.0.0.1 was refused.
test('a local HTTPS request survives a blocked event loop against a server bound to localhost', async (t) => {
  const https = await createLocalHttpsFixture(t);
  const [key, cert] = await Promise.all([readFile(https.configuration.keyFile), readFile(https.configuration.certFile)]);
  const server = createServer({ key, cert }, (req, res) => res.end('ok'));
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, 'localhost', done); });
  t.after(() => new Promise((done) => server.close(done)));
  // Hold the loop just after the connect attempt starts, as heavy allocation work in the same process does.
  const lookup = dns.lookup;
  dns.lookup = (...args) => { const done = args.pop(); lookup(...args, (...out) => { dns.lookup = lookup; done(...out); const until = Date.now() + 1500; while (Date.now() < until); }); };
  t.after(() => { dns.lookup = lookup; });
  const response = await https.fetch(`https://localhost:${server.address().port}/`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ok');
});
