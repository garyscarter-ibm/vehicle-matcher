// Offline generator for src/test/resources/recommendation-parity/scoring-cases.json (never run by the Java tests).
// Run from the repository root: node services/gcsp-api/src/test/parity/recommendation-scoring-parity.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  confirmedFact, unselectedPracticalAnswer, unselectedPreference, chargingGates, validateBrief, validateBriefContent,
  validChoice, choiceList, intentValue, evaluateEssentials, scorePreferences, rankEmployeeRecommendations,
} from '../../../../../server/scenarios/employee/index.js';
import { scoreOptionEvidence } from '../../../../../server/scenarios/employee/option-evidence.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../../..');
const outPath = join(here, '../resources/recommendation-parity/scoring-cases.json');
const seed = JSON.parse(await readFile(join(root, 'server/gcsp/policy/seed-v1.json'), 'utf8'));
const seedValue = seed.assumptions.find((row) => row.key === 'employee.recommendation.v1').value;
const clone = (value) => JSON.parse(JSON.stringify(value));

// configurationValid is not exported by Node, so lift its source verbatim from the service module.
const serviceSource = await readFile(join(root, 'server/gcsp/recommendation/index.js'), 'utf8');
const configurationValidSource = serviceSource.match(/\nfunction configurationValid[\s\S]*?\n}\n/)[0];
const configurationValid = new Function('text', `${configurationValidSource}\nreturn configurationValid;`)(
  (value) => typeof value === 'string' && value.trim().length > 0);

const FUNCTIONS = { confirmedFact, unselectedPracticalAnswer, unselectedPreference, chargingGates, validateBrief,
  validateBriefContent, validChoice, choiceList, intentValue, evaluateEssentials, scorePreferences,
  rankEmployeeRecommendations, scoreOptionEvidence, configurationValid: (...args) => Boolean(configurationValid(...args)) };

// Placeholders keep the 18 KB policy out of the fixture: {$seed:{path?,set?,delete?}} is the seeded
// assumption (or one of its top-level keys) with top-level edits; {$undefined:true} is JS undefined.
const seedRef = ({ path = null, set = {}, delete: removed = [] }) => {
  const base = clone(path === null ? seedValue : seedValue[path]);
  for (const [key, value] of Object.entries(set)) base[key] = clone(value);
  for (const key of removed) delete base[key];
  return base;
};
const resolve = (value) => {
  if (Array.isArray(value)) return value.map(resolve);
  if (value && typeof value === 'object') {
    if ('$fact' in value) return factOf(...value.$fact);
    if ('$seed' in value) return seedRef(value.$seed);
    if ('$undefined' in value) return undefined;
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, resolve(inner)]));
  }
  return value;
};
// {$fact:[value,unit,assurance]} stands for the fixture fact below; it keeps the fixture file small.
const NOW = '2026-11-05T12:00:00.000Z';
const factOf = (value, unit = null, assurance = value === null ? 'unknown' : 'synthetic-scenario') => ({
  status: value === null ? 'unknown' : 'known', value, unit,
  provenance: { sourceRef: 'fixture:employee', observedAt: NOW, version: 'facts-v1', assurance } });
const pack = (value) => {
  if (Array.isArray(value)) return value.map(pack);
  if (!value || typeof value !== 'object') return value;
  const keys = Object.keys(value);
  if (keys.length === 4 && keys.join() === 'status,value,unit,provenance' && 'value' in value && value.value !== undefined) {
    const { assurance } = value.provenance ?? {};
    const rebuilt = JSON.stringify(factOf(value.value, value.unit, assurance));
    if (JSON.stringify(value) === rebuilt && assurance !== undefined) return { $fact: assurance === (value.value === null ? 'unknown' : 'synthetic-scenario') ? (value.unit === null ? [value.value] : [value.value, value.unit]) : [value.value, value.unit, assurance] };
  }
  return Object.fromEntries(keys.map((key) => [key, pack(value[key])]));
};
const cfg = (set = {}, removed = []) => ({ $seed: { set, delete: removed } });
const UNDEF = { $undefined: true };

const cases = [];
const add = (name, fn, args) => {
  const live = clone(args.map((arg) => (arg === undefined ? null : arg))).map(resolve);
  let expected;
  try { expected = JSON.parse(JSON.stringify(FUNCTIONS[fn](...live)) ?? 'null'); } catch { expected = { throws: true }; }
  cases.push({ name, fn, args: pack(clone(args)), expected: pack(expected) });
};

// ---- builders -------------------------------------------------------------------------------------------
const slider = { minimum: 0, maximum: 100 };
const prov = (assurance = 'synthetic-scenario') => ({ sourceRef: 'fixture:employee', observedAt: NOW, version: 'facts-v1', assurance });
const fact = (value, unit = null, assurance = 'synthetic-scenario') => ({ status: value === null ? 'unknown' : 'known', value, unit,
  provenance: prov(value === null ? 'unknown' : assurance) });
const pref = (value, importance = 100, extra = {}) => ({ value, importance, valueState: 'confirmed', importanceState: 'confirmed',
  source: 'employee', ...extra });
const essential = (value, operator = 'gte', unit = 'count', state = 'confirmed') => ({ value, operator, unit, state, source: 'employee' });
const baseFacts = () => ({ eligibilityModelKey: fact('G21 Touring|320i'), body: fact('estate'), fuel: fact('petrol'),
  seats: fact(5, 'count'), boot: fact(500, 'L'), zeroTo62: fact(7, 's'), mpg: fact(45, 'mpg-imperial'),
  sizeClass: fact(3, 'ordinal-1-5'), tags: fact(['cruiser']) });
const snap = (facts = {}, name = 'Synthetic exact car') => {
  const merged = { ...baseFacts(), ...facts };
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return { display: { name }, facts: merged };
};
const homeEmployee = () => ({ charging: fact('home'), annualMileage: fact(12000, 'mi/year') });
const sel = (codes, extra = {}) => ({ kind: 'selected-catalogue', complete: true, codes, ...extra });
const optionFact = (selection, assurance = 'confirmed-build') => fact(selection, null, assurance);
const prefs = (map) => ({ schemaVersion: 1, preferences: map, essentials: {} });

// ---- confirmedFact / unselected* ------------------------------------------------------------------------
const C = cfg();
const factVariants = {
  ok: fact('petrol'), listing: fact('petrol', null, 'confirmed-listing'), build: fact('petrol', null, 'confirmed-build'),
  unknown: fact(null), badAssurance: fact('petrol', null, 'estimated'), zero: fact(0, 'count'), falseValue: fact(false),
  noProvenance: { status: 'known', value: 'petrol' }, nullProvenance: { status: 'known', value: 'x', provenance: null },
  blankRef: { ...fact('petrol'), provenance: { ...prov(), sourceRef: '  ' } }, noVersion: { ...fact('petrol'), provenance: { ...prov(), version: undefined } },
  badInstant: { ...fact('petrol'), provenance: { ...prov(), observedAt: '2026-02-30T00:00:00Z' } },
  badFormat: { ...fact('petrol'), provenance: { ...prov(), observedAt: '2026-11-05 12:00:00' } },
  offsetInstant: { ...fact('petrol'), provenance: { ...prov(), observedAt: '2026-11-05T12:00:00+01:00' } },
  hour24: { ...fact('petrol'), provenance: { ...prov(), observedAt: '2026-11-05T24:00:00Z' } },
  statusUnknownWithValue: { ...fact('petrol'), status: 'unknown' }, undefinedValue: { status: 'known', provenance: prov() },
};
for (const [name, value] of Object.entries(factVariants)) add(`confirmedFact ${name}`, 'confirmedFact', [value, C]);
add('confirmedFact undefined', 'confirmedFact', [UNDEF, C]);
add('confirmedFact null', 'confirmedFact', [null, C]);
add('confirmedFact no assurances', 'confirmedFact', [fact('x'), cfg({ confirmedAssurances: [] })]);
add('confirmedFact missing assurances list', 'confirmedFact', [fact('x'), cfg({}, ['confirmedAssurances'])]);
const placeholder = { source: 'policy:brief.editor.v1', state: 'needs-confirmation', value: null };
for (const [name, value] of [['placeholder', placeholder], ['other source', { ...placeholder, source: 'employee' }],
  ['confirmed state', { ...placeholder, state: 'confirmed' }], ['value set', { ...placeholder, value: 3 }],
  ['value undefined', { source: 'policy:brief.editor.v1', state: 'needs-confirmation' }], ['null', null], ['undefined', UNDEF]]) {
  add(`unselectedPracticalAnswer ${name}`, 'unselectedPracticalAnswer', [value === undefined ? UNDEF : value]);
}
const draftPref = { source: 'policy:brief.editor.v1', valueState: 'draft', importanceState: 'draft', value: 'estate', importance: 0 };
for (const [name, value] of [['draft', draftPref], ['value confirmed', { ...draftPref, valueState: 'confirmed' }],
  ['importance inferred', { ...draftPref, importanceState: 'inferred' }], ['other source', { ...draftPref, source: 'employee' }],
  ['null', null], ['undefined', UNDEF]]) add(`unselectedPreference ${name}`, 'unselectedPreference', [value]);

// ---- choices --------------------------------------------------------------------------------------------
const bodyDef = seedValue.preferences.body;
const fuelDef = seedValue.preferences.fuel;
const sliderDef = seedValue.preferences.sportiness;
for (const [name, value] of [['scalar', 'estate'], ['unknown scalar', 'tractor'], ['ordered pair', ['estate', 'suv']],
  ['unordered pair', ['suv', 'estate']], ['duplicate', ['suv', 'suv']], ['empty', []], ['single array', ['mpv']],
  ['contains unknown', ['estate', 'tractor']], ['number', 3], ['null', null], ['all', bodyDef.values], ['nested', [['estate']]],
  ['reversed', [...bodyDef.values].reverse()]]) {
  add(`validChoice body ${name}`, 'validChoice', [value, bodyDef]);
  add(`choiceList ${name}`, 'choiceList', [value]);
  add(`intentValue ${name}`, 'intentValue', [value]);
}
add('validChoice array against single-choice enum', 'validChoice', [['a'], { values: ['a', 'b'] }]);
add('validChoice multiple=false', 'validChoice', [['a'], { values: ['a', 'b'], multiple: false }]);
add('validChoice slider definition', 'validChoice', [5, sliderDef]);
add('validChoice fuel pair', 'validChoice', [['petrol', 'ev'], fuelDef]);
add('validChoice fuel unordered', 'validChoice', [['ev', 'petrol'], fuelDef]);
add('choiceList undefined', 'choiceList', [UNDEF]);
add('intentValue undefined', 'intentValue', [UNDEF]);
add('intentValue empty array', 'intentValue', [[]]);

