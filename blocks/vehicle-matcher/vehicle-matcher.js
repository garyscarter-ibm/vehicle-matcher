/*
 * Vehicle Matcher — Adobe Edge Delivery Services (EDS) block. The shell.
 *
 * A brand-agnostic matcher: the brand (BMW, MINI, …) is authored config, not
 * baked in. This file is the SHELL around one or more interchangeable interface
 * "modes" (see modes/) that all drive the same engine (server/, via engine.js):
 *
 *   - It reads authored block config (brand, retailer, copy overrides, API base).
 *   - It applies the brand theme and builds the mode switcher + a stage element.
 *   - It picks which mode to mount:
 *       • a "Mode" config row (or ?mode=) locks the block to one interface and
 *         hides the switcher — the production case, one interface per page;
 *       • with no lock, every registered mode gets a switcher tab and the
 *         visitor can flip between them — the showcase case.
 *
 * The shell knows nothing about any mode's internals: a mode is just
 * { key, label, mount(root, ctx) }. Adding an interface touches modes/, not here.
 *
 * The API base comes from an authored "API" config row when running on EDS
 * (authored content can set config rows but not HTML attributes), or from a
 * `data-api` attribute for the local harness and the GitHub Pages build,
 * falling back to http://localhost:8787 for local preview. See apiBase.
 */

import { MODES, DEFAULT_MODE, modeByKey } from './modes/index.js';
import { renderRrmcIntro } from './modes/rrmc-intro.js';

const DEFAULT_API = 'http://localhost:8787';

/**
 * API base for this block, in precedence order:
 *   1. the `data-api` attribute — the local harness and the Pages build set
 *      it (the harness's ?api= override writes here too), so a query override
 *      always wins;
 *   2. an authored "API" config row — the EDS path, because authored content
 *      can produce config rows but not HTML attributes;
 *   3. the localhost default, for `npm run serve`.
 * Trailing slashes are trimmed so `${base}/api/...` never doubles up. An empty
 * or absent row is falsy and simply falls through.
 */
function apiBase(block) {
  const authored = readBlockConfig(block).api;
  return (block.dataset.api || authored || DEFAULT_API).replace(/\/+$/, '');
}

/**
 * Read authored block config the standard EDS way: each row below the block
 * name becomes a child `<div>` with two nested `<div>` cells (key, value).
 * See aem-boilerplate's `readBlockConfig()` — same shape, same convention,
 * so a page author sets config in their DA table, not in code.
 */
function readBlockConfig(block) {
  const config = {};
  [...block.children].forEach((row) => {
    const cols = [...row.children];
    if (cols.length < 2) return;
    const key = cols[0].textContent.trim().toLowerCase().replace(/\s+/g, '-');
    if (!key) return;
    config[key] = cols[1].textContent.trim();
  });
  return config;
}

/** Retailer site ID for this block instance: authored "Retailer ID" config
 * row, else undefined (the server falls back to its own default). */
function retailerSite(block) {
  const config = readBlockConfig(block);
  return config['retailer-id'] || config['retailer-site'] || undefined;
}

/**
 * An authored copy override, with three distinct states:
 *   undefined — no row authored, so the block's own default is used;
 *   null      — row authored but blank (or "none"), so the line is SUPPRESSED;
 *   string    — the authored replacement.
 *
 * Suppression is the point: on a real retailer's page the block is usually
 * placed under the site's own section heading, and repeating a title inside
 * the block reads as a stutter. The same mechanism lets a dealer drop the
 * "unofficial" framing, which is right for a public demo and wrong on their
 * own site.
 */
function copyRow(config, key) {
  if (!(key in config)) return undefined;
  const value = config[key].trim();
  return (!value || value.toLowerCase() === 'none') ? null : value;
}

/** The authored copy overrides: `title`, `kicker`, `disclaimer`. */
function copyOverrides(block) {
  const config = readBlockConfig(block);
  return {
    title: copyRow(config, 'title'),
    kicker: copyRow(config, 'kicker'),
    disclaimer: copyRow(config, 'disclaimer'),
  };
}

const DEFAULT_RETAILER_NAME = 'our retailer network';

