const clone = (value) => value === undefined ? undefined : structuredClone(value);
const text = (value) => typeof value === 'string' && value.trim() ? value : null;
const number = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const words = (value) => String(value).replaceAll(/[-_]/g, ' ');
const FACT_LABELS = { nedcCo2: 'NEDC CO2', wltpCo2: 'WLTP CO2', insuranceGroup: 'Insurance group', earliestCollection: 'Earliest collection' };
// Detail rows read as sentence case; known acronyms keep their capitals.
const factLabel = (key) => FACT_LABELS[key] ?? words(key).replaceAll(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/^./, (c) => c.toUpperCase());
const known = (fact) => fact?.status === 'known' && fact.value !== null && fact.value !== undefined;
const valueOf = (fact) => known(fact) ? fact.value : null;
const first = (...values) => values.find((value) => value !== null && value !== undefined) ?? null;
const exactDecision = (decision) => decision && text(decision.orderUuid) && text(decision.configurationId)
  && /^\d{7}$/.test(decision.orderNumber ?? '') && decision.snapshot?.identityKind === 'exact-stock'
  && decision.snapshot.sourceKeys?.stockId === decision.orderUuid
  && decision.snapshot.facts && typeof decision.snapshot.facts === 'object' && !Array.isArray(decision.snapshot.facts)
  && (decision.claimInput == null || decision.claimInput.orderUuid === decision.orderUuid);
const issuedClaim = (input, orderUuid) => input?.orderUuid === orderUuid
  && Number.isSafeInteger(input.expectedStockVersion) && input.expectedStockVersion > 0
  && Number.isSafeInteger(input.expectedDraftVersion) && input.expectedDraftVersion > 0
  && text(input.expectedContextVersion) && text(input.expectedTermsDigest);
const labels = { model: 'Model', body: 'Body style', engine: 'Engine', exterior: 'Exterior', interior: 'Interior',
  transmission: 'Transmission', insuranceGroup: 'Insurance group', earliestCollection: 'Earliest collection' };

const HIDDEN_UNITS = new Set(['insurance-group']);
function row(key, label, source, fallback = null) {
  const value = first(valueOf(source), fallback);
  // Some units are data codes the label already names (FUCQ-197); they are not shown.
  const unit = source?.unit && !HIDDEN_UNITS.has(source.unit) ? source.unit : null;
  return { key, label, value, status: value === null ? 'unknown' : 'known', unit,
    missingLabel: `Not supplied${unit ? ` (${unit})` : ''}`, provenance: clone(source?.provenance), source: clone(source) };
}

function emission(key, label, source, expected) {
  const observation = known(source) && typeof source.value === 'object' ? source.value : source;
  const basis = observation?.basis ?? source?.basis;
  const amount = known(source) ? number(observation?.value) : null;
  const unit = observation?.unit ?? source?.unit;
  const validBasis = typeof basis === 'string' && expected.test(basis);
  const valid = amount !== null && unit === 'g/km' && validBasis;
  return { key, label, status: valid ? 'known' : 'unknown', value: valid ? amount : null,
    unit: 'g/km', basis: validBasis ? basis : null, missingLabel: 'Not supplied (g/km)',
    provenance: clone(source?.provenance), source: clone(source) };
}

function evidence(entry) {
  return typeof entry === 'string' ? entry : { ...clone(entry), text: entry.text || entry.reason || words(entry.code || 'Not supplied') };
}

function suppliedPoints(input) {
  return input?.unit === 'points' ? number(input.value) : null;
}

