import { indexJsonl } from './indexed-jsonl.js';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inputDigest } from '../repository/core.js';
import { createBmwImageAdapter, presentBmwImage } from '../../vehicle-evidence/bmw-image-adapter.js';

const SHA256 = 'fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe';
const BYTES = 82798;
const CONFIGURATION_ID = 'VDVNSjpGS1NGVSxQMDMwMCxTMDIzMCxTMDJQQSxTMDJWQixTMDJWRCxTMDMwMixTMDMzNyxTMDNESyxTMDNHOSxTMDNNMSxTMDQyOCxTMDQzTCxTMDQ4OCxTMDQ5NCxTMDRUMixTMDRVOSxTMDRVUixTMDRWMSxTMDU1MixTMDVBUyxTMDVBVixTMDVETSxTMDY1NCxTMDY3NCxTMDZBRSxTMDZBRixTMDZBSyxTMDZDNCxTMDZOWCxTMDZQQSxTMDcwNCxTMDcxMCxTMDc2MCxTMDc3NSxTMDgxMixTMDg1MyxTMDg4MCxTMDhSMyxTMDhSOSxTMDhTTSxTMDhURixTMDhURyxTMDhXTSxTMDlRVixTMDlUMSxTMDlUMg==';

// Dated exact source associations; image fidelity remains representative configuration evidence.
export const APPROVED_CORPUS_IMAGES = Object.freeze([Object.freeze({
  imageId: 'bmw-i5-white-20261101-v1', configurationId: CONFIGURATION_ID,
  asset: `assets/gcsp-vehicle-evidence/${SHA256}.webp`,
  role: 'representative-configuration', fidelity: 'representative-configuration',
  sourceKind: 'dated-snapshot', observedDate: '2026-11-01',
}), Object.freeze({
  imageId: 'bmw-1f7e-20261107-v2', configurationId: 'MUY3RTpGS1VLUCxQMEM0UCxTMDFDQixTMDFDRSxTMDFERixTMDFIOCxTMDIzMCxTMDJQQSxTMDJURSxTMDJWQixTMDJWRCxTMDJWRixTMDMwMixTMDMzNyxTMDMzQixTMDNNMixTMDNNRixTMDQyMCxTMDQyOCxTMDQzWixTMDQ3OCxTMDQ4MSxTMDQ5NCxTMDRHUSxTMDUzNCxTMDU1MixTMDVBQyxTMDVBUyxTMDVBVixTMDVETSxTMDY1NCxTMDZBRSxTMDZBRixTMDZQQSxTMDcxMCxTMDc1NCxTMDc2MCxTMDc3NSxTMDdNOSxTMDgxMixTMDg1MCxTMDg1MyxTMDg4SyxTMDhLQSxTMDhSMyxTMDhSOSxTMDhTTSxTMDhURixTMDhURyxTMDlUMSxTMDlUMg==',
  asset: 'assets/gcsp-vehicle-evidence/9704a8616835a1c1ce3b6d65f80e91cabb9edbfc0f83eca06b467bb3b1d236e3.webp',
  role: 'representative-configuration', fidelity: 'representative-configuration',
  sourceKind: 'dated-snapshot', observedDate: '2026-11-07',
})]);

async function readPublishedAsset(image = APPROVED_CORPUS_IMAGES[0], expectedBytes = BYTES) {
  const file = await open(new URL(`../../../${image.asset}`, import.meta.url), 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size !== expectedBytes) return null;
    const bytes = Buffer.alloc(expectedBytes + 1); const read = await file.read(bytes, 0, bytes.length, 0);
    return read.bytesRead === expectedBytes ? bytes.subarray(0, expectedBytes) : null;
  } finally { await file.close(); }
}

/** Trusted loaders may supply bytes; the registration, source identity and hashes remain code-owned. */
export async function validateRegisteredCorpusImage(image, row, { loadPublishedAsset = readPublishedAsset } = {}) {
  try {
    if (inputDigest(image) === inputDigest(APPROVED_CORPUS_IMAGES[1])) return await validateV2Image(image, row, loadPublishedAsset);
    if (inputDigest(image) !== inputDigest(APPROVED_CORPUS_IMAGES[0])
      || row?.configurationId !== CONFIGURATION_ID || row.snapshotVersion !== 'bmw-gb-i5-2026-11-01.v1'
      || row.sourceContext?.observedDate !== '2026-11-01' || row.sourceContext?.catalogueDate !== '2026-11-01') return false;
    const source = await createBmwImageAdapter({ environment: 'gcsp-demo' }).readAsset(image.imageId);
    const shown = presentBmwImage(source);
    if (shown.status !== 'ok' || shown.isFallback || source.image.sha256 !== SHA256 || source.image.bytes !== BYTES
      || source.image.contentType !== 'image/webp' || source.image.viewpoint !== 'HEROFRONT'
      || source.image.size.width !== 2560 || source.image.size.height !== 1646
      || inputDigest(source.resolvedIdentity) !== inputDigest(row.catalogue?.resolvedIdentity)
      || inputDigest(source.resolvedIdentity) !== inputDigest(row.catalogue?.requestedIdentity)) return false;
    const bytes = await loadPublishedAsset();
    return Buffer.isBuffer(bytes) && bytes.length === BYTES
      && createHash('sha256').update(bytes).digest('hex') === SHA256 && bytes.equals(source.bytes);
  } catch { return false; }
}

// This independently admitted original is immutable. The captured image does not
// replace its unknown facts or turn the renderer's request into physical evidence.
async function validateV2Image(image, row, loadPublishedAsset) {
  const source = await indexJsonl(new URL('../../data/gcsp/vehicle-evidence/registered-sources/f70-1f7e-first32-2026-11-07.jsonl', import.meta.url), { key: (value) => value.configurationId });
  if (source.checksum !== '845f2e1d0471ecead7e826ebf1c7e592478da6bc7d67fa4c10aa5b35dcad3080') return false;
  const accepted = source.get(image.configurationId); const catalogue = accepted?.catalogue; const binding = catalogue?.sourceBinding;
  if (!binding || accepted.admission !== true || row?.configurationId !== image.configurationId
    || row.snapshotVersion !== 'bmw-gb-1f7e-first32-2026-11-07.v2'
    || row.sourceContext?.observedDate !== '2026-11-07' || row.sourceContext?.catalogueDate !== '2026-11-07'
    || inputDigest(row.catalogue) !== inputDigest(catalogue)
    || inputDigest(row.canonicalIdentity) !== inputDigest({ ...binding.canonicalIdentity, provenance: catalogue.identityProvenance })) return false;
  const expected = Object.fromEntries(['model','derivative','generation','body','powertrain','drive','transmission','engineCode','agModelCode','vgModelCode','market','region','steering','modelYear','productionEra','productionDate','plant'].map((key) => [key, null]));
  Object.assign(expected, { model: binding.optionalFacts.modelName.value, generation: binding.confirmedContext.rawModelRange.value,
    agModelCode: binding.canonicalIdentity.agModelCode, vgModelCode: binding.canonicalIdentity.vgModelCode, market: binding.requestScope.market });
  if (inputDigest(row.configuration) !== inputDigest(expected)) return false;
  const bytes = await loadPublishedAsset(image, 77936);
  return Buffer.isBuffer(bytes) && bytes.length === 77936
    && createHash('sha256').update(bytes).digest('hex') === '9704a8616835a1c1ce3b6d65f80e91cabb9edbfc0f83eca06b467bb3b1d236e3';
}
