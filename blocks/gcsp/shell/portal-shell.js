// GCSP portal shell: header with account context, icon navigation, breadcrumbs, main.
// Built with el() and createElementNS, never innerHTML.
import { el } from '../../vehicle-matcher/ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_REASON = 'Not available in this demo';
const LOGO = (name) => new URL(`../../../assets/brand-logos/${name}.svg`, import.meta.url).href;
const CHEVRON = ['M9 6l6 6-6 6'];
const MENU = ['M4 7h16', 'M4 12h16', 'M4 17h16'];
let uid = 0;

/** A 24px stroke icon from path data strings. Decorative: the label is the name. */
export function svgIcon(paths = [], className = 'gcsp-icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

/**
 * Narrow icon navigation. Items: { key, label, icon, available, unavailableReason }.
 * Returns { root, setActive(key), setExpanded(bool), destroy() }.
 */
export function accountNavigation({ items = [], active = null, expanded = false, onNavigate, onToggle } = {}) {
  const id = `gcsp-nav-${++uid}`;
  const root = el('nav', 'gcsp-nav');
  root.id = id;
  root.setAttribute('aria-label', 'Portal');
  const list = el('ul', 'gcsp-nav-list');
  const buttons = new Map();

  for (const item of items) {
    const li = el('li', 'gcsp-nav-item');
    const btn = el('button', 'gcsp-nav-btn');
    btn.type = 'button';
    btn.dataset.key = item.key;
    btn.append(svgIcon(item.icon), el('span', 'gcsp-nav-label', item.label));
    const tip = el('span', 'gcsp-nav-tip');
    tip.setAttribute('aria-hidden', 'true');
    if (item.available === false) {
      tip.append(el('span', 'gcsp-nav-tip-label', `${item.label}: `));
      const reason = el('span', 'gcsp-nav-tip-reason', item.unavailableReason || DEFAULT_REASON);
      reason.id = `${id}-${item.key}-reason`;
      tip.append(reason);
      btn.setAttribute('aria-disabled', 'true');
      btn.setAttribute('aria-describedby', reason.id);
    } else {
      tip.classList.add('gcsp-nav-tip-available');
      tip.append(el('span', 'gcsp-nav-tip-label', item.label));
    }
    li.append(btn, tip);
    list.append(li);
    buttons.set(item.key, btn);
  }

  const toggle = el('button', 'gcsp-nav-toggle');
  toggle.type = 'button';
  const toggleLabel = el('span', 'gcsp-nav-label');
  toggle.append(svgIcon(CHEVRON), toggleLabel);
  root.append(list, toggle);

  function setActive(key) {
    for (const [k, btn] of buttons) {
      if (k === key && btn.getAttribute('aria-disabled') !== 'true') btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
  }
  function setExpanded(next) {
    const on = Boolean(next);
    root.dataset.expanded = String(on);
    toggle.setAttribute('aria-expanded', String(on));
    toggle.title = on ? 'Hide labels' : 'Show labels';
    toggleLabel.textContent = toggle.title;
  }

  const onClick = (event) => {
    const target = event.target.closest?.('button');
    if (!target || !root.contains(target)) return;
    if (target === toggle) {
      setExpanded(root.dataset.expanded !== 'true');
      onToggle?.(root.dataset.expanded === 'true');
    } else if (target.dataset.key && target.getAttribute('aria-disabled') !== 'true') {
      onNavigate?.(target.dataset.key);
    }
  };
  root.addEventListener('click', onClick);
  setExpanded(expanded);
  setActive(active);

  return {
    root,
    setActive,
    setExpanded,
    destroy() {
      root.removeEventListener('click', onClick);
      root.remove();
    },
  };
}

function initialsOf(name) {
  const words = String(name).replace(/\(.*?\)/g, ' ').split(/[\s-]+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function accountContent(state, retryButton) {
  const status = state?.status;
  if (status === 'ready' && state.name) {
    const text = el('span', 'gcsp-account-text');
    const name = el('span', 'gcsp-account-name', state.name);
    name.title = state.name;
    text.append(name);
    if (state.context) text.append(el('span', 'gcsp-account-context', state.context));
    return {
      label: `Account: ${state.name}`,
      busy: false,
      nodes: [el('span', 'gcsp-avatar', state.initials || initialsOf(state.name)), text],
    };
  }
  if (status === 'unavailable' || status === 'ready') {
    const message = (status === 'unavailable' && state.message) || 'Your account could not be loaded.';
    return {
      label: 'Account unavailable',
      busy: false,
      nodes: [el('span', 'gcsp-account-unavailable', message), retryButton],
    };
  }
  const nodes = [el('span', 'gcsp-skel gcsp-skel-avatar'), el('span', 'gcsp-skel gcsp-skel-name')];
  const vh = el('span', 'gcsp-vh', 'Loading your account');
  return { label: 'Loading your account', busy: true, nodes: [...nodes, vh] };
}

/**
 * The shell. Returns { root, main, setAccount, setActive, setBreadcrumbs, destroy }.
 * navigation is an item list for accountNavigation; onNavigate(key) is called for available items only.
 */
export function portalShell({
  title = 'Group Car Schemes Portal', account = { status: 'loading' }, navigation = [], active = null,
  breadcrumbs = [], onNavigate, onRetryAccount,
} = {}) {
  const id = `gcsp-shell-${++uid}`;
  const mainId = `${id}-main`;
  const root = el('div', 'gcsp');

  const skip = el('a', 'gcsp-skip', 'Skip to content');
  skip.href = `#${mainId}`;

  const header = el('header', 'gcsp-header');
  const menuToggle = el('button', 'gcsp-menu-toggle');
  menuToggle.type = 'button';
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Menu');
  menuToggle.append(svgIcon(MENU));
  const marks = el('div', 'gcsp-marks');
  for (const [name, alt] of [['bmw', 'BMW'], ['mini', 'MINI']]) {
    const img = el('img', `gcsp-mark gcsp-mark-${name}`);
    img.src = LOGO(name);
    img.alt = alt;
    marks.append(img);
  }
  const accountBox = el('div', 'gcsp-account');
  accountBox.setAttribute('role', 'group');
  accountBox.setAttribute('aria-live', 'polite');
  header.append(menuToggle, marks, el('div', 'gcsp-title', title), accountBox);

  const nav = accountNavigation({
    items: navigation,
    active,
    onNavigate: (key) => {
      closeMenu();
      onNavigate?.(key);
    },
  });
  menuToggle.setAttribute('aria-controls', nav.root.id);

  const content = el('div', 'gcsp-content');
  const crumbsHost = el('div', 'gcsp-crumbs-host');
  const main = el('main', 'gcsp-main');
  main.id = mainId;
  main.tabIndex = -1;
  content.append(crumbsHost, main);
  root.append(skip, header, el('div', 'gcsp-body'));
  root.lastChild.append(nav.root, content);

  function closeMenu() {
    root.classList.remove('gcsp-menu-open');
    menuToggle.setAttribute('aria-expanded', 'false');
  }
  const onMenuClick = () => {
    const open = !root.classList.contains('gcsp-menu-open');
    root.classList.toggle('gcsp-menu-open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
  };
  const onKeydown = (event) => {
    if (event.key === 'Escape' && root.classList.contains('gcsp-menu-open')) {
      closeMenu();
      menuToggle.focus();
    }
  };
  const onSkip = (event) => {
    event.preventDefault();
    main.focus();
  };
  const onAccountClick = (event) => {
    if (event.target.closest?.('.gcsp-account-retry')) onRetryAccount?.();
  };
  menuToggle.addEventListener('click', onMenuClick);
  root.addEventListener('keydown', onKeydown);
  skip.addEventListener('click', onSkip);
  accountBox.addEventListener('click', onAccountClick);

  function setAccount(state) {
    const retry = el('button', 'gcsp-account-retry', 'Retry');
    retry.type = 'button';
    const view = accountContent(state, retry);
    accountBox.setAttribute('aria-label', view.label);
    accountBox.setAttribute('aria-busy', String(view.busy));
    accountBox.dataset.status = view.busy ? 'loading' : (view.label.startsWith('Account:') ? 'ready' : 'unavailable');
    accountBox.replaceChildren(...view.nodes);
  }

  function setBreadcrumbs(list = []) {
    const labels = list.map((c) => (typeof c === 'string' ? c : c?.label)).filter(Boolean);
    if (!labels.length) {
      crumbsHost.replaceChildren();
      return;
    }
    const navEl = el('nav', 'gcsp-crumbs');
    navEl.setAttribute('aria-label', 'Breadcrumb');
    const ol = el('ol', 'gcsp-crumb-list');
    labels.forEach((label, i) => {
      const li = el('li', 'gcsp-crumb', label);
      if (i === labels.length - 1) li.setAttribute('aria-current', 'page');
      ol.append(li);
    });
    navEl.append(ol);
    crumbsHost.replaceChildren(navEl);
  }

  setAccount(account);
  setBreadcrumbs(breadcrumbs);

  return {
    root,
    main,
    setAccount,
    setActive: (key) => nav.setActive(key),
    setBreadcrumbs,
    destroy() {
      menuToggle.removeEventListener('click', onMenuClick);
      root.removeEventListener('keydown', onKeydown);
      skip.removeEventListener('click', onSkip);
      accountBox.removeEventListener('click', onAccountClick);
      nav.destroy();
      root.remove();
    },
  };
}
