/*
 * Guess Who — the matcher as an elimination game.
 *
 * The fifth interchangeable interface "mode" (see ../modes/index.js and the
 * shell in ../vehicle-matcher.js), and the only one that is not a recommender.
 * Every other mode ASKS and then RANKS: the engine scores each car against the
 * answers, tolerates a miss, and hands back an ordered shortlist. This one
 * starts with the whole national pool on screen and takes cars AWAY. A filter
 * here is a hard yes/no — no compromise, no score, no "closest we've got".
 *
 * That difference is the whole design, and it drives three unusual choices:
 *
 *   1. IT DOES NOT USE THE ENGINE. Not /api/match, not /api/preview. It fetches
 *      the entire pool once (/api/pool, see apiPool) and filters in the browser.
 *      A soft scorer cannot express "no diesels" — it can only prefer petrol —
 *      so asking the engine for a hard filter would mean asking it to lie.
 *   2. ONE REQUEST, THEN NOTHING. The pool is 377 KB gzip for BMW's 12,084 cars
 *      (columns + dictionaries, see publicPool in server/index.js) and filtering
 *      it is 0.035 ms for eight predicates, so there is no debounce, no
 *      pagination and no loading state after the first paint. Every drag of a
 *      slider re-filters the whole country synchronously.
 *   3. CARD SIZE IS A FUNCTION OF HOW MANY ARE LEFT. Twelve thousand cars only
 *      fit as dots; nine fit as cards you can read. So the board picks the
 *      largest card size whose grid still fits in ~1.9 screens and re-picks it
 *      after every filter — which is what makes the survivors "grow and reflow"
 *      rather than the page just getting shorter. See pickLayout and STAGES.
 *
 * The elimination itself is deliberately cheap: eliminated cards are given a
 * class that transitions ONLY transform and opacity (compositor-safe, so the
 * 12,000-node case never touches the main thread for the fade), and the
 * survivors' reflow is a FLIP — but never at dot stage, because a 12px card's
 * travel is imperceptible, FLIP costs 55 ms at that scale, and there can be
 * thousands of dots each taking a composited layer for it. Measured numbers
 * behind all of this are in docs/spikes/guess-who-render-spike.html.
 *
 * What it shares rather than reinvents: the cards (./result-card.js, with the
 * score badge suppressed because there is no score), the option/slider widgets
 * (./question-ui.js), the brand voice (./brand-copy.js) and the celebration
 * (./match-signal.js). It owns its copy (GUESS_WHO_COPY) and its board, and
 * nothing else.
 */

import {
  apiPool, apiGeocode, apiGetQuestions, apiField,
} from '../engine.js';
import { el, gbp, centreOnPage } from '../ui.js';
import { BRAND_COPY } from './brand-copy.js';
import {
  renderRangeSlider, renderOptionList, renderBudgetDrawer, formatRange, formatSliderValue, visibleQuestions,
} from './question-ui.js';
import {
  matchCard, SPEC_LABELS, FUEL_SPEC, SWATCH_HEX, CONCEPT_LABELS, setRrmcAnswers, rrmcTaglines,
} from './result-card.js';
import { celebrate, cap } from './match-signal.js';

/* ---------------------------- the size ladder ---------------------------- */

/*
 * The four densities a card can be drawn at, largest first, each with the range
 * of track widths it owns. The board picks a WIDTH (see pickLayout) and the
 * stage follows from it, rather than the other way round: size is the honest
 * driver, because what a card can usefully say depends on how big it is.
 *
 *   card — the shared .vm-card compact tile: photo, name, specs, paint, seller.
 *          "Similar to Podium but not as tall" — the compact tile, not the big
 *          one, so no blurb, no kit list, no reasons.
 *   tile — photo, model name, price. The smallest size a name is readable at.
 *   chip — photo only. Recognisable as a particular car, says nothing.
 *   dot  — a coloured block. At this size a photo is unreadable AND unaffordable
 *          (12,000 image requests), so the cell carries the one fact that still
 *          survives at 12px: the paint.
 *
 * `body` is the fixed height under the 16:10 photo, used by the fit maths.
 */
const MEDIA_RATIO = 10 / 16;
const STAGES = [
  { key: 'card', min: 236, max: 330, gap: 16, body: 188 },
  { key: 'tile', min: 128, max: 236, gap: 10, body: 54 },
  { key: 'chip', min: 44, max: 128, gap: 5, body: 0 },
  { key: 'dot', min: 9, max: 44, gap: 3, body: 0 },
];

/** Smallest track we will ever draw. Below this the board is a texture, not a
 *  set of cars, and the count in the bar is doing all the work anyway. */
const MIN_TRACK = STAGES[STAGES.length - 1].min;

/*
 * How many viewport heights the board may run to.
 *
 * The brief asks for every vehicle visible at once, and for BMW's 12,084 that is
 * only literally true at about 8px — a dot so small the board reads as noise.
 * Measured: 12px is 1.78 screens and still reads as individual cars, so ~1.9 is
 * the honest reading of "all of them on screen". MINI's 3,568 fits well inside
 * one screen at this budget, which matters — MINI asked for this mode.
 */
const SCREENS = 1.9;

/*
 * When the survivors' reflow is worth animating (FLIP).
 *
 * Not at dot stage, at any track width. A dot is 9–44px, so it moves a few pixels
 * into its new slot and nobody sees it — but there can be twelve thousand of them,
 * and every one that moves takes an inline transform transition, which is a
 * composited layer. Measured 55 ms of scripting at 12px for movement no-one can
 * perceive, and BMW's electric-only cut lands at 1,953 dots, which is 1,953 layers
 * for the same nothing. Above dot stage the movement is the whole point.
 *
 * FLIP_MAX_CELLS is the belt-and-braces half: chip stage tops out under a thousand
 * cells on a 1440×900 screen and animates comfortably, but a very large display
 * could put several thousand in the same stage, and past a point the honest trade
 * is a still frame over a janky slide.
 */
const FLIP_MAX_CELLS = 2000;

/* ------------------------------- timings ------------------------------- */

/** How long an eliminated card takes to leave. Transform + opacity only. */
const EXIT_MS = 380;
/** How long the survivors take to slide into their new slots (FLIP). */
const FLIP_MS = 320;
/** How long the headline count takes to tick down to its new value. */
const COUNT_MS = 420;
/** How long the win burst needs before its layer can be binned: the 1.5s fall in
 *  vm-mingle-fall plus the 0.45s stagger celebrate() spreads it over, rounded up. */
const CONFETTI_MS = 2400;
/** Popover width (for the viewport clamp only — the real width is the CSS's). */
const POP_WIDTH = 300;
const POP_MARGIN = 8;

/* ------------------------------- the axes ------------------------------- */

/** Price slider granularity, and therefore the granularity a price rejection
 *  can cap at. £500 is fine enough to be useful and coarse enough to read. */
const PRICE_STEP = 500;

/** How many steps back the undo button can walk. Deep enough to unpick a run of
 *  rejections, shallow enough that "start again" is the honest answer beyond it. */
const HISTORY_MAX = 24;

/*
 * Mileage as bands rather than a max slider, because the brief asks for it
 * multi-pick. Multi-pick means a buyer can take "under 10,000" and "40–60,000"
 * together, which a single cap cannot express — that is a real search ("nearly
 * new, or old enough to be cheap") and this is the only control that allows it.
 * Only bands the pool actually contains are offered.
 */
const MILEAGE_BANDS = [
  { id: 'm0', lo: 0, hi: 10000 },
  { id: 'm10', lo: 10000, hi: 20000 },
  { id: 'm20', lo: 20000, hi: 40000 },
  { id: 'm40', lo: 40000, hi: 60000 },
  { id: 'm60', lo: 60000, hi: Infinity },
];

/*
 * How far the buyer will travel. Single-pick, not multi: "within 50 miles" is a
 * nested set, so ticking 25 as well as 50 would say nothing that 50 doesn't
 * already say, and a control whose options can't disagree with each other is a
 * radio group wearing checkboxes.
 *
 * 25 is the preselected one because it is the only figure here that is a normal
 * thing to do on a Saturday; 200 exists so a rare car is still findable, which
 * for Ferrari (fifteen sites in the country) is the difference between a filter
 * and a dead end.
 */
const RADIUS_BANDS = [10, 25, 50, 100, 200];
const DEFAULT_RADIUS = 25;

/*
 * Great-circle miles between two points.
 *
 * Haversine rather than a flat approximation: over Great Britain the error of
 * treating degrees as a plane reaches several miles north to south, which on a
 * ten-mile band is the difference between a dealer being in and out. It runs once
 * per RETAILER (about 130 of them, see the place axis) rather than once per car,
 * so its cost is irrelevant and its accuracy is not.
 */
const EARTH_MILES = 3958.8;
const toRad = Math.PI / 180;
function milesBetween(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.sqrt(a));
}

const miles = (n) => n.toLocaleString('en-GB');
const bandLabel = (b) => {
  if (b.lo === 0) return `Under ${miles(b.hi)}`;
  if (b.hi === Infinity) return `${miles(b.lo)}+`;
  return `${miles(b.lo)}–${miles(b.hi)}`;
};
/** Which band a mileage falls in, or -1 for none (missing figure). */
const bandOf = (m) => (m < 0 ? -1 : MILEAGE_BANDS.findIndex((b) => m >= b.lo && m < b.hi));

/**
 * An age cap as a noun phrase that fits "No older than …".
 *
 * The chips can say "12 yrs" because they are a two-word readout under a label;
 * a menu line is a sentence and has to read like one, which means spelling
 * "years" out, saying "1 year" rather than "1 yrs", and having something
 * sensible for a cap of zero — turning down a one-year-old car leaves only
 * this year's, and "no older than 0 yrs" is not how anyone says that.
 */
const ageCapPhrase = (years) => {
  if (years <= 0) return 'this year’s';
  return years === 1 ? '1 year' : `${years} years`;
};

/*
 * An option label as it reads mid-sentence, article included: "an estate",
 * "a hatchback", "an SUV".
 *
 * Both halves of that are things the label on its own can't give us. Lowercasing
 * everything produces "not a suv", which no retailer would print, so an acronym
 * keeps its case. And the article has to agree with whichever form we end up
 * with — "a estate" and "a SUV" are both wrong — which is why the "a" lives here
 * instead of in the six brand copy tables. For an acronym that means agreeing
 * with the spoken letter rather than the written one: A, E, F, H, I, L, M, N, O,
 * R, S and X are the letters whose names begin with a vowel sound, which is what
 * makes it "an SUV" but "a GT".
 */
const withArticle = (label) => {
  const acronym = label === label.toUpperCase();
  const word = acronym ? label : label.toLowerCase();
  const vowelish = acronym ? /^[aefhilmnorsx]/i : /^[aeiou]/i;
  return `${vowelish.test(word) ? 'an' : 'a'} ${word}`;
};

/* -------------------------------- copy -------------------------------- */

/*
 * The filter names. One shared table, not six brand copies, because these are
 * nouns for facts about a car rather than voice — "Fuel" is "Fuel" in every
 * register. Per-brand overrides only where the axis itself differs, exactly as
 * podium.js does with Q_LABELS / Q_LABELS_BY_BRAND.
 */
const FILTER_LABELS = {
  price: 'Price',
  fuel: 'Fuel',
  body: 'Body style',
  seats: 'Seats',
  features: 'Must have',
  mileage: 'Mileage',
  age: 'Age',
  colour: 'Colour',
  place: 'Distance',
  region: 'Region',
  handDrive: 'Drive side',
};
const FILTER_LABELS_BY_BRAND = {
  // A bike has no body style and no seat count worth filtering on; the shape
  // question is what kind of riding it is for.
  motorrad: { body: 'Bike style' },
  rrmc: { price: 'Price range', handDrive: 'Configuration' },
};
// RRMC's own body names, as its questions and tiles print them.
const BODY_LABELS_BY_BRAND = { rrmc: { convertible: 'Drophead' } };
// RRMC's chips follow the podium's question order, with the price range last as it is there.
const RRMC_AXIS_ORDER = [
  'body', 'fuel', 'region', 'handDrive', 'seats', 'mileage', 'age', 'colour', 'features', 'place', 'price',
];
// Under this many miles RRMC reads a car as new (result-card.js's NEGLIGIBLE_MILES).
const RRMC_NEGLIGIBLE_MILES = 50;
// Seats each `people` answer needs, as the engine's RRMC hard filter has it (brands.js RRMC_TUNING.hardFilter).
const RRMC_SEATS_FOR = { family: 4, crew: 4 };
// How many high-end suggestions sit under the opening questions.
const SUGGESTIONS = 6;
// The engine's widest scored slice (server FIELD_MAX), used to order level cars on the board.
const SCORE_SLICE = 16;

/*
 * A single-thumb slider (mileage) writing a NUMBER to answers[q.id]: a mirror of podium.js's private
 * renderValueSlider, same markup and the same immediate persistence of the start value.
 */
