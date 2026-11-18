import { FEATURE_CONCEPTS } from './mapping.js';

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const number = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const positive = (value) => {
  const n = number(value);
  return n > 0 ? n : null;
};
const imageUrl = (value) => {
  try {
    const url = new URL(text(value));
    return url.protocol === 'https:' ? url.href : undefined;
  } catch { return undefined; }
};

function colourFor(manufacturerColour) {
  if (!manufacturerColour) return undefined;
  const shades = [
    ['White', /\bwhite\b/i], ['Black', /\bblack\b/i], ['Silver', /\bsilver\b/i],
    ['Grey', /\bgrey\b|\bgray\b|\bgranite\b|\bbillet\b/i], ['Blue', /\bblue\b/i],
    ['Red', /\bred\b/i], ['Green', /\bgreen\b/i], ['Brown', /\bbrown\b/i],
    ['Beige', /\bbeige\b|\btan\b/i], ['Yellow', /\byellow\b/i],
    ['Orange', /\borange\b/i], ['Gold', /\bgold\b/i], ['Purple', /\bpurple\b/i],
  ];
  const colour = shades.find(([, match]) => match.test(manufacturerColour))?.[0];
  return { ...(colour ? { colour } : {}), manufacturerColour };
}

// Spoticar's cpo-go and cpo-gold records are separate certification programmes.
export function mapRamRaw(row) {
  if (!row || text(row.make).toUpperCase() !== 'RAM' || row.vehicle_type_flag !== 'cpo') return null;
  const model = text(row.model).replace(/^RAM\s+/i, '');
  if (!/^(?:1500(?:\s+Classic)?|2500|3500)$/i.test(model)) return null;
  const body = text(row.body_style);
  if (/van|chassis|cab\s*&\s*chassis/i.test(body)) return null;
  const price = positive(row.internetprice);
  const vin = text(row.vin);
  const dealerCode = text(row.dealer_code);
  if (!price || !vin || !dealerCode) return null;

  const line = /classic/i.test(model) ? '1500 Classic' : model;
  const truckClass = line.slice(0, 4);
  const trim = text(row.trim_desc) || text(row.display_trim_desc);
  const displayTrim = trim.replace(/\bLaie\b/gi, 'Laramie');
  const equipment = text(row.option_desc).split('|').map((s) => s.trim().toLowerCase())
    .filter((s) => s && !/\b(?:delete|without|not equipped|not included)\b/.test(s));
  const features = FEATURE_CONCEPTS
    .filter(([, match, exclude]) => equipment.some((s) => match.test(s) && !exclude?.test(s)))
    .map(([key]) => key).sort();
  const fuelText = text(row.fueltype).toLowerCase();
  const fuel = /diesel/.test(fuelText) ? 'diesel'
    : /gas|petrol|flex/.test(fuelText) ? 'petrol'
      : /electric/.test(fuelText) && !/hybrid/.test(fuelText) ? 'ev' : null;
  const transmissionText = `${text(row.transmission_type)} ${text(row.transmission_desc)}`;
  const transmission = /manual/i.test(transmissionText) ? 'manual'
    : /auto/i.test(transmissionText) ? 'auto' : undefined;
  const tags = [];
  if (/\b(?:4x4|4wd|awd)\b/i.test(text(row.drive_type))) tags.push('practical');
  if (features.some((feature) => ['navigation', 'smartphoneIntegration', 'headUpDisplay'].includes(feature))) tags.push('tech');
  if (features.includes('heatedSeats') || equipment.some((option) => /ventilated.*seat/.test(option))) tags.push('cruiser');
  const cab = text(row.cab) || (/cab/i.test(body) ? body : undefined);
  const retailerName = text(row.dealerDetails?.dlr_dba_name) || undefined;
  const photo = text(row.photo_url).split('|').map(imageUrl).find(Boolean)
    || imageUrl(row.thumbnail);

  return {
    id: `${vin}_${dealerCode}`,
    groupKey: `${vin}_${dealerCode}`,
    name: `RAM ${line}${displayTrim ? ` ${displayTrim}` : ''}`,
    line,
    body: 'pickup',
    fuel,
    priceMin: price,
    priceMax: price,
    currency: 'USD',
    sizeClass: null,
    seats: positive(row.seating_capacity),
    boot: null,
    zeroTo62: null,
    mpg: null,
    styleLine: truckClass,
    doors: positive(row.doors),
    features,
    transmission,
    tags,
    blurb: `Certified pre-owned RAM ${line}${retailerName ? ` from ${retailerName}` : ''}.`,
    mileage: number(row.miles),
    year: positive(row.year),
    photo,
    retailerName,
    retailerId: dealerCode,
    dealerNumber: dealerCode,
    link: `https://www.spoticar.com/t1/vehicle-details?vin=${encodeURIComponent(vin)}&dealercode=${encodeURIComponent(dealerCode)}&vehicle_type=cpo`,
    vin,
    trim: trim || undefined,
    cab,
    bed: text(row.box) || undefined,
    engineDescription: text(row.eng_desc) || undefined,
    driveType: text(row.drive_type) || undefined,
    colour: colourFor(text(row.exterior_color_desc)),
    power: positive(row.engine_horse_power),
    powerUnit: 'hp',
    certification: 'cpo',
  };
}
