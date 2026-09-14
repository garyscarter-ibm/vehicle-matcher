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

import { el, gbp } from '../ui.js';
import { BRAND_COPY, TRADE_COPY, tradeLines, orList } from './brand-copy.js';

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
  showScore = true, showPaint = false,
  rejectOptions, rejectLabel, rejectPrompt,
} = {}) {
  const { car, score, reasons } = match;
  const copy = BRAND_COPY[brandKey] || BRAND_COPY.bmw;
  const card = el('article', `vm-card${big ? ' vm-card-big' : ''}${compact ? ' vm-card-compact' : ''}`);

  const { media, showPhoto } = mediaWell(car);
  card.append(media);

  const body = el('div', 'vm-card-body');
  const head = el('div', 'vm-card-head');
  head.append(el('h3', 'vm-card-name', car.name));
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

  // Single used price when min === max (live stock), else the range.
  // A grouped card prices the whole group; a single listing prices itself.
  const price = car.listingCount > 1 && car.priceFrom !== car.priceTo
    ? `from ${gbp(car.priceFrom)}`
    : (car.priceMin === car.priceMax
      ? gbp(car.priceMin)
      : `${gbp(car.priceMin)}–${gbp(car.priceMax)}`);
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
    const span = car.priceFrom === car.priceTo
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
  if (!compact && match.tradeOffs?.length) {
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
      const bits = [gbp(listing.priceMin)];
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
          listing.colour, listing.shade, gbp(listing.priceMin),
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
        const cta = card.querySelector('.vm-card-link');
        if (cta && listing.link) cta.href = listing.link;
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
 * BMW podium card — the redesigned tile matching the BMW Approved Used style.
 * Used only by the podium mode when brand === 'bmw'.
 */
export function bmwPodiumCard(match) {
  const { car, reasons } = match;

  // Split name into model line (e.g. "BMW X6") and trim (e.g. "XDrive40d M Sport")
  // car.name is typically "BMW X6 XDrive40d M Sport" — split on the line name
  const lineName = car.line ? `BMW ${car.line}` : car.name;
  const trimName = car.line && car.name.startsWith(lineName)
    ? car.name.slice(lineName.length).trim()
    : null;

  const priceNum = car.listingCount > 1 && car.priceFrom !== car.priceTo
    ? gbp(car.priceFrom)
    : (car.priceMin === car.priceMax ? gbp(car.priceMin) : gbp(car.priceMin));
  const isFrom = (car.listingCount > 1 && car.priceFrom !== car.priceTo)
    || car.priceMin !== car.priceMax;

  const card = el('article', 'vm-card vm-bmw-card');
  const { media } = mediaWell(car);
  card.append(media);

  const body = el('div', 'vm-card-body vm-bmw-body');

  // Header: left = model name + trim, right = roundel + from/price
  const header = el('div', 'vm-bmw-header');

  const nameStack = el('div', 'vm-bmw-name-stack');
  nameStack.append(el('h3', 'vm-bmw-name', lineName));
  if (trimName) nameStack.append(el('span', 'vm-bmw-trim', trimName));
  header.append(nameStack);

  const priceStack = el('div', 'vm-bmw-price-stack');
  const roundel = el('span', 'vm-bmw-roundel');
  roundel.innerHTML = `<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="none" stroke="#1c69d4" stroke-width="2"/><path d="M16 1v15H1A15 15 0 0 1 16 1z" fill="#1c69d4"/><path d="M16 16v15A15 15 0 0 1 1 16z" fill="#fff"/><path d="M16 1a15 15 0 0 1 15 15H16z" fill="#fff"/><path d="M31 16a15 15 0 0 1-15 15V16z" fill="#1c69d4"/><circle cx="16" cy="16" r="15" fill="none" stroke="#999" stroke-width="1"/></svg>`;
  if (isFrom) priceStack.append(el('span', 'vm-bmw-from', 'from'));
  const priceRow = el('div', 'vm-bmw-price-row');
  priceRow.append(roundel, el('span', 'vm-bmw-price', priceNum));
  priceStack.append(priceRow);
  header.append(priceStack);

  body.append(header);

  // Blue spec band — 2 lines: line 1 bold (body/fuel/gearbox/mpg), line 2 normal (colour/seats/boot + 0-62)
  const specBand = el('div', 'vm-bmw-spec-band');
  const line1Parts = [SPEC_LABELS[car.body], FUEL_SPEC[car.fuel]];
  if (car.transmission === 'auto') line1Parts.push('Automatic');
  else if (car.transmission === 'manual') line1Parts.push('Manual');
  if (car.mpg) line1Parts.push(`${car.mpg} mpg`);
  specBand.append(el('p', 'vm-bmw-spec-line1', line1Parts.filter(Boolean).join(' - ')));

  const line2Parts = [];
  if (car.colour?.manufacturerColour || car.colour?.colour) {
    line2Parts.push(car.colour.manufacturerColour || car.colour.colour);
  }
  if (car.seats) line2Parts.push(`${car.seats} Seats`);
  if (car.boot) line2Parts.push(`${car.boot}l Boot`);
  if (car.zeroTo62) line2Parts.push(`0-62mph in ${car.zeroTo62}s`);
  if (line2Parts.length) specBand.append(el('p', 'vm-bmw-spec-line2', line2Parts.join(' - ')));
  body.append(specBand);

  // Detail rows — SVG icons, no emojis
  const details = el('div', 'vm-bmw-details');

  const calIcon = `<svg class="vm-bmw-svg-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2" y="4" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M2 8h16" stroke="currentColor" stroke-width="1.5"/><path d="M6 2v4M14 2v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const milesIcon = `<svg class="vm-bmw-svg-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M10 6v4l3 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const pinIcon = `<svg class="vm-bmw-svg-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2a6 6 0 0 1 6 6c0 4-6 10-6 10S4 12 4 8a6 6 0 0 1 6-6z" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/></svg>`;

  if (car.plate || car.year) {
    const row = el('div', 'vm-bmw-detail-row');
    row.innerHTML = calIcon;
    const label = [
      car.year ? `${car.year}` : null,
      car.plate ? `(${car.plate})` : null,
    ].filter(Boolean).join(' ');
    const txt = el('span', 'vm-bmw-detail-text');
    txt.append(`Approved-used `);
    txt.append(el('strong', null, label));
    txt.append(` registered ${car.line || ''}`);
    row.append(txt);
    details.append(row);
  }

  if (car.mileage != null) {
    const row = el('div', 'vm-bmw-detail-row');
    row.innerHTML = milesIcon;
    const txt = el('span', 'vm-bmw-detail-text');
    txt.append(`Approx. `);
    txt.append(el('strong', null, `${car.mileage.toLocaleString('en-GB')} miles`));
    row.append(txt);
    details.append(row);
  }

  if (car.retailerName) {
    const row = el('div', 'vm-bmw-detail-row');
    row.innerHTML = pinIcon;
    const txt = el('span', 'vm-bmw-detail-text');
    txt.append(`Ready for pickup from `);
    txt.append(el('strong', null, car.retailerName));
    if (car.distance != null) {
      txt.append(el('span', 'vm-bmw-distance', ` · ${distanceLabel(car.distance)}`));
    }
    row.append(txt);
    details.append(row);
  }

  if (details.children.length) body.append(details);

  // Features
  const have = new Set(car.features || []);
  const named = Object.entries(CONCEPT_LABELS).filter(([k]) => have.has(k)).map(([, v]) => v);
  if (named.length) {
    body.append(el('p', 'vm-bmw-section-label', 'Features'));
    body.append(el('p', 'vm-bmw-features', named.slice(0, KIT_SHOWN).join(' - ')));
  }

  // Matched because
  if (reasons && reasons.length) {
    body.append(el('p', 'vm-bmw-section-label', 'Matched to you because...'));
    const list = el('ul', 'vm-bmw-reasons');
    reasons.slice(0, 4).forEach((r) => list.append(el('li', null, r)));
    body.append(list);
  }

  card.append(body);
  return card;
}

/**
 * BMW "also worth a look" tail tile — compact, minimal.
 * Shows: photo, car name, body/fuel, price, retailer/distance. Nothing else.
 */
export function bmwTailTile(match) {
  const { car } = match;

  const lineName = car.line ? `BMW ${car.line}` : car.name;
  const trimName = car.line && car.name.startsWith(lineName)
    ? car.name.slice(lineName.length).trim()
    : null;

  const priceText = car.listingCount > 1 && car.priceFrom !== car.priceTo
    ? `from ${gbp(car.priceFrom)}`
    : (car.priceMin === car.priceMax ? gbp(car.priceMin) : `from ${gbp(car.priceMin)}`);

  const tile = el('article', 'vm-bmw-tail-tile');
  const { media } = mediaWell(car);
  tile.append(media);

  const body = el('div', 'vm-bmw-tail-body');
  body.append(el('h4', 'vm-bmw-tail-name', lineName));
  if (trimName) body.append(el('span', 'vm-bmw-trim', trimName));

  const specParts = [SPEC_LABELS[car.body], FUEL_SPEC[car.fuel], GEARBOX_SPEC[car.transmission]].filter(Boolean);
  if (specParts.length) body.append(el('p', 'vm-bmw-tail-specs', specParts.join(' · ')));

  const metaParts = [];
  if (car.year) metaParts.push(car.year);
  else if (car.plate) metaParts.push(`'${car.plate} reg`);
  if (car.mileage != null) metaParts.push(`${car.mileage.toLocaleString('en-GB')} miles`);
  if (metaParts.length) body.append(el('p', 'vm-bmw-tail-meta', metaParts.join(' · ')));

  body.append(el('p', 'vm-bmw-tail-price', priceText));

  if (car.retailerName || car.distance != null) {
    const where = el('p', 'vm-bmw-tail-where');
    if (car.distance != null) {
      where.textContent = `${distanceLabel(car.distance)} · ${car.retailerName || ''}`;
    } else {
      where.textContent = car.retailerName;
    }
    body.append(where);
  }

  tile.append(body);
  return tile;
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
  const price = car.listingCount > 1 && car.priceFrom !== car.priceTo
    ? `from ${gbp(car.priceFrom)}`
    : (car.priceMin === car.priceMax
      ? gbp(car.priceMin)
      : `${gbp(car.priceMin)}–${gbp(car.priceMax)}`);

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
  head.append(el('span', 'vm-ptile-name', car.name.replace(/^BMW /, '')), badge);
  const specs = el('span', 'vm-ptile-specs',
    [SPEC_LABELS[car.body], FUEL_SPEC[car.fuel], price].filter(Boolean).join(' · '));
  body.append(head, specs);
  tile.append(media, body);
  return tile;
}