function renderValueSlider(list, q, answers, { onChange } = {}) {
  const stored = answers[q.id];
  const start = typeof stored === 'number'
    ? stored
    : (typeof q.default === 'number' ? q.default : q.min);
  answers[q.id] = start;

  const readout = el('output', 'vm-slider-value', formatSliderValue(start, q));
  const input = el('input', 'vm-slider-input');
  input.type = 'range';
  input.min = String(q.min);
  input.max = String(q.max);
  input.step = String(q.step);
  input.value = String(start);
  input.setAttribute('aria-label', q.title);
  input.setAttribute('aria-valuetext', formatSliderValue(start, q));

  input.addEventListener('input', () => {
    const value = Number(input.value);
    answers[q.id] = value;
    const text = formatSliderValue(value, q);
    readout.textContent = text;
    input.setAttribute('aria-valuetext', text);
    onChange?.();
  });

  const bounds = el('div', 'vm-slider-bounds');
  bounds.append(
    el('span', 'vm-slider-min', formatSliderValue(q.min, q)),
    el('span', 'vm-slider-max', formatSliderValue(q.max, q)),
  );

  list.append(readout, input, bounds);
}

/*
 * Display copy, keyed by brand with a `bmw` fallback (every read is
 * copyFor(brand)). Written out per brand rather than spread from a base, the
 * same as PODIUM_COPY / MINGLE_COPY / KNOCKOUT_COPY: this is the mode's own
 * campaign voice, and a brand whose register differs in one line usually
 * differs in five. Voices follow docs/tone-style-guide.md.
 *
 * Note what the copy must NOT do: it never says a car "nearly" fits, and it
 * never apologises for an empty board. A hard filter that finds nothing has
 * found something — that the stock does not contain what was asked for — and
 * saying so plainly is the whole value of the mode.
 */
const GUESS_WHO_COPY = {
  // MINI: the primary written voice. Uppercase-with-a-full-stop title, warm and
  // spirited underneath, never slangy.
  mini: {
    wordmark: 'MINI Guess Who',
    title: 'RULE THEM OUT.',
    startNote: ({ total }) => `Every one of the ${total} we’ve got. Start ruling them out.`,
    liveNote: ({ left, gone }) => `${gone} ruled out. ${left} still standing.`,
    oneNote: 'One left. That’s your MINI, then.',
    fewNote: ({ left }) => `Down to ${left}. Have a proper look.`,
    emptyTitle: 'THAT’S THE LOT RULED OUT.',
    emptyNote: 'Nothing we’ve got ticks every box at once. Give one of them back and we’ll fill the board again.',
    resetLabel: 'Start again',
    undoLabel: 'Undo the last one',
    prompts: {
      price: 'What are you happy to spend?',
      fuel: 'Which fuels are you after?',
      body: 'What shape were you after, then?',
      seats: 'How many seats do you need?',
      features: 'What must it have on it?',
      mileage: 'How many miles have you got in mind?',
      age: 'How old can it be?',
      colour: 'Which colours are you after?',
      place: 'Whereabouts are you, then?',
    },
    anySummary: 'Any',
    rejectLabel: 'Not this one',
    rejectPrompt: 'Go on then, what’s wrong with it?',
    reject: {
      price: ({ price }) => `Too dear at ${price}`,
      fuel: ({ fuel }) => `No ${fuel}, thanks`,
      body: ({ body }) => `Not ${body}`,
      colour: ({ shade }) => `Nothing in ${shade}`,
      mileage: ({ cap }) => `Under ${cap} miles only`,
      age: ({ years }) => `No older than ${years}`,
      place: ({ cap }) => `Nothing further than ${cap} miles away`,
      just: 'Just not feeling it',
    },
    postcode: {
      unknown: 'We don’t know that postcode. Have another look?',
      failed: 'Couldn’t check that just now. Give it another go.',
    },
    errKicker: 'Sorry',
    errTitle: 'We couldn’t reach the stock',
    errLede: 'The matching service didn’t respond. Check your connection and give it another go.',
    retryLabel: 'Try again',
  },
  // BMW: assured and understated, the approved-used register. States the fact,
  // doesn't dress it up.
  bmw: {
    wordmark: 'Guess Who',
    title: 'Rule them out.',
    startNote: ({ total }) => `All ${total} we hold. Narrow it down.`,
    liveNote: ({ left, gone }) => `${gone} ruled out. ${left} still in.`,
    oneNote: 'One left. That’s your car.',
    fewNote: ({ left }) => `Down to ${left}. Worth a closer look.`,
    emptyTitle: 'Nothing left.',
    emptyNote: 'No car we hold meets all of that at once. Relax one filter and the board fills back up.',
    resetLabel: 'Start again',
    undoLabel: 'Undo the last one',
    prompts: {
      price: 'What are you happy to spend?',
      fuel: 'Which fuel types suit you?',
      body: 'What shape were you after?',
      seats: 'How many seats do you need?',
      features: 'What must it have fitted?',
      mileage: 'How many miles, roughly?',
      age: 'How old can it be?',
      colour: 'Which colours suit you?',
      place: 'Where are you looking from?',
    },
    anySummary: 'Any',
    rejectLabel: 'Not this one',
    rejectPrompt: 'Why not this one?',
    reject: {
      price: ({ price }) => `Too expensive at ${price}`,
      fuel: ({ fuel }) => `No ${fuel}`,
      body: ({ body }) => `Not ${body}`,
      colour: ({ shade }) => `Nothing in ${shade}`,
      mileage: ({ cap }) => `Under ${cap} miles only`,
      age: ({ years }) => `No older than ${years}`,
      place: ({ cap }) => `Nothing further than ${cap} miles away`,
      just: 'Just not for me',
    },
    postcode: {
      unknown: 'We don’t recognise that postcode.',
      failed: 'We couldn’t check that just now. Try again in a moment.',
    },
    errKicker: 'Sorry',
    errTitle: 'We couldn’t reach the stock',
    errLede: 'The matching service didn’t respond. Check your connection and try again.',
    retryLabel: 'Try again',
  },
  // Honda: plain, warm and practical. Talks about fit and sense rather than
  // driving pleasure, and never oversells.
  honda: {
    wordmark: 'Guess Who',
    title: 'Rule them out.',
    startNote: ({ total }) => `All ${total} we have. Narrow it down.`,
    liveNote: ({ left, gone }) => `${gone} ruled out. ${left} still in.`,
    oneNote: 'One left. That’s the one.',
    fewNote: ({ left }) => `Down to ${left}. Have a proper look at these.`,
    emptyTitle: 'Nothing left.',
    emptyNote: 'Nothing we have does all of that at once. Ease one filter off and the board fills back up.',
    resetLabel: 'Start again',
    undoLabel: 'Undo the last one',
    prompts: {
      price: 'What are you happy to spend?',
      fuel: 'Which fuel types suit you?',
      body: 'What shape were you after?',
      seats: 'How many seats do you need?',
      features: 'What must it have fitted?',
      mileage: 'How many miles, roughly?',
      age: 'How old can it be?',
      colour: 'Which colours suit you?',
      place: 'Where are you looking from?',
    },
    anySummary: 'Any',
    rejectLabel: 'Not this one',
    rejectPrompt: 'Why not this one?',
    reject: {
      price: ({ price }) => `Too expensive at ${price}`,
      fuel: ({ fuel }) => `No ${fuel}`,
      body: ({ body }) => `Not ${body}`,
      colour: ({ shade }) => `Nothing in ${shade}`,
      mileage: ({ cap }) => `Under ${cap} miles only`,
      age: ({ years }) => `No older than ${years}`,
      place: ({ cap }) => `Nothing further than ${cap} miles away`,
      just: 'Just not for me',
    },
    postcode: {
      unknown: 'We don’t recognise that postcode.',
      failed: 'We couldn’t check that just now. Try again in a moment.',
    },
    errKicker: 'Sorry',
    errTitle: 'We couldn’t reach the stock',
    errLede: 'The service didn’t respond. Check your connection and try again.',
    retryLabel: 'Try again',
  },
  // Ford: friendly, confident and plainly British, with a little more spirit
  // than Honda's. Proud of being the sensible choice, happy to enjoy itself.
  ford: {
    wordmark: 'Guess Who',
    title: 'Rule them out.',
    startNote: ({ total }) => `The whole lot, all ${total} of them. Start narrowing.`,
    liveNote: ({ left, gone }) => `${gone} ruled out. ${left} still in.`,
    oneNote: 'One left. That’s your car, then.',
    fewNote: ({ left }) => `Down to ${left}. Have a good look.`,
    emptyTitle: 'That’s the lot ruled out.',
    emptyNote: 'Nothing we’ve got does all of that at once. Give one filter back and they’ll come flooding in.',
    resetLabel: 'Start again',
    undoLabel: 'Undo the last one',
    prompts: {
      price: 'What are you happy to spend?',
      fuel: 'Which fuel types suit you?',
      body: 'What shape were you after?',
      seats: 'How many seats do you need?',
      features: 'What must it have fitted?',
      mileage: 'How many miles, roughly?',
      age: 'How old can it be?',
      colour: 'Which colours suit you?',
      place: 'Where are you, then?',
    },
    anySummary: 'Any',
    rejectLabel: 'Not this one',
    rejectPrompt: 'Why not this one?',
    reject: {
      price: ({ price }) => `Too dear at ${price}`,
      fuel: ({ fuel }) => `No ${fuel}`,
      body: ({ body }) => `Not ${body}`,
      colour: ({ shade }) => `Nothing in ${shade}`,
      mileage: ({ cap }) => `Under ${cap} miles only`,
      age: ({ years }) => `No older than ${years}`,
      place: ({ cap }) => `Nothing further than ${cap} miles away`,
      just: 'Just not for me',
    },
    postcode: {
      unknown: 'That postcode doesn’t look right to us. Have another go.',
      failed: 'Couldn’t check that just now. Give it another go.',
    },
    errKicker: 'Sorry',
    errTitle: 'We couldn’t reach the stock',
    errLede: 'The service didn’t respond. Check your connection and give it another go.',
    retryLabel: 'Try again',
  },
  // Motorrad: rider-first and technical. Every car word becomes a bike word.
  motorrad: {
    wordmark: 'Guess Who',
    title: 'Rule them out.',
    startNote: ({ total }) => `All ${total} bikes we hold. Narrow it down.`,
    liveNote: ({ left, gone }) => `${gone} ruled out. ${left} still in.`,
    oneNote: 'One left. That’s your bike.',
    fewNote: ({ left }) => `Down to ${left}. Worth a closer look.`,
    emptyTitle: 'Nothing left.',
    emptyNote: 'No bike we hold meets all of that at once. Relax one filter and the board fills back up.',
    resetLabel: 'Start again',
    undoLabel: 'Undo the last one',
    prompts: {
      price: 'What are you happy to spend?',
      fuel: 'Which fuel types suit you?',
      body: 'What kind of riding is it for?',
      seats: 'How many seats do you need?',
      features: 'What must it have fitted?',
      mileage: 'How many miles, roughly?',
      age: 'How old can it be?',
      colour: 'Which colours suit you?',
      place: 'Where are you riding from?',
    },
    anySummary: 'Any',
    rejectLabel: 'Not this one',
    rejectPrompt: 'Why not this one?',
    reject: {
      price: ({ price }) => `Too expensive at ${price}`,
      fuel: ({ fuel }) => `No ${fuel}`,
      body: ({ body }) => `Not ${body}`,
      colour: ({ shade }) => `Nothing in ${shade}`,
      mileage: ({ cap }) => `Under ${cap} miles only`,
      age: ({ years }) => `No older than ${years}`,
      place: ({ cap }) => `Nothing further than ${cap} miles away`,
      just: 'Just not for me',
    },
    postcode: {
      unknown: 'We don’t recognise that postcode.',
      failed: 'We couldn’t check that just now. Try again in a moment.',
    },
    errKicker: 'Sorry',
    errTitle: 'We couldn’t reach the stock',
    errLede: 'The service didn’t respond. Check your connection and try again.',
    retryLabel: 'Try again',
  },
  // Ferrari: warm, unhurried and heritage-proud. Never breathless, never loud.
  ferrari: {
    wordmark: 'Guess Who',
    title: 'Rule them out.',
    startNote: ({ total }) => `All ${total} we have. Narrow it down.`,
    liveNote: ({ left, gone }) => `${gone} set aside. ${left} still in.`,
    oneNote: 'One left. That’s the car.',
    fewNote: ({ left }) => `Down to ${left}. Take your time with these.`,
    emptyTitle: 'Nothing left.',
    emptyNote: 'No car we have meets all of that at once. Open one filter up and the board fills again.',
    resetLabel: 'Start again',
    undoLabel: 'Undo the last one',
    prompts: {
      price: 'What are you happy to spend?',
      fuel: 'Which fuel types suit you?',
      body: 'Which shape were you after?',
      seats: 'How many seats do you need?',
      features: 'What must it have fitted?',
      mileage: 'How many miles, roughly?',
      age: 'How old can it be?',
      colour: 'Which colours suit you?',
      place: 'Where are you looking from?',
    },
    anySummary: 'Any',
    rejectLabel: 'Not this one',
    rejectPrompt: 'Why not this one?',
    reject: {
      price: ({ price }) => `Too much at ${price}`,
      fuel: ({ fuel }) => `No ${fuel}`,
      body: ({ body }) => `Not ${body}`,
      colour: ({ shade }) => `Nothing in ${shade}`,
      mileage: ({ cap }) => `Under ${cap} miles only`,
      age: ({ years }) => `No older than ${years}`,
      place: ({ cap }) => `Nothing further than ${cap} miles away`,
      just: 'Just not for me',
    },
    postcode: {
      unknown: 'We don’t recognise that postcode.',
      failed: 'We couldn’t check that just now. Please try again shortly.',
    },
    errKicker: 'Sorry',
    errTitle: 'We couldn’t reach the stock',
    errLede: 'The service didn’t respond. Please check your connection and try again.',
    retryLabel: 'Try again',
  },
  // RRMC: the podium's register. Unhurried and understated, it states rather than sells; no
  // wordmark (the podium shows none), and the count reads on into the title.
  rrmc: {
    wordmark: '',
    title: 'in our Provenance collection.',
    startNote: () => 'Set aside what does not suit you. What remains is yours to consider.',
    liveNote: ({ left, gone }) => `${gone} set aside. ${left} remain.`,
    oneNote: 'One remains. This is your Rolls-Royce.',
    fewNote: ({ left }) => `${left} remain. Take your time with these.`,
    emptyTitle: 'Nothing remains.',
    emptyNote: 'Nothing in the collection meets all of that at once. Relax one filter and the collection returns.',
    resetLabel: 'Begin again',
    undoLabel: 'Undo the last change',
    askCta: 'Show me the collection',
    tailHeading: 'Explore the full range of Rolls-Royce provenance',
    revisitLabel: 'Revisit my answers',
    prompts: {
      price: 'Is there an ideal price range?',
      fuel: 'How would you prefer to be powered?',
      body: 'Let your dreams take shape in the form of a...',
      seats: 'How many seats do you require?',
      features: 'What must it have fitted?',
      mileage: 'How far may it have travelled?',
      age: 'How recent should it be?',
      colour: 'Which colours appeal to you?',
      place: 'Where are you looking from?',
      region: 'Which regions shall we include?',
      handDrive: 'Which is your preferred driving configuration?',
    },
    anySummary: 'Any',
    rejectLabel: 'Not this one',
    rejectPrompt: 'Why not this one?',
    rejectKeep: 'Keep this one',
    reject: {
      price: ({ price }) => `Beyond my range at ${price}`,
      fuel: ({ fuel }) => `Not ${fuel}`,
      body: ({ label }) => `Not ${/^(SUV|[AEIOU])/i.test(label) ? 'an' : 'a'} ${label}`,
      colour: ({ shade }) => `Nothing in ${shade}`,
      mileage: ({ cap }) => `Under ${cap} miles only`,
      age: ({ years }) => `Nothing older than ${years}`,
      place: ({ cap }) => `Nothing further than ${cap} miles away`,
      region: ({ label }) => `Not held in ${label.replace(/^The /, 'the ')}`,
      handDrive: ({ label }) => `Not ${label}`,
      just: 'Just not for me',
    },
    postcode: {
      unknown: 'We do not recognise that postcode.',
      failed: 'We could not check that just now. Please try again shortly.',
    },
    errKicker: 'Sorry',
    errTitle: "We couldn't reach the collection",
    errLede: "The service didn't respond. Check your connection and try again.",
    retryLabel: 'Try again',
  },
};

