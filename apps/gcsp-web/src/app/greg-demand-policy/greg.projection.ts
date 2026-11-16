import type { GregCount, GregDemand, GregEssential, GregEvidence, GregFact, GregFit, GregGroup, GregHeldOffers,
  GregPolicy, GregPolicyField, GregPreview, GregProvenance, GregPublished, GregRange, GregRefusal, GregRefusalStatus, GregResult, GregVersions } from './greg.types';

type Obj = Record<string, unknown>;
const bad = (): never => { throw new Error('Invalid Greg projection'); };
const object = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : bad();
const text = (v: unknown): string => typeof v === 'string' && !!v.trim() && v.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(v) ? v : bad();
const integer = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : bad();
const boolean = (v: unknown): boolean => typeof v === 'boolean' ? v : bad();
const list = <T>(v: unknown, parse: (value: unknown) => T): T[] => Array.isArray(v) && v.length <= 10000 ? v.map(parse) : bad();
const only = (o: Obj, keys: readonly string[]): void => { if (Object.keys(o).some(k => !keys.includes(k))) bad(); };
const instant = (v: unknown): string => {
  const s = text(v);
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(s) && Number.isFinite(Date.parse(s)) ? s : bad();
};
function versions(v: unknown): GregVersions { const o = object(v); return { brief: list(o['brief'], text), policy: list(o['policy'], text) }; }
export function parseGregCount(v: unknown): GregCount {
  const o = object(v); const label = text(o['label']);
  if (o['kind'] === 'exact') { only(o, ['kind', 'value', 'label']); return { kind: 'exact', value: integer(o['value']), label }; }
  if (o['kind'] !== 'band' || Object.hasOwn(o, 'value')) return bad();
  const fewer = Object.hasOwn(o, 'fewerThan'); const atLeast = Object.hasOwn(o, 'atLeast');
  if (fewer === atLeast) return bad();
  only(o, ['kind', 'label', fewer ? 'fewerThan' : 'atLeast']);
  const threshold = integer(o[fewer ? 'fewerThan' : 'atLeast']);
  if (threshold < 1) return bad();
  return fewer ? { kind: 'band', label, fewerThan: threshold } : { kind: 'band', label, atLeast: threshold };
}
function evidence(v: unknown): GregEvidence { const o = object(v); return { count: parseGregCount(o['count']), versions: versions(o['versions']) }; }
const names: Readonly<Record<string, string>> = { unspecified: 'No preference stated', suv: 'SUV', mpv: 'MPV', phev: 'Plug-in hybrid',
  ev: 'Electric', hev: 'Hybrid', mhev: 'Mild hybrid', petrol: 'Petrol', diesel: 'Diesel', hatchback: 'Hatchback', saloon: 'Saloon',
  estate: 'Estate', coupe: 'Coupe', convertible: 'Convertible', unconfirmed: 'Model line not confirmed',
  sportiness: 'Performance feel', comfort: 'Comfort', economy: 'Running costs', size: 'Size', other: 'Another reason', timing: 'Timing',
  points: 'Points cost', 'no-longer-needed': 'No longer needed', 'just-not-this-one': 'Just not this car', unclassified: 'Reason not classified',
  seats: 'Seats', boot: 'Boot space', equipment: 'Equipment', body: 'Body style', fuel: 'Fuel type', frontIsofix: 'Front ISOFIX', rearIsofix: 'Rear ISOFIX',
  modelLine: 'Model line', charging: 'Charging access', availableFrom: 'Available from', availableUntil: 'Available until', home: 'Home', work: 'Work', either: 'Home or work' };
const labelFor = (key: string): string => Object.hasOwn(names, key) ? names[key] : /^[a-z][a-z0-9_-]*$/.test(key)
  ? key.charAt(0).toUpperCase() + key.slice(1).replace(/[-_]/g, ' ') : key;
