/** Transport-independent vehicle evidence. Source payload/storage names end here. */
export const VEHICLE_DETAILS_VERSION = '1.0.0';
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const copy = (v) => v === undefined ? null : structuredClone(v);
const failures = {
  'invalid-input': ['invalid-vehicle-identifier', 'Use a canonical configuration ID, stock order UUID or 17-character VIN for the selected route.', 'correct-identifier', false],
  'not-found': ['vehicle-not-found', 'This identifier is absent from the selected local data. Check the identifier and selected demo dataset.', 'check-identifier', false],
  'source-unavailable': ['vehicle-source-unavailable', 'The local vehicle source is unavailable. Restore or configure its validated published inputs and retry.', 'retry-source', true],
  unsupported: ['vehicle-profile-unsupported', 'The selected source cannot satisfy this vehicle profile. Choose a supported dataset or contact scheme support.', 'review-profile', false],
  'identity-mismatch': ['vehicle-identity-mismatch', 'The identity, configuration or current demo run does not match. Refresh the current context and review the source association.', 'refresh-review', false],
};
const http = { complete: 200, partial: 200, 'invalid-input': 400, 'not-found': 404,
  'source-unavailable': 503, unsupported: 422, 'identity-mismatch': 409 };
export const vehicleEvidenceHttpStatus = (outcome) => http[outcome?.status] || 503;

const base = (status, kind) => ({ contractVersion: VEHICLE_DETAILS_VERSION, schemaVersion: '1',
  provider: 'local-vehicle-evidence', providerVersion: '1', status,
  requested: { kind: ['configuration', 'stock', 'vin'].includes(kind) ? kind : null, id: null },
  resolved: null, identity: null, failure: null, completeness: null,
  routing: { mode: 'offline', liveEligible: false },
});

/** Unknown/arbitrary identifiers and underlying exceptions are deliberately not reflected. */
export function vehicleEvidenceFailure(status, kind) {
  status = Object.hasOwn(failures, status) ? status : 'source-unavailable';
  const [code, message, action, retryable] = failures[status];
  return { ...base(status, kind), failure: { code, message, action, retryable } };
}

const unknownProvenance = () => ({ kind: 'unknown', source: null, observedDate: null });
const unknown = (reason = 'source-evidence-unavailable') => ({ state: 'unknown', value: null,
  reason, completeness: 'unknown', provenance: unknownProvenance() });
const attributed = (value, provenance) => value === undefined || value === null ? unknown()
  : { state: 'known', value: copy(value), completeness: 'partial', provenance: copy(provenance) };
const measurements = {
  seats: ['SEATS', 'COUNT'], luggageNormal: ['NORMAL', 'LITRES'], luggageExpanded: ['EXPANDED', 'LITRES'],
  acceleration: ['0–100 KM/H', 'SECONDS'], bodyLength: ['BODY LENGTH', 'MILLIMETRES'],
};
function technicalFacts(catalogue, supplement) {
  return Object.fromEntries(Object.entries(measurements).map(([key, [definition, unit]]) => {
    const fact = supplement?.facts?.[key] || catalogue?.facts?.[key];
    return [key, fact && ['known', 'unknown'].includes(fact.state) && fact.definition === definition && fact.unit === unit
      ? copy(fact) : { ...unknown(), definition, unit }];
  }));
}
function equipmentFacts(catalogue) {
  const e = catalogue?.equipment;
  return {
    definitions: copy(e?.definitions) || [],
    available: copy(e?.available) || { state: 'unknown', codes: null, completeness: 'unknown' },
    selected: copy(e?.selected) || { state: 'unknown', options: null, accessories: null, complete: false, completeness: 'unknown' },
    // A catalogue and a fictional identity association cannot verify a physical build.
    verifiedFitted: { state: 'unknown', codes: null, reason: 'source-does-not-verify-fitting' },
  };
}
function selectedAppearance(equipment, category) {
  const selections = equipment.selected.state !== 'known' ? [] : equipment.definitions
    .filter((entry) => entry.category === category && equipment.selected.options?.includes(entry.code))
    .map((entry) => ({ code: entry.code, label: copy(entry.label), claim: 'selected-catalogue-equipment' }));
  return { state: selections.length ? 'known' : 'unknown', selections,
    ...(selections.length ? {} : { reason: 'source-selection-unavailable' }) };
}

