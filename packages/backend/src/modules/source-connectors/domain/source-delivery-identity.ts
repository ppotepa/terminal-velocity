import type { Brand } from '../../../kernel/brand.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';
import { hasOnlyKeys, isOpaqueText, isToken, plainRecord } from './input-validation.ts';

export type DeliveryProvider = Brand<string, 'DeliveryProvider'>;
export type DeliveryAccountScope = Brand<string, 'DeliveryAccountScope'>;
export type SourceEpoch = Brand<string, 'SourceEpoch'>;
export type ExternalDeliveryId = Brand<string, 'ExternalDeliveryId'>;

export interface SourceDeliveryIdentity {
  readonly provider: DeliveryProvider;
  readonly accountScope: DeliveryAccountScope;
  readonly sourceEpoch: SourceEpoch;
  readonly externalId: ExternalDeliveryId;
}

export type InvalidDeliveryIdentity = {
  readonly code: 'INVALID_DELIVERY_IDENTITY';
  readonly field: 'provider' | 'accountScope' | 'sourceEpoch' | 'externalId';
};

export function deliveryProvider(input: string): Result<DeliveryProvider, InvalidDeliveryIdentity> {
  return isToken(input, 64)
    ? ok(input.toLowerCase() as DeliveryProvider)
    : err({ code: 'INVALID_DELIVERY_IDENTITY', field: 'provider' });
}

export function deliveryAccountScope(input: string): Result<DeliveryAccountScope, InvalidDeliveryIdentity> {
  return isOpaqueText(input, 128)
    ? ok(input as DeliveryAccountScope)
    : err({ code: 'INVALID_DELIVERY_IDENTITY', field: 'accountScope' });
}

export function sourceEpoch(input: string): Result<SourceEpoch, InvalidDeliveryIdentity> {
  return isOpaqueText(input, 128)
    ? ok(input as SourceEpoch)
    : err({ code: 'INVALID_DELIVERY_IDENTITY', field: 'sourceEpoch' });
}

export function externalDeliveryId(input: string): Result<ExternalDeliveryId, InvalidDeliveryIdentity> {
  return isOpaqueText(input, 256)
    ? ok(input as ExternalDeliveryId)
    : err({ code: 'INVALID_DELIVERY_IDENTITY', field: 'externalId' });
}

export function sourceDeliveryIdentity(input: unknown): Result<SourceDeliveryIdentity, InvalidDeliveryIdentity> {
  const record = plainRecord(input);
  if (!record || !hasOnlyKeys(record, ['provider', 'accountScope', 'sourceEpoch', 'externalId']))
    return err({ code: 'INVALID_DELIVERY_IDENTITY', field: 'provider' });
  if (typeof record['provider'] !== 'string')
    return err({ code: 'INVALID_DELIVERY_IDENTITY', field: 'provider' });
  if (typeof record['accountScope'] !== 'string')
    return err({ code: 'INVALID_DELIVERY_IDENTITY', field: 'accountScope' });
  if (typeof record['sourceEpoch'] !== 'string')
    return err({ code: 'INVALID_DELIVERY_IDENTITY', field: 'sourceEpoch' });
  if (typeof record['externalId'] !== 'string')
    return err({ code: 'INVALID_DELIVERY_IDENTITY', field: 'externalId' });
  const provider = deliveryProvider(record['provider']);
  if (!provider.ok) return provider;
  const accountScope = deliveryAccountScope(record['accountScope']);
  if (!accountScope.ok) return accountScope;
  const epoch = sourceEpoch(record['sourceEpoch']);
  if (!epoch.ok) return epoch;
  const externalId = externalDeliveryId(record['externalId']);
  if (!externalId.ok) return externalId;
  return ok(Object.freeze({
    provider: provider.value,
    accountScope: accountScope.value,
    sourceEpoch: epoch.value,
    externalId: externalId.value,
  }));
}
