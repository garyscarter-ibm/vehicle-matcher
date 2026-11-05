import { el, screenIntro } from '../vehicle-matcher/ui.js';
import { buildEntryUrl, resolveEntryContext } from './entry-context.js';
import { experienceChoice, brandSelector, BRAND_LABELS } from './components.js';

export function renderLauncher(root, initialContext, { input = window.location.href } = {}) {
  const scope = el('div', 'gcsp');
  const main = el('main', 'vm demo-launcher');
  main.dataset.entryHost = initialContext.state;
  const header = el('header', 'demo-launcher-header');
  header.append(el('a', 'demo-launcher-wordmark', 'Car experiences'));
  header.firstChild.href = buildEntryUrl(input, { experience: 'launcher' });
  header.append(el('span', 'demo-launcher-demo', 'Internal demonstration'));
  main.append(header);
  const content = el('div', 'demo-launcher-content');
  content.append(screenIntro({ kicker: 'Your next car', title: 'Where would you like to go?',
    lede: 'Explore cars for your employee scheme or find a used car that suits you.', level: 1 }));
  if (initialContext.state === 'unknown-experience') {
    const message = el('p', 'demo-launcher-notice', 'That car experience is not recognised. Choose an experience below to continue.');
    message.setAttribute('role', 'status');
    content.append(message);
  }
  const cards = el('div', 'demo-experience-grid');
  const selection = el('p', 'demo-launcher-selection');
  selection.setAttribute('aria-live', 'polite');
  const selector = brandSelector({ value: initialContext.brand, onChange: update });
  content.append(selector, selection, cards);
  main.append(content, el('footer', 'demo-launcher-footer', 'A prototype for exploring car experiences. Not an official brand site.'));
  scope.append(main);
  root.replaceChildren(scope);

  function update(brand) {
    const base = new URL(buildEntryUrl(input, { experience: 'launcher', brand }), input);
    const context = resolveEntryContext(base, { employeeAvailable: initialContext.employeeAvailable });
    header.firstChild.href = context.links.launcher;
    selection.textContent = brand ? `Selected brand: ${BRAND_LABELS[brand] || brand}` : 'All six brands available for Used cars. Employee cars supports BMW.';
    const supported = brand === 'bmw';
    let reason;
    let action;
    if (!supported) {
      reason = brand ? 'The employee-car demo supports BMW. Choose BMW to continue; your selected brand stays available for Used cars.'
        : 'The employee-car demo supports BMW. Choose BMW to explore this experience.';
      action = { label: 'Choose BMW', variant: 'ghost', onClick: () => {
        selector.querySelector('select').value = 'bmw';
        selector.querySelector('select').dispatchEvent(new Event('change', { bubbles: true }));
        selector.querySelector('select').focus();
      } };
      if (!context.employeeAvailable) reason += ' Employee cars is currently unavailable.';
    } else if (!context.employeeAvailable) {
      reason = 'Employee cars is not available right now. You can still explore Used cars below.';
      action = { label: 'Employee cars unavailable', disabled: true };
    } else {
      action = { label: 'Explore Employee cars', href: context.links.employeeCars };
    }
    cards.replaceChildren(
      experienceChoice({ title: 'Employee cars',
        description: 'Explore your next BMW through the employee car scheme.',
        image: 'assets/brand-hero/bmw.jpg', imageLabel: 'BMW employee-car experience',
        reason, action,
        status: context.employeeAvailable ? 'BMW employee experience available' : 'Currently unavailable' }),
      experienceChoice({ title: 'Used cars',
        description: 'Find a used car matched to how you drive. Explore the full choice of brands and ways to search.',
        image: `assets/brand-hero/${brand || 'mini'}.jpg`, imageLabel: `${BRAND_LABELS[brand] || 'MINI'} used-car experience`,
        action: { label: brand ? `Explore ${BRAND_LABELS[brand]} Used cars` : 'Explore Used cars', href: context.links.usedCars },
        reason: brand ? `Continue with ${BRAND_LABELS[brand]}.` : 'Choose from BMW, MINI, Ford, Honda, BMW Motorrad and Ferrari.' }),
    );
  }
  update(initialContext.brand);
  return main;
}
