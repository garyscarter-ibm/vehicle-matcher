import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, publicEncrypt, constants } from 'node:crypto';
import { verifyVinGuide, runCli } from './verify-vin-guide.mjs';

function fixture({ fail = false } = {}) {
  const alphabet = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  const vin = [...randomBytes(17)].map((value) => alphabet[value % alphabet.length]).join('');
  const privateUrl = `https://baonline.bmw.com/private/${randomBytes(16).toString('hex')}?token=${vin}`;
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const calls = []; const context = Object.freeze({ purpose: 'offline-harness-verification' });
  const json = (data) => ({ status: 200, body: JSON.stringify(data) });
  return { request: { vin, locale: 'en-GB' }, context, privateUrl, calls, dependencies: {
    keyHandling: { encrypt(key, bytes) {
      const prose = 'Fictional guide Handbook Non-binding reference. Equipment may not be fitted.'.toUpperCase();
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const encrypted = publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, bytes);
        const text = encrypted.toString('base64url').toUpperCase();
        if (![...text].some((_value, index) => index <= text.length - 4 && prose.includes(text.slice(index, index + 4)))) return encrypted;
      }
      throw new Error('Unable to allocate privacy-safe offline ciphertext fixture.');
    } },
    clock: () => new Date('2026-11-05T00:00:00Z'), guard: { check: async (_request, target) => target === context },
    transport: async (call) => {
      calls.push(call); const url = new URL(call.url);
      assert.ok(url.origin === 'https://baonline.bmw.com', 'fixed upstream origin');
      if (url.pathname.endsWith('/key')) return json({ algorithm: 'RSA', publicKeyData: { pem: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') } });
      if (url.pathname.endsWith('/manual')) return json({ status: 'OK', locale: 'en-gb', carName: 'Fictional guide',
        handbookDisclaimer: 'Non-binding reference. Equipment may not be fitted.' });
      if (url.pathname.endsWith('/pdfManual')) return json(fail ? { status: 422 } : { status: 'OK', links: [{ label: 'Handbook', url: privateUrl, contentType: 'application/pdf' }] });
      assert.ok(url.pathname.endsWith('/cosy'), 'fixed image route');
      return { status: 200, contentType: fail ? 'image/svg+xml' : 'image/jpg;charset=UTF-8',
        body: Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 0, 255, 217]) };
    },
  } };
}

function privateAbsent(report, input) {
  const output = JSON.stringify(report);
  for (const secret of [input.request.vin, input.request.vin.slice(-7), input.privateUrl,
    ...input.calls.map((call) => new URL(call.url).searchParams.get('encryptedVin')).filter(Boolean)]) {
    assert.ok(!output.includes(secret), 'private value absent from redacted report');
  }
  assert.ok(!/https?:|encryptedVin|[?#]/i.test(output), 'private URL absent from redacted report');
  assert.deepEqual(Object.keys(report), ['provider', 'version', 'date', 'httpOutcome', 'applicationOutcome', 'locale', 'linkStatus', 'imageStatus', 'limits']);
}

test('injected offline verification exercises all guarded routes and returns only the reporting allowlist', async () => {
  const input = fixture(); const report = await verifyVinGuide(input);
  assert.equal(input.calls.length, 4); assert.equal(report.provider, 'bmw-drivers-guide'); assert.equal(report.version, '1');
  assert.equal(report.date, '2026-11-05'); assert.equal(report.httpOutcome.handbook, 'ok'); assert.equal(report.applicationOutcome.handbook, 'ok');
  assert.equal(report.locale.resolved, 'en-GB'); assert.equal(report.linkStatus, 'available'); assert.equal(report.imageStatus, 'available');
  assert.ok(report.limits.includes('live-unexercised')); privateAbsent(report, input);
});

test('negative content outcomes remain redacted without claiming upstream handbook failure', async () => {
  const input = fixture({ fail: true }); const report = await verifyVinGuide(input);
  assert.equal(report.httpOutcome.handbook, 'ok'); assert.equal(report.applicationOutcome.handbook, 'ok');
  assert.equal(report.httpOutcome.pdf, 'ok'); assert.equal(report.applicationOutcome.pdf, 'error');
  assert.equal(report.httpOutcome.illustration, 'ok'); assert.equal(report.applicationOutcome.illustration, 'not-applicable');
  assert.equal(report.linkStatus, 'source-unavailable'); assert.equal(report.imageStatus, 'invalid'); privateAbsent(report, input);
});

test('refused authority and hostile dependencies cannot print private diagnostics', async () => {
  const denied = fixture(); denied.dependencies.guard = { check: async () => false };
  const report = await verifyVinGuide(denied); assert.equal(denied.calls.length, 0);
  assert.equal(report.httpOutcome.handbook, 'not-established'); assert.equal(report.date, '2026-11-05'); privateAbsent(report, denied);
  const hostile = fixture(); hostile.dependencies.transport = () => { throw new Error(hostile.privateUrl); };
  const failed = await verifyVinGuide(hostile); assert.equal(failed.httpOutcome.handbook, 'error'); privateAbsent(failed, hostile);
  const bad = fixture(); bad.dependencies.timeoutMs = -1; privateAbsent(await verifyVinGuide(bad), bad);
  const invalidClock = fixture(); invalidClock.dependencies.clock = () => new Date('invalid');
  assert.equal((await verifyVinGuide(invalidClock)).date, null);
});

test('CLI live use refuses safely and default/import paths never activate global fetch or environment wiring', async (t) => {
  let fetched = 0; const before = globalThis.fetch;
  globalThis.fetch = () => { fetched += 1; throw new Error('No network permitted'); }; t.after(() => { globalThis.fetch = before; });
  const lines = []; assert.equal(runCli({ argv: ['--live', 'private-ignored-argument'], write: (line) => lines.push(line) }), 2);
  assert.equal(runCli({ write: (line) => lines.push(line) }), 0);
  assert.equal((await verifyVinGuide()).httpOutcome.handbook, 'not-attempted');
  assert.equal(JSON.parse(lines[0]).limits.at(-1), 'live-refused-unapproved');
  assert.ok(lines.every((line) => !line.includes('private-ignored-argument'))); assert.equal(fetched, 0);
});