/** Display name for the pool this block searched: authored "Retailer Name"
 * config row. Required alongside Retailer ID so the copy can name where the
 * stock actually came from — which is a question of Scope, and the reason the
 * two rows have to be authored together. At dealer scope the pool IS the branch,
 * so this is its name ("Grassicks Garage"). At national scope stock.js walks the
 * whole feed, so no branch is the truthful answer: name the programme instead
 * ("BMW Approved Used") and let each car's own card name the dealer holding it.
 * Falls back to a generic phrase (and warns) if the page author forgot to set
 * it. */
function retailerName(block) {
  const config = readBlockConfig(block);
  const name = config['retailer-name'];
  if (!name) {
    console.warn('[vehicle-matcher] No "Retailer Name" config row set — add one alongside "Retailer ID". Falling back to generic copy.');
    return DEFAULT_RETAILER_NAME;
  }
  return name;
}

/** The brand keys this block knows how to theme. The server registry
 * (server/brands.js) is the source of truth for behaviour; this list is the
 * client mirror the shell needs to pick a theme class and reject typos. Keep it
 * in step when a brand is onboarded — one line per brand, no other client edit.
 * DEFAULT_BRAND is the fallback when no (or an unknown) "Brand" row is set. */
const KNOWN_BRANDS = ['bmw', 'mini', 'ford', 'honda', 'motorrad', 'ferrari', 'rrmc'];
const DEFAULT_BRAND = 'bmw';

/** Brand for this block instance: authored "Brand" config row, lower-cased,
 * validated against KNOWN_BRANDS. Defaults to bmw. Drives both the visual theme
 * (a body class) and which live feed the server queries. Brand is authored data,
 * not baked in — the app is brand-agnostic; bmw is just the default when no row
 * is set or the row names a brand the block doesn't know. */
function brand(block) {
  const config = readBlockConfig(block);
  const b = (config.brand || '').toLowerCase();
  return KNOWN_BRANDS.includes(b) ? b : DEFAULT_BRAND;
}

/**
 * Which stock pool this block searches:
 *   - 'dealer'   — the Retailer ID's own forecourt;
 *   - 'national' — every retailer of the brand.
 * An authored "Scope" config row, overridable with ?scope= (like ?mode=) so one
 * deployed page can demo both. Anything absent, blank or unrecognised is
 * 'dealer', because a block authored onto one retailer's page must never
 * silently answer for the whole country — of the two ways to get this wrong,
 * offering a user only the cars they can actually go and see is the safe one.
 *
 * Only BMW and MINI have two pools to choose between; the fixtures-backed brands
 * serve their one file whatever this says. Mirrors SCOPES/normalizeScope in
 * server/stock.js, which validates the value again on arrival — the client copy
 * exists so the Retailer Name row can be authored to match (see retailerName).
 */
const SCOPES = ['dealer', 'national'];
const DEFAULT_SCOPE = 'dealer';

function resolveScope(block) {
  const params = new URLSearchParams(window.location.search);
  const requested = (params.get('scope') || readBlockConfig(block).scope || '')
    .trim().toLowerCase();
  return SCOPES.includes(requested) ? requested : DEFAULT_SCOPE;
}

/**
 * Which interface mode to run, and whether the switcher is shown:
 *   - an authored "Mode" config row, or a ?mode= query override, LOCKS the
 *     block to that mode (switcher hidden) — the production case;
 *   - anything absent/blank/unrecognised leaves it unlocked (switcher shown,
 *     defaulting to DEFAULT_MODE) — the showcase case.
 * ?mode= wins over the authored row so a single deployed page can demo any mode
 * by URL. Returns { mode, locked }.
 */
function resolveMode(block) {
  const params = new URLSearchParams(window.location.search);
  const requested = (params.get('mode') || readBlockConfig(block).mode || '').toLowerCase();
  const locked = modeByKey(requested);
  return locked ? { mode: locked, locked: true } : { mode: DEFAULT_MODE, locked: false };
}

/**
 * The mode switcher: a compact dropdown, not a row of tabs, so it never
 * competes with a mode's own header for screen space (podium in particular
 * reclaims that space for its own title/progress — see vm-podium-head in
 * vehicle-matcher.css). Only rendered when the block is unlocked and there's
 * more than one mode to choose between — a single mode needs no switch.
 */
