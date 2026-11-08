import { el, button } from '../../vehicle-matcher/ui.js';
import { mediaWell } from '../../vehicle-matcher/modes/result-card.js';
// Explicitly approved local image source. Extend only with a reviewed asset manifest.
const approved = new Map([['/assets/brand-hero/bmw.jpg', 'representative']]);
import { offerStateLabel, respondBy } from './activity-copy.js';
export function activityOffer({ offer, display, level = 2, emptyText = 'No current offer' } = {}) {
  const root = el('section', 'gcsp-activity-offer');
  root.append(el(`h${level}`, 'gcsp-activity-section-title', 'Your offer'));
  const layout = el('div', 'gcsp-activity-offer-grid');
  const images = (offer && Array.isArray(display?.images) ? display.images : []).filter((image) => approved.get(image.src) === image.kind
    && typeof image.alt === 'string' && image.alt.trim());
  const media = mediaWell({ line: '' }, 'gcsp-activity-offer-media', { placeholder: offer ? 'Image unavailable' : emptyText });
  const visual = el('div', 'gcsp-activity-offer-visual'); visual.append(media.media);
  const controls = [];
  function select(index) {
    const image = images[index];
    media.showPhoto(image.src, { alt: image.alt, caption: image.kind === 'representative' ? 'Representative BMW brand image' : undefined });
    controls.forEach((control, at) => control.setAttribute('aria-pressed', String(at === index)));
  }
  if (images.length > 1) {
    const chooser = el('div', 'gcsp-activity-image-controls'); chooser.setAttribute('role', 'group'); chooser.setAttribute('aria-label', 'Vehicle images');
    images.forEach((image, index) => {
      const control = button({ label: `Image ${index + 1}`, variant: 'ghost', onClick: () => select(index) });
      control.dataset.image = String(index); controls.push(control); chooser.append(control);
    });
    visual.append(chooser);
  }
  if (images.length) select(0);
  layout.append(visual);
  if (offer) {
    const details = el('div', 'gcsp-activity-offer-details');
    const due = respondBy(offer);
    details.append(el('p', 'gcsp-activity-offer-state', offerStateLabel(offer.state)));
    if (due) details.append(el('p', 'gcsp-activity-offer-state', due));
    if (display?.title) details.append(el(`h${Math.min(level + 1, 6)}`, 'gcsp-activity-offer-name', display.title));
    if (offer.href) details.append(button({ label: 'View offer', variant: 'ghost', href: offer.href }));
    layout.append(details);
  }
  root.append(layout); return root;
}
