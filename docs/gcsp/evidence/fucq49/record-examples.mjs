import { readFile } from 'node:fs/promises';
import { createBmwImageAdapter, presentBmwImage } from '../../../../server/vehicle-evidence/bmw-image-adapter.js';
import { createBmwLiveImageryProvider, presentBmwLiveImage } from '../../../../server/vehicle-evidence/bmw-live-imagery.js';

const snapshot = JSON.parse(await readFile(new URL('../../../../server/vehicle-evidence/snapshots/bmw-gb-i5-images-2026-11-01.v1.json', import.meta.url)));
const bytes = await readFile(new URL('../../../../server/vehicle-evidence/assets/bmw-gb-i5-images-2026-11-01.v1/alpine-white.webp', import.meta.url));
const request = { ...snapshot.assets[0].identity, selectionComplete: true, viewpoint: 'HEROFRONT',
  size: { width: 2560, height: 1646 }, viewport: 'desktop', namedImage: 'Gallery', distinctions: { BKGND: 'sand', X: '1700', Y: '500' } };
const asset = 'https://prod.cosy.bmw.cloud/connext-bmw/cosySec?offline-fixture';
const manifest = { 'stage-fullscreen-views-legacy-newnames': { desktop: { metaData: request.size,
  namedImages: [{ name: 'Gallery', images: [{ viewImage: asset, distinctionParameters: { POV: 'HEROFRONT', ...request.distinctions } }] }] } } };
const examples = {};
for (const name of ['injectedIndependentProof', 'observedShapeWithoutIndependentIdentity', 'missingCredential', 'wrongModelProof', 'unsupportedView']) {
  let transportCalls = 0;
  const provider = createBmwLiveImageryProvider({ environment: 'gcsp-demo', sourceProfile: 'bmw-uk-public-configurator',
    clock: () => new Date('2026-11-05T12:00:00Z'),
    getCredential: async () => name === 'missingCredential' ? '' : 'offline-fixture',
    transport: async ({ url }) => { transportCalls += 1; return url === asset ? { status: 200, contentType: 'image/webp', body: bytes }
      : { status: 200, contentType: 'application/json', body: JSON.stringify(manifest) }; },
    resolveConfiguration: name === 'observedShapeWithoutIndependentIdentity' ? undefined : async () => ({ basis: 'independent-source-proof',
      identity: { ...request, ...(name === 'wrongModelProof' ? { modelCode: 'T3SK' } : {}) }, observedDate: '2026-11-01', fidelity: { model: 'verified', paint: 'verified' } }),
  });
  const result = await provider.resolve({ ...request, ...(name === 'unsupportedView' ? { viewpoint: 'SIDELEFT' } : {}) });
  examples[name] = { mode: 'offline-injected-contract-example', nativeProof: false, transportCalls,
    result, presentation: presentBmwLiveImage(result) };
  provider.dispose();
}
const offline = await createBmwImageAdapter({ environment: 'gcsp-demo' }).resolve(request);
examples.explicitSnapshotChoice = { mode: 'existing-offline-snapshot', result: offline, presentation: presentBmwImage(offline) };
console.log(JSON.stringify({ version: 1, date: '2026-11-05', nativeCalls: 0, examples }, null, 2));
