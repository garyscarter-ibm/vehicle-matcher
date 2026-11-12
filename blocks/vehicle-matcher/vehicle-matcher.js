/*
 * Vehicle Matcher: Adobe EDS block shell. Reads authored config (brand, retailer,
 * copy overrides, API base), applies the brand theme and mounts the questionnaire.
 *
 * The API base comes from an authored "API" config row on EDS, or a `data-api`
 * attribute for the local harness and Pages build, else http://localhost:8787.
 */

import { DEFAULT_MODE } from './modes/index.js';

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

// Stock pool: 'dealer' (one forecourt) or 'national'. Authored "Scope" row, ?scope= overrides;
// anything unrecognised is 'dealer'. Mirrors SCOPES in server/stock.js.
const SCOPES = ['dealer', 'national'];
const DEFAULT_SCOPE = 'dealer';

function resolveScope(block) {
  const params = new URLSearchParams(window.location.search);
  const requested = (params.get('scope') || readBlockConfig(block).scope || '')
    .trim().toLowerCase();
  return SCOPES.includes(requested) ? requested : DEFAULT_SCOPE;
}

/** Mount the questionnaire into the stage. The stage is named so a brand's CSS can lay it out. */
function startMode(mode, stage, ctx) {
  stage.replaceChildren();
  stage.dataset.mode = mode.key;
  mode.mount(stage, ctx);
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

  block.replaceChildren();
  // Base class + brand theme class ('vm-bmw' | 'vm-mini' | 'vm-ford' | …). Each
  // brand's theme (vehicle-matcher.css) overrides the design tokens under its
  // own .vm-<brand> scope; the base .vm block is the BMW-default look.
  block.classList.add('vm', `vm-${brandKey}`);

  // Config the shell resolved once; the mode hangs its own per-run UI state off this.
  const ctx = {
    api,
    retailer,
    retailerLabel,
    brand: brandKey,
    // 'dealer' | 'national': which pool every stock request asks for.
    scope,
    // Authored copy overrides (title / kicker / disclaimer) — see copyRow.
    overrides,
  };

  const stage = document.createElement('div');
  stage.className = 'vm-stage';
  block.append(stage);

  // Deliberately NOT awaited. EDS awaits every block's decorate() before it
  // reveals the page (body gains `appear`), so awaiting a network round-trip
  // here holds the WHOLE document hostage — including scrolling. Against a cold
  // backend that's 30–50s of a page that looks broken: content visible, scroll
  // dead. A mode paints its own skeleton immediately and swaps in the real
  // thing when its data lands, so decorate() returns now and lets the page
  // finish loading.
  startMode(DEFAULT_MODE, stage, ctx);
}
