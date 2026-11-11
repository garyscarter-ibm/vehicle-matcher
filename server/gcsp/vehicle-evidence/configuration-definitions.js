import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const CONFIGURATION_DEFINITIONS_SHA256 = '7327f922585d0a5eabe5dca00363bc2f2e7ed29816c9c91bb17a304beddab939';
const seedFile = new URL('../../data/gcsp/vehicle-evidence/configuration-definitions.v1.json', import.meta.url);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 8192;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const copy = (value) => structuredClone(value);
const unknown = (reason) => ({ state: 'unknown', value: null, reason, completeness: 'unknown',
  provenance: { kind: 'unknown', source: null, observedDate: null } });
const swatchUnknown = () => unknown('source-swatch-unavailable');
const selectedCodes = (record) => record?.catalogue?.equipment?.selected;
const bound = (record, selected) => text(record?.configurationId) && object(record.configuration)
  && Array.isArray(selected?.options) && selected.options.every(text) && new Set(selected.options).size === selected.options.length
  && Array.isArray(record.canonicalIdentity?.factoryOptionCodes)
  && JSON.stringify(record.canonicalIdentity.factoryOptionCodes) === JSON.stringify(selected.options)
  && record.canonicalIdentity.vgModelCode === record.configuration.vgModelCode
  && record.configurationId === Buffer.from(`${record.configuration.vgModelCode}:${[...selected.options].sort().join(',')}`).toString('base64');

/** Compile once. Runtime reads touch only the exact context and selected-code maps. */
export function createConfigurationDefinitionIndex(seed, { digest } = {}) {
  if (seed?.schemaVersion !== '1' || !text(seed.version) || !Array.isArray(seed.variants)
    || seed.variants.length > 1000 || !/^[a-f0-9]{64}$/.test(digest ?? '')) throw new TypeError('Invalid definition seed.');
  const variants = new Map(); let resolutions = 0;
  for (const variant of seed.variants) {
    if (!text(variant.source) || variants.has(variant.source) || !text(variant.market) || !text(variant.vgModelCode)
      || !Array.isArray(variant.generations) || !Array.isArray(variant.agModelCodes)
      || !Array.isArray(variant.sources) || !object(variant.definitions) || Object.keys(variant.definitions).length > 512)
      throw new TypeError('Invalid definition variant.');
    const definitions = new Map();
    for (const [code, definition] of Object.entries(variant.definitions)) {
      if (!text(code) || !['known', 'unknown'].includes(definition.state) || !Array.isArray(definition.candidates)
        || definition.candidates.some((candidate) => !text(candidate.label) || candidate.label.length > 512
          || !text(candidate.category) || !Array.isArray(candidate.sources) || !candidate.sources.length
          || candidate.sources.some((index) => !Number.isInteger(index) || !variant.sources[index]
            || !/^\d{4}-\d{2}-\d{2}$/.test(variant.sources[index].observedDate)))
        || (definition.state === 'known') !== (definition.candidates.length === 1)) throw new TypeError('Invalid code definition.');
      definitions.set(code, copy(definition));
    }
    variants.set(variant.source, { ...copy(variant), definitions });
  }
  const identity = { version: seed.version, digest };
  function resolve(record) {
    resolutions += 1;
    const selected = selectedCodes(record);
    const base = { ...identity, configurationId: record?.configurationId ?? null,
      claim: 'selected-catalogue-equipment', verifiedFitted: 'unknown', swatches: 'unknown' };
    if (selected?.state !== 'known' || !bound(record, selected)) return { ...base, state: 'unknown',
      reason: selected?.state === 'known' ? 'configuration-identity-unavailable' : 'selection-unavailable',
      selectedCount: selected?.options?.length ?? 0, resolvedCount: 0, unresolved: [], definitions: [] };
    const sources = [...new Set(record.sourceContext?.sourceRefs?.filter((source) => source.includes('/options/languages/')) ?? [])];
    const variant = sources.length === 1 ? variants.get(sources[0]) : null;
    const applicable = variant && variant.market === record.configuration.market && variant.vgModelCode === record.configuration.vgModelCode
      && variant.generations.includes(record.configuration.generation) && variant.agModelCodes.includes(record.configuration.agModelCode);
    const definitions = []; const unresolved = [];
    for (const code of selected.options) {
      const definition = applicable ? variant.definitions.get(code) : null;
      if (definition?.state !== 'known') {
        unresolved.push({ code, reason: !applicable ? 'definition-context-unavailable' : definition?.reason ?? 'definition-unavailable' });
        continue;
      }
      const candidate = definition.candidates[0];
      const observedDate = variant.sources[candidate.sources[0]].observedDate;
      definitions.push({ code, category: candidate.category, label: { state: 'known', value: candidate.label,
        completeness: 'partial', provenance: { kind: 'observed', source: variant.source, observedDate } } });
    }
    return { ...base, state: unresolved.length ? definitions.length ? 'partial' : 'unknown' : 'complete',
      reason: unresolved.length ? 'selected-definitions-incomplete' : null,
      selectedCount: selected.options.length, resolvedCount: definitions.length, unresolved, definitions };
  }
  return Object.freeze({ resolve, identity: () => ({ ...identity }), coverage: () => copy(seed.population),
    diagnostics: () => ({ indexBuilds: 1, variants: variants.size, resolutions, lookup: 'exact-context-and-selected-code-maps' }) });
}

