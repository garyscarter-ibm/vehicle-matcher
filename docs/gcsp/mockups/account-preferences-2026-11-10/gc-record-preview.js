// Discussion preview of GC's existing private record composition, from integration 7b50602d.
// Keep the existing supplied facts intact. Production implementation must reuse/extract the
// original composer; this mockup does not change application exports or record behaviour.
import { el, factList, formatTerm } from '../../../../blocks/vehicle-matcher/ui.js';
import { orderIdentityRows, orderReferenceOf } from '../../../../blocks/gcsp/kit/order-identity.js';
import { sentence } from '../../../../blocks/gcsp/order-progress/order-progress-copy.js';
const MISSING = 'Not supplied';
function shown(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString('en-GB');
  if (Array.isArray(value)) return value.map(shown).filter((part) => part != null).join(', ') || null;
  if (typeof value === 'object') {
    if ('value' in value) {
      if (value.status === 'unknown') return null;
      const amount = value.kind === 'purchase-money' ? formatTerm(value) : `${shown(value.value) ?? MISSING}${value.unit ? ` ${value.unit}` : value.currency ? ` ${value.currency}` : ''}`;
      const basis = value.basis ?? value.measurementBasis;
      return `${amount}${basis ? ` (${shown(basis)})` : ''}`;
    }
    return Object.entries(value).map(([key, part]) => `${label(key)}: ${shown(part) ?? MISSING}`).join('; ') || null;
  }
  return value;
}
const label = (key) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
const row = (name, value, unit) => ({ label: name, value: shown(value), ...(value != null && unit ? { unit } : {}) });
const facts = (rows, hideMissing) => factList(rows, { className: 'gcsp-facts', hideMissing });
const supplied = (value) => value != null && value !== '';
// Raw ids are not copy (FUCQ-195/197): statuses read as words; slots, schemes and sources show only a supplied label.
const statusLabels = { current: 'Current car', returned: 'Returned' };
const status = (value) => statusLabels[value] ?? (/^[a-z]+(-[a-z]+)*$/.test(value ?? '') ? sentence(value.replace(/-/g, ' ')) : value);
const slotRows = (model, slotId) => {
  const name = model?.slots?.find((slot) => slot.entitlementSlotId === slotId)?.label;
  return name ? [row('Vehicle slot', name)] : [];
};
const sourceLabel = (source) => typeof source === 'string' ? source
  : source?.label ?? null;
const technicalLabels = { insuranceGroup: 'Insurance group', nedcCo2: 'NEDC CO2', wltpCo2: 'WLTP CO2',
  fuelConsumptionLow: 'Fuel consumption, low', fuelConsumptionMedium: 'Fuel consumption, medium',
  fuelConsumptionHigh: 'Fuel consumption, high', fuelConsumptionExtraHigh: 'Fuel consumption, extra high',
  fuelConsumptionCombinedWeighted: 'Fuel consumption, combined weighted', electricityConsumption: 'Electricity consumption',
  electricRange: 'Electric range', electricCityRange: 'Electric city range' };
const technicalLabel = (key) => technicalLabels[key] ?? label(key);
const asOf = (value) => Number.isNaN(Date.parse(value ?? '')) ? MISSING
  : new Date(value).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' });
// Raw ids are not copy: a scheme shows only the policy-supplied name; tables and records fall back to "Scheme N".
const schemeTitle = (history, index) => history.label ?? `Scheme ${index + 1}`;
const schemeTitleFor = (model, schemeId) => {
  const index = model.histories.findIndex((history) => history.schemeId === schemeId);
  return index < 0 ? null : schemeTitle(model.histories[index], index);
};
const schemeName = (model, schemeId) => model.histories.find((history) => history.schemeId === schemeId)?.label ?? null;
const contractModel = (model, id) => [...model.currentContracts, ...model.histories.flatMap((history) => history.entries)]
  .find((contract) => contract.contractId === id)?.model;
const isoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '');
const date = (value) => isoDate(value)
  ? new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : shown(value);
