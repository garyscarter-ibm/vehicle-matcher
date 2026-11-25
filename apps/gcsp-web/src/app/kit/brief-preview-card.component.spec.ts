import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { BriefPreviewCardComponent, BriefPreviewCardView } from './brief-preview-card.component';
const view: BriefPreviewCardView = { id: 'exact-1', name: 'Supplied BMW', line: 'Scheme stock', photo: 'https://images.example/car.jpg', caption: 'Supplied caption', terms: '0 points a month · 1,300 points a month allowance', facts: [{ label: 'Boot', value: '500 litres' }, { label: 'Fuel', value: null }], gate: 'eligible', groups: [{ label: 'Why it suits you', entries: ['Estate, the body style you prefer.'] }], score: 92, scoreLabel: null };
const mount = async (value = view) => { const f = TestBed.createComponent(BriefPreviewCardComponent); f.componentRef.setInput('view', value); await f.whenStable(); return f; };
describe('frozen brief match cards and preview tiles', () => {
  it('renders source card structure and supplied content without actions or a fabricated score', async () => {
    const f = await mount(); const root: HTMLElement = f.nativeElement;
    const card = root.querySelector<HTMLElement>('article.vm-card.vm-card-explicit')!;
    expect(card.dataset['memberId']).toBe('exact-1'); expect(card.dataset['gate']).toBe('eligible'); expect(card.classList.contains('vm-card-compact')).toBe(false);
    expect(Array.from(card.children, n => n.className)).toEqual(['vm-card-media has-photo', 'vm-card-body']);
    expect(card.querySelector('.vm-card-name')?.textContent).toBe(view.name); expect(card.querySelector('.vm-score')?.hasAttribute('hidden')).toBe(true);
    expect(card.querySelector('.vm-card-terms')?.textContent).toContain('0 points a month'); expect(card.querySelector('.vm-facts')?.textContent).toContain('500 litres');
    expect(card.querySelector('.vm-facts')?.textContent).toContain('Not supplied'); expect(card.querySelector('.vm-card-decision .vm-why-label')?.textContent).toBe('Why it suits you');
    expect(card.querySelectorAll('button, a')).toHaveLength(0); expect(card.querySelector('.vm-card-actions')?.children).toHaveLength(0);
  });
  it('uses the compact preview shape and supplied percentage for a noneligible exact decision', async () => {
    const f = await mount({ ...view, gate: 'needs-confirmation', scoreLabel: undefined, groups: [{ label: 'Needs confirmation', entries: ['Check charging.'] }] }); const root: HTMLElement = f.nativeElement;
    expect(root.querySelector('.vm-card-compact')).not.toBeNull(); expect(root.querySelector('.vm-score')?.textContent).toBe('92%');
    expect(root.querySelector('.vm-card-gate')?.textContent).toBe('Needs confirmation'); expect(root.querySelector('.vm-reasons')?.textContent).toBe('Check charging.');
    f.componentRef.setInput('view', { ...view, scoreLabel: { text: 'Best match', title: 'Supplied comparison explanation' } }); await f.whenStable();
    expect(root.querySelector('.vm-score')?.textContent).toBe('Best match'); expect(root.querySelector('.vm-score')?.getAttribute('title')).toBe('Supplied comparison explanation');
  });
  it('drops a failed photo and caption, accepts a changed photo, and rejects unsafe media', async () => {
    const f = await mount(); const root: HTMLElement = f.nativeElement; const image = root.querySelector('img')!;
    expect(image.src).toBe(view.photo); expect(image.alt).toBe(view.name); expect(root.querySelector('.vm-media-caption')?.textContent).toBe(view.caption);
    image.dispatchEvent(new Event('error')); await f.whenStable(); expect(root.querySelector('img')).toBeNull(); expect(root.querySelector('.vm-media-caption')).toBeNull(); expect(root.querySelector('.vm-card-media')?.classList.contains('has-photo')).toBe(false);
    f.componentRef.setInput('view', { ...view, photo: '/next-car.jpg' }); await f.whenStable(); expect(root.querySelector('img')?.getAttribute('src')).toBe('/next-car.jpg');
    for (const photo of ['//outside.example/car.jpg', 'http://outside.example/car.jpg', 'javascript:alert(1)', 'data:image/png;base64,x']) { f.componentRef.setInput('view', { ...view, photo }); await f.whenStable(); expect(root.querySelector('img')).toBeNull(); }
  });
});
