import { el } from '../../vehicle-matcher/ui.js';
import { mediaGallery } from './media-gallery.js';

// Retained G21 example; source/configuration associations stay in the reviewed image catalogue.
const images = [
  ['07c269dd7f55fad0a56bbad65ae72f7c35defc5e8883a8290a82972e1defb427', 'Front exterior', 'FRONTLEFT', 'representative-configuration'],
  ['398f08f4e76862d966a28a3b6a622aea9cf9c83e1b64d36353b374e05303d261', 'Rear exterior', 'REARLEFT', 'representative-configuration'],
  ['285aba84d74d7b3c792e4cb47d97f650a5c81e711eeb5b58c8c959d355380464', 'Interior', 'DASH', 'representative-model'],
].map(([digest, label, viewpoint, fidelity]) => ({ src: `/assets/gcsp-vehicle-evidence/${digest}.webp`,
  alt: `BMW 3 Series Touring, ${label.toLowerCase()}`, label, viewpoint, fidelity }));

export function mediaGalleryExamples() {
  const section = el('section', 'vm-gallery-section gcsp'); section.dataset.mediaGalleryExamples = '';
  section.setAttribute('aria-label', 'Vehicle media gallery'); section.append(el('h2', 'vm-gallery-title', 'Vehicle media gallery'));
  const instances = [];
  for (const [title, views] of [['Three views and enlarged viewer', images], ['Single retained image', images.slice(0, 1)],
    ['No images', []], ['Unavailable selected image and long labels', images.map((image) => ({ ...image, label: `${image.label} with extended Individual specification` }))]]) {
    const group = el('div', 'vm vm-gallery-gcsp-group');
    group.append(el('h3', 'vm-gallery-gcsp-title', title));
    const gallery = mediaGallery({ name: 'BMW 3 Series Touring', images: views }); instances.push(gallery);
    group.append(gallery.root); section.append(group);
    if (title.startsWith('Unavailable')) gallery.root.querySelector('.vm-card-photo').dispatchEvent(new gallery.root.ownerDocument.defaultView.Event('error'));
  }
  section.destroy = () => instances.forEach((gallery) => gallery.destroy());
  return section;
}
