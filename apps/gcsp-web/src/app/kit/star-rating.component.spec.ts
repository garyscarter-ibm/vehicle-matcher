import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StarRatingComponent } from './star-rating.component';

describe('source star rating', () => {
  let fixture: ComponentFixture<StarRatingComponent>;
  afterEach(() => fixture?.destroy());
  const mount = async (inputs: Record<string, unknown> = {}) => {
    fixture = TestBed.createComponent(StarRatingComponent);
    for (const [key, value] of Object.entries({ id: 'rating', value: 4, help: 'How highly do you rate your BMW?', ...inputs })) fixture.componentRef.setInput(key, value);
    await fixture.whenStable(); document.body.append(fixture.nativeElement);
    return fixture.nativeElement as HTMLElement;
  };
  it('ports source names, words, photo pill and reselect-to-clear', async () => {
    const root = await mount({ overlay: true, pill: true }); const rated = vi.fn(); fixture.componentInstance.rated.subscribe(rated);
    expect(root.querySelector('fieldset')?.className).toBe('gcsp-star-rating gcsp-star-rating-overlay gcsp-star-rating-pill');
    const radios = root.querySelectorAll<HTMLInputElement>('input');
    expect(radios[3].getAttribute('aria-label')).toBe('4 stars: I really like it');
    expect(root.querySelectorAll('.is-filled')).toHaveLength(4);
    radios[3].click(); expect(rated).toHaveBeenLastCalledWith(null);
    radios[4].click(); expect(rated).toHaveBeenLastCalledWith(5);
  });
  it('selects with arrows/Home/End and activates Space only once despite a synthetic click', async () => {
    const root = await mount(); const rated = vi.fn(); fixture.componentInstance.rated.subscribe(rated);
    const radios = root.querySelectorAll<HTMLInputElement>('input');
    radios[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); expect(rated).toHaveBeenLastCalledWith(5); expect(document.activeElement).toBe(radios[4]);
    radios[4].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); expect(rated).toHaveBeenLastCalledWith(1);
    radios[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); expect(rated).toHaveBeenLastCalledWith(5);
    rated.mockClear(); radios[4].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); radios[4].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(rated).toHaveBeenCalledExactlyOnceWith(null);
  });
  it('announces save/clear/failure and keeps the source retry separate from disabled stars', async () => {
    const root = await mount({ retryable: true, status: 'pending', disabled: true });
    expect(root.querySelector('fieldset')?.getAttribute('aria-busy')).toBe('true');
    expect(root.querySelector<HTMLInputElement>('input')?.disabled).toBe(true);
    fixture.componentRef.setInput('status', 'saved'); await fixture.whenStable(); expect(root.querySelector('[role=status]')?.textContent).toContain('Rating saved: 4 of 5');
    fixture.componentRef.setInput('value', null); await fixture.whenStable(); expect(root.querySelector('[role=status]')?.textContent).toContain('Rating cleared');
    fixture.componentRef.setInput('status', 'failed'); await fixture.whenStable(); const retry = vi.fn(); fixture.componentInstance.retried.subscribe(retry);
    expect(root.textContent).toContain('Rating not saved'); root.querySelector<HTMLButtonElement>('button')!.click(); expect(retry).toHaveBeenCalledOnce();
    expect(root.querySelector('button')?.getAttribute('aria-label')).toBe('Try saving your rating again');
  });
});
