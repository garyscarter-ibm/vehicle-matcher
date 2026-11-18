import { test } from 'node:test';
import assert from 'node:assert/strict';

const MODULE = new URL('../../scripts/gcsp/proof-jvm.mjs', import.meta.url);
const { apiJvmArgs, jvmLimitsReceipt } = await import(MODULE);

function withEnv(value, fn) {
  const before = process.env.PROOF_API_HEAP;
  if (value === undefined) delete process.env.PROOF_API_HEAP; else process.env.PROOF_API_HEAP = value;
  try { return fn(); } finally {
    if (before === undefined) delete process.env.PROOF_API_HEAP; else process.env.PROOF_API_HEAP = before;
  }
}

test('default args use a 768m heap, serial GC and a 128m code cache', () => {
  assert.deepEqual(withEnv(undefined, () => apiJvmArgs()),
    ['-Xms64m', '-Xmx768m', '-XX:+UseSerialGC', '-XX:ReservedCodeCacheSize=128m']);
});

test('the heap option sets -Xmx', () => {
  assert.ok(withEnv(undefined, () => apiJvmArgs({ heap: '1g' })).includes('-Xmx1g'));
});

test('PROOF_API_HEAP overrides the heap option', () => {
  assert.ok(withEnv('2g', () => apiJvmArgs({ heap: '512m' })).includes('-Xmx2g'));
});

test('a malformed PROOF_API_HEAP is rejected', () => {
  for (const bad of ['', '768', '1.5g', 'big', '-1g', '768mb']) {
    assert.throws(() => withEnv(bad, () => apiJvmArgs()), /PROOF_API_HEAP/, `value ${JSON.stringify(bad)}`);
  }
});

test('no metaspace flag is ever set', () => {
  assert.equal(withEnv(undefined, () => apiJvmArgs()).some((arg) => /Metaspace/i.test(arg)), false);
});

test('the receipt records the args and the maximum heap', () => {
  const args = withEnv(undefined, () => apiJvmArgs({ heap: '512m' }));
  assert.deepEqual(jvmLimitsReceipt(args), { jvmArgs: args, maximumHeap: '512m' });
});
