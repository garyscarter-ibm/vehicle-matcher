/**
 * Rolls-Royce MTK Connect feed adapter.
 *
 * Projects one entry from the /public/v1/vehicles/rolls-royce/global
 * `contents[]` array into the flat shape mapRRMCRaw consumes.
 */

export const RRMC_FEED_URL = 'https://api.mtkconnect.io/public/v1/vehicles/rolls-royce/global';
export const RRMC_FEED_ORIGIN = 'https://pre-owned.rolls-roycemotorcars.com';
const RRMC_LISTING_BASE = `${RRMC_FEED_ORIGIN}/en_gb/vdp`;

/** The car's page: vdp/<id>-<model year>-<model>-<interior>-<exterior>, as the site's own sitemap writes it. */
export function rrmcListingUrl(v) {
  if (!v?.id) return RRMC_FEED_ORIGIN;
  const veh = v.vehicle || {};
  const look = veh.appearanceOptions || {};
  const slug = [v.id, veh.modelYear || veh.registrationYear, veh.model?.name || veh.model?.groupName,
    look.interiorColour, look.exteriorColour]
    .filter(Boolean).join(' ').trim().replace(/\s+/g, '-');
  return `${RRMC_LISTING_BASE}/${encodeURI(slug)}`;
}

export const RRMC_PAGE_SIZE = 50;

/** Build the POST body for one page of the global feed. */
export function rrmcFeedBody(page) {
  return {
    languageCode: 'en_gb',
    limit: RRMC_PAGE_SIZE,
    page,
    sortDirection: 'asc',
    sortBy: 'price',
    listingTypes: ['Used', 'Certified', 'Demo'],
    resultsFilters: { modelYear: {}, price: {}, odometer: {}, registrationYear: {} },
  };
}

/** Extract total item count and listings from a parsed response object. */
export function parseRRMCPage(body) {
  let data;
  try { data = JSON.parse(body); } catch { return { total: 0, contents: [] }; }
  return {
    total: data?.total ?? 0,
    contents: Array.isArray(data?.contents) ? data.contents : [],
  };
}

/* Retailer country (ISO 3166 alpha-2) → the regions question's values. A country
   not listed has no region, so the regions filter never drops its cars. */
const REGION_CODES = {
  europe: 'GB IE FR DE IT ES PT NL BE LU CH AT MC LI AD SM VA MT DK NO SE FI IS PL CZ SK HU '
    + 'SI HR RS BA ME MK AL GR CY BG RO MD UA BY LT LV EE RU TR GI JE GG IM',
  mea: 'AE SA QA KW BH OM JO LB IL EG MA DZ TN LY IQ YE ZA NG KE GH ET TZ UG RW SN CI CM '
    + 'AO MZ ZM ZW BW NA MU SC MG',
  apac: 'CN HK MO TW JP KR SG MY TH ID PH VN KH IN PK BD LK NP MV AU NZ FJ PG BN MN KZ UZ',
  americas: 'US CA MX BR AR CL CO PE UY PY BO EC VE PA CR GT HN SV NI DO PR JM BS BB TT KY '
    + 'BM AW CW',
};
const CODE_REGION = Object.fromEntries(Object.entries(REGION_CODES)
  .flatMap(([region, codes]) => codes.split(' ').map((c) => [c, region])));
const COUNTRY_ALIASES = {
  uk: 'GB', 'great britain': 'GB', england: 'GB', scotland: 'GB', wales: 'GB', 'northern ireland': 'GB',
  usa: 'US', 'united states of america': 'US', uae: 'AE', 'hong kong': 'HK', macau: 'MO', macao: 'MO',
  korea: 'KR', 'republic of korea': 'KR', 'czech republic': 'CZ', turkey: 'TR', 'russian federation': 'RU',
};
// Full English names ("United Kingdom", "Czechia") resolve through ICU's own table.
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const NAME_CODE = Object.fromEntries(Object.keys(CODE_REGION)
  .map((c) => [regionNames.of(c).toLowerCase(), c]));

/** The retailer's country as ISO alpha-2 (upper case), or '' when the feed names none. */
export function rrmcCountry(v) {
  const d = v?.dealer || {};
  let raw = d.structuredAddress?.countryCode || d.address?.countryCode || d.countryCode
    || d.structuredAddress?.countryName || d.address?.country || d.country
    || v?.location?.countryCode || v?.location?.country || '';
  if (raw && typeof raw === 'object') raw = raw.code || raw.isoCode || raw.name || '';
  const s = String(raw).trim();
  const key = s.toLowerCase();
  return COUNTRY_ALIASES[key] || NAME_CODE[key] || s.toUpperCase();
}

