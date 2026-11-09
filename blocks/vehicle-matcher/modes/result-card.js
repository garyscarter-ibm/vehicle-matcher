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

import { el, gbp, button, factList, formatTerm } from '../ui.js';
import { BRAND_COPY, TRADE_COPY, tradeLines, orList, EXACT_LISTING_COPY } from './brand-copy.js';

export const SPEC_LABELS = {
  hatchback: 'Hatchback', saloon: 'Saloon', estate: 'Estate', suv: 'SUV',
  coupe: 'Coupé', convertible: 'Convertible', mpv: 'Family carrier',
};
export const FUEL_SPEC = { petrol: 'Petrol', diesel: 'Diesel', phev: 'Plug-in hybrid', ev: 'Electric' };

export function feedbackScope({ text }) {
  return el('p', 'vm-brief-count vm-feedback-scope', text);
}

export function feedbackUndo({ text, onUndo }) {
  const button = el('button', 'vm-brief-undo', 'Undo');
  button.type = 'button';
  button.setAttribute('aria-label', `Undo ${text}`);
  if (onUndo) button.addEventListener('click', onUndo);
  return button;
}

export function feedbackButton({ text, variant = 'ghost', onClick }) {
  const button = el('button', `vm-btn vm-btn-${variant}`, text);
  button.type = 'button';
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

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
export const listingsOf = (m, { view } = {}) => view ? (view.members || []) : (m.listings || []);


/** Miles from the configured retailer, e.g. "18.1 miles away". */
export function distanceLabel(distance) {
  const miles = Math.round(distance * 10) / 10;
  return `${miles} ${miles === 1 ? 'mile' : 'miles'} away`;
}

/** Shared photo/placeholder well; showPhoto updates exact imagery, alt, line and optional caption. */
export function mediaWell(car, extraClass = '', { placeholder = 'Images coming soon', view } = {}) {
  if (view) car = { name: view.display?.name, line: view.display?.line, photo: view.media?.src, ...view.media };
  const media = el('div', `vm-card-media${extraClass ? ` ${extraClass}` : ''}`);
  media.append(
    el('span', 'vm-card-soon', placeholder),
    el('span', 'vm-card-line', car.line),
  );

  function showPhoto(src, selected = car) {
    media.querySelector('.vm-card-line').textContent = view ? selected.line || '' : selected.line || car.line || '';
    media.querySelector('.vm-card-photo')?.remove();
    media.querySelector('.vm-media-caption')?.remove();
    media.classList.toggle('has-photo', Boolean(src));
    if (!src) return;
    const img = el('img', 'vm-card-photo');
    img.src = src;
    img.alt = selected.alt || selected.name || car.name;
    img.loading = 'lazy';
    // A broken image URL shouldn't leave a half-rendered card — drop back to
    // the placeholder, exactly as a photo-less car shows.
    img.addEventListener('error', () => {
      if (img.parentElement !== media) return;
      media.classList.remove('has-photo');
      media.querySelector('.vm-media-caption')?.remove();
      img.remove();
    });
    // Ahead of the caption and the line label, both of which sit over it.
    media.prepend(img);
    if (selected.caption) media.append(el('span', 'vm-media-caption', selected.caption));
  }
  showPhoto(car.photo);

  return { media, showPhoto };
}

/** Shared result card: legacy retail options or explicit exact-member view data (see COMPONENTS.md). */
export function matchCard(match, {
  big = false, compact = false, brand: brandKey = 'bmw',
  showScore = true, showPaint = false,
  rejectOptions, rejectLabel, rejectPrompt, onListingSelect, view, onAction, scoreLabel, factsClass, headingLevel = 3,
} = {}) {
  if (view) return explicitViewCard(view, { compact, showScore, scoreLabel, factsClass, onListingSelect, onAction, headingLevel });
  const { car } = match;
  const listings = listingsOf(match);
  const copy = BRAND_COPY[brandKey] || BRAND_COPY.bmw;
  const card = el('article', `vm-card${big ? ' vm-card-big' : ''}${compact ? ' vm-card-compact' : ''}`);

  const { media, showPhoto } = mediaWell(car);
  card.append(media);

  const body = el('div', 'vm-card-body');
  const head = el('div', 'vm-card-head');
  const name = el('h3', 'vm-card-name', car.name);
  head.append(name);
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
      Number.isFinite(car.zeroTo62) ? `0–62 ${car.zeroTo62}s` : null,
      car.fuel === 'ev'
        ? (Number.isFinite(car.evRange) ? `${car.evRange} mi range` : null)
        : (Number.isFinite(car.mpg) ? `${car.mpg} mpg` : null),
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
  function renderWhere(selected) {
    where.replaceChildren();
    if (selected.distance != null) {
      where.append(el('span', 'vm-distance-miles', distanceLabel(selected.distance)));
      if (selected.retailerName) where.append(el('span', null, ` · ${selected.retailerName}`));
    } else if (selected.retailerName) {
      where.append(el('span', 'vm-distance-here', `At ${selected.retailerName}`));
    }
    where.hidden = !where.childNodes.length;
  }
  body.append(where);

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
  const usedMeta = el('p', 'vm-usedmeta', detailBits.join('  ·  '));
  usedMeta.hidden = !detailBits.length;
  body.append(usedMeta);

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
    const have = new Set((chosen ? chosen.features : car.features) || []);
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
  const decisionBody = el('div', 'vm-card-decision');
  decisionBody.setAttribute('aria-live', 'polite');
  if (!compact) body.append(decisionBody);

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
  function renderDecision(chosen) {
    const exact = chosen?.decision;
    const decision = exact || (!match.decisionUnavailable && (!chosen || chosen === listings[0]) ? match : null);
    head.querySelector('.vm-score')?.remove();
    decisionBody.replaceChildren();
    card.dataset.stretch = decision?.stretch == null ? 'unknown' : String(decision.stretch);
    if (showScore && Number.isFinite(decision?.score)) {
      const badge = el('span', 'vm-score', `${decision.score}%`);
      badge.title = 'Match score: how well this car fits the answers you gave. Cars that '
        + 'suit you equally get the same score.';
      head.append(badge);
    }
    if (compact) return;
    if (showScore && !Number.isFinite(decision?.score)) {
      decisionBody.append(el('p', 'vm-feedback-scope', EXACT_LISTING_COPY.unavailable));
    }
    const reasons = decision?.reasons || [];
    if (reasons.length) {
      const why = el('ul', 'vm-reasons');
      // A stretch is a material warning, even when a medium card trims its
      // positive reasons. Keep it visible alongside the strongest reasons.
      const shown = big ? reasons : [...new Set([...reasons.slice(0, 2),
        ...(decision.stretch ? reasons.filter((r) => /stretch/i.test(r)) : [])])];
      shown.forEach((r) => why.append(el('li', null, r)));
      decisionBody.append(el('p', 'vm-why-label', 'Why it suits you'), why);
    }
    if (decision?.tradeOffs?.length) {
      const { label } = TRADE_COPY[brandKey] || TRADE_COPY.bmw;
      decisionBody.append(el('p', 'vm-why-label vm-trade-label', label),
        el('p', 'vm-trade-text', tradeLines(brandKey, decision.tradeOffs).join(' ')));
    }
  }

  // A single projection paints all listing-owned facts and decision claims.
  // Native picker buttons stay mounted, preserving keyboard focus on a swap.
  const cta = el('a', 'vm-card-link', `View at ${car.retailerName || 'the retailer'} ›`);
  cta.target = '_blank';
  cta.rel = 'noopener noreferrer';
  function renderChosen(chosen) {
    const selected = chosen || car;
    const first = !chosen || chosen === listings[0];
    const location = first ? { ...car, ...selected } : selected;
    name.textContent = selected.name || car.name;
    renderWhere(location);
    showPhoto(selected.photo, selected);
    const paint = typeof selected.colour === 'object'
      ? selected.colour?.manufacturerColour || selected.colour?.colour : selected.colour;
    renderSpecs(paint, selected.shade || selected.colour?.colour,
      chosen ? gbp(selected.priceMin) : price, selected.transmission);
    renderKit(chosen);
    renderDecision(chosen);
    const bits = [];
    if (selected.plate ?? (first ? car.plate : null)) bits.push(`’${selected.plate ?? car.plate} reg`);
    if (selected.mileage != null) bits.push(`${selected.mileage.toLocaleString('en-GB')} miles`);
    usedMeta.textContent = bits.join('  ·  ');
    usedMeta.hidden = !bits.length;
    cta.remove();
    if (selected.link) {
      cta.href = selected.link;
      cta.textContent = `View at ${location.retailerName || 'the retailer'} ›`;
      body.append(cta);
    }
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
        if (o.scope) menu.append(feedbackScope({ text: o.scope }));
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
        renderChosen(listing);
        // Re-offer reasons about the car now being shown.
        onPick?.(listing);
        onListingSelect?.(listing);
      });
      picker.append(opt);
    });
    body.append(picker);
  }

  // Link out to the retailer's live stock, when the feed gave us one.
  renderChosen(listings[0]);

  card.append(body);
  return card;
}

