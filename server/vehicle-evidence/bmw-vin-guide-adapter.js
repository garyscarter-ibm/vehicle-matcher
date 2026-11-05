const SCHEMA_VERSION = '1';
const STATES = new Set(['available', 'no-guide', 'unsupported-locale', 'partial', 'source-unavailable']);
const UNKNOWN_FACTS = ['paint', 'wheels', 'installedEquipment', 'buildDate', 'connectedUsage', 'schemeEligibility'];
const MESSAGES = {
  disabled: 'Handbook lookup is disabled. Other current-car evidence is unchanged.',
  'invalid-input': 'Supply a complete 17-character VIN and an explicit language and region.',
  available: 'Handbook content is available. Described equipment may not be fitted to this car.',
  'no-guide': 'No handbook was returned for this request. Vehicle equipment remains unknown.',
  'unsupported-locale': 'The requested handbook language is unsupported. No alternative was selected.',
  partial: 'Some handbook content is available. Missing content and vehicle equipment remain unknown.',
  'source-unavailable': 'Handbook lookup is unavailable. Other current-car evidence is unchanged.',
};
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const label = (value, max = 512) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
  && !/[<>\u0000-\u001f\u007f]/.test(value) && !/(?:https?:|data:|javascript:|[A-HJ-NPR-Z0-9]{17})/i.test(value);
const id = (value) => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9.-]{0,63}$/.test(value)
  && !/[A-HJ-NPR-Z0-9]{17}/i.test(value);
const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const equipment = () => ({ state: 'unknown', codes: null, complete: false });

/** Format validation is deliberately independent of regional checksum rules and identity authority. */
export function canonicalBmwVinGuideRequest(request) {
  if (!object(request) || typeof request.vin !== 'string' || !/^[a-hj-npr-z0-9]{17}$/i.test(request.vin)
    || typeof request.locale !== 'string' || !/^[a-z]{2}-[a-z]{2}$/i.test(request.locale)) return null;
  return { vin: request.vin.toUpperCase(), locale: request.locale.slice(0, 2).toLowerCase() + '-' + request.locale.slice(3).toUpperCase() };
}

/** Reuse FUCQ-19's durable classifier; no registry miss or browser-shaped context grants permission.
 * authorizeExternalLookup is trusted server composition, supplied by the owning identity/access adapter.
 * It must verify its own opaque context, exact VIN/locale, real identity, purpose and current permission.
 * DemoIdentity contexts describe fictional employees and cannot authorize real lookup merely by having a role.
 */
export function createBmwVinGuideIdentityGuard({ registry, authorizeExternalLookup } = {}) {
  return Object.freeze({ async check(request, context) {
    try {
      if (!canonicalBmwVinGuideRequest(request) || !object(context)
        || typeof registry?.classifyIdentity !== 'function' || typeof authorizeExternalLookup !== 'function') return false;
      const classification = await registry.classifyIdentity(request.vin);
      if (!object(classification) || classification.identityKind !== 'unknown' || classification.status !== 'not-found') return false;
      // Unknown to the synthetic inventory is only negative evidence. Independent trusted real authorization is required.
      const permission = await authorizeExternalLookup({ context, vin: request.vin, locale: request.locale });
      return permission?.status === 'ok' && permission.identityKind === 'real'
        && permission.lookupFlow === 'externally-authorised' && permission.authorized === true;
    } catch { return false; }
  } });
}

function envelope(status, provider, locale, attempts = []) {
  return { schemaVersion: SCHEMA_VERSION, status, locale,
    source: { provider: provider?.id || null, providerVersion: provider?.version || null,
      kind: provider?.sourceKind || null, observedDate: null },
    guide: { availability: 'unknown', title: null, derivative: null, brand: null, disclaimer: null, sections: [], links: [] },
    illustration: { status: 'unknown', role: 'vin-linked-illustration', fidelity: 'unverified', assetRef: null },
    completeness: { handbook: 'unknown', title: 'unknown', disclaimer: 'unknown', sections: 'unknown', links: 'unknown', illustration: 'unknown' },
    facts: Object.fromEntries(UNKNOWN_FACTS.map((name) => [name, { state: 'unknown', value: null }])), equipment: equipment(), attempts };
}