// ---- brief validation -----------------------------------------------------------------------------------
const goodBrief = () => ({ schemaVersion: 1, briefVersion: 3, requiredBy: '2026-12-01T00:00:00.000Z',
  preferences: { body: pref(['estate', 'suv']), fuel: pref('petrol'), sportiness: pref(40, 50), comfort: pref(0, 0),
    economy: pref(100, 100), size: pref(50, 75) },
  essentials: { seats: essential(5), boot: essential(400, 'gte', 'L'), equipment: essential(['heated-seats'], 'includes', 'equipment-key'),
    body: essential('estate', 'equals', null), fuel: essential('petrol', 'equals', null), frontIsofix: essential(true, 'equals', null),
    rearIsofix: essential(false, 'equals', null), modelLine: essential('G21', 'equals', null) } });
const mutate = (fn) => { const brief = goodBrief(); fn(brief); return brief; };
const briefVariants = {
  'valid full': goodBrief(),
  'valid without briefVersion': (() => { const b = goodBrief(); delete b.briefVersion; return b; })(),
  'empty maps': { schemaVersion: 1, briefVersion: 1, preferences: {}, essentials: {} },
  'extra top-level key': mutate((b) => { b.extra = 1; }),
  'schemaVersion 2': mutate((b) => { b.schemaVersion = 2; }),
  'schemaVersion string': mutate((b) => { b.schemaVersion = '1'; }),
  'missing schemaVersion': mutate((b) => { delete b.schemaVersion; }),
  'briefVersion 0': mutate((b) => { b.briefVersion = 0; }),
  'briefVersion negative': mutate((b) => { b.briefVersion = -2; }),
  'briefVersion fractional': mutate((b) => { b.briefVersion = 1.5; }),
  'briefVersion string': mutate((b) => { b.briefVersion = '1'; }),
  'briefVersion safe max': mutate((b) => { b.briefVersion = Number.MAX_SAFE_INTEGER; }),
  'briefVersion unsafe': mutate((b) => { b.briefVersion = 2 ** 53; }),
  'briefVersion huge': mutate((b) => { b.briefVersion = 1e300; }),
  'preferences array': mutate((b) => { b.preferences = []; }),
  'preferences null': mutate((b) => { b.preferences = null; }),
  'essentials missing': mutate((b) => { delete b.essentials; }),
  'essentials string': mutate((b) => { b.essentials = 'x'; }),
  'unknown preference key': mutate((b) => { b.preferences.colour = pref('red'); }),
  'inherited preference key': mutate((b) => { b.preferences.toString = pref('red'); }),
  'constructor preference key': mutate((b) => { b.preferences.constructor = pref(5); }),
  'preference null': mutate((b) => { b.preferences.body = null; }),
  'preference extra field': mutate((b) => { b.preferences.fuel.extra = 1; }),
  'importance 101': mutate((b) => { b.preferences.fuel.importance = 101; }),
  'importance negative': mutate((b) => { b.preferences.fuel.importance = -1; }),
  'importance fractional': mutate((b) => { b.preferences.fuel.importance = 50.5; }),
  'importance string': mutate((b) => { b.preferences.fuel.importance = '50'; }),
  'importance missing': mutate((b) => { delete b.preferences.fuel.importance; }),
  'valueState bogus': mutate((b) => { b.preferences.fuel.valueState = 'sure'; }),
  'valueState needs-confirmation': mutate((b) => { b.preferences.fuel.valueState = 'needs-confirmation'; }),
  'importanceState bogus': mutate((b) => { b.preferences.fuel.importanceState = 'sure'; }),
  'source empty': mutate((b) => { b.preferences.fuel.source = ''; }),
  'source blank': mutate((b) => { b.preferences.fuel.source = ' \t '; }),
  'source number': mutate((b) => { b.preferences.fuel.source = 4; }),
  'confirmedAt valid': mutate((b) => { b.preferences.fuel.confirmedAt = NOW; }),
  'confirmedAt bad day': mutate((b) => { b.preferences.fuel.confirmedAt = '2026-02-30T00:00:00Z'; }),
  'confirmedAt not a date': mutate((b) => { b.preferences.fuel.confirmedAt = 'yesterday'; }),
  'confirmedAt null': mutate((b) => { b.preferences.fuel.confirmedAt = null; }),
  'slider value above range': mutate((b) => { b.preferences.sportiness.value = 101; }),
  'slider value fractional': mutate((b) => { b.preferences.sportiness.value = 10.5; }),
  'slider value string': mutate((b) => { b.preferences.sportiness.value = '10'; }),
  'slider value array': mutate((b) => { b.preferences.sportiness.value = [10]; }),
  'slider value zero and max': mutate((b) => { b.preferences.sportiness.value = 0; b.preferences.comfort.value = 100; }),
  'enum value unknown': mutate((b) => { b.preferences.body.value = 'tractor'; }),
  'enum unordered multiple': mutate((b) => { b.preferences.body.value = ['suv', 'estate']; }),
  'enum duplicate multiple': mutate((b) => { b.preferences.body.value = ['suv', 'suv']; }),
  'enum empty multiple': mutate((b) => { b.preferences.body.value = []; }),
  'enum multiple ordered all': mutate((b) => { b.preferences.body.value = bodyDef.values; }),
  'enum number': mutate((b) => { b.preferences.fuel.value = 3; }),
  'fuel multiple ordered': mutate((b) => { b.preferences.fuel.value = ['petrol', 'ev']; }),
  'essential unknown key': mutate((b) => { b.essentials.sunroof = essential(true, 'equals', null); }),
  'essential inherited key': mutate((b) => { b.essentials.valueOf = essential(true, 'equals', null); }),
  'essential operator mismatch': mutate((b) => { b.essentials.seats.operator = 'equals'; }),
  'essential unit mismatch': mutate((b) => { b.essentials.seats.unit = 'L'; }),
  'essential state bogus': mutate((b) => { b.essentials.seats.state = 'maybe'; }),
  'essential needs-confirmation': mutate((b) => { b.essentials.seats.state = 'needs-confirmation'; }),
  'essential null value confirmed': mutate((b) => { b.essentials.seats.value = null; }),
  'essential null value placeholder': mutate((b) => { b.essentials.seats = { ...essential(null), state: 'needs-confirmation' }; }),
  'essential value missing': mutate((b) => { delete b.essentials.seats.value; }),
  'essential extra field': mutate((b) => { b.essentials.seats.extra = 1; }),
  'essential source blank': mutate((b) => { b.essentials.seats.source = ' '; }),
  'essential confirmedAt bad': mutate((b) => { b.essentials.seats.confirmedAt = 'x'; }),
  'essential confirmedAt good': mutate((b) => { b.essentials.seats.confirmedAt = NOW; }),
  'seats fractional': mutate((b) => { b.essentials.seats.value = 4.5; }),
  'seats negative': mutate((b) => { b.essentials.seats.value = -1; }),
  'seats zero': mutate((b) => { b.essentials.seats.value = 0; }),
  'seats string': mutate((b) => { b.essentials.seats.value = '5'; }),
  'boot fractional ok': mutate((b) => { b.essentials.boot.value = 410.5; }),
  'boot negative': mutate((b) => { b.essentials.boot.value = -0.5; }),
  'boot huge': mutate((b) => { b.essentials.boot.value = 1e300; }),
  'body empty string': mutate((b) => { b.essentials.body.value = ''; }),
  'body blank string': mutate((b) => { b.essentials.body.value = '   '; }),
  'body number': mutate((b) => { b.essentials.body.value = 3; }),
  'isofix string': mutate((b) => { b.essentials.frontIsofix.value = 'yes'; }),
  'equipment not array': mutate((b) => { b.essentials.equipment.value = 'heated-seats'; }),
  'equipment empty': mutate((b) => { b.essentials.equipment.value = []; }),
  'equipment blank item': mutate((b) => { b.essentials.equipment.value = ['x', ' ']; }),
  'equipment number item': mutate((b) => { b.essentials.equipment.value = [1]; }),
  'requiredBy bad': mutate((b) => { b.requiredBy = '2026-13-01T00:00:00Z'; }),
  'requiredBy date only': mutate((b) => { b.requiredBy = '2026-12-01'; }),
  'requiredBy offset': mutate((b) => { b.requiredBy = '2026-12-01T08:00:00+05:30'; }),
  'requiredBy number': mutate((b) => { b.requiredBy = 5; }),
  'requiredBy null': mutate((b) => { b.requiredBy = null; }),
  'requiredBy missing': mutate((b) => { delete b.requiredBy; }),
  'many errors in order': mutate((b) => { b.requiredBy = 'x'; b.essentials.seats.unit = 'x'; b.preferences.fuel.importance = 500; b.preferences.zzz = pref(1); }),
  'array request': [], 'null request': null, 'string request': 'x',
};
for (const [name, value] of Object.entries(briefVariants)) {
  add(`validateBrief ${name}`, 'validateBrief', [value, C, slider]);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const { briefVersion, ...content } = value;
    add(`validateBriefContent ${name}`, 'validateBriefContent', [content, C, slider]);
  }
}
add('validateBriefContent with briefVersion', 'validateBriefContent', [goodBrief(), C, slider]);
add('validateBrief narrow slider', 'validateBrief', [goodBrief(), C, { minimum: 10, maximum: 60 }]);
add('validateBrief narrow slider ok', 'validateBrief', [{ schemaVersion: 1, briefVersion: 1, preferences: { sportiness: pref(30, 30) }, essentials: {} }, C, { minimum: 10, maximum: 60 }]);
add('validateBrief enum registry order custom', 'validateBrief', [{ schemaVersion: 1, briefVersion: 1, preferences: { body: pref(['suv', 'coupe'], 10) }, essentials: {} },
  cfg({ preferences: { body: { ...bodyDef, values: ['suv', 'coupe'] } } }), slider]);
add('validateBrief essential enum type', 'validateBrief', [{ schemaVersion: 1, briefVersion: 1, preferences: {}, essentials: { seats: essential(5) } },
  cfg({ essentials: { seats: { operator: 'gte', type: 'enum', unit: 'count', values: [4, 5, 7] } } }), slider]);
add('validateBrief essential enum type invalid', 'validateBrief', [{ schemaVersion: 1, briefVersion: 1, preferences: {}, essentials: { seats: essential(6) } },
  cfg({ essentials: { seats: { operator: 'gte', type: 'enum', unit: 'count', values: [4, 5, 7] } } }), slider]);

