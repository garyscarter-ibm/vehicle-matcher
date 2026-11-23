import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { LoadingSkeletonComponent } from './loading-skeleton.component';

@Component({ imports: [LoadingSkeletonComponent], template: '<div gcspLoadingSkeleton [label]="label()" [layout]="layout()" [role]="role()" [items]="items()" [labels]="labels()"></div>' })
class SkeletonHost {
  readonly label = signal('Loading your offer.');
  readonly layout = signal('offer');
  readonly role = signal<string | null>('status');
  readonly items = signal<number | null | undefined>(undefined);
  readonly labels = signal<readonly string[] | null | undefined>(undefined);
}
afterEach(() => TestBed.resetTestingModule());
const classTokens = (value: Element | string) => (typeof value === 'string' ? value.split(' ') : Array.from(value.classList)).sort().join(' ');

async function render(layout = 'offer') {
  const fixture = TestBed.createComponent(SkeletonHost); fixture.componentInstance.layout.set(layout); await fixture.whenStable();
  return { fixture, host: fixture.componentInstance, root: (fixture.nativeElement as HTMLElement).querySelector('[gcspLoadingSkeleton]')! };
}

describe('canonical source loading skeleton', () => {
  it('uses the source page, Loading label and one status by default', async () => {
    const fixture = TestBed.createComponent(LoadingSkeletonComponent); await fixture.whenStable(); const root = fixture.nativeElement as HTMLElement;
    expect(root.getAttribute('data-layout')).toBe('page'); expect(root.querySelector('p.gcsp-vh[role="status"]')?.textContent).toBe('Loading');
    expect(root.querySelectorAll('.gcsp-skeleton-shapes > *')).toHaveLength(5);
  });
  it.each([
    ['page', ['title', 'line', 'line-short', 'card', 'rows']],
    ['form', ['title', 'line', 'panel', 'panel']], ['timeline', ['title', 'card-text', 'rows']],
    ['card', ['title', 'card']], ['feature', ['title', 'feature', 'panel', 'rows']],
    ['console', ['title', 'line-short', 'actions', 'panel', 'rows']], ['section', ['rows']],
    ['release-grid', ['tiles']], ['stats', ['stats']], ['bars', ['bars']],
    ['offer', ['offer-header', 'offer-card', 'panel', 'rows']], ['media', ['media']],
  ])('keeps the source top-level shapes for %s', async (layout, expected) => {
    const { root } = await render(layout as string);
    expect(root.tagName).toBe('DIV'); expect(root.className).toBe('gcsp-skeleton'); expect(root.getAttribute('data-layout')).toBe(layout);
    expect(root.getAttribute('aria-busy')).toBe('true'); expect(root.hasAttribute('role')).toBe(false);
    expect(root.querySelector(':scope > p.gcsp-vh[role="status"]')?.textContent).toBe('Loading your offer.');
    const shapes = root.querySelector('.gcsp-skeleton-shapes')!; expect(shapes?.getAttribute('aria-hidden')).toBe('true');
    const names: Record<string, string> = { card: 'gcsp-skeleton-card', 'card-text': 'gcsp-skeleton-card', feature: 'gcsp-skeleton-card gcsp-skeleton-feature', tiles: 'gcsp-skeleton-release-grid', bars: 'gcsp-count-bars-rows', actions: 'gcsp-skeleton-actions', rows: 'gcsp-skeleton-rows', panel: 'gcsp-skeleton-panel', stats: 'gcsp-skeleton-stats', 'offer-header': 'gcsp-skeleton-offer-header', 'offer-card': 'gcsp-skeleton-offer-card' };
    expect(Array.from(shapes?.children ?? [], child => classTokens(child))).toEqual((expected as string[]).map(kind => classTokens(names[kind] ?? `gcsp-skeleton-shape gcsp-skeleton-${kind}`)));
    expect(root.querySelector('button, a, input, img')).toBeNull();
  });
  it('keeps the one status separate from nested offer artwork and honours a null or alert role', async () => {
    const { fixture, host, root } = await render();
    expect(root.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(root.querySelector('.gcsp-skeleton-offer-header > .gcsp-skeleton-text > .gcsp-skeleton-title')).not.toBeNull();
    expect(root.querySelector('.gcsp-skeleton-offer-card > .gcsp-skeleton-media')).not.toBeNull();
    expect(Array.from(root.querySelectorAll('.gcsp-skeleton-offer-card .gcsp-skeleton-text > *'), node => classTokens(node))).toEqual([
      'gcsp-skeleton-shape gcsp-skeleton-heading', 'gcsp-skeleton-shape gcsp-skeleton-line', 'gcsp-skeleton-shape gcsp-skeleton-line-short', 'gcsp-skeleton-shape gcsp-skeleton-clock', 'gcsp-skeleton-actions',
    ].map(classTokens));
    expect(root.querySelectorAll('.gcsp-skeleton-offer-card .gcsp-skeleton-actions > span')).toHaveLength(2);
    host.role.set(null); fixture.detectChanges(); expect(root.querySelector('p')?.hasAttribute('role')).toBe(false);
    host.role.set(''); fixture.detectChanges(); expect(root.querySelector('p')?.hasAttribute('role')).toBe(false);
    host.role.set('alert'); fixture.detectChanges(); expect(root.querySelector('p')?.getAttribute('role')).toBe('alert'); expect(root.hasAttribute('role')).toBe(false);
  });
  it('uses the source default grid/stat/bar counts and keeps explicit zero', async () => {
    const { fixture, host, root } = await render('release-grid');
    expect(root.querySelectorAll('.gcsp-release-tile')).toHaveLength(100);
    host.items.set(0); fixture.detectChanges(); expect(root.querySelectorAll('.gcsp-release-tile')).toHaveLength(0);
    host.items.set(undefined); host.layout.set('stats'); fixture.detectChanges(); expect(root.querySelectorAll('.gcsp-skeleton-stat-value')).toHaveLength(5);
    host.layout.set('bars'); fixture.detectChanges(); expect(root.querySelectorAll('.gcsp-count-bars-row')).toHaveLength(3);
    host.items.set(5); fixture.detectChanges(); expect(Array.from(root.querySelectorAll<HTMLElement>('.gcsp-skeleton-bar'), bar => bar.style.width)).toEqual(['100%', '80%', '60%', '40%', '100%']);
  });
  it('keeps supplied stat labels/counts without mutation and falls back to page for unknown layouts', async () => {
    const { fixture, host, root } = await render('stats'); const labels = Object.freeze(['Reserved', '', 'Released']); host.labels.set(labels); host.items.set(0); fixture.detectChanges();
    expect(Array.from(root.querySelectorAll('.vm-fact-label'), label => label.textContent)).toEqual(['Reserved', 'Released']);
    expect(root.querySelectorAll('.gcsp-skeleton-stat-value')).toHaveLength(3); expect(host.labels()).toBe(labels);
    host.labels.set([]); fixture.detectChanges(); expect(root.querySelectorAll('.gcsp-skeleton-stat-value')).toHaveLength(0);
    host.layout.set('unknown-layout'); fixture.detectChanges(); expect(root.getAttribute('data-layout')).toBe('page');
    expect(root.querySelectorAll('.gcsp-skeleton-rows > span')).toHaveLength(3);
  });
  it('omits the media well only for the timeline text card and preserves feature hierarchy', async () => {
    const { fixture, host, root } = await render('timeline'); expect(root.querySelector('.gcsp-skeleton-card > .gcsp-skeleton-media')).toBeNull();
    expect(root.querySelectorAll('.gcsp-skeleton-card > .gcsp-skeleton-text > span')).toHaveLength(5);
    host.layout.set('feature'); fixture.detectChanges(); expect(root.querySelector('.gcsp-skeleton-card.gcsp-skeleton-feature > .gcsp-skeleton-media')).not.toBeNull();
    expect(root.querySelectorAll('.gcsp-skeleton-panel > span')).toHaveLength(4);
  });
});
