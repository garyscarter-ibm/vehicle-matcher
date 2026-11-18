import { currencySymbol, fuelLabel } from './ui.js';

/*
 * Client-only quiz metadata.
 *
 * The quiz definition itself is fetched from the API (GET /api/questions), but
 * two things can't cross JSON and are needed on the client:
 *
 *  - SHOW_IF: the conditional-visibility predicates, keyed by question id.
 *    The API marks conditional questions with `conditional: true`; the block
 *    looks up the matching predicate here to decide whether to show them.
 *  - BUDGET_BANDS: needed synchronously to decode/validate a shared #m=… link
 *    before any network request completes.
 *
 * This is deliberately NOT the car dataset or the scoring weights — those stay
 * server-side. Keep SHOW_IF in sync with the `showIf` functions in
 * server/questions.js (there's only one conditional question today).
 */

/**
 * Conditional-visibility predicates, keyed by question id. Mirror of the
 * `showIf` functions in server/questions.js. `fuel` is multi-select (an array),
 * so test membership: show charging when any electric-adjacent fuel (or "help me
 * decide") is picked, or while fuel is still unanswered.
 */
export const SHOW_IF = {
  charging: (a) => {
    const f = a.fuel;
    const picks = Array.isArray(f) ? f : (f != null ? [f] : []);
    return picks.length === 0 || picks.some((v) => v === 'ev' || v === 'phev' || v === 'open');
  },
  // MINI-only (see brands.js questions.add): the door count is only a real
  // choice for the Hatch, so ask it only once a hatchback (or "any") is in play.
  // Mirror of the `showIf` on the doors question in server/brands.js.
  doors: (a) => {
    const b = a.bodyStyles;
    const picks = Array.isArray(b) ? b : (b != null ? [b] : []);
    return picks.length === 0 || picks.some((v) => v === 'hatchback' || v === 'any');
  },
};

/** Budget bands → [min, max] GBP. Mirror of server/questions.js BUDGET_BANDS. */
export const BUDGET_BANDS = {
  b1: [0, 35000],
  b2: [35000, 50000],
  b3: [50000, 70000],
  b4: [70000, 100000],
  b5: [100000, 250000],
};

/*
 * Short pill summaries of a chosen answer, keyed by question id then value.
 * These are deliberately terse noun-phrases ("Home charging", "Balanced") — a
 * *record* of the choice, not the option's own prompt text ("Yes, at home",
 * "A bit of both"), which reads oddly as a summary. Kept client-side (like
 * SHOW_IF) since the option labels themselves live server-side in the fetched
 * quiz. Keep the values in sync with server/questions.js option values.
 *
 * `budget` is derived from BUDGET_BANDS below rather than listed here, and the
 * multi-select questions (bodyStyles, priorities) collapse to "First +N" in
 * pillFor — so this map only needs the single-select questions.
 */
export const PILL_LABEL = {
  fuel: {
    petrol: 'Petrol', diesel: 'Diesel', phev: 'Plug-in hybrid', ev: 'Electric', open: 'Any fuel',
  },
  charging: {
    either: 'Home or work charging', home: 'Home charging', work: 'Work charging', none: 'Public charging',
  },
  primaryUse: {
    city: 'City driving', commute: 'Commuting', family: 'Family duties',
    roadtrips: 'Road trips', fun: 'Weekend fun',
  },
  people: { solo: 'Just me', family: 'Small family', crew: '5+ seats' },
  truckClass: { 1500: 'RAM 1500', 2500: 'RAM 2500', 3500: 'RAM 3500', open: 'Any RAM series' },
  // Bespoke MINI-only questions (see brands.js questions.add); harmless on BMW.
  miniVibe: { classic: 'Classic', exclusive: 'Exclusive', sport: 'Sport' },
  doors: { 3: '3-door', 5: '5-door', either: 'Any doors' },
  // BMW keeps mileage/style; MINI no longer asks them (dropped in brands.js), so
  // these entries are only ever reached for BMW now.
  mileage: {
    low: 'Under 6k mi/yr', mid: '6–12k mi/yr', high: '12–20k mi/yr', vhigh: '20k+ mi/yr',
  },
  style: {
    1: 'Comfort', 2: 'Comfort-leaning', 3: 'Balanced', 4: 'Sporty-leaning', 5: 'Sporty',
  },
  // Per-value labels for the multi-select body styles; priorities reuse the
  // option label as-is (they're already short), so it has no entry here.
  bodyStyles: {
    hatchback: 'Hatchback', saloon: 'Saloon', estate: 'Estate', suv: 'SUV',
    coupe: 'Coupé', convertible: 'Convertible', mpv: 'Family carrier', pickup: 'Pickup', any: 'Any body',
  },
};

