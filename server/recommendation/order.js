// Deterministic ordering helpers. Pure: no imports, no I/O.

/** Combine comparators: the first non-zero result wins, else 0 (NaN falls through). */
export const compareBy = (...comparators) => (a, b) => {
  for (const compare of comparators) {
    const result = compare(a, b);
    if (result) return result;
  }
  return 0;
};

/** Largest first, by a numeric key. */
export const descending = (get) => (a, b) => get(b) - get(a);

/** Smallest first, by a numeric key. */
export const ascending = (get) => (a, b) => get(a) - get(b);

/** Locale order, by a string key. */
export const byLocale = (get) => (a, b) => get(a).localeCompare(get(b));
