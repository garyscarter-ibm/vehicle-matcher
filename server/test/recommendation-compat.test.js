import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { captureRetailContract, frozen } from './retail-compat-harness.js';
import { captureClientContract } from './retail-compat-client-harness.js';

const directory = new URL('./fixtures/retail-compat-v1/', import.meta.url);
const read = (name) => readFileSync(new URL(name, directory));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = readdirSync(directory).sort();
const original = Object.fromEntries(files.map((name) => [name, read(name)]));
const identity = (name) => {
  const stat = statSync(new URL(name, directory), { bigint: true });
  return { size: stat.size, inode: stat.ino, mtime: stat.mtimeNs, ctime: stat.ctimeNs };
};
const originalIdentity = Object.fromEntries(files.map((name) => [name, identity(name)]));
const input = frozen(JSON.parse(original['inputs.json']));
const manifest = frozen(JSON.parse(original['manifest.json']));
const expected = frozen(JSON.parse(original['expected.json']));

function firstDifference(actual, wanted, path = '$') {
  if (Object.is(actual, wanted)) return null;
  if (actual === null || wanted === null || typeof actual !== 'object' || typeof wanted !== 'object') return { path, actual, expected: wanted };
  if (Array.isArray(actual) !== Array.isArray(wanted)) return { path, actual, expected: wanted };
  for (const key of new Set([...Object.keys(wanted), ...Object.keys(actual)])) {
    if (!Object.hasOwn(actual, key) || !Object.hasOwn(wanted, key)) return { path: `${path}.${key}`, actual: actual[key], expected: wanted[key] };
    const diff = firstDifference(actual[key], wanted[key], `${path}.${key}`);
    if (diff) return diff;
  }
  return null;
}

function compare(actual, wanted, label) {
  const diff = firstDifference(actual, wanted);
  if (!diff) return;
  const snippet = (value) => (JSON.stringify(value) ?? '<missing or undefined>').slice(0, 300);
  assert.fail(`${label}: ${diff.path}; actual=${snippet(diff.actual)}; expected=${snippet(diff.expected)}. Inspect inputs.json and the production path; intentional changes require independent review and an explicit versioned capture. This command never updates expected outputs.`);
}

test('retail compatibility v1: fixed offline contract, repeated without fixture writes', async (t) => {
  try {
    assert.equal(input.version, 'retail-compat-input-v1');
    assert.equal(input.tasteShare, 0.2);
    assert.equal(manifest.sourceRevision, input.sourceRevision);
    for (const [name, hash] of Object.entries(manifest.fixtureHashes)) assert.equal(sha(original[name]), hash, `${name}: versioned fixture checksum changed; independent review required`);
    assert.ok(Object.isFrozen(input.raw.bmw[0]), 'inputs are recursively frozen');
    for (let pass = 1; pass <= 2; pass += 1) {
      const records = await captureRetailContract(input);
      compare(Object.keys(records).sort(), Object.keys(expected.server).sort(), `pass ${pass} server record keys`);
      for (const [key, value] of Object.entries(records)) {
        await t.test(`pass ${pass}: ${key}`, () => compare(value, expected.server[key], key));
      }
      const client = await captureClientContract(input, records);
      for (const [key, value] of Object.entries(client)) {
        await t.test(`pass ${pass}: client/${key}`, () => compare(value, expected.client[key], `client/${key}`));
      }
      compare(Object.keys(client).sort(), Object.keys(expected.client).sort(), `pass ${pass} client record keys`);
    }
  } finally {
    assert.deepEqual(readdirSync(directory).sort(), files, 'baseline command must not create or remove fixture files');
    for (const name of files) {
      assert.deepEqual(read(name), original[name], `${name}: fixture content changed by compatibility command`);
      assert.deepEqual(identity(name), originalIdentity[name], `${name}: fixture rewritten by compatibility command`);
    }
  }
});
