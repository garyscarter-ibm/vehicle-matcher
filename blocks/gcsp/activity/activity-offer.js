import { el, button } from '../../vehicle-matcher/ui.js';
import { mediaWell } from '../../vehicle-matcher/modes/result-card.js';
// Reviewed local sources; the corpus entries mirror APPROVED_CORPUS_IMAGES (drift-tested). No other src is accepted.
const REPRESENTATIVE = 'representative-configuration';
export const approvedImages = new Map([['/assets/brand-hero/bmw.jpg', 'representative'],
  ['/assets/gcsp-vehicle-evidence/fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe.webp', REPRESENTATIVE],
  ['/assets/gcsp-vehicle-evidence/9704a8616835a1c1ce3b6d65f80e91cabb9edbfc0f83eca06b467bb3b1d236e3.webp', REPRESENTATIVE]]);
const CORPUS_CAPTION = 'Representative image; exact appearance and equipment unconfirmed.';
import { offerStateLabel, respondBy } from './activity-copy.js';
export function activityOffer({ offer, display, level = 2, emptyText = 'No current offer' } = {}) {
  const root = el('section', 'gcsp-activity-offer');
  root.append(el(`h${level}`, 'gcsp-activity-section-title', 'Your offer'));
  const layout = el('div', 'gcsp-activity-offer-grid');
  const images = (offer && Array.isArray(display?.images) ? display.images : []).filter((image) => approvedImages.get(image.src) === (image.kind ?? image.fidelity)
    && typeof image.alt === 'string' && image.alt.trim());
  const media = mediaWell({ line: '' }, 'gcsp-activity-offer-media', { placeholder: offer ? 'Image unavailable' : emptyText });
  const visual = el('div', 'gcsp-activity-offer-visual'); visual.append(media.media);
  const controls = [];
  function select(index) {
    const image = images[index];
    media.showPhoto(image.src, { alt: image.alt, caption: approvedImages.get(image.src) === 'representative' ? 'Representative BMW brand image'
        : typeof image.caption === 'string' && image.caption.trim() ? image.caption : CORPUS_CAPTION });
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
