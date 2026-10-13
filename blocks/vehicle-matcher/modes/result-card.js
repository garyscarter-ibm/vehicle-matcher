/*
 * The car card, shared by every mode that shows a result.
 *
 * Lifted out of modes/questionnaire.js when a second mode (podium) needed to
 * render the same cards. One builder, three densities: `big` adds the engine's
 * "why it suits you" reasons, `compact` is the carousel tile, and previewTile is
 * the lighter strip tile. Everything a card is allowed to claim about a car is
 * decided here, so two modes cannot describe the same car two different ways.
 *
 * The display tables at the top are the client half of the wire format: the
 * server sends closed-set keys (`suv`, `phev`, `auto`, a normalised colour name,
 * an equipment concept id) and these turn them into words. An unknown key
 * renders nothing rather than a guess.
 *
 * Brand voice comes from ./brand-copy.js; the card holds no copy of its own.
 */

import { el, gbp, cardinal } from '../ui.js';
import { BRAND_COPY, TRADE_COPY, tradeLines, orList } from './brand-copy.js';
import { PILL_LABEL, BUDGET_BANDS } from '../quiz-meta.js';

export const SPEC_LABELS = {
  hatchback: 'Hatchback', saloon: 'Saloon', estate: 'Estate', suv: 'SUV',
  coupe: 'Coupé', convertible: 'Convertible', mpv: 'Family carrier',
};
export const FUEL_SPEC = { petrol: 'Petrol', diesel: 'Diesel', phev: 'Plug-in hybrid', ev: 'Electric' };
/*
 * Gearbox, stated rather than implied. It was already on the wire and already
 * a reject reason and a refine chip, and it was never printed anywhere — so a
 * buyer whose dealbreaker it is (Meg's clause is explicit that implied is not
 * good enough) had to infer it from a control that only appears when the stock
 * happens to be mixed. Same closed set as transmissionFor in server/mapping.js;
 * a car the feed gave no gearbox for simply says nothing.
 */
export const GEARBOX_SPEC = { auto: 'Automatic', manual: 'Manual' };

/*
 * Representative hex per basic colour, for the little swatch beside the paint
 * name. Keyed by the feed's normalised `colour.colour` — a closed set of basic
 * names, which is what makes a hand-authored table viable. Deliberately NOT
 * the actual paint (the feed gives "Ocean Wave Green", not a hex): the swatch
 * says "this one's the green one" at a glance, the name and photo carry the
 * truth. An unknown name renders no swatch rather than a wrong one.
 */
export const SWATCH_HEX = {
  black: '#1d1d1f',
  grey: '#8e9094',
  silver: '#c8cacc',
  white: '#f4f4f2',
  blue: '#33567d',
  red: '#a03236',
  green: '#4a6b58',
  orange: '#c47a3a',
  yellow: '#d9b13b',
  brown: '#6b543f',
  beige: '#cfc3a8',
  bronze: '#9c7a5b',
  gold: '#b3945c',
  purple: '#5d4a72',
};

/*
 * Human names for the equipment concepts the server parses out of the feed's
 * factory options list (mapping.js FEATURE_CONCEPTS). Display-only, so they
 * live here rather than on the wire — and only concepts a buyer would
 * recognise by name are listed: an unlabelled key is silently skipped, which
 * is how a concept can be parsed and measured long before it's offered as a
 * refinement.
 */
export const CONCEPT_LABELS = {
  panoRoof: 'Panoramic roof',
  contrastRoof: 'Contrast roof',
  sunroof: 'Sunroof',
  heatedSeats: 'Heated seats',
  heatedWheel: 'Heated steering wheel',
  // "Points", not "rear ISOFIX": the concept folds BMW's rear ISOFIX system
  // and both brands' front i-Size attachment, which are different fitments
  // (see FEATURE_CONCEPTS in server/mapping.js). Claiming the rear one would
  // be claiming more than the feed says.
  isofix: 'ISOFIX child seat points',
  sportsSeats: 'Sports seats',
  electricSeats: 'Electric seats',
  leatherWheel: 'Leather steering wheel',
  parkingCamera: 'Parking camera',
  parkingSensors: 'Parking sensors',
  navigation: 'Navigation',
  smartphoneIntegration: 'Apple CarPlay',
  premiumAudio: 'Premium audio',
  headUpDisplay: 'Head-up display',
  cruiseControl: 'Cruise control',
  adaptiveLights: 'Adaptive LED lights',
  keylessEntry: 'Keyless entry',
  climateControl: 'Climate control',
  ambientLighting: 'Ambient lighting',
  tintedGlass: 'Privacy glass',
  towbar: 'Tow bar',
};

/*
 * How many of those a card names before it starts counting. The order above is
 * the order they print in, which puts the distinctive kit (roof, seats, child
 * seats) ahead of the near-ubiquitous (cruise control, climate), so the six
 * that show are the six worth reading. The remainder is counted rather than
 * dropped, because a card that quietly truncates is a card making a claim
 * about what a car does not have.
 */
export const KIT_SHOWN = 6;

/**
 * The individual cars behind a card. The API sends this for every match, one
 * entry for an ungrouped car and N for a grouped one, so nothing downstream
 * has to care which it is holding.
 */
export const listingsOf = (m) => m.listings || [];