// ---- essentials -----------------------------------------------------------------------------------------
const ess = (map) => ({ essentials: map });
const essCases = {
  'gte met': [snap(), ess({ seats: essential(5) })], 'gte unmet': [snap(), ess({ seats: essential(7) })],
  'gte zero shortcut without fact': [snap({ seats: undefined }), ess({ seats: essential(0) })],
  'gte zero unconfirmed state': [snap(), ess({ seats: essential(0, 'gte', 'count', 'draft') })],
  'gte unconfirmed requirement': [snap(), ess({ seats: essential(5, 'gte', 'count', 'inferred') })],
  'gte needs-confirmation': [snap(), ess({ seats: { ...essential(null), state: 'needs-confirmation' } })],
  'gte fact missing': [snap({ seats: undefined }), ess({ seats: essential(5) })],
  'gte fact unknown': [snap({ seats: fact(null) }), ess({ seats: essential(5) })],
  'gte wrong assurance': [snap({ seats: fact(5, 'count', 'estimated') }), ess({ seats: essential(5) })],
  'gte non-numeric fact': [snap({ seats: fact('five') }), ess({ seats: essential(5) })],
  'gte equal boundary': [snap({ boot: fact(400, 'L') }), ess({ boot: essential(400, 'gte', 'L') })],
  'gte fractional': [snap({ boot: fact(399.9, 'L') }), ess({ boot: essential(400, 'gte', 'L') })],
  'equals met': [snap(), ess({ body: essential('estate', 'equals', null) })],
  'equals unmet': [snap(), ess({ body: essential('suv', 'equals', null) })],
  'equals boolean': [snap({ frontIsofix: fact(true) }), ess({ frontIsofix: essential(true, 'equals', null) })],
  'equals false fact': [snap({ rearIsofix: fact(false) }), ess({ rearIsofix: essential(false, 'equals', null) })],
  'equals unknown fact': [snap({ rearIsofix: fact(null) }), ess({ rearIsofix: essential(false, 'equals', null) })],
  'equals type mismatch': [snap({ seats: fact(5) }), ess({ seats: essential('5', 'equals', 'count') })],
  'includes empty shortcut': [snap({ equipment: undefined }), ess({ equipment: essential([], 'includes', 'equipment-key') })],
  'includes empty draft': [snap({ equipment: undefined }), ess({ equipment: essential([], 'includes', 'equipment-key', 'draft') })],
  'includes met': [snap({ equipment: fact({ 'heated-seats': true, sunroof: false }) }), ess({ equipment: essential(['heated-seats'], 'includes', 'equipment-key') })],
  'includes unmet': [snap({ equipment: fact({ 'heated-seats': true, sunroof: false }) }), ess({ equipment: essential(['heated-seats', 'sunroof'], 'includes', 'equipment-key') })],
  'includes missing key': [snap({ equipment: fact({ 'heated-seats': true }) }), ess({ equipment: essential(['heated-seats', 'sunroof'], 'includes', 'equipment-key') })],
  'includes non-boolean key': [snap({ equipment: fact({ 'heated-seats': 'yes' }) }), ess({ equipment: essential(['heated-seats'], 'includes', 'equipment-key') })],
  'includes several missing': [snap({ equipment: fact({}) }), ess({ equipment: essential(['a', 'b'], 'includes', 'equipment-key') })],
  'includes fact is array': [snap({ equipment: fact(['heated-seats']) }), ess({ equipment: essential(['heated-seats'], 'includes', 'equipment-key') })],
  'includes fact is string': [snap({ equipment: fact('heated-seats') }), ess({ equipment: essential(['heated-seats'], 'includes', 'equipment-key') })],
  'includes fact missing': [snap(), ess({ equipment: essential(['heated-seats'], 'includes', 'equipment-key') })],
  'includes inherited key': [snap({ equipment: fact({ a: true }) }), ess({ equipment: essential(['toString'], 'includes', 'equipment-key') })],
  'unknown operator': [snap(), ess({ seats: { ...essential(5), operator: 'lte' } })],
  'several mixed in order': [snap(), ess({ body: essential('suv', 'equals', null), seats: essential(5), boot: essential(900, 'gte', 'L'), fuel: essential('petrol', 'equals', null), modelLine: essential('G21', 'equals', null) })],
  'empty essentials': [snap(), ess({})],
  'includes requirement not array': [snap({ equipment: fact({ a: true }) }), ess({ equipment: { ...essential('a', 'includes', 'equipment-key') } })],
};
for (const [name, [snapshot, brief]] of Object.entries(essCases)) {
  add(`evaluateEssentials ${name}`, 'evaluateEssentials', [snapshot, brief, C]);
  add(`evaluateEssentials optionalDefaults ${name}`, 'evaluateEssentials', [snapshot, brief, C, { optionalDefaults: true }]);
}
add('evaluateEssentials placeholder skipped', 'evaluateEssentials', [snap(), ess({ seats: placeholder, boot: essential(900, 'gte', 'L') }), C, { optionalDefaults: true }]);
add('evaluateEssentials placeholder kept without option', 'evaluateEssentials', [snap(), ess({ seats: { ...placeholder, operator: 'gte', unit: 'count' } }), C]);
add('evaluateEssentials placeholder with empty options', 'evaluateEssentials', [snap(), ess({ seats: placeholder }), C, {}]);
add('evaluateEssentials missing facts container', 'evaluateEssentials', [{ display: { name: 'x' } }, ess({ seats: essential(5) }), C]);
add('evaluateEssentials null snapshot', 'evaluateEssentials', [null, ess({ seats: essential(5) }), C]);
add('evaluateEssentials missing essentials', 'evaluateEssentials', [snap(), {}, C]);

// ---- charging gates -------------------------------------------------------------------------------------
const gateSnap = (fuel) => snap({ fuel });
for (const [fuelName, fuelFact] of [['petrol', fact('petrol')], ['diesel', fact('diesel')], ['ev', fact('ev')], ['phev', fact('phev')],
  ['unknown fuel', fact(null)], ['missing fuel', undefined], ['unlisted fuel', fact('hydrogen')], ['estimated fuel', fact('ev', null, 'estimated')]]) {
  for (const [chargeName, charging] of [['home', fact('home')], ['work', fact('work')], ['either', fact('either')], ['none', fact('none')],
    ['not-ready', fact('not-ready')], ['unknown', fact(null)], ['missing', undefined], ['estimated', fact('home', null, 'estimated')]]) {
    add(`chargingGates ${fuelName} ${chargeName}`, 'chargingGates', [gateSnap(fuelFact), { charging }, C, true]);
  }
  add(`chargingGates ${fuelName} not required`, 'chargingGates', [gateSnap(fuelFact), { charging: fact('none') }, C, false]);
}
add('chargingGates required falsy', 'chargingGates', [gateSnap(fact('ev')), {}, C, 0]);
add('chargingGates snapshot without facts', 'chargingGates', [{ display: { name: 'x' } }, {}, C, true]);
add('chargingGates employeeFacts missing', 'chargingGates', [gateSnap(fact('ev')), UNDEF, C, true]);

// ---- scorePreferences: hand cases -----------------------------------------------------------------------
let handIndex = 0;
const sp = (name, { snapshot = snap(), preferences, employee = homeEmployee(), config = C, sliderScale = slider, editor = false }) => {
  handIndex += 1;
  add(`scorePreferences ${name}`, 'scorePreferences', [snapshot, editor ? preferences : prefs(preferences), employee, config, sliderScale]);
};
const bodies = ['hatchback', 'saloon', 'estate', 'suv', 'coupe', 'convertible', 'mpv'];
for (const carBody of ['estate', 'suv', 'mpv']) {
  for (const [label, value] of [['single match', 'estate'], ['single miss', 'saloon'], ['multiple', ['estate', 'suv']], ['multiple miss', ['hatchback', 'coupe']],
    ['all', bodies]]) sp(`body ${carBody} ${label}`, { snapshot: snap({ body: fact(carBody) }), preferences: { body: pref(value, 80) } });
}
for (const carFuel of ['petrol', 'diesel', 'phev', 'ev']) {
  for (const [label, value] of [['petrol', 'petrol'], ['diesel list', ['diesel']], ['phev ev', ['phev', 'ev']], ['all four', ['petrol', 'diesel', 'phev', 'ev']], ['ev', 'ev']]) {
    for (const charging of ['home', 'none']) {
      sp(`fuel ${carFuel} ${label} charging ${charging}`, { snapshot: snap({ fuel: fact(carFuel) }), preferences: { fuel: pref(value, 90) },
        employee: { charging: fact(charging), annualMileage: fact(8000) } });
    }
  }
}
for (const [zero, label] of [[3, 'fast'], [7, 'mid'], [12, 'slow'], [2.5, 'quicker']]) {
  for (const value of [0, 50, 100]) sp(`sportiness ${label} desired ${value}`, { snapshot: snap({ zeroTo62: fact(zero, 's') }), preferences: { sportiness: pref(value, 70) } });
}
for (const [tags, label] of [[[], 'none'], [['cruiser'], 'cruiser'], [['cruiser', 'family'], 'cruiser family'], [['cruiser', 'cruiser'], 'duplicate']]) {
  for (const value of [0, 50, 100]) sp(`comfort ${label} desired ${value}`, { snapshot: snap({ tags: fact(tags) }), preferences: { comfort: pref(value, 70) } });
}
for (const [fuelName, mpg] of [['petrol', 20], ['petrol', 45], ['petrol', 70], ['diesel', 60], ['petrol', 25], ['petrol', 60], ['ev', 45], ['phev', 45]]) {
  for (const value of [0, 50, 100]) {
    for (const [mileLabel, annual] of [['none', undefined], ['0', fact(0)], ['low', fact(4000)], ['mid', fact(12000)], ['high', fact(20000)], ['clamped', fact(60000)], ['neg', fact(-500)]]) {
      if (value !== 100 && !['none', 'mid', 'clamped'].includes(mileLabel)) continue;
      if (value === 100 && ['0', 'neg'].includes(mileLabel) && mpg !== 45) continue;
      sp(`economy ${fuelName} ${mpg}mpg desired ${value} mileage ${mileLabel}`, { snapshot: snap({ fuel: fact(fuelName), mpg: fact(mpg) }),
        preferences: { economy: pref(value, 60) }, employee: { charging: fact('home'), annualMileage: annual } });
    }
  }
}
for (const charging of ['none', 'work', 'either', 'not-ready']) {
  for (const fuelName of ['ev', 'phev', 'petrol']) {
    sp(`economy ${fuelName} charging ${charging}`, { snapshot: snap({ fuel: fact(fuelName) }), preferences: { economy: pref(80, 60) },
      employee: { charging: fact(charging), annualMileage: fact(15000) } });
  }
}
sp('economy plug-in mpg missing is not needed', { snapshot: snap({ fuel: fact('ev'), mpg: undefined }), preferences: { economy: pref(90, 60) } });
sp('economy petrol mpg missing', { snapshot: snap({ mpg: undefined }), preferences: { economy: pref(90, 60) } });
sp('economy petrol mpg unknown', { snapshot: snap({ mpg: fact(null) }), preferences: { economy: pref(90, 60) } });
sp('economy fuel missing', { snapshot: snap({ fuel: undefined }), preferences: { economy: pref(90, 60) } });
for (const size of [1, 2, 3, 4, 5]) for (const value of [0, 50, 100]) sp(`size class ${size} desired ${value}`, { snapshot: snap({ sizeClass: fact(size) }), preferences: { size: pref(value, 60) } });
sp('every preference together', { preferences: { body: pref(['estate', 'suv'], 100), fuel: pref(['petrol', 'diesel'], 80), sportiness: pref(30, 40),
  comfort: pref(60, 20), economy: pref(75, 90), size: pref(50, 10) } });
