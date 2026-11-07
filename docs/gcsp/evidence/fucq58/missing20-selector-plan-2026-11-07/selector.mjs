import { createHash } from 'node:crypto';

export function projectSelector(html, maximumLeads = 128, maximumOccurrences = 256) {
  if (typeof html !== 'string' || Buffer.byteLength(html) > 2097152) throw new Error('selector-input-limit');
  const pattern = /https:\/\/configure\.bmw\.co\.uk\/en_GB\/configure\/([A-Z0-9]{2,12})\/([A-Z0-9]{2,12})(?=["'\s<>]|$)/g;
  const leads = new Map(); let match; let occurrences = 0;
  while ((match = pattern.exec(html)) !== null) {
    if (++occurrences > maximumOccurrences) throw new Error('selector-occurrence-limit');
    const [url, catalogueRangeKey, pageModelCode] = match;
    if (!leads.has(url)) {
      if (leads.size >= maximumLeads) throw new Error('selector-lead-limit');
      leads.set(url, { url, catalogueRangeKey, pageModelCode, occurrences: [] });
    }
    leads.get(url).occurrences.push({ characterOffset: match.index, literalCharacters: url.length });
  }
  return {
    schemaVersion: 'bmw-uk-literal-selector-projection.v1',
    responseSha256: createHash('sha256').update(html).digest('hex'),
    responseBytes: Buffer.byteLength(html), literalOccurrences: occurrences,
    leads: [...leads.values()],
    status: leads.size ? 'literal-configurator-leads-observed' : 'no-literal-configurator-leads-in-this-response',
    modelRegistrationsQualified: 0, schemeJoinsQualified: 0, configurationsAdmitted: 0,
    physicalProfileFactsQualified: 0, acceptance: false,
  };
}