const copyFor = (brand) => GUESS_WHO_COPY[brand] || GUESS_WHO_COPY.bmw;
const labelFor = (brand, key) => FILTER_LABELS_BY_BRAND[brand]?.[key] || FILTER_LABELS[key];

/* ---------------------------- pool decoding ---------------------------- */

/*
 * The wire pool, with the numeric columns re-cast into typed arrays.
 *
 * Not micro-optimisation: the filter loop touches eight columns for every one of
 * 12,000 cars on every pointer move, and a typed array both halves the read cost
 * and gives a sentinel-safe integer where JSON gave `null`. Missing values
 * become -1 throughout, and -1 never passes a filter that is actually narrowed —
 * which is the agreed rule for unknown data (see the colour decision: a car we
 * don't know the paint of is silently excluded from the colour filter, never
 * shown with a caveat).
 *
 * Strings stay in their dictionaries: only the handful of cards actually on
 * screen ever needs one.
 */
function decodePool(raw) {
  const int32 = (col) => Int32Array.from(col, (v) => (v == null ? -1 : v));
  const idx = (col) => Uint16Array.from(col);
  const moa = raw.moa || [];
  return {
    ...raw,
    price: int32(raw.price),
    // MOA (no published reading, RRMC) is an unknown mileage, never zero; nor is a year of 0 a year.
    mileage: Int32Array.from(raw.mileage, (v, i) => (v == null || moa[i] ? -1 : v)),
    year: Int32Array.from(raw.year, (v) => (v > 0 ? v : -1)),
    // RRMC-only columns, present only when the server sent them (see publicPool).
    ...(raw.poa && { poa: Uint8Array.from(raw.poa) }),
    ...(raw.handDrive && { handDrive: idx(raw.handDrive) }),
    ...(raw.region && { region: idx(raw.region) }),
    seats: int32(raw.seats),
    features: Int32Array.from(raw.features),
    body: idx(raw.body),
    fuel: idx(raw.fuel),
    shade: idx(raw.shade),
    // Not for its name — that's read once per visible card, from the dictionary.
    // This is the proximity axis's hot column: the distance is precomputed per
    // retailer, so the per-car test is this index into that little table.
    retailer: idx(raw.retailer),
  };
}

/** Min/max of a column, ignoring the -1 sentinel. Returns null when the column
 *  is entirely unknown, so a filter with no data behind it is never offered. */
function span(col) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < col.length; i += 1) {
    const v = col[i];
    if (v < 0) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo === Infinity ? null : [lo, hi];
}

/** Feature concept keys back out of a car's bitmask, for a card's kit list. */
const featuresOf = (pool, i) => pool.featureKeys.filter((_, bit) => pool.features[i] & (1 << bit));

/** A car's listing URL: shipped whole (RRMC) or as the brand's prefix plus the advert id. */
const linkOf = (pool, i) => pool.links?.[i] || (pool.linkPrefix && pool.id[i] ? `${pool.linkPrefix}${pool.id[i]}` : null);

/**
 * A pool row as the `match` shape ./result-card.js expects, with no `score` (see showScore).
 * The pool is listing-level, so `listings` is only RRMC's "View Options", read live via `versions`.
 */
function matchAt(pool, i, big, versions = () => []) {
  const shade = pool.shades[pool.shade[i]];
  const paint = pool.paints[pool.paint[i]];
  const price = pool.price[i] < 0 ? null : pool.price[i];
  const photo = pool.photo[i];
  return {
    reasons: [],
    get listings() { return versions(i); },
    car: {
      id: pool.id[i],
      name: pool.names[pool.name[i]],
      line: pool.lines[pool.line[i]],
      body: pool.bodies[pool.body[i]],
      fuel: pool.fuels[pool.fuel[i]],
      transmission: pool.transmissions[pool.transmission[i]],
      retailerName: pool.retailers[pool.retailer[i]],
      retailerUrl: pool.retailerUrls?.[pool.retailer[i]] || undefined,
      colour: shade ? { colour: shade, manufacturerColour: paint || shade } : null,
      priceMin: price,
      priceMax: price,
      listingCount: 1,
      mileage: pool.mileage[i] < 0 ? null : pool.mileage[i],
      moa: Boolean(pool.moa?.[i]),
      // RRMC's cards and "Why this one?" read these; POA keeps the server's placeholder price off screen.
      year: pool.year[i] > 0 ? pool.year[i] : undefined,
      poa: pool.poa?.[i] === 1 || undefined,
      handDrive: pool.handDrives?.[pool.handDrive?.[i]] || undefined,
      region: pool.regions?.[pool.region?.[i]] || undefined,
      plate: pool.plate[i],
      seats: pool.seats[i] < 0 ? null : pool.seats[i],
      boot: pool.boot[i],
      zeroTo62: pool.zeroTo62[i],
      mpg: pool.mpg[i],
      features: featuresOf(pool, i),
      // Thumbnails are all the wire carries (see thumbnail() in
      // server/index.js). A card-sized card deserves the bigger variant, so it
      // is reconstructed here rather than sent for all 12,000.
      photo: big ? fullPhoto(photo) : photo,
      link: linkOf(pool, i),
    },
  };
}

/** The larger variant of a thumbnail URL, for cards big enough to need one.
 *  Exactly reverses server/index.js's thumbnail(); an unrecognised host is left
 *  alone rather than guessed at. */
function fullPhoto(url) {
  if (!url) return null;
  if (url.includes('autosonshow')) return url.replace('_sm.jpg', '_md.jpg');
  return url.replace('/w160/', '/w480/');
}

/* ------------------------------ fit maths ------------------------------ */

const stageFor = (track) => STAGES.find((s) => track >= s.min && track < s.max)
  || (track >= STAGES[0].max ? STAGES[0] : STAGES[STAGES.length - 1]);

/**
 * The grid `count` cards make at a given track width, and the total height of it.
 *
 * The column count is computed the way CSS grid's
 * `repeat(auto-fill, minmax(track, 1fr))` computes it, and the height uses the
 * RESULTING cell width rather than the track, because auto-fill hands the
 * leftover pixels back to the columns and a wider cell is a taller one.
 */
function measureLayout(count, width, track) {
  const stage = stageFor(track);
  const cols = Math.max(1, Math.floor((width + stage.gap) / (track + stage.gap)));
  const cell = (width - (cols - 1) * stage.gap) / cols;
  const rows = Math.ceil(count / cols);
  const cellH = cell * MEDIA_RATIO + stage.body;
  return {
    total: rows * (cellH + stage.gap),
    layout: {
      stage: stage.key, track, gap: stage.gap, cellH,
    },
  };
}

/**
 * The largest card size at which `count` cards still fit the height budget.
 *
 * Walks widths down from the biggest card to the smallest dot and takes the first
 * that fits, which makes the survivors grow as the board empties without any
 * explicit "if fewer than N" rules.
 *
 * With one correction, because the ladder is not continuous. A tile carries a
 * 54px caption and a chip carries none, so stepping from the smallest tile to the
 * largest chip cuts the grid's height by nearly half in a single 2px step of
 * track. A count that just misses the tile budget therefore falls all the way to
 * photo-only chips and uses barely half the room it was given: measured on a
 * 1440x720 viewport, 58 survivors landed on 126px chips totalling 588px against a
 * 1,113px budget, when 139px captioned tiles would have wanted 1,208px. "Grow and
 * reorganise to fill the screen space" is the brief, and 47% of the budget unused
 * is not that. So a miss in a HIGHER stage than the winner is preferred when it is
 * within OVERSHOOT — the tolerance is deliberately confined to that case, because
 * within a single stage the ladder is smooth and the budget means what it says.
 */
const OVERSHOOT = 1.25;

function pickLayout(count, width, height) {
  const budget = Math.max(240, height) * SCREENS;
  let miss = null; // the closest layout that did NOT fit — always one step bigger
  for (let track = STAGES[0].max; track >= MIN_TRACK; track -= 2) {
    const m = measureLayout(count, width, track);
    if (m.total <= budget) {
      if (miss && miss.layout.stage !== m.layout.stage && miss.total <= budget * OVERSHOOT) {
        return miss.layout;
      }
      return m.layout;
    }
    miss = m;
  }
  const last = STAGES[STAGES.length - 1];
  return {
    stage: last.key, track: MIN_TRACK, gap: last.gap, cellH: MIN_TRACK * MEDIA_RATIO,
  };
}

/* ------------------------------- helpers ------------------------------- */

/** Focusable controls inside an open popover, for the Tab cycle. */
function focusablesIn(host) {
  return [...host.querySelectorAll('button, input, a[href], [tabindex]:not([tabindex="-1"])')]
    .filter((node) => !node.disabled && !node.closest('[hidden]'));
}

/** The hex for a normalised paint name, or null. Same table the cards use. */
const hexOf = (shade) => SWATCH_HEX[(shade || '').toLowerCase()] || null;

/*
 * The fill for a dot-stage cell whose paint we don't know yet.
 *
 * A wall of twelve thousand identical greys reads as one rectangle rather than
 * as the stock, so each cell gets a small stable offset — five steps mixed off
 * --vm-line, which keeps it on the brand's own tokens instead of hard-coding
 * greys that would be wrong for six themes. TEXTURE, NOT INFORMATION: it says
 * nothing about the car, and the moment a real paint is known (see paintCell)
 * that colour replaces it.
 *
 * A background colour rather than a `filter: brightness()`, which is what this
 * was first written as: a filter makes every cell a stacking context, and 12,000
 * of them is 12,000 composited layers for a decorative effect.
 */
const blankTint = (i) => {
  const step = ((i * 2654435761) >>> 0) % 5;
  return `color-mix(in srgb, var(--vm-line) ${84 + step * 4}%, var(--vm-surface-dark))`;
};

/* ------------------------------- mount ------------------------------- */

// Each mount's id, so a stale async boot can tell a newer guess-who mount from its own.
let mountSeq = 0;

