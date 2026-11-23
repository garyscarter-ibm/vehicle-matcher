import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { BuddyStatusComponent, buddyState } from './buddy-status.component';
import { ActivityProjection, ActivityResult } from '../activity/activity.types';
const result = (permission: ActivityProjection['permission'], state = ''): ActivityResult<ActivityProjection> => ({ status: 'ok', value: { permission, currentOffer: state ? { state } : null } as ActivityProjection });
const permission = { searchConsent: true, holdConsent: true, paused: false, canSearch: true, canHold: true, permissionVersion: 1 };
describe('source buddy status', () => {
  it('keeps source permission/accepted/unset/unavailable mappings', () => {
    expect(buddyState(result(permission))).toBe('active'); expect(buddyState(result({ ...permission, paused: true }))).toBe('inactive');
    expect(buddyState(result(permission, 'accepted'))).toBe('finished'); expect(buddyState(result(null))).toBe('unset'); expect(buddyState({ status: 'unavailable' })).toBe('unavailable');
    expect(buddyState(result({ ...permission, canSearch: undefined } as unknown as typeof permission))).toBe('unavailable');
  });
  it('ports simple/link and prominent source variants without introducing a live region', async () => {
    const fixture = TestBed.createComponent(BuddyStatusComponent); fixture.componentRef.setInput('state', 'unset'); fixture.componentRef.setInput('href', '/gcsp/preferences'); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('a.gcsp-buddy-link.vm-btn-ghost')?.textContent).toContain('Set up your buddy');
    fixture.componentRef.setInput('prominent', true); fixture.componentRef.setInput('state', 'engaged'); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.is-prominent.is-engaged .gcsp-buddy-lamp')).not.toBeNull(); expect(fixture.nativeElement.querySelector('[role=status]')).toBeNull(); fixture.destroy();
  });
});
