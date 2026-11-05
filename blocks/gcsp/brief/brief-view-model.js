import { SPEC_LABELS, FUEL_SPEC } from '../../vehicle-matcher/modes/result-card.js';

const labels = { body: 'Body style', fuel: 'Fuel', seats: 'Seats', boot: 'Boot', zeroTo62: '0 to 62 mph', mpg: 'Fuel economy' };
const checkCodes = new Set(['driver-eligible', 'policy-include', 'allowance-sufficient', 'essential-met']);
const unitLabels = { count: undefined, L: 'litres', s: 's', 'mpg-imperial': 'mpg' };
const words = (v) => String(v).replaceAll('-', ' ').replaceAll('_', ' ');
const fields = { ...labels, sportiness: 'Sportiness', comfort: 'Comfort', economy: 'Economy', size: 'Size', equipment: 'Equipment', charging: 'Charging' };
const detail = (entry) => {
  if (typeof entry === 'string') return entry;
  if (entry.text || entry.reason) return entry.text || entry.reason;
  const field = fields[entry.field] || words(entry.field || 'requirement');
  const known = {
    'driver-eligible': () => 'Driver eligible.',
    'policy-include': () => 'Included in your scheme.',
    'allowance-sufficient': () => 'Within your points allowance.',
    'essential-met': () => `Meets your ${field.toLowerCase()} requirement.`,
    'required-by-met': () => `Available by ${new Date(entry.requiredBy).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}.`,
    'preference-fit': () => `${field}: ${entry.score}% fit.`,
    'charging-unconfirmed': () => 'Charging access is unknown. Confirm home or work charging.',
  };
  if (known[entry.code]) return known[entry.code]();
  const evidence = Object.entries(entry).filter(([key, value]) => key !== 'code' && ['string', 'number', 'boolean'].includes(typeof value));
  return `${words(entry.code || 'Not supplied')}${evidence.length ? ': ' + evidence.map(([key, value]) => `${words(key)} ${value}`).join(', ') : ''}`;
};

/** Project exact supplied decisions without ordering, scoring, approval or reserve effects. */
export function decisionView(decision) {
  const display = decision.snapshot?.display || {};
  const terms = decision.terms;
  const reasons = (decision.reasons || []).map((entry) => ({ ...entry, text: detail(entry) }));
  const member = {
    id: decision.orderUuid, identity: { orderUuid: decision.orderUuid, configurationId: decision.configurationId, candidateKey: decision.candidateKey },
    display: { name: display.name || 'Car name not supplied', line: display.line || 'Scheme stock' },
    media: { src: display.photo || null, alt: display.name || 'Car', caption: display.images?.find((image) => image.src === display.photo)?.caption },
    terms: [{ kind: 'points-monthly', value: terms?.points?.value ?? null, allowance: terms?.allowanceInputs?.allowance?.value ?? null }],
    facts: Object.entries(labels).map(([key, label]) => {
      const fact = decision.snapshot?.facts?.[key];
      const known = fact?.status === 'known';
      const value = known ? key === 'body' ? SPEC_LABELS[fact.value] || words(fact.value) : key === 'fuel' ? FUEL_SPEC[fact.value] || words(fact.value) : fact.value : null;
      return { label, value, unit: unitLabels[fact?.unit] };
    }),
    evidence: decision, checks: reasons.filter((entry) => checkCodes.has(entry.code)),
    decision: { ...decision, reasons: reasons.filter((entry) => !checkCodes.has(entry.code)), tradeOffs: (decision.tradeOffs || []).map((entry) => ({ ...entry, text: detail(entry) })),
      blockers: (decision.blockers || []).map((entry) => ({ ...entry, text: detail(entry) })), unknowns: (decision.unknowns || []).map((entry) => ({ ...entry, text: detail(entry) })) },
    versions: decision.versions, actions: [],
  };
  return { schemaVersion: 1, members: [member], selectedId: member.id };
}

export function previewSummary(preview) {
  if (preview.state === 'loading') return 'Updating cars...';
  if (preview.state === 'idle') return 'Preview not calculated.';
  if (preview.state === 'unavailable') return 'Preview unavailable. Your edits are kept.';
  const value = preview.outcome?.value;
  const unknown = value?.decisions?.filter((d) => d.gateStatus === 'needs-confirmation').length || 0;
  return `${value?.eligibleCount || 0} eligible ${value?.eligibleCount === 1 ? 'car' : 'cars'}${unknown ? `; ${unknown} ${unknown === 1 ? 'car needs' : 'cars need'} confirmation` : ''}.`;
}