/** Only called after the lookup module has checked the exact immutable associations. */
export function vehicleEvidenceDetails(request, source, stock = null) {
  const record = source.record; const configuration = record.configuration; const catalogue = record.catalogue;
  const vehicle = source.vehicle; const identity = stock?.facts?.syntheticIdentity || vehicle;
  const status = source.status === 'partial' ? 'partial' : 'complete';
  const evidence = record.sourceContext;
  const provenance = { kind: evidence.sourceKind === 'dated-snapshot' ? 'observed' : 'reference',
    source: copy(evidence.sourceRefs), observedDate: evidence.observedDate };
  const equipment = equipmentFacts(catalogue);
  const images = (source.images || []).map((image) => ({ imageId: image.imageId, asset: image.asset,
    role: image.role, fidelity: image.fidelity, sourceKind: image.sourceKind, observedDate: image.observedDate,
    label: image.fidelity === 'representative-configuration' ? 'Representative configuration image' : 'Representative model image' }));
  const result = {
    ...base(status, request.kind), requested: { kind: request.kind, id: request.id },
    resolved: { kind: request.kind, id: request.id, configurationId: record.configurationId },
    identity: { kind: request.kind, identityKind: 'synthetic', configurationId: record.configurationId,
      vehicleId: identity?.vehicleId || null, datasetId: source.active.datasetId,
      originatingDatasetId: identity?.originatingDatasetId || source.active.datasetId,
      orderUuid: stock?.orderUuid || null, orderNumber: stock?.orderNumber || null,
      vin: request.kind === 'vin' ? vehicle.vin17 : null,
      usage: stock ? 'stock' : vehicle?.usage || 'configuration' },
    versions: { corpus: source.active.version, manifestDigest: source.active.manifestDigest,
      snapshot: record.snapshotVersion, profileRegistry: vehicle?.profile?.registryVersion || null,
      generator: identity?.generatorVersion || null },
    description: {
      model: attributed(configuration.model, provenance), derivative: attributed(configuration.derivative, provenance),
      generation: attributed(configuration.generation, provenance), bodyType: attributed(configuration.body, provenance),
      powertrain: { fuel: attributed(configuration.powertrain, provenance), drive: attributed(configuration.drive, provenance),
        transmission: attributed(configuration.transmission, provenance), engine: attributed(configuration.engineCode, provenance) },
      paint: selectedAppearance(equipment, 'paint'), upholstery: selectedAppearance(equipment, 'fabric'),
    },
    technical: technicalFacts(catalogue, source.technicalSupplement), equipment,
    images: { state: images.length ? 'representative' : 'unknown', label: images.length ? 'Representative imagery' : 'Images unavailable', items: images },
    source: { kind: evidence.sourceKind, references: copy(evidence.sourceRefs), confidence: evidence.confidence,
      observedDate: evidence.observedDate, retrievedDate: catalogue?.retrievedDate || null,
      catalogueDate: evidence.catalogueDate, catalogueValidity: copy(catalogue?.catalogueValidity),
      requestedIdentity: copy(catalogue?.requestedIdentity), resolvedIdentity: copy(catalogue?.resolvedIdentity),
      configurationIdentity: copy(record.canonicalIdentity),
      market: configuration.market, region: configuration.region, steering: configuration.steering,
      agModelCode: configuration.agModelCode, vgModelCode: configuration.vgModelCode,
      modelYear: configuration.modelYear, productionEra: configuration.productionEra,
      productionDate: configuration.productionDate, registrationDate: vehicle?.registrationDate || null,
      profile: copy(vehicle?.profile), profileSources: copy(vehicle?.sources),
      profileConfidence: vehicle?.confidence || null, completeVinDecoded: false,
      unresolvedFacts: copy(evidence.unresolvedFacts), identityProvenance: copy(record.canonicalIdentity.provenance) },
    completeness: { record: status, selectedOptions: evidence.selectedOptionCompleteness,
      measurements: source.technicalSupplement ? 'partial' : catalogue?.completeness?.measurements || 'unknown',
      optionDefinitions: (catalogue?.schemaVersion === '2' ? catalogue.completeness?.definitions : catalogue?.completeness?.optionDefinitions) || 'unknown',
      availableOptions: (catalogue?.schemaVersion === '2' ? catalogue.completeness?.availability : catalogue?.completeness?.availableOptions) || 'unknown', verifiedFitted: 'unknown',
      images: images.length ? 'representative' : 'unknown' },
    presentation: { syntheticLabel: 'Synthetic identity',
      associationLabel: 'Fictional identity association to retained configuration evidence; not a factory build or authentication.',
      sourceLabel: evidence.sourceKind === 'dated-snapshot' ? 'Dated catalogue snapshot' : 'North American structural reference',
      verifiedFittedLabel: 'VIN-fitted equipment unknown',
      unknownLabel: 'Unknown', imageLabel: images.length ? 'Representative imagery' : 'Images unavailable' },
  };
  return result;
}

export function validVehicleEvidenceSource(source) {
  return object(source?.record) && object(source.record.configuration) && object(source.record.sourceContext)
    && object(source.record.canonicalIdentity) && object(source.active)
    && typeof source.active.datasetId === 'string' && typeof source.active.version === 'string'
    && Array.isArray(source.record.sourceContext.sourceRefs) && Array.isArray(source.record.sourceContext.unresolvedFacts)
    && Array.isArray(source.images) && source.images.every((image) => object(image)
      && image.configurationId === source.record.configurationId
      && ['representative-model', 'representative-configuration'].includes(image.role) && image.role === image.fidelity);
}
