import { FUEL_SPEC } from '../../vehicle-matcher/modes/result-card.js';
import { reasonText, bodyStyleLabel } from '../kit/plain-copy.js';

const labels = { body: 'Body style', fuel: 'Fuel', seats: 'Seats', boot: 'Boot', zeroTo62: '0 to 62 mph', mpg: 'Fuel economy' };
const checkCodes = new Set(['driver-eligible', 'policy-include', 'allowance-sufficient', 'essential-met']);
const unitLabels = { count: undefined, L: 'litres', s: 's', 'mpg-imperial': 'mpg' };
const words = (v) => String(v).replaceAll('-', ' ').replaceAll('_', ' ');

/** Project exact supplied decisions without ordering, scoring, approval or reserve effects. */
export function decisionView(decision) {
  const display = decision.snapshot?.display || {};
  const terms = decision.terms;
  const reasons = (decision.reasons || []).map((entry) => ({ ...entry, text: reasonText(entry, 'reasons') }));
  const member = {
    id: decision.orderUuid, identity: { orderUuid: decision.orderUuid, configurationId: decision.configurationId, candidateKey: decision.candidateKey },
    display: { name: display.name || 'Car name not supplied', line: display.line || 'Scheme stock' },
    media: { src: display.photo || null, alt: display.name || 'Car', caption: display.images?.find((image) => image.src === display.photo)?.caption },
    terms: [{ kind: 'points-monthly', value: terms?.points?.value ?? null, allowance: terms?.allowanceInputs?.allowance?.value ?? null }],
    facts: Object.entries(labels).map(([key, label]) => {
      const fact = decision.snapshot?.facts?.[key];
      const known = fact?.status === 'known';
      const value = known ? key === 'body' ? bodyStyleLabel(fact.value) : key === 'fuel' ? FUEL_SPEC[fact.value] || words(fact.value) : fact.value : null;
      return { label, value, unit: unitLabels[fact?.unit] };
    }),
    evidence: decision, checks: reasons.filter((entry) => checkCodes.has(entry.code)),
    decision: { ...decision, reasons: reasons.filter((entry) => !checkCodes.has(entry.code)), tradeOffs: (decision.tradeOffs || []).map((entry) => ({ ...entry, text: reasonText(entry, 'tradeOffs') })),
      blockers: (decision.blockers || []).map((entry) => ({ ...entry, text: reasonText(entry, 'blockers') })), unknowns: (decision.unknowns || []).map((entry) => ({ ...entry, text: reasonText(entry, 'unknowns') })) },
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