sp('every preference at importance 0', { preferences: { body: pref('estate', 0), fuel: pref('petrol', 0), sportiness: pref(30, 0), comfort: pref(60, 0), economy: pref(75, 0), size: pref(50, 0) } });
sp('importance 0 skip mixed', { preferences: { body: pref('estate', 0), fuel: pref('petrol', 50), sportiness: pref(30, 0) } });
sp('importance 0 but unconfirmed still skipped', { preferences: { body: pref('estate', 0, { valueState: 'draft' }) } });
sp('value unconfirmed', { preferences: { body: pref('estate', 50, { valueState: 'inferred' }), fuel: pref('petrol', 50) } });
sp('importance unconfirmed', { preferences: { body: pref('estate', 50, { importanceState: 'draft' }), fuel: pref('petrol', 50) } });
sp('editor placeholder skipped', { preferences: { body: { source: 'policy:brief.editor.v1', valueState: 'draft', importanceState: 'draft', value: 'estate', importance: 80 }, fuel: pref('petrol', 50) } });
sp('editor placeholder partly confirmed', { preferences: { body: { source: 'policy:brief.editor.v1', valueState: 'confirmed', importanceState: 'draft', value: 'estate', importance: 80 } } });
sp('no preferences', { preferences: {} });
sp('preference unknown key', { preferences: { colour: pref('red') } });
sp('preference importance undefined', { preferences: { body: { value: 'estate', valueState: 'confirmed', importanceState: 'confirmed', source: 'employee' } } });
sp('preference null', { preferences: { body: null } });
sp('slider value fractional', { preferences: { sportiness: pref(33.3, 50), size: pref(66.6, 50) } });
sp('narrow slider scale', { preferences: { sportiness: pref(30, 50), body: pref('estate', 50), economy: pref(40, 30) }, sliderScale: { minimum: 10, maximum: 60 } });
sp('slider scale skips importance equal minimum', { preferences: { sportiness: pref(30, 10), body: pref('estate', 50) }, sliderScale: { minimum: 10, maximum: 60 } });
sp('missing display', { snapshot: { facts: baseFacts() }, preferences: { body: pref('estate') } });
sp('facts missing', { snapshot: { display: { name: 'x' } }, preferences: { body: pref('estate') } });
sp('fact status not known', { snapshot: snap({ body: { status: 'estimated', value: 'estate', provenance: prov() } }), preferences: { body: pref('estate') } });
sp('known fact null value', { snapshot: snap({ body: { status: 'known', value: null, provenance: prov() } }), preferences: { body: pref('estate') } });
sp('known fact undefined value', { snapshot: snap({ body: { status: 'known', provenance: prov() } }), preferences: { body: pref('estate') } });
for (const field of ['body', 'fuel', 'zeroTo62', 'tags', 'sizeClass']) {
  const key = { body: 'body', fuel: 'fuel', zeroTo62: 'sportiness', tags: 'comfort', sizeClass: 'size' }[field];
  const value = { body: 'estate', fuel: 'petrol', sportiness: 50, comfort: 50, size: 50 }[key];
  sp(`model fact ${field} missing, no option evidence`, { snapshot: snap({ [field]: undefined }), preferences: { [key]: pref(value, 50) } });
  sp(`model fact ${field} unknown, no option evidence`, { snapshot: snap({ [field]: fact(null) }), preferences: { [key]: pref(value, 50) } });
  sp(`model fact ${field} missing, option evidence unselected`, { snapshot: snap({ [field]: undefined }), preferences: { [key]: pref(value, 50) } });
}
// Models without facts but with a reviewed option selection (unknownModelAnchor).
const comfortSel = sel(['S0451', 'S0453', 'S0459', 'S0494']);
const sportSel = sel(['S02NH', 'S02T4', 'S0337', 'S033B']);
for (const [label, selection] of [['comfort', comfortSel], ['sport', sportSel], ['empty', sel([])], ['incomplete', sel(['S0451'], { complete: false })],
  ['verified', sel(['S0451', 'S02NH'], { kind: 'verified-fitted' })], ['activation missing', sel(['S06C4', 'S04U8'])],
  ['activation present', sel(['S06C4', 'S04U8'], { activeCodes: ['S04U8'] })], ['disabled by', sel(['S0704', 'S0225'])],
  ['unknown codes', sel(['ZZZZ', 'S0451'])], ['malformed', { kind: 'selected-catalogue', complete: true, codes: ['bad code'] }],
  ['bundle only', sel(['S07LG'])], ['bundle and members', sel(['S07LG', 'S0494', 'S0451', 'S0459'])], ['sport bundle with members', sel(['S0337', 'S02NH', 'S02T4'])],
  ['sport bundle only', sel(['S033B'])], ['negative evidence', sel(['FBLAT', 'FECI2', 'S02VF'])], ['size and economy', sel(['S0235', 'S0465', 'S01CE', 'S04U6'])]]) {
  const full = snap({ optionSelection: optionFact(selection) });
  const partial = snap({ zeroTo62: undefined, tags: undefined, sizeClass: undefined, optionSelection: optionFact(selection) });
  sp(`options ${label} full model`, { snapshot: full, preferences: { sportiness: pref(60, 80), comfort: pref(60, 80), size: pref(40, 40), economy: pref(70, 40) } });
  sp(`options ${label} partial model`, { snapshot: partial, preferences: { sportiness: pref(60, 80), comfort: pref(60, 80), size: pref(40, 40), economy: pref(70, 40) } });
  sp(`options ${label} partial model all prefs`, { snapshot: snap({ body: undefined, fuel: undefined, zeroTo62: undefined, tags: undefined, sizeClass: undefined, mpg: undefined, optionSelection: optionFact(selection) }),
    preferences: { body: pref('estate', 50), fuel: pref('petrol', 50), sportiness: pref(60, 80), comfort: pref(60, 80), size: pref(40, 40), economy: pref(70, 40) } });
}
sp('options estimated assurance ignored', { snapshot: snap({ optionSelection: optionFact(comfortSel, 'estimated') }), preferences: { comfort: pref(60, 80) } });
sp('options selection value null', { snapshot: snap({ optionSelection: { status: 'known', value: null, provenance: prov('confirmed-build') } }), preferences: { comfort: pref(60, 80) } });
sp('options selection invalid shape', { snapshot: snap({ optionSelection: optionFact({ kind: 'other', complete: true, codes: [] }) }), preferences: { comfort: pref(60, 80) } });
sp('options no preferences but complete spec', { snapshot: snap({ optionSelection: optionFact(comfortSel) }), preferences: {} });
sp('options only skipped preferences', { snapshot: snap({ optionSelection: optionFact(comfortSel) }), preferences: { comfort: pref(60, 0) } });
sp('options incomplete selection with no preferences', { snapshot: snap({ optionSelection: optionFact(sel(['S0451'], { complete: false })) }), preferences: {} });
sp('options unknown model pref body (non slider) skips', { snapshot: snap({ body: undefined, optionSelection: optionFact(comfortSel) }), preferences: { body: pref('estate', 60) } });
sp('options unknown model sportiness without adjustment', { snapshot: snap({ zeroTo62: undefined, optionSelection: optionFact(sel([])) }), preferences: { sportiness: pref(50, 60) } });
sp('options unknown model comfort without adjustment', { snapshot: snap({ tags: undefined, optionSelection: optionFact(sel([])) }), preferences: { comfort: pref(50, 60) } });
sp('options unknown model sportiness unselected spec', { snapshot: snap({ zeroTo62: undefined }), preferences: { sportiness: pref(50, 60) } });
// Enum evidence from options and the plug-in fuel restriction.
for (const carFuel of ['ev', 'phev', 'petrol']) {
  for (const value of ['ev', ['petrol', 'ev'], 'petrol', ['phev']]) {
    sp(`enum evidence fuel ${carFuel} desired ${JSON.stringify(value)}`, { snapshot: snap({ fuel: fact(carFuel), optionSelection: optionFact(sel(['SE000001'])) }), preferences: { fuel: pref(value, 70) } });
  }
}
sp('enum evidence fuel with selection also sport', { snapshot: snap({ fuel: fact('ev'), optionSelection: optionFact(sel(['SE000034', 'S02NH'])) }), preferences: { fuel: pref('ev', 70), sportiness: pref(60, 30) } });
const smallPolicy = { rule: 'reviewedEquipment.v1', version: 'equipment-v1', importance: 100, halfSaturationWeight: 10, sliderStep: 2.5,
  unknownModelAnchor: 50, maximumAdjustment: 20,
  options: { A: { group: 'comfort', weight: 1, evidence: { comfort: 1 } }, B: { group: 'comfort', weight: 2, evidence: { comfort: -2 } },
    C: { group: 'sport', weight: 1, evidence: { sportiness: 1 }, requiresActivation: true }, D: { group: 'interior', weight: 1, evidence: { body: 'estate' } },
    E: { group: 'interior', weight: 1, evidence: { body: 'saloon' } }, PACK: { group: 'pack', weight: 3, evidence: { comfort: 2, sportiness: 2 }, bundle: true },
    REPLACE: { group: 'replacement', weight: 1, evidence: { comfort: 3 } }, F: { group: 'efficiency', weight: 1.5, evidence: { economy: 2, size: -1 } } },
  bundleFamilies: { technology: { groups: ['pack'], members: ['comfort', 'sport'] } }, disabledBy: { A: ['REPLACE'] } };
