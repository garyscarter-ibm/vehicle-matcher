import { Component, computed, input, output } from '@angular/core';
import { ActivityProjection, ActivityResult } from '../activity/activity.types';
import { ButtonDirective } from './button.directive';
export type BuddyState = 'active' | 'inactive' | 'paused' | 'unset' | 'finished' | 'unavailable';
export const buddyEngaged = (permission: ActivityProjection['permission'] | undefined): boolean => permission?.searchConsent === true && permission.holdConsent === true && permission.paused === false;
export function buddyState(result: ActivityResult<ActivityProjection> | null | undefined): BuddyState {
  const value = result?.status === 'ok' ? result.value : null;
  if (!value || !Object.hasOwn(value, 'permission')) return 'unavailable';
  if (value.permission === null) return 'unset';
  if (['searchConsent', 'holdConsent', 'paused', 'canSearch'].some((key) => typeof value.permission?.[key as keyof typeof value.permission] !== 'boolean')) return 'unavailable';
  if (value.currentOffer?.state === 'accepted') return 'finished';
  return buddyEngaged(value.permission) ? 'active' : 'inactive';
}
const labels: Readonly<Record<string, string>> = { engaged: 'Buddy engaged', disengaged: 'Buddy disengaged', unknown: 'Buddy status unavailable', active: 'Buddy engaged', paused: 'Buddy disengaged', unset: 'Not set up', finished: 'Search finished', inactive: 'Buddy disengaged', unavailable: 'Status unavailable' };
let sequence = 0;
@Component({ selector: 'gcsp-buddy-status', imports: [ButtonDirective], template: `
  @if (prominent()) { <p class="gcsp-buddy-status is-prominent" [class]="'gcsp-buddy-status is-prominent is-' + prominentState()" [id]="id()" [attr.data-state]="prominentState()"><span class="gcsp-buddy-lamp" aria-hidden="true"></span><span class="gcsp-buddy-status-text">{{ prominentLabel() }}</span></p> }
  @else if (href()) { <a gcspButton class="vm-btn vm-btn-ghost gcsp-buddy-link" variant="ghost" [href]="href()" data-focus-key="buddy-status" (click)="activated.emit($event)">
    @if (!text().startsWith('Buddy ')) { <span class="gcsp-buddy-name">Buddy</span> }
    @if (key() === 'unset') { <span class="gcsp-buddy-setup">Set up your buddy</span> }
    @else { <span [class]="'gcsp-buddy-status is-' + key()"><span class="gcsp-buddy-dot" aria-hidden="true"></span>{{ text() }}</span> }
    <span class="gcsp-buddy-chevron" aria-hidden="true">›</span></a> }
  @else { <span [class]="'gcsp-buddy-status is-' + key()"><span class="gcsp-buddy-dot" aria-hidden="true"></span>{{ label() || text() }}</span> }
` })
export class BuddyStatusComponent {
  readonly state = input('unavailable'); readonly href = input<string | null>(null); readonly prominent = input(false); readonly id = input(`gcsp-buddy-status-${++sequence}`); readonly label = input<string | null>(null);
  readonly activated = output<MouseEvent>(); readonly key = computed(() => Object.hasOwn(labels, this.state()) ? this.state() : 'unavailable');
  readonly text = computed(() => labels[this.key()]); readonly prominentState = computed(() => ['engaged', 'disengaged', 'unknown'].includes(this.state()) ? this.state() : 'unknown'); readonly prominentLabel = computed(() => labels[this.prominentState()]);
}