const shortDate = (value, year = false) => isoDate(value) ? new Date(`${value}T00:00:00Z`)
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year && { year: 'numeric' }), timeZone: 'UTC' }) : null;
const windowText = (contract) => shortDate(contract.earliestCollectionDate) && shortDate(contract.latestCollectionDate)
  ? `${shortDate(contract.earliestCollectionDate)} to ${shortDate(contract.latestCollectionDate)}` : null;

// Earlier contracts name the car's own number; a reference shows only when the record supplies one.
const orderRows = (contract) => orderIdentityRows(contract.orderReference, contract.orderNumber).map(({ label, value }) => row(label, value));

const printLabel = (contract) => {
  const id = orderReferenceOf(contract.orderReference) ?? contract.orderNumber;
  return id ? `Print record ${id}` : 'Print record';
};

// The page and the record show only supplied facts (Gary, 10 November).
const suppliedFacts = (rows, className) => {
  const kept = rows.filter((item) => supplied(item.value));
  return kept.length ? factList(kept, { className }) : null;
};

function recordSection(title, ...parts) {
  const section = el('section', 'gcsp-record-section');
  section.append(el('h3', undefined, title), ...parts);
  return section;
}

// The car record: headed sections of supplied facts, built for the drawer and again for print.
function recordSections({ contract, model }) {
  const technical = contract.technical ?? {};
  const standard = ['insuranceGroup', 'transmission', 'nedcCo2', 'wltpCo2', 'fuelConsumptionLow', 'fuelConsumptionMedium',
    'fuelConsumptionHigh', 'fuelConsumptionExtraHigh', 'fuelConsumptionCombinedWeighted', 'electricityConsumption',
    'electricRange', 'electricCityRange', 'exterior', 'interior', 'price', 'options'];
  const window = windowText(contract);
  const blocks = [
    ['Contract', [row('Status', status(contract.status)), row('Driver', contract.driver?.name), row('Term', contract.months, 'months'),
      row('Annual mileage', contract.annualMileage, contract.mileageUnit), row('Contract end', date(contract.contractEndDate)),
      row('Returned', date(contract.returnedDate))]],
    ['Collection', [row('Collected', date(contract.actualCollectionDate)),
      ...(window ? [row('Replacement window', `${date(contract.earliestCollectionDate)} to ${date(contract.latestCollectionDate)}`)]
        : [row('Earliest collection', date(contract.earliestCollectionDate)), row('Latest collection', date(contract.latestCollectionDate))]),
      row('Requested collection', date(contract.requestedCollectionDate)), row('Collection location', contract.collectionLocation),
      row('Current mileage', contract.currentOdometer), row('Expected return mileage', contract.expectedReturnMileage, contract.returnMileageUnit ?? 'mi'),
      row('Returned mileage', contract.returnedMileage, contract.returnMileageUnit ?? 'mi')]],
    ['Order and vehicle', [...orderRows(contract), row('Order date', date(contract.orderDate)), row('Order status', status(contract.orderStatus)),
      row('Registration', contract.registration), row('Delivered VIN', contract.vin), row('Chassis number', contract.chassisNumber),
      row('Registration date', date(contract.registrationDate)), ...slotRows(model, contract.slotId), row('Phone', contract.contact?.phone),
      row('Email', contract.contact?.email), row('Special requirements', contract.specialRequirements)]],
  ];
  const sections = blocks.map(([title, rows]) => recordSection(title, suppliedFacts(rows, 'gcsp-record-facts')
    ?? el('p', 'gcsp-note', 'Not supplied for this car.')));
  const specRows = [...standard.map((key) => row(technicalLabel(key), technical[key] ?? contract[key])),
    ...Object.entries(technical).filter(([key]) => !['provenance', 'source', ...standard].includes(key)).map(([key, value]) => row(technicalLabel(key), value)),
    row('Specification provenance', sourceLabel(technical.provenance ?? technical.source ?? contract.source))];
  sections.push(recordSection('Technical specification and options', el('p', 'gcsp-note', 'Model or handbook evidence does not confirm the fitted equipment on your car.'),
    suppliedFacts(specRows, 'gcsp-record-facts') ?? el('p', 'gcsp-note', 'Not supplied for this car.')));
  return sections;
}

export { recordSections };