const smallCfg = cfg({ optionEvidence: smallPolicy });
for (const [label, codes, extra] of [['body enum estate', ['D'], {}], ['body enum both', ['D', 'E'], {}], ['body enum saloon', ['E'], {}],
  ['replace disables', ['A', 'REPLACE'], {}], ['activation off', ['C'], {}], ['activation on', ['C'], { activeCodes: ['C'] }],
  ['pack with members', ['PACK', 'A', 'C'], { activeCodes: ['C'] }], ['pack alone', ['PACK'], {}], ['negative comfort', ['A', 'B'], {}], ['efficiency', ['F'], {}]]) {
  for (const carBody of ['estate', 'saloon']) {
    sp(`small policy ${label} car ${carBody}`, { snapshot: snap({ body: fact(carBody), optionSelection: optionFact(sel(codes, extra)) }), config: smallCfg,
      preferences: { body: pref(['estate', 'saloon'], 60), comfort: pref(70, 50), sportiness: pref(30, 50), economy: pref(60, 30), size: pref(40, 30) } });
  }
}
sp('small policy fractional step', { snapshot: snap({ optionSelection: optionFact(sel(['A', 'F'])) }), config: cfg({ optionEvidence: { ...smallPolicy, sliderStep: 0.37, halfSaturationWeight: 3.3 } }),
  preferences: { comfort: pref(63, 77), economy: pref(41, 59) } });
for (const [label, mutateFn] of [['bad rule', (p) => { p.rule = 'other'; }], ['importance 99', (p) => { p.importance = 99; }], ['halfSaturation 0', (p) => { p.halfSaturationWeight = 0; }],
  ['sliderStep negative', (p) => { p.sliderStep = -1; }], ['anchor 101', (p) => { p.unknownModelAnchor = 101; }], ['maximumAdjustment string', (p) => { p.maximumAdjustment = '20'; }],
  ['options array', (p) => { p.options = []; }], ['entry weight 4', (p) => { p.options.A.weight = 4; }], ['entry bad evidence field', (p) => { p.options.A.evidence = { speed: 1 }; }],
  ['entry evidence out of range', (p) => { p.options.A.evidence = { comfort: 4 }; }], ['entry enum evidence invalid', (p) => { p.options.D.evidence = { body: 'tractor' }; }],
  ['entry number for enum field', (p) => { p.options.D.evidence = { body: 1 }; }], ['entry string for slider field', (p) => { p.options.A.evidence = { comfort: 'high' }; }],
  ['entry bundle string', (p) => { p.options.A.bundle = 'yes'; }], ['disabledBy bad code', (p) => { p.disabledBy.A = ['lower']; }],
  ['family groups not strings', (p) => { p.bundleFamilies.technology.groups = [1]; }], ['version number', (p) => { p.version = 3; }]]) {
  const policy = clone(smallPolicy); mutateFn(policy);
  sp(`invalid option policy ${label}`, { snapshot: snap({ optionSelection: optionFact(sel(['A'])) }), config: cfg({ optionEvidence: policy }), preferences: { comfort: pref(60, 50) } });
}
// Policy weights.
const allWeights = (value) => Object.fromEntries(Object.keys(seedValue.preferences).map((key) => [key, value]));
const mixedPrefs = { body: pref('estate', 100), fuel: pref('petrol', 80), sportiness: pref(30, 40), comfort: pref(60, 20), economy: pref(75, 90), size: pref(50, 10) };
for (const [label, weights] of [['all one', allWeights(1)], ['all zero', allWeights(0)], ['mixed', { body: 3, fuel: 0, sportiness: 2, comfort: 1, economy: 5, size: 0 }],
  ['large', allWeights(1000)], ['missing key', (() => { const w = allWeights(1); delete w.size; return w; })()], ['extra key', { ...allWeights(1), colour: 1 }],
  ['negative', { ...allWeights(1), body: -1 }], ['fractional', { ...allWeights(1), body: 1.5 }], ['string', { ...allWeights(1), body: '1' }], ['unsafe', { ...allWeights(1), body: 2 ** 53 }],
  ['null', null], ['array', []], ['number', 7], ['empty', {}]]) {
  sp(`policy weights ${label}`, { preferences: mixedPrefs, config: cfg({ preferenceWeights: weights }) });
  if (['all one', 'mixed', 'all zero', 'missing key'].includes(label)) sp(`policy weights ${label} with spec`, { snapshot: snap({ optionSelection: optionFact(comfortSel) }), preferences: mixedPrefs, config: cfg({ preferenceWeights: weights }) });
}
sp('policy weights absent with spec', { snapshot: snap({ optionSelection: optionFact(comfortSel) }), preferences: mixedPrefs });
sp('policy weights apply to a skipped preference', { preferences: { body: pref('estate', 0) }, config: cfg({ preferenceWeights: allWeights(2) }) });
sp('policy weights zero with spec only', { snapshot: snap({ optionSelection: optionFact(comfortSel) }), preferences: { body: pref('estate', 50) }, config: cfg({ preferenceWeights: allWeights(0) }) });
sp('policy weights invalid but no preferences', { preferences: {}, config: cfg({ preferenceWeights: { body: 1 } }) });
sp('policy weights invalid even when skipped', { preferences: { body: pref('estate', 0) }, config: cfg({ preferenceWeights: { body: 1 } }) });
// Retail engine paths: configuration variants that the seed does not use.
const withPref = (key, patch) => ({ preferences: { ...seedValue.preferences, [key]: { ...seedValue.preferences[key], ...patch } } });
sp('hard filter drops car (crew)', { snapshot: snap({ seats: fact(4) }), config: cfg(withPref('size', { answers: { people: 'crew' } })), preferences: { size: pref(50, 50) } });
sp('hard filter drops car (crew boot)', { snapshot: snap({ boot: fact(300) }), config: cfg(withPref('size', { answers: { people: 'crew' } })), preferences: { size: pref(50, 50) } });
sp('hard filter keeps car (crew)', { snapshot: snap({ seats: fact(7), boot: fact(500) }), config: cfg(withPref('size', { answers: { people: 'crew' } })), preferences: { size: pref(50, 50) } });
sp('hard filter drops car (family)', { snapshot: snap({ seats: fact(2) }), config: cfg(withPref('body', { answers: { people: 'family' } })), preferences: { body: pref('estate', 50) } });
sp('hard filter keeps car (family)', { snapshot: snap({ seats: fact(5) }), config: cfg(withPref('body', { answers: { people: 'family' } })), preferences: { body: pref('estate', 50) } });
sp('hard filter seats fact missing (crew)', { snapshot: snap({ seats: undefined }), config: cfg(withPref('body', { answers: { people: 'crew' } })), preferences: { body: pref('estate', 50) } });
sp('hard filter second preference unaffected', { snapshot: snap({ seats: fact(2) }), config: cfg(withPref('size', { answers: { people: 'crew' } })), preferences: { body: pref('estate', 50), size: pref(50, 50) } });
sp('retail budget enabled without answer throws', { config: cfg({ retailBudgetEnabled: true }), preferences: { body: pref('estate', 50) } });
sp('retail budget enabled with answer', { config: cfg({ retailBudgetEnabled: true, ...withPref('body', { answers: { budget: 60000 } }), tuning: { ...seedValue.tuning, stretchFactor: 1.15, weights: { ...seedValue.tuning.weights } } }),
  snapshot: snap({ priceMin: fact(40000), priceMax: fact(50000) }), preferences: { body: pref('estate', 50) } });
sp('retail budget enabled stretch drops car', { config: cfg({ retailBudgetEnabled: true, ...withPref('body', { answers: { budget: 30000 } }), tuning: { ...seedValue.tuning, stretchFactor: 1.15 } }),
  snapshot: snap({ priceMin: fact(50000), priceMax: fact(60000) }), preferences: { body: pref('estate', 50) } });
sp('retail budget scored as the dimension', { config: cfg({ retailBudgetEnabled: true, preferences: { ...seedValue.preferences, size: { ...seedValue.preferences.size, dimension: 'budget', answers: { budget: [20000, 60000] } } },
  tuning: { ...seedValue.tuning, stretchFactor: 1.15 } }), snapshot: snap({ priceMin: fact(40000), priceMax: fact(50000) }), preferences: { size: pref(50, 50) } });
