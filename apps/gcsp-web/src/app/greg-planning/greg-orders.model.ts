import { record, text, validProduction, versionPins } from './planning.projection';
export interface GregOrderRequest {
  readonly requestId: string; readonly model: string; readonly derivative: string; readonly version: number;
  readonly quantity: number; readonly confirmedQuantity: number; readonly releasedQuantity: number; readonly outstandingQuantity: number;
  readonly stage: string; readonly message: string | null; readonly reason: string | null; readonly delayUntil: string | null;
  readonly supplies: readonly { readonly quantity: number; readonly queued: boolean; readonly eligibleFrom: string | null }[];
}
export interface GregOrders {
  readonly asOf: string; readonly providerStatus: string; readonly providerMode: string;
  readonly choices: readonly { readonly model: string; readonly derivative: string }[];
  readonly versions: Readonly<Record<string, string>> | null; readonly requests: readonly GregOrderRequest[];
}
export interface ManualOrderCommand {
  readonly commandId: string; readonly model: string; readonly derivative: string; readonly quantity: number;
  readonly expectedPolicyVersion: string; readonly expectedStockVersion: string;
}
export type GregOrderCommand = { readonly kind: 'manual'; readonly input: ManualOrderCommand }
  | { readonly kind: 'queue'; readonly input: { readonly commandId: string; readonly requestId: string } };
export function parseGregOrders(value: unknown, versionsRequired = false): GregOrders | null {
  if (!validProduction(value) || !text(value.provider['mode']) || !text(value.provider['status'])
    || !Array.isArray(value.provider['choices']) || !value.provider['choices'].every(c => record(c) && text(c['model']) && text(c['derivative']))
    || !value.requests.every(r => Number.isSafeInteger(r['version']) && (r['version'] as number) > 0
      && (r['delayUntil'] === null || text(r['delayUntil'])) && (r['reason'] === null || text(r['reason'])))) return null;
  const versions = versionPins(value['versions']) && text(value['versions']['policy']) && text(value['versions']['stock']) ? { ...value['versions'] } : null;
  if (versionsRequired && !versions) return null;
  return { asOf: value.asOf, providerMode: value.provider['mode'], providerStatus: value.provider['status'], versions,
    choices: value.provider['choices'].map(c => ({ model: c['model'], derivative: c['derivative'] })),
    requests: value.requests.map(r => ({ requestId: r['requestId'] as string, model: r['model'] as string, derivative: r['derivative'] as string,
      version: r['version'] as number, quantity: r['quantity'] as number, confirmedQuantity: r['confirmedQuantity'] as number,
      releasedQuantity: r['releasedQuantity'] as number, outstandingQuantity: r['outstandingQuantity'] as number,
      stage: r['stage'] as string, message: text(r['message']) ? r['message'] : null, reason: r['reason'] as string | null, delayUntil: r['delayUntil'] as string | null,
      supplies: (r['supplies'] as Record<string, unknown>[]).map(q => ({ quantity: q['quantity'] as number, queued: q['queued'] as boolean, eligibleFrom: q['eligibleFrom'] as string | null })) })) };
}
