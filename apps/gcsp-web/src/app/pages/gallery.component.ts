import { MediaWellComponent } from '../kit/media-well.component';
import { Component, signal } from '@angular/core';
import { PreferenceCategoryComponent } from '../kit/preference-category.component';
import { StarRatingComponent } from '../kit/star-rating.component';
import { ButtonDirective } from '../kit/button.directive';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { LoadingSkeletonComponent } from '../kit/loading-skeleton.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { ErrorSummaryComponent } from '../kit/error-summary.component';
import { BuddyControlsComponent } from '../preferences/buddy-controls.component';
import { DataTableComponent } from '../kit/data-table.component';
import { VehicleCardComponent } from '../kit/vehicle-card.component';
import { FactListComponent } from '../kit/fact-list.component';
import { StageListComponent } from '../kit/stage-list.component';
import { StageTrackerComponent } from '../kit/stage-tracker.component';
import { orderIdentityRows } from '../kit/order-identity';
import { FinishLabelComponent } from '../kit/finish-label.component';
import { DecisionHighlightsComponent } from '../kit/decision-highlights.component';
import { VehicleDecisionComponent } from '../kit/vehicle-decision.component';
import { TabsComponent } from '../kit/tabs.component';
import { SideDrawerComponent } from '../kit/side-drawer.component';
import { VehicleDetailsComponent } from '../kit/vehicle-details.component';
import { MediaGalleryComponent, MediaGalleryImage } from '../kit/media-gallery.component';
import { CheckboxFieldComponent } from '../kit/checkbox-field.component';
import { OptionListComponent } from '../kit/option-list.component';
import { TaskGroup, TaskListComponent } from '../kit/task-list.component';
import { SlotPickerComponent, SlotPickerSlot } from '../kit/slot-picker.component';
import { formatActivityTime } from '../activity/activity.copy';
@Component({ selector: 'gcsp-gallery', imports: [MediaWellComponent, PreferenceCategoryComponent, StarRatingComponent, ButtonDirective, ScreenIntroComponent, StatusScreenComponent, LoadingSkeletonComponent, LabelledFieldComponent, ErrorSummaryComponent, BuddyControlsComponent, DataTableComponent, VehicleCardComponent, FactListComponent, StageListComponent, StageTrackerComponent, FinishLabelComponent, DecisionHighlightsComponent, VehicleDecisionComponent, TabsComponent, SideDrawerComponent, VehicleDetailsComponent, MediaGalleryComponent, CheckboxFieldComponent, OptionListComponent, TaskListComponent, SlotPickerComponent], styleUrl: './gallery.component.css', template: `
  <gcsp-screen-intro title="Angular components" lede="Shared portal components and states." />
  <section class="gcsp-panel"><h2>Actions and fields</h2><div class="gcsp-actions"><button gcspButton type="button">Continue</button><button gcspButton variant="ghost" type="button">Back</button><button gcspButton type="button" disabled>Unavailable</button></div>
  <gcsp-error-summary [errors]="[{ controlId: 'gallery-email', message: 'Enter an email address.' }]" />
  <gcsp-labelled-field controlId="gallery-email" label="Email address" hint="Your notification address." error="Enter an email address."><input id="gallery-email" type="email" aria-describedby="gallery-email-hint gallery-email-error" aria-invalid="true" /></gcsp-labelled-field></section>
  <section class="gcsp-panel"><h2>Source checkboxes and switches</h2>
    <div gcspCheckboxField controlId="gallery-driver-confirmed" label="The nominated driver and licence details are correct." [checked]="declarationChecked()" (checkedChange)="declarationChecked.set($event)"></div>
    <div gcspCheckboxField controlId="gallery-importance" label="This is really important" [switch]="true" [checked]="importantChecked()" (checkedChange)="importantChecked.set($event)"></div>
    <div gcspCheckboxField controlId="gallery-disabled-declaration" label="Declaration unavailable" [disabled]="true" describedBy="gallery-declaration-disabled-reason"></div>
    <p class="gcsp-note" id="gallery-declaration-disabled-reason">This example is disabled until the record is supplied.</p>
    <p role="status">Example choices only. No changes have been saved.</p>
  </section>
  <section class="gcsp-panel"><h2>Source radio rows</h2>
    <gcsp-option-list groupId="gallery-decline-reason" label="Example reason for declining" variant="rows" [required]="true" [invalid]="!selectedReason()" [options]="exampleReasons" [value]="selectedReason()" (valueChange)="selectedReason.set($event)" />
    <p role="status">Example choice only. Nothing has been submitted.</p>
    <gcsp-option-list groupId="gallery-decline-reason-disabled" label="Example unavailable reasons" variant="rows" [required]="true" [invalid]="false" [options]="exampleReasons" [value]="selectedReason()" [disabled]="true" />
  </section>
  <section class="gcsp-panel"><h2>Source validation summary</h2>
    <gcsp-error-summary #sourceSummary presentation="source" summaryId="gallery-source-summary" title="Check before continuing" [errors]="[{ controlId: 'gallery-summary-email', message: 'Enter an email address.' }]" />
    <gcsp-labelled-field controlId="gallery-summary-email" label="Example email address" error="Enter an email address."><input id="gallery-summary-email" type="email" aria-invalid="true" aria-describedby="gallery-summary-email-error" /></gcsp-labelled-field>
    <button gcspButton type="button" variant="ghost" (click)="sourceSummary.focus()">Focus example errors</button>
    <gcsp-error-summary presentation="source" summaryId="gallery-source-empty" [errors]="[]" />
    <p class="gcsp-note">Example validation only. No form is submitted.</p>
  </section>
  <gcsp-status-screen title="Loading your account" message="Please wait." [busy]="true" [level]="2" />
  <gcsp-status-screen title="Account unavailable" message="Please try again." [level]="2"><button gcspButton type="button">Try again</button></gcsp-status-screen>
  <gcsp-status-screen title="Access not available" message="Your account does not have access to this page." [level]="2" />
  <section class="gcsp-panel"><h2>Preference categories and current-car rating</h2><p class="gcsp-note">Native choices, independent importance, removal confirmation and disabled states.</p>
    <gcsp-preference-category id="gallery-preference" [definition]="category" [state]="{ state: 'considered', value: ['estate'], importance: 'high', exact: true }" [open]="true" [removing]="removing()" (removeRequested)="removing.set(true)" (kept)="removing.set(false)" (removed)="removing.set(false)" />
    <gcsp-preference-category id="gallery-preference-disabled" [definition]="category" [disabled]="true" />
    <gcsp-star-rating id="gallery-stars" [value]="rating()" (rated)="rating.set($event)" />
    <gcsp-star-rating id="gallery-stars-disabled" label="Rating unavailable while saving" [value]="3" [disabled]="true" />
    <p role="status">Your changes are not confirmed as saved. Try again or reload.</p>
  </section>
  <section class="gcsp-panel"><h2>Buddy status and actions</h2><div class="buddy-gallery">
    <gcsp-buddy-controls [buddy]="engaged" disabledReason="Preview only. Actions are not connected." />
    <gcsp-buddy-controls [buddy]="paused" disabledReason="Preview only. Actions are not connected." />
  </div></section>
  <section class="gcsp-panel"><h2>Case queue table</h2>
    <gcsp-data-table caption="Example renewal cases" [columns]="tableColumns" [rows]="tableRows" (opened)="tableOpened.set('Opened example case for Paula')" />
    <p role="status">{{ tableOpened() }}</p>
    <gcsp-data-table caption="Unavailable case actions" [columns]="tableColumns" [rows]="tableRows" [disabled]="true" />
  </section>
  <section class="gcsp-panel"><h2>Source primary vehicle media</h2>
    <gcsp-media-well name="BMW Touring" line="Order no. 0123456" [image]="{ src: '/assets/brand-hero/bmw.jpg', alt: 'BMW Touring', caption: 'BMW' }" />
    <gcsp-media-well name="BMW Touring" line="Order number not supplied" />
  </section>
  <section class="gcsp-panel"><h2>Released vehicle card</h2>
    <gcsp-vehicle-card memberId="gallery-exact-stock" name="BMW 3 Series" line="Touring"
      orderNumber="0000001" [images]="[]" [points]="740" [allowance]="1000"
      eligibility="Needs confirmation" [reviewDisabled]="true"
      disabledReason="Reviewing a car is unavailable in this example."
      [facts]="[{ label: 'Exterior', value: 'Blue' }, { label: 'Interior', value: null }]"
      (action)="cardOpened.set('Vehicle details selected for the example car')" />
    <p role="status">{{ cardOpened() }}</p>
  </section>
  <section class="gcsp-panel"><h2>Selection and order stages</h2>
    <gcsp-stage-list heading="Your selection" [level]="3" [stages]="selectionStages" />
    <gcsp-fact-list [rows]="orderIdentity" presentation="source" />
    <gcsp-stage-list heading="Selection not sent" [level]="3" [stages]="[{ name: 'Sending to ordering', state: 'pending' }, { name: 'Ordering response', state: 'failed' }]" />
    <gcsp-stage-tracker heading="Order progress" [level]="3" [stages]="orderStages" />
    <gcsp-stage-tracker heading="Ordering not updated" [level]="3" [stages]="[{ label: 'Driver approval', state: 'declined', note: 'The driver record needs review.' }, { label: 'Ordering', state: 'blocked', owner: 'Scheme team', next: 'Check the ordering response' }]" />
  </section>
  <section class="gcsp-panel"><h2>Vehicle finishes and decision highlights</h2>
    <p class="gcsp-note">Source presenters with invented copy. Swatches are decorative colour families; unconfirmed colours stay neutral.</p>
    <div class="gcsp-finishes">
      <gcsp-finish-label label="Paint" value="Portimao Blue metallic" [labelled]="true" />
      <gcsp-finish-label label="Upholstery" value="Black with blue stitching Vernasca leather" [labelled]="true" />
      <gcsp-finish-label label="Upholstery" value="Coral red/black Veganza" [labelled]="true" />
      <gcsp-finish-label label="Paint" value="Alpine White" shade="unsupported" [labelled]="true" />
      <gcsp-finish-label label="Paint" />
    </div>
    <gcsp-decision-highlights [benefits]="decisionBenefits" [tradeoffs]="decisionTradeoffs" />
    <gcsp-decision-highlights [benefits]="decisionBenefits" [tradeoffs]="decisionTradeoffs" layout="list" />
    <gcsp-decision-highlights layout="list" />
  </section>
  <section class="gcsp-panel"><h2>Focused decision layout shell</h2>
    <p class="gcsp-note">The source summary, media and reading-order slots. Complete car details and live offer integration are pending.</p>
    <gcsp-vehicle-decision name="BMW iX1" kicker="Your buddy found a car for you" layout="focused"
      [finishes]="decisionFinishes" [points]="1100" [allowance]="1300" pointsDifference="300 fewer than your current car">
      <div decisionDeadline class="gcsp-decision-deadline"><div><strong>Held until 14:30</strong><p class="gcsp-decision-date">Sunday 22 November 2026</p></div><div class="gcsp-decision-clock"><p class="gcsp-countdown">1h 20m</p><p class="gcsp-decision-date">Static gallery example</p></div></div>
      <div decisionActions class="gcsp-offer-actions"><button gcspButton type="button" disabled>Review &amp; accept</button><button gcspButton type="button" variant="ghost" disabled>Decline offer</button></div>
      <p decisionNote class="gcsp-note">Gallery actions are not connected.</p>
      <gcsp-media-gallery decisionMedia name="BMW iX1" [images]="mediaImages" presentation="picker" fit="contain" />
      <div decisionDetails><p class="gcsp-note">Complete supplied facts, decision and equipment slot</p></div>
    </gcsp-vehicle-decision>
  </section>
  <section class="gcsp-panel" id="gallery-drawer"><h2>Source side drawer</h2>
    <p class="gcsp-note">One modal record with source backdrop, trapped keyboard focus and restored page state. Preview actions are not connected.</p>
    <button #drawerOpener gcspButton type="button" variant="ghost" (click)="recordDrawer.open(drawerOpener)">View example record</button>
    <button #lockedOpener gcspButton type="button" variant="ghost" (click)="lockedDrawer.open(lockedOpener)">Preview a pending command</button>
    <p role="status">{{ drawerClosed() }}</p>
    <gcsp-side-drawer #recordDrawer title="Example car record" context="Your offer" (closed)="drawerClosed.set('Example record closed')">
      <h3>All supplied details stay in the scrolling body</h3><p>This example uses the shared source modal, not an offer command.</p>
      <details><summary>Example scheme terms</summary><p>Expanded details are reachable while collapsed content stays out of the focus cycle.</p></details>
      <button drawer-footer gcspButton type="button" variant="ghost" (click)="recordDrawer.close()">Back to components</button>
    </gcsp-side-drawer>
    <gcsp-side-drawer #lockedDrawer title="Pending command preview" [dismissible]="false">
      <p>Close, Escape and backdrop dismissal are disabled. The caller may still close after terminal readback.</p>
      <button drawer-footer gcspButton type="button" variant="ghost" (click)="lockedDrawer.close()">Finish preview</button>
    </gcsp-side-drawer>
  </section>
  <section class="gcsp-panel"><h2>Source car details</h2>
    <p class="gcsp-note">Long supplied finishes, complete equipment and a supplied decision share the canonical details drawer. The second example has no supplied equipment.</p>
    <ng-template #detailsDecision><p class="gcsp-note">Supplied decision detail: 300 fewer points each month compared with the current car.</p></ng-template>
    <gcsp-vehicle-details name="BMW X2 M35i in Black Sapphire with a long supplied upholstery and model description"
      [finishes]="detailsFinishes" [facts]="detailsFacts" [equipment]="detailsEquipment" [additionalDetails]="detailsDecision" />
    <gcsp-vehicle-details name="Car with equipment not supplied" [finishes]="[{ label: 'Paint', value: null }, { label: 'Upholstery', value: '' }]" [facts]="[{ label: 'Build month', value: null }]" />
    <h3>Exact-card source facts</h3>
    <gcsp-vehicle-details name="Car with bounded source specification" factsPresentation="source-card"
      [finishes]="[{ label: 'Paint', value: 'Alpine White' }]"
      [facts]="[{ label: 'Boot', value: 410, unit: 'litres' }, { label: 'Recorded count', value: 0 }, { label: 'Recorded option', value: false }, { label: 'Unknown fact', value: null }]" />
  </section>
  <section class="gcsp-panel"><h2>Source headings and status</h2>
    <div gcspScreenIntro presentation="source" title="Your offer" kicker="Your selection" lede="Review the car and your next step."></div>
    <div gcspStatusScreen presentation="source" title="No car selected yet" message="Choose a car to see its details here." [announcement]="null"><a href="#top">Back to components</a></div>
  </section>
  <section class="gcsp-panel"><h2>Source loading skeletons</h2>
    <p class="gcsp-note">Decorative placeholders from the shared kit, shown as examples.</p>
    @for (layout of skeletonLayouts; track layout) {
      <h3>{{ layout }}</h3><div gcspLoadingSkeleton [layout]="layout" label="Loading example" [items]="6" [labels]="['Reserved', '', 'Available']" [role]="null"></div>
    }
  </section>
  <section class="gcsp-panel"><h2>Source vehicle images</h2>
    <p class="gcsp-note">Approved supplied views share feature, thumbnails and the enlarged viewer. The focused decision above uses the picker and contain variants.</p>
    <gcsp-media-gallery name="Example BMW" [images]="mediaImages" />
    <h3>Compact stock image</h3><gcsp-media-gallery name="Example BMW" [images]="mediaImages" [compact]="true" />
    <h3>No supplied image</h3><gcsp-media-gallery name="Example car without an image" />
  </section>
  <section class="gcsp-panel"><h2>Source facts and tabs</h2>
    <p class="gcsp-note">Canonical source classes with supplied facts. Default fact-list consumers keep their existing presentation.</p>
    <gcsp-fact-list presentation="source" className="vm-facts-pair gcsp-vehicle-overview" [rows]="sourceOverview" />
    <gcsp-fact-list presentation="source" className="vm-facts-pair" [rows]="[{label: 'Paint', value: 'Portimao Blue metallic'}, {label: 'Unconfirmed fact', value: null}]" hideMissing="More details not supplied" />
    <gcsp-fact-list presentation="source" [rows]="[{label: 'Unconfirmed fact', value: null}]" hideMissing="More details not supplied" />
    <ng-template #sourceFactPanel><gcsp-fact-list presentation="source" [rows]="sourceOverview" /></ng-template>
    <ng-template #sourceEquipmentPanel><p class="gcsp-note">All supplied selected equipment stays in this panel.</p></ng-template>
    <gcsp-tabs label="Source vehicle details" [items]="[{ id: 'specification', label: 'Specification', content: sourceFactPanel }, { id: 'equipment', label: 'Selected equipment', content: sourceEquipmentPanel }]" />
  </section>
  <section class="gcsp-panel"><h2>Owned tasks and other owners</h2>
    <section gcspTaskList heading="Your tasks" [level]="3" [rows]="true" [groups]="yourTasks"></section>
    <section gcspTaskList heading="Being handled by others" [level]="3" [groups]="otherTasks"></section>
    <p role="status">{{ taskSelected() }}</p>
  </section>
  <section class="gcsp-panel"><h2>Offered appointment times</h2>
    <h3>Choose an example time</h3>
    <ul gcspSlotPicker [slots]="offeredTimes" actionLabel="Request handover" [onPick]="pickTime"></ul>
    <p role="status">{{ timeSelected() }}</p>
    <h3>Read-only offered times</h3>
    <ul gcspSlotPicker [slots]="offeredTimes"></ul>
    <h3>Source action styles</h3>
    <div class="gcsp-actions"><button gcspButton presentation="source" type="button" disabled>Example primary action</button><button gcspButton presentation="source" variant="ghost" type="button" disabled>Example secondary action</button></div>
  </section>
` })
export class GalleryComponent {
  readonly skeletonLayouts = ['page', 'form', 'timeline', 'card', 'feature', 'console', 'section', 'release-grid', 'stats', 'bars', 'offer', 'media'];
  readonly selectedReason = signal('gallery-size');
  readonly exampleReasons = [
    { value: 'gallery-size', label: 'The car is too large' },
    { value: 'gallery-timing', label: 'The timing does not work' },
    { value: 'gallery-unavailable', label: 'Another example reason', sub: 'Unavailable in this example', disabled: true },
  ];
  readonly declarationChecked = signal(false);
  readonly importantChecked = signal(true);
  readonly mediaImages: readonly MediaGalleryImage[] = [
    { src: '/assets/gcsp-vehicle-evidence/000cfa6bd4d71e51611f32283003aacf383c9c9d12f1a29f25b600a98d496490.webp', label: 'Front view', alt: 'Example BMW, front view' },
    { src: '/assets/gcsp-vehicle-evidence/01af2978ba13fd99e11d6477eb706e0648f67d5602bc72e8e20217908b235748.webp', label: 'Second view', alt: 'Example BMW, second view' },
  ];
  readonly detailsFinishes = [{ label: 'Paint', value: 'Black Sapphire' }, { label: 'Upholstery', value: 'M Alcantara Veganza combination Black contrast stitching with extended long text' }];
  readonly detailsFacts = [{ label: 'Body style', value: 'SUV' }, { label: 'Fuel', value: 'Petrol' }, { label: 'Build month', value: null }];
  readonly detailsEquipment = Array.from({ length: 57 }, (_, index) => `Selected equipment item ${index + 1} with retained source wording`);
  readonly drawerClosed = signal('');
  readonly sourceOverview = [{ label: 'Body style', value: 'SUV' }, { label: 'Boot', value: 490, unit: 'litres' },
    { label: 'Extra payment', value: 0 }, { label: 'Unconfirmed fact', value: null }];
  readonly decisionFinishes = [{ label: 'Paint', value: 'Portimao Blue metallic' }, { label: 'Upholstery', value: 'Black with blue stitching Vernasca leather' }];
  readonly decisionBenefits = [
    { number: 300, title: 'fewer points', detail: 'Every month, compared with your current car' },
    { number: 0, title: 'extra payment', detail: 'A supplied zero stays visible' },
    { title: 'A third supplied benefit' }, { title: 'A fourth supplied benefit' }, { title: 'A fifth supplied benefit' },
  ];
  readonly decisionTradeoffs = [{ number: 30, title: 'litres less', detail: 'Boot space compared with your current car' }];
  readonly orderIdentity = orderIdentityRows('GCSP-000123', '0123456');
  readonly selectionStages = [{ name: 'selection received', state: 'complete' }, { name: 'HR approval', state: 'waiting' }, { name: 'sent to ordering', state: 'not-started' }];
  readonly orderStages = [
    { label: 'Selection received', state: 'done', at: '2026-11-22T12:30:00.000Z' },
    { label: 'HR approval', state: 'current', owner: 'HR team', next: 'Review the request' },
    { label: 'Sent to ordering', state: 'upcoming' },
  ];
  readonly taskSelected = signal('Example tasks only. No changes have been saved.');
  readonly timeSelected = signal('Select an example time. No booking will be made.');
  readonly pickTime = (slot: SlotPickerSlot) => this.timeSelected.set(`Example time selected: ${formatActivityTime(slot.start ?? '')}. No booking has been made.`);
  readonly offeredTimes: readonly SlotPickerSlot[] = [
    { slotId: 'gallery-monday-morning', start: '2026-11-23T10:00:00Z' },
    { slotId: 'gallery-monday-afternoon', start: '2026-11-23T14:30:00Z' },
    { slotId: 'gallery-tuesday-morning', start: '2026-11-24T09:00:00Z' },
  ];
  readonly yourTasks: readonly TaskGroup[] = [{ items: [
    { id: 'gallery-acknowledge', label: 'Check your order details', owner: 'You', status: 'Ready', tone: 'todo', due: '2026-11-24T17:00:00Z', detail: 'Acknowledgement, not a signature.', action: { label: 'Acknowledge', onSelect: () => this.taskSelected.set('Example task selected. No acknowledgement has been saved.') } },
    { id: 'gallery-document', label: 'Read your handover documents', owner: 'You', status: 'Waiting', tone: 'todo', action: { label: 'Read documents', disabled: true, reason: 'The documents have not been supplied for this example.' } },
  ] }];
  readonly otherTasks: readonly TaskGroup[] = [{ heading: 'Scheme team', items: [
    { id: 'gallery-team', label: 'Prepare your handover', owner: 'Scheme team', status: 'In progress', tone: 'in-progress', due: '2026-11-25T12:00:00Z' },
  ] }];
  readonly cardOpened = signal('');
  readonly tableOpened = signal('');
  readonly tableColumns = [{ key: 'employee', label: 'Employee' }, { key: 'status', label: 'Status' }, { key: 'owner', label: 'Owner' }];
  readonly tableRows = [{ id: 'gallery-paula', label: 'Paula', cells: { employee: 'Paula', status: 'Open', owner: 'Scheme team' } }];
  readonly removing = signal(false); readonly rating = signal<number | null>(4);
  readonly category = { kind: 'multi' as const, label: 'Body style', question: 'What body styles?', options: [{ value: 'saloon', label: 'Saloon' }, { value: 'estate', label: 'Estate' }] };
  readonly engaged = { state: 'engaged' as const, reason: null, permissionVersion: 8, minimumCategories: 3, considered: 3, remaining: 0, sameAgain: false, canEngage: false };
  readonly paused = { state: 'disengaged' as const, reason: 'paused' as const, permissionVersion: 8, minimumCategories: 3, considered: 3, remaining: 0, sameAgain: false, canEngage: false };
}
