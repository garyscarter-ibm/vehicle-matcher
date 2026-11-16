import { describe, expect, it } from 'vitest';
import { parseGregCount, parseGregDemand, parseGregPolicy, parseGregPreview, parseGregPublished } from './greg.projection';

const at = '2026-11-16T12:00:00.000Z';
const versions = { brief: ['brief-7'], policy: ['policy-1'] };
const band = { kind: 'band', fewerThan: 5, label: 'fewer than 5' };
const cell = () => ({ count: { ...band }, versions: { ...versions } });
function demand() {
  return { runId: 'run-1', asOf: at, projectionVersion: 'digest-1', basis: 'expressed-saved-demand', versions: { ...versions, revision: 2 },
    privacy: { threshold: 5, thresholdKey: 'greg.demand.privacyThreshold', policyVersion: 'policy-1', status: 'assumed', withheld: true },
    demand: { activeBriefs: cell(), byModelLine: [{ key: 'G21 Touring', ...cell() }], byBody: [], byFuel: [],
      essentials: [{ field: 'seats', operator: 'gte', value: 5, unit: 'count', state: 'confirmed', ...cell() }], unmet: { total: cell(), byGate: [] } },
    holds: { total: cell(), active: cell(), byState: [], byType: [] },
    offers: { made: cell(), accepted: cell(), declined: cell(), expired: cell(), selected: cell(), declinedByReason: [] },
    stock: { byModelLine: [], source: { status: 'ok' } } };
}
const provenance = { source: 'policy-reference', sourceDate: '2026-11-01', basis: 'Reviewed assumption.', status: 'assumed', unit: 'relative-weight' };
function policy() {
  return { state: 'draft', activeVersion: 'policy-1', activeVersionLabel: 'Reviewed policy', versionNames: { 'policy-1': 'Reviewed policy' }, asOf: at,
    effectiveFrom: '2026-11-01T00:00:00Z', weightsAdoptionRequired: false, heldOffers: { count: null, message: 'Refresh to see active offers keeping their earlier terms.' },
    historyMessage: 'Published versions preserve existing quotes and offers.',
    fields: ['body', 'fuel', 'sportiness', 'comfort', 'economy', 'size'].map(key => ({ id: `weight:${key}`, key, kind: 'weight', label: `${key} weight`,
      value: 1, minimum: 0, step: 1, unitLabel: 'Relative weight', ...provenance })) };
}
const ok = (value: unknown) => ({ status: 'ok', value });

