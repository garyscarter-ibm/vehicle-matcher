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
const considered = (value, importance = 'medium') => ({ state: 'considered', value, importance, exact: true });
const SELECTED = { body: considered(['estate']), fuel: considered(['petrol']), comfort: considered(100) };

export const PREFERENCE_FIXTURE_STATES = Object.freeze(['empty', 'selected', 'body-open-unset', 'body-open-medium', 'body-high', 'comfort-midpoint',
  'remove-comfort', 'save-failed', 'stale', 'pending']);

/** In-memory stand-in for the brief transport: the same two calls and result shapes, no network. */
export function previewPreferenceTransport(name) {
  let draftVersion = 0;
  const start = { 'body-open-unset': {}, empty: {}, 'body-high': { ...SELECTED, body: considered(['estate'], 'high') },
    'comfort-midpoint': { ...SELECTED, comfort: considered(50) } }[name] ?? SELECTED;
  const categories = Object.fromEntries(ORDER.map((key) => [key, structuredClone(start[key] ?? { state: 'unset' })]));
  const refusal = name === 'save-failed' ? { status: 'unavailable', retryable: true } : name === 'stale' ? { status: 'stale-version', action: 'refresh' } : null;
  return {
    async loadEditor() {
      return { status: 'ok', value: { context: { accountPreferences: { order: ORDER, minimumCategories: 3, policyVersion: 'preview', categories: CATEGORIES } },
        initial: { briefVersion: 1, draftVersion, accountPreferences: { considered: 0, categories: structuredClone(categories) } }, selection: null } };
    },
    async savePreferences({ changes }) {
      if (name === 'pending') return new Promise(() => {}); // an in-flight save that never answers
      if (refusal) return structuredClone(refusal);
      for (const [key, change] of Object.entries(changes)) {
        const was = categories[key];
        if (change === null) { categories[key] = { state: 'unset' }; continue; }
        categories[key] = considered(Object.hasOwn(change, 'value') ? change.value : was.value, change.importance ?? (was.state === 'considered' ? was.importance : 'medium'));
      }
      draftVersion += 1;
      return { status: 'ok', value: { briefVersion: 1, draftVersion, accountPreferences: { considered: 0, categories: structuredClone(categories) } } };
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
}
