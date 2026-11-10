import { el } from '../../vehicle-matcher/ui.js';
import { mediaWell } from '../../vehicle-matcher/modes/result-card.js';
import { starRating } from './star-rating.js';

const IMAGE_HASH = '07c269dd7f55fad0a56bbad65ae72f7c35defc5e8883a8290a82972e1defb427.webp';
const IMAGE = `./assets/gcsp-vehicle-evidence/${IMAGE_HASH}`;
const SHORT = 'BMW 3 Series Touring 320i M Sport · Petrol';
const LONG = 'BMW 3 Series 330e xDrive M Sport Pro Touring M Sport Pro · Plug-in hybrid · BMW Individual specification';

// One rating over a car image well, as the Account will compose it; local state only.
function example(caption, { value = null, description = SHORT, photo = IMAGE, status, echo = false } = {}) {
  const scope = el('div', 'gcsp vm-gallery-gcsp-media'); scope.style.minHeight = '0'; scope.append(el('p', 'vm-gallery-copy', caption)); // .gcsp is full height by default
  const { media } = mediaWell({ name: 'BMW 3 Series Touring', photo, alt: 'BMW 3 Series Touring', caption: '' }, 'gcsp-media', { placeholder: 'No image available for your car' });
  media.style.position = 'relative';
  let rating = null;
  rating = starRating({
    label: `How highly do you rate your ${description}?`, help: `How highly do you rate your ${description}?`, value, overlay: true,
    onChange: echo ? (next) => { rating.update({ value: next, status: 'pending' }); Promise.resolve().then(() => rating.update({ value: next, status: 'saved' })); } : undefined,
  });
  if (status) rating.update({ value, status });
  media.append(rating.root); scope.append(media); return scope;
}

export function starRatingExample() {
  const section = el('section', 'vm-gallery-section'); section.id = 'gcsp-star-rating';
  section.append(el('h2', 'vm-gallery-title', 'GCSP star rating and help tip'));
  section.append(
    example('Unrated, help on hover or focus'),
    example('Four stars, saves locally (select the same star to clear)', { value: 4, echo: true }),
    example('Five stars', { value: 5 }),
    example('Long vehicle description', { description: LONG }),
    example('Not saved', { value: 3, status: 'failed' }),
    example('No image', { value: 4, photo: '' }),
  );
  return section;
}