const BRAND_DISABLED_MODES = { rrmc: ['swipe'] };
const BRAND_DEFAULT_MODES = { rrmc: 'podium' };

/** Mount `mode` into the stage. RRMC opens every mode with the questionnaire's intro (which owns its own). */
function startMode(mode, stage, ctx) {
  stage.replaceChildren();
  // Named on the stage so a brand's CSS can lay a mode out (intro included) without reaching into it.
  stage.dataset.mode = mode.key;
  delete stage.dataset.intro;
  if (ctx.brand !== 'rrmc' || mode.key === 'questionnaire') {
    mode.mount(stage, ctx);
    return;
  }
  // Flagged while the intro shows, so podium's opening screen can be laid out apart from podium.
  stage.dataset.intro = '';
  renderRrmcIntro(stage, ctx, () => {
    delete stage.dataset.intro;
    stage.replaceChildren();
    mode.mount(stage, ctx);
  }, { progress: true });
}

function renderSwitcher(block, stage, ctx, current) {
  const disabled = BRAND_DISABLED_MODES[ctx.brand] || [];
  const modes = MODES.filter((m) => !disabled.includes(m.key));
  if (modes.length < 2) return null;
  const bar = document.createElement('div');
  bar.className = 'vm-switcher';

  const select = document.createElement('select');
  select.className = 'vm-switcher-select';
  select.setAttribute('aria-label', 'Matching interface');
  modes.forEach((mode) => {
    const option = document.createElement('option');
    option.value = mode.key;
    option.textContent = mode.label;
    select.append(option);
  });
  select.value = current.key;

  select.addEventListener('change', () => {
    const next = modeByKey(select.value);
    if (!next) return;
    startMode(next, stage, ctx);
  });

  bar.append(select);
  return bar;
}

export default async function decorate(block) {
  // Read authored config before clearing the block's children — the config
  // rows live in the block's original markup.
  const retailer = retailerSite(block);
  const retailerLabel = retailerName(block);
  const api = apiBase(block);
  const brandKey = brand(block);
  const overrides = copyOverrides(block);
  const scope = resolveScope(block);
  const { mode: resolvedMode, locked } = resolveMode(block);
  const mode = !locked && BRAND_DEFAULT_MODES[brandKey]
    ? (modeByKey(BRAND_DEFAULT_MODES[brandKey]) || resolvedMode)
    : resolvedMode;

  block.replaceChildren();
  // Base class + brand theme class ('vm-bmw' | 'vm-mini' | 'vm-ford' | …). Each
  // brand's theme (vehicle-matcher.css) overrides the design tokens under its
  // own .vm-<brand> scope; the base .vm block is the BMW-default look.
  block.classList.add('vm', `vm-${brandKey}`);

  // The context every mode receives. Config the shell resolved once; each mode
  // hangs its own per-run UI state (answers, questions, preview…) off this.
  const ctx = {
    api,
    retailer,
    retailerLabel,
    brand: brandKey,
    // 'dealer' | 'national' — which pool every stock request asks for. Sent on
    // each call rather than read once, so a mode swap can't leave two modes
    // disagreeing about it.
    scope,
    // Authored copy overrides (title / kicker / disclaimer) — see copyRow.
    overrides,
  };

  // The stage the active mode renders into — its own element so a switcher can
  // sit above it and survive a mode swap (a mode may replaceChildren() the
  // stage, but never the block).
  const stage = document.createElement('div');
  stage.className = 'vm-stage';

  // Unlocked: offer the switcher above the stage. Locked (authored Mode row or
  // ?mode=): mount that one mode with no switcher, so a production page looks
  // exactly as it did before modes existed.
  if (!locked) {
    const switcher = renderSwitcher(block, stage, ctx, mode);
    if (switcher) block.append(switcher);
  }
  block.append(stage);

  // Deliberately NOT awaited. EDS awaits every block's decorate() before it
  // reveals the page (body gains `appear`), so awaiting a network round-trip
  // here holds the WHOLE document hostage — including scrolling. Against a cold
  // backend that's 30–50s of a page that looks broken: content visible, scroll
  // dead. A mode paints its own skeleton immediately and swaps in the real
  // thing when its data lands, so decorate() returns now and lets the page
  // finish loading.
  startMode(mode, stage, ctx);
}