function normalise(data, provider, request, attempts) {
  const { locale, vin } = request;
  const anonymous = (value) => typeof value === 'string' && !value.toUpperCase().includes(vin.slice(-7));
  if (!object(data) || !STATES.has(data.status)) return envelope('source-unavailable', provider, locale, attempts);
  const result = envelope(data.status, provider, locale, attempts);
  if (date(data.observedDate)) result.source.observedDate = data.observedDate;
  if (data.status === 'no-guide') { result.guide.availability = 'not-available'; return result; }
  if (!['available', 'partial'].includes(data.status)) return result;
  if (!object(data.guide) || !date(data.observedDate)) return envelope('source-unavailable', provider, locale, attempts);
  const source = data.guide;
  // Only safe content/asset metadata belongs in this contract. A later delivery route owns actual private URLs.
  for (const name of ['title', 'derivative', 'brand', 'disclaimer']) if (label(source[name], name === 'disclaimer' ? 2048 : 256) && anonymous(source[name])) result.guide[name] = source[name].trim();
  result.guide.sections = Array.isArray(source.sections) ? source.sections.slice(0, 64)
    .filter((section) => id(section?.id) && anonymous(section.id) && label(section?.title, 256) && anonymous(section.title))
    .map(({ id: sectionId, title }) => ({ id: sectionId, title: title.trim() })) : [];
  result.guide.links = Array.isArray(source.links) ? source.links.slice(0, 16)
    .filter((link) => id(link?.assetRef) && anonymous(link.assetRef) && label(link?.label, 256) && anonymous(link.label) && ['pdf', 'html'].includes(link?.format)
      && ['available', 'unavailable'].includes(link?.availability))
    .map(({ assetRef, label: linkLabel, format, availability }) => ({ assetRef, label: linkLabel.trim(), format, availability, delivery: 'metadata-only', href: null })) : [];
  if (['available', 'unavailable'].includes(data.illustration?.status)) {
    result.illustration.status = data.illustration.status;
    if (data.illustration.status === 'available' && id(data.illustration.assetRef) && anonymous(data.illustration.assetRef)) result.illustration.assetRef = data.illustration.assetRef;
    else if (data.illustration.status === 'available') result.illustration.status = 'unknown';
  }
  result.guide.availability = 'available';
  for (const name of ['title', 'disclaimer']) result.completeness[name] = result.guide[name] ? 'complete' : 'unknown';
  for (const name of ['sections', 'links']) result.completeness[name] = result.guide[name].length ? 'partial' : 'unknown';
  result.completeness.illustration = result.illustration.status === 'unknown' ? 'unknown' : 'complete';
  for (const name of ['sections', 'links']) {
    if (data.completeness?.[name] === 'complete' && Array.isArray(source[name]) && result.guide[name].length === source[name].length) {
      result.completeness[name] = 'complete';
    }
  }
  const complete = data.status === 'available' && data.completeness?.handbook === 'complete'
    && result.completeness.sections === 'complete' && result.completeness.links === 'complete' && result.guide.title && result.guide.disclaimer
    && result.guide.links.some((link) => link.availability === 'available') && result.guide.sections.length > 0;
  result.status = complete ? 'available' : 'partial'; result.completeness.handbook = complete ? 'complete' : 'partial';
  return result;
}

function selected(provider) {
  if (!object(provider) || !id(provider.id) || typeof provider.version !== 'string' || (!id(provider.version) && !/^[0-9]{1,8}$/.test(provider.version))
    || !['synthetic', 'authorised-live'].includes(provider.sourceKind) || typeof provider.resolve !== 'function') return null;
  // Capture the mode and method together: mutation of the caller's object cannot change routing after selection.
  return Object.freeze({ id: provider.id, version: provider.version, sourceKind: provider.sourceKind, resolve: provider.resolve.bind(provider) });
}

/** No built-in transport, endpoint, credentials, cache or implicit provider/locale fallback. */
export function createBmwVinGuideAdapter({ provider, fallbackProvider, guard, timeoutMs = 1500 } = {}) {
  const primary = selected(provider); const fallback = selected(fallbackProvider);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new TypeError('Supply a bounded guide timeout.');
  return Object.freeze({ async resolve(input, context) {
    if (!provider) return envelope('disabled', null, null);
    const canonical = canonicalBmwVinGuideRequest(input);
    if (!canonical) return envelope('invalid-input', primary, null);
    const request = Object.freeze(canonical);
    if (!primary) return envelope('source-unavailable', null, request.locale);
    const attempts = [];
    for (const candidate of [primary, ...(fallback ? [fallback] : [])]) {
      // The guard runs before entering any real provider, including key fetch and every fallback/switch.
      const controller = new AbortController(); let timer;
      try {
        const result = await Promise.race([
          (async () => {
            if (candidate.sourceKind === 'authorised-live' && (primary.sourceKind === 'synthetic'
              || typeof guard?.check !== 'function' || await guard.check(request, context) !== true)) {
              return { denied: true };
            }
            if (controller.signal.aborted) return { status: 'source-unavailable' };
            return candidate.resolve(request, { signal: controller.signal });
          })(),
          new Promise((done) => { timer = setTimeout(() => { controller.abort(); done({ status: 'source-unavailable' }); }, timeoutMs); }),
        ]);
        attempts.push({ provider: candidate.id, sourceKind: candidate.sourceKind, status: result?.denied ? 'identity-denied' : STATES.has(result?.status) ? result.status : 'source-unavailable' });
        if (result?.denied) return envelope('source-unavailable', candidate, request.locale, attempts);
        const normalised = normalise(result, candidate, request, attempts);
        if (normalised.status !== 'source-unavailable' || candidate === fallback || !fallback) return normalised;
      } catch {
        attempts.push({ provider: candidate.id, sourceKind: candidate.sourceKind, status: 'source-unavailable' });
        if (candidate === fallback || !fallback) return envelope('source-unavailable', candidate, request.locale, attempts);
      } finally { clearTimeout(timer); controller.abort(); }
    }
    return envelope('source-unavailable', primary, request.locale, attempts);
  } });
}

/** Add a separate content section. Never overwrite independently known car facts with guide failures or guesses. */
export function presentBmwVinGuide(result, existingFacts = {}) {
  const safe = result && Object.hasOwn(MESSAGES, result.status) ? result : envelope('source-unavailable', null, null);
  return { status: safe.status, message: MESSAGES[safe.status], source: structuredClone(safe.source),
    guide: structuredClone(safe.guide), illustration: structuredClone(safe.illustration), completeness: structuredClone(safe.completeness),
    equipment: equipment(), currentCarFacts: object(existingFacts) ? structuredClone(existingFacts) : {} };
}
