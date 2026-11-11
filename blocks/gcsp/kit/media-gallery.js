import { el, button } from '../../vehicle-matcher/ui.js';
import { mediaWell } from '../../vehicle-matcher/modes/result-card.js';
import { isDisplayImage } from './vehicle-image-assets.js';
import { NO_IMAGE_TEXT } from './plain-copy.js';

let sequence = 0;
const paths = { enlarge: ['M10 3a7 7 0 1 0 0 14a7 7 0 0 0 0-14', 'm15 15 6 6', 'M10 7v6M7 10h6'], close: ['m6 6 12 12M18 6 6 18'], previous: ['m14 5-7 7 7 7'], next: ['m10 5 7 7-7 7'] };
function icon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  for (const line of paths[kind]) { const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', line); svg.append(path); }
  return svg;
}
function iconButton(label, kind, action, className) {
  const control = button({ label: '', variant: 'ghost', onClick: action });
  control.classList.add(className); control.setAttribute('aria-label', label); control.append(icon(kind));
  return control;
}

/** One selected view shared by the feature, thumbnails and enlarged viewer; no source requests. */
export function mediaGallery({ name = 'Vehicle', images = [], placeholder = NO_IMAGE_TEXT } = {}) {
  const source = Array.isArray(images) ? images : [];
  const views = source.filter((image, index) => image && typeof image.src === 'string'
    && (isDisplayImage(image.src, image.fidelity) || image.src === '/assets/brand-hero/bmw.jpg' && (!image.fidelity || image.fidelity === 'representative'))
    && source.findIndex((other) => other?.src === image.src) === index)
    .map((image, index) => ({ ...image, label: image.label || (source.length === 1 ? 'Vehicle image' : `View ${index + 1}`), alt: image.alt || `${name}, ${(image.label || `view ${index + 1}`).toLowerCase()}` }));
  const root = el('div', 'gcsp-media-gallery');
  const feature = el('div', 'gcsp-media-gallery-feature');
  const well = mediaWell({ name }, 'gcsp-media-whole', { placeholder });
  feature.append(well.media); root.append(feature);
  let selected = 0; let destroyed = false; let open = false;
  const failed = new Set(); const thumbSets = [];
  let dialog; let large; let heading; let position; let previous; let next; let enlarge;
  const status = el('p', 'gcsp-media-gallery-loading', 'Loading image'); status.setAttribute('role', 'status');
  const api = { root, get selectedIndex() { return selected; }, select, destroy() {
    if (destroyed) return; destroyed = true; close(false);
    root.ownerDocument.removeEventListener('keydown', onKey);
    root.ownerDocument.removeEventListener('focusin', containFocus);
  } };
  if (!views.length) return api;

  function thumbStrip(className) {
    const strip = el('div', className); strip.setAttribute('role', 'group'); strip.setAttribute('aria-label', 'Vehicle image views');
    const controls = views.map((view, index) => {
      const control = button({ label: '', variant: 'ghost', onClick: () => select(index) });
      control.className = 'gcsp-media-gallery-thumb'; control.setAttribute('aria-label', `${view.label} of ${name}`);
      const image = el('img'); image.src = view.src; image.alt = ''; image.loading = 'lazy';
      image.addEventListener('error', () => markFailed(index));
      control.append(image, el('span', '', view.label)); strip.append(control); return control;
    });
    thumbSets.push(controls); return strip;
  }
  function visibleControls() { return [...dialog.querySelectorAll('button')].filter((control) => !control.disabled && !control.hidden); }
  function close(restore = true) {
    if (!open) return; open = false;
    if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
    if (restore && enlarge.isConnected) enlarge.focus({ preventScroll: true });
  }
  function containFocus(event) {
    if (open && !dialog.contains(event.target)) dialog.querySelector('.gcsp-media-gallery-close').focus({ preventScroll: true });
  }
  function onKey(event) {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step(event.key === 'ArrowRight' ? 1 : -1); }
    else if (event.key === 'Tab') {
      const controls = visibleControls(); const first = controls[0]; const last = controls.at(-1); const active = root.ownerDocument.activeElement;
      if (event.shiftKey && (!dialog.contains(active) || active === first)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (!dialog.contains(active) || active === last)) { event.preventDefault(); first.focus(); }
    }
  }
  function step(direction) {
    for (let distance = 1; distance <= views.length; distance += 1) {
      const index = (selected + direction * distance + views.length) % views.length;
      if (!failed.has(index)) { select(index); return; }
    }
  }
  function markFailed(index) {
    failed.add(index);
    thumbSets.forEach((set) => { set[index].classList.add('is-unavailable'); set[index].querySelector('img')?.remove(); });
    if (previous) previous.hidden = next.hidden = views.length - failed.size < 2;
    if (index !== selected) return;
    status.hidden = true; enlarge.hidden = true;
    well.showPhoto(null); well.media.querySelector('.vm-card-soon').textContent = views.length > 1 ? 'Image unavailable. Choose another view.' : placeholder;
    if (large) { large.replaceChildren(el('p', 'gcsp-media-gallery-unavailable', 'Image unavailable')); }
  }
  function showLarge(view, index) {
    heading.textContent = view.label; position.textContent = `${index + 1} of ${views.length}`;
    if (!open) return;
    const loading = el('p', 'gcsp-media-gallery-large-loading', 'Loading image'); loading.setAttribute('role', 'status');
    const image = el('img', 'gcsp-media-gallery-large'); image.alt = view.alt;
    image.addEventListener('load', () => loading.remove());
    image.addEventListener('error', () => { if (selected === index) markFailed(index); });
    large.replaceChildren(image, loading); image.src = view.src;
    if (image.complete && image.naturalWidth > 0) loading.remove();
  }
  function select(index) {
    if (destroyed || !views.length || !Number.isInteger(index)) return;
    selected = (index % views.length + views.length) % views.length;
    const view = views[selected];
    thumbSets.forEach((set) => set.forEach((control, item) => control.setAttribute('aria-pressed', String(item === selected))));
    enlarge.setAttribute('aria-label', `Enlarge ${view.label.toLowerCase()} image`);
    if (failed.has(selected)) { markFailed(selected); }
    else {
      well.showPhoto(view.src, view); status.hidden = false; enlarge.hidden = false;
      const image = well.media.querySelector('img'); image.loading = 'eager';
      const ownIndex = selected;
      image.addEventListener('load', () => { if (selected === ownIndex && image.isConnected) status.hidden = true; });
      image.addEventListener('error', () => { if (selected === ownIndex && !destroyed) markFailed(ownIndex); });
      if (image.complete && image.naturalWidth > 0) status.hidden = true;
    }
    if (dialog) {
      showLarge(view, selected);
      if (failed.has(selected)) large.replaceChildren(el('p', 'gcsp-media-gallery-unavailable', 'Image unavailable'));
      if (open) thumbSets.at(-1)?.[selected].scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }
  }

  enlarge = iconButton('Enlarge image', 'enlarge', () => {
    if (failed.has(selected)) return;
    open = true;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    showLarge(views[selected], selected);
    dialog.querySelector('.gcsp-media-gallery-close').focus({ preventScroll: true });
    thumbSets.at(-1)?.[selected].scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }, 'gcsp-media-gallery-enlarge');
  feature.append(status, enlarge);
  if (views.length > 1) root.append(thumbStrip('gcsp-media-gallery-thumbs'));
  dialog = el('dialog', 'gcsp-media-gallery-dialog'); dialog.setAttribute('aria-modal', 'true');
  heading = el('h2', 'gcsp-media-gallery-title'); heading.id = `gcsp-media-gallery-${++sequence}`; dialog.setAttribute('aria-labelledby', heading.id);
  const head = el('div', 'gcsp-media-gallery-head'); head.append(heading, iconButton('Close image viewer', 'close', () => close(), 'gcsp-media-gallery-close'));
  const stage = el('div', 'gcsp-media-gallery-stage'); large = el('div', 'gcsp-media-gallery-large-well'); stage.append(large);
  if (views.length > 1) {
    previous = iconButton('Previous image', 'previous', () => step(-1), 'gcsp-media-gallery-previous');
    next = iconButton('Next image', 'next', () => step(1), 'gcsp-media-gallery-next'); stage.append(previous, next);
  }
  const foot = el('div', 'gcsp-media-gallery-foot'); position = el('p', 'gcsp-media-gallery-position'); position.setAttribute('aria-live', 'polite'); foot.append(position);
  if (views.length > 1) foot.append(thumbStrip('gcsp-media-gallery-strip'));
  dialog.append(head, stage, foot); root.append(dialog);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (open) { open = false; if (enlarge.isConnected) enlarge.focus({ preventScroll: true }); } });
  root.ownerDocument.addEventListener('keydown', onKey); root.ownerDocument.addEventListener('focusin', containFocus);
  select(0);
  return api;
}
