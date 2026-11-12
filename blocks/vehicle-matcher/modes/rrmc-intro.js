/*
 * RRMC's opening screen: the tagline and sub line over the "Begin your journey" pill.
 */

import { el } from '../ui.js';
import { BRAND_COPY } from './brand-copy.js';
import { rrmcTaglines } from './result-card.js';

/** Paint the intro into `root` and call `onBegin` from its pill. */
export function renderRrmcIntro(root, ctx, onBegin) {
  root.replaceChildren();
  const copy = BRAND_COPY[ctx.brand] || BRAND_COPY.bmw;
  const { title: titleOverride, kicker: kickerOverride } = ctx.overrides;
  const kicker = kickerOverride === undefined ? copy.kicker : kickerOverride;
  const intro = el('div', 'vm-intro');
  // No default headline, as podium shows none; a blank Kicker row drops the tagline.
  const [tagline, sub] = rrmcTaglines();
  if (kicker) {
    tagline.textContent = kicker;
    intro.append(tagline);
  }
  if (titleOverride) intro.append(el('h1', 'vm-title', titleOverride));
  intro.append(sub);

  const begin = el('button', 'vm-btn vm-btn-primary', copy.cta);
  begin.type = 'button';
  begin.addEventListener('click', () => {
    onBegin();
  });
  intro.append(begin);
  root.append(intro);
}