/** Lightweight retail preview, or the shared explicit view contract without retail label inference. */
export function previewTile(match, { view, onListingSelect, onAction } = {}) {
  if (view) return matchCard(match, { view, compact: true, onListingSelect, onAction });
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


let viewCardSequence = 0;
const gateLabels = { eligible: 'Eligible', ineligible: 'Not eligible', 'needs-confirmation': 'Needs confirmation' };
const decisionText = (entry) => typeof entry === 'string' ? entry : entry?.text || entry?.reason || entry?.code?.replaceAll('-', ' ') || 'Not supplied';

// The explicit projection is display data only; the caller owns decisions, transport and state.
function explicitViewCard(view, { compact, showScore, scoreLabel, factsClass, onListingSelect, onAction, headingLevel = 3 }) {
  const members = listingsOf(null, { view });
  if (!members.length) throw new TypeError('An explicit card view requires exact members');
  let selected = members.find((member) => member.id === view.selectedId) || members[0];
  const instance = ++viewCardSequence;
  const card = el('article', `vm-card vm-card-explicit${compact ? ' vm-card-compact' : ''}`);
  const { media, showPhoto } = mediaWell({}, '', { view: selected, placeholder: 'No image for this car yet' });
  const body = el('div', 'vm-card-body');
  const head = el('div', 'vm-card-head');
  const name = el([2, 3, 4].includes(headingLevel) ? `h${headingLevel}` : 'h3', 'vm-card-name');
  const score = el('span', 'vm-score');
  head.append(name, score);
  const terms = el('div', 'vm-card-terms');
  const facts = el('div', 'vm-card-facts');
  const decision = el('div', 'vm-card-decision');
  const actions = el('div', 'vm-card-actions');
  const picker = el('div', 'vm-pick');
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-label', 'Exact cars');
  body.append(head, terms, facts, decision, picker, actions);
  card.append(media, body);
  function render() {
    card.dataset.memberId = selected.id;
    name.textContent = selected.display?.name || 'Car name not supplied';
    const exact = selected.decision;
    const eligible = exact?.gateStatus === 'eligible';
    card.dataset.gate = exact?.gateStatus || 'unknown';
    // scoreLabel (string, { text, title } or null) replaces the percentage badge; unset keeps it.
    const label = typeof scoreLabel === 'string' ? { text: scoreLabel } : scoreLabel;
    score.hidden = scoreLabel === undefined ? !showScore || !Number.isFinite(exact?.score) : !label?.text;
    score.textContent = score.hidden ? '' : label ? label.text : `${exact.score}%`;
    score.title = label?.title || 'Preference match score';
    showPhoto(selected.media?.src, { ...selected.display, ...selected.media });
    terms.replaceChildren(...(selected.terms?.length ? selected.terms : [{}]).map((term) => el('p', 'vm-specs', formatTerm(term))));
    facts.replaceChildren(factList((selected.facts || []).map((row) => ({ ...row, missingLabel: row.missingLabel || `Not supplied${row.unit ? ` (${row.unit})` : ''}` })), { className: factsClass }));
    decision.replaceChildren(el('p', 'vm-card-gate', gateLabels[exact?.gateStatus] || 'Decision not supplied'));
    for (const [key, label] of [['reasons', 'Why it suits you'], ['blockers', 'Why it is not eligible'], ['unknowns', 'Needs confirmation'], ['tradeOffs', 'Trade-offs']]) {
      if (!exact?.[key]?.length) continue;
      const list = el('ul', 'vm-reasons');
      exact[key].forEach((entry) => list.append(el('li', null, decisionText(entry))));
      decision.append(el('p', 'vm-why-label', key === 'reasons' && !eligible ? 'Checks passed' : label), list);
    }
    picker.querySelectorAll('button').forEach((node, i) => {
      const active = members[i] === selected;
      node.classList.toggle('is-on', active);
      node.setAttribute('aria-pressed', String(active));
    });
    actions.replaceChildren();
    for (const [index, action] of (selected.actions || []).entries()) {
      const gated = ['accept', 'reserve'].includes(action.kind) && !eligible;
      const disabled = gated || Boolean(action.disabled) || typeof onAction !== 'function';
      const reason = action.disabledReason || (gated ? 'An eligible exact decision is required.' : disabled ? 'This action is not available.' : '');
      const reasonId = `vm-card-action-${instance}-${index}`;
      const control = button({ label: action.label, variant: action.variant, disabled,
        describedBy: disabled ? reasonId : undefined,
        onClick: () => { if (!disabled) onAction(action, selected); } });
      control.dataset.actionId = action.id;
      actions.append(control);
      if (disabled) {
        const why = feedbackScope({ text: reason });
        why.id = reasonId;
        actions.append(why);
      }
      if (action.scope) actions.append(feedbackScope({ text: action.scope }));
    }
  }
  if (members.length > 1) members.forEach((member, i) => {
    const choice = button({ label: member.display?.pickerLabel || member.display?.name || `Option ${i + 1}`, variant: 'ghost', onClick: () => {
      selected = member;
      render();
      onListingSelect?.(member);
    } });
    choice.classList.add('vm-pick-opt');
    picker.append(choice);
  });
  picker.hidden = members.length < 2;
  render();
  return card;
}