let loaded;
export function loadConfigurationDefinitionIndex() {
  loaded ??= readFile(seedFile).then((bytes) => {
    if (bytes.length > 2 * 1024 * 1024 || hash(bytes) !== CONFIGURATION_DEFINITIONS_SHA256) throw new Error('definition-seed-changed');
    return createConfigurationDefinitionIndex(JSON.parse(bytes), { digest: CONFIGURATION_DEFINITIONS_SHA256 });
  });
  return loaded;
}

/** Decorate detached registry results; the immutable corpus and already-pinned quotes are never rewritten. */
export function withConfigurationDefinitions(registry, { index = loadConfigurationDefinitionIndex() } = {}) {
  const ready = Promise.resolve(index).then((value) => ({ value }), () => ({ value: null }));
  async function enrich(source) {
    if (!source?.record) return source;
    const { value } = await ready;
    const resolution = value ? value.resolve(source.record) : { version: null, digest: null, configurationId: source.record.configurationId,
      state: 'unknown', reason: 'definition-seed-unavailable', claim: 'selected-catalogue-equipment', verifiedFitted: 'unknown',
      swatches: 'unknown', selectedCount: selectedCodes(source.record)?.options?.length ?? 0, resolvedCount: 0, unresolved: [], definitions: [] };
    const enriched = copy(source);
    if (enriched.record.catalogue?.equipment) {
      const existing = enriched.record.catalogue.equipment.definitions ?? [];
      const selected = new Set(selectedCodes(source.record)?.options ?? []);
      const joined = new Map(existing.map((definition) => [definition.code, definition]));
      for (const definition of resolution.definitions) if (selected.has(definition.code)) joined.set(definition.code, definition);
      enriched.record.catalogue.equipment.definitions = [...joined.values()];
    }
    const { definitions: _definitions, ...metadata } = resolution;
    enriched.definitionResolution = metadata;
    return enriched;
  }
  return Object.freeze({ ...registry,
    async getConfiguration(id) { return enrich(await registry.getConfiguration(id)); },
    async getVin(id) { return enrich(await registry.getVin(id)); },
    async definitionStatus() { const { value } = await ready; return value ? { status: 'ok', ...value.identity(),
      coverage: value.coverage(), diagnostics: value.diagnostics() } : { status: 'source-unavailable', reason: 'definition-seed-unavailable' }; },
  });
}

/** Simple existing snapshot facts for the producer seam, with catalogue evidence retained in each provenance. */
export function selectedConfigurationDefinitionFacts(details) {
  const selected = details?.equipment?.selected;
  if (selected?.state !== 'known' || details?.identity?.configurationId !== details?.resolved?.configurationId) return {};
  const definitions = details.equipment.definitions.filter((entry) => selected.options.includes(entry.code) && entry.label?.state === 'known');
  const resolution = details.equipment.resolution;
  const fact = (value, label) => ({ status: 'known', value, unit: null,
    provenance: { sourceRef: label.provenance.source, observedAt: `${label.provenance.observedDate}T00:00:00.000Z`,
      version: resolution?.version ? `${resolution.version}:${resolution.digest}` : details.versions.snapshot,
      assurance: 'model-reference' } });
  const result = {};
  for (const [name, category] of [['colour', 'paint'], ['interior', 'fabric']]) {
    const matches = definitions.filter((entry) => entry.category === category);
    if (matches.length === 1) result[name] = fact(matches[0].label.value, matches[0].label);
  }
  const options = definitions.filter((entry) => !['paint', 'fabric'].includes(entry.category));
  const missing = selected.options.length - definitions.length;
  if (options.length) result.options = fact([...options.map((entry) => entry.label.value),
    ...(missing ? [`${missing} selected ${missing === 1 ? 'code' : 'codes'} without a readable definition`] : [])], options[0].label);
  return result;
}

export { swatchUnknown };
