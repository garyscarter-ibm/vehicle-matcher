import { ChangeDetectorRef, Component, ElementRef, OnDestroy, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ButtonDirective } from '../kit/button.directive';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { activityCopy, activityEvents, collapseAdjacentEvents, exclusionLines, formatActivityTime, offerStateLabel, respondBy, searchLines } from './activity.copy';
import { approvedActivityImages, isApprovedActivityImage } from './activity-image-registry';
import { ActivityStore } from './activity.store';

@Component({
  selector: 'gcsp-activity',
  imports: [NgTemplateOutlet, RouterLink, ButtonDirective, ScreenIntroComponent, StatusScreenComponent],
  providers: [ActivityStore],
  templateUrl: './activity.component.html',
  styleUrl: './activity.component.css',
})
export class ActivityComponent implements OnDestroy {
  readonly store = inject(ActivityStore);
  readonly view = this.store.view;
  readonly copy = activityCopy;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly localAnnouncement = signal('');
  private readonly acknowledgedExclusions = signal<string | null>(null);
  private readonly selectedImage = signal<{ readonly key: string; readonly index: number; readonly failed: boolean } | null>(null);

  readonly liveMessage = computed(() => this.localAnnouncement() || this.view().message);
  readonly projection = computed(() => this.view().projection);
  readonly permission = computed(() => this.projection()?.permission ?? null);
  readonly isEngaged = computed(() => this.permission()?.searchConsent === true
    && this.permission()?.holdConsent === true && this.permission()?.paused === false);
  readonly buddyLabel = computed(() => {
    const value = this.projection();
    if (!value) return 'Status unavailable';
    if (value.permission === null) return 'Not set up';
    if (value.currentOffer?.state === 'accepted') return 'Search finished';
    return this.isEngaged() ? 'Buddy engaged' : 'Buddy disengaged';
  });
  readonly exclusions = computed(() => {
    const value = this.projection();
    return value ? exclusionLines(value, !this.isEngaged()) : [];
  });
  readonly exclusionKey = computed(() => {
    const value = this.projection();
    return value && this.exclusions().length ? JSON.stringify([value.runId, value.lastSuccessfulCheck?.checkedAt, this.exclusions()]) : '';
  });
  readonly keepAcknowledged = computed(() => !!this.exclusionKey() && this.acknowledgedExclusions() === this.exclusionKey());
  readonly searchStatus = computed(() => {
    const value = this.projection();
    return value ? searchLines(value, !this.isEngaged()) : [];
  });
  readonly events = computed(() => collapseAdjacentEvents(activityEvents(this.projection()?.stateChanges ?? [])));
  readonly hasIncompleteEvents = computed(() => this.projection()?.stateChangesEvidence.status === 'incomplete');
  readonly showRefresh = computed(() => ['loading', 'ready', 'unavailable', 'denied', 'refused', 'restarted', 'conflict', 'recovery', 'auth-required']
    .includes(this.view().phase));
  readonly refreshDisabled = computed(() => this.view().pending || this.view().phase === 'loading');

  readonly currentOffer = computed(() => this.projection()?.currentOffer ?? null);
  readonly offerDisplay = computed(() => {
    const offer = this.currentOffer();
    const display = this.view().offerDisplay;
    return offer && display?.offerRef.offerId === offer.offerRef.offerId ? display : null;
  });
  readonly images = computed(() => approvedActivityImages(this.offerDisplay()?.images));
  readonly offerTitle = computed(() => {
    const title = this.offerDisplay()?.title;
    return typeof title === 'string' && title.trim() ? title.trim() : null;
  });
  readonly offerImageKey = computed(() => {
    const offer = this.currentOffer();
    return offer ? JSON.stringify([this.projection()?.runId, offer.offerRef.offerId, this.images().map((image) => image.src)]) : '';
  });
  readonly imageIndex = computed(() => this.imageState().index);
  readonly imageFailed = computed(() => this.imageState().failed);
  readonly currentImage = computed(() => this.images()[this.imageIndex()] ?? null);
  readonly imageCaption = computed(() => {
    const caption = this.currentImage()?.caption;
    return typeof caption === 'string' && caption.trim() ? caption : null;
  });
  readonly offerHeading = computed(() => this.currentOffer()?.state === 'active' ? 'Your buddy found a car' : 'Your offer');
  readonly offerStatus = computed(() => this.currentOffer() ? offerStateLabel(this.currentOffer()!.state) : '');
  readonly offerDeadline = computed(() => respondBy(this.currentOffer()));

  async refreshActivity(): Promise<void> {
    const focus = this.focusKey();
    this.localAnnouncement.set('');
    await this.store.refresh();
    this.restoreFocus(focus, this.store.view().retryAvailable ? 'retry-update' : 'activity-refresh');
  }

  async setBuddy(operation: 'engage' | 'disengage'): Promise<void> {
    const focus = this.focusKey();
    this.localAnnouncement.set('');
    await this.store.updateBuddy(operation);
    this.restoreFocus(focus, this.store.view().retryAvailable ? 'retry-update' : 'activity-refresh');
  }

  async toggleBuddy(): Promise<void> {
    const operation = this.view().controlOperation;
    if (operation) await this.setBuddy(operation);
  }

  async retryUpdate(): Promise<void> {
    const focus = this.focusKey();
    this.localAnnouncement.set('');
    await this.store.retryUpdate();
    this.restoreFocus(focus, this.store.view().retryAvailable ? 'retry-update' : 'activity-refresh');
  }

  async signIn(): Promise<void> { await this.store.signIn(); }
  async retrySignIn(): Promise<void> { await this.store.retryAuthentication(); }

  keepSearching(): void {
    const key = this.exclusionKey();
    if (!key) return;
    this.acknowledgedExclusions.set(key);
    this.localAnnouncement.set(activityCopy.keepNote);
    this.restoreFocus('review-preferences', 'review-preferences');
  }

  selectImage(index: number): void {
    if (index < 0 || index >= this.images().length) return;
    this.selectedImage.set({ key: this.offerImageKey(), index, failed: false });
  }

  imageError(): void {
    const image = this.currentImage();
    if (!image || !isApprovedActivityImage(image)) return;
    this.selectedImage.set({ key: this.offerImageKey(), index: this.imageIndex(), failed: true });
  }

  isValidTime(value: string): boolean { return Number.isFinite(Date.parse(value)); }
  formatTime(value: string): string { return formatActivityTime(value); }

  ngOnDestroy(): void { this.store.dispose(); }

  private imageState(): { readonly key: string; readonly index: number; readonly failed: boolean } {
    const key = this.offerImageKey();
    const saved = this.selectedImage();
    return saved?.key === key ? saved : { key, index: 0, failed: false };
  }

  private focusKey(): string | null {
    const active = this.host.nativeElement.ownerDocument.activeElement;
    return active instanceof HTMLElement && active.dataset['focusKey'] ? active.dataset['focusKey'] : null;
  }

  private restoreFocus(key: string | null, fallback: string): void {
    if (!key && !fallback) return;
    this.changeDetector.detectChanges();
    const elements = this.host.nativeElement.querySelectorAll<HTMLElement>('[data-focus-key]');
    const target = Array.from(elements).find((element) => element.dataset['focusKey'] === key)
      ?? Array.from(elements).find((element) => element.dataset['focusKey'] === fallback);
    target?.focus();
  }
}
