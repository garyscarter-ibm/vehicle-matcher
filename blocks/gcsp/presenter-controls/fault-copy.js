// Plain presenter wording for synthetic adapter faults; unknown ids fall back to the id with spaces.
const ADAPTERS = { stock: 'Stock feed fault', ordering: 'Ordering fault' };
const MODES = { none: 'No fault', 'stock:unavailable': 'Stock feed unavailable', 'stock:stale': 'Stock feed stale',
  'ordering:timeout-acknowledged': 'Next handoff times out, provider accepted',
  'ordering:timeout-rejected': 'Next handoff times out, provider refused',
  'ordering:uncertain-acknowledged': 'Next handoff uncertain, provider accepted',
  'ordering:uncertain-rejected': 'Next handoff uncertain, provider refused' };
const spaced = (id) => String(id).replace(/-/g, ' ');

export const adapterLabel = (adapter) => ADAPTERS[adapter] || `${spaced(adapter)} fault`;
export const modeLabel = (adapter, mode) => MODES[mode === 'none' ? 'none' : `${adapter}:${mode}`] || spaced(mode);
export const faultChange = (adapter, mode) => (mode === 'none' ? `${adapterLabel(adapter)} cleared`
  : `${adapterLabel(adapter)} set: ${modeLabel(adapter, mode)}`);
