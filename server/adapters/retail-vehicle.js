/** Additive compatibility boundary: existing mappers and cached retail objects retain their signatures/shapes. */
import { mapVehicle } from '../mapping.js';
import { createVehicleSnapshot, createRetailTerms, freezeVehicleData } from '../vehicles/index.js';

const UNITS = { seats: 'count', doors: 'count', boot: 'L', zeroTo62: 's', mileage: 'mi', evRange: 'mi',
  mpg: 'mpg-imperial', cc: 'cm3', year: 'year', sizeClass: 'ordinal-1-5' };
const MODEL_FACTS = new Set(['seats', 'boot', 'zeroTo62', 'sizeClass', 'doors']);

function adapt(car, context, mapping, raw) {
  if (!car || typeof car !== 'object' || car.id == null) throw new TypeError('Mapped retail car requires id');
  const origin = (assurance) => ({ sourceRef: context.sourceRef, observedAt: context.observedAt,
    version: context.snapshotVersion, assurance });
  const facts = {};
  for (const name of [...Object.keys(UNITS), 'fuel', 'body', 'transmission', 'features', 'frontIsofix', 'rearIsofix']) {
    // Generic parsed "isofix" never proves a fitted front/rear anchorage on this exact car.
    const value = ['frontIsofix', 'rearIsofix'].includes(name) ? null : car[name] ?? null;
    // Already-mapped fixtures have no retained raw evidence; preserve that limitation even for listing-shaped values.
    const assurance = value === null ? 'unknown' : MODEL_FACTS.has(name) ? 'model-reference'
      : raw && ['mileage', 'cc', 'year', 'mpg', 'evRange'].includes(name) ? 'confirmed-listing' : 'derived';
    facts[name] = { status: value === null ? 'unknown' : 'known', value, unit: UNITS[name] ?? null, provenance: origin(assurance) };
  }
  if (raw && raw.advert_id == null && raw.vin == null) throw new TypeError('Raw retail row requires candidate identity');
  const identityKind = raw ? raw.advert_id == null ? 'vin' : 'advert' : 'legacy-record';
  const sourceKeys = { ...(raw?.advert_id == null ? {} : { advertId: raw.advert_id }),
    ...(!raw ? { recordId: car.id } : {}),
    ...(context.stockId === undefined ? {} : { stockId: context.stockId }),
    ...(context.modelGroupId === undefined ? {} : { modelGroupId: context.modelGroupId }) };
  const display = Object.fromEntries(['name', 'photo', 'link', 'colour'].filter((key) => car[key] !== undefined).map((key) => [key, car[key]]));
  const snapshot = createVehicleSnapshot({ sourceNamespace: context.sourceNamespace, identityKind, sourceKeys,
    snapshotVersion: context.snapshotVersion, observedAt: context.observedAt, display, facts,
    ...(raw?.vin === undefined ? {} : { vin: raw.vin }) });
  const price = Number.isFinite(car.priceMin) && car.priceMin === car.priceMax ? car.priceMin : null;
  const retailTerms = createRetailTerms({ purchasePrice: price === null ? null : { amount: price, currency: 'GBP' },
    provenance: origin(price === null ? 'unknown' : raw ? 'confirmed-listing' : 'derived') });
  return freezeVehicleData({ snapshot, retailTerms,
    annotation: { mapping, sourceRef: context.sourceRef, snapshotVersion: context.snapshotVersion,
      note: raw ? 'Mapped from the supplied raw observation; model defaults and parsed equipment retain weaker assurance.'
        : 'Previously mapped input; observation dates refer to this snapshot, not a fresh source fetch or remap.' },
    legacy: structuredClone(car) });
}

export function adaptMappedRetailVehicle(car, context) {
  return adapt(car, context, 'already-mapped');
}

export function adaptRawRetailVehicle(raw, brand = 'bmw', context) {
  const car = mapVehicle(raw, brand);
  return car === null ? null : adapt(car, context, 'mapped-now', raw);
}

/** A fresh mutable legacy shape lets existing colour enrichment operate without mutating shared snapshots. */
export function projectRetailVehicle(adapted) {
  return structuredClone(adapted.legacy);
}
