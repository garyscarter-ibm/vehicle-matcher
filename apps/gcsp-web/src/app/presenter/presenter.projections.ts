import type { CountBarRow } from '../kit/count-bars.component';

export interface PresenterRelease {
  readonly runId: string;
  readonly release: { readonly trancheId: string; readonly windowId: string; readonly releasedAt: string } | null;
  readonly cars: readonly { readonly id: string; readonly imageSrc: string | null; readonly imageAlt: string; readonly modelName: string | null; readonly colourName: string | null }[];
  readonly counts: { readonly released: number; readonly totalReleased: number; readonly onScheme: number; readonly buddyAllocated: number; readonly manuallyAllocated: number };
  readonly allocation: { readonly pending: number; readonly declined: number; readonly accepted: number } | null;
  readonly modelLines: readonly { readonly modelLine: string; readonly count: number }[];
  readonly charts: { readonly colours: readonly CountBarRow[]; readonly points: readonly CountBarRow[]; readonly fuel: readonly CountBarRow[] };
}
export interface SuitabilityEvidence { readonly code: string; readonly field?: string; readonly requirement?: { readonly value?: string | number | boolean | readonly (string | number | boolean)[]; readonly operator?: string; readonly unit?: string }; readonly [key: string]: unknown }
export interface SuitabilityCell {
  readonly employeeId: string; readonly state: 'not-evaluated' | 'evaluated'; readonly gateStatus?: string;
  readonly score?: number | null; readonly blockers?: readonly SuitabilityEvidence[]; readonly unknowns?: readonly SuitabilityEvidence[]; readonly reasons?: readonly SuitabilityEvidence[];
  readonly outdated?: boolean; readonly recorded?: { readonly evaluatedAt: string | null; readonly briefVersion: number | null; readonly policyVersion: string | null; readonly allocationRule: string | null };
  readonly outcome?: { readonly state: string; readonly employeeId?: string };
}
export interface SuitabilityCar {
  readonly id: string; readonly name: string; readonly orderNumber: string | null; readonly colour: string | null;
  readonly availability: { readonly state: string; readonly employeeId?: string; readonly employeeName?: string; readonly route?: string };
  readonly cells: readonly SuitabilityCell[];
}
export interface SuitabilityPage { readonly page: number; readonly pages: number; readonly total: number; readonly size: number }
export interface PresenterSuitability {
  readonly runId: string; readonly asOf: string; readonly release: 'all' | 'latest';
  readonly policy: { readonly version: string; readonly minimumFit: number | null; readonly allocationRule: string | null };
  readonly paging: { readonly cars: SuitabilityPage; readonly buddies: SuitabilityPage };
  readonly buddies: readonly { readonly id: string; readonly name: string; readonly briefVersion: number }[];
  readonly people: readonly { readonly id: string; readonly name: string }[]; readonly cars: readonly SuitabilityCar[];
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const nullable = (v: unknown) => v === null || text(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const instant = (v: unknown): v is string => text(v) && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
const image = (v: unknown): v is string | null => v === null || text(v) && !/[\u0000-\u0020\u007f\\]/.test(v) && (/^\/(?!\/)/.test(v) || (() => { try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } })());
const bars = (v: unknown): v is CountBarRow[] => Array.isArray(v) && v.every(row => object(row) && text(row['label']) && count(row['count']));
export function parseRelease(v: unknown): PresenterRelease | null {
  if (!object(v) || !text(v['runId']) || !object(v['counts']) || !object(v['charts']) || !Array.isArray(v['cars']) || !Array.isArray(v['modelLines'])) return null;
  const release = v['release']; const allocation = v['allocation']; const counts = v['counts']; const charts = v['charts'];
  if (release !== null && (!object(release) || !text(release['trancheId']) || !text(release['windowId']) || !instant(release['releasedAt']))) return null;
  if (!['released', 'totalReleased', 'onScheme', 'buddyAllocated', 'manuallyAllocated'].every(key => count(counts[key]))
    || allocation !== null && (!object(allocation) || !['pending', 'declined', 'accepted'].every(key => count(allocation[key])))
    || !['colours', 'points', 'fuel'].every(key => bars(charts[key]))) return null;
  if (!v['cars'].every(car => object(car) && text(car['id']) && image(car['imageSrc']) && typeof car['imageAlt'] === 'string' && nullable(car['modelName']) && nullable(car['colourName']))
    || !v['modelLines'].every(line => object(line) && text(line['modelLine']) && count(line['count']))) return null;
  return v as unknown as PresenterRelease;
}
function paging(v: unknown): v is SuitabilityPage { return object(v) && ['page', 'pages', 'size'].every(key => count(v[key]) && v[key] > 0) && count(v['total']) && Number(v['page']) <= Number(v['pages']); }
function evidence(v: unknown): v is SuitabilityEvidence[] { return Array.isArray(v) && v.every(entry => object(entry) && text(entry['code'])); }
function cell(v: unknown): v is SuitabilityCell {
  if (!object(v) || !text(v['employeeId'])) return false;
  if (v['state'] === 'not-evaluated') return true;
  const rec = v['recorded']; const outcome = v['outcome'];
  return v['state'] === 'evaluated' && ['eligible', 'ineligible', 'needs-confirmation'].includes(String(v['gateStatus']))
    && (v['score'] === null || typeof v['score'] === 'number' && Number.isFinite(v['score']) && v['score'] >= 0 && v['score'] <= 100)
    && evidence(v['blockers']) && evidence(v['unknowns']) && evidence(v['reasons']) && typeof v['outdated'] === 'boolean'
    && object(rec) && (rec['evaluatedAt'] === null || instant(rec['evaluatedAt'])) && (rec['briefVersion'] === null || count(rec['briefVersion']))
    && nullable(rec['policyVersion']) && nullable(rec['allocationRule']) && object(outcome)
    && ['assigned', 'assigned-other-car', 'not-assigned'].includes(String(outcome['state'])) && (outcome['state'] !== 'assigned' || text(outcome['employeeId']));
}
export function parseSuitability(v: unknown): PresenterSuitability | null {
  if (!object(v) || !text(v['runId']) || !instant(v['asOf']) || !['all', 'latest'].includes(String(v['release'])) || !object(v['policy']) || !object(v['paging'])) return null;
  const policy = v['policy']; const page = v['paging'];
  if (!text(policy['version']) || !(policy['minimumFit'] === null || typeof policy['minimumFit'] === 'number' && Number.isFinite(policy['minimumFit']))
    || !nullable(policy['allocationRule']) || !paging(page['cars']) || !paging(page['buddies'])) return null;
  if (!Array.isArray(v['buddies']) || !v['buddies'].every(row => object(row) && text(row['id']) && text(row['name']) && count(row['briefVersion']))
    || !Array.isArray(v['people']) || !v['people'].every(row => object(row) && text(row['id']) && text(row['name'])) || !Array.isArray(v['cars'])) return null;
  const buddies = v['buddies'] as { id: string }[];
  if (!v['cars'].every(car => object(car) && text(car['id']) && text(car['name']) && nullable(car['colour']) && nullable(car['orderNumber'])
    && object(car['availability']) && ['available', 'reserved', 'allocated', 'unavailable'].includes(String(car['availability']['state']))
    && Array.isArray(car['cells']) && car['cells'].length === buddies.length && car['cells'].every((entry, index) => cell(entry) && entry.employeeId === buddies[index].id))) return null;
  return v as unknown as PresenterSuitability;
}
