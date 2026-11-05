import { el, button } from '../vehicle-matcher/ui.js';
import { ENTRY_REGISTRY, brandChangeUrl, buildEntryUrl } from './entry-context.js';

const navigationObservers = new WeakMap();

// Share one wrapper per window; observers never change native history outcomes.
export function observeRetailNavigation(win, onNavigate) {
  let observer = navigationObservers.get(win);
  if (!observer) {
    const callbacks = new Set();
    const notify = () => callbacks.forEach((callback) => {
      try { callback(); } catch { /* Optional navigation chrome cannot block history. */ }
    });
    const methods = ['pushState', 'replaceState'].map((name) => {
      const original = win.history[name];
      const descriptor = Object.getOwnPropertyDescriptor(win.history, name);
      const wrapper = function (...args) {
        const result = Reflect.apply(original, this, args);
        notify();
        return result;
      };
      win.history[name] = wrapper;
      return { name, descriptor, wrapper };
    });
    const events = ['popstate', 'hashchange', 'pageshow'];
    events.forEach((name) => win.addEventListener(name, notify));
    observer = { callbacks, destroy() {
      events.forEach((name) => win.removeEventListener(name, notify));
      methods.forEach(({ name, descriptor, wrapper }) => {
        if (win.history[name] !== wrapper) return;
        if (descriptor) Object.defineProperty(win.history, name, descriptor);
        else delete win.history[name];
      });
      navigationObservers.delete(win);
    } };
    navigationObservers.set(win, observer);
  }
  observer.callbacks.add(onNavigate);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    observer.callbacks.delete(onNavigate);
    if (!observer.callbacks.size) observer.destroy();
  };
}

