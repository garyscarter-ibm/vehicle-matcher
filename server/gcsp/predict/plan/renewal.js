import { instant } from './input.js';

// Supplied calendar contract ends use the same UTC end-of-day semantics as F112.
export function renewalInstant(employee) {
  const current = employee.contract?.manualContext?.contracts?.filter((c) => c.status === 'current') ?? [];
  if (current.length > 1) return null;
  const date = (current[0] ?? employee.contract)?.contractEndDate;
  if (typeof date !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(date)) return null;
  const end = `${date}T23:59:59.999Z`;
  return instant(end) ? end : null;
}
