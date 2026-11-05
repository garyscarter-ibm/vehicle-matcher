import { readFile } from 'node:fs/promises';

export const VIN_PROFILE_REGISTRY_VERSION = 'vin-profiles.v1';
const ARTIFACT = new URL('../../data/gcsp/vehicle-evidence/vin-profiles.v1.json', import.meta.url);
const FIELDS = ['model', 'derivative', 'generation', 'body', 'powertrain', 'drive', 'transmission',
  'engineCode', 'agModelCode', 'vgModelCode', 'market', 'region', 'steering', 'modelYear',
  'productionEra', 'productionDate'];
const UNKNOWN = new Set(['transmission', 'engineCode', 'agModelCode', 'vgModelCode', 'productionDate']);
const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const code = (value, length) => typeof value === 'string' && new RegExp(`^[A-HJ-NPR-Z0-9]{${length}}$`).test(value);
const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const copy = (value) => structuredClone(value);
const identity = (configuration) => Object.fromEntries([...FIELDS, 'plant'].map((key) => [key, configuration[key]]));
const validValue = (key, value) => value === null ? UNKNOWN.has(key)
  : key === 'modelYear' ? Number.isInteger(value) && value >= 1980 && value <= 2100
    : key === 'productionDate' ? date(value) : text(value);
const validConfiguration = (configuration) => object(configuration)
  && FIELDS.every((key) => Object.hasOwn(configuration, key) && validValue(key, configuration[key]))
  && code(configuration.plant, 1);

function validRegistry(data, version) {
  if (!object(data) || data.schemaVersion !== '1' || data.registryVersion !== version
    || data.identityScope !== 'delivered-and-current-cars-only' || !Array.isArray(data.sources)
    || !Array.isArray(data.profiles) || data.profiles.length === 0 || !Array.isArray(data.additionalWmiReferences)) return false;
  const sources = new Set(data.sources.map((source) => source?.id));
  const refs = (values) => Array.isArray(values) && values.length > 0 && values.every((ref) => sources.has(ref));
  if (sources.size !== data.sources.length || data.sources.some((source) => !object(source)
    || !text(source.id) || !text(source.kind) || !text(source.source) || !text(source.scope)
    || !date(source.observedDate) || !(source.sourceDate === null || date(source.sourceDate)))) return false;
  if (new Set(data.profiles.map((profile) => profile?.profileId)).size !== data.profiles.length) return false;
  return data.profiles.every((profile) => {
    if (!object(profile) || !text(profile.profileId) || profile.profileVersion !== '1'
      || !['enabled', 'candidate'].includes(profile.status) || profile.referenceOnly !== true
      || !object(profile.binding) || !object(profile.format) || !object(profile.evidence)
      || !refs(profile.evidence.sourceRefs) || !date(profile.evidence.observedDate)
      || !text(profile.evidence.confidence) || !Array.isArray(profile.evidence.unresolvedFacts)
      || !profile.evidence.unresolvedFacts.every(text) || !Array.isArray(profile.evidence.limitations)
      || !profile.evidence.limitations.every(text)) return false;
    const { format } = profile;
    if (!code(format.wmi, 3) || !code(format.descriptor?.value, 5)) return false;
    if (profile.status === 'candidate') return format.position9?.convention === 'unresolved'
      && format.position10?.convention === 'unresolved' && format.allowedPlants?.length === 0;
    return FIELDS.every((key) => Object.hasOwn(profile.binding, key) && validValue(key, profile.binding[key]))
      && profile.binding.market === 'US' && profile.binding.region === 'North America'
      && profile.binding.steering === 'LHD' && format.descriptor.kind === 'whole-value'
      && format.position9?.convention === 'calculated-modulo-11' && refs(format.position9.sourceRefs)
      && format.position10?.convention === 'US-model-year' && format.position10.modelYear === profile.binding.modelYear
      && code(format.position10.value, 1) && refs(format.position10.sourceRefs)
      && Array.isArray(format.allowedPlants) && format.allowedPlants.length > 0
      && new Set(format.allowedPlants.map((plant) => plant?.code)).size === format.allowedPlants.length
      && format.allowedPlants.every((plant) => code(plant?.code, 1) && text(plant.city) && refs(plant.sourceRefs))
      && format.serial?.shape === 'NNNNNN' && format.serial.pattern === '^[0-9]{6}$'
      && format.serial.status === 'fictional-allocation' && text(format.serial.confidence) && refs(format.serial.sourceRefs)
      && Array.isArray(profile.evidence.facts) && profile.evidence.facts.length > 0
      && profile.evidence.facts.every((fact) => Array.isArray(fact?.fields) && fact.fields.length > 0
        && fact.fields.every(text) && refs(fact.sourceRefs) && text(fact.confidence))
      && profile.evidence.partialDecode?.httpStatus === 200 && profile.evidence.partialDecode.businessCode === '6'
      && profile.evidence.partialDecode.businessText === '6 - Incomplete VIN'
      && profile.evidence.partialDecode.completeVinDecoded === false;
  }) && data.additionalWmiReferences.every((reference) => code(reference?.wmi, 3)
    && code(reference.vds, 5) && text(reference.model) && reference.status === 'reference-only'
    && sources.has(reference.sourceId) && Number.isInteger(reference.modelYear));
}

