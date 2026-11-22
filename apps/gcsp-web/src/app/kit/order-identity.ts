export interface OrderIdentityRow { readonly label: string; readonly value: string | null }

const REFERENCE = /^[A-Za-z0-9-]{1,32}$/;

/** Exact server-supplied reference, never derived from a car's order number. */
export const orderReferenceOf = (value: unknown): string | null => typeof value === 'string' && REFERENCE.test(value) ? value : null;

export function orderIdentityRows(reference: unknown, carOrderNumber: string | null | undefined): readonly OrderIdentityRow[] {
  const orderReference = orderReferenceOf(reference);
  return [...(orderReference ? [{ label: 'Order reference', value: orderReference }] : []), { label: 'Car order number', value: carOrderNumber ?? null }];
}
