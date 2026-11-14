import type { CaseAudience, CaseDetailValue, CaseDisplay, CaseEvidence, CaseFact, CaseHelp, CaseHistory,
  CaseList, CaseOptions, CaseRead, CaseRecord, CaseRefusal, CaseRefusalStatus, CaseRemedy, CaseScope, CaseStatus } from './case.types';

// Pure boundary/display projection of Java CaseService, with frozen case-content/queue semantics.
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const nullable = (v: unknown, check: (v: unknown) => boolean): boolean => v === null || check(v);
const statuses: readonly CaseStatus[] = ['open', 'in-progress', 'remedy-proposed', 'resolved', 'closed'];
const status = (v: unknown): v is CaseStatus => typeof v === 'string' && statuses.includes(v as CaseStatus);
const calendar = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
// Instant.toString() can carry nanoseconds; do not impose JavaScript's three-digit precision on the wire.
const instant = (v: unknown): v is string => typeof v === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(v) && Number.isFinite(Date.parse(v))
  && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
const trigger = (v: unknown): boolean => object(v) && text(v['type']) && (v['label'] === undefined || text(v['label']));
function remedy(v: unknown): v is CaseRemedy {
  if (!object(v) || !text(v['type'])) return false;
  switch (v['type']) {
    case 'manual-decision': return text(v['decision']);
    case 'contract-extension': return calendar(v['until']);
    case 'later-release': return instant(v['releaseAt']) && text(v['source']);
    case 'alternative-car': return text(v['orderUuid']) && (v['carName'] == null || typeof v['carName'] === 'string')
      && (v['snapshot'] === undefined || object(v['snapshot'])) && (v['unknowns'] === undefined || Array.isArray(v['unknowns']));
    default: return true; // Unknown recorded evidence is readable; it grants no client action.
  }
}
function history(v: unknown): v is CaseHistory {
  return object(v) && nullable(v['at'], instant) && text(v['actorId']) && text(v['actorRole']) && status(v['status'])
    && typeof v['reason'] === 'string' && typeof v['nextAction'] === 'string' && nullable(v['dueAt'], instant)
    && (v['trigger'] === undefined || trigger(v['trigger'])) && nullable(v['remedy'], remedy);
}
function record(v: unknown): v is CaseRecord {
  return object(v) && text(v['caseId']) && v['caseId'].length <= 128 && text(v['runId']) && text(v['employeeId'])
    && text(v['renewalId']) && object(v['owner']) && text(v['owner']['role'])
    && nullable(v['owner']['name'], (name) => typeof name === 'string') && status(v['status'])
    && typeof v['reason'] === 'string' && nullable(v['trigger'], trigger) && typeof v['nextAction'] === 'string'
    && ['dueAt', 'openedAt', 'lastUpdatedAt'].every((key) => nullable(v[key], instant))
    && nullable(v['renewalDeadline'], calendar) && typeof v['renewalDeadlineState'] === 'string' && text(v['policyVersion'])
    && Array.isArray(v['history']) && v['history'].every(history) && nullable(v['remedy'], remedy)
    && typeof v['fictional'] === 'boolean' && positive(v['version'])
    && (v['employeeName'] === undefined || typeof v['employeeName'] === 'string');
}
function validScope(scope: CaseScope): boolean {
  return text(scope.runId) && (scope.audience === 'scheme-team' || scope.audience === 'employee' && text(scope.employeeId));
}
function inScope(row: CaseRecord, scope: CaseScope): boolean {
  return validScope(scope) && row.runId === scope.runId && (scope.audience === 'scheme-team' || row.employeeId === scope.employeeId);
}
const invalid = (): CaseRead<never> => ({ state: 'invalid-response', value: null });
const mismatch = (): CaseRead<never> => ({ state: 'scope-mismatch', value: null });
const refusalStatuses: readonly CaseRefusalStatus[] = ['invalid', 'unauthenticated', 'forbidden', 'not-found', 'stale-version', 'conflict', 'unavailable'];
function refusal(v: Record<string, unknown>): CaseRefusal | null {
  if (!refusalStatuses.includes(v['status'] as CaseRefusalStatus) || !text(v['code']) || !text(v['reason']) || typeof v['retryable'] !== 'boolean'
    || ['action', 'operationId'].some((key) => v[key] !== undefined && !text(v[key]))
    || ['expectedVersion', 'currentVersion'].some((key) => v[key] !== undefined && !positive(v[key]))) return null;
  const reasons = v['reasons'];
  if (reasons !== undefined && (!Array.isArray(reasons) || !reasons.every((r: unknown) => object(r) && text(r['field']) && text(r['reason'])))) return null;
  // Whitelist refusal evidence. An attached value/case/history is never retained on denial or uncertainty.
  return { status: v['status'] as CaseRefusalStatus, code: v['code'], reason: v['reason'], retryable: v['retryable'],
    ...(reasons === undefined ? {} : { reasons: (reasons as { field: string; reason: string }[]).map(({ field, reason }) => ({ field, reason })) }),
    ...(v['action'] === undefined ? {} : { action: v['action'] as string }),
    ...(v['operationId'] === undefined ? {} : { operationId: v['operationId'] as string }),
    ...(v['expectedVersion'] === undefined ? {} : { expectedVersion: v['expectedVersion'] as number }),
    ...(v['currentVersion'] === undefined ? {} : { currentVersion: v['currentVersion'] as number }) };
}
function read<T>(input: unknown, accepts: (v: unknown) => v is T): CaseRead<T> {
  if (input == null) return { state: 'not-loaded', value: null };
  if (!object(input)) return invalid();
  if (input['status'] !== 'ok') {
    const failed = refusal(input);
    return failed ? { state: 'refused', value: null, refusal: failed } : invalid();
  }
  if (input['replayed'] !== undefined && input['replayed'] !== true) return invalid();
  try {
    const value: unknown = structuredClone(input['value']);
    return accepts(value) ? { state: 'ready', value, replayed: input['replayed'] === true } : invalid();
  } catch { return invalid(); }
}
const metadata = (v: Record<string, unknown>): boolean => instant(v['asOf']) && text(v['policyVersion']);

