import { el, screenIntro, button, statusScreen, factList, formatTerm } from '../../vehicle-matcher/ui.js';
import { matchCard, mediaWell } from '../../vehicle-matcher/modes/result-card.js';
import { mountEmployee } from '../employee/gcsp-employee.js';
import { labelledField } from '../kit/form-controls.js';
import { createManualGalleryController } from './gallery-controller.js';
import { createManualClaimController } from './claim-controller.js';
import { createManualGalleryHttpAdapter } from './http-adapter.js';

let sequence = 0;
const shown = (value) => value == null || value === '' ? 'Not supplied' : Array.isArray(value) ? value.map(shown).join('; ')
  : typeof value === 'object' ? Object.entries(value).map(([key, item]) => `${key.replaceAll(/([A-Z])/g, ' $1')}: ${shown(item)}`).join(' · ') : String(value);
const factRows = (rows) => rows.map((row) => ({ ...row, value: row.value == null ? null : shown(row.value) }));
const states = {
  idle: ['Released cars', ''], loading: ['Loading released cars', 'Checking availability.'],
  'empty-stock': ['No cars are available', 'Check again after the next release.'],
  'nothing-released-yet': ['No cars have been released yet', 'Check again after the first release.'],
  'empty-search': ['No cars match these filters', 'Clear your filters to see all released cars.'],
  'no-suitable-stock': ['No suitable cars are available', 'Review the eligibility reasons or return to your choices.'],
  'source-unavailable': ['Availability is unavailable', 'Retry to check current released cars.'],
  'context-refresh': ['Your choices need refreshing', 'Return to your choices or refresh availability.'],
  'car-taken': ['This car is no longer available', 'Refresh to see the current released cars.'],
};
const claimMessages = { checking: 'Checking your current reservation.', claiming: 'Reserving this exact car for review.',
  pending: 'Your reservation is still being checked. Check its status before choosing another car.',
  uncertain: 'The reservation status is unavailable. Check its status before choosing another car.',
  'readback-mismatch': 'The current reservation does not match this selection. Check its status before continuing.',
  'existing-claim': 'You already have a current reservation. Continue its review from your account.',
  confirmed: 'Your car is reserved for review.', failed: 'The car could not be reserved. Refresh availability before choosing again.' };
claimMessages['retry-available'] = 'No current reservation was found. Retry this same reservation or check its status.';
claimMessages.released = 'Your previous reservation has ended. Availability has been refreshed.';