/** One exact decision becomes one shared-card view; source data remains intact in detail. */
export function toManualCar(decision, versions = {}) {
  if (!exactDecision(decision)) throw new TypeError('Exact stock identity is required');
  const snapshot = decision.snapshot ?? {}; const facts = snapshot.facts ?? {}; const display = snapshot.display ?? {};
  const fields = {
    model: row('model', labels.model, facts.model ?? facts.marketingModelRange ?? facts.modelRange, text(display.model)),
    body: row('body', labels.body, facts.body ?? facts.bodyType), engine: row('engine', labels.engine, facts.engine, text(display.derivative)),
    exterior: row('exterior', labels.exterior, facts.exterior ?? facts.colour ?? facts.colors, text(display.colour)),
    interior: row('interior', labels.interior, facts.interior ?? facts.upholsteryCode), transmission: row('transmission', labels.transmission, facts.transmission),
    insuranceGroup: row('insuranceGroup', labels.insuranceGroup, facts.insuranceGroup),
    earliestCollection: row('earliestCollection', labels.earliestCollection, facts.earliestCollection ?? facts.earliestCollectionDate),
  };
  const emissions = [
    emission('nedcCo2', 'NEDC / correlated CO2', facts.nedcCo2 ?? facts.co2Nedc ?? facts.co2NEDC, /^(NEDC|NEDC-correlated|correlated)$/i),
    emission('wltpCo2', 'WLTP CO2', facts.wltpCo2 ?? facts.co2Wltp ?? facts.co2WLTP, /^WLTP$/i),
  ];
  const terms = decision.terms?.kind === 'employee-scheme' ? decision.terms : null;
  const contribution = terms?.contribution;
  const cash = contribution && number(contribution.amount) !== null && /^[A-Z]{3}$/.test(contribution.currency)
    && ['month', 'year', 'one-off'].includes(contribution.period) ? clone(contribution) : null;
  const cost = { kind: 'points-monthly', value: suppliedPoints(terms?.points), allowance: suppliedPoints(terms?.allowanceInputs?.allowance) };
  const gateStatus = ['eligible', 'ineligible', 'needs-confirmation'].includes(decision.gateStatus) ? decision.gateStatus : 'needs-confirmation';
  const blockers = (decision.blockers ?? []).map(evidence); const unknowns = (decision.unknowns ?? []).map(evidence);
  const reviewAvailable = gateStatus === 'eligible' && Boolean(issuedClaim(decision.claimInput, decision.orderUuid));
  const reason = gateStatus === 'ineligible' ? 'This car is not eligible.' : gateStatus === 'needs-confirmation' ? 'Confirm the missing information before reviewing this car.' : !reviewAvailable ? 'Refresh to review this car.' : null;
  const identity = { orderUuid: decision.orderUuid, orderNumber: decision.orderNumber,
    configurationId: decision.configurationId, candidateKey: decision.candidateKey };
  const selectedImage = display.images?.find((image) => image.src === display.photo);
  const media = { src: text(display.photo), alt: text(selectedImage?.alt) || text(display.name) || 'Car',
    caption: text(selectedImage?.caption) || (display.photo ? 'Representative image. See image provenance in vehicle details.' : null),
    provenance: clone(selectedImage?.provenance), images: clone(display.images ?? []) };
  const member = { id: decision.orderUuid, identity, display: { name: text(display.name) || 'Car name not supplied',
    line: [fields.model.value, fields.body.value, fields.engine.value].filter(Boolean).join(' · '), pickerLabel: decision.orderNumber },
  media, facts: [...Object.values(fields), ...emissions, { key: 'contribution', label: 'Scheme contribution',
    value: cash?.amount ?? null, unit: cash ? `${cash.currency}/${cash.period}` : null, status: cash ? 'known' : 'unknown',
    missingLabel: 'Not supplied', source: clone(contribution), provenance: clone(terms?.provenance) }], terms: [cost],
  decision: { gateStatus, score: null, reasons: [], tradeOffs: [], blockers, unknowns },
  versions: clone(decision.versions), evidence: clone(decision), actions: [{ id: 'review-car', kind: 'accept', label: 'Review this car',
    disabled: !reviewAvailable, disabledReason: reason }] };
  const allFacts = Object.entries(facts).map(([key, source]) => row(key, factLabel(key), source));
  const exactFacts = allFacts.filter((fact) => ['confirmed-build', 'confirmed-listing', 'synthetic-scenario'].includes(fact.provenance?.assurance));
  const referenceFacts = allFacts.filter((fact) => fact.provenance?.assurance === 'model-reference');
  return { id: decision.orderUuid, identity, gateStatus, fields, emissions, cost, contribution: cash,
    series: row('series', 'Series', facts.series), view: { schemaVersion: 1, selectedId: decision.orderUuid, members: [member] },
    detail: { identity: clone(identity), snapshot: clone(snapshot), facts: allFacts, exactFacts, referenceFacts,
      unclassifiedFacts: allFacts.filter((fact) => !exactFacts.includes(fact) && !referenceFacts.includes(fact)),
      equipment: clone(facts.equipment ?? facts.equipments ?? null), specifications: clone(facts.specifications ?? facts.technicalAndEmission ?? null),
      historic: clone(facts.historic ?? facts.history ?? null), media, terms: clone(decision.terms) },
    review: { ...identity, facts: clone(facts), snapshot: clone(snapshot), terms: clone(decision.terms),
      draftVersion: decision.draftVersion, versions: clone(versions), decisionVersions: clone(decision.versions),
      claimInput: clone(decision.claimInput) } };
}

export const MANUAL_SORTS = ['name', 'points', 'earliest-collection'];
const compare = (a, b) => String(a).localeCompare(String(b), 'en-GB', { numeric: true, sensitivity: 'base' });
const optionalCompare = (a, b) => a === null ? b === null ? 0 : 1 : b === null ? -1 : typeof a === 'number' ? a - b : compare(a, b);
const equipmentText = (value) => Array.isArray(value) ? value.map(equipmentText).join(' ')
  : value && typeof value === 'object' ? Object.entries(value).map(([key, item]) => `${key} ${equipmentText(item)}`).join(' ') : value ?? '';
