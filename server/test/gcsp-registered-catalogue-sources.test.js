import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { indexJsonl } from '../gcsp/vehicle-evidence/indexed-jsonl.js';
import { createConfigurationKey } from '../../scripts/gcsp/configuration-key.mjs';
import { options } from './helpers/vin-corpus-fixture.js';

async function isolatedSourceModule(t) {
  const root = await mkdtemp(join(tmpdir(), 'registered-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = new URL('../gcsp/vehicle-evidence/registered-catalogue-sources.js', import.meta.url);
  const artifact = new URL('../data/gcsp/vehicle-evidence/registered-sources/batch32-2026-11-07.jsonl', import.meta.url);
  const copy = join(root, 'source.jsonl'); await copyFile(artifact, copy);
  // Exercise the production module with an isolated copy of its code-owned file.
  // Its SHA anchor stays unchanged; no production registration override is added.
  const code = (await readFile(original, 'utf8'))
    .replace(/from '(\.[^']+)'/g, (_match, path) => `from '${new URL(path, original).href}'`)
    .replace(/new URL\('([^']+\.jsonl)', import.meta.url\)/g, (_match, path) =>
      `new URL('${new URL(path, original).href === artifact.href ? pathToFileURL(copy).href : new URL(path, original).href}')`);
  const module = join(root, 'registered.mjs'); await writeFile(module, code);
  const { registeredCatalogueSources } = await import(pathToFileURL(module).href);
  return { copy, registeredCatalogueSources };
}
test('code-pinned source lookup lazily qualifies exact original envelopes and refuses substitution', async (t) => {
  const { copy, registeredCatalogueSources } = await isolatedSourceModule(t);
  const source = await indexJsonl(copy, { key: (row) => row.configurationId });
  const first = source.get([...source.metadataEntries()][0].key);
  const registrations = await registeredCatalogueSources(await createConfigurationKey(options));
  const registered = registrations.find((row) => row.lookupIdentity.configurationId === first.configurationId);
  assert.ok(registered); assert.equal(registered.qualifySnapshot(first.catalogue).status, 'qualified');
  const changed = structuredClone(first.catalogue); changed.facts.seats.value = 99;
  assert.equal(registered.qualifySnapshot(changed).status, 'invalid');
  await writeFile(copy, '{}\n');
  assert.throws(() => registered.qualifySnapshot(first.catalogue), { code: 'artifact-changed' });
});
test('a changed admitted file fails its complete code-owned SHA before registrations are restored', async (t) => {
  const { copy, registeredCatalogueSources } = await isolatedSourceModule(t);
  await writeFile(copy, '{}\n');
  await assert.rejects(registeredCatalogueSources(await createConfigurationKey(options)), /Admitted source artifact changed/);
});
