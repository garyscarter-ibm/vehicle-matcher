import { configurationIdDisplayImage, imageDisplay, modelDisplayImage, primaryDisplayImageSource } from './display-images.js';

// These are public presentation containers; signed inputs, evidence and command payloads stay untouched.
const containers = new Set(['value', 'account', 'currentContract', 'contracts', 'histories', 'entries', 'oldContract',
  'selection', 'stock', 'quote', 'facts', 'snapshot', 'cars', 'decisions', 'recommendations', 'matches', 'offers', 'orders', 'preview']);
const structural = new Map([
  ['Q01QRzIwOlJFRlBBSU5ULFJFRlRSSU0=', 'G20 Saloon|320i'],
  ['Q01QRzIxOlJFRlBBSU5ULFJFRlRSSU0=', 'G21 Touring|320i'],
  ['Q01QRzYxOlJFRlBBSU5ULFJFRlRSSU0=', 'G61 i5|i5 40'],
  ['Q01QRjcwOlJFRlBBSU5ULFJFRlRSSU0=', 'F70 Sports Hatch|120'],
]);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const publicSnapshot = (value, binding, slot) => ['facts', 'snapshot'].includes(slot) && value.identityKind === 'exact-stock'
  && text(binding.orderUuid) && value.sourceKeys?.stockId === binding.orderUuid && text(value.display?.name);
const seededCurrentContract = (value) => value.model === 'BMW 3 Series Touring 320i' && value.status === 'current'
  && value.source?.mode === 'synthetic' && value.source?.sourceRef === 'fixture:manual-records-v1';
function detachPublicContainers(value) {
  if (Array.isArray(value)) return value.map(detachPublicContainers);
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return value;
  const detached = { ...value };
  for (const [key, child] of Object.entries(value)) if (containers.has(key)) detached[key] = detachPublicContainers(child);
  return detached;
}

/** Adds pictures and selects their public source after authority and digest checks have completed. */
export async function withVehicleDisplayImages(outcome) {
  if (!['ok', 'pending'].includes(outcome?.status)) return outcome;
  // structuredClone preserves aliases. Detach each public branch from any shared signed/private branch.
  const copy = detachPublicContainers(structuredClone(outcome)); const pending = [];
  function visit(value, binding = {}, slot = '') {
    if (Array.isArray(value)) { for (const row of value) visit(row, binding, slot); return; }
    if (!value || typeof value !== 'object') return;
    const ownBinding = { configurationId: value.configurationId ?? binding.configurationId,
      orderUuid: value.orderUuid ?? binding.orderUuid };
    if (publicSnapshot(value, ownBinding, slot) && !text(value.display.photo)) {
      pending.push((async () => {
        const key = value.facts?.eligibilityModelKey?.value;
        const structuralKey = structural.get(ownBinding.configurationId);
        const image = structuralKey && key === structuralKey ? await modelDisplayImage(structuralKey)
          : await configurationIdDisplayImage(ownBinding.configurationId, key);
        if (image) value.display = { ...value.display, ...imageDisplay(value.display.name, image) };
      })());
    }
    if (seededCurrentContract(value) && !text(value.media?.src)) {
      pending.push((async () => {
        const image = await modelDisplayImage('G21 Touring|320i');
        if (image) value.media = { src: `/${image.asset}`, alt: 'BMW 3 Series Touring' };
      })());
    }
    for (const [key, child] of Object.entries(value)) if (containers.has(key)) visit(child, ownBinding, key);
  }
  visit(copy); await Promise.all(pending);
  // Enrichment must finish before promotion so newly supplied and persisted pictures use the same route.
  const promotions = [];
  function promote(value, binding = {}, slot = '') {
    if (Array.isArray(value)) { for (const row of value) promote(row, binding, slot); return; }
    if (!value || typeof value !== 'object') return;
    const ownBinding = { configurationId: value.configurationId ?? binding.configurationId,
      orderUuid: value.orderUuid ?? binding.orderUuid };
    if (publicSnapshot(value, ownBinding, slot)) {
      promotions.push((async () => {
        value.display = structuredClone(value.display);
        if (text(value.display.photo)) value.display.photo = await primaryDisplayImageSource(value.display.photo);
        if (Array.isArray(value.display.images)) {
          await Promise.all(value.display.images.map(async (image) => {
            if (image && typeof image === 'object' && text(image.src)) image.src = await primaryDisplayImageSource(image.src);
          }));
        }
      })());
    }
    if ((['currentContract', 'contracts', 'oldContract'].includes(slot) || seededCurrentContract(value)) && text(value.media?.src)) {
      promotions.push((async () => { value.media = { ...value.media, src: await primaryDisplayImageSource(value.media.src) }; })());
    }
    for (const [key, child] of Object.entries(value)) if (containers.has(key)) promote(child, ownBinding, key);
  }
  promote(copy); await Promise.all(promotions); return copy;
}