function mount(root, ctx) {
  const copy = copyFor(ctx.brand);
  const rrmc = ctx.brand === 'rrmc';
  // The shell swaps modes in place, so a late boot must not act on a stage another mode (or a newer
  // guess-who mount) now owns. A locked page has no switcher and is always this mode.
  mountSeq += 1;
  const mountId = String(mountSeq);
  root.dataset.vmGwMount = mountId;
  const stillMounted = () => {
    const select = root.previousElementSibling?.querySelector?.('.vm-switcher-select');
    return root.dataset.vmGwMount === mountId && (!select || select.value === 'guess-who');
  };
  // Guess-who filters rather than asks, so "Why this one?" mustn't phrase against another mode's answers.
  setRrmcAnswers({});
  const brandCopy = BRAND_COPY[ctx.brand] || BRAND_COPY.bmw;
  const reducedMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Per-run state — a fresh local object, NOT hung on the shared ctx, so a mode
  // swap and re-mount (the switcher re-calls mount with the same ctx) starts
  // clean. Nothing here is allowed to outlive this mount.
  const state = {
    pool: null, // the decoded columnar pool
    filters: {}, // the answers object every widget writes into
    axes: [], // the filters this pool actually has data for
    out: new Set(), // car indices turned down individually ("just not this one")
    history: [], // snapshots for undo — one per filter change
    shown: 0, // the count currently painted in the bar (for the tick-down)
    keep: [], // survivor indices, newest first paint
    layout: null, // { stage, track, gap, cellH }
    pop: null, // { trigger, axis }
    won: false, // the "one left" celebration has fired
    exitTimer: 0,
    countGen: 0,
    resizeTimer: 0,
    questions: [], // RRMC: the podium's question set, asked before the board opens
    answers: {}, // RRMC: the brief those questions write
    rank: null, // RRMC: pool index -> engine score for the answers, ordering level cars
  };

  // One DOM node per car, created once and re-painted in place when the stage
  // changes. Node identity is stable for the whole run, which is what lets the
  // reconcile below be an ordered insert-if-different pass and lets FLIP measure
  // the same elements before and after.
  let nodes = [];
  let nodeStage = [];

  // Live DOM, assigned by buildStage().
  let shell = null;
  let barEl = null;
  let countEl = null;
  let noteEl = null;
  let chipsEl = null;
  let board = null;
  let emptyEl = null;
  let undoBtn = null;
  let pop = null;
  let popTitle = null;
  let popBody = null;
  let progressBar = null;
  let askEl = null;
  let askList = null;
  let askCta = null;
  let askTail = null;
  let askTailGrid = null;
  const askBlocks = new Map();

  /* ------------------------- RRMC's podium look ------------------------- */

  // "<year> <Model>", without the marque, as matchCard names RRMC's tiles; other brands keep the feed's name.
  const nameOf = (i) => {
    const name = state.pool.names[state.pool.name[i]];
    if (!rrmc) return name;
    const base = name.replace(/^Rolls-Royce\s+/i, '');
    return state.pool.year[i] > 0 ? `${state.pool.year[i]} ${base}` : base;
  };

  // RRMC's "N Miles – Fuel" line, worded exactly as matchCard's (rrmcMileageText isn't exported).
  const rrmcLineOf = (i) => {
    const p = state.pool;
    const m = p.mileage[i];
    let wear = `${miles(m)} Miles`;
    if (p.moa?.[i]) wear = 'MOA';
    else if (m < RRMC_NEGLIGIBLE_MILES) wear = 'Mileage Negligible';
    return [wear, FUEL_SPEC[p.fuels[p.fuel[i]]]].filter(Boolean).join(' – ');
  };

  // "View Options": the cars in `source` that group with this one as groupListings does (line, body,
  // fuel, 0-62); on the board that's its survivors, so the panel offers only versions passing the filters.
  const versionsFrom = (source) => (i) => {
    const p = state.pool;
    return source()
      .filter((j) => j !== i && p.line[j] === p.line[i] && p.body[j] === p.body[i]
        && p.fuel[j] === p.fuel[i] && p.zeroTo62[j] === p.zeroTo62[i])
      .map((j) => ({
        id: p.id[j],
        photo: fullPhoto(p.photo[j]),
        link: linkOf(p, j),
        mileage: p.mileage[j] < 0 ? null : p.mileage[j],
        moa: Boolean(p.moa?.[j]),
        year: p.year[j] > 0 ? p.year[j] : undefined,
        retailerName: p.retailers[p.retailer[j]],
      }));
  };
  const versionsOf = versionsFrom(() => state.keep);

  // The podium's ✕ "Not this one" chip (its classes, so it reads identically); the label stays for screen readers.
  const asChip = (open) => {
    const icon = el('span', 'vm-podium-reject-icon', '✕');
    icon.setAttribute('aria-hidden', 'true');
    open.classList.add('vm-podium-reject');
    open.replaceChildren(icon, el('span', 'vm-podium-reject-label', copy.rejectLabel));
  };

  // The podium popover's "Keep this one": folds the reasons away and leaves the car on the board.
  const keepButton = (open, menu) => {
    const keep = el('button', 'vm-gw-reject-keep', copy.rejectKeep);
    keep.type = 'button';
    keep.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = true;
      open.setAttribute('aria-expanded', 'false');
      open.focus();
    });
    return keep;
  };

  // Lifts matchCard's reject block to the card's corner as the chip, as the RRMC questionnaire does.
  const liftReject = (card) => {
    const reject = card.querySelector(':scope > .vm-card-body > .vm-reject');
    if (!reject) return;
    const open = reject.querySelector('.vm-reject-open');
    const menu = reject.querySelector('.vm-reject-menu');
    asChip(open);
    menu.append(keepButton(open, menu));
    card.append(reject);
  };

  // "Why this one?" phrases against the filters, as the podium's phrases against its answers.
  const syncWhy = () => {
    if (!rrmc || !state.pool || !stillMounted()) return;
    const p = state.pool;
    const f = state.filters;
    // Every answer the brief holds, with the live filters taking over the facts they now set.
    const answers = { ...state.answers };
    const price = state.axes.find((a) => a.key === 'price');
    if (price?.narrowed()) Object.assign(answers, { budgetGate: 'yes', budget: f.price });
    if (f.fuel?.length) answers.fuel = f.fuel.map((at) => p.fuels[at]);
    if (f.region?.length) answers.regions = f.region.map((at) => p.regions[at]);
    if (f.handDrive?.length === 1) answers.handDrive = p.handDrives[f.handDrive[0]];
    setRrmcAnswers(answers, price?.q.openTop ? [{ id: 'budget', openTop: true, max: price.q.max }] : []);
  };

  /* ------------- RRMC: ask the podium's questions, then filter ------------- */

  // Answered = a value that would reach the engine (podium.js isAnswered); sliders persist on render.
  const isAnswered = (q) => {
    const v = state.answers[q.id];
    if (Array.isArray(v)) return v.length > 0;
    return v != null && v !== '';
  };
  // The budget is asked inside budgetGate's drawer, never as its own block (as in the podium).
  const askedQuestions = () => visibleQuestions(state.questions.filter((q) => q.id !== 'budget'), state.answers);

  const buildControl = (q, onChange) => {
    if (q.type === 'slider') {
      const list = el('div', 'vm-options vm-slider');
      if (q.range) renderRangeSlider(list, q, state.answers, { onChange });
      else renderValueSlider(list, q, state.answers, { onChange });
      return list;
    }
    return renderOptionList(q, state.answers, { onChange }).list;
  };

  // One question as a questionnaire screen (its classes, so the RRMC questionnaire rules apply), all on one page.
  const buildQuestion = (q) => {
    const block = el('div', 'vm-screen vm-gw-ask-q');
    block.dataset.qid = q.id;
    block.append(el('h2', 'vm-question', q.title));
    const budgetQ = q.id === 'budgetGate' && state.questions.find((x) => x.id === 'budget');
    const drawer = budgetQ && renderBudgetDrawer(budgetQ, state.answers, { onChange: syncAsk });
    const list = buildControl(q, () => {
      drawer?.sync();
      syncAsk();
    });
    // As the questionnaire: "A combination" is the odd fifth pill, centred beneath the two pairs.
    if (q.id === 'style') {
      const middle = list.querySelector(':scope > .vm-option[data-value="3"]');
      if (middle) list.append(middle);
    }
    block.append(list);
    if (drawer) block.append(drawer.drawer);
    return block;
  };

  // The podium tail's high-end strip under the questions: the dearest priced car of each model line,
  // taken from inside the price range once one is set.
  let tailFor = '';
  const paintSuggestions = () => {
    const p = state.pool;
    const a = state.answers;
    const price = axisFor('price');
    const band = a.budgetGate === 'yes' && Array.isArray(a.budget) ? a.budget : null;
    const top = band && price && band[1] >= price.q.max ? Infinity : band?.[1];
    const priced = [];
    for (let i = 0; i < p.n; i += 1) {
      if (p.poa?.[i] === 1 || !(p.price[i] > 0)) continue;
      if (band && (p.price[i] < band[0] || p.price[i] > top)) continue;
      priced.push(i);
    }
    priced.sort((x, y) => p.price[y] - p.price[x]);
    const lines = new Set();
    const picks = [];
    for (const i of priced) {
      if (picks.length === SUGGESTIONS) break;
      if (lines.has(p.line[i])) continue;
      lines.add(p.line[i]);
      picks.push(i);
    }
    // A slider drag fires this on every move; only a different set is repainted.
    const key = picks.join(',');
    if (key === tailFor) return;
    tailFor = key;
    const all = () => Array.from({ length: p.n }, (_, i) => i);
    askTailGrid.replaceChildren(...picks.map((i) => matchCard(
      matchAt(p, i, true, versionsFrom(all)), { compact: true, brand: ctx.brand },
    )));
    askTail.hidden = !picks.length;
  };

  // Splice the visible blocks in place (as podium.js syncQuestions); the CTA waits for every answer.
  function syncAsk() {
    const visible = askedQuestions();
    const wanted = new Set(visible.map((q) => q.id));
    askBlocks.forEach((node, id) => {
      if (wanted.has(id)) return;
      node.remove();
      askBlocks.delete(id);
    });
    visible.forEach((q, i) => {
      if (!askBlocks.has(q.id)) askBlocks.set(q.id, buildQuestion(q));
      const node = askBlocks.get(q.id);
      if (askList.children[i] !== node) askList.insertBefore(node, askList.children[i] || null);
    });
    paintSuggestions();
    const done = visible.filter(isAnswered).length;
    askCta.disabled = done < visible.length;
    if (progressBar) progressBar.style.width = `${Math.round((done / (visible.length || 1)) * 100)}%`;
  }

  const buildAsk = () => {
    askEl = el('section', 'vm-gw-ask');
    askList = el('div', 'vm-gw-ask-questions');
    askCta = el('button', 'vm-btn vm-btn-primary vm-gw-ask-cta', copy.askCta);
    askCta.type = 'button';
    askCta.addEventListener('click', confirmAsk);
    const pane = el('div', 'vm-gw-ask-pane');
    pane.append(askList, askCta);
    askTail = el('div', 'vm-podium-tail');
    askTailGrid = el('div', 'vm-podium-tail-grid');
    askTail.append(el('h3', 'vm-subhead vm-podium-tail-head', copy.tailHeading), askTailGrid);
    // Wider than the question column and centred on the page, with equal space either side.
    centreOnPage(askTail);
    askEl.append(...rrmcTaglines(), pane, askTail);
  };

  const showAsk = () => {
    if (!askEl) buildAsk();
    syncAsk();
    if (shell) {
      closePop();
      shell.hidden = true;
      root.append(askEl);
      askList.querySelector('button')?.focus();
    } else {
      root.replaceChildren(askEl);
    }
  };

  // Answers that are car facts preset their filters; "any" or no preference leaves a filter open.
  const presetFromAnswers = () => {
    const a = state.answers;
    const f = state.filters;
    const setFrom = (key, allowed) => {
      const axis = axisFor(key);
      if (!axis) return;
      const at = axis.q.options.filter((o) => allowed(o.raw ?? o.value)).map((o) => o.value);
      f[key] = at.length < axis.q.options.length ? at : [];
    };
    const want = (v) => (Array.isArray(v) ? v : (v != null ? [v] : [])).filter((x) => x !== 'any');
    const among = (v) => {
      const list = want(v);
      return list.length ? (raw) => list.includes(raw) : () => true;
    };
    setFrom('body', among(a.bodyStyles));
    setFrom('fuel', among(a.fuel));
    setFrom('region', among(a.regions));
    setFrom('handDrive', among(a.handDrive));
    setFrom('seats', (seats) => seats >= (RRMC_SEATS_FOR[a.people] || 0));
    const price = axisFor('price');
    if (price) {
      const { min, max } = price.q;
      const b = a.budgetGate === 'yes' && Array.isArray(a.budget) ? a.budget : null;
      f.price = b ? [Math.max(min, Math.min(b[0], max)), Math.min(max, Math.max(b[1], min))] : [min, max];
    }
  };

  // Orders the board's level cars by the engine's scores for the answers; a failed or late reply changes nothing.
  let scoreGen = 0;
  const fetchScores = async () => {
    scoreGen += 1;
    const gen = scoreGen;
    const matches = await apiField(ctx.api, { ...state.answers }, ctx.retailer, ctx.brand, ctx.scope, SCORE_SLICE);
    if (gen !== scoreGen || !stillMounted() || !matches.length) return;
    const at = new Map();
    state.pool.id.forEach((id, i) => at.set(id, i));
    const rank = new Map();
    matches.forEach((m) => {
      const i = at.get(m.car?.id);
      if (i != null && Number.isFinite(m.score)) rank.set(i, m.score);
    });
    state.rank = rank;
    if (shell && !shell.hidden) render();
  };

  // The board, built on first entry and shown again after a revisit.
  const openBoard = () => {
    if (shell) {
      askEl?.remove();
      shell.hidden = false;
      return;
    }
    buildStage();
    buildChips();
    firstPaint();
    trackHeader();
    // The retailer label is authored config; the mode names the pool it searched
    // in its own note only when the shell gave it one.
    if (ctx.retailerLabel && ctx.retailerLabel !== brandCopy.name) {
      shell.dataset.retailer = ctx.retailerLabel;
    }
  };

  function confirmAsk() {
    const first = !shell;
    bank();
    presetFromAnswers();
    openBoard();
    render({ animate: !first });
    fetchScores();
  }

  // The podium's rose-gold bar in the switcher row, filling here as cars are set aside.
  const mountProgress = () => {
    const switcher = root.previousElementSibling;
    if (!rrmc || !stillMounted() || !switcher?.classList.contains('vm-switcher')) return;
    // Only guess-who's own bar (vm-gw-progress) is ever replaced; podium's is never touched.
    switcher.querySelector(':scope > .vm-gw-progress')?.remove();
    const progress = el('div', 'vm-podium-progress vm-gw-progress');
    progressBar = el('div', 'vm-podium-progress-bar');
    progress.append(progressBar);
    switcher.prepend(progress);
    switcher.classList.add('has-progress');
    switcher.querySelector('.vm-switcher-select')?.addEventListener('change', () => {
      progress.remove();
      progressBar = null;
      // Another mode may already have put its own bar in the row.
      if (!switcher.querySelector(':scope > .vm-podium-progress')) switcher.classList.remove('has-progress');
    }, { once: true });
  };

  // The demo nav is fixed over the window's top edge: the sticky bar settles beneath it, not under it.
  let headerTracked = false;
  const trackHeader = () => {
    if (!rrmc || headerTracked) return;
    headerTracked = true;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (!shell?.isConnected) return;
      const hit = (document.elementsFromPoint?.((window.innerWidth || 0) / 2, 1) || [])
        .find((n) => !root.contains(n));
      let bottom = 0;
      for (let n = hit; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
        if (getComputedStyle(n).position === 'fixed') {
          bottom = Math.max(0, Math.round(n.getBoundingClientRect().bottom));
          break;
        }
      }
      shell.style.setProperty('--vm-gw-sticky-top', `${bottom}px`);
    };
    const onScroll = () => {
      if (!shell?.isConnected) {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        return;
      }
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    measure();
  };

  /* ---- error screen (the shared renderStatus pattern, as in podium.js) ---- */
  const showError = (onRetry) => {
    root.replaceChildren();
    const screen = el('div', 'vm-screen vm-status');
    screen.append(
      el('p', 'vm-kicker', copy.errKicker),
      el('h2', 'vm-title', copy.errTitle),
      el('p', 'vm-lede', copy.errLede),
    );
    const retry = el('button', 'vm-btn vm-btn-primary', copy.retryLabel);
    retry.type = 'button';
    retry.addEventListener('click', onRetry);
    screen.append(retry);
    root.append(screen);
  };

  /* ---------------------------- skeleton ---------------------------- *
   * Painted synchronously by mount() while the pool is in flight, so the shell
   * never awaits a cold backend and the stage is never blank. A grid of blank
   * cells rather than the usual lines, because that IS what is coming. */
  const renderSkeleton = () => {
    root.replaceChildren();
    const skel = el('div', 'vm-gw vm-gw-skeleton');
    skel.setAttribute('aria-busy', 'true');
    skel.setAttribute('aria-label', 'Loading');
    const bar = el('div', 'vm-gw-bar');
    bar.append(el('div', 'vm-skel vm-skel-line'));
    const grid = el('div', 'vm-gw-board');
    grid.style.setProperty('--vm-gw-track', '46px');
    grid.style.setProperty('--vm-gw-gap', '5px');
    for (let i = 0; i < 240; i += 1) grid.append(el('div', 'vm-gw-cell is-blank'));
    skel.append(bar, grid);
    root.append(skel);
  };

  /* ---------------------------- the axes ---------------------------- */

  /*
   * Which filters this pool can honestly offer, and the options behind each.
   *
   * Built from the data, never hardcoded: an axis whose column is entirely
   * unknown, or which has only one distinct value, is DROPPED rather than shown
   * empty. That is what silently handles colour before the enrichment pass has
   * run (the pool's shade dictionary is just [null], so there is no colour chip)
   * and what keeps Ferrari from being offered a seats filter when every car it
   * sells has two. The alternative — a visible control that cannot change
   * anything — teaches the user the tool is broken.
   *
   * `test(i)` is the hot predicate, rebuilt on every filter change from small
   * lookup structures so the inner loop is array reads and integer compares.
   */
  const buildAxes = () => {
    const pool = state.pool;
    const f = state.filters;
    const axes = [];

    /*
     * Price: a from/to range, opened to the full span of the stock so that the
     * board starts with everything on it — the brief's "start with max and min
     * price filters set", which is also what makes the opening claim true.
     *
     * Unlike every other axis this one's predicate is ALWAYS active rather than
     * dropping out when the range is at full width. Price is the one dimension
     * this mode is never "not filtering on", so an unpriceable car is excluded
     * from the first frame rather than appearing and then vanishing the moment
     * a thumb moves — and a card at card stage always has a price to print. It
     * costs nothing today: not one of the 12,099 BMW or 3,578 MINI listings is
     * missing a price.
     */
    const priceSpan = span(pool.price);
    // RRMC's own budget band (£60,000 to £1,000,000+), whose "+" top means no upper limit.
    const band = pool.priceRange;
    if (priceSpan) {
      const lo = band ? band.min : Math.floor(priceSpan[0] / PRICE_STEP) * PRICE_STEP;
      const hi = band ? band.max : Math.ceil(priceSpan[1] / PRICE_STEP) * PRICE_STEP;
      const q = {
        id: 'price', type: 'slider', range: true, min: lo, max: hi, step: band?.step || PRICE_STEP, format: 'gbp', thumbNoun: 'price', title: copy.prompts.price,
        ...(band && { minGap: band.minGap, plusAtMax: true, openTop: true }),
      };
      f.price = [lo, hi];
      axes.push({
        key: 'price',
        q,
        // The budget drawer brings its own frame, so the popover doesn't wrap it in one.
        bare: Boolean(band),
        narrowed: () => f.price[0] > lo || f.price[1] < hi,
        // Always the actual figures, never "Any": the range IS set from the
        // start, and printing "Any" over a live filter would misdescribe it.
        summary: () => (band ? formatRange(f.price, q) : `${gbp(f.price[0])} – ${gbp(f.price[1])}`),
        build: (host) => {
          if (!band) {
            renderRangeSlider(host, q, f, { onChange: filtersChanged });
            return;
          }
          // The podium's budget drawer, held open: "−" and "+" over the track and the "Current Range:" tile.
          const view = { budgetGate: 'yes', get price() { return f.price; }, set price(v) { f.price = v; } };
          host.append(renderBudgetDrawer(q, view, { onChange: filtersChanged }).drawer);
        },
        clear: () => { f.price = [lo, hi]; },
        test: () => {
          const [a, b] = f.price;
          if (!band) return (i) => pool.price[i] >= a && pool.price[i] <= b;
          // Open at both ends is every car. POA is a price on request, so only an open top admits it.
          if (a <= lo && b >= hi) return null;
          const floor = a <= lo ? 0 : a;
          const top = b >= hi ? Infinity : b;
          return (i) => (pool.poa?.[i] === 1
            ? top === Infinity
            : pool.price[i] >= floor && pool.price[i] <= top);
        },
      });
    }

    /*
     * Distance: "within N miles of my postcode".
     *
     * The one axis that needs a second fact the pool can't carry — where the
     * BUYER is — so it is also the only one that touches the network after the
     * first paint (apiGeocode, one request per postcode typed, cached server-side
     * for the life of the process). Everything else here is arithmetic on columns
     * already in memory.
     *
     * Two halves, and the axis only exists if it has both. The retailers' end
     * arrives as pool.sites, a lat/lon pair per entry of the `retailers`
     * dictionary rather than per car (see siteCoords in server/index.js) — that's
     * ~130 pairs instead of 12,000, and it means the distance is computed once per
     * DEALER and the per-car test is one array read. The buyer's end arrives when
     * they type. No postcode, no filter: the axis reads "Any" and lets everything
     * through, which is the honest state for a question nobody has answered.
     *
     * Self-suppressing, exactly as colour is: fewer than two located sites and the
     * chip never appears. That is not a hypothetical — a pool built from a stock
     * cache written before dealer_number was mapped has no coordinates at all, and
     * a "Distance" chip that silently empties the board would be worse than no
     * chip. Two, not one, because with a single located site the control can only
     * say "that one" or "nothing", and neither is a distance.
     */
    const sites = pool.sites || {};
    const siteLat = sites.lat || [];
    const siteLon = sites.lon || [];
    const located = siteLat.reduce((n, v, at) => (v != null && siteLon[at] != null ? n + 1 : n), 0);
    if (located > 1) {
      // Miles from the buyer to every retailer, memoised on the postcode. Rebuilt
      // only when the origin moves, not on every filter change: `test()` is called
      // for each axis on each render, and a postcode is typed once per session.
      let distFor = null;
      let distCache = null;
      const distances = (origin) => {
        if (distFor === origin.postcode) return distCache;
        const out = new Float64Array(pool.retailers.length);
        for (let at = 0; at < out.length; at += 1) {
          const lat = siteLat[at];
          const lon = siteLon[at];
          // Infinity, not a skip: an unlocated dealer's cars are excluded the
          // moment a distance is asked for, because Infinity fails every cap. Same
          // rule as every other unknown value here (see decodePool).
          out[at] = (lat == null || lon == null)
            ? Infinity
            : milesBetween(origin.latitude, origin.longitude, lat, lon);
        }
        distFor = origin.postcode;
        distCache = out;
        return out;
      };

      const q = {
        id: 'radius',
        title: copy.prompts.place,
        options: RADIUS_BANDS.map((m) => ({ value: m, label: `${miles(m)} miles` })),
      };
      f.origin = null;
      f.radius = DEFAULT_RADIUS;
      axes.push({
        key: 'place',
        q,
        narrowed: () => !!f.origin,
        // The radius alone is never "narrowed" and never shown: 25 miles of
        // nowhere is not a filter, and printing it would claim one is running.
        summary: () => (f.origin ? `${f.radius} miles of ${f.origin.postcode}` : copy.anySummary),
        build: (host) => buildPlaceControl(host, q),
        clear: () => { f.origin = null; f.radius = DEFAULT_RADIUS; },
        /** This car's distance from the buyer, for the "too far" rejection.
         *  Infinity when we can't say — no origin, or an unlocated dealer. */
        milesTo: (i) => (f.origin ? distances(f.origin)[pool.retailer[i]] : Infinity),
        test: () => {
          if (!f.origin) return null;
          const dist = distances(f.origin);
          const cap = f.radius;
          return (i) => dist[pool.retailer[i]] <= cap;
        },
      });
    }

    /* --- age: from/to in years, because "age" is what was asked for --- */
    const yearSpan = span(pool.year);
    const nowYear = new Date().getFullYear();
    if (yearSpan && yearSpan[0] !== yearSpan[1]) {
      const maxAge = Math.max(1, nowYear - yearSpan[0]);
      const q = {
        id: 'age', type: 'slider', range: true, min: 0, max: maxAge, step: 1, unit: ' yrs', thumbNoun: 'age', title: copy.prompts.age,
      };
      f.age = [0, maxAge];
      axes.push({
        key: 'age',
        q,
        narrowed: () => f.age[0] > 0 || f.age[1] < maxAge,
        // "0 yrs" is a real state (reject a one-year-old car and the cap lands
        // there), and it means "this year's plate only" — so it gets said that
        // way rather than as a number a chip can't explain.
        summary: () => {
          const [a, b] = f.age;
          if (b === 0) return 'This year only';
          const upper = b === 1 ? '1 yr' : `${b} yrs`;
          return a === 0 ? `Up to ${upper}` : `${a}–${b} yrs`;
        },
        build: (host) => renderRangeSlider(host, q, f, { onChange: filtersChanged }),
        clear: () => { f.age = [0, maxAge]; },
        test: () => {
          const [a, b] = f.age;
          if (a <= 0 && b >= maxAge) return null;
          // Age band → registration-year band. Inclusive both ends.
          const yHi = nowYear - a;
          const yLo = nowYear - b;
          return (i) => pool.year[i] >= yLo && pool.year[i] <= yHi;
        },
      });
    }

    /** A multi-pick's chip text: what is ticked, or "Any" while nothing is. */
    const ticked = (options, chosen, labelOf = (o) => o.label) => (chosen.length
      ? options.filter((o) => chosen.includes(o.value)).map(labelOf).join(', ')
      : copy.anySummary);

    /* --- the dictionary multi-picks: fuel, body, colour --- */
    const dictAxis = (key, dict, column, labels, swatches, order) => {
      // Only values this pool actually holds, and never the null slot: a car we
      // hold no value for is excluded once the axis is in use, not offered as
      // "unknown" (see decodePool).
      const options = dict
        .map((value, at) => ({ value: at, label: labels(value), raw: value }))
        .filter((o) => o.raw && o.label);
      if (options.length < 2) return;
      if (swatches) options.forEach((o) => { o.swatch = hexOf(o.raw); });
      // `order` keeps a question's own option order (RRMC's regions), else alphabetical.
      if (order) options.sort((a, b) => order.indexOf(a.raw) - order.indexOf(b.raw));
      else options.sort((a, b) => a.label.localeCompare(b.label));
      const q = {
        id: key, multi: true, options, title: copy.prompts[key] || labelFor(ctx.brand, key),
      };
      f[key] = [];
      axes.push({
        key,
        q,
        narrowed: () => f[key].length > 0,
        summary: () => ticked(options, f[key]),
        build: (host) => host.append(renderOptionList(q, f, { onChange: filtersChanged }).list),
        clear: () => { f[key] = []; },
        test: () => {
          if (!f[key].length) return null;
          // A lookup by dictionary index beats a Set of strings in the inner
          // loop, and the dictionaries are tiny.
          const allow = new Uint8Array(dict.length);
          f[key].forEach((at) => { allow[at] = 1; });
          return (i) => allow[column[i]] === 1;
        },
      });
    };
    dictAxis('fuel', pool.fuels, pool.fuel, (v) => FUEL_SPEC[v] || cap(v), false);
    dictAxis('body', pool.bodies, pool.body, (v) => BODY_LABELS_BY_BRAND[ctx.brand]?.[v] || SPEC_LABELS[v] || cap(v), false);
    dictAxis('colour', pool.shades, pool.shade, (v) => cap(v), true);
    // RRMC's region and drive-side questions, labelled as the server's questions label them.
    [['region', pool.regions], ['handDrive', pool.handDrives]].forEach(([key, dict]) => {
      const labels = pool.labels?.[key];
      if (dict && pool[key]) dictAxis(key, dict, pool[key], (v) => labels?.[v] || v, false, Object.keys(labels || {}));
    });

    /* --- seats: multi-pick over the counts the pool actually holds --- */
    const seatValues = [...new Set([...pool.seats].filter((v) => v > 0))].sort((a, b) => a - b);
    if (seatValues.length > 1) {
      const q = {
        id: 'seats',
        multi: true,
        title: copy.prompts.seats,
        options: seatValues.map((v) => ({ value: v, label: `${v} seats` })),
      };
      f.seats = [];
      axes.push({
        key: 'seats',
        q,
        narrowed: () => f.seats.length > 0,
        summary: () => ticked(q.options, f.seats, (o) => String(o.value)),
        build: (host) => host.append(renderOptionList(q, f, { onChange: filtersChanged }).list),
        clear: () => { f.seats = []; },
        test: () => {
          if (!f.seats.length) return null;
          const want = new Set(f.seats);
          return (i) => want.has(pool.seats[i]);
        },
      });
    }

    /* --- mileage: multi-pick bands (see MILEAGE_BANDS) --- */
    const bandsPresent = MILEAGE_BANDS.filter((b) => {
      for (let i = 0; i < pool.mileage.length; i += 1) {
        const m = pool.mileage[i];
        if (m >= 0 && m >= b.lo && m < b.hi) return true;
      }
      return false;
    });
    if (bandsPresent.length > 1) {
      const q = {
        id: 'mileage',
        multi: true,
        title: copy.prompts.mileage,
        options: bandsPresent.map((b) => ({ value: b.id, label: bandLabel(b) })),
      };
      f.mileage = [];
      axes.push({
        key: 'mileage',
        q,
        narrowed: () => f.mileage.length > 0,
        summary: () => ticked(q.options, f.mileage),
        build: (host) => host.append(renderOptionList(q, f, { onChange: filtersChanged }).list),
        clear: () => { f.mileage = []; },
        test: () => {
          if (!f.mileage.length) return null;
          const ranges = MILEAGE_BANDS.filter((b) => f.mileage.includes(b.id));
          return (i) => {
            const m = pool.mileage[i];
            if (m < 0) return false;
            return ranges.some((b) => m >= b.lo && m < b.hi);
          };
        },
      });
    }

    /* --- must-have features: multi-pick, tested as one bitmask compare --- */
    const featureOptions = pool.featureKeys
      .map((key, bit) => ({ value: bit, label: CONCEPT_LABELS[key] }))
      .filter((o) => o.label);
    if (featureOptions.length > 1) {
      featureOptions.sort((a, b) => a.label.localeCompare(b.label));
      const q = {
        id: 'features', multi: true, options: featureOptions, title: copy.prompts.features,
      };
      f.features = [];
      axes.push({
        key: 'features',
        q,
        narrowed: () => f.features.length > 0,
        summary: () => ticked(featureOptions, f.features),
        build: (host) => host.append(renderOptionList(q, f, { onChange: filtersChanged }).list),
        clear: () => { f.features = []; },
        test: () => {
          if (!f.features.length) return null;
          // MUST-have, so every requested bit has to be present: one AND and one
          // compare per car, whatever the buyer asked for.
          const want = f.features.reduce((mask, bit) => mask | (1 << bit), 0);
          return (i) => (pool.features[i] & want) === want;
        },
      });
    }

    if (rrmc) axes.sort((a, b) => RRMC_AXIS_ORDER.indexOf(a.key) - RRMC_AXIS_ORDER.indexOf(b.key));
    state.axes = axes;
  };

  /* ------------------------- the postcode box ------------------------- */

  /*
   * The distance popover's contents: where are you, then how far will you go.
   *
   * Built here rather than in ./question-ui.js because it is not a question
   * widget. Every control in there writes an answer straight into the answers
   * object and is done; this one has to ASK A SERVER whether what was typed is a
   * place at all, and has three outcomes to show for it — a coordinate, "there is
   * no such postcode", and "we couldn't check" — which is a shape no quiz
   * question has. Putting it in the shared file would mean giving every mode a
   * network dependency for the sake of one filter in one of them.
   *
   * "Postcode" and "Find" are hardcoded rather than per-brand, on the same
   * grounds as the popover's own "Done" button and the filter names above: they
   * name a control, they don't speak in a voice.
   */
  const buildPlaceControl = (host, q) => {
    const f = state.filters;
    const wrap = el('div', 'vm-gw-place');

    const row = el('div', 'vm-gw-place-row');
    const input = el('input', 'vm-gw-place-input');
    input.type = 'text';
    input.name = 'postcode';
    // A postcode-shaped keyboard on a phone, capitals as typed, and no
    // autocorrect improving "NG1" into a word.
    input.autocomplete = 'postal-code';
    input.autocapitalize = 'characters';
    input.spellcheck = false;
    input.maxLength = 8;
    input.placeholder = 'NG1 2AB';
    input.setAttribute('aria-label', 'Postcode');
    input.value = f.origin ? f.origin.postcode : '';
    const find = el('button', 'vm-gw-place-go', 'Find');
    find.type = 'button';
    row.append(input, find);

    const status = el('p', 'vm-gw-place-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const say = (message) => { status.textContent = message || ''; };

    /*
     * A lookup can land after its own popover has been closed, and that still has
     * to be ONE undo step. filtersChanged only banks while a popover is open (it
     * reads state.pop.before), so an orphaned answer banks its own point here.
     */
    const commit = (origin) => {
      if (!state.pop) bank();
      f.origin = origin;
      filtersChanged();
    };

    const resolve = async () => {
      const typed = input.value.trim();
      say('');
      // An empty box is the way back to "anywhere", and the only one: there is no
      // "any distance" option in the list, because a radius of infinity is not a
      // distance a buyer would ever pick, it's them changing their mind.
      if (!typed) {
        if (f.origin) commit(null);
        return;
      }
      // Already resolved and unchanged: pressing Find again is not a new question.
      if (f.origin && typed.toUpperCase() === f.origin.postcode.toUpperCase()) return;
      find.disabled = true;
      try {
        const place = await apiGeocode(ctx.api, typed);
        if (!place) { say(copy.postcode.unknown); return; }
        // The canonical spelling written back into the box IS the confirmation:
        // type "ng12ab", get "NG1 2AB", and the board thins out behind it. A
        // separate "found it" line would say the same thing twice.
        input.value = place.postcode;
        commit(place);
      } catch {
        // apiGeocode throws only for "we couldn't ask", which is not the buyer's
        // fault and isn't phrased as though it were. The pool is long since
        // loaded, so nothing else about the mode is affected.
        say(copy.postcode.failed);
      } finally {
        find.disabled = false;
      }
    };

    find.addEventListener('click', resolve);
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      // There is no form here so nothing would submit, but Enter is what a buyer
      // will press, and without this it does nothing whatsoever.
      e.preventDefault();
      resolve();
    });

    const radius = renderOptionList(q, f, { onChange: filtersChanged }).list;
    // Two controls under one dialog title, so the radiogroup names itself rather
    // than inheriting "Where are you looking from?" from the popover.
    radius.setAttribute('aria-label', labelFor(ctx.brand, 'place'));

    wrap.append(row, status, radius);
    host.append(wrap);
  };

  /* ---------------------------- filtering ---------------------------- */

  /** The survivors, as pool indices in pool order. Measured at 0.035 ms for
   *  eight predicates over 12,012 cars, which is why nothing here is debounced. */
  const survivors = () => {
    const tests = state.axes.map((a) => a.test()).filter(Boolean);
    const { out } = state;
    const keep = [];
    for (let i = 0; i < state.pool.n; i += 1) {
      if (out.has(i)) continue;
      let ok = true;
      for (let t = 0; t < tests.length; t += 1) {
        if (!tests[t](i)) { ok = false; break; }
      }
      if (ok) keep.push(i);
    }
    // RRMC: cars the engine scored for the answers lead, best first; the rest keep pool order (stable sort).
    const { rank } = state;
    if (rank?.size) keep.sort((a, b) => (rank.get(b) ?? -Infinity) - (rank.get(a) ?? -Infinity));
    return keep;
  };

  /* ------------------------------ the board ------------------------------ */

  /*
   * One cell, painted for the current stage.
   *
   * Called once per car at build (12,084 of them: ~70 ms, and the reason
   * `content-visibility: auto` is non-negotiable in the CSS — without it layout
   * alone is 512 ms) and again only when a survivor's stage changes. The node is
   * never recreated, so a card keeps its identity from dot to card and back.
   */
  const paintCell = (node, i, stageKey) => {
    const pool = state.pool;
    node.replaceChildren();
    node.className = `vm-gw-cell is-${stageKey}`;
    nodeStage[i] = stageKey;

    if (stageKey === 'dot') {
      // A photo is neither readable nor affordable at this size (12,000 image
      // requests), so the cell carries the one fact that survives at 12px: the
      // paint, once the enrichment pass has reached this car. Until then it gets
      // a neutral (see blankTint).
      node.style.setProperty('--vm-gw-tint', hexOf(pool.shades[pool.shade[i]]) || blankTint(i));
      return;
    }

    if (stageKey === 'chip') {
      node.append(photoFor(i, false, nameOf(i)));
      return;
    }

    if (stageKey === 'tile') {
      node.append(photoFor(i, false, nameOf(i)));
      const body = el('div', 'vm-gw-tile-body');
      body.append(el('span', 'vm-gw-tile-name', nameOf(i)));
      // RRMC tiles print no price anywhere (as the podium's); their line is "N Miles – Fuel".
      if (rrmc) body.append(el('span', 'vm-gw-tile-line', rrmcLineOf(i)));
      else if (pool.price[i] >= 0) body.append(el('span', 'vm-gw-tile-price', gbp(pool.price[i])));
      node.append(body);
      node.append(rejectBlock(i));
      return;
    }

    // card — the shared compact tile, with the score badge suppressed (there is
    // no score in a hard filter) and the paint forced in (this mode filters on
    // it, so the card it filtered down to has to name it). "Not this one" comes
    // free: rejectOptions is entirely caller-driven, so the reject flow needed
    // no change to result-card.js at all.
    const card = matchCard(matchAt(pool, i, true, rrmc ? versionsOf : undefined), {
      compact: true,
      brand: ctx.brand,
      showScore: false,
      showPaint: true,
      // RRMC: the podium's silver/bronze tile, its name held to one line.
      ...(rrmc && { fitName: 'line' }),
      rejectLabel: copy.rejectLabel,
      rejectPrompt: copy.rejectPrompt,
      rejectOptions: () => rejectOptionsFor(i),
    });
    if (rrmc) liftReject(card);
    node.append(card);
  };

  /** The photo band for a chip or tile — deliberately not mediaWell(), which
   *  builds a card's full media well with its line label and caption. */
  const photoFor = (i, big, alt) => {
    const src = state.pool.photo[i];
    const well = el('div', 'vm-gw-photo');
    if (!src) {
      well.classList.add('is-blank');
      return well;
    }
    const img = el('img');
    img.src = big ? fullPhoto(src) : src;
    img.alt = alt;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      well.classList.add('is-blank');
      img.remove();
    });
    well.append(img);
    return well;
  };

  /*
   * "Not this one" on a tile.
   *
   * Card-stage cards get this from matchCard's own rejectOptions hook; a tile is
   * this mode's own markup, so it gets its own trigger — built from the SAME
   * option list and reusing the SAME .vm-reject classes, so the two read
   * identically and there is one vocabulary of reasons rather than two.
   */
  const rejectBlock = (i) => {
    const wrap = el('div', 'vm-reject vm-gw-reject');
    const open = el('button', 'vm-reject-open', copy.rejectLabel);
    open.type = 'button';
    open.setAttribute('aria-expanded', 'false');
    if (rrmc) asChip(open);
    const menu = el('div', 'vm-reject-menu');
    menu.hidden = true;
    open.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.hidden) {
        menu.replaceChildren(el('p', 'vm-reject-prompt', copy.rejectPrompt));
        rejectOptionsFor(i).forEach((o) => {
          const b = el('button', 'vm-reject-option', o.label);
          b.type = 'button';
          b.addEventListener('click', o.apply);
          menu.append(b);
        });
        if (rrmc) menu.append(keepButton(open, menu));
      }
      menu.hidden = !menu.hidden;
      open.setAttribute('aria-expanded', String(!menu.hidden));
    });
    wrap.append(open, menu);
    return wrap;
  };

  /** The node for car `i`, created on first use. */
  const nodeFor = (i) => {
    let node = nodes[i];
    if (!node) {
      node = el('div', 'vm-gw-cell');
      node.dataset.i = String(i);
      nodes[i] = node;
      paintCell(node, i, state.layout.stage);
    }
    return node;
  };

  /*
   * Put the board's children in exactly `keep` order, inserting what came back
   * and dropping what went. The same insert-if-different pass podium.js uses for
   * its question blocks, and for the same reason: touching only what actually
   * moved is what keeps a 12,000-node board affordable.
   */
  const reconcile = (keep) => {
    for (let at = 0; at < keep.length; at += 1) {
      const node = nodeFor(keep[at]);
      node.classList.remove('is-out');
      if (board.children[at] !== node) board.insertBefore(node, board.children[at] || null);
    }
    while (board.children.length > keep.length) board.lastElementChild.remove();
  };

  /*
   * The board's available height — the viewport minus the sticky bar above it,
   * floored so a short window doesn't collapse the whole ladder to dots.
   *
   * Measured from the BAR's height rather than the board's viewport top, which
   * looks equivalent and isn't: the bar is sticky, so the board's top moves as
   * the page scrolls, and reading it would make the card size a function of how
   * far down the page you happen to be.
   */
  const boardHeight = () => {
    const barH = barEl?.offsetHeight || 0;
    return Math.max(320, (window.innerHeight || 800) - barH - 24);
  };

  /*
   * Commit a new survivor set to the DOM.
   *
   * Order matters and is the whole of the animation: measure where the survivors
   * are NOW (with the leavers still occupying their slots), then remove the
   * leavers and re-size the grid in one go, then measure again and play the
   * difference as a transform. Only transform and opacity are ever animated, so
   * the browser can do the whole thing off the main thread.
   */
  const commit = (keep) => {
    const layout = pickLayout(Math.max(keep.length, 1), board.clientWidth || 1200, boardHeight());
    const flip = layout.stage !== 'dot'
      && keep.length <= FLIP_MAX_CELLS
      && !reducedMotion;

    // First: where every survivor sits before the layout changes.
    const first = flip ? new Map() : null;
    if (flip) {
      keep.forEach((i) => {
        const node = nodes[i];
        if (node?.parentNode) first.set(node, node.getBoundingClientRect());
      });
    }

    const stageChanged = layout.stage !== state.layout?.stage;
    state.layout = layout;
    state.keep = keep;
    board.style.setProperty('--vm-gw-track', `${layout.track}px`);
    board.style.setProperty('--vm-gw-gap', `${layout.gap}px`);
    board.style.setProperty('--vm-gw-cell-h', `${Math.round(layout.cellH)}px`);
    board.dataset.stage = layout.stage;
    // A wall of 12,000 dots is a texture, not a list: it says "this many", which
    // the live count already says properly. From chip up each cell carries a
    // real photo of a real car, so it becomes content.
    board.setAttribute('aria-hidden', String(layout.stage === 'dot'));

    reconcile(keep);
    // Re-paint only what is actually on screen and out of date. One integer
    // compare per survivor when nothing changed, which is the common case.
    for (let at = 0; at < keep.length; at += 1) {
      const i = keep[at];
      if (nodeStage[i] !== layout.stage) paintCell(nodes[i], i, layout.stage);
    }

    if (flip) play(first, keep);
    if (stageChanged) shell.dataset.stage = layout.stage;

    paintCount(keep.length);
    paintChips();
    emptyEl.hidden = keep.length > 0;
    board.hidden = keep.length === 0;

    // One car left is this game's win condition, and the only moment in the mode
    // that deserves a flourish. Fires once per run.
    if (keep.length === 1 && !state.won && !reducedMotion) {
      state.won = true;
      celebrate(shell, { brand: ctx.brand });
      // celebrate() has no teardown of its own, because the two game modes that
      // wrote it throw their host away when the round ends. This shell lives for
      // the whole session and a buyer can arrive at one car, relax a filter and
      // arrive again, so bin the spent layer rather than stacking them up.
      const layer = shell.lastElementChild;
      window.setTimeout(() => layer.remove(), CONFETTI_MS);
    }
    if (keep.length !== 1) state.won = false;
  };

  /** Invert and play: every survivor that moved gets a one-off transform back to
   *  where it was, then releases. Transform only — no layout, no paint. */
  const play = (first, keep) => {
    const moved = [];
    keep.forEach((i) => {
      const node = nodes[i];
      const was = first.get(node);
      if (!was) return;
      const now = node.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      node.style.transition = 'none';
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      moved.push(node);
    });
    if (!moved.length) return;
    // One forced flush for the whole batch, so the transforms above are the
    // browser's "before" state rather than being coalesced away.
    void board.offsetHeight;
    moved.forEach((node) => {
      node.style.transition = `transform ${FLIP_MS}ms var(--vm-ease, ease)`;
      node.style.transform = '';
    });
    window.setTimeout(() => moved.forEach((node) => {
      node.style.transition = '';
    }), FLIP_MS + 40);
  };

  /*
   * Re-filter and hand over to commit, with the elimination in between.
   *
   * The leavers keep their grid slots while they fade, so the board holds still
   * for the length of the exit and then collapses in one movement. Without that
   * beat the survivors start moving before the eliminated cars have gone and the
   * whole point of the mode — watching cars be ruled out — is lost.
   */
  const render = ({ animate = true } = {}) => {
    syncWhy();
    const keep = survivors();
    window.clearTimeout(state.exitTimer);

    if (!animate || reducedMotion) {
      commit(keep);
      return;
    }
    const keepSet = new Set(keep);
    const leaving = [...board.children].filter((node) => !keepSet.has(Number(node.dataset.i)));
    if (!leaving.length) {
      commit(keep);
      return;
    }
    leaving.forEach((node) => node.classList.add('is-out'));
    state.exitTimer = window.setTimeout(() => commit(keep), EXIT_MS);
  };

  /*
   * Every edit made inside an open popover.
   *
   * No debounce: the filter pass is 0.035 ms over 12,000 cars, so the board can
   * afford to re-filter on every pixel of a slider drag — and it should, because
   * watching the wall thin out as you drag IS the mode.
   *
   * Undo is banked once per popover session rather than once per event. A drag
   * fires this fifty times and fifty identical undo steps are no undo at all;
   * the state captured when the popover opened is the one a buyer means by "put
   * that back". Rejections bank their own point (see setAxis), because each of
   * those is a single deliberate act.
   */
  function filtersChanged() {
    // renderRangeSlider commits its starting value on mount (so a caller's Next
    // button is enabled without a drag). Here that fires before the buyer has
    // touched anything, writing the value that is already set — so opening the
    // price popover would otherwise bank an undo step and repaint for nothing.
    if (state.pop?.building) return;
    if (state.pop && !state.pop.banked) {
      state.pop.banked = true;
      state.history.push(state.pop.before);
      if (state.history.length > HISTORY_MAX) state.history.shift();
    }
    render();
  }

  /* ------------------------------ the bar ------------------------------ */

  /** The headline count, ticked rather than snapped: the number falling from
   *  12,084 to 47 is the mode telling you what it just did. */
  const paintCount = (left) => {
    const total = state.pool.n;
    const gone = total - left;
    noteEl.textContent = (() => {
      if (!left) return '';
      if (left === total) return copy.startNote({ total: miles(total) });
      if (left === 1) return copy.oneNote;
      if (left <= 6) return copy.fewNote({ left });
      return copy.liveNote({ left: miles(left), gone: miles(gone) });
    })();
    undoBtn.hidden = !state.history.length;
    if (progressBar) {
      progressBar.style.width = `${Math.round((gone / total) * 100)}%`;
      // Re-asserted: a mode switched away from may clear the row's class after this one set it.
      progressBar.parentElement.parentElement?.classList.add('has-progress');
    }

    /*
     * The true figure lands FIRST, then the tween plays over it.
     *
     * Written the obvious way round — tween up to the final value — the number on
     * screen is only correct once the animation has finished, and
     * requestAnimationFrame does not run in a background tab. So filtering in a
     * hidden tab left the headline reading 3,578 over a board of 317 cars: the
     * count is this mode's primary readout, and it cannot be contingent on an
     * effect. Set it, then decorate it.
     */
    const from = state.shown;
    state.shown = left;
    countEl.textContent = miles(left);
    if (reducedMotion || from === left) return;

    // A generation stamp, because the tween is rAF-driven and a second filter
    // lands long before 420 ms is up. Without it two tweens race and the digits
    // flicker between two counts.
    state.countGen += 1;
    const gen = state.countGen;
    const started = performance.now();
    const tick = () => {
      if (gen !== state.countGen) return;
      const t = Math.min(1, (performance.now() - started) / COUNT_MS);
      // Ease-out: most of the travel happens immediately, so the number reads as
      // a drop rather than a slow scroll.
      const value = Math.round(from + (left - from) * (1 - (1 - t) ** 3));
      countEl.textContent = miles(value);
      if (t < 1) window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  };

  /** The chip row: one per axis, showing what it is currently set to. */
  const paintChips = () => {
    state.axes.forEach((axis) => {
      const chip = chipsEl.querySelector(`[data-axis="${axis.key}"]`);
      if (!chip) return;
      chip.classList.toggle('is-on', axis.narrowed());
      chip.querySelector('.vm-gw-chip-value').textContent = axis.summary();
    });
  };

  const buildChips = () => {
    chipsEl.replaceChildren();
    state.axes.forEach((axis) => {
      const chip = el('button', 'vm-gw-chip');
      chip.type = 'button';
      chip.dataset.axis = axis.key;
      chip.setAttribute('aria-haspopup', 'dialog');
      chip.setAttribute('aria-expanded', 'false');
      chip.append(
        el('span', 'vm-gw-chip-label', labelFor(ctx.brand, axis.key)),
        el('span', 'vm-gw-chip-value', copy.anySummary),
      );
      chip.addEventListener('click', () => {
        if (state.pop?.axis === axis) closePop();
        else openPop(chip, axis);
      });
      chipsEl.append(chip);
    });
  };

  /* ---------------------------- the popover ---------------------------- */

  const buildPopover = () => {
    pop = el('div', 'vm-gw-pop');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'false');
    pop.hidden = true;
    popTitle = el('p', 'vm-gw-pop-title');
    popBody = el('div', 'vm-gw-pop-body');
    const done = el('button', 'vm-btn vm-btn-primary vm-gw-pop-done', 'Done');
    done.type = 'button';
    done.addEventListener('click', () => closePop());
    pop.append(popTitle, popBody, done);
    return pop;
  };

  function openPop(trigger, axis) {
    if (state.pop) closePop();
    // `before` is the state to hand back if this session changes anything;
    // `building` suppresses the widgets' mount-time commit (see filtersChanged).
    state.pop = {
      trigger, axis, before: snapshot(), banked: false, building: true,
    };
    popTitle.textContent = axis.q.title;
    pop.setAttribute('aria-label', axis.q.title);
    popBody.replaceChildren();
    // The widget writes straight into state.filters and calls filtersChanged, so
    // the board re-filters live under the open popover. That is the point: the
    // buyer watches the wall thin out as they tick boxes.
    if (axis.q.type === 'slider' && !axis.bare) {
      const list = el('div', 'vm-options vm-slider');
      axis.build(list);
      popBody.append(list);
    } else {
      axis.build(popBody);
    }
    state.pop.building = false;
    pop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    placePop(trigger);
    document.addEventListener('keydown', onPopKey);
    document.addEventListener('pointerdown', onPopOutside, true);
    focusablesIn(popBody)[0]?.focus();
  }

  /** Fixed to the viewport and clamped into it, so a chip near the right edge
   *  cannot push the dialog off-screen. Same clamp as podium.js's placePop. */
  const placePop = (trigger) => {
    const r = trigger.getBoundingClientRect?.();
    if (!r) return;
    const width = pop.offsetWidth || POP_WIDTH;
    const vw = window.innerWidth || width + POP_MARGIN * 2;
    const vh = window.innerHeight || 0;
    let left = r.left + (r.width / 2) - (width / 2);
    left = Math.max(POP_MARGIN, Math.min(left, vw - width - POP_MARGIN));
    let top = r.bottom + POP_MARGIN;
    const height = pop.offsetHeight || 0;
    if (height && vh && top + height > vh - POP_MARGIN) {
      top = Math.max(POP_MARGIN, r.top - height - POP_MARGIN);
    }
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  };

  const onPopKey = (e) => {
    if (!state.pop) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closePop();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusablesIn(pop);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const onPopOutside = (e) => {
    if (!state.pop) return;
    if (pop.contains(e.target) || state.pop.trigger.contains(e.target)) return;
    closePop();
  };

  function closePop() {
    if (!state.pop) return;
    const { trigger } = state.pop;
    document.removeEventListener('keydown', onPopKey);
    document.removeEventListener('pointerdown', onPopOutside, true);
    pop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    state.pop = null;
    trigger.focus?.();
  }

  /* -------------------------- "not this one" -------------------------- */

  /** A snapshot of everything a rejection or a filter change can touch, so any
   *  of it can be handed straight back. */
  const snapshot = () => ({
    filters: JSON.parse(JSON.stringify(state.filters)),
    out: new Set(state.out),
  });

  const bank = () => {
    state.history.push(snapshot());
    if (state.history.length > HISTORY_MAX) state.history.shift();
  };

  const undo = () => {
    const prev = state.history.pop();
    if (!prev) return;
    Object.keys(prev.filters).forEach((k) => { state.filters[k] = prev.filters[k]; });
    state.out = prev.out;
    closePop();
    render();
  };

  const reset = () => {
    bank();
    // Each axis puts its own filter back, because only the axis knows what "not
    // filtering" looks like for it: a full-width range for the sliders, an empty
    // array for the multi-picks, and no postcode at all for distance, which owns
    // two fields under one chip and neither of them is an array.
    state.axes.forEach((axis) => axis.clear());
    state.out = new Set();
    closePop();
    render();
  };

  /** Set one axis's value and re-filter. The bank happens here so every path
   *  into a filter change is undoable, including a rejection. */
  const setAxis = (key, value) => {
    bank();
    state.filters[key] = value;
    render();
  };

  const axisFor = (key) => state.axes.find((a) => a.key === key);

  /*
   * The reasons a buyer may give for turning down car `i`, each of which SETS A
   * FILTER rather than hiding one car.
   *
   * That is the brief, and it is also the only version worth building: hiding
   * one car of 12,000 is not a decision, whereas "no diesels" is. Every option
   * here is checked to make sure it would actually change something and leave
   * something — an option that empties the board, or one whose axis this pool
   * doesn't offer, is not shown at all. The last one is the escape hatch: a car
   * you dislike for no reason you can name still has to be removable.
   */
  const rejectOptionsFor = (i) => {
    const pool = state.pool;
    const f = state.filters;
    const out = [];

    // Too expensive → cap the range just under this car, snapped to the step. Never for POA,
    // and RRMC's open top caps just under its "+", keeping the slider's minimum gap below.
    const price = axisFor('price');
    if (price && pool.price[i] > 0 && pool.poa?.[i] !== 1) {
      const { min, max, step, minGap = 0, openTop } = price.q;
      const top = openTop && f.price[1] >= max ? Infinity : f.price[1];
      const capped = Math.min(Math.floor((pool.price[i] - 1) / step) * step, openTop ? max - step : Infinity);
      if (capped - minGap >= min && capped < top) {
        out.push({
          label: copy.reject.price({ price: gbp(pool.price[i]) }),
          apply: () => setAxis('price', [Math.min(f.price[0], capped - minGap), capped]),
        });
      }
    }

    /*
     * A dictionary axis, turned into a rejection.
     *
     * "No diesels" on a multi-pick whose empty state means "any" is really
     * "select every fuel except diesel" — so an untouched axis is expanded to
     * all its options first and then narrowed. Skipped when it would leave
     * nothing selected, which is the case where the buyer has already narrowed
     * to exactly the thing they are now rejecting; the board would empty, and
     * "rule out the only option" is not a reason, it's a mistake.
     */
    const dictReject = (key, label) => {
      const axis = axisFor(key);
      if (!axis) return;
      const at = pool[key === 'colour' ? 'shade' : key][i];
      const opt = axis.q.options.find((o) => o.value === at);
      if (!opt) return;
      const current = f[key].length ? f[key] : axis.q.options.map((o) => o.value);
      const next = current.filter((v) => v !== at);
      if (!next.length || next.length === current.length) return;
      out.push({ label: label(opt), apply: () => setAxis(key, next) });
    };
    dictReject('fuel', (o) => copy.reject.fuel({ fuel: o.label.toLowerCase() }));
    dictReject('body', (o) => copy.reject.body({ body: withArticle(o.label), label: o.label }));
    dictReject('colour', (o) => copy.reject.colour({ shade: o.label.toLowerCase() }));
    // Only RRMC's pool carries these axes, and only its copy words them.
    if (copy.reject.region) dictReject('region', (o) => copy.reject.region({ label: o.label }));
    if (copy.reject.handDrive) dictReject('handDrive', (o) => copy.reject.handDrive({ label: o.label }));

    // Too many miles → keep only the bands below this car's.
    const mileage = axisFor('mileage');
    const at = bandOf(pool.mileage[i]);
    if (mileage && at > 0) {
      const below = mileage.q.options
        .filter((o) => MILEAGE_BANDS.findIndex((b) => b.id === o.value) < at)
        .map((o) => o.value);
      const current = f.mileage.length ? f.mileage : mileage.q.options.map((o) => o.value);
      const next = below.filter((v) => current.includes(v));
      if (next.length && next.length < current.length) {
        out.push({
          label: copy.reject.mileage({ cap: miles(MILEAGE_BANDS[at].lo) }),
          apply: () => setAxis('mileage', next),
        });
      }
    }

    // Too old → cap the age range just under this car's.
    const age = axisFor('age');
    if (age && pool.year[i] > 0) {
      const carAge = new Date().getFullYear() - pool.year[i];
      const capped = carAge - 1;
      if (capped >= f.age[0] && capped < f.age[1]) {
        out.push({
          label: copy.reject.age({ years: ageCapPhrase(capped) }),
          apply: () => setAxis('age', [f.age[0], capped]),
        });
      }
    }

    /*
     * Too far → pull the radius in to the largest band that would leave this car
     * outside it. Only offered once a postcode is set, because without one we
     * genuinely don't know how far away anything is, and a menu line that means
     * "first tell us where you live" is not a reason for turning down a car.
     *
     * Keyed on 'radius' rather than 'place' because that's the filter field the
     * chip is built from; the axis owns two of them (see the place axis).
     */
    const place = axisFor('place');
    if (place && f.origin) {
      // Infinity means an unlocated dealer, which can't be on the board while a
      // distance is set — but the guard keeps it from ever inventing a cap.
      const away = place.milesTo(i);
      const tighter = Number.isFinite(away)
        ? RADIUS_BANDS.filter((m) => m < away && m < f.radius)
        : [];
      const capped = tighter[tighter.length - 1];
      if (capped) {
        out.push({
          label: copy.reject.place({ cap: capped }),
          apply: () => setAxis('radius', capped),
        });
      }
    }

    // The escape hatch. Not a filter, and deliberately last.
    out.push({
      label: copy.reject.just,
      apply: () => {
        bank();
        state.out.add(i);
        render();
      },
    });
    return out;
  };

  /* ---------------------------- the stage ---------------------------- */

  const buildStage = () => {
    root.replaceChildren();
    shell = el('div', 'vm-gw');

    barEl = el('div', 'vm-gw-bar');
    const lead = el('div', 'vm-gw-lead');
    if (copy.wordmark) lead.append(el('p', 'vm-gw-wordmark', copy.wordmark));
    const tally = el('div', 'vm-gw-tally');
    countEl = el('span', 'vm-gw-count', miles(state.pool.n));
    tally.append(countEl, el('h2', 'vm-gw-title', copy.title));
    noteEl = el('p', 'vm-gw-note');
    noteEl.setAttribute('role', 'status');
    noteEl.setAttribute('aria-live', 'polite');
    lead.append(tally, noteEl);

    chipsEl = el('div', 'vm-gw-chips');
    chipsEl.setAttribute('role', 'group');
    chipsEl.setAttribute('aria-label', 'Filters');

    const tools = el('div', 'vm-gw-tools');
    undoBtn = el('button', 'vm-gw-tool', copy.undoLabel);
    undoBtn.type = 'button';
    undoBtn.hidden = true;
    undoBtn.addEventListener('click', undo);
    const resetBtn = el('button', 'vm-gw-tool', copy.resetLabel);
    resetBtn.type = 'button';
    resetBtn.addEventListener('click', reset);
    tools.append(undoBtn, resetBtn);
    if (state.questions.length) {
      const revisit = el('button', 'vm-gw-tool', copy.revisitLabel);
      revisit.type = 'button';
      revisit.addEventListener('click', showAsk);
      tools.prepend(revisit);
    }

    barEl.append(lead, chipsEl, tools);

    board = el('div', 'vm-gw-board');

    emptyEl = el('div', 'vm-gw-empty');
    emptyEl.hidden = true;
    const emptyReset = el('button', 'vm-btn vm-btn-primary', copy.resetLabel);
    emptyReset.type = 'button';
    emptyReset.addEventListener('click', reset);
    emptyEl.append(
      el('h3', 'vm-gw-empty-title', copy.emptyTitle),
      el('p', 'vm-gw-empty-note', copy.emptyNote),
      emptyReset,
    );

    shell.append(barEl, board, emptyEl, buildPopover());
    root.append(shell);
  };

  /*
   * First paint. Every car gets a node up front rather than on demand, because
   * the mode's opening claim is "here is all of it" and a virtualised board
   * cannot make that claim honestly — you would be looking at a window, not the
   * stock. Affordable only because of `content-visibility: auto` (64 ms versus
   * 512 ms at this node count), which the CSS applies below card stage.
   */
  const firstPaint = () => {
    const pool = state.pool;
    nodes = new Array(pool.n);
    nodeStage = new Array(pool.n);
    state.layout = pickLayout(pool.n, board.clientWidth || 1200, boardHeight());
    // The exit duration lives in one place. The CSS transitions on it and the JS
    // waits for it before collapsing the board, so the two cannot drift.
    board.style.setProperty('--vm-gw-exit', `${EXIT_MS}ms`);
    board.style.setProperty('--vm-gw-track', `${state.layout.track}px`);
    board.style.setProperty('--vm-gw-gap', `${state.layout.gap}px`);
    board.style.setProperty('--vm-gw-cell-h', `${Math.round(state.layout.cellH)}px`);
    board.dataset.stage = state.layout.stage;
    board.setAttribute('aria-hidden', String(state.layout.stage === 'dot'));
    shell.dataset.stage = state.layout.stage;

    const frag = document.createDocumentFragment();
    for (let i = 0; i < pool.n; i += 1) {
      const node = el('div', 'vm-gw-cell');
      node.dataset.i = String(i);
      nodes[i] = node;
      paintCell(node, i, state.layout.stage);
      frag.append(node);
    }
    board.append(frag);
    state.shown = pool.n;
    state.keep = Array.from({ length: pool.n }, (_, i) => i);
    paintCount(pool.n);
    paintChips();
  };

  /* ------------------------------- resize ------------------------------- */

  // The layout is a function of the viewport, so a resize (or a rotate) has to
  // re-pick it. Coalesced to one frame: a drag of a window edge fires this
  // dozens of times a second and each run measures the board.
  const onResize = () => {
    window.clearTimeout(state.resizeTimer);
    state.resizeTimer = window.setTimeout(() => {
      if (!board?.isConnected) return;
      commit(state.keep);
    }, 120);
  };
  window.addEventListener('resize', onResize);

  /* ------------------------------- boot ------------------------------- *
   * The pool is load-bearing — no pool, no board — so, like apiGetQuestions in
   * every other mode, it throws and we offer a retry. mount() stays synchronous:
   * it paints the skeleton now and does the fetch in this detached boot(), so
   * the shell never awaits a cold backend (see decorate() in
   * ../vehicle-matcher.js for why that matters). */
  const boot = async () => {
    let raw;
    // RRMC asks the podium's questions first; if they can't be fetched the board simply opens unasked.
    const questions = rrmc ? apiGetQuestions(ctx.api, ctx.retailer, ctx.brand).catch(() => null) : null;
    try {
      raw = await apiPool(ctx.api, ctx.brand, ctx.retailer, ctx.scope);
    } catch {
      if (stillMounted()) showError(boot);
      return;
    }
    if (!stillMounted()) return;
    if (!raw?.n) {
      showError(boot);
      return;
    }
    state.pool = decodePool(raw);
    state.filters = {};
    buildAxes();
    mountProgress();
    const asked = (await questions)?.questions;
    if (!stillMounted()) return;
    if (asked?.length) {
      state.questions = asked;
      showAsk();
      return;
    }
    syncWhy();
    openBoard();
  };

  renderSkeleton();
  boot();
}

// The switcher tab is brand-agnostic shell UI, so its label is neutral. The
// campaign wordmark lives INSIDE the stage (GUESS_WHO_COPY[brand].wordmark),
// where it can vary by brand; the mode's static `label` can't.
export default { key: 'guess-who', label: 'Guess Who', mount };
