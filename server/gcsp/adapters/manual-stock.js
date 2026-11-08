// Local cart holds send nothing upstream. The shared repository is their authority.
// A future remote adapter implements execute/reconcile using the persisted operation ID.
// It must acknowledge confirmed/rejected, or leave uncertainty pending. No credentials
// or operational provider are inferred from a missing adapter.
export function createSyntheticManualStockAdapter() {
  return Object.freeze({ mode: 'local-synthetic' });
}
