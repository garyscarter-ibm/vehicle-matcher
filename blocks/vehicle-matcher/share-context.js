/* Public retail navigation only. Build from the shell's effective context,
 * never by copying a page query (which may contain credentials/private data).
 * Keep these supported keys aligned with the retail shell and mode registry. */
export const RETAIL_BRANDS = Object.freeze(['bmw', 'mini', 'ford', 'honda', 'motorrad', 'ferrari']);
const RETAIL_MODES = ['questionnaire', 'swipe', 'head-to-head', 'podium', 'guess-who'];

function publicApi(value, page) {
  if (!value) return null;
  try {
    const api = new URL(value, page);
    if (!['http:', 'https:'].includes(api.protocol)) return null;
    // API bases identify environments, never their authentication. Endpoint
    // calls append their own paths/query, so base query/hash are not context.
    api.username = '';
    api.password = '';
    api.search = '';
    api.hash = '';
    return api.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** Preserve the host page/repository path while replacing query and hash with
 * an explicit public allowlist. `hash` is the questionnaire's public answers;
 * omitting it resets the flow without losing its retail route/environment. */
export function retailContextUrl(input, context, hash = '') {
  const url = new URL(input);
  url.username = '';
  url.password = '';
  const query = new URLSearchParams();
  query.set('experience', 'used-cars');
  query.set('brand', RETAIL_BRANDS.includes(context.brand) ? context.brand : 'bmw');
  query.set('mode', RETAIL_MODES.includes(context.mode) ? context.mode : 'questionnaire');
  if (context.retailer != null && context.retailer !== '') query.set('retailer', context.retailer);
  if (context.retailerLabel) query.set('retailerName', context.retailerLabel);
  query.set('scope', context.scope === 'national' ? 'national' : 'dealer');
  const api = publicApi(context.api, url);
  if (api) query.set('api', api);
  url.search = query.toString();
  url.hash = hash;
  return url.href;
}