const humanise = (key: string): string => {
  const value = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim().toLowerCase();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : key;
};
const fieldLabel = (key: string): string => Object.hasOwn(names, key) ? names[key] : humanise(key);
function group(v: unknown): GregGroup { const o = object(v); const key = text(o['key']); return { key, label: o['label'] === undefined ? labelFor(key) : text(o['label']), ...evidence(o) }; }
function reasonGroup(v: unknown): GregGroup { const row = group(v); return object(v)['label'] === undefined ? { ...row, label: fieldLabel(row.key) } : row; }
const gates: Readonly<Record<string, readonly ['blocker' | 'needs-confirmation', string]>> = {
  'no-released-stock': ['blocker', 'No stock has been released yet'], 'stock-not-visible': ['blocker', 'Released stock is not open to these employees'],
  'declined-unchanged': ['blocker', 'Declined car and the brief has not changed'], 'essential-unmet': ['blocker', 'Essential not met'],
  'essential-unconfirmed': ['needs-confirmation', 'Essential not confirmed'], 'availability-expired': ['blocker', 'Car availability has ended'],
  'not-available': ['blocker', 'Car is not available'], 'not-yet-available': ['blocker', 'Car is not available yet'],
  'policy-exclude': ['blocker', 'Scheme rules exclude the car'], 'required-by': ['blocker', 'Car arrives after the date needed'],
  'allowance-exceeded': ['blocker', 'Over the points allowance'], 'driver-ineligible': ['blocker', 'Employee is not an eligible driver'],
  'charging-unavailable': ['blocker', 'Charging access does not suit the car'], 'availability-date-unconfirmed': ['needs-confirmation', 'Availability date not confirmed'],
  'availability-unconfirmed': ['needs-confirmation', 'Car availability not confirmed'], 'driver-unconfirmed': ['needs-confirmation', 'Driver eligibility not confirmed'],
  'eligibility-unconfirmed': ['needs-confirmation', 'Scheme eligibility not confirmed'], 'employee-essentials-unconfirmed': ['needs-confirmation', 'Employee details not confirmed'],
  'required-by-unconfirmed': ['needs-confirmation', 'Date needed not confirmed'], 'points-unavailable': ['needs-confirmation', 'Points cost not available'],
  'charging-unconfirmed': ['needs-confirmation', 'Charging access not confirmed'], 'equipment-unconfirmed': ['needs-confirmation', 'Equipment not confirmed'],
  'fuel-unconfirmed': ['needs-confirmation', 'Fuel type not confirmed'],
};
function gateGroup(v: unknown): GregGroup {
  const row = group(v); const at = row.key.indexOf(':'); const code = at < 0 ? row.key : row.key.slice(0, at); const field = at < 0 ? null : row.key.slice(at + 1);
  const known = Object.hasOwn(gates, code) ? gates[code] : undefined; const severity = known?.[0] ?? 'unknown';
  const supplied = object(v)['label'];
  const label = supplied === undefined ? known ? `${known[1]}${field ? `: ${fieldLabel(field)}` : ''}` : `Other reason (${row.key})` : text(supplied);
  return { ...row, label, code: known ? code : row.key, field, severity,
    severityLabel: severity === 'blocker' ? 'Blocks the offer' : severity === 'needs-confirmation' ? 'Needs confirmation' : 'Other reason' };
}
function fact(v: unknown): GregFact {
  if (v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return v;
  return list(v, x => typeof x === 'string' || typeof x === 'boolean' || typeof x === 'number' && Number.isFinite(x) ? x : bad());
}
function essential(v: unknown): GregEssential {
  const o = object(v); const field = text(o['field']); const state = o['state'];
  if (state !== 'confirmed' && state !== 'needs-confirmation') return bad();
  const operator = o['operator'] === null ? null : text(o['operator']); const unit = o['unit'] === null ? null : text(o['unit']);
  const value = fact(o['value']);
  if (state === 'needs-confirmation' && value !== null) return bad();
  const operators: Record<string, string> = { gte: 'at least', lte: 'at most', equals: 'is', includes: 'includes' };
  const shown = Array.isArray(value) ? value.map(String).join(', ') : typeof value === 'string' && field !== 'modelLine' ? labelFor(value) : String(value);
  const units = typeof value === 'number' ? unit === 'L' ? ' litres' : unit && !['count', 'equipment-key'].includes(unit) ? ` ${unit}` : '' : '';
  const label = o['label'] !== undefined ? text(o['label']) : value === null ? `${fieldLabel(field)}, value not confirmed`
    : typeof value === 'boolean' ? `${fieldLabel(field)} ${value ? 'required' : 'not required'}`
      : `${fieldLabel(field)} ${operator ? operators[operator] ?? humanise(operator).toLowerCase() : 'is'} ${shown}${units}`;
  return { field, state, operator, unit, value, label, ...evidence(o) };
}

/** Allowlist the server projection; banded counts never expose or derive an exact value. */
export function projectDemand(raw: unknown): GregDemand {
  const o = object(raw); const d = object(o['demand']); const u = object(d['unmet']);
  const h = object(o['holds']); const f = object(o['offers']); const s = object(o['stock']);
  const p = object(o['privacy']); const v = object(o['versions']); const source = object(s['source']);
  const threshold = integer(p['threshold']); if (threshold < 1 || o['basis'] !== 'expressed-saved-demand') return bad();
  const sourceStatus = text(source['status']);
  if (!['ok', 'not-checked', 'delayed', 'unavailable', 'evidence-unavailable'].includes(sourceStatus)) return bad();
  const rows = list(s['byModelLine'], x => { const r = object(x); const key = text(r['key']); return { key,
    label: r['label'] === undefined ? labelFor(key) : text(r['label']), released: evidence(r['released']), held: evidence(r['held']), allocated: evidence(r['allocated']) }; });
  const clock = v['clock']; if (clock !== undefined && typeof clock !== 'string' && !(typeof clock === 'number' && Number.isSafeInteger(clock) && clock >= 0)) return bad();
  return { runId: text(o['runId']), asOf: instant(o['asOf']), projectionVersion: text(o['projectionVersion']), basis: 'expressed-saved-demand',
    basisLabel: 'Expressed saved demand', basisNote: 'What employees have saved and confirmed they need. It is not satisfaction and not a prediction.',
    privacyNote: `Counts below ${threshold} are shown as privacy bands. Other cells may also be withheld to protect small groups.`,
    overlapNote: 'Rows can overlap, so do not add them together. An accepted offer can later be selected, and one employee can be blocked by more than one reason.',
    versions: { ...versions(v), revision: integer(v['revision']), ...(clock === undefined ? {} : { clock }) },
    privacy: { threshold, thresholdKey: text(p['thresholdKey']), policyVersion: text(p['policyVersion']), status: text(p['status']), withheld: boolean(p['withheld']) },
    demand: { activeBriefs: evidence(d['activeBriefs']), byModelLine: list(d['byModelLine'], group), byBody: list(d['byBody'], group), byFuel: list(d['byFuel'], group),
      essentials: list(d['essentials'], essential), unmet: { total: evidence(u['total']), byGate: list(u['byGate'], gateGroup) } },
    holds: { total: evidence(h['total']), active: evidence(h['active']), byState: list(h['byState'], group), byType: list(h['byType'], group) },
    offers: { made: evidence(f['made']), accepted: evidence(f['accepted']), declined: evidence(f['declined']), expired: evidence(f['expired']),
      selected: evidence(f['selected']), declinedByReason: list(f['declinedByReason'], reasonGroup) },
    stock: { byModelLine: rows, source: { status: sourceStatus, ...(source['reason'] === undefined ? {} : { reason: text(source['reason']) }) },
      unavailable: sourceStatus !== 'ok', empty: sourceStatus === 'ok' && rows.length === 0 } };
}
function provenance(v: Obj): GregProvenance { return { source: text(v['source']), sourceDate: text(v['sourceDate']), basis: text(v['basis']), status: text(v['status']), unit: text(v['unit']) }; }
function range(v: unknown): GregRange {
  const o = object(v); const minimum = integer(o['minimum']); const maximum = integer(o['maximum']);
  if (maximum <= minimum || o['step'] !== 1) return bad();
  return { minimum, maximum, step: 1, assumptionKey: text(o['assumptionKey']), ...provenance(o) };
}
function policyField(v: unknown): GregPolicyField {
  const o = object(v); const kind = o['kind']; const key = text(o['key']); const id = text(o['id']);
  if (!['price', 'weight'].includes(kind as string) || id !== `${kind}:${key}` || o['step'] !== 1 || o['minimum'] !== 0) return bad();
  const price = kind === 'price' ? { schemeId: text(o['schemeId']), schemeLabel: text(o['schemeLabel']),
    ...(o['configurationId'] === undefined ? { matchField: text(o['matchField']), matchValue: text(o['matchValue']) } : { configurationId: text(o['configurationId']) }) } : {};
  return { id, key, kind: kind as 'price' | 'weight', value: integer(o['value']), label: text(o['label']), unitLabel: text(o['unitLabel']), minimum: 0, step: 1,
    ...provenance(o), ...price, ...(o['adoptionRequired'] === undefined ? {} : { adoptionRequired: boolean(o['adoptionRequired']) }),
    ...(o['presentationRange'] === undefined ? {} : { presentationRange: range(o['presentationRange']) }) };
}
function held(v: unknown): GregHeldOffers { const o = object(v); return { count: o['count'] === null ? null : integer(o['count']), message: text(o['message']), ...(o['unit'] === undefined ? {} : { unit: text(o['unit']) }) }; }
function policy(raw: unknown): GregPolicy {
  const o = object(raw); if (o['state'] !== 'draft') return bad();
  const fields = list(o['fields'], policyField); const versionNames = Object.fromEntries(Object.entries(object(o['versionNames'])).map(([k, x]) => [k, text(x)]));
  if (!fields.length || new Set(fields.map(f => f.id)).size !== fields.length || fields.filter(f => f.kind === 'weight').length !== 6) return bad();
  const clock = o['clockVersion']; if (clock !== undefined && typeof clock !== 'string' && !(typeof clock === 'number' && Number.isSafeInteger(clock) && clock >= 0)) return bad();
  return { state: 'draft', activeVersion: text(o['activeVersion']), activeVersionLabel: text(o['activeVersionLabel']), versionNames,
    asOf: instant(o['asOf']), effectiveFrom: instant(o['effectiveFrom']), fields, weightsAdoptionRequired: boolean(o['weightsAdoptionRequired']),
    heldOffers: held(o['heldOffers']), historyMessage: text(o['historyMessage']), ...(clock === undefined ? {} : { clockVersion: clock }) };
}
function fit(v: unknown): GregFit {
  const o = object(v); const s = object(o['meanBestScore']);
  let meanBestScore: GregFit['meanBestScore'];
  if (s['status'] === 'available' && typeof s['value'] === 'number' && Number.isFinite(s['value']) && s['value'] >= 0 && s['value'] <= 100) {
    only(s, ['status', 'value']); meanBestScore = { status: 'available', value: s['value'] };
  } else if (s['status'] === 'suppressed') {
    only(s, ['status', 'fewerThan']); const fewerThan = integer(s['fewerThan']); if (!fewerThan) return bad();
    meanBestScore = { status: 'suppressed', fewerThan };
  } else return bad();
  return { employeesWithEligibleStock: parseGregCount(o['employeesWithEligibleStock']), scoredBriefs: parseGregCount(o['scoredBriefs']), meanBestScore };
}
function preview(raw: unknown): GregPreview {
  const o = object(raw); if (o['preview'] !== true) return bad();
  const variant = (x: unknown) => { const a = object(x); return { demand: projectDemand(a['demand']), fit: fit(a['fit']) }; };
  const differences = list(o['differences'], x => { const d = object(x); return { id: text(d['id']), before: integer(d['before']), after: integer(d['after']), unit: text(d['unit']) }; });
  if (!differences.length || differences.length > 100 || new Set(differences.map(d => d.id)).size !== differences.length) return bad();
  return { preview: true, activeVersion: text(o['activeVersion']), asOf: instant(o['asOf']), differences,
    active: variant(o['active']), draft: variant(o['draft']), heldOffers: held(o['heldOffers']) };
}
function published(raw: unknown): GregPublished {
  const o = object(raw); if (o['accepted'] !== true || o['state'] !== 'published') return bad();
  let activation: GregPublished['activation'];
  if (o['activation'] !== undefined) {
    const a = object(o['activation']); const policyVersion = text(a['policyVersion']);
    if (a['status'] === 'active') activation = { status: 'active', policyVersion, asOf: instant(a['asOf']), publishedVersionActive: boolean(a['publishedVersionActive']) };
    else if (a['status'] === 'pending') activation = { status: 'pending', policyVersion, retryable: boolean(a['retryable']), reason: text(a['reason']), outcome: text(a['outcome']) };
    else return bad();
  }
  const activationRequired = o['activationRequired'] === undefined ? undefined : boolean(o['activationRequired']);
  if (activation?.status === 'active' && activationRequired === true || activation?.status === 'pending' && activationRequired === false) return bad();
  if (activation?.status === 'active' && activation.publishedVersionActive !== (activation.policyVersion === o['policyVersion'])
    || activation?.status === 'pending' && activation.policyVersion !== o['policyVersion']) return bad();
  return { state: 'published', accepted: true, policyVersion: text(o['policyVersion']), effectiveFrom: instant(o['effectiveFrom']),
    publisher: text(o['publisher']), publishedAt: instant(o['publishedAt']), heldOffers: held(o['heldOffers']),
    ...(activation === undefined ? {} : { activation }), ...(activationRequired === undefined ? {} : { activationRequired }) };
}
const refusalStatuses: readonly GregRefusalStatus[] = ['invalid', 'unauthenticated', 'forbidden', 'stale-version', 'stale-run', 'conflict', 'unsupported', 'unavailable', 'uncertain'];
function refusal(o: Obj): GregRefusal {
  if (!refusalStatuses.includes(o['status'] as GregRefusalStatus)) return bad();
  const optionalText = Object.fromEntries(['operationId', 'expectedVersion', 'currentVersion', 'action'].filter(k => o[k] !== undefined).map(k => [k, text(o[k])]));
  return { status: o['status'] as GregRefusalStatus, code: text(o['code']), reason: text(o['reason']), retryable: boolean(o['retryable']), ...optionalText,
    ...(o['accepted'] === undefined ? {} : { accepted: boolean(o['accepted']) }),
    ...(o['reasons'] === undefined ? {} : { reasons: list(o['reasons'], x => { const r = object(x); return { field: text(r['field']), reason: text(r['reason']) }; }) }) };
}
function envelope<T>(raw: unknown, parse: (v: unknown) => T): GregResult<T> {
  try { const o = object(raw); return o['status'] === 'ok' ? { state: 'ready', value: parse(o['value']) } : { state: 'refused', value: null, refusal: refusal(o) }; }
  catch { return { state: 'invalid-response', value: null }; }
}
export function parseGregDemand(raw: unknown, runId: string, policyVersion?: string): GregResult<GregDemand> {
  const result = envelope(raw, projectDemand);
  return result.state === 'ready' && (result.value.runId !== runId || policyVersion !== undefined &&
    (result.value.privacy.policyVersion !== policyVersion || !result.value.versions.policy.includes(policyVersion)))
    ? { state: 'scope-mismatch', value: null } : result;
}
export const parseGregPolicy = (raw: unknown): GregResult<GregPolicy> => envelope(raw, policy);
export const parseGregPreview = (raw: unknown): GregResult<GregPreview> => envelope(raw, preview);
export const parseGregPublished = (raw: unknown): GregResult<GregPublished> => envelope(raw, published);
