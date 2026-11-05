// SYNTHETIC fixtures for the employee shell: no real person or account data.

export const FIXTURE_NAMES = Object.freeze(['representative']);

export const REPRESENTATIVE_ACCOUNT = Object.freeze({
  status: 'ready',
  name: 'Alex Morgan-Whitfield (synthetic)',
  context: 'Choices, grade G7',
});

/** Adapter for the named fixture, or null when the name is unknown. */
export function fixtureAdapter(name) {
  if (name !== 'representative') return null;
  return {
    loadAccount: ({ signal } = {}) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ ...REPRESENTATIVE_ACCOUNT }), 400);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }),
  };
}