function envelope(status, version = VIN_PROFILE_REGISTRY_VERSION) {
  return { provider: 'gcsp-vin-profile-registry', schemaVersion: '1', registryVersion: version,
    identityScope: 'delivered-and-current-cars-only', sourceKind: 'evidenced-reference', status,
    requestedIdentity: null, resolvedIdentity: null, profile: null, sources: [], mismatchedFields: [],
    equipment: { selected: { state: 'unknown', codes: null }, verifiedFitted: { state: 'unknown', codes: null } } };
}

function projectProfile(profile) {
  return copy(Object.fromEntries(['profileId', 'profileVersion', 'status', 'referenceOnly', 'binding', 'format', 'evidence']
    .map((key) => [key, profile[key]])));
}

/** Offline selection port; it allocates no VIN and opens no network connection. */
export function createVinProfileRegistry({ loadRegistry = async () => JSON.parse(await readFile(ARTIFACT, 'utf8')) } = {}) {
  async function load(version) {
    if (version !== VIN_PROFILE_REGISTRY_VERSION) return { status: 'unsupported' };
    try {
      const data = await loadRegistry(version);
      return validRegistry(data, version) ? { status: 'ok', data } : { status: 'source-unavailable' };
    } catch {
      return { status: 'source-unavailable' };
    }
  }
  return {
    async list({ registryVersion = VIN_PROFILE_REGISTRY_VERSION } = {}) {
      const loaded = await load(registryVersion);
      return { ...envelope(loaded.status, registryVersion), profiles: loaded.data?.profiles.map(projectProfile) || [],
        additionalWmiReferences: copy(loaded.data?.additionalWmiReferences || []), sources: copy(loaded.data?.sources || []) };
    },
    async resolve(configuration, { profileId, usage, referenceOnly, registryVersion = VIN_PROFILE_REGISTRY_VERSION } = {}) {
      if (!['delivered-car', 'current-car'].includes(usage) || referenceOnly !== true) return envelope('unsupported');
      if (!text(profileId) || !validConfiguration(configuration)) return envelope('invalid-input');
      const loaded = await load(registryVersion);
      const result = envelope(loaded.status, registryVersion);
      if (!loaded.data) return result;
      result.requestedIdentity = identity(configuration);
      const profile = loaded.data.profiles.find((entry) => entry.profileId === profileId);
      if (!profile || profile.status !== 'enabled') return { ...result, status: 'unsupported' };
      result.mismatchedFields = FIELDS.filter((key) => configuration[key] !== profile.binding[key]);
      for (const [key, expected] of [['wmi', profile.format.wmi], ['descriptor', profile.format.descriptor.value]]) {
        if (Object.hasOwn(configuration, key) && configuration[key] !== expected) result.mismatchedFields.push(key);
      }
      if (!profile.format.allowedPlants.some(({ code: plant }) => plant === configuration.plant)) result.mismatchedFields.push('plant');
      if (result.mismatchedFields.length) return { ...result, status: 'identity-mismatch' };
      result.profile = projectProfile(profile);
      result.resolvedIdentity = identity(configuration);
      result.sources = copy(loaded.data.sources.filter(({ id }) => profile.evidence.sourceRefs.includes(id)));
      return result;
    },
  };
}

export const resolveVinProfile = (configuration, options) => createVinProfileRegistry().resolve(configuration, options);

/** Plain presentation contract, shared by later consumers without adding a screen. */
export function presentVinProfile(result) {
  if (result?.status !== 'ok' || !result.profile) return { status: result?.status || 'source-unavailable', context: null };
  const { profile } = result;
  return { status: result.status, referenceOnly: profile.referenceOnly,
    context: `${profile.binding.market} / ${profile.binding.region} / ${profile.binding.steering} / MY${profile.binding.modelYear}`,
    notice: 'North American structural reference only. Unknown build facts remain unknown.',
    confidence: profile.evidence.confidence, unknownFields: copy(profile.evidence.unresolvedFacts),
    decodeStatus: profile.evidence.partialDecode.businessText,
    completeVinDecoded: profile.evidence.partialDecode.completeVinDecoded,
    serialAllocation: profile.format.serial.status, sources: copy(result.sources) };
}
