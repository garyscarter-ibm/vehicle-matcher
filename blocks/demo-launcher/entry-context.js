import { retailContextUrl } from '../vehicle-matcher/share-context.js';

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

/** Same-entry navigation, retaining retail context except across the employee
 * boundary. Retail answer/share serialization belongs to retailContextUrl. */
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

export const RETAIL_RETURN_STORAGE = 'vm-retail-return';
const supportedBrand = (value) => ENTRY_REGISTRY.retailBrands.includes(value);
const publicHash = (hash) => /^#(?:m|mingle|knockout)=[^&]*$/.test(hash) ? hash : '';

function publicRetailUrl(input, brand, { fresh = false } = {}) {
  const source = readUrl(input);
  const params = source.searchParams;
  const employee = params.get('experience') === 'employee-cars';
  const mode = !employee && params.get('mode')?.toLowerCase();
  const url = new URL(retailContextUrl(source, {
    brand,
    mode,
    scope: !employee && params.get('scope')?.trim().toLowerCase(),
    retailer: !employee && !fresh ? params.get('retailer') : null,
    retailerLabel: !employee && !fresh ? params.get('retailerName') : null,
    api: params.get('api'),
  }, !employee && !fresh ? publicHash(source.hash) : ''));
  // The share contract writes an effective mode; navigation preserves its lock.
  if (!ENTRY_REGISTRY.retailModes.includes(mode)) url.searchParams.delete('mode');
  if (brand === null) url.searchParams.delete('brand');
  return url;
}

/** A deliberate new brand starts fresh answers/dealer identity, retaining valid
 * mode/scope/API. Selecting the existing supported brand preserves its journey. */
export function brandChangeUrl(input, brand) {
  if (brand !== null && !supportedBrand(brand)) throw new TypeError('Unsupported retail brand');
  const source = readUrl(input);
  const previous = source.searchParams.get('brand')?.toLowerCase();
  const url = publicRetailUrl(source, brand, { fresh: !supportedBrand(previous) || previous !== brand });
  const experience = source.searchParams.get('experience');
  return buildEntryUrl(url, ENTRY_REGISTRY.experiences.includes(experience) ? { experience } : {});
}

function sessionStore(storage) {
  return storage === undefined ? globalThis.sessionStorage : storage;
}

function retailPage(url, base) {
  const directory = new URL('.', base).pathname;
  return url.origin === base.origin && !url.username && !url.password
    && ['', 'index.html', 'block.html'].some((page) => url.pathname === `${directory}${page}`);
}

/** Remember only a mounted retail page's public location in this browser session.
 * Blocked storage is optional; employee and unsupported locations never overwrite it. */
export function rememberRetailLocation(input, { storage } = {}) {
  try {
    const url = readUrl(input);
    const context = resolveEntryContext(url);
    if (!retailPage(url, url) || context.state !== 'retail'
      || url.searchParams.get('experience') === 'employee-cars') return null;
    const location = relativeUrl(publicRetailUrl(url, context.brand));
    sessionStore(storage)?.setItem(RETAIL_RETURN_STORAGE, location);
    return location;
  } catch {
    return null;
  }
}

/** Resume only the selected brand's validated retail location. Current retail
 * navigation wins over stale storage; employee input contributes only brand/API. */
export function retailReturnUrl(input, { brand = resolveEntryContext(input).brand, storage } = {}) {
  brand = supportedBrand(brand) ? brand : null;
  const source = readUrl(input);
  const fresh = () => buildEntryUrl(new URL(brandChangeUrl(source, brand), source), { experience: 'used-cars' });
  const employee = source.searchParams.get('experience') === 'employee-cars';
  const currentBrand = source.searchParams.get('brand')?.toLowerCase();
  const hasContext = RETAIL_PARAMS.slice(1).some((key) => source.searchParams.has(key)) || publicHash(source.hash);
  if (!employee && currentBrand === brand
    && (resolveEntryContext(source).state === 'retail' || hasContext)) return fresh();
  try {
    const saved = sessionStore(storage)?.getItem(RETAIL_RETURN_STORAGE);
    if (!saved || !supportedBrand(brand)) return fresh();
    const url = new URL(saved, source);
    if (!retailPage(url, source) || resolveEntryContext(url).state !== 'retail'
      || url.searchParams.get('experience') === 'employee-cars'
      || url.searchParams.get('brand') !== brand) return fresh();
    if (source.searchParams.has('api')) url.searchParams.set('api', source.searchParams.get('api'));
    return relativeUrl(publicRetailUrl(url, brand));
  } catch {
    return fresh();
  }
}

/** Resolve presentation without modifying the input. Unsupported employee brands
 * stay explicit; raw URLs and consumed keys are absent from diagnostics. */
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