/** Short priorities labels (multi-select) — terser than the option prompts. */
const PRIORITY_LABEL = {
  economy: 'Running costs', performance: 'Performance', comfort: 'Comfort',
  tech: 'Tech', image: 'Style', '4wd': 'Four-wheel drive',
};

/** Money as a compact "£50–70k" band label (min 0 renders as "Under £Xk"). */
function bandLabel([min, max], currency) {
  const k = (n) => `${currencySymbol(currency)}${Math.round(n / 1000)}k`;
  if (!min) return `Under ${k(max)}`;
  if (max >= 250000) return `${k(min)}+`;
  return `${k(min)}–${Math.round(max / 1000)}k`;
}

/** A single slider budget as "£62k" (or "£150k+" at the slider ceiling). */
function budgetValueLabel(value, question) {
  const k = `${currencySymbol(question?.currency)}${Math.round(value / 1000)}k`;
  return question?.plusAtMax && value >= question.max ? `${k}+` : k;
}

/** A dual-thumb budget range as "£40–75k" ("£40k+" when max hits the ceiling). */
function budgetRangeLabel([lo, hi], question) {
  const k = (n) => `${currencySymbol(question?.currency)}${Math.round(n / 1000)}k`;
  if (question?.plusAtMax && hi >= question.max) return `${k(lo)}+`;
  return `${k(lo)}–${Math.round(hi / 1000)}k`;
}

/** Annual mileage number as "12,000 mi/yr" (or "25,000+ mi/yr" at the ceiling). */
function mileageValueLabel(value, question) {
  const n = value.toLocaleString('en-GB');
  return question?.plusAtMax && value >= question.max ? `${n}+ mi/yr` : `${n} mi/yr`;
}

/**
 * A short pill summary of the current answer to `question`, or null if it isn't
 * answered yet. `question` is the fetched quiz object (has id, multi, options);
 * `answers` is the running ctx.answers.
 *   single-select → PILL_LABEL[id][value] (or the raw value as a fallback)
 *   budget        → derived band, e.g. "£50–70k"
 *   multi-select  → "First +N" (e.g. "SUV +1"), or "Any body" when 'any' picked
 */
export function pillFor(question, answers, brand) {
  const { id, multi } = question;
  const value = answers[id];
  if (value == null || (multi && value.length === 0)) return null;

  if (id === 'budget') {
    // Dual-thumb range → "£40–75k"; a bare number (earlier shape) → "£62k";
    // legacy shared links may still carry a b1–b5 band key.
    if (Array.isArray(value)) return budgetRangeLabel(value, question);
    if (typeof value === 'number') return budgetValueLabel(value, question);
    const band = BUDGET_BANDS[value];
    return band ? bandLabel(band, question.currency) : null;
  }

  if (id === 'mileage' && typeof value === 'number') {
    return mileageValueLabel(value, question);
  }

  if (multi) {
    const values = Array.isArray(value) ? value : [value];
    const label = (v) => (id === 'priorities'
      ? (PRIORITY_LABEL[v] || v)
      : ((id === 'fuel' ? fuelLabel(v, brand) : null) || PILL_LABEL[id]?.[v] || v));
    if (values.includes('any')) return PILL_LABEL[id]?.any || 'Any';
    const [first, ...rest] = values;
    return rest.length ? `${label(first)} +${rest.length}` : label(first);
  }

  return (id === 'fuel' ? fuelLabel(value, brand) : null) || PILL_LABEL[id]?.[value] || String(value);
}
