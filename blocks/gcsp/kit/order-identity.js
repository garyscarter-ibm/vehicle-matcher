// FUCQ-220: the generated order reference and the car's own order number, always under these two labels.
const REFERENCE = /^[A-Za-z0-9-]{1,32}$/;

/** The reference exactly as the server sent it, or null when absent or malformed. Never derived here. */
export const orderReferenceOf = (value) => (typeof value === 'string' && REFERENCE.test(value) ? value : null);

/** `factList` rows: the reference only when one exists (earlier orders have none), then the car order number. */
export function orderIdentityRows(orderReference, carOrderNumber) {
  const reference = orderReferenceOf(orderReference);
  return [...(reference ? [{ label: 'Order reference', value: reference }] : []), { label: 'Car order number', value: carOrderNumber ?? null }];
}
