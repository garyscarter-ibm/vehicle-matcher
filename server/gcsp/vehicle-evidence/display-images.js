import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { inputDigest } from '../repository/core.js';

// This display catalogue is separate from immutable source-corpus admission.
const CATALOGUE_SHA256 = 'eb0dc302822c9f27cb8c7b4cc2c5bcf91c3a5a2df052212727530508e3d9c59c';
const catalogueFile = new URL('../../data/gcsp/vehicle-evidence/display-images.v1.json', import.meta.url);
let loaded;
let primarySources;
const verified = new Map();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function catalogue() {
  loaded ??= readFile(catalogueFile).then((bytes) => {
    if (sha256(bytes) !== CATALOGUE_SHA256) throw Error('Display image catalogue changed.');
    return JSON.parse(bytes);
  });
  return loaded;
}
export async function readDisplayImageCatalogue() { return structuredClone(await catalogue()); }

/** The public route hides the live provider and keeps the reviewed local asset as its fallback. */
export async function primaryDisplayImageSource(src) {
  if (typeof src !== 'string' || !/^\/assets\/gcsp-vehicle-evidence\/[a-f0-9]{64}\.webp$/.test(src)) return src;
  try {
    primarySources ??= catalogue().then((data) => {
      const supported = new Set(data.liveImageIds ?? []); const sources = new Map();
      const images = [...data.configurations.map((row) => row.image), ...Object.values(data.variants), ...Object.values(data.models)];
      for (const image of images) {
        if (supported.has(image?.imageId) && /^bmw-display-[a-f0-9]{20}$/.test(image.imageId)
          && /^assets\/gcsp-vehicle-evidence\/[a-f0-9]{64}\.webp$/.test(image.asset)) {
          sources.set(`/${image.asset}`, `/api/gcsp/vehicle-images/${encodeURIComponent(image.imageId)}.webp`);
        }
      }
      return sources;
    });
    return (await primarySources).get(src) ?? src;
  } catch { return src; }
}
async function readAsset(image) {
  const file = await open(new URL(`../../../${image.asset}`, import.meta.url), 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== image.bytes || stat.size > 2 * 1024 * 1024) return null;
    return await file.readFile();
  } finally { await file.close(); }
}
async function published(image, loadAsset) {
  if (!image || !/^assets\/gcsp-vehicle-evidence\/[a-f0-9]{64}\.webp$/.test(image.asset)
    || !['representative-model', 'representative-configuration'].includes(image.fidelity)) return null;
  const check = async () => {
    const bytes = await loadAsset(image);
    return Buffer.isBuffer(bytes) && bytes.length === image.bytes && sha256(bytes) === image.sha256;
  };
  if (loadAsset !== readAsset) return await check() ? structuredClone(image) : null;
  if (!verified.has(image.asset)) verified.set(image.asset, check());
  return await verified.get(image.asset) ? structuredClone(image) : null;
}
export async function configurationDisplayImage(record, { loadAsset = readAsset } = {}) {
  try {
    const data = await catalogue();
    const entry = data.configurations.find((row) => row.configurationId === record?.configurationId);
    if (entry) return entry.recordDigest === inputDigest(record) ? await published(entry.image, loadAsset) : null;
    const identity = record?.canonicalIdentity; const configuration = record?.configuration;
    const codes = identity?.factoryOptionCodes;
    if (!Array.isArray(codes) || configuration?.market !== 'GB' || !configuration.generation
      || identity.agModelCode !== configuration.agModelCode || identity.vgModelCode !== configuration.vgModelCode
      || Buffer.from(`${identity.vgModelCode}:${[...codes].sort().join(',')}`).toString('base64') !== record.configurationId) return null;
    const paint = codes.filter((code) => /^P[A-Z0-9]{4}$/.test(code));
    if (paint.length !== 1) return null;
    const model = data.vgModels?.[identity.vgModelCode];
    if (model?.generation !== configuration.generation || model.agModelCode !== configuration.agModelCode) return null;
    const image = variantImage(data, model, paint[0]);
    return image ? await published({ ...image, configurationId: record.configurationId }, loadAsset) : null;
  } catch { return null; }
}
export async function modelDisplayImage(key, { loadAsset = readAsset } = {}) {
  try { return await published((await catalogue()).models[key], loadAsset); } catch { return null; }
}
function canonicalSignature(id) {
  if (typeof id !== 'string' || id.length > 4096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(id)) return null;
  const decoded = Buffer.from(id, 'base64').toString('utf8');
  if (Buffer.from(decoded).toString('base64') !== id || !/^[A-Z0-9]+:[A-Z0-9,]+$/.test(decoded)) return null;
  const [vg, list] = decoded.split(':'); const codes = list.split(',');
  if (new Set(codes).size !== codes.length || [...codes].sort().join(',') !== list) return null;
  const paints = codes.filter((code) => /^P[A-Z0-9]{4}$/.test(code));
  return paints.length === 1 ? { vg, paint: paints[0] } : null;
}
function variantImage(data, model, paint) {
  const specific = data.variants[`${model.generation}|${model.agModelCode}|${paint}`];
  const image = specific ?? data.variants[`${model.generation}|${paint}`];
  const signature = canonicalSignature(image?.configurationId); const source = data.vgModels?.[signature?.vg];
  if (signature?.paint !== paint || source?.generation !== model.generation
    || specific && source.agModelCode !== model.agModelCode) return null;
  return image;
}
// Public snapshots carry a pinned configuration id, not the full admitted source record.
export async function configurationIdDisplayImage(id, eligibilityModelKey, { loadAsset = readAsset } = {}) {
  try {
    const data = await catalogue();
    const signature = canonicalSignature(id); if (!signature) return null;
    const model = data.vgModels?.[signature.vg]; if (!model) return null;
    const { generation } = model;
    if (eligibilityModelKey != null && (typeof eligibilityModelKey !== 'string'
      || !eligibilityModelKey.startsWith(`${generation} `))) return null;
    const entry = data.configurations.find((row) => row.configurationId === id);
    if (entry) return await published(entry.image, loadAsset);
    const image = variantImage(data, model, signature.paint);
    return image ? await published({ ...image, configurationId: id, role: 'representative-model', fidelity: 'representative-model' }, loadAsset) : null;
  } catch { return null; }
}
export function imageDisplay(name, image) {
  return image ? { name, photo: `/${image.asset}`, images: [{ src: `/${image.asset}`,
    alt: `${name}: representative image`, fidelity: image.fidelity,
    sourceRef: `display-image:${image.imageId}, observed ${image.observedDate}` }] } : { name };
}
export function withDisplayImages(registry) {
  const enrich = async (source) => {
    if (!['ok', 'complete', 'partial'].includes(source?.status)) return source;
    const image = await configurationDisplayImage(source.record);
    return image ? { ...source, images: [image], imageState: 'representative' } : source;
  };
  return Object.freeze({ ...registry,
    async getConfiguration(id) { return enrich(await registry.getConfiguration(id)); },
    async getVin(id) { return enrich(await registry.getVin(id)); },
  });
}
