import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadAsset } from '../gcsp/vehicle-evidence/fleet-artifacts.js';

for (const explicitDeadline of [false, true]) {
  test(`artifact body ${explicitDeadline ? 'honours an explicit shorter deadline' : 'can finish after thirty seconds under the bounded default'}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'asset-deadline-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const bytes = Buffer.from('ab');
    const asset = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      url: 'https://github.com/garyscarter-ibm/vehicle-matcher/releases/download/corpus-v1/configurations.jsonl' };
    const destination = join(root, 'asset');
    let bodyReady, finishBody, observedSignal;
    const ready = new Promise(resolve => { bodyReady = resolve; });
    const fetchImpl = async (_url, { signal }) => {
      observedSignal = signal;
      return { status: 200, headers: new Headers({ 'content-length': '2' }), body: {
        async *[Symbol.asyncIterator]() {
          yield bytes.subarray(0, 1);
          await new Promise((resolve, reject) => {
            finishBody = resolve;
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            bodyReady();
          });
          yield bytes.subarray(1);
        }
      } };
    };
    const settled = downloadAsset(asset, destination, { fetchImpl, ...(explicitDeadline ? { timeoutMs: 30000 } : {}) })
      .then(() => ({ status: 'complete' }), error => ({ status: 'failed', error }));
    await ready;
    t.mock.timers.tick(30001);
    if (!observedSignal.aborted) finishBody();
    const result = await settled;
    if (explicitDeadline) {
      assert.equal(result.status, 'failed');
      assert.equal(result.error.name, 'AbortError');
      await assert.rejects(stat(destination), { code: 'ENOENT' });
    } else {
      assert.equal(result.status, 'complete');
      assert.equal(observedSignal.aborted, false);
      assert.deepEqual(await readFile(destination), bytes);
    }
  });
}
