import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { createBmwLiveImageryProvider, selectBmwImageSnapshot, presentBmwLiveImage } from '../../../../server/vehicle-evidence/bmw-live-imagery.js';

let externalRequests = 0;
const denied = () => { externalRequests += 1; throw Error('Offline examples cannot access the network.'); };
globalThis.fetch = denied;
for (const transport of [http, https]) for (const method of ['get', 'request']) transport[method] = denied;

const source = JSON.parse(await readFile(new URL('../../../../server/vehicle-evidence/snapshots/bmw-gb-i5-images-2026-11-01.v1.json', import.meta.url)));
const bytes = await readFile(new URL('../../../../server/vehicle-evidence/assets/bmw-gb-i5-images-2026-11-01.v1/alpine-white.webp', import.meta.url));
const request = { ...source.assets[0].identity, selectionComplete: true, viewport: 'desktop', namedImage: 'Gallery',
  viewpoint: 'HEROFRONT', size: { width: 2560, height: 1646 }, distinctions: { BKGND: 'sand' } };
const url = 'https://prod.cosy.bmw.cloud/connext-bmw/cosySec?opaque=offline-example';
const manifest = { 'stage-fullscreen-views-legacy-newnames': { desktop: { metaData: request.size,
  namedImages: [{ name: 'Gallery', images: [{ viewImage: url, distinctionParameters: { POV: 'HEROFRONT', BKGND: 'sand' } }] }] } } };
let now = new Date('2026-11-05T12:00:00Z');
const provider = createBmwLiveImageryProvider({ environment: 'gcsp-demo', sourceProfile: 'bmw-uk-public-configurator',
  clock: () => now, getCredential: async () => 'offline-example',
  resolveConfiguration: async () => ({ basis: 'independent-source-proof', identity: request, observedDate: '2026-11-01' }),
  transport: async ({ url: target }) => target === url ? { status: 200, contentType: 'image/webp', body: bytes }
    : { status: 200, contentType: 'application/json', body: JSON.stringify(manifest) } });
const live = await provider.resolve(request);
now = new Date('2026-11-05T12:00:15Z');
const expired = await provider.readAsset(live.image.assetId);
const snapshot = await selectBmwImageSnapshot(request, { environment: 'gcsp-demo', assetId: source.assets[0].assetId });
const wrongPaint = await selectBmwImageSnapshot(request, { environment: 'gcsp-demo', assetId: source.assets[1].assetId });
provider.dispose();
const examples = { basis: 'Offline synthetic transport, clock and identity proof; no BMW call or new live qualification',
  representativeUnknownFidelity: presentBmwLiveImage(live), expired: presentBmwLiveImage(expired),
  selectedSnapshot: presentBmwLiveImage(snapshot), wrongSnapshotPaint: presentBmwLiveImage(wrongPaint) };
assert.equal(live.status, 'ok'); assert.equal(expired.failure.code, 'asset-expired');
assert.equal(examples.representativeUnknownFidelity.freshness.status, 'unknown');
assert.ok(Object.values(examples.representativeUnknownFidelity.fidelity).every((state) => state === 'unknown'));
assert.equal(examples.selectedSnapshot.label, 'Snapshot image');
assert.equal(examples.selectedSnapshot.observedDate, '2026-11-01');
assert.equal(examples.selectedSnapshot.retrievedDate, '2026-11-01');
assert.equal(examples.wrongSnapshotPaint.assetId, null);
assert.ok(!JSON.stringify(examples).includes('opaque=offline-example'));
assert.equal(externalRequests, 0);
await writeFile(new URL('./presentation-examples.json', import.meta.url), `${JSON.stringify(examples, null, 2)}\n`);
console.log(JSON.stringify({ examples: 4, externalRequests }));