export function parseCaseList(input: unknown, scope: CaseScope): CaseRead<CaseList> {
  if (!validScope(scope)) return mismatch();
  const result = read(input, (v): v is CaseList => object(v) && metadata(v) && Array.isArray(v['cases']) && v['cases'].every(record)
    && new Set(v['cases'].map((row) => row.caseId)).size === v['cases'].length);
  if (result.state !== 'ready') return result;
  return result.value.cases.every((row) => inScope(row, scope) && (scope.audience === 'employee' || text(row.employeeName))) ? result : mismatch();
}
export function parseCaseDetail(input: unknown, scope: CaseScope, expectedCaseId?: string): CaseRead<CaseDetailValue> {
  if (!validScope(scope)) return mismatch();
  const result = read(input, (v): v is CaseDetailValue => object(v) && record(v['case'])
    && (v['asOf'] === undefined && v['policyVersion'] === undefined || metadata(v)));
  if (result.state !== 'ready') return result;
  return inScope(result.value.case, scope) && (expectedCaseId === undefined || result.value.case.caseId === expectedCaseId) ? result : mismatch();
}
function group(v: unknown, type: string): boolean {
  return object(v) && typeof v['available'] === 'boolean' && Array.isArray(v['items'])
    && v['available'] === (v['items'].length > 0) && v['items'].every((item: unknown) => remedy(item) && item.type === type)
    && (v['reason'] === undefined || text(v['reason']));
}
function options(v: unknown): v is CaseOptions {
  if (!object(v) || !metadata(v) || !record(v['case']) || !Array.isArray(v['nextStatuses']) || !v['nextStatuses'].every(status)
    || new Set(v['nextStatuses']).size !== v['nextStatuses'].length || v['automaticRecoveryPriority'] !== false || !object(v['options'])) return false;
  const o = v['options']; const cars = o['alternativeCars']; const manual = o['manualDecision']; const extension = o['contractExtension'];
  return group(cars, 'alternative-car') && object(cars) && Array.isArray(cars['needsConfirmation'])
    && cars['needsConfirmation'].every((car: unknown) => remedy(car) && car.type === 'alternative-car' && Array.isArray(car['unknowns']))
    && group(o['preferenceRelaxations'], 'preference-relaxation') && group(o['laterRelease'], 'later-release')
    && object(manual) && manual['available'] === true && manual['type'] === 'manual-decision' && manual['requiresDecision'] === true
    && object(extension) && typeof extension['available'] === 'boolean' && extension['type'] === 'contract-extension'
    && nullable(extension['contractEndDate'], calendar) && (!extension['available'] || calendar(extension['contractEndDate']))
    && extension['requiresUntil'] === true && (extension['reason'] === undefined || text(extension['reason']));
}
export function parseCaseOptions(input: unknown, scope: CaseScope, expectedCaseId: string): CaseRead<CaseOptions> {
  if (!validScope(scope) || scope.audience !== 'scheme-team') return mismatch();
  const result = read(input, options);
  if (result.state !== 'ready') return result;
  return inScope(result.value.case, scope) && result.value.case.caseId === expectedCaseId ? result : mismatch();
}
export function parseCaseHelp(input: unknown, scope: CaseScope): CaseRead<CaseHelp> {
  if (!validScope(scope) || scope.audience !== 'employee') return mismatch();
  return read(input, (v): v is CaseHelp => object(v) && v['opensCase'] === false && text(v['ownerRole'])
    && typeof v['extensionPermitted'] === 'boolean' && text(v['nextAction']) && v['automaticRecoveryPriority'] === false
    && text(v['policyVersion']) && Array.isArray(v['assumptions']) && v['assumptions'].every(object));
}

