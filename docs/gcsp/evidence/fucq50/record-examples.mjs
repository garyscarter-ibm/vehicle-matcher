import { readFile, writeFile } from 'node:fs/promises';
import { createBmwLiveImageryProvider, selectBmwImageSnapshot, presentBmwLiveImage } from '../../../../server/vehicle-evidence/bmw-live-imagery.js';

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
await writeFile(new URL('./presentation-examples.json', import.meta.url), `${JSON.stringify(examples, null, 2)}\n`);
console.log(JSON.stringify({ examples: 4, externalRequests: 0 }));