/** The listing's retailer region, or undefined when the feed names no known country. */
export function rrmcRegion(v) {
  return CODE_REGION[rrmcCountry(v)];
}

/* Countries that drive on the left, so sell right-hand-drive cars; every other is LHD. */
const RHD_COUNTRIES = new Set(('GB IE MT CY JE GG IM ZA KE TZ UG ZM ZW BW NA MZ MW LS SZ MU SC '
  + 'IN PK BD LK NP BT MV JP HK MO SG MY TH ID BN TL AU NZ FJ PG '
  + 'JM BS BB TT KY BM AG VG GY SR').split(' '));

/** 'lhd'/'rhd' from the listing's own vehicle.handDrive ('L'/'R'), else the retailer country's side. */
export function rrmcHandDrive(v) {
  const veh = v?.vehicle || {};
  const own = String(veh.steeringPosition || veh.steering_position || veh.handDrive || veh.hand_drive
    || veh.drivingSide || veh.driving_side || '').trim().toLowerCase();
  if (own.includes('left') || own === 'lhd' || own === 'l') return 'lhd';
  if (own.includes('right') || own === 'rhd' || own === 'r') return 'rhd';
  const country = rrmcCountry(v);
  if (country) return RHD_COUNTRIES.has(country) ? 'rhd' : 'lhd';
  return undefined;
}

/** The price in whole pounds: the listing's local price at `rates` (units per £1, today's), else
 *  the feed's own GBP conversion; 0 (shown as POA) when neither is known, never a wrong figure. */
export function rrmcPriceGBP(v, rates) {
  const retail = v?.price?.retail;
  if (!retail) return 0;
  const code = String(v?.currency?.code || v?.currency || 'GBP').toUpperCase();
  if (code === 'GBP') return Math.round(retail);
  const rate = rates?.[code];
  if (rate > 0) return Math.round(retail / rate);
  return Math.round(v?.normalisedPrice?.GBP?.retail || 0);
}

const MILES_PER_KM = 0.621371;

/** The odometer in whole miles: the reading's own `units`, else the dealer's, with km converted. */
export function rrmcMiles(v) {
  const value = Number(v?.odometer?.value) || 0;
  const units = String(v?.odometer?.units || v?.dealer?.odometerUnit || 'mi').toLowerCase();
  return units.startsWith('k') ? Math.round(value * MILES_PER_KM) : Math.round(value);
}

/** The retailer's own homepage, or undefined. The feed sends `dealer.website`; the rest are fallbacks. */
export function rrmcDealerUrl(v) {
  const d = v?.dealer || {};
  const raw = d.website || d.websiteUrl || d.websiteURL || d.webSite || d.url || d.homepage
    || d.homepageUrl || d.webUrl || d.links?.website || d.contact?.website || d.contactDetails?.website || '';
  const s = String(typeof raw === 'object' ? raw.url || raw.href || '' : raw).trim();
  if (!s) return undefined;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return /^https?:$/.test(u.protocol) ? u.href : undefined;
  } catch { return undefined; }
}

/**
 * Project one MTK Connect listing into the flat shape mapRRMCRaw consumes.
 * Colour is already available in appearanceOptions, so no separate PDP needed.
 * `rates` (units per £1) converts the dealer's local price; see rrmcPriceGBP.
 */
export function projectRRMCListing(v, rates = null) {
  const model = v?.vehicle?.model;
  const price = rrmcPriceGBP(v, rates);
  const name = model?.name || model?.groupName || '';
  const fuelType = (v?.vehicle?.engine?.fuelType || '').toLowerCase();
  const fuel = (fuelType === 'electric' || fuelType === 'ev') ? 'ev' : undefined;
  const cover = (v?.vehicleMedia || [])
    .filter((m) => m.scope === 'vehicle-listing' && m.mediaType === 'IMAGE')
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))[0];

  return {
    id: String(v.id || ''),
    name,
    price,
    poa: !price,
    mileage: rrmcMiles(v),
    // The dealer hasn't published a reading: shown as "MOA", like POA for price.
    moa: Boolean(v?.odometer?.odometerOnApplication),
    year: v?.vehicle?.registrationYear || v?.vehicle?.modelYear || 0,
    photo: cover?.url || undefined,
    cc: v?.vehicle?.engine?.capacity || 0,
    fuel,
    colour: v?.vehicle?.appearanceOptions?.exteriorColour || '',
    dealerName: v?.dealer?.name || 'Rolls-Royce Approved',
    dealerUrl: rrmcDealerUrl(v),
    link: rrmcListingUrl(v),
    handDrive: rrmcHandDrive(v),
    region: rrmcRegion(v),
  };
}