for (const priceCase of [[10000, 15000], [15000, 70000], [70000, 80000], [10000, 30000], [30000, 90000], [90000, 100000]]) {
  sp(`budget dimension prices ${priceCase.join('-')}`, { config: cfg({ retailBudgetEnabled: true, preferences: { ...seedValue.preferences, size: { ...seedValue.preferences.size, dimension: 'budget', answers: { budget: [20000, 60000] } } },
    tuning: { ...seedValue.tuning, stretchFactor: 1.5 } }), snapshot: snap({ priceMin: fact(priceCase[0]), priceMax: fact(priceCase[1]) }), preferences: { size: pref(50, 50) } });
}
for (const [label, answers] of [['numeric', 50000], ['band', 'b3'], ['bad band', 'b9'], ['zero', 0], ['pair reversed', [60000, 20000]], ['bad pair', [0, 0]]]) {
  sp(`budget answer ${label}`, { config: cfg({ retailBudgetEnabled: true, preferences: { ...seedValue.preferences, size: { ...seedValue.preferences.size, dimension: 'budget', answers: { budget: answers } } },
    tuning: { ...seedValue.tuning, stretchFactor: 1.15 } }), snapshot: snap({ priceMin: fact(40000), priceMax: fact(50000) }), preferences: { size: pref(50, 50) } });
}
for (const [dimension, tuningExtra, answers] of [
  ['practicality', { practicality: { bootNeed: { small: 0, medium: 350, big: 500 }, seatsFloor: 4, crewBonusSeats: 7 } }, { people: 'family', primaryUse: 'family' }],
  ['practicality', { practicality: { bootNeed: { small: 0, medium: 350, big: 500 }, seatsFloor: 4, crewBonusSeats: 7 } }, { people: 'solo' }],
  ['practicality', { practicality: { bootNeed: { small: 0, medium: 350, big: 700 }, seatsFloor: 6, crewBonusSeats: 5 } }, { people: 'crew', primaryUse: 'roadtrips' }],
  ['practicality', { practicality: { bootNeed: { small: 100, medium: 350, big: 700 }, seatsFloor: 6, crewBonusSeats: 5 } }, { people: 'solo', primaryUse: 'commute' }],
  ['size', { size: { roadtripMinClass: 3, cityDivisor: 5 } }, { primaryUse: 'roadtrips' }], ['size', { size: { roadtripMinClass: 3, cityDivisor: 5 } }, { primaryUse: 'commute' }],
  ['size', { size: { roadtripMinClass: 3, cityDivisor: 0 } }, { primaryUse: 'city' }],
  ['character', {}, { primaryUse: 'fun', style: 4, priorities: ['tech', 'image'] }], ['character', {}, { primaryUse: 'family', style: 1, priorities: ['comfort', 'economy'] }],
  ['character', {}, { style: 3, priorities: ['performance'] }],
  ['performance', {}, { style: 5 }], ['performance', {}, { style: 1, priorities: ['performance'] }], ['performance', {}, { style: 3 }],
  ['styleLine', { styleLine: { neutral: 0.6, match: 1, miss: 0.1 } }, { styleLine: 'sport' }], ['styleLine', { styleLine: { neutral: 0.6, match: 1, miss: 0.1 } }, { styleLine: 'classic' }],
  ['styleLine', { styleLine: { match: 1, miss: 0.1 } }, {}], ['styleLine', {}, { styleLine: 'sport' }],
  ['doors', { doors: { neutral: 0.5, match: 1, miss: 0.2 } }, { doors: '5' }], ['doors', { doors: { neutral: 0.5, match: 1, miss: 0.2 } }, { doors: '3' }], ['doors', { doors: { neutral: 0.5, match: 1, miss: 0.2 } }, { doors: 'either' }],
  ['economy', {}, { primaryUse: 'commute' }]]) {
  for (const component of ['fit', 'taste']) {
    for (const facts of [{}, { styleLine: fact('jcw'), doors: fact(3), tags: fact(['drivers-car', 'tech', 'efficient']), sizeClass: fact(4) }, { seats: fact(7), boot: fact(200) }].slice(0, 2)) {
      sp(`dimension ${dimension} ${component} ${JSON.stringify(answers)} ${JSON.stringify(tuningExtra)} ${JSON.stringify(Object.keys(facts))}`, {
        snapshot: snap(facts),
        config: cfg({ preferences: { ...seedValue.preferences, size: { ...seedValue.preferences.size, dimension, component, answers, facts: ['sizeClass'] } },
          tuning: { ...seedValue.tuning, ...tuningExtra } }), preferences: { size: pref(55, 50) } });
    }
  }
}
for (const [label, tuningPatch] of [['mileage degenerate', { mileage: { lowMiles: 5000, highMiles: 5000 } }], ['mileage inverted', { mileage: { lowMiles: 20000, highMiles: 4000 } }],
  ['mileage missing', { mileage: undefined }], ['performance span zero', { performance: { zeroBase: 10.5, span: 0 } }],
  ['performance span 2 wants', { performance: { zeroBase: 10.5, span: 2 } }], ['body tuning missing', { body: undefined }], ['hardFilter strings', { hardFilter: { crewBoot: '430', crewSeats: '5', familySeats: '4' } }],
  ['weights with fuel', { weights: { ...seedValue.tuning.weights, fuel: 2 } }], ['fuelStrictBoost missing', { fuelStrictBoost: undefined }], ['size missing', { size: undefined }],
  ['crew shortfall', { crewSeatShortfall: 0.5, practicality: { bootNeed: { small: 0, medium: 350, big: 500 }, seatsFloor: 4, crewBonusSeats: 7 } }]]) {
  for (const key of ['economy', 'sportiness', 'size', 'body', 'fuel', 'comfort']) {
    const value = { economy: 60, sportiness: 40, size: 50, body: 'estate', fuel: 'petrol', comfort: 70 }[key];
    const tuning = { ...seedValue.tuning, ...tuningPatch };
    for (const k of Object.keys(tuning)) if (tuning[k] === undefined) delete tuning[k];
    sp(`tuning ${label} pref ${key}`, { config: cfg({ tuning }), preferences: { [key]: pref(value, 50) }, snapshot: snap({}) });
    sp(`tuning ${label} pref ${key} with crew`, { config: cfg({ tuning, preferences: { ...seedValue.preferences, [key]: { ...seedValue.preferences[key], answers: { ...seedValue.preferences[key].answers, people: 'crew' } } } }),
      preferences: { [key]: pref(value, 50) }, snapshot: snap({ seats: fact(5), boot: fact(450) }) });
  }
}
// NaN and Infinity propagate to an unknown preference.
sp('NaN weight: fuel answer on an economy preference', { config: cfg(withPref('economy', { answers: { fuel: 'petrol' } })), preferences: { economy: pref(50, 50) } });
sp('NaN weight: fuel answer on a size preference', { config: cfg(withPref('size', { answers: { fuel: ['petrol'] } })), preferences: { size: pref(50, 50) } });
sp('NaN weight: fuel open keeps fine', { config: cfg(withPref('economy', { answers: { fuel: 'open' } })), preferences: { economy: pref(50, 50) } });
sp('NaN scorer: mpg string', { snapshot: snap({ mpg: fact('lots') }), preferences: { economy: pref(50, 50) } });
sp('NaN scorer: zeroTo62 string', { snapshot: snap({ zeroTo62: fact('quick') }), preferences: { sportiness: pref(50, 50) } });
sp('NaN scorer: sizeClass string', { snapshot: snap({ sizeClass: fact('big') }), preferences: { size: pref(50, 50) } });
sp('NaN scorer: sizeClass numeric string', { snapshot: snap({ sizeClass: fact('2') }), preferences: { size: pref(50, 50) } });
sp('NaN scorer: zeroTo62 numeric string', { snapshot: snap({ zeroTo62: fact('4.5') }), preferences: { sportiness: pref(50, 50) } });
sp('NaN scorer: mpg numeric string', { snapshot: snap({ mpg: fact('55') }), preferences: { economy: pref(50, 50) } });
sp('Infinity: zeroTo62 negative', { snapshot: snap({ zeroTo62: fact(-1e308) }), preferences: { sportiness: pref(50, 50) } });
sp('scaleMultiplier absent defaults to one', { config: cfg(withPref('comfort', { scaleMultiplier: undefined })), preferences: { comfort: pref(50, 50), sportiness: pref(50, 50) }, snapshot: snap({ tags: fact(['cruiser', 'urban']) }) });
sp('scaleMultiplier zero', { config: cfg(withPref('comfort', { scaleMultiplier: 0 })), preferences: { comfort: pref(50, 50) } });
sp('scaleMultiplier fractional', { config: cfg(withPref('comfort', { scaleMultiplier: 1.37 })), preferences: { comfort: pref(50, 50) }, snapshot: snap({ tags: fact(['cruiser']) }) });
sp('scaleMultiplier large clips', { config: cfg(withPref('comfort', { scaleMultiplier: 9 })), preferences: { comfort: pref(50, 50) } });
sp('scaleMultiplier string', { config: cfg(withPref('comfort', { scaleMultiplier: '2' })), preferences: { comfort: pref(50, 50) } });
for (const dimension of ['body', 'economy', 'performance']) {
  sp(`component score blends fit and taste ${dimension}`, { config: cfg(withPref('size', { component: 'score', dimension, answers: { style: 5, bodyStyles: ['estate'] } })),
    snapshot: snap({ zeroTo62: fact(5.5) }), preferences: { size: pref(50, 50) } });
}
for (const zero of [3.1, 4.4, 5.5, 6.7, 8.2, 9.9]) for (const style of [4, 5]) {
  sp(`component score blend zero ${zero} style ${style}`, { config: cfg(withPref('size', { component: 'score', dimension: 'body', answers: { style, bodyStyles: ['suv'] } })),
    snapshot: snap({ zeroTo62: fact(zero) }), preferences: { size: pref(50, 50) } });
}
sp('definition component unknown', { config: cfg(withPref('size', { component: 'other' })), preferences: { size: pref(50, 50) } });
sp('definition without facts throws', { config: cfg(withPref('size', { facts: undefined })), preferences: { size: pref(50, 50) } });
sp('definition missing throws', { config: cfg({ preferences: {} }), preferences: { size: pref(50, 50) } });
sp('definition with no facts list', { config: cfg(withPref('size', { facts: [] })), preferences: { size: pref(50, 50) } });
sp('definition with extra facts', { config: cfg(withPref('size', { facts: ['sizeClass', 'seats', 'colour'] })), preferences: { size: pref(50, 50) } });
sp('definition answer array for fuel as scalar', { preferences: { fuel: pref('phev', 50) }, snapshot: snap({ fuel: fact('phev') }) });
sp('retail config tuning missing', { config: cfg({}, ['tuning']), preferences: { body: pref('estate', 50) } });
sp('retail config tuning null', { config: cfg({ tuning: null }), preferences: { body: pref('estate', 50) } });
sp('config optionEvidence absent', { config: cfg({}, ['optionEvidence']), snapshot: snap({ optionSelection: optionFact(comfortSel) }), preferences: { comfort: pref(50, 50) } });
sp('config plugInFuels absent throws', { config: cfg({}, ['plugInFuels']), preferences: { economy: pref(50, 50) } });
sp('config plugInFuels empty', { config: cfg({ plugInFuels: [] }), snapshot: snap({ fuel: fact('ev') }), preferences: { economy: pref(50, 50) } });
sp('config retailBudgetEnabled absent', { config: cfg({}, ['retailBudgetEnabled']), preferences: { body: pref('estate', 50) } });
sp('config confirmedAssurances narrow', { config: cfg({ confirmedAssurances: ['confirmed-build'] }), employee: { charging: fact('home'), annualMileage: fact(12000) }, preferences: { economy: pref(50, 50) } });
sp('employee facts empty', { employee: {}, preferences: { economy: pref(50, 50), fuel: pref('ev', 50) } });
sp('employee facts missing throws', { employee: UNDEF, preferences: { economy: pref(50, 50) } });
sp('employee charging value null', { employee: { charging: { status: 'known', value: null, provenance: prov() } }, preferences: { fuel: pref('ev', 50) } });
sp('employee mileage string', { employee: { charging: fact('home'), annualMileage: fact('12000') }, preferences: { economy: pref(50, 50) } });
for (const label of ['low', 'mid', 'high', 'vhigh', 'other']) sp(`employee mileage band ${label}`, { employee: { charging: fact('home'), annualMileage: fact(label) }, preferences: { economy: pref(50, 50) } });
sp('employee mileage fractional', { employee: { charging: fact('home'), annualMileage: fact(8123.5) }, preferences: { economy: pref(50, 50) } });
sp('employee mileage boolean', { employee: { charging: fact('home'), annualMileage: fact(true) }, preferences: { economy: pref(50, 50) } });
sp('snapshot null throws', { snapshot: null, preferences: { body: pref('estate') } });
sp('brief preferences missing throws', { snapshot: snap(), preferences: UNDEF, editor: true });
sp('brief preferences null throws', { snapshot: snap(), preferences: null, editor: true });
sp('brief preferences array', { snapshot: snap(), preferences: { preferences: [] }, editor: true });
sp('custom slider max 50', { preferences: { sportiness: pref(30, 50), body: pref('estate', 50) }, sliderScale: { minimum: 0, maximum: 50 } });
sp('slider object missing fields', { preferences: { sportiness: pref(30, 50) }, sliderScale: {} });

