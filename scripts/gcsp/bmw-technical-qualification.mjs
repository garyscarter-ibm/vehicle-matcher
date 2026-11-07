/** Approved existing OTD reference-code meanings, applied to one exact retained source observation. */
import { createHash } from 'node:crypto';
import { inputDigest } from '../../server/gcsp/repository/core.js';
import { BMW_OTD_MEASUREMENT_MAPPING, BMW_OTD_MEASUREMENT_MAPPING_VERSION } from '../../server/vehicle-evidence/bmw-catalogue-adapter.js';
import { BMW_ENRICHMENT_OBSERVATION_SOURCE_VERSION, bmwEnrichmentObservationRequestUrls,
  validateBmwEnrichmentObservationRegistration } from './bmw-public-registration.mjs';
import { requireValue } from './configuration-key.mjs';
export const BMW_OTD_MAPPING_AUTHORITY = Object.freeze({ version: BMW_OTD_MEASUREMENT_MAPPING_VERSION,
  digest: inputDigest({ version: BMW_OTD_MEASUREMENT_MAPPING_VERSION, mapping: BMW_OTD_MEASUREMENT_MAPPING }),
  source: 'existing-bmw-catalogue-adapter-reference-code-mapping' });
const sha = (v) => createHash('sha256').update(v).digest('hex');
const same = (a, b) => inputDigest(a) === inputDigest(b);
export function qualifyBmwTechnicalObservation({ artifact, accepted, registration: input, pins } = {}) {
  const r = validateBmwEnrichmentObservationRegistration(input); const doc = artifact?.document; const observation = doc?.observation;
  const encoded = JSON.stringify(doc) + '\n'; const binding = accepted?.catalogue?.sourceBinding; const context = binding?.confirmedContext;
  requireValue(pins && pins.mappingDigest === BMW_OTD_MAPPING_AUTHORITY.digest
    && sha(JSON.stringify(accepted) + '\n') === pins.acceptedLineSha256 && pins.acceptedLineSha256 === r.sourceAcceptedSha256
    && artifact?.sha256 === pins.retainedSha256 && sha(encoded) === pins.retainedSha256 && artifact.bytes === Buffer.byteLength(encoded)
    && doc?.schemaVersion === 'bmw-enrichment-source-observation.v1' && doc.requestScope?.role === 'request-input-only'
    && doc.requestScope.operation === 'technical' && same(doc.requestScope.registration, r)
    && observation?.schemaVersion === 'collection-http-observation.v1' && observation.operation === 'technical'
    && observation.sourceId === 'bmw-uk-public' && observation.sourceVersion === BMW_ENRICHMENT_OBSERVATION_SOURCE_VERSION
    && observation.capability === 'bmw-otd' && ['live', 'fixture'].includes(observation.transportKind)
    && observation.responseSha256 === pins.responseSha256 && /^[a-f0-9]{64}$/.test(pins.responseSha256)
    && observation.request?.method === 'GET' && observation.request.url === bmwEnrichmentObservationRequestUrls(r).technical
    && /^\d{4}-\d{2}-\d{2}T/.test(observation.observedAt) && Number.isFinite(Date.parse(observation.observedAt))
    && doc.report?.admission === false && doc.report.meaningsQualified === false && doc.report.unitsQualified === false
    && Array.isArray(doc.report.values) && doc.report.values.length <= 512
    && new Set(doc.report.values.map((v) => v.code)).size === doc.report.values.length
    && accepted?.admission === true && accepted.configurationId === r.configurationId
    && accepted.catalogueRequest?.bindingDigest === r.bindingDigest && accepted.lookupIdentity?.bindingDigest === r.bindingDigest
    && inputDigest(binding) === r.bindingDigest && binding.canonicalIdentity.vgModelCode === r.model.modelCode
    && binding.canonicalIdentity.agModelCode === r.model.agModelCode && same(binding.selection.factoryOptionCodes, r.factoryOptionCodes)
    && binding.selection.accessories.length === 0 && binding.requestScope.market === r.model.market
    && binding.requestScope.locale === r.model.locale && binding.requestScope.catalogueRangeKey === r.model.catalogueRangeKey
    && ['modelCode', 'agModelCode', 'rawModelRange', 'orderDate', 'effectDate'].every((k) => context?.[k]?.state === 'known' && context[k].value === r.model[k]),
  'technical-evidence-mismatch', 'Qualify only the exact accepted row, retained source artifact, request context and approved mapping pins.');
  const observedDate = observation.observedAt.slice(0, 10); const facts = {}; const measurementEvidence = {};
  for (const [name, [reference, definition, unit]] of Object.entries(BMW_OTD_MEASUREMENT_MAPPING)) {
    const value = doc.report.values.find((v) => v.code === reference); const raw = value?.targetValue;
    const known = value?.referenceName === reference && value.pointer === '/values/' + reference
      && typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && (unit !== 'COUNT' || Number.isSafeInteger(raw));
    const reason = raw === '0000' ? 'placeholder-value' : raw === undefined ? 'missing-value' : 'malformed-value';
    facts[name] = { state: known ? 'known' : 'unknown', value: known ? raw : null, definition, unit,
      reason: known ? null : reason, completeness: known ? 'complete' : 'unknown',
      provenance: known ? { kind: 'observed', source: 'BMW UK OTD', observedDate } : { kind: 'unknown', source: null, observedDate: null } };
    measurementEvidence[name] = { sourceCode: reference, sourcePointer: '/values/' + reference, sourceUnit: null,
      unitAuthority: 'approved-reference-code-mapping', meaningAuthority: 'approved-reference-code-mapping', mappingVersion: BMW_OTD_MAPPING_AUTHORITY.version,
      mappingDigest: BMW_OTD_MAPPING_AUTHORITY.digest, retainedSha256: artifact.sha256, responseSha256: observation.responseSha256 };
  }
  const mapped = new Set(Object.values(BMW_OTD_MEASUREMENT_MAPPING).map(([code]) => code));
  return { status: 'partial', configurationId: r.configurationId, bindingDigest: r.bindingDigest, facts, measurementEvidence,
    mappingAuthority: { ...BMW_OTD_MAPPING_AUTHORITY }, source: { provider: 'bmw-uk-public-otd', sourceVersion: observation.sourceVersion,
      outcome: 'ok', sourceKind: 'dated-snapshot', transportKind: observation.transportKind, observedDate, retrievedDate: observedDate,
      responseSha256: observation.responseSha256, retainedSha256: artifact.sha256, requestRegistrationDigest: inputDigest(r),
      acceptedLineSha256: pins.acceptedLineSha256, bindingDigest: r.bindingDigest, mappingAuthority: { ...BMW_OTD_MAPPING_AUTHORITY } },
    unmappedKeys: doc.report.values.filter((v) => !mapped.has(v.code)).map((v) => v.code) };
}