export const caseNotice = 'Remedies need the scheme team’s decision. No specific next car or greater priority is guaranteed.';
const words = (v: string): string => v.replace(/-/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
export const shownCaseText = (v: unknown): string => text(v) ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : 'Not supplied';
export const caseStatusLabel = (v: CaseStatus): string => ({ open: 'Open', 'in-progress': 'In progress',
  'remedy-proposed': 'Remedy proposed', resolved: 'Resolved', closed: 'Closed' })[v];
export const caseRoleLabel = (v: string): string => v === 'scheme-team' ? 'Scheme team' : v === 'employee' ? 'Employee'
  : v === 'system' ? 'Automatic check' : words(v);
export const caseReference = (id: string): string => id ? id.replace(/^renewal-/, '').slice(0, 8).toUpperCase() : 'Not supplied';
const ukTime = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
export function caseTime(value: unknown, audience: CaseAudience): string {
  if (!instant(value)) return 'Not supplied';
  return audience === 'employee' ? ukTime.format(new Date(value))
    : new Date(value).toISOString().replace('T', ' ').replace(/\.000Z$/, ' UTC').replace(/Z$/, ' UTC');
}
function triggerLabel(value: CaseRecord['trigger']): string {
  if (!value) return 'Not supplied';
  if (text(value.label)) return value.label;
  const known = new Map([['employee-request', 'Help request'], ['renewal-deadline', 'Renewal deadline approaching'],
    ['approval-declined', 'Order approval declined'], ['appointment-no-show', 'Missed handover appointment']]);
  return known.get(value.type) ?? (text(value['eventType']) ? known.get(value['eventType']) ?? words(value['eventType']) : words(value.type));
}
const facts = (rows: readonly (readonly [string, unknown])[]): readonly CaseFact[] => rows.map(([label, value]) => ({ label, value: shownCaseText(value) }));
export function projectCase(row: CaseRecord, scope: CaseScope): CaseDisplay | null {
  if (!inScope(row, scope)) return null;
  const audience = scope.audience; const at = (label: string): string => audience === 'employee' ? label : `${label} (UTC)`;
  const owner = text(row.owner.name) ? row.owner.name : caseRoleLabel(row.owner.role);
  const role = caseRoleLabel(row.owner.role); const r = row.remedy;
  let remedyFacts: readonly CaseFact[] = [];
  if (r) {
    if (r.type === 'manual-decision') remedyFacts = facts([['Scheme-team decision', r['decision']]]);
    else if (r.type === 'contract-extension') remedyFacts = facts([['Proposed contract end (calendar date)', r['until']]]);
    else if (r.type === 'later-release') remedyFacts = facts([[at('Reviewed release'), caseTime(r['releaseAt'], audience)], ['Source', r['source']]]);
    else if (r.type === 'alternative-car') remedyFacts = facts([[['resolved', 'closed'].includes(row.status) ? 'Recorded car' : 'Proposed car',
      text(r['carName']) ? r['carName'] : 'Car details not supplied'], ...(audience === 'scheme-team' ? [['Exact car reference', r['orderUuid']] as const] : [])]);
    else remedyFacts = facts([['Remedy', words(r.type)]]);
  }
  return { caseId: row.caseId, reference: caseReference(row.caseId), status: caseStatusLabel(row.status),
    employee: audience === 'scheme-team' ? text(row.employeeName) ? row.employeeName : row.employeeId : null, owner,
    facts: facts([['Case reference', caseReference(row.caseId)], ['Owner', owner], ...(owner.toLowerCase() === role.toLowerCase() ? [] : [['Owner role', role] as const]),
      ['Reason', row.reason], ['Latest update', row.history.at(-1)?.reason ?? row.reason], ['Opened from', triggerLabel(row.trigger)],
      ['Next action', row.nextAction], [at('Due'), caseTime(row.dueAt, audience)], ['Renewal deadline (calendar date)', row.renewalDeadline ?? 'Needs confirmation']]),
    remedy: r ? { title: ['resolved', 'closed'].includes(row.status) ? 'Recorded remedy' : 'Proposed remedy', facts: remedyFacts } : null,
    history: row.history.map((h) => facts([[at('Time'), caseTime(h.at, audience)], ['Actor', h.actorRole === 'system' ? 'Automatic check'
      : audience === 'scheme-team' ? h.actorId : h.actorId === row.employeeId || h.actorRole === 'employee' ? 'You'
        : h.actorRole === 'scheme-team' ? owner : caseRoleLabel(h.actorRole)], ['Role', caseRoleLabel(h.actorRole)],
      ['Status', caseStatusLabel(h.status)], ['Reason', h.reason], ['Next action', h.nextAction], [at('Due'), caseTime(h.dueAt, audience)]])), source: row };
}

/** Frozen queue order: calendar deadline, active first; status order is display order only. */
export function sortCases(rows: readonly CaseRecord[], order: 'deadline' | 'status' = 'deadline'): CaseRecord[] {
  const rank = (row: CaseRecord): number => statuses.indexOf(row.status);
  const terminal = (row: CaseRecord): number => Number(row.status === 'resolved' || row.status === 'closed');
  const deadline = (a: CaseRecord, b: CaseRecord): number => (a.renewalDeadline ?? '9999-99-99').localeCompare(b.renewalDeadline ?? '9999-99-99');
  return [...rows].sort((a, b) => (order === 'status' ? rank(a) - rank(b) || deadline(a, b)
    : terminal(a) - terminal(b) || deadline(a, b) || rank(a) - rank(b)) || a.caseId.localeCompare(b.caseId));
}

/** Disambiguate supplied same-name cars without replacing their exact orderUuid identity. */
export function carOptionNames(cars: readonly CaseEvidence[]): string[] {
  const name = (car: CaseEvidence): unknown => object(car['snapshot']) && object(car['snapshot']['display']) ? car['snapshot']['display']['name'] : null;
  const parts = cars.map((car) => [text(name(car)) ? name(car) as string : 'Car details not supplied']);
  const label = (i: number): string => parts[i].join(', ');
  const clashes = (): boolean[] => parts.map((_, i) => parts.some((__, j) => i !== j && label(i) === label(j)));
  for (const key of ['derivative', 'trim', 'colour', 'confirmedDeliveryWeek']) {
    const clash = clashes(); if (!clash.includes(true)) break;
    const before = parts.map((_, i) => label(i));
    const values = cars.map((car) => {
      const snapshot = car['snapshot']; const f = object(snapshot) && object(snapshot['facts']) ? snapshot['facts'][key] : null;
      return object(f) && f['status'] === 'known' && (text(f['value']) || typeof f['value'] === 'number' && Number.isFinite(f['value'])) ? String(f['value']) : null;
    });
    cars.forEach((_, i) => {
      const value = values[i];
      if (clash[i] && value && !before[i].toLowerCase().includes(value.toLowerCase())
        && cars.some((__, j) => j !== i && before[j] === before[i] && values[j] !== value)) parts[i].push(key === 'confirmedDeliveryWeek' ? `delivery week of ${value}` : value);
    });
  }
  const clash = clashes();
  cars.forEach((car, i) => { if ((clash[i] || !text(name(car))) && text(car['orderUuid'])) parts[i].push(`reference ${car['orderUuid']}`); });
  return parts.map((_, i) => label(i));
}
