/* Static entry navigation only. These values confer no identity, entitlement
 * or recommendation-policy authority. Employee mounting belongs to FUCQ-35. */
export const ENTRY_REGISTRY = Object.freeze({
  experiences: Object.freeze(['launcher', 'used-cars', 'employee-cars']),
  retailBrands: Object.freeze(['bmw', 'mini', 'ford', 'honda', 'motorrad', 'ferrari']),
  // Public mode keys, rather than the mingle/knockout implementation filenames.
  retailModes: Object.freeze(['questionnaire', 'swipe', 'head-to-head', 'podium', 'guess-who']),
  employeeBrands: Object.freeze(['bmw']),
  // Enable only when the real employee entry is registered by its consumer.
  employeeAvailable: false,
});

const RETAIL_PARAMS = ['brand', 'mode', 'scope', 'retailer', 'retailerName'];
const RETAIL_HASH = /(?:^#|[&])(?:m|mingle|knockout)=/;
const readUrl = (input) => new URL(String(input));
const relativeUrl = (url) => `${url.pathname}${url.search}${url.hash}`;

/** Build a same-entry link, retaining a repository prefix and never a legacy
 * access key. Launcher hops retain retail return context; employee hops use an
 * allowlist so buyer answers/retailer overrides cannot become employee input.
 * This is navigation, not the retail answer/share serializer. */
export function buildEntryUrl(input, { experience, brand } = {}) {
  const url = readUrl(input);
  url.searchParams.delete('key');
  if (experience !== undefined) url.searchParams.set('experience', experience);
  if (brand === null) url.searchParams.delete('brand');
  else if (brand !== undefined) url.searchParams.set('brand', brand);

  if (url.searchParams.get('experience') === 'employee-cars') {
    const query = new URLSearchParams();
    for (const key of ['experience', 'brand', 'api']) {
      if (url.searchParams.has(key)) query.set(key, url.searchParams.get(key));
    }
    url.search = query.toString();
    url.hash = '';
  }
  return relativeUrl(url);
}

/** Resolve presentation state without modifying the caller's URL. Unknown
 * employee brands remain explicit; only retail preserves its BMW fallback.
 * Raw input URLs and consumed keys are deliberately absent from diagnostics. */
export function resolveEntryContext(input, {
  employeeAvailable = ENTRY_REGISTRY.employeeAvailable,
} = {}) {
  const url = readUrl(input);
  url.searchParams.delete('key');
  const params = url.searchParams;
  const standalone = url.pathname.endsWith('/block.html');
  const legacyRetail = RETAIL_PARAMS.some((key) => params.has(key)) || RETAIL_HASH.test(url.hash);
  const experience = standalone ? 'used-cars' : params.has('experience')
    ? params.get('experience') : legacyRetail ? 'used-cars' : 'launcher';
  let brand = (params.get('brand') || '').toLowerCase() || null;
  let state;

  if (!ENTRY_REGISTRY.experiences.includes(experience)) state = 'unknown-experience';
  else if (experience === 'launcher') state = 'launcher';
  else if (experience === 'used-cars') {
    if (standalone && !brand) brand = 'bmw';
    if (brand && !ENTRY_REGISTRY.retailBrands.includes(brand)) brand = 'bmw';
    state = brand ? 'retail' : 'retail-picker';
  } else if (!brand) state = 'employee-brand-required';
  else if (!ENTRY_REGISTRY.employeeBrands.includes(brand)) state = 'unsupported-employee-brand';
  else state = employeeAvailable === true ? 'employee' : 'employee-unavailable';

  // Sanitise even directly supplied employee URLs before exposing a return
  // location or recovery actions. Never copy their retail query/hash onward.
  const location = buildEntryUrl(url, { experience, brand });
  const safeBase = new URL(location, url);
  return Object.freeze({
    experience, brand, state, location,
    employeeAvailable: employeeAvailable === true,
    links: Object.freeze({
      launcher: buildEntryUrl(safeBase, { experience: 'launcher' }),
      usedCars: buildEntryUrl(safeBase, { experience: 'used-cars' }),
      employeeCars: buildEntryUrl(safeBase, { experience: 'employee-cars' }),
      employeeBmw: buildEntryUrl(safeBase, { experience: 'employee-cars', brand: 'bmw' }),
    }),
  });
}