/** Miles from the configured retailer, e.g. "18.1 miles away". */
export function distanceLabel(distance) {
  const miles = Math.round(distance * 10) / 10;
  return `${miles} ${miles === 1 ? 'mile' : 'miles'} away`;
}

/**
 * The photo band every card surface shares: the retailer's picture when the
 * feed supplied one, the "Images coming soon" placeholder when it didn't, and
 * the line label pinned in the corner. Mirrors usedcars.bmw.co.uk's own PDP
 * for a photo-less listing — a white bold caption centred on the dark field.
 *
 * Returns the element and a `showPhoto` to change it later. The swap exists
 * because a hero card's listing picker can change which car the card is
 * describing, and colour is usually the entire reason that choice exists: a
 * card that renames the paint over a picture of the old one has argued against
 * itself. Tiles never call it a second time, but they get it from here anyway
 * — this was two near-identical copies, and the copy the picker didn't use was
 * the copy that quietly stopped matching.
 */
export function mediaWell(car, extraClass = '') {
  const media = el('div', `vm-card-media${extraClass ? ` ${extraClass}` : ''}`);
  media.append(
    el('span', 'vm-card-soon', 'Images coming soon'),
    el('span', 'vm-card-line', car.line),
  );

  function showPhoto(src) {
    media.querySelector('.vm-card-photo')?.remove();
    media.classList.toggle('has-photo', Boolean(src));
    if (!src) return;
    const img = el('img', 'vm-card-photo');
    img.src = src;
    img.alt = car.name;
    img.loading = 'lazy';
    // A broken image URL shouldn't leave a half-rendered card — drop back to
    // the placeholder, exactly as a photo-less car shows.
    img.addEventListener('error', () => {
      media.classList.remove('has-photo');
      img.remove();
    });
    // Ahead of the caption and the line label, both of which sit over it.
    media.prepend(img);
  }
  showPhoto(car.photo);

  return { media, showPhoto };
}

/** RRMC's tagline and its two-part sub line, shown above the top tiles in podium and questionnaire. */
export function rrmcTaglines() {
  const tagline = el('p', 'vm-rrmc-tagline', "It doesn't have to take forever...");
  const sub = el('p', 'vm-rrmc-tagline-sub');
  sub.append(
    el('span', 'vm-rrmc-sub-a', "Answer these simple questions to the best of your ability.  We'll shortlist options from"),
    document.createTextNode(' '),
    el('span', 'vm-rrmc-sub-b', 'our Provenance collection, and match you to the one that is best suited to you.'),
  );
  return [tagline, sub];
}

const DRIVE_PROSE = { lhd: 'Left-Hand-Drive', rhd: 'Right-Hand-Drive' };

/** Tells the host page the panel is rolling on or off, so its chrome can move in step (index.html). */
function announceWhyPanel(open) {
  window.dispatchEvent(new CustomEvent('vm-why-panel', { detail: { open } }));
}

/** The open RRMC panel's teardown, so opening another swaps the content in place. */
let closeRrmcPanel = null;

/** "Rolls-Royce Motor Cars London" as RRMC's tiles print it: "RRMC London". */
const rrmcLocation = (name) => (name || 'RRMC').replace(/Rolls-Royce Motor Cars\s*/i, 'RRMC ').trim();

/** RRMC's purple side panel ("Why this one?", "View Options"): rolls in from the right and settles
 *  pinned to the screen's right edge. One per block, one size; `wide` marks the tiles panel. */
function openRrmcPanel(trigger, { heading, content, wide = false }) {
  // On the block root, not inside a results area: those are CSS containers, which would trap position: fixed.
  const host = trigger.closest('.vm') || document.body;
  let panel = host.querySelector(':scope > .vm-rrmc-why-panel');
  if (!panel) {
    panel = el('aside', 'vm-rrmc-why-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'vm-rrmc-why-title');
    panel.tabIndex = -1;
    host.append(panel);
  }
  closeRrmcPanel?.({ restoreFocus: false, keepOpen: true });
  panel.classList.toggle('is-wide', wide);

  const close = el('button', 'vm-rrmc-why-close', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  const title = el('h3', 'vm-rrmc-why-title', heading);
  title.id = 'vm-rrmc-why-title';
  panel.replaceChildren(close, title, ...content);
  panel.scrollTop = 0;

  const onKey = (e) => { if (e.key === 'Escape') shut(); };
  function shut({ restoreFocus = true, keepOpen = false } = {}) {
    document.removeEventListener('keydown', onKey);
    closeRrmcPanel = null;
    trigger.setAttribute('aria-expanded', 'false');
    if (!keepOpen) {
      panel.classList.remove('is-open');
      announceWhyPanel(false);
    }
    if (restoreFocus && trigger.isConnected) trigger.focus();
  }
  close.addEventListener('click', () => shut());
  document.addEventListener('keydown', onKey);
  closeRrmcPanel = shut;
  trigger.setAttribute('aria-expanded', 'true');
  // A frame's pause so a first open starts off-screen right and rolls in to the right edge.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    panel.classList.add('is-open');
    announceWhyPanel(true);
    // The tiles panel doesn't scroll itself: focus its scroller so arrows and Space still scroll.
    (panel.querySelector('.vm-rrmc-alt-scroll') || panel).focus({ preventScroll: true });
  }));
}