describe('Greg server projection allowlists', () => {
  it('preserves exact server labels and withholds any exact band value', () => {
    expect(parseGregCount({ kind: 'band', atLeast: 5, label: '5 or more' })).toEqual({ kind: 'band', atLeast: 5, label: '5 or more' });
    expect(parseGregCount({ kind: 'exact', value: 12, label: '12' })).toEqual({ kind: 'exact', value: 12, label: '12' });
    for (const malicious of [{ ...band, value: 3 }, { ...band, atLeast: 5 }, { ...band, fewerThan: 0 },
      { ...band, rawCount: 3 }, { kind: 'band', label: 'hidden' }, { kind: 'exact', value: -1, label: '-1' }]) {
      expect(() => parseGregCount(malicious)).toThrow();
    }
  });
  it('maps real groups, versions and privacy caveats without dashboard arithmetic', () => {
    const raw = demand(); const result = parseGregDemand(ok({ ...raw, privateEmployeeIds: ['never-display'] }), 'run-1', 'policy-1');
    expect(result.state).toBe('ready'); if (result.state !== 'ready') return;
    expect(result.value.demand.activeBriefs.count).toEqual(band);
    expect(result.value.demand.byModelLine[0]).toMatchObject({ label: 'G21 Touring', versions });
    expect(result.value.versions).toEqual({ ...versions, revision: 2 });
    expect(result.value.privacyNote).toContain('Other cells may also be withheld'); expect(result.value.overlapNote).toContain('do not add');
    expect(result.value).not.toHaveProperty('privateEmployeeIds'); expect(result.value.versions).not.toHaveProperty('clock');
    expect(result.value.demand.activeBriefs.count).not.toHaveProperty('value');
  });
  it('keeps unavailable, delayed and unchecked stock distinct from a proven empty stock list', () => {
    for (const status of ['unavailable', 'delayed', 'evidence-unavailable', 'not-checked']) {
      const raw = demand(); raw.stock.source.status = status;
      const result = parseGregDemand(ok(raw), 'run-1');
      expect(result.state === 'ready' && result.value.stock).toMatchObject({ unavailable: true, empty: false });
    }
    const empty = parseGregDemand(ok(demand()), 'run-1');
    expect(empty.state === 'ready' && empty.value.stock).toMatchObject({ unavailable: false, empty: true });
  });
  it('retains the frozen gate and essential display meanings', () => {
    const raw = demand(); Object.assign(raw.demand.unmet, { byGate: [{ key: 'essential-unmet:seats', ...cell() }, { key: 'equipment-unconfirmed', ...cell() }] });
    Object.assign(raw.demand, { essentials: [{ field: 'frontIsofix', operator: 'equals', value: true, unit: 'count', state: 'confirmed', ...cell() },
      { field: 'boot', operator: 'gte', value: 400, unit: 'L', state: 'confirmed', ...cell() },
      { field: 'rearHeadroom', operator: 'greaterThan', value: 900, unit: 'mm', state: 'confirmed', ...cell() }] });
    Object.assign(raw.offers, { declinedByReason: [{ key: 'rearHeadroom', ...cell() }] });
    const result = parseGregDemand(ok(raw), 'run-1'); expect(result.state).toBe('ready'); if (result.state !== 'ready') return;
    expect(result.value.demand.unmet.byGate[0]).toMatchObject({ label: 'Essential not met: Seats', severity: 'blocker', severityLabel: 'Blocks the offer' });
    expect(result.value.demand.unmet.byGate[1]).toMatchObject({ label: 'Equipment not confirmed', severity: 'needs-confirmation' });
    expect(result.value.demand.essentials.map(e => e.label)).toEqual(['Front ISOFIX required', 'Boot space at least 400 litres', 'Rear headroom greater than 900 mm']);
    expect(result.value.offers.declinedByReason[0].label).toBe('Rear headroom');
  });
  it('fails closed for missing authority and malformed privacy in any cell', () => {
    for (const key of ['asOf', 'projectionVersion', 'privacy', 'versions', 'holds']) {
      const raw: Record<string, unknown> = demand(); delete raw[key]; expect(parseGregDemand(ok(raw), 'run-1').state).toBe('invalid-response');
    }
    const raw = demand(); Object.assign(raw.offers.accepted.count, { value: 2 });
    expect(parseGregDemand(ok(raw), 'run-1').state).toBe('invalid-response');
    expect(parseGregDemand(ok(demand()), 'run-2').state).toBe('scope-mismatch');
    expect(parseGregDemand(ok(demand()), 'run-1', 'policy-other').state).toBe('scope-mismatch');
  });
  it('accepts Java unknown held count and missing clock without inventing a policy default', () => {
    const result = parseGregPolicy(ok(policy())); expect(result.state).toBe('ready'); if (result.state !== 'ready') return;
    expect(result.value.heldOffers.count).toBeNull(); expect(result.value).not.toHaveProperty('clockVersion');
    expect(result.value.fields[0]).toMatchObject(provenance); expect(result.value.activeVersionLabel).toBe('Reviewed policy');
    expect(parseGregPolicy(ok({ ...policy(), activeVersion: undefined })).state).toBe('invalid-response');
    const duplicate = policy(); duplicate.fields[1] = duplicate.fields[0]; expect(parseGregPolicy(ok(duplicate)).state).toBe('invalid-response');
  });
  it('preserves exact values outside presentation ranges', () => {
    const raw = policy(); Object.assign(raw.fields[0], { value: 999, presentationRange: { minimum: 0, maximum: 10, step: 1, assumptionKey: 'greg.publish.editor.v1', ...provenance } });
    const result = parseGregPolicy(ok(raw)); expect(result.state === 'ready' && result.value.fields[0].value).toBe(999);
  });
  it('retains the actual preview refusal and rejects fabricated or incomplete success', () => {
    const refusal = { status: 'unsupported', code: 'preview-unavailable', reason: 'Policy preview is not available on this service yet.', retryable: false };
    expect(parseGregPreview(refusal)).toEqual({ state: 'refused', value: null, refusal });
    expect(parseGregPreview(ok({ preview: true, activeVersion: 'policy-1', asOf: at, differences: [] })).state).toBe('invalid-response');
  });
  it('accepts Java publication without requiring legacy activation metadata and never invents activation', () => {
    const value = { state: 'published', accepted: true, policyVersion: 'greg-1', effectiveFrom: at, publisher: 'greg-subject', publishedAt: at,
      heldOffers: { count: null, message: 'Refresh active offers.' } };
    const result = parseGregPublished(ok(value)); expect(result.state).toBe('ready'); if (result.state !== 'ready') return;
    expect(result.value).not.toHaveProperty('activation'); expect(result.value.heldOffers.count).toBeNull();
    const pending = { ...value, activationRequired: true, activation: { status: 'pending', policyVersion: 'greg-1', retryable: true, reason: 'Run activation pending.', outcome: 'unavailable' } };
    expect(parseGregPublished(ok(pending)).state).toBe('ready');
    expect(parseGregPublished(ok({ ...pending, activationRequired: false })).state).toBe('invalid-response');
  });
});