const searchable = (car) => [car.view.members[0].display.name, car.identity.orderNumber, ...Object.values(car.fields).map((field) => field.value),
  car.detail.equipment?.status === 'known' ? equipmentText(car.detail.equipment.value) : null].flat(Infinity).map((item) => {
  if (item && typeof item === 'object') return [item.name, item.description, item.code].filter(Boolean).join(' ');
  return item ?? '';
}).join(' ').toLocaleLowerCase('en-GB');
const options = (cars, read) => [...new Set(cars.map(read).filter((value) => typeof value === 'string' && value.trim()))].sort(compare);
const sortValue = (car, sort) => sort === 'points' ? car.cost.value : sort === 'earliest-collection'
  ? typeof car.fields.earliestCollection.value === 'string' && Number.isFinite(Date.parse(car.fields.earliestCollection.value))
    ? Date.parse(car.fields.earliestCollection.value) : null : text(car.detail.snapshot.display?.name);

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const instant = (value) => typeof value === 'string' && /Z$/.test(value) && Number.isFinite(Date.parse(value));
const count = (value) => Number.isSafeInteger(value) && value >= 0;
function validReleaseHistory(value) {
  if (!record(value) || !text(value.runId) || !instant(value.observedAt) || !record(value.history)
    || value.source?.state !== 'current-version-unknown') return false;
  const h = value.history;
  if (!count(h.releasedCarCount) || !count(h.releaseCount) || !Array.isArray(h.sourceVersions)
    || h.sourceVersions.some((version) => !text(version)) || new Set(h.sourceVersions).size !== h.sourceVersions.length) return false;
  if (h.state === 'none-visible') return h.releasedCarCount === 0 && h.releaseCount === 0
    && h.latestReleasedAt === null && h.sourceVersions.length === 0;
  return h.state === 'released' && h.releasedCarCount > 0 && h.releaseCount > 0 && h.releaseCount <= h.releasedCarCount
    && instant(h.latestReleasedAt) && Date.parse(h.latestReleasedAt) <= Date.parse(value.observedAt)
    && h.sourceVersions.length > 0 && h.sourceVersions.length <= h.releaseCount;
}

/** History describes employee-visible releases, independently of current suitability. */
export function toManualGallery(envelope, controls = {}) {
  const empty = { cars: [], allCars: [], counts: { records: 0, eligible: 0, visible: 0, visibleEligible: 0 }, series: [], bodies: [], controls: { ...controls }, envelope: clone(envelope), releaseHistory: null };
  // A saved choice the server now refuses (a date past its window) needs the employee, not a retry (FUCQ-222).
  if (envelope?.status === 'invalid') return { ...empty, state: 'choices-invalid', invalidField: envelope.reasons?.[0]?.field ?? null };
  if (envelope?.status !== 'ok') return { ...empty, state: envelope?.status === 'stale-version' || envelope?.status === 'stale-run'
    ? 'context-refresh' : envelope?.view?.state === 'car-taken' ? 'car-taken' : 'source-unavailable' };
  const source = envelope.value;
  if (source?.releaseHistory !== undefined && (!validReleaseHistory(source.releaseHistory)
    || source.runId != null && source.runId !== source.releaseHistory.runId)) return { ...empty, state: 'source-unavailable' };
  const releaseHistory = clone(source?.releaseHistory ?? null);
  if (source?.state === 'nothing-released-yet') return { ...empty, releaseHistory,
    state: releaseHistory ? releaseHistory.history.state === 'none-visible' ? 'no-visible-releases' : 'empty-stock' : 'nothing-released-yet' };
  if (!['available-stock', 'no-eligible-stock', 'empty-stock'].includes(source?.state) || !Array.isArray(source?.decisions) || source.decisions.some((decision) => !exactDecision(decision))
    || new Set(source.decisions.map((d) => d.orderUuid)).size !== source.decisions.length) return { ...empty, state: 'source-unavailable' };
  const allCars = source.decisions.map((decision) => toManualCar(decision, source.versions));
  const query = String(controls.query ?? '').trim().toLocaleLowerCase('en-GB');
  const sort = MANUAL_SORTS.includes(controls.sort) ? controls.sort : 'name';
  const cars = allCars.filter((car) => (!query || searchable(car).includes(query)) && (!controls.series || car.series.value === controls.series)
    && (!controls.body || car.fields.body.value === controls.body)).sort((a, b) => optionalCompare(sortValue(a, sort), sortValue(b, sort))
      || compare(a.identity.orderNumber ?? a.id, b.identity.orderNumber ?? b.id) || compare(a.id, b.id));
  const eligible = allCars.filter((car) => car.gateStatus === 'eligible').length;
  return { ...empty, state: !allCars.length ? releaseHistory?.history.state === 'none-visible' ? 'no-visible-releases' : 'empty-stock'
    : !cars.length ? 'empty-search' : !eligible ? 'no-suitable-stock' : 'available-stock',
    releaseHistory, allCars, cars, counts: { records: allCars.length, eligible, visible: cars.length, visibleEligible: cars.filter((car) => car.gateStatus === 'eligible').length },
    series: options(allCars, (car) => car.series.value), bodies: options(allCars, (car) => car.fields.body.value), controls: { ...controls, sort },
    versions: clone(source.versions), assumptions: clone(source.assumptions), ranked: false, browsingReservesStock: false };
}
