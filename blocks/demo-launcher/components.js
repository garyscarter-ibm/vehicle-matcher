import { el, screenIntro, button } from '../vehicle-matcher/ui.js';
import { mediaWell } from '../vehicle-matcher/modes/result-card.js';
import { ENTRY_REGISTRY } from './entry-context.js';

export const BRAND_LABELS = Object.freeze({
  bmw: 'BMW', mini: 'MINI', ford: 'Ford', honda: 'Honda', motorrad: 'BMW Motorrad', ferrari: 'Ferrari',
});
let sequence = 0;

// Destination cards own navigation and availability, never car decisions or policy.
export function experienceChoice({ title, description, image, imageLabel, action, reason,
  status, secondaryAction } = {}) {
  const card = el('article', 'demo-experience-choice');
  const id = `demo-choice-${++sequence}`;
  const { media } = mediaWell(null, '', {
    placeholder: `${title} images coming soon`,
    view: { display: { name: imageLabel || title }, media: { src: image,
      alt: imageLabel || title, caption: 'Representative brand image' } },
  });
  card.append(media);
  const body = el('div', 'demo-choice-body');
  const intro = screenIntro({ title, lede: description, level: 2 });
  intro.querySelector('h2').id = id;
  card.setAttribute('aria-labelledby', id);
  body.append(intro);
  if (status) {
    const note = el('p', 'demo-choice-status', status);
    note.setAttribute('role', 'status');
    body.append(note);
  }
  let reasonId;
  if (reason) {
    const note = el('p', 'demo-choice-reason', reason);
    reasonId = `${id}-reason`;
    note.id = reasonId;
    body.append(note);
  }
  const actions = el('div', 'demo-choice-actions');
  if (action) actions.append(button({ ...action, describedBy: reasonId }));
  if (secondaryAction) actions.append(button({ variant: 'ghost', ...secondaryAction }));
  body.append(actions);
  card.append(body);
  return card;
}

// A native selector retains labels if decorative brand artwork cannot load.
export function brandSelector({ value = null, onChange, label = 'Choose a brand' } = {}) {
  const root = el('div', 'demo-brand-selector');
  const id = `demo-brand-${++sequence}`;
  const caption = el('label', 'demo-brand-label', label);
  caption.htmlFor = id;
  const select = el('select', 'demo-brand-control');
  select.id = id;
  const add = (key, text) => {
    const option = el('option', '', text);
    option.value = key;
    select.append(option);
  };
  add('', 'All brands');
  ENTRY_REGISTRY.retailBrands.forEach((key) => add(key, BRAND_LABELS[key]));
  select.value = ENTRY_REGISTRY.retailBrands.includes(value) ? value : '';
  select.addEventListener('change', () => {
    paintLogo();
    onChange?.(select.value || null);
  });
  const plate = el('span', 'demo-brand-mark');
  plate.setAttribute('aria-hidden', 'true');
  function paintLogo() {
    plate.replaceChildren(el('span', '', BRAND_LABELS[select.value] || 'Your choice'));
    if (!select.value) return;
    const img = el('img');
    img.alt = '';
    img.src = `assets/brand-logos/${select.value}.svg`;
    img.addEventListener('load', () => { if (img.parentElement === plate) plate.firstChild.hidden = true; });
    img.addEventListener('error', () => {
      if (img.parentElement !== plate) return;
      plate.firstChild.hidden = false;
      img.remove();
    });
    plate.append(img);
  }
  paintLogo();
  root.append(caption, select, plate);
  return root;
}
