// Presentation fixture data for the Account harness (?prefs=). Not a policy source and never mounted by a live page.
const opts = (...pairs) => pairs.map(([value, label]) => ({ value, label }));
const stops = (...labels) => labels.map((label, at) => ({ value: at * 50, label }));
const CATEGORIES = {
  body: { label: 'Body', question: 'Which body styles feel right?', kind: 'multi', options: opts(['hatchback', 'Hatchback'], ['saloon', 'Saloon'], ['estate', 'Touring / Estate'], ['suv', 'SUV'], ['coupe', 'Coupé'], ['convertible', 'Convertible'], ['mpv', 'MPV']) },
  fuel: { label: 'Fuel', question: 'What would you like to drive?', kind: 'multi', options: opts(['petrol', 'Petrol'], ['diesel', 'Diesel'], ['phev', 'Plug-in hybrid'], ['ev', 'Electric']) },
  sportiness: { label: 'Sportiness', question: 'How do you like your car to feel?', kind: 'stops', openDefault: 50, stops: stops('Relaxed', 'A bit of both', 'Sporty') },
  comfort: { label: 'Comfort', question: 'How much comfort would you like?', kind: 'stops', openDefault: 50, stops: stops('Simple and functional', 'A bit of both', 'As comfortable as possible') },
  economy: { label: 'Economy', question: 'Where would you put the balance?', kind: 'stops', openDefault: 50, stops: stops('Driving comes first', 'A bit of both', 'Economy comes first') },
  size: { label: 'Size', question: 'What size works for your life?', kind: 'stops', openDefault: 50, stops: stops('Compact', 'A bit of both', 'Spacious') },
};
const ORDER = Object.keys(CATEGORIES);
const CURRENT_CONTRACT = 'current:employee-paula'; // the 'ready' Account fixture's current car
const considered = (value, importance = 'medium') => ({ state: 'considered', value, importance, exact: true });
const SELECTED = { body: considered(['estate']), fuel: considered(['petrol']), comfort: considered(100) };
// Preview only, mirroring the seed's understanding mapping; the server policy is the source of truth.
const UNDERSTANDING = { kind: 'input-completeness', maximum: 11, byConsidered: [1, 3, 4, 6, 7, 9, 10], sameAgain: 11, policyKey: 'brief.accountPreferences.v1' };
const COUNT = /^count-([0-6])$/;
const counted = (n) => Object.fromEntries(ORDER.slice(0, n).map((key) => [key, CATEGORIES[key].kind === 'multi' ? considered([CATEGORIES[key].options[0].value]) : considered(100)]));

export const PREFERENCE_FIXTURE_STATES = Object.freeze(['empty', 'selected', 'body-open-unset', 'body-open-medium', 'body-high', 'comfort-midpoint',
  'remove-comfort', 'save-failed', 'stale', 'pending', 'rating-failed', 'same-again', 'same-again-high', 'same-again-failed',
  'engage-pending', 'engage-failed', 'minimum-loss', 'validation', ...Array.from({ length: 7 }, (_, n) => `count-${n}`)]);

