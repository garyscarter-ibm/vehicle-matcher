import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { loadPublishedDemoRows } from '../../scripts/gcsp/demo-enrichment.mjs';
import { configurationDisplayImage, configurationIdDisplayImage, modelDisplayImage, withDisplayImages } from '../gcsp/vehicle-evidence/display-images.js';
import { VEHICLE_IMAGE_ASSETS, isDisplayImage } from '../../blocks/gcsp/kit/vehicle-image-assets.js';
import { vehicleEvidenceDetails } from '../gcsp/vehicle-evidence/vehicle-details-contract.js';
import { createConfiguredVehicleDetails } from '../gcsp/vehicle-evidence/application-vehicle-details.js';
const { rows } = await loadPublishedDemoRows();
const data = JSON.parse(await readFile(new URL('../data/gcsp/vehicle-evidence/display-images.v1.json', import.meta.url)));
const capturedIds = new Set(data.configurations.map((row) => row.configurationId));
const outsideCapturedConfiguration = (id) => {
  const [vg, list] = Buffer.from(id, 'base64').toString('utf8').split(':');
  return Buffer.from(`${vg}:${[...new Set([...list.split(','), 'SZZZZ'])].sort().join(',')}`).toString('base64');
};

test('all 240 retained demo configurations have verified pictures bound to their unchanged source record', async () => {
  assert.equal(rows.length, 240);
  for (const row of rows) {
    const image = await configurationDisplayImage(row);
    assert.ok(image, row.configurationId); assert.equal(image.configurationId, row.configurationId);
    assert.equal(image.fidelity, 'representative-configuration');
    assert.ok(isDisplayImage(`/${image.asset}`, image.fidelity));
  }
});
test('the four structural model images are verified and make only a model representation claim', async () => {
  for (const key of ['G20 Saloon|320i', 'G21 Touring|320i', 'G61 i5|i5 40', 'F70 Sports Hatch|120']) {
    const image = await modelDisplayImage(key); assert.ok(image, key);
    assert.equal(image.fidelity, 'representative-model');
    assert.ok(isDisplayImage(`/${image.asset}`, image.fidelity));
  }
  assert.equal(await modelDisplayImage('unknown'), null);
});
test('public F70 M135 and 120 configurations with the same paint retain their own AG-model imagery', async () => {
  const resolved = [];
  for (const agModelCode of ['22GE', '82GE']) {
    const row = rows.find((entry) => entry.configuration.generation === 'F70' && entry.configuration.agModelCode === agModelCode
      && entry.canonicalIdentity.factoryOptionCodes.includes('P0300'));
    assert.ok(row, agModelCode);
    const image = await configurationIdDisplayImage(outsideCapturedConfiguration(row.configurationId));
    assert.ok(image, agModelCode); assert.equal(image.fidelity, 'representative-model');
    assert.equal(image.imageId, data.variants[`F70|${agModelCode}|P0300`].imageId); resolved.push(image.imageId);
  }
  assert.notEqual(resolved[0], resolved[1]);
});
test('public G42 derivatives prefer their AG-model image before a compatible body fallback', async () => {
  for (const agModelCode of ['52FA', '12CM', '22CM']) {
    const row = rows.find((entry) => entry.configuration.generation === 'G42' && entry.configuration.agModelCode === agModelCode
      && entry.canonicalIdentity.factoryOptionCodes.includes('P0300'));
    assert.ok(row, agModelCode);
    const image = await configurationIdDisplayImage(outsideCapturedConfiguration(row.configurationId));
    assert.ok(image, agModelCode); assert.equal(image.fidelity, 'representative-model');
    assert.equal(image.imageId, data.variants[`G42|${agModelCode}|P0300`].imageId);
  }
  for (const vg of ['1F7D', '1F7F']) {
    assert.deepEqual(data.vgModels[vg], { generation: 'F70', agModelCode: '62GE' });
    const image = await configurationIdDisplayImage(Buffer.from(`${vg}:P0300,SZZZZ`).toString('base64'));
    assert.ok(image, vg); assert.equal(image.fidelity, 'representative-model');
    assert.equal(image.imageId, data.variants['F70|P0300'].imageId);
  }
});
test('every supported retained GB configuration has a verified image, including paints outside the demo sample', async () => {
  const root = new URL('../data/gcsp/vehicle-evidence/fleet-source.v1/', import.meta.url);
  const active = JSON.parse(await readFile(new URL('active.json', root)));
  const directory = active.selected.directory;
  assert.match(directory, /^[a-f0-9]{64}$/);
  assert.equal(directory, active.selected.manifestDigest);
  const base = new URL(`versions/${directory}/`, root);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base)));
  const hash = createHash('sha256'); let supported = 0; let excluded = 0;
  const stream = createReadStream(new URL('configurations.jsonl', base));
  stream.on('data', (chunk) => hash.update(chunk));
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    if (!line) continue;
    const row = JSON.parse(line); const image = await configurationDisplayImage(row);
    if (row.configuration.market === 'GB') {
      supported += 1; assert.ok(image, `${row.configuration.generation}: ${row.configurationId}`);
      assert.deepEqual(data.vgModels[row.canonicalIdentity.vgModelCode], {
        generation: row.configuration.generation, agModelCode: row.configuration.agModelCode,
      });
      assert.equal(image.configurationId, row.configurationId);
      assert.ok(isDisplayImage(`/${image.asset}`, image.fidelity));
      const publicImage = await configurationIdDisplayImage(row.configurationId);
      assert.ok(publicImage, `public snapshot: ${row.configurationId}`);
      assert.ok(isDisplayImage(`/${publicImage.asset}`, publicImage.fidelity));
      const paint = row.canonicalIdentity.factoryOptionCodes.find((code) => /^P[A-Z0-9]{4}$/.test(code));
      const specific = data.variants[`${row.configuration.generation}|${row.configuration.agModelCode}|${paint}`];
      if (!capturedIds.has(row.configurationId) && specific) assert.equal(publicImage.imageId, specific.imageId);
    } else {
      // The retained US G23 is a structural reference outside the supported scheme fleet.
      excluded += 1; assert.equal(row.configuration.generation, 'G23');
      assert.equal(row.configuration.market, 'US'); assert.equal(image, null);
    }
  }
  assert.equal(supported, 2424); assert.equal(excluded, 1);
  assert.equal(hash.digest('hex'), manifest.checksums['configurations.jsonl']);
});
test('tampered source identity, missing or corrupt assets cannot acquire a catalogue image', async () => {
  const row = structuredClone(rows[0]); row.configuration.market = 'US';
  assert.equal(await configurationDisplayImage(row), null);
  assert.equal(await configurationDisplayImage({ configurationId: 'UNKNOWN' }), null);
  for (const loadAsset of [async () => Buffer.alloc(1), async () => { throw Error('missing'); }]) {
    assert.equal(await configurationDisplayImage(rows[0], { loadAsset }), null);
    assert.equal(await modelDisplayImage('G21 Touring|320i', { loadAsset }), null);
  }
});
test('every published client allowlist entry agrees with the catalogue and rejects arbitrary or exact imagery', () => {
  const expected = new Map();
  for (const image of [...data.configurations.map(r => r.image), ...Object.values(data.variants), ...Object.values(data.models)]) {
    const src = `/${image.asset}`; if (!expected.has(src)) expected.set(src, new Set()); expected.get(src).add(image.fidelity);
  }
  assert.deepEqual(VEHICLE_IMAGE_ASSETS, [...expected].sort(([a],[b]) => a.localeCompare(b)).map(([src, types]) => [src, [...types].sort()]));
  assert.equal(isDisplayImage('/assets/gcsp-vehicle-evidence/unknown.webp', 'representative-model'), false);
  assert.equal(isDisplayImage(VEHICLE_IMAGE_ASSETS[0][0], 'exact'), false);
});
test('enriched images survive the vehicle-details DTO and application validation without changing evidence', async () => {
  const row = rows.find(r => r.configuration.generation === 'G21');
  const original = { status: 'partial', record: row, images: [], active: { datasetId: 'image-regression', version: '1', manifestDigest: 'a'.repeat(64) } };
  const registry = withDisplayImages({ getConfiguration: () => original });
  const source = await registry.getConfiguration(row.configurationId);
  assert.equal(source.images.length, 1); assert.equal(original.images.length, 0);
  const request = { kind: 'configuration', id: row.configurationId };
  const wire = vehicleEvidenceDetails(request, source);
  const out = await createConfiguredVehicleDetails({ lookup: { resolve: () => wire,
    classifyRequest: () => ({ status: 'ok', identityKind: 'synthetic', liveEligible: false, configurationId: row.configurationId }) } }).resolve(request);
  assert.equal(out.status, 'partial'); assert.equal(out.vehicle.images.items.length, 1);
  assert.equal(out.vehicle.equipment.verifiedFitted.state, 'unknown');
});
