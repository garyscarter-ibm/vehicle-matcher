// The one car display-name rule (FUCQ-279): "BMW " plus the displayLabels model template, {engine} filled in.
export const DISPLAY_LABELS_KEY = 'policy.displayLabels.v1';
const BRAND = 'BMW';
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const tidy = (v) => v.replaceAll(/\s+/g, ' ').trim();

/** Name for a model key such as "G21 Touring|320i" (or a bare model line): the template, else the plain `fallback` name, else null.
 * A template that opens with {engine} needs it; without the engine the fallback is used. */
export function carDisplayName(models, modelKey, fallback) {
  const [line, ...rest] = String(modelKey ?? '').split('|');
  const engine = tidy(rest.join('|'));
  const template = models && Object.hasOwn(models, line) && text(models[line]) ? models[line] : null;
  let base = null;
  if (template && (engine || !template.startsWith('{engine}'))) base = tidy(template.replaceAll('{engine}', engine));
  else if (text(fallback)) base = tidy(fallback);
  if (!base) return null;
  return base.startsWith(`${BRAND} `) ? base : `${BRAND} ${base}`;
}

/** Reads the model templates through PolicyService once; returns (modelKey, fallback) => name or null. Unavailable policy leaves only fallbacks. */
export async function readCarNamer(policy, read) {
  let models = {};
  try {
    const row = await policy?.getAssumption(DISPLAY_LABELS_KEY, read);
    if (row?.status === 'ok' && row.value?.key === DISPLAY_LABELS_KEY && row.value.value?.models) models = row.value.value.models;
  } catch { /* names fall back to the plain model-line name */ }
  return (modelKey, fallback) => carDisplayName(models, modelKey, fallback);
}
