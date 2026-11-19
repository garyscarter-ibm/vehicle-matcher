import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createLocalVehicleEvidenceLookup } from '../gcsp/vehicle-evidence/local-vehicle-lookup.js';
const reference = fileURLToPath(new URL('../data/gcsp/vehicle-evidence/lookup-reference.v1/', import.meta.url));

test('local readiness waits for a validated corpus and returns detached state', async () => {
  const lookup = createLocalVehicleEvidenceLookup({ root: reference, asOf: '2026-11-05T00:00:00.000Z' });
  assert.equal(typeof lookup.readiness, 'function');
  assert.equal(lookup.readiness().status, 'loading');
  const pointer = JSON.parse(await readFile(join(reference, 'active.json')));
  const selected = join(reference, 'versions', pointer.selected.directory);
  const [row] = (await readFile(join(selected, 'configurations.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const resolved = await lookup.resolve({ kind: 'configuration', id: row.configurationId });
  assert.notEqual(resolved.status, 'source-unavailable');
  const ready = lookup.readiness();
  assert.equal(ready.status, 'ready');
  assert.equal(ready.manifestDigest, resolved.versions.manifestDigest);
  assert.ok(Number.isSafeInteger(ready.elapsedMs) && ready.elapsedMs >= 0);
  ready.status = 'modified';
  assert.equal(lookup.readiness().status, 'ready');
});

test('an absent corpus settles unavailable without exposing a path or exception', async () => {
  const absent = join(process.env.TMPDIR, 'absent-corpus');
  const lookup = createLocalVehicleEvidenceLookup({ root: absent });
  assert.equal(typeof lookup.readiness, 'function');
  await lookup.resolve({ kind: 'configuration', id: Buffer.from('UNKNOWN:CODE').toString('base64') });
  const value = lookup.readiness();
  assert.equal(value.status, 'unavailable');
  assert.equal(value.manifestDigest, null);
  assert.match(value.code, /^[a-z0-9-]+$/);
  assert.equal(JSON.stringify(value).includes(absent), false);
});

test('a validated retained fallback is ready even when the selected pointer failed', async (t) => {
  const root = await mkdtemp(join(process.env.TMPDIR, 'readiness-fallback-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(reference, root, { recursive: true });
  const pointer = JSON.parse(await readFile(join(root, 'active.json')));
  const previous = pointer.selected;
  pointer.selected = { directory: 'a'.repeat(64), manifestDigest: 'a'.repeat(64) };
  pointer.previous = previous;
  await writeFile(join(root, 'active.json'), JSON.stringify(pointer));
  const lookup = createLocalVehicleEvidenceLookup({ root, asOf: '2026-11-05T00:00:00.000Z' });
  const [row] = (await readFile(join(root, 'versions', previous.directory, 'configurations.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const resolved = await lookup.resolve({ kind: 'configuration', id: row.configurationId });
  assert.notEqual(resolved.status, 'source-unavailable');
  assert.equal(lookup.readiness().status, 'ready');
  assert.equal(lookup.readiness().recovered, true);
  assert.equal(lookup.readiness().manifestDigest, previous.manifestDigest);
});
