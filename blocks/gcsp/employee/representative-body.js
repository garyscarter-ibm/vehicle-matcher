// Representative employee body (FUCQ-64): page composition from kit primitives, not a kit card.
// Nothing here reserves, orders or saves; all data comes from the injected fixture.
import { el, screenIntro, button, statusScreen, factList } from '../../vehicle-matcher/ui.js';
import { mediaWell } from '../../vehicle-matcher/modes/result-card.js';
import { svgIcon } from '../shell/portal-shell.js';
import { NO_IMAGE_TEXT as NO_IMAGE } from '../kit/plain-copy.js';

const CHECK = ['M5 12.5l4.5 4.5L19 7.5'];
const WARN = ['M12 8v5', 'M12 16.5v.01', 'M4 19h16L12 5z'];
const CLOCK = ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7.5V12l3 2'];
const DAY = 86400000;
let uid = 0;

const num = (n) => n.toLocaleString('en-GB');
const pointsText = (n) => `${num(n)} points a month`;
const utc = (iso) => Date.parse(`${iso}T00:00:00Z`);
const longDate = (iso) => new Date(utc(iso)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Plain countdown from an injected date: "ends in 27 days", "ends today" or "ended 3 days ago". */
export function countdown(now, end) {
  const days = Math.round((utc(end) - utc(now)) / DAY);
  const plural = (n) => `${n} day${n === 1 ? '' : 's'}`;
  if (days === 0) return 'ends today';
  return days > 0 ? `ends in ${plural(days)}` : `ended ${plural(-days)} ago`;
}

function photoWell(item, caption, label) {
  const { media } = mediaWell(
    { name: `${item.name}, ${label}`, line: caption, photo: item.photo?.src || '' },
    'gcsp-media',
    { placeholder: NO_IMAGE },
  );
  if (item.photo?.crop) media.dataset.crop = item.photo.crop;
  // The caption describes a photo, so it goes when there is none.
  if (!item.photo?.src) media.querySelector('.vm-card-line')?.remove();
  return media;
}

function statusLine(over, text) {
  const line = el('p', `gcsp-status ${over ? 'is-over' : 'is-ok'}`);
  line.append(svgIcon(over ? WARN : CHECK), el('span', '', text));
  return line;
}

export function renderRepresentativeBody(main, { account, data } = {}) {
  const wrap = el('div', 'vm gcsp-rep');
  const done = () => { wrap.remove(); };
  if (account?.status !== 'ready' || !data) {
    const retry = el('p', 'gcsp-note', 'Use Retry in the header to try again.');
    wrap.append(screenIntro({ kicker: 'Choices', title: 'Your cars', level: 1, className: 'gcsp-intro' }), statusScreen({
      title: 'Your cars are not available right now',
      message: 'We could not load your account, so your current car and the cars you can choose are hidden.',
      actions: [retry],
    }));
    main.replaceChildren(wrap);
    return done;
  }

  const id = `gcsp-rep-${++uid}`;
  const allowance = data.allowance.value;
  const current = data.currentCar;
  wrap.append(screenIntro({
    kicker: 'Choices',
    title: 'Your cars',
    lede: 'Your current contract is ending soon. Check it below, then choose a replacement that fits your monthly points allowance.',
    level: 1,
    className: 'gcsp-intro',
  }));

  // Current car feature
  const feature = el('section', 'gcsp-feature');
  feature.setAttribute('aria-labelledby', `${id}-current`);
  const heading = el('h2', 'gcsp-h2', current.name);
  heading.id = `${id}-current`;
  const ends = el('p', 'gcsp-countdown');
  ends.append(svgIcon(CLOCK), el('span', '', `Contract ${countdown(data.now, current.contractEnd)}, on ${longDate(current.contractEnd)}`));
  const choose = button({ label: 'Choose a replacement', variant: 'primary' });
  const details = el('details', 'gcsp-details');
  details.append(
    el('summary', 'gcsp-details-summary', 'Contract and licence details'),
    factList(current.details.map((d) => ({ label: d.label, value: d.date ? longDate(d.date) : d.value })), { className: 'gcsp-facts' }),
  );
  const copy = el('div', 'gcsp-feature-copy');
  copy.append(
    el('p', 'gcsp-eyebrow', 'Your current car'),
    heading,
    ends,
    factList([
      { label: 'Registration', value: current.registration },
      { label: 'VIN', value: current.vin },
      { label: 'Term and mileage', value: `${current.term}, ${num(current.miles)} miles` },
      { label: 'Scheme', value: current.scheme },
      { label: 'Driver', value: account.name },
      { label: 'Monthly cost', value: current.points.value, unit: 'points a month' },
    ], { className: 'gcsp-facts' }),
    el('div', 'gcsp-actions'),
    details,
  );
  copy.querySelector('.gcsp-actions').append(choose);
  feature.append(photoWell(current, 'BMW brand image, not your car', 'BMW brand image, not your car'), copy);

  // Allowance
  const allow = el('section', 'gcsp-allowance');
  allow.setAttribute('aria-labelledby', `${id}-allowance`);
  const allowHead = el('h2', 'gcsp-h2', 'Your allowance');
  allowHead.id = `${id}-allowance`;
  const allowLeft = el('p', 'gcsp-allowance-left', 'Select a car below to see the points you would have left.');
  allow.append(
    allowHead,
    el('p', 'gcsp-allowance-figure', pointsText(allowance)),
    el('p', 'gcsp-note', 'Choices uses points and has no cash top-up in this preview. A car costs a number of points each month, and the points left are what remains of your allowance.'),
    allowLeft,
  );

  // Selection
  const selection = el('section', 'gcsp-selection');
  const selHead = el('h2', 'gcsp-h2 gcsp-selection-heading', 'Choose a replacement');
  selHead.id = `${id}-selection`;
  selHead.tabIndex = -1;
  selection.setAttribute('aria-labelledby', selHead.id);
  selection.append(selHead, el('p', 'gcsp-note', `${data.stock.length} cars you could choose from. Cars over your allowance cannot be selected.`));
  const grid = el('ul', 'gcsp-cards');
  const cards = [];
  data.stock.forEach((car, index) => {
    const over = car.points.value > allowance;
    const gap = Math.abs(allowance - car.points.value);
    const item = el('li', 'gcsp-card-item');
    const card = el('article', 'gcsp-card');
    const name = el('h3', 'gcsp-card-name', car.name);
    name.id = `${id}-car-${index}`;
    card.setAttribute('aria-labelledby', name.id);
    const pts = el('p', 'gcsp-points');
    pts.append(el('span', 'gcsp-points-n', num(car.points.value)), el('span', 'gcsp-points-unit', ' points a month'));
    const reason = el('p', 'gcsp-reason', `Over your allowance by ${num(gap)} points, so this car cannot be selected.`);
    reason.id = `${id}-car-${index}-reason`;
    const pick = button({ label: 'Select this car', variant: 'ghost', disabled: over, describedBy: over ? reason.id : undefined });
    pick.classList.add('gcsp-pick');
    pick.setAttribute('aria-pressed', 'false');
    pick.prepend(svgIcon(CHECK));
    const body = el('div', 'gcsp-card-body');
    body.append(
      name,
      el('p', 'gcsp-order', `Order no. ${car.orderNumber}`),
      pts,
      statusLine(over, over ? `${num(gap)} points over your allowance` : `Within your allowance, ${num(gap)} points left`),
      factList([
        { label: 'Colour', value: car.colour },
        { label: 'Interior', value: car.interior },
        { label: 'Fuel', value: car.fuel },
        { label: 'Gearbox', value: car.transmission },
        { label: 'WLTP CO2', value: car.co2, unit: 'g/km' },
        { label: 'Earliest collection', value: longDate(car.collection) },
      ], { className: 'gcsp-facts' }),
    );
    const foot = el('div', 'gcsp-card-foot');
    if (over) foot.append(reason);
    foot.append(pick);
    card.append(photoWell(car, 'BMW brand image, not this model', 'BMW brand image, not this model'), body, foot);
    item.append(card);
    grid.append(item);
    cards.push({ car, over, gap, card, pick });
  });
  selection.append(grid);

  // Summary
  const summary = el('section', 'gcsp-summary');
  const sumHead = el('h2', 'gcsp-h2', 'Your selection');
  sumHead.id = `${id}-summary`;
  summary.setAttribute('aria-labelledby', sumHead.id);
  const live = el('div', 'gcsp-summary-live');
  live.setAttribute('aria-live', 'polite');
  const reserveReason = el('p', 'gcsp-reason', 'Reserving is not part of this preview.');
  reserveReason.id = `${id}-reserve-reason`;
  const reserve = button({ label: 'Reserve this car', variant: 'primary', disabled: true, describedBy: reserveReason.id });
  const sumFoot = el('div', 'gcsp-summary-foot');
  sumFoot.append(reserve, reserveReason);
  summary.append(sumHead, live, sumFoot);

  let selected = null;
  function render() {
    for (const c of cards) {
      const on = c === selected;
      c.pick.setAttribute('aria-pressed', String(on));
      c.card.classList.toggle('is-selected', on);
    }
    if (!selected) {
      live.replaceChildren(el('p', 'gcsp-note', 'No car selected yet. Choose one above to compare it with your allowance.'));
      allowLeft.textContent = 'Select a car below to see the points you would have left.';
      return;
    }
    const left = allowance - selected.car.points.value;
    live.replaceChildren(
      el('p', 'gcsp-summary-name', selected.car.name),
      el('p', 'gcsp-order', `Order no. ${selected.car.orderNumber}`),
      factList([
        { label: 'Cost', value: selected.car.points.value, unit: 'points a month' },
        { label: 'Your allowance', value: allowance, unit: 'points a month' },
        { label: 'Points left', value: left, unit: 'points a month' },
      ], { className: 'gcsp-facts' }),
    );
    allowLeft.textContent = `With ${selected.car.name} you would have ${pointsText(left).replace(' a month', ' left each month')}.`;
  }
  render();
  for (const c of cards) {
    c.pick.addEventListener('click', () => {
      if (c.over) return;
      selected = selected === c ? null : c;
      render();
    });
  }
  choose.addEventListener('click', () => {
    selHead.focus();
    if (typeof selHead.scrollIntoView === 'function') selHead.scrollIntoView({ block: 'start' });
  });

  wrap.append(feature, allow, selection, summary);
  main.replaceChildren(wrap);
  return done;
}