// ---- scoreOptionEvidence directly -----------------------------------------------------------------------
const seedPrefs = { $seed: { path: 'preferences' } };
const seedPolicyRef = (set = {}, removed = []) => ({ $seed: { path: 'optionEvidence', set, delete: removed } });
const smallPrefs = { sportiness: { type: 'slider' }, comfort: { type: 'slider' }, body: { type: 'enum', values: ['estate', 'saloon'] } };
for (const [label, selection] of [['comfort', comfortSel], ['sport', sportSel], ['empty', sel([])], ['incomplete', sel(['S0451'], { complete: false })],
  ['disabled', sel(['S0704', 'S0225'])], ['bundles', sel(['S07LG', 'S0337', 'S07A2', 'S06C4'])], ['everything', sel(Object.keys(seedValue.optionEvidence.options))],
  ['all active', sel(Object.keys(seedValue.optionEvidence.options), { activeCodes: Object.keys(seedValue.optionEvidence.options) })],
  ['null selection', null], ['array selection', []], ['bad kind', { kind: 'x', complete: true, codes: [] }], ['missing complete', { kind: 'selected-catalogue', codes: [] }],
  ['complete string', { kind: 'selected-catalogue', complete: 'yes', codes: [] }], ['codes not array', { kind: 'selected-catalogue', complete: true, codes: 'A' }],
  ['lowercase code', sel(['abc'])], ['active not subset', sel(['S0451'], { activeCodes: ['S0453'] })], ['active bad', sel(['S0451'], { activeCodes: ['x y'] })],
  ['duplicates', sel(['S0451', 'S0451', 'S0453'])], ['unsorted', sel(['S0494', 'S0451', 'S0453'])], ['fuel evidence', sel(['SE000001', 'SE000034'])]]) {
  add(`scoreOptionEvidence ${label}`, 'scoreOptionEvidence', [selection, seedPolicyRef(), seedPrefs]);
}
add('scoreOptionEvidence policy undefined', 'scoreOptionEvidence', [comfortSel, UNDEF, seedPrefs]);
add('scoreOptionEvidence policy null', 'scoreOptionEvidence', [comfortSel, null, seedPrefs]);
add('scoreOptionEvidence preferences null', 'scoreOptionEvidence', [comfortSel, seedPolicyRef(), null]);
add('scoreOptionEvidence preferences missing key', 'scoreOptionEvidence', [comfortSel, seedPolicyRef(), { comfort: { type: 'slider' } }]);
add('scoreOptionEvidence invalid then bad selection', 'scoreOptionEvidence', [null, seedPolicyRef({ importance: 50 }), seedPrefs]);
add('scoreOptionEvidence small enum', 'scoreOptionEvidence', [sel(['D', 'E', 'PACK', 'A', 'C'], { activeCodes: ['C'] }), smallPolicy, smallPrefs]);
add('scoreOptionEvidence small bundle only', 'scoreOptionEvidence', [sel(['PACK']), smallPolicy, smallPrefs]);
add('scoreOptionEvidence small economy field not slider', 'scoreOptionEvidence', [sel(['F']), smallPolicy, smallPrefs]);
add('scoreOptionEvidence preferences enum for slider field invalid', 'scoreOptionEvidence', [sel(['A']), smallPolicy, { ...smallPrefs, comfort: { type: 'enum', values: ['x'] } }]);
add('scoreOptionEvidence negative magnitude tie', 'scoreOptionEvidence', [sel(['A', 'B']), { ...smallPolicy, options: { ...smallPolicy.options, B: { group: 'comfort', weight: 1, evidence: { comfort: -1 } } } }, smallPrefs]);
add('scoreOptionEvidence adjustment clamped', 'scoreOptionEvidence', [sel(['A', 'B']), { ...smallPolicy, sliderStep: 50, maximumAdjustment: 7 }, smallPrefs]);
add('scoreOptionEvidence maximumAdjustment zero', 'scoreOptionEvidence', [sel(['A']), { ...smallPolicy, maximumAdjustment: 0 }, smallPrefs]);
add('scoreOptionEvidence weight zero options', 'scoreOptionEvidence', [sel(['FBLAT', 'FEPMI']), seedPolicyRef(), seedPrefs]);
add('scoreOptionEvidence unknown preference type', 'scoreOptionEvidence', [sel(['A']), smallPolicy, { sportiness: { type: 'slider' } }]);

// ---- ranking ---------------------------------------------------------------------------------------------
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const dec = (n, score, points, gateStatus = 'eligible') => ({ orderUuid: uuid(n), gateStatus, score, terms: { points: { value: points } } });
const rankingCfg = (set = {}) => cfg({ ranking: { rule: 'similarFitThenPoints', fitTolerance: 5, ...set } });
const none = cfg({}, ['ranking']);
const decisionSets = {
  'empty': [], 'single': [dec(1, 80, 10)], 'ineligible dropped': [dec(1, 80, 10, 'ineligible'), dec(2, 70, 5), dec(3, 90, 1, 'unknown')],
  'exact tie': [dec(1, 80, 10), dec(2, 80, 20), dec(3, 80, 20)],
  'exact tie same points differing uuid': [dec(9, 80, 10), dec(2, 80, 10), dec(5, 80, 10)],
  'tolerance edge 5': [dec(1, 80, 10), dec(2, 75, 50), dec(3, 70, 90)],
  'tolerance just over': [dec(1, 80, 10), dec(2, 74.9999, 50)],
  'tolerance 5.0001 apart': [dec(1, 80.0001, 10), dec(2, 75, 50)],
  'chain of near ties': [dec(1, 90, 1), dec(2, 86, 2), dec(3, 82, 3), dec(4, 78, 4), dec(5, 74, 5)],
  'chain anchored to best': [dec(1, 95, 1), dec(2, 91, 9), dec(3, 87, 99), dec(4, 83, 999)],
  'null scores': [dec(1, null, 10), dec(2, null, 30), dec(3, 0, 99), dec(4, 3, 5)],
  'null only': [dec(1, null, 10), dec(2, null, 30), dec(3, null, 30)],
  'null with zero': [dec(1, 0, 10), dec(2, null, 30)],
  'score zero tie with null': [dec(1, null, 5), dec(2, 0, 5), dec(3, 0, 6)],
  'points descending wins in band': [dec(1, 80, 1), dec(2, 79, 2), dec(3, 78, 3), dec(4, 60, 100), dec(5, 59, 101)],
  'equal points higher score wins': [dec(1, 76, 10), dec(2, 80, 10), dec(3, 78, 10)],
  'negative points': [dec(1, 80, -5), dec(2, 80, 0), dec(3, 80, -10)],
  'fractional points': [dec(1, 80, 0.1), dec(2, 80, 0.30000000000000004), dec(3, 80, 0.3)],
  'unsorted input': [dec(5, 10, 1), dec(2, 99, 1), dec(4, 55, 7), dec(1, 99, 2), dec(3, 70, 7)],
  'wide spread': [dec(1, 100, 1), dec(2, 50, 100), dec(3, 0, 1000)],
  'uppercase uuids': [{ ...dec(1, 80, 10), orderUuid: 'AAAAAAAA-0000-4000-8000-000000000001' }, { ...dec(2, 80, 10), orderUuid: 'aaaaaaaa-0000-4000-8000-000000000002' }, { ...dec(3, 80, 10), orderUuid: 'AAAAAAAA-0000-4000-8000-000000000003' }],
  'hex uuids': [{ ...dec(1, 80, 10), orderUuid: 'f0000000-0000-4000-8000-000000000001' }, { ...dec(2, 80, 10), orderUuid: 'a0000000-0000-4000-8000-000000000002' }, { ...dec(3, 80, 10), orderUuid: '0f000000-0000-4000-8000-000000000003' }, { ...dec(4, 80, 10), orderUuid: '9e000000-0000-4000-8000-000000000004' }],
  'no gateStatus key': [{ orderUuid: uuid(1), score: 5, terms: { points: { value: 1 } } }],
  'missing points throws in band': [{ orderUuid: uuid(1), gateStatus: 'eligible', score: 5 }, { orderUuid: uuid(2), gateStatus: 'eligible', score: 5 }],
  'missing points single ok': [{ orderUuid: uuid(1), gateStatus: 'eligible', score: 5 }],
  'string score': [dec(1, '80', 10), dec(2, 75, 20)],
  'extra fields retained': [{ ...dec(1, 80, 10), extra: { a: 1 } }, { ...dec(2, 80, 20), reasons: ['x'] }],
};
for (const [name, decisions] of Object.entries(decisionSets)) {
  add(`rank ${name} tolerance 5`, 'rankEmployeeRecommendations', [decisions, rankingCfg()]);
  add(`rank ${name} ranking absent`, 'rankEmployeeRecommendations', [decisions, none]);
  add(`rank ${name} tolerance 0`, 'rankEmployeeRecommendations', [decisions, rankingCfg({ fitTolerance: 0 })]);
  add(`rank ${name} tolerance 100`, 'rankEmployeeRecommendations', [decisions, rankingCfg({ fitTolerance: 100 })]);
  add(`rank ${name} tolerance 2.5`, 'rankEmployeeRecommendations', [decisions, rankingCfg({ fitTolerance: 2.5 })]);
}
for (const [label, ranking] of [['rule other', { rule: 'other', fitTolerance: 5 }], ['tolerance negative', { rule: 'similarFitThenPoints', fitTolerance: -1 }],
  ['tolerance 101', { rule: 'similarFitThenPoints', fitTolerance: 101 }], ['tolerance string', { rule: 'similarFitThenPoints', fitTolerance: '5' }],
  ['tolerance missing', { rule: 'similarFitThenPoints' }], ['tolerance null', { rule: 'similarFitThenPoints', fitTolerance: null }], ['rule missing', { fitTolerance: 5 }],
  ['empty ranking', {}], ['null ranking', null], ['array ranking', []], ['tolerance NaN-ish', { rule: 'similarFitThenPoints', fitTolerance: 1e999 }]]) {
  add(`rank invalid ranking ${label}`, 'rankEmployeeRecommendations', [[dec(1, 80, 1), dec(2, 79, 2)], cfg({ ranking })]);
  add(`rank invalid ranking ${label} empty`, 'rankEmployeeRecommendations', [[], cfg({ ranking })]);
}
add('rank decisions not array throws', 'rankEmployeeRecommendations', [null, rankingCfg()]);

