import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inputDigest } from '../repository/core.js';
import { createBmwImageAdapter, presentBmwImage } from '../../vehicle-evidence/bmw-image-adapter.js';

const SHA256 = 'fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe';
const BYTES = 82798;
const CONFIGURATION_ID = 'VDVNSjpGS1NGVSxQMDMwMCxTMDIzMCxTMDJQQSxTMDJWQixTMDJWRCxTMDMwMixTMDMzNyxTMDNESyxTMDNHOSxTMDNNMSxTMDQyOCxTMDQzTCxTMDQ4OCxTMDQ5NCxTMDRUMixTMDRVOSxTMDRVUixTMDRWMSxTMDU1MixTMDVBUyxTMDVBVixTMDVETSxTMDY1NCxTMDY3NCxTMDZBRSxTMDZBRixTMDZBSyxTMDZDNCxTMDZOWCxTMDZQQSxTMDcwNCxTMDcxMCxTMDc2MCxTMDc3NSxTMDgxMixTMDg1MyxTMDg4MCxTMDhSMyxTMDhSOSxTMDhTTSxTMDhURixTMDhURyxTMDhXTSxTMDlRVixTMDlUMSxTMDlUMg==';

// One dated F42 asset and one exact configuration, never a paint/model fallback.
export const APPROVED_CORPUS_IMAGES = Object.freeze([Object.freeze({
  imageId: 'bmw-i5-white-20261101-v1', configurationId: CONFIGURATION_ID,
  asset: `assets/gcsp-vehicle-evidence/${SHA256}.webp`,
  role: 'representative-configuration', fidelity: 'representative-configuration',
  sourceKind: 'dated-snapshot', observedDate: '2026-11-01',
})]);

async function readPublishedAsset() {
  const file = await open(new URL(`../../../${APPROVED_CORPUS_IMAGES[0].asset}`, import.meta.url), 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size !== BYTES) return null;
    const bytes = Buffer.alloc(BYTES + 1); const read = await file.read(bytes, 0, bytes.length, 0);
    return read.bytesRead === BYTES ? bytes.subarray(0, BYTES) : null;
  } finally { await file.close(); }
}

/** Trusted loaders may supply bytes; the registration, source identity and hashes remain code-owned. */
export async function validateRegisteredCorpusImage(image, row, { loadPublishedAsset = readPublishedAsset } = {}) {
  try {
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