/** The answers the shown tiles were matched against; each mode sets them before it paints. */
let rrmcAnswers = {};
export function setRrmcAnswers(answers) { rrmcAnswers = answers || {}; }

const RRMC_BODY = { saloon: 'Saloon', suv: 'SUV', coupe: 'Coupé', convertible: 'Drophead' };
const RRMC_FUEL = { ev: 'fully electric', petrol: 'petrol-powered' };
const RRMC_REGION = {
  europe: 'the UK & Europe', mea: 'Africa & the Middle East', apac: 'Asia & the Pacific', americas: 'the Americas',
};
const asList = (v) => (Array.isArray(v) ? v : (v != null ? [v] : []));
const withArticle = (word) => `${/^(SUV|[AEIOU])/i.test(word) ? 'an' : 'a'} ${word}`;
const asSentence = (s) => {
  const t = String(s).trim();
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? '' : '.'}`;
};

/** The budget answer as [min, max] GBP, or null when none was set (or "No parameters"). */
function budgetBand(answers) {
  if (answers.budgetGate === 'no') return null;
  const b = answers.budget;
  if (Array.isArray(b)) return b;
  if (typeof b === 'number') return [0, b];
  return BUDGET_BANDS[b] || null;
}

/** "Why this one?" in prose: what it matches, what it is, and its drawbacks against the answers. */
function whyProse(car, answers, reasons, tradeOffs) {
  const asked = [];
  // Body style is said once, in the facts sentence below, as the format has it.
  const body = RRMC_BODY[car.body];
  if (RRMC_FUEL[car.fuel] && asList(answers.fuel).includes(car.fuel)) {
    asked.push(`It's ${RRMC_FUEL[car.fuel]} like you asked for.`);
  }
  const regions = asList(answers.regions);
  if (car.region && regions.includes(car.region) && regions.length < 4) {
    asked.push(`It's held in ${RRMC_REGION[car.region]}, one of the regions you chose.`);
  }
  if (answers.handDrive && car.handDrive === answers.handDrive) {
    asked.push(`It's configured in ${DRIVE_PROSE[car.handDrive]} like you asked for.`);
  }
  if (answers.people === 'crew' && car.seats >= 5) {
    asked.push(`It seats ${cardinal(car.seats)}, room for everyone you mentioned.`);
  }
  // Nothing asked for to point at (no answers yet): the engine's own reasons stand in.
  if (!asked.length) reasons.slice(0, 2).forEach((r) => asked.push(asSentence(r)));

  const miles = car.mileage || 0;
  let wear = `${miles.toLocaleString('en-GB')} miles`;
  if (miles < 10000) wear = 'low mileage';
  else if (miles < 30000) wear = 'moderate mileage';
  const seats = car.seats ? ` and ${cardinal(car.seats)} seats` : '';
  const facts = [body ? `It's ${withArticle(body)} with ${wear}${seats}.` : `It has ${wear}${seats}.`];
  // The drive side is said once: a match above, a drawback below, or (unasked) a plain fact here.
  if (DRIVE_PROSE[car.handDrive] && !answers.handDrive) {
    facts.push(`It's configured in ${DRIVE_PROSE[car.handDrive]}.`);
  }

  const drawbacks = tradeLines('rrmc', tradeOffs);
  if (answers.handDrive && car.handDrive && car.handDrive !== answers.handDrive) {
    drawbacks.push(`It's configured in ${DRIVE_PROSE[car.handDrive]}, where you asked for ${DRIVE_PROSE[answers.handDrive]}.`);
  }
  const band = budgetBand(answers);
  if (band && car.priceMin && !car.poa) {
    const [lo, hi] = band;
    const lead = miles
      ? `With just ${miles.toLocaleString('en-GB')} miles on the clock, it's`
      : "With negligible mileage, it's";
    const at = `at ${gbp(car.priceMin)}`;
    if (car.priceMin > hi) drawbacks.push(`${lead} above your price range ${at}.`);
    else if (hi > lo && (car.priceMin - lo) / (hi - lo) >= 2 / 3) {
      drawbacks.push(`${lead} at the higher end of your price range ${at}.`);
    }
  }
  return { asked, facts, drawbacks };
}

/** "Why this one?": what it matches, what it is, its drawbacks, and the way to its listing. */
function openWhyPanel(trigger, match) {
  const { car, reasons = [], tradeOffs = [] } = match;
  const { asked, facts, drawbacks } = whyProse(car, rrmcAnswers, reasons, tradeOffs);
  const content = [];
  if (asked.length) content.push(el('p', 'vm-rrmc-why-prose', asked.join(' ')));
  content.push(
    el('p', 'vm-rrmc-why-prose', facts.join(' ')),
    el('h4', 'vm-rrmc-why-sub', 'What are the drawbacks?'),
    el('p', 'vm-rrmc-why-prose', drawbacks.length
      ? drawbacks.join(' ')
      : 'Nothing stands out against what you asked for.'),
  );
  if (car.link) {
    const more = el('a', 'vm-rrmc-why-more', 'View more details here');
    more.href = car.link;
    more.target = '_blank';
    more.rel = 'noopener noreferrer';
    content.push(more);
  }
  openRrmcPanel(trigger, { heading: 'Why this one?', content });
}

/** One alternative version, with only an "Explore the full range" tile's lines: name, miles and fuel,
 *  and who presents it. The whole tile opens its listing; a grouped card's versions share its fuel. */
