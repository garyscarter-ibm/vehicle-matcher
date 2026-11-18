/*
 * Headless DOM harness for the client modes (render.test.js).
 *
 * The server-side tests (api/engine/brand) prove the engine and the HTTP
 * contract. This harness closes the last gap: it actually MOUNTS each interface
 * mode (questionnaire / swipe / knockout) in a real DOM and asserts it paints, per
 * brand — so a client render regression (a mode that throws on mount, or paints
 * nothing for a new brand) is caught by CI, not by eyeballing the browser.
 *
 * How it stays honest:
 *  - The modes talk to the engine over HTTP. We stand up a real buildServer()
 *    on an ephemeral port with an injected stock source (the same seam api.test
 *    uses), so a mode exercises the true endpoints and the true engine. Only the
 *    live feed is faked; everything downstream is production code.
 *  - The DOM is jsdom. We import the mode's ES module directly and call its
 *    mount(root, ctx) exactly as the shell does. `fetch` stays Node's real
 *    global (the modes call it against our server); jsdom supplies document /
 *    window / the handful of browser APIs the modes touch (matchMedia, share,
 *    clipboard), shimmed below so a mount can't crash on a missing global.
 *
 * A mode's mount() is fire-and-forget: it paints a skeleton now and swaps in
 * real content after an async boot(). settle() waits for that boot to land.
 */

import { once } from 'node:events';
import { JSDOM } from 'jsdom';

import { buildServer } from '../index.js';

const BLOCK_DIR = new URL('../../blocks/vehicle-matcher/', import.meta.url);

/**
 * Stand up jsdom and install the browser globals the modes reach for. Idempotent
 * per process is not required — each test gets a fresh document via reset() —
 * but the window/global wiring is done once so module-level `document` captures
 * in the modes resolve. Returns the JSDOM instance.
 */
export function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.test/',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // The modes gate motion on prefers-reduced-motion via matchMedia; jsdom has
  // no media engine, so shim a matcher that reports "no match" (motion allowed)
  // and supports the add/removeEventListener the modes may attach.
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() { return false; },
    });
  }

  // Web Share + clipboard are used by the result CTAs. Neither should fire in a
  // render test, but their presence must not throw when a mode feature-detects
  // them. Provide inert stubs.
  if (!window.navigator.share) {
    window.navigator.share = async () => {};
  }
  if (!window.navigator.clipboard) {
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: async () => {} },
      configurable: true,
    });
  }

  // Expose the DOM globals the modes read as bare identifiers. Some (navigator)
  // are read-only getters on the Node global in newer runtimes, so define rather
  // than assign; a plain assignment throws. The modes mostly reach these through
  // `window.` anyway, so the bare-global copies are belt-and-braces.
  const define = (name, value) => {
    try {
      Object.defineProperty(global, name, { value, configurable: true, writable: true });
    } catch {
      /* getter-only and non-configurable: the module uses window.<name> instead */
    }
  };
  define('window', window);
  define('document', window.document);
  define('navigator', window.navigator);
  define('HTMLElement', window.HTMLElement);
  define('Node', window.Node);
  // requestAnimationFrame is used by some entrance animations; map to a timer.
  if (!global.requestAnimationFrame) {
    global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
    global.cancelAnimationFrame = (id) => clearTimeout(id);
  }

  return dom;
}

/** Fresh, empty <body> for the next mount so tests don't bleed into each other. */
export function resetDom() {
  document.body.replaceChildren();
}

/**
 * Spin up a server whose stock is a caller-supplied per-brand pool (mapped car
 * objects — i.e. exactly what fetchRetailerStock returns). Returns
 * { base, stockCalls, close }. Nearby + colour are inert (empty / pass-through)
 * so a mode's optional sections simply don't appear, which is the honest
 * fixtures-brand behaviour.
 *
 * `stockCalls` logs the (brand, retailer, scope) of every pool read the mounted
 * modes caused, AS RESOLVED BY THE SERVER. It is how a test asserts something a
 * painted screen cannot show: that the mode asked about the right stock. The log
 * is per-server and cumulative, so a test that reads it should start its own
 * server rather than share the suite's.
 */
export async function startModeServer(poolsByBrand) {
  const stockCalls = [];
  const fetchRetailerStock = async (brand, retailer, scope) => {
    stockCalls.push({ brand, retailer, scope });
    return poolsByBrand[brand] || poolsByBrand.bmw || [];
  };
  const fetchNearbyStock = async () => [];
  const enrichColours = async (_brand, cars = []) => cars;
  // Location is inert for the same reason: both real implementations call someone
  // else's server (a ~2MB dealer directory, and postcodes.io), and /api/pool asks
  // for the directory on every request. An empty directory means the pool ships
  // null site coordinates and Guess Who's distance filter self-suppresses, which
  // is a state the mode is built to handle.
  const fetchDealerDirectory = async () => new Map();
  const geocodePostcode = async () => null;
  const server = buildServer({
    fetchRetailerStock, fetchNearbyStock, enrichColours, fetchDealerDirectory, geocodePostcode,
  });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    stockCalls,
    async close() {
      server.close();
      await once(server, 'close');
    },
  };
}

/** Dynamically import a mode module by key (questionnaire | mingle | knockout). */
export async function loadMode(key) {
  const mod = await import(new URL(`modes/${key}.js`, BLOCK_DIR));
  return mod.default;
}

/**
 * Mount a mode into a fresh stage against `base`, for `brand`. Returns the stage
 * element (already appended to the body) so the caller can assert on it after
 * settle().
 *
 * `scope` is left undefined unless a test asks for one, which is the shape of a
 * page with no ?scope= — so the default path every other render test exercises is
 * the one a real embed takes, right down to the server resolving the default.
 */
export function mountMode(mode, { base, brand, retailer, scope } = {}) {
  const stage = document.createElement('div');
  stage.className = `vm vm-${brand}`;
  document.body.append(stage);
  const ctx = {
    api: base,
    retailer: retailer || null,
    retailerLabel: 'Test Retailer',
    brand,
    scope,
    overrides: {},
  };
  mode.mount(stage, ctx);
  return stage;
}

/**
 * Wait for a mode's async boot to paint real content. Polls `predicate(stage)`
 * every 15ms up to `timeout`, letting microtasks + timers (fetch, rAF) flush
 * between checks. Resolves true once satisfied; rejects on timeout with the
 * stage's current text so a failure is diagnosable.
 */
export async function settle(stage, predicate, { timeout = 4000 } = {}) {
  const deadline = Date.now() + timeout;
  // eslint-disable-next-line no-await-in-loop
  while (Date.now() < deadline) {
    if (predicate(stage)) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(
    `settle() timed out after ${timeout}ms. Stage text was:\n${stage.textContent?.slice(0, 400)}`,
  );
}