/** In-memory stand-in for the brief transport: the same two calls and result shapes, no network. */
export function previewPreferenceTransport(name, { rating, sameAgainReason, buddy: asked } = {}) {
  let draftVersion = 0; let stars = Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null;
  let sameOn = ['same-again', 'same-again-high'].includes(name);
  const start = { 'body-open-unset': {}, empty: {}, 'body-high': { ...SELECTED, body: considered(['estate'], 'high') },
    'comfort-midpoint': { ...SELECTED, comfort: considered(50) }, validation: {}, 'same-again-high': { body: considered(['estate'], 'high') },
    ...(COUNT.test(name) ? { [name]: counted(Number(name.slice(6))) } : {}) }[name] ?? SELECTED;
  const categories = Object.fromEntries(ORDER.map((key) => [key, structuredClone(start[key] ?? { state: 'unset' })]));
  const again = () => (sameAgainReason ? { available: false, on: false, contractId: null, reason: sameAgainReason } : { available: true, on: sameOn, contractId: CURRENT_CONTRACT });
  // The same readback the server builds: Same again lifts the score to its own figure, otherwise it follows the considered count.
  const readback = () => {
    const n = ORDER.filter((key) => categories[key].state === 'considered').length; const on = again().available && sameOn;
    return { considered: n, categories: structuredClone(categories), sameAgain: on, understanding: { kind: UNDERSTANDING.kind, value: on ? UNDERSTANDING.sameAgain : UNDERSTANDING.byConsidered[n],
      maximum: UNDERSTANDING.maximum, basis: on ? 'same-again' : 'categories', considered: n, policyKey: UNDERSTANDING.policyKey, policyVersion: 'preview' } };
  };
  // Preview engagement: ?buddy= picks the start (unknown = the lane is missing); minimum-loss always starts engaged.
  let engaged = name === 'minimum-loss' || asked === 'engaged'; let lost = false;
  const buddyView = () => {
    const n = readback().considered; const on = again().available && sameOn; const remaining = on ? 0 : Math.max(0, 3 - n);
    return { state: engaged ? 'engaged' : 'disengaged', reason: !engaged && lost ? 'minimum-lost' : null, permissionVersion: 1, minimumCategories: 3,
      considered: n, remaining, sameAgain: on, canEngage: !engaged && remaining === 0 };
  };
  const refusal = name === 'save-failed' ? { status: 'unavailable', retryable: true } : name === 'stale' ? { status: 'stale-version', action: 'refresh' } : null;
  return {
    async loadEditor() {
      return { status: 'ok', value: { context: { accountPreferences: { order: ORDER, minimumCategories: 3, policyVersion: 'preview', categories: CATEGORIES,
        understanding: { ...UNDERSTANDING, byConsidered: [...UNDERSTANDING.byConsidered] } } },
        initial: { briefVersion: 1, draftVersion, currentCarRating: { contractId: CURRENT_CONTRACT, value: stars }, sameAgain: again(), accountPreferences: readback(),
          ...(asked === 'unknown' ? {} : { buddy: buddyView() }) }, selection: null } };
    },
    async engage() {
      if (name === 'engage-pending') return new Promise(() => {});
      if (name === 'engage-failed') return { status: 'unavailable', retryable: true };
      const view = buddyView();
      if (view.remaining > 0) return { status: 'invalid', code: 'engagement-minimum', remaining: view.remaining, considered: view.considered, minimumCategories: 3 };
      engaged = true; lost = false; draftVersion += 1;
      return { status: 'ok', value: { briefVersion: 1, draftVersion, buddy: buddyView() } };
    },
    async disengage() {
      engaged = false; draftVersion += 1;
      return { status: 'ok', value: { briefVersion: 1, draftVersion, buddy: buddyView() } };
    },
    async savePreferences({ changes, currentCarRating, sameAgain }) {
      if (name === 'pending') return new Promise(() => {}); // an in-flight save that never answers
      if (refusal) return structuredClone(refusal);
      if (name === 'rating-failed' && currentCarRating) return { status: 'unavailable', retryable: true }; // only the rating save fails
      if (name === 'same-again-failed' && sameAgain) return { status: 'unavailable', retryable: true }; // only the Same again save fails
      if (sameAgain && !again().available) return { status: 'conflict', reason: sameAgainReason };
      if (sameOn && Object.keys(changes).length && sameAgain?.on !== false) return { status: 'invalid', code: 'invalid-preferences' };
      for (const [key, change] of Object.entries(changes)) {
        const was = categories[key];
        if (change === null) { categories[key] = { state: 'unset' }; continue; }
        categories[key] = considered(Object.hasOwn(change, 'value') ? change.value : was.value, change.importance ?? (was.state === 'considered' ? was.importance : 'medium'));
      }
      if (currentCarRating) stars = currentCarRating.value;
      if (sameAgain) sameOn = sameAgain.on;
      draftVersion += 1;
      const was = engaged; if (was && !buddyView().canEngage && buddyView().remaining > 0) { engaged = false; lost = true; }
      return { status: 'ok', value: { briefVersion: 1, draftVersion, currentCarRating: { contractId: CURRENT_CONTRACT, value: stars }, sameAgain: again(), accountPreferences: readback(),
        ...(asked === 'unknown' ? {} : { buddy: buddyView(), buddyTransition: was && lost ? 'minimum-lost' : null }) } };
    },
  };
}

/** Puts a loaded controller into the named visual state, using only its public intents. */
export function drivePreferenceState(controller, name) {
  if (name === 'body-open-unset') controller.open('body');
  else if (name === 'body-open-medium' || name === 'body-high') controller.open('body');
  else if (name === 'comfort-midpoint') controller.open('comfort');
  else if (name === 'remove-comfort') controller.requestRemove('comfort');
  else if (name === 'save-failed' || name === 'stale') controller.change('comfort', { value: 50 });
  else if (name === 'same-again-failed') controller.toggleSameAgain(true);
  else if (name === 'minimum-loss') { controller.requestRemove('comfort'); controller.confirmRemove('comfort'); }
  else if (name === 'validation') controller.engage();
  else if (name === 'engage-pending' || name === 'engage-failed') controller.engage();
}
