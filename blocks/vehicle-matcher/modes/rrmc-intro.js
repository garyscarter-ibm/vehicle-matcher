/*
 * RRMC's opening screen: the podium's tagline and sub line over the "Begin your journey" pill.
 * The questionnaire's intro, shared so the shell can open every other mode with it too.
 */

import { el } from '../ui.js';
import { BRAND_COPY } from './brand-copy.js';
import { rrmcTaglines } from './result-card.js';

/**
 * Paint the intro into `root` and call `onBegin` from its pill. `progress` puts an empty bar in the
 * switcher row, as the questionnaire's intro shows; it goes when the pill is pressed or the mode switched.
 */
export function renderRrmcIntro(root, ctx, onBegin, { progress = false } = {}) {
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

  const switcher = root.previousElementSibling;
  const bar = el('div', 'vm-progress');
  bar.append(el('div', 'vm-progress-bar'));
  if (progress && switcher?.classList.contains('vm-switcher')) {
    // After the switch's other listeners: the last mode's own clears the row's class on its way out.
    setTimeout(() => {
      if (!intro.isConnected) return;
      switcher.classList.add('has-progress');
      switcher.prepend(bar);
      switcher.querySelector('.vm-switcher-select')?.addEventListener('change', () => bar.remove(), { once: true });
    });
  }

  const begin = el('button', 'vm-btn vm-btn-primary', copy.cta);
  begin.type = 'button';
  begin.addEventListener('click', () => {
    // The mode puts in its own bar (or none), so the row loses its class with this one.
    if (bar.isConnected) {
      bar.remove();
      switcher.classList.remove('has-progress');
    }
    onBegin();
  });
  intro.append(begin);
  root.append(intro);
}
