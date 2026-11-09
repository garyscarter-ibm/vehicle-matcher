// Explicitly synthetic gallery states, never selected by the live dashboard or its HTTP adapter.
import { el, screenIntro } from '../../../vehicle-matcher/ui.js';
import { mountGregPublish } from './panel.js';

export function galleryPolicy({ ranges = false } = {}) {
  const provenance = { source: 'Synthetic component gallery', sourceDate: '2026-11-05', basis: 'Interaction example only', status: 'assumed' };
  const range = (kind) => ranges ? { presentationRange: { minimum: 0, maximum: kind === 'price' ? 4000 : 10, step: 1,
    assumptionKey: 'gallery.editor.range', unit: 'editor-presentation-range', ...provenance } } : {};
  const labels = { body: 'Body style', fuel: 'Fuel type', sportiness: 'Sportiness', comfort: 'Comfort', economy: 'Running costs', size: 'Size' };
  return { activeVersion: 'gallery-policy-v1', activeVersionLabel: 'Gallery policy 1', versionNames: { 'gallery-policy-v1': 'Gallery policy 1' },
    effectiveFrom: '2026-11-05T09:00:00.000Z', asOf: '2026-11-05T10:00:00.000Z',
    heldOffers: { count: 2, message: 'Fixture: 2 held offers keep their earlier terms.' }, fields: [
      { id: 'price:gallery-cost', kind: 'price', ...range('price'), key: 'gallery-cost', value: 1100, unit: 'points/month', unitLabel: 'points a month', label: 'Gallery car',
        schemeId: 'Gallery scheme', schemeLabel: 'Gallery scheme', configurationId: 'Gallery car', ...provenance },
      ...['body', 'fuel', 'sportiness', 'comfort', 'economy', 'size'].map((key) => ({ id: `weight:${key}`, kind: 'weight', ...range('weight'), key, value: 1, unit: 'relative-weight', unitLabel: 'weight', label: `${labels[key]} weight`, ...provenance })),
    ] };
}
export function galleryPreview(input, policy = galleryPolicy()) {
  const band = { kind: 'band', fewerThan: 5, label: 'fewer than 5' };
  const aggregate = () => ({ demand: { demand: { unmet: { total: { count: { ...band } } } } }, fit: {
    employeesWithEligibleStock: { ...band }, scoredBriefs: { ...band }, meanBestScore: { status: 'suppressed', fewerThan: 5, unit: 'score/100' } } });
  return { preview: true, activeVersion: policy.activeVersion, asOf: policy.asOf, heldOffers: policy.heldOffers,
    active: aggregate(), draft: aggregate(), differences: input.changes.map((change) => ({ id: change.id,
      before: policy.fields.find((f) => f.id === change.id).value, after: change.value, unit: policy.fields.find((f) => f.id === change.id).unit })) };
}
export function gregPublishExample() {
  const section = el('section', 'vm-gallery-section gcsp');
  section.append(screenIntro({ kicker: 'GCSP kit', title: 'Greg preview and publish: fixture', level: 2,
    lede: 'Synthetic interaction example. This panel does not call the policy service.' }));
  const host = el('div', ''); section.append(host);
  const policy = galleryPolicy({ ranges: true });
  mountGregPublish(host, { commandId: () => `gallery-${Date.now()}`, adapter: {
    async readPolicy() { return { status: 'ready', value: policy }; },
    async preview(input) { return { status: 'ready', value: galleryPreview(input, policy) }; },
    async publish(input) { return { status: 'ready', value: { accepted: true, policyVersion: input.policyVersion,
      effectiveFrom: input.effectiveFrom, publisher: 'Greg (gallery fixture)', activationRequired: false,
      activation: { status: 'active', policyVersion: input.policyVersion, publishedVersionActive: true }, heldOffers: policy.heldOffers } }; },
  } });
  return section;
}