function altTile(listing, car, baseName) {
  const tile = el(listing.link ? 'a' : 'div', 'vm-rrmc-alt');
  if (listing.link) {
    tile.href = listing.link;
    tile.target = '_blank';
    tile.rel = 'noopener noreferrer';
  }
  const media = el('div', 'vm-rrmc-alt-media');
  if (listing.photo) {
    const img = el('img', 'vm-rrmc-alt-photo');
    img.src = listing.photo;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => img.remove());
    media.append(img);
  }
  const mileage = listing.mileage ? `${listing.mileage.toLocaleString('en-GB')} Miles` : 'Mileage Negligible';
  const fuel = FUEL_SPEC[car.fuel] || car.fuel || '';
  // A span, not a link: the tile itself is the link.
  const presented = el('p', 'vm-rrmc-alt-presented');
  presented.append('Presented by ', el('span', 'vm-rrmc-alt-location',
    rrmcLocation(listing.retailerName || car.retailerName)));
  const body = el('div', 'vm-rrmc-alt-body');
  body.append(
    el('p', 'vm-rrmc-alt-name', `${listing.year || car.year || ''} ${baseName}`.trim()),
    el('p', 'vm-rrmc-alt-line', [mileage, fuel].filter(Boolean).join(' – ')),
    presented,
  );
  tile.append(media, body);
  return tile;
}

/** "View Options": the other versions grouped under this card, six tiles at a time in a scroller
 *  beneath the fixed title; each tile opens its own listing. */
function openOptionsPanel(trigger, match, { displayName, baseName }) {
  const { car } = match;
  const others = (match.listings || []).filter((l) => l.id !== car.id);
  const scroll = el('div', 'vm-rrmc-alt-scroll');
  scroll.tabIndex = -1;
  if (others.length) {
    const grid = el('div', 'vm-rrmc-alt-grid');
    others.forEach((l) => grid.append(altTile(l, car, baseName)));
    scroll.append(grid);
  } else {
    scroll.append(el('p', 'vm-rrmc-why-none', 'This is the only version we hold at the moment.'));
  }
  openRrmcPanel(trigger, { heading: displayName, content: [scroll], wide: true });
}

const EXTENDED = /\bExtended\b/i;
// Tracking floor for the squeeze: tighter than this and the name stops reading.
const MIN_TRACKING_EM = -0.05;

/** True when the element's text runs past its first line (rect tops vary with font size). */
function wraps(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const rects = [...range.getClientRects()];
  return rects.some((r) => r.top >= rects[0].bottom - 1);
}

// Smallest size a 'line' fit will step a name down to (the tail tiles' own size).
const MIN_FIT_PX = 18;

/** RRMC: a name that wraps sets "Extended" at 16px, then tightens the whole name's tracking
 *  until it fits one line; `line` mode then steps the size down too, for any name. Re-run on
 *  resize so a wider tile relaxes it. */
function fitExtended(nameEl, full, line = false) {
  const hit = full.match(EXTENDED);
  if ((!hit && !line) || typeof ResizeObserver === 'undefined') return;
  new ResizeObserver(() => {
    if (!nameEl.isConnected) return;
    nameEl.style.letterSpacing = '';
    nameEl.style.fontSize = '';
    nameEl.textContent = full;
    if (!wraps(nameEl)) return;
    if (hit) {
      nameEl.replaceChildren(full.slice(0, hit.index), el('span', 'vm-rrmc-extended', hit[0]),
        full.slice(hit.index + hit[0].length));
    }
    let size = parseFloat(getComputedStyle(nameEl).fontSize);
    let em = (parseFloat(getComputedStyle(nameEl).letterSpacing) || 0) / size;
    while (wraps(nameEl) && em > MIN_TRACKING_EM) {
      em = Math.max(MIN_TRACKING_EM, em - 0.005);
      nameEl.style.letterSpacing = `${em}em`;
    }
    while (line && wraps(nameEl) && size > MIN_FIT_PX) {
      size = Math.max(MIN_FIT_PX, size - 1);
      nameEl.style.fontSize = `${size}px`;
    }
  }).observe(nameEl.parentElement || nameEl);
}

/**
 * One result card.
 * `big` adds the "why it suits you" reasons; `compact` is the carousel tile —
 * same anatomy, but trades the blurb and reasons for a distance line.
 *
 * `showScore` and `showPaint` exist for the hard-filter mode (modes/guess-who.js),
 * which is not a recommender:
 *  - showScore: false — there is no score. A hard filter says yes or no, so a
 *    badge would either print "undefined%" or invent a 100% the engine never
 *    awarded. Every scoring mode leaves it alone and keeps its badge.
 *  - showPaint: true — put the paint in a COMPACT card's spec line, which it
 *    normally omits for width. A mode whose whole premise is filtering by colour
 *    has to name the colour on the cars it filtered down to.
 */
