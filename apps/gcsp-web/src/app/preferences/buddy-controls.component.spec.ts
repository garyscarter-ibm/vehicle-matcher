import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { BuddyControlsComponent } from './buddy-controls.component';
import { BuddyView } from './brief.types';

const view = (state: BuddyView['state'], reason: BuddyView['reason'] = null, remaining = 0): BuddyView => ({
  state, reason, permissionVersion: 5, minimumCategories: 3, considered: 3 - remaining, remaining, sameAgain: false,
  canEngage: state === 'disengaged' && reason !== 'paused' && remaining === 0,
});

describe('native Buddy controls', () => {
  it('shows saved server status, pause consequences and only the valid native actions', async () => {
    const fixture = TestBed.createComponent(BuddyControlsComponent); fixture.componentRef.setInput('buddy', view('engaged')); await fixture.whenStable();
    let buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
    expect(fixture.nativeElement.textContent).toContain('Saved status: Engaged'); expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Pause search', 'Disengage Buddy', 'Reload Buddy status']);
    fixture.componentRef.setInput('buddy', view('disengaged', 'paused')); await fixture.whenStable(); buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
    expect(fixture.nativeElement.textContent).toContain('New searches and holds have stopped. Any held offer stays open until its deadline.');
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Resume search', 'Disengage Buddy', 'Reload Buddy status']);
  });
  it('shows the server remaining-category explanation and focuses status after an under-minimum attempt', async () => {
    const fixture = TestBed.createComponent(BuddyControlsComponent); fixture.componentRef.setInput('buddy', view('disengaged', null, 2)); await fixture.whenStable();
    const action = vi.fn(); fixture.componentInstance.action.subscribe(action);
    const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Engage Buddy')!;
    expect(fixture.nativeElement.textContent).toContain('Choose 2 more categories to engage Buddy.'); button.click(); await fixture.whenStable(); await Promise.resolve();
    expect(action).toHaveBeenCalledWith('engage'); expect(fixture.nativeElement.querySelector('[role=status]')).toBe(document.activeElement);
  });
  it('keeps pending operation identity visible and leaves reload available while actions are blocked', async () => {
    const fixture = TestBed.createComponent(BuddyControlsComponent); fixture.componentRef.setInput('buddy', view('disengaged'));
    fixture.componentRef.setInput('failure', { status: 'pending', operationId: 'operation-9' }); fixture.componentRef.setInput('operationId', 'operation-9');
    fixture.componentRef.setInput('disabledReason', 'Reload saved Buddy status before changing it again.'); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role=status]').textContent).toContain('Request operation-9 is still pending.');
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
    expect(buttons[0].disabled).toBe(true); expect(buttons.at(-1)?.disabled).toBe(false);
  });
  it('gives repeated gallery instances distinct accessible headings', async () => {
    const first = TestBed.createComponent(BuddyControlsComponent); const second = TestBed.createComponent(BuddyControlsComponent);
    await Promise.all([first.whenStable(), second.whenStable()]);
    const region = (fixture: typeof first) => fixture.nativeElement.querySelector('section') as HTMLElement;
    const firstRegion = region(first); const secondRegion = region(second);
    expect(firstRegion.getAttribute('aria-labelledby')).toBe(firstRegion.querySelector('h3')?.id);
    expect(secondRegion.getAttribute('aria-labelledby')).toBe(secondRegion.querySelector('h3')?.id);
    expect(firstRegion.querySelector('h3')?.id).not.toBe(secondRegion.querySelector('h3')?.id);
  });
});