export function mountManualGallery(root, { adapter = createManualGalleryHttpAdapter(), brand = 'bmw', onBack,
  onClaimConfirmed, onClaimState, commandId } = {}) {
  const prefix = `gcsp-gallery-${++sequence}`; const controls = {}; const cards = new Map();
  let nodes; let panel; let disposed = false; let started = false; let galleryState; let claimState; let detailId; let detailOrigin;
  const notify = (name, detail) => root.dispatchEvent(new root.ownerDocument.defaultView.CustomEvent(name, { detail, bubbles: true, composed: true }));
  const claim = createManualClaimController({ adapter, onChange(next) { claimState = next; onClaimState?.(next); draw(); },
    onConfirmed(detail) { if (!disposed) { onClaimConfirmed?.(detail); notify('gcsp:manual-claim-confirmed', detail); } },
    onFailure(outcome) { gallery.resetReviewAttempts(); gallery.reportOutcome(outcome); },
    onReleased() { gallery.resetReviewAttempts(); gallery.refresh(); } });
  const gallery = createManualGalleryController({ adapter, commandId, onChange(next) { galleryState = next; draw(); },
    onReview(selection) { if (!adapter.readOnly) claim.review(selection); } });
  galleryState = gallery.getState(); claimState = claim.getState();
  function field(name, label, options) {
    const control = el(options ? 'select' : 'input', ''); controls[name] = control; control.name = name;
    if (!options) control.type = 'search';
    else options.forEach(([value, caption]) => { const option = el('option', '', caption); option.value = value; control.append(option); });
    control.addEventListener(options ? 'change' : 'input', () => gallery.setControls({ [name]: control.value }));
    return labelledField({ id: `${prefix}-${name}`, label, control }).root;
  }
  function updateOptions(name, values, all) {
    const control = controls[name]; const selected = galleryState.controls[name] ?? ''; const signature = JSON.stringify([values, selected]);
    if (control.dataset.options === signature) return;
    control.replaceChildren();
    [['', all], ...values.map((value) => [value, value]), ...(selected && !values.includes(selected) ? [[selected, `${selected} (not currently available)`]] : [])]
      .forEach(([value, caption]) => { const option = el('option', '', caption); option.value = value; control.append(option); });
    control.value = selected; control.dataset.options = signature;
  }
  function choose(id) { if (!claimState.blocked && !adapter.readOnly) gallery.review(id); }
  function closeDetail() { gallery.closeDetail(); (detailOrigin?.isConnected ? detailOrigin : controls.query)?.focus(); }
  function detailSection(title, rows) {
    const section = el('details', 'gcsp-gallery-fact-section'); section.append(el('summary', '', title), factList(factRows(rows)));
    return section;
  }
  function renderDetail() {
    const car = galleryState.allCars.find((item) => item.id === galleryState.selectedId);
    nodes.detail.hidden = !car; nodes.results.hidden = Boolean(car);
    if (!car) { nodes.detail.replaceChildren(); detailId = null; return; }
    if (detailId === car.id) return;
    detailId = car.id; const { detail } = car;
    const heading = el('h2', 'gcsp-h2', car.view.members[0].display.name); heading.tabIndex = -1;
    const { media } = mediaWell(null, '', { view: car.view.members[0], placeholder: 'No image for this car yet' });
    const reason = el('p', 'gcsp-note', car.view.members[0].actions[0].disabledReason ?? 'Reviewing reserves this exact car while you check its details.');
    reason.id = `${prefix}-detail-review-reason`;
    const review = button({ label: 'Review this car', onClick: () => choose(car.id), disabled: car.view.members[0].actions[0].disabled, describedBy: reason.id });
    review.dataset.reviewId = car.id; review.dataset.baseDisabled = String(car.view.members[0].actions[0].disabled);
    const back = button({ label: 'Back to released cars', variant: 'ghost', onClick: closeDetail });
    const sections = [detailSection('Exact vehicle facts', detail.exactFacts), detailSection('Model reference facts', detail.referenceFacts),
      detailSection('Other supplied facts', detail.unclassifiedFacts)];
    for (const [title, source] of [['Configured equipment and options', detail.equipment], ['Specifications', detail.specifications], ['Vehicle history', detail.historic]]) {
      sections.push(detailSection(title, [{ label: title, value: source?.status === 'known' ? source.value : null },
        { label: 'Source and assurance', value: source?.provenance }]));
    }
    sections.push(detailSection('Images and source information', [{ label: 'Image disclaimer', value: detail.media.caption ?? 'No image supplied' },
      { label: 'Image source', value: detail.media.provenance }, { label: 'Snapshot source', value: detail.snapshot.sourceNamespace },
      { label: 'Snapshot observed', value: detail.snapshot.observedAt }, { label: 'Snapshot version', value: detail.snapshot.snapshotVersion }]));
    nodes.detail.replaceChildren(back, heading, el('p', 'gcsp-note', `Order no. ${car.identity.orderNumber}`), media, el('p', 'gcsp-gallery-allowance', formatTerm(car.cost)),
      factList(factRows([...Object.values(car.fields), ...car.emissions,
        { label: 'Monthly scheme cost', value: car.cost.value, unit: 'points a month' },
        { label: 'Available allowance', value: car.cost.allowance, unit: 'points a month' },
        { label: 'Scheme contribution', value: car.contribution?.amount, unit: car.contribution ? `${car.contribution.currency}/${car.contribution.period}` : null }])), review,
      reason, detailSection('Scheme terms and sources', [{ label: 'Supplied scheme terms', value: detail.terms }]), ...sections);
    heading.focus();
  }
  function draw() {
    if (!nodes || disposed) return;
    for (const key of ['query', 'sort']) { const value = galleryState.controls[key] ?? (key === 'sort' ? 'name' : ''); if (controls[key].value !== value) controls[key].value = value; }
    updateOptions('series', galleryState.series, 'All series'); updateOptions('body', galleryState.bodies, 'All body styles');
    const c = galleryState.counts;
    nodes.counts.textContent = `${c.records} released cars · ${c.eligible} eligible · ${c.visible} shown · ${c.visibleEligible} eligible shown`;
    const allowances = [...new Set(galleryState.allCars.map((car) => car.cost.allowance).filter((value) => value != null))];
    nodes.allowance.textContent = allowances.length === 1 ? `Your allowance: ${allowances[0].toLocaleString('en-GB')} points a month` : 'Your allowance: see the terms for each car';
    const message = states[galleryState.state];
    nodes.status.replaceChildren();
    if (message && galleryState.state !== 'idle') {
      const actions = galleryState.state === 'loading' ? [] : galleryState.state === 'empty-search'
        ? [button({ label: 'Clear filters', variant: 'ghost', onClick() { for (const key of ['query', 'series', 'body']) controls[key].value = ''; gallery.setControls({ query: '', series: '', body: '' }); } })]
        : [button({ label: 'Refresh availability', variant: 'ghost', onClick: () => gallery.refresh() })];
      nodes.status.append(statusScreen({ title: message[0], message: message[1], actions }));
    }
    const desired = [];
    for (const car of galleryState.cars) {
      const signature = JSON.stringify(car.view); let cached = cards.get(car.id);
      if (!cached || cached.signature !== signature) {
        const view = structuredClone(car.view); view.members[0].facts = factRows(view.members[0].facts);
        if (adapter.readOnly) view.members[0].actions[0] = { ...view.members[0].actions[0], disabled: true, disabledReason: 'Read-only gallery example.' };
        const card = matchCard(null, { view, showScore: false, onAction: () => choose(car.id) });
        card.querySelector('.vm-card-head').after(el('p', 'gcsp-note', `Order no. ${car.identity.orderNumber}`));
        card.querySelectorAll('[data-action-id="review-car"]').forEach((control) => { control.dataset.reviewId = car.id; control.dataset.baseDisabled = String(control.disabled); });
        const details = button({ label: 'Vehicle details', variant: 'ghost', onClick() { detailOrigin = details; gallery.openDetail(car.id); } });
        card.querySelector('.vm-card-actions').append(details); cached = { signature, card }; cards.set(car.id, cached);
      }
      desired.push(cached.card);
    }
    for (const child of [...nodes.grid.children]) if (!desired.includes(child)) child.remove();
    desired.forEach((card, index) => { if (nodes.grid.children[index] !== card) nodes.grid.insertBefore(card, nodes.grid.children[index] ?? null); });
    renderDetail();
    panel.querySelectorAll('[data-review-id]').forEach((control) => { control.disabled = adapter.readOnly || claimState.blocked || control.dataset.baseDisabled === 'true'; });
    nodes.claimMessage.textContent = claimMessages[claimState.state] ?? '';
    nodes.check.hidden = !claimState.blocked || ['claiming', 'checking'].includes(claimState.state);
    nodes.check.disabled = ['claiming', 'checking'].includes(claimState.state);
    nodes.retry.hidden = claimState.state !== 'retry-available';
  }
  const shell = mountEmployee(root, { brand, loadAccount: adapter.loadAccount?.bind(adapter), renderBody(main) {
    panel = el('section', 'vm gcsp-gallery-body'); cards.clear(); detailId = null;
    const filters = el('div', 'gcsp-gallery-filters'); filters.setAttribute('role', 'search'); filters.setAttribute('aria-label', 'Filter released cars');
    filters.append(field('query', 'Search cars and equipment'), field('series', 'Series', []), field('body', 'Body style', []),
      field('sort', 'Sort by', [['name', 'Model name'], ['points', 'Monthly points'], ['earliest-collection', 'Earliest collection']]));
    nodes = { counts: el('p', 'gcsp-note'), allowance: el('p', 'gcsp-gallery-allowance'), status: el('div', ''),
      grid: el('div', 'gcsp-gallery-grid'), results: el('div', 'gcsp-gallery-results'), detail: el('section', 'gcsp-gallery-detail'),
      claimMessage: el('p', 'gcsp-note'), check: button({ label: 'Check status', variant: 'ghost', onClick: () => claim.checkStatus() }),
      retry: button({ label: 'Retry this reservation', variant: 'ghost', onClick: () => claim.retry() }) };
    nodes.counts.setAttribute('role', 'status'); nodes.claimMessage.setAttribute('role', 'status'); nodes.detail.hidden = true;
    const claimNotice = el('section', 'gcsp-gallery-claim'); claimNotice.setAttribute('aria-label', 'Reservation status'); claimNotice.append(nodes.claimMessage, nodes.check, nodes.retry);
    nodes.results.append(nodes.status, nodes.grid);
    panel.append(screenIntro({ kicker: 'Choose your car', title: 'Released cars', lede: 'Browse the available cars. Review one to reserve it while you check the details.', level: 1 }),
      nodes.allowance, filters, nodes.counts, claimNotice, nodes.results, nodes.detail,
      button({ label: 'Back to your choices', variant: 'ghost', onClick() { onBack?.(); notify('gcsp:manual-gallery-back', {}); } }));
    if (adapter.readOnly) panel.prepend(el('p', 'gcsp-note', 'Read-only synthetic gallery · 5 November 2026'));
    main.replaceChildren(panel); draw();
    if (!started) { started = true; gallery.load(); claim.load(); }
    return () => { nodes = null; panel.remove(); };
  } });
  const teardown = () => { disposed = true; gallery.destroy(); claim.destroy(); shell(); };
  teardown.gallery = gallery; teardown.claim = claim; return teardown;
}

export class GcspManualGalleryElement extends HTMLElement {
  constructor() { super(); if (Object.hasOwn(this, 'adapter')) { const adapter = this.adapter; delete this.adapter; this._adapter = adapter; } }
  get adapter() { return this._adapter; }
  set adapter(value) { this._adapter = value; if (this.isConnected) this._mount(); }
  get claimState() { return this._teardown?.claim.getState(); }
  connectedCallback() { this._mount(); }
  disconnectedCallback() { this._teardown?.(); this._teardown = null; }
  _mount() { this._teardown?.(); this._teardown = mountManualGallery(this, { adapter: this._adapter, brand: this.getAttribute('brand') ?? 'bmw' }); }
}
export function defineGcspManualGallery(registry = globalThis.customElements) {
  if (registry && !registry.get('gcsp-manual-gallery')) registry.define('gcsp-manual-gallery', GcspManualGalleryElement);
  return registry?.get('gcsp-manual-gallery');
}
export default function decorate(block, options) { return mountManualGallery(block, options); }