// ---- configurationValid ---------------------------------------------------------------------------------
add('configurationValid seed', 'configurationValid', [C, slider]);
const cfgVariants = {
  'driverEligibilityRequired false': cfg({ driverEligibilityRequired: false }), 'driverEligibilityRequired string': cfg({ driverEligibilityRequired: 'yes' }),
  'driverEligibilityRequired missing': cfg({}, ['driverEligibilityRequired']), 'retailBudgetEnabled true': cfg({ retailBudgetEnabled: true }),
  'retailBudgetEnabled missing': cfg({}, ['retailBudgetEnabled']), 'retailBudgetEnabled 0': cfg({ retailBudgetEnabled: 0 }),
  'displayLimit 0': cfg({ displayLimit: 0 }), 'displayLimit negative': cfg({ displayLimit: -3 }), 'displayLimit fractional': cfg({ displayLimit: 2.5 }),
  'displayLimit string': cfg({ displayLimit: '3' }), 'displayLimit large': cfg({ displayLimit: 1000000 }), 'displayLimit unsafe': cfg({ displayLimit: 2 ** 60 }),
  'termValidity 0': cfg({ termValiditySeconds: 0 }), 'termValidity negative': cfg({ termValiditySeconds: -1 }), 'termValidity fractional': cfg({ termValiditySeconds: 0.5 }),
  'termValidity string': cfg({ termValiditySeconds: '7200' }), 'termValidity missing': cfg({}, ['termValiditySeconds']), 'termValidity huge': cfg({ termValiditySeconds: 1e300 }),
  'assurances empty': cfg({ confirmedAssurances: [] }), 'assurances blank': cfg({ confirmedAssurances: [' '] }), 'assurances number': cfg({ confirmedAssurances: [1] }),
  'assurances object': cfg({ confirmedAssurances: {} }), 'plugInFuels missing': cfg({}, ['plugInFuels']), 'chargingAccess null': cfg({ chargingAccess: null }),
  'availabilityStates mixed': cfg({ availabilityStates: ['available', ''] }), 'preferences missing': cfg({}, ['preferences']), 'preferences empty object': cfg({ preferences: {} }),
  'preferences empty string': cfg({ preferences: '' }), 'preferences zero': cfg({ preferences: 0 }), 'preferences array': cfg({ preferences: [] }),
  'essentials missing': cfg({}, ['essentials']), 'essentials false': cfg({ essentials: false }), 'tuning missing': cfg({}, ['tuning']), 'tuning null': cfg({ tuning: null }),
  'tuning number': cfg({ tuning: 5 }), 'tuning weights missing': cfg({ tuning: { hardFilter: {} } }), 'tuning hardFilter missing': cfg({ tuning: { weights: {} } }),
  'tuning hardFilter null': cfg({ tuning: { weights: {}, hardFilter: null } }), 'tuning weights zero': cfg({ tuning: { weights: 0, hardFilter: {} } }),
  'tuning minimal': cfg({ tuning: { weights: {}, hardFilter: {} } }), 'no ranking is fine': cfg({}, ['ranking']), 'no optionEvidence is fine': cfg({}, ['optionEvidence']),
  'extra keys fine': cfg({ extra: 1 }),
};
for (const [name, config] of Object.entries(cfgVariants)) add(`configurationValid ${name}`, 'configurationValid', [config, slider]);
for (const [name, value] of [['null', null], ['array', []], ['string', 'x'], ['empty object', {}], ['number', 3]]) add(`configurationValid config ${name}`, 'configurationValid', [value, slider]);
for (const [name, value] of [['min 1', { minimum: 1, maximum: 100 }], ['max 99', { minimum: 0, maximum: 99 }], ['min string', { minimum: '0', maximum: 100 }], ['max missing', { minimum: 0 }],
  ['min missing', { maximum: 100 }], ['both missing', {}], ['negative', { minimum: -1, maximum: 100 }], ['fractional', { minimum: 0, maximum: 100.5 }], ['min null', { minimum: null, maximum: 100 }]]) {
  add(`configurationValid slider ${name}`, 'configurationValid', [C, value]);
}

// ---- randomised cases -----------------------------------------------------------------------------------
let state = 0x9e3779b9;
const rnd = () => { state = (state + 0x6d2b79f5) | 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (list) => list[int(0, list.length - 1)];
const chance = (p) => rnd() < p;
const subset = (list, max = list.length) => list.filter(() => chance(0.4)).slice(0, max);
const decimals = (value, places) => Number(value.toFixed(places));
const optionCodes = Object.keys(seedValue.optionEvidence.options);
const tagPool = ['cruiser', 'drivers-car', 'urban', 'family', 'practical', 'efficient', 'tech', 'image'];
const randomFact = (value, unit = null) => {
  const roll = rnd();
  if (roll < 0.06) return undefined;
  if (roll < 0.1) return fact(null);
  if (roll < 0.13) return fact(value, unit, 'estimated');
  return fact(value, unit);
};
const randomPrefValue = (def) => {
  if (def.type === 'slider') return chance(0.15) ? pick([0, 50, 100]) : int(0, 100);
  const ordered = def.values.filter(() => chance(0.4));
  return !ordered.length || chance(0.35) ? pick(def.values) : ordered;
};
const randomPref = (def) => {
  const roll = rnd();
  if (roll < 0.07) return { source: 'policy:brief.editor.v1', valueState: 'draft', importanceState: 'draft', value: randomPrefValue(def), importance: pick([0, 50]) };
  const states = ['confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed', 'inferred', 'draft'];
  return { value: randomPrefValue(def), importance: chance(0.12) ? 0 : chance(0.3) ? 100 : int(1, 100), valueState: pick(states), importanceState: pick(states), source: 'employee' };
};
for (let n = 0; n < 300; n += 1) {
  const facts = {
    body: randomFact(pick(bodies)), fuel: randomFact(pick(['petrol', 'diesel', 'phev', 'ev'])), seats: randomFact(int(2, 7), 'count'), boot: randomFact(int(150, 700), 'L'),
    zeroTo62: randomFact(chance(0.5) ? int(25, 120) / 10 : decimals(2.5 + rnd() * 10, 3), 's'), mpg: randomFact(chance(0.5) ? int(20, 70) : decimals(20 + rnd() * 50, 2), 'mpg-imperial'),
    sizeClass: randomFact(int(1, 5), 'ordinal-1-5'), tags: randomFact(subset(tagPool)),
  };
  if (chance(0.45)) {
    const selection = { kind: pick(['selected-catalogue', 'verified-fitted']), complete: chance(0.8), codes: Array.from({ length: int(0, 9) }, () => pick(optionCodes)) };
    if (chance(0.3)) selection.activeCodes = selection.codes.filter(() => chance(0.5));
    facts.optionSelection = chance(0.1) ? fact(selection, null, 'estimated') : fact(selection, null, 'confirmed-build');
  }
  const preferences = {};
  for (const [key, def] of Object.entries(seedValue.preferences)) if (chance(0.55)) preferences[key] = randomPref(def);
  const employee = { charging: chance(0.1) ? undefined : fact(chance(0.12) ? null : pick(['home', 'work', 'either', 'none', 'not-ready'])),
    annualMileage: chance(0.15) ? undefined : fact(chance(0.1) ? null : chance(0.7) ? int(0, 40000) : decimals(rnd() * 30000, 2), 'mi/year') };
  const roll = rnd();
  const config = roll < 0.5 ? C : roll < 0.7 ? cfg({ preferenceWeights: Object.fromEntries(Object.keys(seedValue.preferences).map((key) => [key, int(0, 6)])) })
    : roll < 0.8 ? cfg({}, ['optionEvidence']) : roll < 0.9 ? cfg({ optionEvidence: { ...smallPolicy, sliderStep: decimals(0.2 + rnd() * 8, 2), halfSaturationWeight: decimals(1 + rnd() * 15, 2) } })
      : cfg({ tuning: { ...seedValue.tuning, mileage: { lowMiles: int(0, 8000), highMiles: int(8001, 30000) }, performance: { zeroBase: decimals(8 + rnd() * 5, 1), span: decimals(2 + rnd() * 8, 1) } } });
  add(`random scorePreferences ${n}`, 'scorePreferences', [snap(facts, `Random car ${n}`), prefs(preferences), employee, config, slider]);
}
const hex = () => Array.from({ length: 32 }, () => '0123456789abcdef'[int(0, 15)]).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
for (let n = 0; n < 200; n += 1) {
  const size = int(0, 14);
  const centre = int(20, 95);
  const decisions = Array.from({ length: size }, () => ({
    orderUuid: chance(0.2) ? uuid(int(1, 6)) : hex(), gateStatus: chance(0.85) ? 'eligible' : pick(['ineligible', 'unknown', 'unavailable']),
    score: chance(0.1) ? null : chance(0.3) ? centre : chance(0.6) ? Math.max(0, Math.min(100, centre + int(-12, 12))) : int(0, 100),
    terms: { points: { value: chance(0.3) ? pick([0, 100, 250]) : int(-50, 400) } } }));
  const tolerance = pick([5, 5, 5, 0, 1, 2.5, 10, 100, 4.999, 5.0001]);
  add(`random rank ${n}`, 'rankEmployeeRecommendations', [decisions, chance(0.1) ? none : rankingCfg({ fitTolerance: tolerance })]);
}

// Order ids beyond lowercase hex: mixed case, digits and dashes, to pin the localeCompare port.
const idChars = 'aAbBcC0129-zZ';
const looseId = () => Array.from({ length: int(1, 6) }, () => idChars[int(0, idChars.length - 1)]).join('');
for (let n = 0; n < 40; n += 1) {
  const decisions = Array.from({ length: int(2, 9) }, () => ({ orderUuid: looseId(), gateStatus: 'eligible', score: pick([50, 50, 52, 80]),
    terms: { points: { value: pick([10, 10, 20]) } } }));
  add(`random rank loose ids ${n}`, 'rankEmployeeRecommendations', [decisions, chance(0.5) ? none : rankingCfg()]);
}

await writeFile(outPath, `${JSON.stringify(cases)}\n`);
const names = new Set(cases.map((c) => c.name));
if (names.size !== cases.length) throw new Error('duplicate case names');
const thrown = cases.filter((c) => c.expected?.throws === true).length;
console.log(`wrote ${cases.length} cases (${thrown} throw) to ${outPath}`);
