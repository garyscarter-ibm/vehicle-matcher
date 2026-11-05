import { createEmployeeRecommendationService } from '../../gcsp/recommendation/index.js';
import { context, fact, brief, stock, providerValue, provider, time, policy } from './employee-recommendation.js';

const labels = {
  'driver-eligible': 'Driver eligibility confirmed for this synthetic example.',
  'policy-include': 'This exact model is included in the scheme policy.',
  'allowance-sufficient': 'The monthly points cost is within your allowance.',
  'allowance-exceeded': 'The monthly points cost exceeds your allowance.',
  'required-by-met': 'Available by your required date.',
  'essential-met': 'The exact car meets this confirmed essential.',
  'essential-unmet': 'The exact car does not meet your confirmed seating requirement.',
  'essential-unconfirmed': 'The exact number of seats needs confirmation.',
};
const reason = (entry) => ({ ...entry, text: labels[entry.code] || entry.reason || entry.code.replaceAll('-', ' ') });

// Generate the browser display snapshot from the real FUCQ-29 service and canonical policy.
export async function createSharedKitEmployeeFixture() {
  const cars = [stock(1), stock(2, { seats: fact(4, 'count') }), stock(3, { seats: fact(null, 'count'), boot: fact(null, 'L') })];
  const names = ['BMW 320i M Sport Touring with Individual extended leather and comfort specification',
    'BMW 320i Touring with four confirmed seats (synthetic)', 'BMW 320i Touring with unconfirmed seating and luggage capacity'];
  cars.forEach((car, i) => { car.snapshot = { ...car.snapshot, display: { name: names[i] } }; });
  const result = await createEmployeeRecommendationService({ policy: policy(), provider: provider(providerValue(cars)), time }).recommend(context, brief());
  if (result.status !== 'ok') throw new Error(`Gallery fixture source: ${result.status}`);
  return { schemaVersion: 1, source: 'FUCQ-29 createEmployeeRecommendationService / rankCars',
    evaluatedAt: result.value.evaluatedAt, versions: result.value.versions,
    members: result.value.decisions.map((decision, i) => ({
      id: decision.orderUuid, identity: { candidateKey: decision.candidateKey, orderUuid: decision.orderUuid, configurationId: decision.configurationId },
      display: { name: decision.snapshot.display.name, line: 'Synthetic scheme stock', pickerLabel: ['Eligible exact car', 'Ineligible exact car', 'Needs confirmation'][i] },
      media: i === 0 ? { src: '/assets/brand-hero/bmw.jpg', alt: 'Representative BMW brand image', caption: 'Representative BMW brand image, not this exact car' } : {},
      facts: [['Seats', 'seats'], ['Boot, seats up', 'boot'], ['Fuel', 'fuel']].map(([label, key]) => ({ label,
        value: decision.snapshot.facts[key]?.value ?? null, unit: decision.snapshot.facts[key]?.unit,
        missingLabel: `Not supplied${decision.snapshot.facts[key]?.unit ? ` (${decision.snapshot.facts[key].unit})` : ''}`,
        provenance: decision.snapshot.facts[key]?.provenance })),
      terms: [{ kind: 'points-monthly', value: decision.terms?.points.value ?? null,
        allowance: decision.terms?.allowanceInputs.allowance.value ?? null, provenance: decision.terms?.provenance }],
      decision: { gateStatus: decision.gateStatus, score: decision.score, reasons: decision.reasons.map(reason),
        blockers: decision.blockers.map(reason), unknowns: decision.unknowns.map(reason), tradeOffs: decision.tradeOffs.map(reason), versions: decision.versions },
      actions: [{ id: 'inspect', kind: 'select', label: 'Select for this preview', variant: 'ghost' },
        { id: 'feedback', kind: 'feedback', label: 'Not this one', variant: 'ghost', scope: 'This exact car in the local gallery only.' },
        { id: 'reserve', kind: 'reserve', label: 'Reserve', disabled: true, disabledReason: 'Reserving is not part of this preview' }],
    })) };
}