export function matchCard(match, {
  big = false, compact = false, brand: brandKey = 'bmw',
  showScore = true, showPaint = false, fitName = false,
  rejectOptions, rejectLabel, rejectPrompt,
} = {}) {
  const { car, score, reasons } = match;
  const copy = BRAND_COPY[brandKey] || BRAND_COPY.bmw;
  const card = el('article', `vm-card${big ? ' vm-card-big' : ''}${compact ? ' vm-card-compact' : ''}`);

  const { media, showPhoto } = mediaWell(car);
  card.append(media);

  const body = el('div', 'vm-card-body');
  const head = el('div', 'vm-card-head');
  const baseName = car.name.replace(/^Rolls-Royce\s+/i, '').replace(/^BMW\s+/, '');
  const displayName = (brandKey === 'rrmc' && car.year) ? `${car.year} ${baseName}` : baseName;
  const nameEl = el('h3', 'vm-card-name');
  head.append(nameEl);
  // RRMC: the photo and the year-and-name both open the car's listing.
  const listingLink = (cls, text) => {
    const a = el('a', cls, text);
    a.href = car.link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  };
  const nameLink = brandKey === 'rrmc' && car.link ? listingLink('vm-rrmc-listing-name', displayName) : null;
  nameEl.append(nameLink || displayName);
  if (nameLink) {
    // One tab stop per card: the name carries the link for keyboards and screen readers.
    const photoLink = listingLink('vm-rrmc-listing-photo');
    photoLink.tabIndex = -1;
    photoLink.setAttribute('aria-hidden', 'true');
    media.append(photoLink);
  }
  // fitName: true fits "Extended" names only; 'line' fits every name to one line.
  if (brandKey === 'rrmc' && fitName) fitExtended(nameLink || nameEl, displayName, fitName === 'line');
  if (showScore) {
    const badge = el('span', 'vm-score', `${score}%`);
    // The number has been unexplained since fit and taste were split, and two
    // cards sharing one reads as a bug unless you know it is a claim that they
    // suit you equally. Said properly in the working note under the cards; this
    // is the affordance for the reader who points at the badge itself.
    badge.title = 'Match score: how well this car fits the answers you gave. Cars that '
      + 'suit you equally get the same score.';
    head.append(badge);
  }
  body.append(head);

  if (brandKey === 'rrmc') {
    const fuel = FUEL_SPEC[car.fuel] || car.fuel || '';
    const mileageText = car.mileage ? `${car.mileage.toLocaleString('en-GB')} Miles` : 'Mileage Negligible';
    const line = [mileageText, fuel].filter(Boolean).join(' – ');
    if (line) body.append(el('p', 'vm-rrmc-mileage', line));
    const location = rrmcLocation(car.retailerName);
    // Both lines open the shared purple panel.
    const panelButton = (text, open) => {
      const btn = el('button', 'vm-rrmc-why-btn', text);
      btn.type = 'button';
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', () => open(btn));
      return btn;
    };
    const options = el('p', 'vm-rrmc-view-options');
    options.append(panelButton('View Options', (btn) => openOptionsPanel(btn, match, { displayName, baseName })));
    body.append(options);
    const why = el('p', 'vm-rrmc-why');
    why.append(panelButton('Why this one?', (btn) => openWhyPanel(btn, match)));
    body.append(why);
    const presented = el('p', 'vm-rrmc-presented');
    // Links to the retailer's homepage when the feed names one; plain text otherwise.
    const locationSpan = el(car.retailerUrl ? 'a' : 'span', 'vm-rrmc-presented-location', location);
    if (car.retailerUrl) {
      locationSpan.href = car.retailerUrl;
      locationSpan.target = '_blank';
      locationSpan.rel = 'noopener noreferrer';
    }
    presented.append('Presented by ', locationSpan);
    body.append(presented);
  }

  // Single used price when min === max (live stock), else the range.
  // A grouped card prices the whole group; a single listing prices itself.
  const price = (car.poa || !car.priceMin) ? 'POA'
    : (car.listingCount > 1 && car.priceFrom && car.priceFrom !== car.priceTo
      ? `from ${gbp(car.priceFrom)}`
      : (car.priceMin === car.priceMax
        ? gbp(car.priceMin)
        : `${gbp(car.priceMin)}–${gbp(car.priceMax)}`));
  const specs = el('p', 'vm-specs');
  // Paint, by its marketing name ("Legend Grey"), when the detail lookup got
  // one. It reads as a spec, but it's carrying more weight than that: when the
  // engine can't separate the cars, colour is very often the actual difference
  // between them — so it belongs on the card, not buried on the retailer's PDP.
  const lead = [SPEC_LABELS[car.body], FUEL_SPEC[car.fuel]].filter(Boolean);
  /*
   * The spec line, rebuilt rather than written once, because the listing
   * picker below can change what this card is describing. It used to be built
   * inline, so choosing a listing updated the mileage and the link but left
   * the paint saying "Chili Red" next to the black car's mileage — a card
   * describing two different cars at once, which is worse than not offering
   * the choice at all.
   */
  /*
   * `gearbox` is passed in rather than read off `car` because it is a property
   * of one listing: a card speaking for four cars can hold three autos and a
   * manual, so the gearbox has to follow the picker exactly as the paint does.
   * Seats and boot are per-model and constant across a group, so they are read
   * straight off the car.
   *
   * Boot is qualified with "seats up". It comes from MODEL_SPECS, not from the
   * feed, and an unqualified litre figure is precisely the kind of claim Priya
   * says she cannot picture: the number people distrust is the one that might
   * quietly be the seats-down figure.
   */
  function renderSpecs(paint, shade, priceText, gearbox) {
    specs.replaceChildren();
    const head = [...lead, GEARBOX_SPEC[gearbox]].filter(Boolean);
    // Compact tiles are narrow — the headline specs only, no practicality,
    // 0–62 or economy.
    const tail = (compact ? [priceText] : [
      priceText,
      car.seats ? `${car.seats} seats` : null,
      car.boot ? `${car.boot}-litre boot, seats up` : null,
      `0–62 ${car.zeroTo62}s`,
      car.fuel === 'ev' ? `${car.evRange} mi range` : `${car.mpg} mpg`,
    ]).filter(Boolean);
    // No paint to print, or a compact tile whose caller hasn't asked for it.
    if (!paint || (compact && !showPaint)) {
      specs.textContent = [...head, ...tail].join('  ·  ');
      return;
    }
    // Paint gets a swatch as well as its name: in a tie the colour is very
    // often the actual difference between the cars, and a dot you can see
    // beats a name you have to read. No hex for the name → name alone.
    specs.append(`${head.join('  ·  ')}  ·  `);
    const hex = SWATCH_HEX[(shade || '').toLowerCase()];
    if (hex) {
      const dot = el('span', 'vm-swatch');
      dot.style.background = hex;
      specs.append(dot);
    }
    specs.append(`${paint}  ·  ${tail.join('  ·  ')}`);
  }
  renderSpecs(
    car.colour?.manufacturerColour || car.colour?.colour,
    car.colour?.colour,
    price,
    car.transmission,
  );
  body.append(specs);

  // The whole point of the carousel: how far away is it, and whose is it?
  // Distance comes from the live feed, so omit the line rather than invent
  // one if the feed didn't supply it.
  /*
   * Where this car is, on every card rather than only the compact ones.
   *
   * This is what lets the page be one ranked list instead of three. When
   * "at the retailer" and "23 miles away" were separate SECTIONS, each needed
   * its own caption, and those captions contradicted each other as soon as a
   * distant car outscored a local one. Make it a property of the card and the
   * sections stop being necessary: the list is just sorted, and each row says
   * where you'd go.
   */
  const where = el('p', 'vm-distance');
  if (car.distance != null) {
    where.append(el('span', 'vm-distance-miles', distanceLabel(car.distance)));
    if (car.retailerName) where.append(el('span', null, ` · ${car.retailerName}`));
    body.append(where);
  } else if (car.retailerName) {
    where.append(el('span', 'vm-distance-here', `At ${car.retailerName}`));
    body.append(where);
  }

  // When repeat listings of the same car were grouped into this card, say so:
  // how many, the price spread, and the colours they come in. Without this the
  // page showed four identical iX2 cards and looked like it was stuttering.
  if (car.listingCount > 1) {
    const avail = el('p', 'vm-avail');
    const span = (car.poa || !car.priceFrom) ? 'POA'
      : car.priceFrom === car.priceTo
        ? gbp(car.priceFrom)
        : `${gbp(car.priceFrom)}–${gbp(car.priceTo)}`;
    avail.append(el('span', 'vm-avail-count', `${car.listingCount} available`));
    avail.append(el('span', null, ` · ${span}`));
    if (car.colours?.length) avail.append(el('span', null, ` · ${orList(car.colours)}`));
    body.append(avail);
  }

  // Real used-car detail from the live feed, when present.
  const detailBits = [];
  if (car.plate) detailBits.push(`’${car.plate} reg`);
  if (car.mileage != null) detailBits.push(`${car.mileage.toLocaleString('en-GB')} miles`);
  const usedMeta = detailBits.length ? el('p', 'vm-usedmeta', detailBits.join('  ·  ')) : null;
  if (usedMeta) body.append(usedMeta);

  if (!compact) body.append(el('p', 'vm-blurb', car.blurb));

  /*
   * What is actually on this car, from the feed's factory options list.
   *
   * The equipment concepts have been parsed since the refinement work and had
   * exactly one surface: a chip, offered only where the stock happens to split
   * on them. That is the wrong surface for confirming a fact. Priya walks away
   * from "ISOFIX she cannot confirm", and on her page every lead car has it,
   * so the chip is correctly suppressed and she learns nothing. Meg's clause
   * wants the comfort equipment "stated where she can see it", not inferred
   * from which filters are on offer.
   *
   * It claims PRESENCE and never absence. The feed lists factory options, so a
   * car can carry standard kit this never mentions — which is why the label is
   * "what's fitted" rather than a spec sheet, and why nothing anywhere says a
   * car lacks something. Capped, with the remainder counted rather than
   * silently dropped, and rebuilt by the picker because equipment belongs to a
   * listing rather than to the model.
   */
  const kit = el('p', 'vm-kit');
  const kitLabel = el('p', 'vm-why-label vm-kit-label', copy.kitLabel);
  function renderKit(chosen) {
    const have = new Set(chosen?.features || car.features || []);
    const named = Object.entries(CONCEPT_LABELS)
      .filter(([key]) => have.has(key))
      .map(([, label]) => label);
    kit.hidden = !named.length;
    kitLabel.hidden = !named.length;
    if (!named.length) return;
    const shown = named.slice(0, KIT_SHOWN);
    const rest = named.length - shown.length;
    kit.textContent = shown.join(', ')
      + (rest > 0 ? copy.kitMore({ count: rest }) : '');
  }
  if (!compact) {
    renderKit(listingsOf(match)[0]);
    body.append(kitLabel, kit);
  }

  /*
   * The reasons, on every card that leads the page rather than only on a hero.
   *
   * Same argument the trade-off line was widened on: a tie renders several
   * lead cards and none of them is "big", so the page's entire case for the
   * cars it is recommending vanished in exactly the state where the buyer has
   * most to choose between. Sam & Jordan Reyes walk away when the practicality
   * claims read like brochure copy, and their page is a five-card taste pick,
   * so until now their clause could not even be tested.
   *
   * Trimmed to two on a multi-card page. Four bullets across five cards is a
   * wall, and the reasons are sorted by how much they contributed, so the top
   * two are the case and the rest are corroboration.
   */
  if (!compact && reasons.length) {
    const why = el('ul', 'vm-reasons');
    reasons.slice(0, big ? reasons.length : 2).forEach((r) => why.append(el('li', null, r)));
    body.append(el('p', 'vm-why-label', 'Why it suits you'), why);
  }

  // Owning the trade-off: when a recommendation misses a stated want (it's
  // petrol and they asked for electric), the card says so itself, right under
  // the case for it — not only the page-level unmet note, which fires solely
  // when the whole reachable pool is short, and in practice almost never does.
  //
  // Every card that leads the page, not just the hero: a tie renders medium
  // cards, and that's precisely where the admission matters most — six coupés
  // offered to someone who asked for a convertible should say so on each of
  // them, not go quiet because none of them is a "hero". Only the compact
  // carousel tiles skip it, and they already state the shape in their specs.
  // RRMC tiles leave it out ("Petrol, where you asked for…"); the page headline still owns up.
  if (!compact && match.tradeOffs?.length && brandKey !== 'rrmc') {
    const { label } = TRADE_COPY[brandKey] || TRADE_COPY.bmw;
    body.append(
      el('p', 'vm-why-label vm-trade-label', label),
      el('p', 'vm-trade-text', tradeLines(brandKey, match.tradeOffs).join(' ')),
    );
  }

  // Set by the reject block below, called by the listing picker further down:
  // the two are built in DOM order but have to stay in step, because a reason
  // for turning a car down is only usable if it is about the car on screen.
  let onPick = null;

  // "Not this one" — the other half of choosing. Rejecting a car is the
  // highest-signal thing a buyer does, because it's a reaction to a real car
  // rather than an answer about a hypothetical one; the menu is what turns it
  // into something actionable (see rejectOptions). Only offered where a
  // caller supplies the options, so it appears in a tie and nowhere else.
  if (rejectOptions) {
    const rejectWrap = el('div', 'vm-reject');
    const open = el('button', 'vm-reject-open', rejectLabel || 'Not this one');
    open.type = 'button';
    open.setAttribute('aria-expanded', 'false');
    // Says what the control DOES. It was a small underlined link that looked
    // like a disclaimer, and nothing on the page suggested that turning a
    // car down would bring another one in — so the most conversational thing
    // the tool can do read as the least important.
    if (copy.rejectHint) open.append(el('span', 'vm-reject-hint', copy.rejectHint));
    const menu = el('div', 'vm-reject-menu');
    menu.hidden = true;
    open.addEventListener('click', () => {
      menu.hidden = !menu.hidden;
      open.setAttribute('aria-expanded', String(!menu.hidden));
    });

    /*
     * Rebuilt whenever the card changes which car it is describing.
     *
     * The menu used to be built once, from the group's representative, and the
     * listing picker only repainted the DOM — so switching a four-colour card
     * from red to green left "Not the red" on offer, and taking it removed the
     * green car the buyer was actually looking at. The reason has to be about
     * the car in front of them, or it is worse than no reason at all.
     */
    function renderRejectMenu(chosen) {
      const options = rejectOptions(match, chosen);
      rejectWrap.hidden = !options.length;
      menu.replaceChildren(el('p', 'vm-reject-prompt', rejectPrompt || 'What put you off?'));
      options.forEach((o) => {
        const b = el('button', 'vm-reject-option', o.label);
        b.type = 'button';
        b.addEventListener('click', o.apply);
        menu.append(b);
      });
    }
    renderRejectMenu(listingsOf(match)[0]);
    onPick = renderRejectMenu;

    rejectWrap.append(open, menu);
    body.append(rejectWrap);
  }

  /*
   * Which one, though?
   *
   * Grouping repeat listings fixed the page reading as a stutter, but it also
   * ended the journey a step early: it narrowed to a model and trim, then
   * quietly handed over whichever listing happened to rank first. That's the
   * step Chloe and Meg actually care about — the same Cooper C in Ocean Wave
   * Green or Melting Silver is the whole decision for them.
   *
   * So a card that speaks for several cars lets the buyer pick the actual one.
   * Choosing swaps the photo, price, mileage and the link out, so the card
   * always describes the car they'd be going to see. Hero cards only: the
   * compact tiles are a glance, not a decision.
   */
  // Every card that speaks for several cars, not just the hero. The picker
  // was `big`-only, so a tie — where grouped cards are commonest — showed
  // "4 available … Portimao Blue, Brooklyn Grey or Alpine White" with no way
  // to choose between them. Compact tiles stay out: they're a glance.
  if (!compact && match.listings?.length > 1) {
    body.append(el('p', 'vm-why-label', copy.pickLabel));
    const picker = el('div', 'vm-pick');
    match.listings.forEach((listing, i) => {
      const opt = el('button', `vm-pick-opt${i === 0 ? ' is-on' : ''}`);
      opt.type = 'button';
      opt.setAttribute('aria-pressed', String(i === 0));
      // Marketing names bury the basic colour anywhere in the string, and not
      // always last ("Midnight Black II", "Chili Red"), so try every word.
      const hex = (listing.colour || '')
        .toLowerCase().split(/[^a-z]+/)
        .map((word) => SWATCH_HEX[word])
        .find(Boolean);
      if (hex) {
        const dot = el('span', 'vm-swatch');
        dot.style.background = hex;
        opt.append(dot);
      }
      // Paint is fetched per car and can be missing (an unreachable page, or
      // the request's colour budget running out). Naming the row "Colour n/a"
      // told the buyer nothing; mileage is the next thing that actually
      // separates two otherwise identical cars.
      const label = listing.colour
        || (listing.mileage != null ? `${listing.mileage.toLocaleString('en-GB')} miles` : `Option ${i + 1}`);
      opt.append(el('span', 'vm-pick-colour', label));
      const bits = [listing.poa ? 'POA' : gbp(listing.priceMin)];
      if (listing.colour && listing.mileage != null) {
        bits.push(`${listing.mileage.toLocaleString('en-GB')} mi`);
      }
      opt.append(el('span', 'vm-pick-meta', bits.join(' · ')));
      opt.addEventListener('click', () => {
        picker.querySelectorAll('.vm-pick-opt').forEach((b) => {
          b.classList.remove('is-on');
          b.setAttribute('aria-pressed', 'false');
        });
        opt.classList.add('is-on');
        opt.setAttribute('aria-pressed', 'true');
        // Re-describe the card as the chosen car: paint, swatch, price,
        // gearbox, mileage and where the link goes. Anything left showing the
        // previous listing's values is a card describing two cars at once.
        showPhoto(listing.photo);
        renderSpecs(
          listing.colour, listing.shade, listing.poa ? 'POA' : gbp(listing.priceMin),
          listing.transmission ?? car.transmission,
        );
        renderKit(listing);
        if (usedMeta) {
          const bits = [];
          if (car.plate) bits.push(`’${car.plate} reg`);
          if (listing.mileage != null) {
            bits.push(`${listing.mileage.toLocaleString('en-GB')} miles`);
          }
          usedMeta.textContent = bits.join('  ·  ');
        }
        if (listing.link) {
          card.querySelectorAll('.vm-card-link, .vm-rrmc-listing-name, .vm-rrmc-listing-photo')
            .forEach((a) => { a.href = listing.link; });
        }
        // Re-offer reasons about the car now being shown.
        onPick?.(listing);
      });
      picker.append(opt);
    });
    body.append(picker);
  }

  // Link out to the retailer's live stock, when the feed gave us one.
  if (car.link) {
    const cta = el('a', 'vm-card-link', `View at ${car.retailerName || 'the retailer'} ›`);
    cta.href = car.link;
    cta.target = '_blank';
    cta.rel = 'noopener noreferrer';
    body.append(cta);
  }

  card.append(body);
  return card;
}

