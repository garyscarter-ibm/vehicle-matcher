import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort } from '../auth/auth.port';
import { GregPolicyComponent } from './greg-policy.component';
import { projectDemand } from './greg.projection';
import { GregStore, GregView } from './greg.store';
import type { GregCount, GregPolicy, GregPreview, GregPublished } from './greg.types';

const at = '2026-11-16T12:00:00Z';
const provenance = { source: 'reference', sourceDate: '2026-11-01', basis: 'Fictional facts for mechanics; supplied assumptions.', status: 'assumed', unit: 'relative-weight' };
function policy(): GregPolicy {
  const range = { ...provenance, minimum: 0, maximum: 10, step: 1 as const, assumptionKey: 'greg.publish.editor.v1' };
  return { state: 'draft', activeVersion: 'policy-1', activeVersionLabel: 'Reviewed policy', versionNames: { 'policy-1': 'Reviewed policy' }, effectiveFrom: at, asOf: at,
    weightsAdoptionRequired: true, heldOffers: { count: null, message: 'Refresh active offers to see earlier terms.' }, historyMessage: 'Existing offers keep their terms.',
    fields: [0, 1].map(n => ({ ...provenance, id: `price:row-${n}`, key: `row-${n}`, kind: 'price' as const, value: 5, minimum: 0 as const, step: 1 as const,
      label: `Touring cost ${n}`, unit: 'points', unitLabel: 'points per month', schemeId: 'scheme-1', schemeLabel: 'Employee scheme', configurationId: `config-${n}`, presentationRange: range })) };
}
function withWeights(): GregPolicy { const p = policy(); return { ...p, fields: [...p.fields, ...['body', 'fuel', 'sportiness', 'comfort', 'economy', 'size'].map(key => ({
  ...provenance, id: `weight:${key}`, key, kind: 'weight' as const, value: 1, minimum: 0 as const, step: 1 as const, label: `${key} weight`, unitLabel: 'Relative weight' }))] }; }
function preview(): GregPreview {
  const band: GregCount = { kind: 'band', fewerThan: 5, label: 'fewer than 5' }; const exact: GregCount = { kind: 'exact', value: 12, label: '12' };
  const versions = { brief: ['brief-1'], policy: ['policy-1'] }; const cell = { count: band, versions };
  const demand = projectDemand({ runId: 'run-1', asOf: at, projectionVersion: 'digest-1', basis: 'expressed-saved-demand', versions: { ...versions, revision: 1 },
    privacy: { threshold: 5, thresholdKey: 'privacy', policyVersion: 'policy-1', status: 'assumed', withheld: true },
    demand: { activeBriefs: cell, byModelLine: [], byBody: [], byFuel: [], essentials: [], unmet: { total: cell, byGate: [] } },
    holds: { total: cell, active: cell, byState: [], byType: [] }, offers: { made: cell, accepted: cell, declined: cell, expired: cell, selected: cell, declinedByReason: [] }, stock: { byModelLine: [], source: { status: 'ok' } } });
  return { preview: true, activeVersion: 'policy-1', asOf: at, differences: [{ id: 'price:row-0', before: 5, after: 8, unit: 'points' }],
    active: { demand, fit: { employeesWithEligibleStock: exact, scoredBriefs: band, meanBestScore: { status: 'suppressed', fewerThan: 5 } } },
    draft: { demand, fit: { employeesWithEligibleStock: { kind: 'exact', value: 14, label: '14' }, scoredBriefs: band, meanBestScore: { status: 'available', value: 82.25 } } },
    heldOffers: { count: null, message: 'Earlier offers retain their terms.' } };
}
function view(): GregView { const p = withWeights(); return { demandState: 'ready', policyState: 'ready', demand: null, policy: p,
  fields: p.fields.map(f => ({ ...f, draft: String(f.value), error: '', outsideRange: false })), pending: false, action: null, preview: null, publication: null,
  retainedCommand: null, uncertain: false, message: 'Draft. Change values, then preview their effect.', demandMessage: '', policyMessage: '', canEdit: true, canPreview: false, canPublish: false, canRetry: false }; }