// The retained retail harness owns its chrome and pool-label overrides.
export function createRetailChrome({ root, params, DEFAULT_API }) {
const BRANDS = {
  bmw: {
    label: 'BMW',
    origin: 'usedcars.bmw.co.uk',
    navLinks: ['Models', 'Approved Used', 'Offers', 'Book a Test Drive'],
    heroKicker: 'BMW Approved Used',
    heroTitle: 'Find Your BMW.',
    heroSub: 'Sheer driving pleasure, matched to how you actually drive.',
    heroCta: 'Start matching',
    footerLinks: ['Legal', 'Privacy', 'Cookies', 'Contact'],
    footerNote: 'Internal demonstration only. This is a prototype of the '
      + 'vehicle-matcher tool shown inside representative brand furniture. It '
      + 'is not an official BMW site and is not affiliated with or endorsed '
      + 'by BMW.',
  },
  mini: {
    label: 'MINI',
    origin: 'approvedusedminis.co.uk',
    navLinks: ['Range', 'Approved Used', 'Offers', 'Book a Test Drive'],
    heroKicker: 'MINI Approved Used',
    heroTitle: 'Find Your MINI.',
    heroSub: 'Go-kart feeling, with your name on it.',
    heroCta: 'Start matching',
    footerLinks: ['Legal', 'Privacy', 'Cookies', 'Contact'],
    footerNote: 'Internal demonstration only. This is a prototype of the '
      + 'vehicle-matcher tool shown inside representative brand furniture. It '
      + 'is not an official MINI site and is not affiliated with or endorsed '
      + 'by MINI.',
  },
  ford: {
    label: 'Ford',
    origin: 'www.ford.co.uk',
    navLinks: ['Vehicles', 'Approved Used', 'Offers', 'Find a Dealer'],
    heroKicker: 'Ford Approved Used',
    heroTitle: 'Find the right Ford for you.',
    heroSub: 'Sensible, well priced and built for real British life.',
    heroCta: 'Start matching',
    footerLinks: ['Legal', 'Privacy', 'Cookies', 'Contact'],
    footerNote: 'Internal demonstration only. This is a prototype of the '
      + 'vehicle-matcher tool shown inside representative brand furniture. It '
      + 'is not an official Ford site and is not affiliated with or endorsed '
      + 'by Ford.',
  },
  honda: {
    label: 'Honda',
    origin: 'usedcars.honda.co.uk',
    navLinks: ['Cars', 'Approved Used', 'Offers', 'Find a Dealer'],
    heroKicker: 'Honda Approved Used',
    heroTitle: 'Find the right Honda for you.',
    heroSub: 'A car that genuinely suits how you live, and shows its working.',
    heroCta: 'Start matching',
    footerLinks: ['Legal', 'Privacy', 'Cookies', 'Contact'],
    footerNote: 'Internal demonstration only. This is a prototype of the '
      + 'vehicle-matcher tool shown inside representative brand furniture. It '
      + 'is not an official Honda site and is not affiliated with or endorsed '
      + 'by Honda.',
  },
  motorrad: {
    label: 'BMW Motorrad',
    origin: 'approvedused.bmw-motorrad.co.uk',
    navLinks: ['Bikes', 'Approved Used', 'Offers', 'Book a Test Ride'],
    heroKicker: 'BMW Motorrad Approved Used',
    heroTitle: 'Make Life a Ride.',
    heroSub: 'The approved-used bike built for the road you ride.',
    heroCta: 'Start matching',
    footerLinks: ['Legal', 'Privacy', 'Cookies', 'Contact'],
    footerNote: 'Internal demonstration only. This is a prototype of the '
      + 'vehicle-matcher tool shown inside representative brand furniture. It '
      + 'is not an official BMW Motorrad site and is not affiliated with or '
      + 'endorsed by BMW Motorrad.',
  },
  ferrari: {
    label: 'Ferrari',
    origin: 'preowned.ferrari.com',
    navLinks: ['Range', 'Ferrari Approved', 'The Marque', 'Find a Dealer'],
    heroKicker: 'Ferrari Approved',
    heroTitle: 'The one that was made for you.',
    heroSub: 'Every approved-used Ferrari, matched to the way you drive and '
      + 'the roads you love.',
    heroCta: 'Start matching',
    footerLinks: ['Legal', 'Privacy', 'Cookies', 'Contact'],
    footerNote: 'Internal demonstration only. This is a prototype of the '
      + 'vehicle-matcher tool shown inside representative brand furniture. It '
      + 'is not an official Ferrari site and is not affiliated with or '
      + 'endorsed by Ferrari.',
  },
};

const PICKER_ORDER = ENTRY_REGISTRY.retailBrands;

const BRAND_RETAILER_NAMES = {
  bmw: 'BMW Approved Used',
  mini: 'MINI Approved Used',
  honda: 'Honda Approved Used',
  ford: 'Ford Approved Used',
  motorrad: 'BMW Motorrad Approved Used',
  ferrari: 'Ferrari Approved',
};
const DEALER_NAMES = { 96: 'Grassicks Garage', 92: 'Sytner Luton' };
const BRAND_RETAILER_IDS = { bmw: '96', mini: '92' };
const DEALER_POOL_BRANDS = new Set(['bmw', 'mini']);

const scope = params.get('scope')?.trim().toLowerCase() === 'national'
  ? 'national'
  : 'dealer';

const poolNameFor = (brandKey, retailerId) => {
  if (scope === 'national' || !DEALER_POOL_BRANDS.has(brandKey)) {
    return BRAND_RETAILER_NAMES[brandKey] || BRAND_RETAILER_NAMES.bmw;
  }
  return DEALER_NAMES[retailerId] || 'this retailer';
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const linkList = (items) => items
  .map((l) => `<a href="#">${esc(l)}</a>`)
  .join('');

function logoNode(key, label, textClass) {
  const img = el('img');
  img.src = `assets/brand-logos/${key}.svg`;
  img.alt = label;
  img.addEventListener('error', () => {
    const span = el('span');
    span.className = textClass;
    span.textContent = label;
    img.replaceWith(span);
  });
  return img;
}

function brandAccent(key) {
  const probe = el('span');
  probe.className = `vm vm-${key}`;
  probe.style.display = 'none';
  document.body.append(probe);
  const spot = getComputedStyle(probe).getPropertyValue('--vm-accent-spot').trim();
  probe.remove();
  return spot || '#4c8bf5';
}

function renderPicker() {
  root.innerHTML = `
    <div class="demo-picker">
      <div class="demo-picker-intro">
        <h1>Choose your brand</h1>
        <p>Choosing a brand starts a new search and resets your answers and retailer.</p>
      </div>
      <div class="demo-picker-grid"></div>
    </div>`;

  const intro = root.querySelector('.demo-picker-intro');
  intro.prepend(button({ label: 'All car experiences', variant: 'ghost',
    href: buildEntryUrl(window.location.href, { experience: 'launcher' }) }));
  const grid = root.querySelector('.demo-picker-grid');
  PICKER_ORDER.forEach((key) => {
    const b = BRANDS[key];
    const tile = el('a');
    tile.className = 'demo-picker-tile';
    tile.style.setProperty('--tile-accent', brandAccent(key));
    tile.href = buildEntryUrl(new URL(brandChangeUrl(window.location.href, key), window.location.href), { experience: 'used-cars' });
    const plate = el('span');
    plate.className = 'demo-picker-logo';
    plate.append(logoNode(key, b.label, 'demo-picker-tile-label'));
    tile.append(plate);
    const label = el('span');
    label.className = 'demo-picker-tile-label';
    label.textContent = b.label;
    tile.append(label);
    grid.append(tile);
  });
}

function renderShell(brandKey) {
  const b = BRANDS[brandKey];
  const retailerId = BRAND_RETAILER_IDS[brandKey] || '';
  const retailerName = poolNameFor(brandKey, retailerId);

  root.innerHTML = `
    <div class="vm vm-${brandKey} demo-shell" data-brand="${brandKey}">
      <header class="demo-nav">
        <span class="demo-nav-logo"></span>
        <nav class="demo-nav-links">${linkList(b.navLinks)}</nav>
        <span class="demo-nav-spacer"></span>
        <nav class="demo-nav-experiences" aria-label="Car experiences"></nav>
        <a class="demo-nav-back" href="https://${b.origin}" target="_blank" rel="noopener">Back to the real ${esc(b.origin)}</a>
      </header>

      <section class="demo-hero" id="demo-hero">
        <div class="demo-hero-inner">
          <p class="demo-hero-kicker">${esc(b.heroKicker)}</p>
          <h1 class="demo-hero-title">${esc(b.heroTitle)}</h1>
          <p class="demo-hero-sub">${esc(b.heroSub)}</p>
          <a class="demo-cta" href="#demo-tool">${esc(b.heroCta)}</a>
        </div>
      </section>

      <section class="demo-tool" id="demo-tool">
        <div class="vehicle-matcher block" data-block-name="vehicle-matcher" data-api="${DEFAULT_API}">
          <div><div>Brand</div><div>${brandKey}</div></div>
          <div><div>Retailer ID</div><div>${esc(retailerId)}</div></div>
          <div><div>Retailer Name</div><div>${esc(retailerName)}</div></div>
          <div><div>Title</div><div>none</div></div>
        </div>
      </section>

      <footer class="demo-footer">
        <div class="demo-footer-inner">
          <nav class="demo-footer-links">${linkList(b.footerLinks)}</nav>
          <span class="demo-footer-spacer"></span>
          <p class="demo-footer-note">${esc(b.footerNote)}</p>
        </div>
      </footer>
    </div>`;

  root.querySelectorAll('.demo-nav-links a, .demo-footer-links a').forEach((link) => {
    link.addEventListener('click', (event) => event.preventDefault());
  });
  const navigation = root.querySelector('.demo-nav-experiences');
  for (const [route, label] of [['launcher', 'All car experiences'], ['brand', 'Change brand']]) {
    const link = button({ label, variant: 'ghost', href: '#' });
    link.dataset.retailRoute = route;
    navigation.append(link);
  }
  updateNavigation(window.location.href);
  root.querySelector('.demo-nav-logo').append(logoNode(brandKey, b.label, 'demo-logo-text'));

  const hero = document.getElementById('demo-hero');
  const heroUrl = `assets/brand-hero/${brandKey}.jpg`;
  const probe = new Image();
  probe.onload = () => { hero.style.backgroundImage = `url("${heroUrl}")`; };
  probe.onerror = () => { hero.classList.add('is-plain'); };
  probe.src = heroUrl;

  return root.querySelector('.vehicle-matcher');
}

function applyOverrides(block, brandKey) {
  const apiOverride = params.get('api');
  if (apiOverride) block.dataset.api = apiOverride;

  const setRow = (label, value) => {
    const row = [...block.children].find(
      (r) => r.firstElementChild?.textContent.trim().toLowerCase() === label,
    );
    if (row) row.lastElementChild.textContent = value;
  };


  const retailerOverride = params.get('retailer');
  if (retailerOverride) setRow('retailer id', retailerOverride);

  const retailerId = retailerOverride || BRAND_RETAILER_IDS[brandKey] || '';
  setRow('retailer name', params.get('retailerName') || poolNameFor(brandKey, retailerId));
}

function updateNavigation(input) {
  const launcher = root.querySelector('[data-retail-route="launcher"]');
  const picker = root.querySelector('[data-retail-route="brand"]');
  if (launcher) launcher.href = buildEntryUrl(input, { experience: 'launcher' });
  if (picker) picker.href = buildEntryUrl(new URL(brandChangeUrl(input, null), input), { experience: 'used-cars' });
}

return { renderPicker, renderShell, applyOverrides, updateNavigation };
}