/**
 * A small "mini" tile for the live preview strip — deliberately lighter than the
 * results-page compact card (matchCard): a small photo (or the "Images coming
 * soon" placeholder), the model name + match score, and one spec line. The whole
 * tile is a link to the live listing when the feed gave us one.
 */
export function previewTile(match) {
  const { car, score } = match;
  // A grouped card prices the whole group; a single listing prices itself.
  const price = (car.poa || !car.priceMin) ? 'POA'
    : (car.listingCount > 1 && car.priceFrom && car.priceFrom !== car.priceTo
      ? `from ${gbp(car.priceFrom)}`
      : (car.priceMin === car.priceMax
        ? gbp(car.priceMin)
        : `${gbp(car.priceMin)}–${gbp(car.priceMax)}`));

  // Whole tile is the tap target — an <a> when we have a link, else a plain
  // article (still a valid tile, just not clickable).
  const tag = car.link ? 'a' : 'article';
  const tile = el(tag, 'vm-ptile vm-ptile-mini');
  if (car.link) {
    tile.href = car.link;
    tile.target = '_blank';
    tile.rel = 'noopener noreferrer';
    tile.setAttribute('aria-label', `${car.name}, ${price}, ${score}% match. View at ${car.retailerName || 'the retailer'}`);
  }

  const { media } = mediaWell(car, 'vm-ptile-media');

  const body = el('div', 'vm-ptile-body');
  const head = el('div', 'vm-ptile-head');
  const badge = el('span', 'vm-score vm-ptile-score', `${score}%`);
  badge.title = 'Match score';
    const ptileBase = car.name.replace(/^Rolls-Royce\s+/i, '').replace(/^BMW /, '');
  const ptileName = (/^Rolls-Royce\s+/i.test(car.name) && car.year) ? `${car.year} ${ptileBase}` : ptileBase;
  head.append(el('span', 'vm-ptile-name', ptileName), badge);
  const specs = el('span', 'vm-ptile-specs',
    [SPEC_LABELS[car.body], FUEL_SPEC[car.fuel], price].filter(Boolean).join(' · '));
  body.append(head, specs);
  tile.append(media, body);
  return tile;
}