function publication(): GregPublished { return { state: 'published', accepted: true, policyVersion: 'greg-1', effectiveFrom: at, publisher: 'greg', publishedAt: at,
  heldOffers: { count: null, message: 'Earlier offers retain their terms.' }, activation: { status: 'pending', policyVersion: 'greg-1', retryable: true, reason: 'Activation pending.', outcome: 'unavailable' } }; }

describe('Greg policy screen', () => {
  let fixture: ComponentFixture<GregPolicyComponent>; let state = signal(view());
  const store = { view: () => state(), setField: vi.fn(), refresh: vi.fn(), signIn: vi.fn(), retryAuthentication: vi.fn(),
    previewChanges: vi.fn().mockResolvedValue(false), publishPreview: vi.fn().mockResolvedValue(false), retryPublication: vi.fn().mockResolvedValue(false) };
  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => root().textContent!;
  const button = (label: string) => [...root().querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label)!;
  const input = (id: string) => root().querySelector<HTMLInputElement>(`#${fixture.componentInstance.controlId(id)}`)!;
  beforeEach(async () => {
    state = signal(view()); vi.clearAllMocks(); await TestBed.configureTestingModule({ imports: [GregPolicyComponent], providers: [{ provide: GregStore, useValue: store },
      { provide: AuthPort, useValue: { state: signal({ status: 'loading' }) } }] }).compileComponents();
    fixture = TestBed.createComponent(GregPolicyComponent); fixture.detectChanges();
  });
  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });

  it('keeps native controls and price drafts mounted across row selection and server status changes', () => {
    const first = input('price:row-0'); const second = input('price:row-1'); const weight = input('weight:body'); const select = root().querySelector('select')!;
    expect(root().querySelectorAll('input[type=number]')).toHaveLength(8); expect(first.min).toBe('0'); expect(first.max).toBe(String(Number.MAX_SAFE_INTEGER));
    first.value = '8'; first.dispatchEvent(new Event('input', { bubbles: true })); expect(store.setField).toHaveBeenCalledWith('price:row-0', '8');
    state.update(v => ({ ...v, fields: v.fields.map(f => f.id === 'price:row-0' ? { ...f, draft: '8' } : f) })); fixture.detectChanges();
    select.value = 'price:row-1'; select.dispatchEvent(new Event('change')); fixture.detectChanges();
    expect(first.closest('.policy-control')!.hasAttribute('hidden')).toBe(true); expect(second.closest('.policy-control')!.hasAttribute('hidden')).toBe(false);
    state.update(v => ({ ...v, policyState: 'unsupported', message: 'Policy preview is not available on this service yet.', canPreview: true })); fixture.detectChanges();
    select.value = 'price:row-0'; select.dispatchEvent(new Event('change')); fixture.detectChanges();
    expect(input('price:row-0')).toBe(first); expect(first.value).toBe('8'); expect(input('weight:body')).toBe(weight); expect(button('Publish this preview').disabled).toBe(true);
    expect(first.disabled).toBe(false); expect(text()).toContain('not available on this service yet'); expect(store.publishPreview).not.toHaveBeenCalled();
  });
  it('synchronises optional ranges through raw store edits and retains exact out-of-range values', () => {
    const slider = root().querySelector<HTMLInputElement>(`#${fixture.componentInstance.controlId('price:row-0')}-slider`)!;
    slider.value = '7'; slider.dispatchEvent(new Event('input')); expect(store.setField).toHaveBeenCalledWith('price:row-0', '7');
    state.update(v => ({ ...v, fields: v.fields.map(f => f.id === 'price:row-0' ? { ...f, draft: '999', outsideRange: true } : f) })); fixture.detectChanges();
    expect(input('price:row-0').value).toBe('999'); expect(slider.closest('.policy-slider')!.hasAttribute('hidden')).toBe(true); expect(slider.disabled).toBe(true);
    expect(text()).toContain('Exact value 999 is outside the slider range 0 to 10. It is retained.'); expect(text()).toContain('A slider range is not supplied for this policy row.');
  });
  it('opens and focuses a hidden price error with linked native error descriptions', () => {
    state.update(v => ({ ...v, fields: v.fields.map(f => f.id === 'price:row-1' ? { ...f, draft: '', error: 'Enter a whole number.' } : f) })); fixture.detectChanges();
    const control = input('price:row-1'); const link = root().querySelector<HTMLAnchorElement>('.gcsp-error-summary a')!;
    expect(control.getAttribute('aria-invalid')).toBe('true'); expect(control.getAttribute('aria-describedby')).toContain(`${control.id}-error`);
    link.click(); fixture.detectChanges(); expect(control.closest('.policy-control')!.hasAttribute('hidden')).toBe(false); expect(control.ownerDocument.activeElement).toBe(control);
  });
  it('shows only real preview labels and privacy-safe presentation differences before deliberate publish', () => {
    state.update(v => ({ ...v, preview: preview(), canPublish: true })); fixture.detectChanges();
    expect(text()).toContain('Unknown (privacy bands)'); expect(text()).toContain('Suppressed for privacy'); expect(text()).toContain('82.3 / 100');
    expect(text()).toContain('Unknown (privacy suppression)'); expect(text()).toContain('Recommendation fit is not predicted acceptance.');
    expect(root().querySelector('table tbody tr:nth-child(2) td:last-child')!.textContent).toBe('2');
    expect(store.publishPreview).not.toHaveBeenCalled(); button('Publish this preview').click(); expect(store.publishPreview).toHaveBeenCalledOnce();
  });
  it('maps source prose for display while preserving unknown held counts and source data', () => {
    expect(text()).toContain('Vehicle and driver facts are assumed; supplied assumptions.'); expect(text()).not.toContain('Fictional facts');
    expect(state().policy!.fields[0].basis).toBe(provenance.basis); expect(text()).toContain('Refresh active offers to see earlier terms.'); expect(text()).not.toContain('0 active offers');
    expect(root().querySelectorAll('details summary')[0].textContent).toBe('Sources and assumptions');
  });
  it('distinguishes saved pending, unknown activation and unknown receipt without replaying on refresh', () => {
    const command = { commandId: 'command-1', expectedActiveVersion: 'policy-1', policyVersion: 'greg-1', effectiveFrom: at, changes: [{ id: 'price:row-0', value: 8 }] };
    state.update(v => ({ ...v, publication: publication(), retainedCommand: command, canEdit: false, canPreview: false, canRetry: false })); fixture.detectChanges();
    expect(text()).toContain('Policy saved, activation pending'); expect(text()).toContain('Publisher'); expect(text()).toContain('greg');
    expect(button('Retry original publication')).toBeUndefined(); expect(input('price:row-0').disabled).toBe(true);
    button('Refresh demand and policy').click(); expect(store.refresh).toHaveBeenCalledOnce(); expect(store.retryPublication).not.toHaveBeenCalled();
    state.update(v => ({ ...v, canRetry: true })); fixture.detectChanges(); button('Retry original publication').click(); expect(store.retryPublication).toHaveBeenCalledOnce();
    state.update(v => ({ ...v, uncertain: true, canRetry: false, message: 'Activation retry outcome unknown.' })); fixture.detectChanges(); expect(text()).toContain('Policy saved, activation not confirmed');
    state.update(v => ({ ...v, publication: null })); fixture.detectChanges(); expect(text()).toContain('Publication outcome unknown'); expect(text()).toContain('command-1'); expect(text()).toContain('Do not create another publication.');
    state.update(v => ({ ...v, uncertain: false, retainedCommand: null, publication: { ...publication(), activation: undefined } })); fixture.detectChanges(); expect(text()).toContain('The save was accepted. This response does not confirm which policy is active.');
    state.update(v => ({ ...v, publication: { ...publication(), activation: { status: 'active', policyVersion: 'later-policy', asOf: at, publishedVersionActive: false } } })); fixture.detectChanges(); expect(text()).toContain('Policy saved, a later policy is active');
  });
});
