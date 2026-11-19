import { eventId } from '../../../contracts/identity/index.ts';
import type { DeliveryLease } from './delivery-lease.ts';

export function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  return value;
}

export function validateConsumerId(value: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value))
    throw new TypeError('The consumer ID is invalid.');
}

export function validateConsumerIds(values: readonly string[]): readonly string[] {
  boundedInteger(values.length, 1, 32, 'The consumer count');
  values.forEach(validateConsumerId);
  if (new Set(values).size !== values.length)
    throw new TypeError('Consumer IDs must be unique.');
  return [...values];
}

export function validateFailureCode(value: string): void {
  if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value))
    throw new TypeError('Failure codes must be safe internal classifications.');
}

export function validateLease(lease: DeliveryLease): void {
  validateConsumerId(lease.consumerId);
  if (typeof lease.eventId !== 'string' || !eventId(lease.eventId).ok)
    throw new TypeError('The delivery event ID is invalid.');
  if (typeof lease.token !== 'string' || !/^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/.test(lease.token))
    throw new TypeError('The lease token is invalid.');
  boundedInteger(lease.attempt, 1, 100, 'The delivery attempt');
  boundedInteger(lease.expiresAt, 0, Number.MAX_SAFE_INTEGER, 'The lease expiry');
}

export function snapshotLease(lease: DeliveryLease): DeliveryLease {
  const snapshot = { consumerId: lease.consumerId, eventId: lease.eventId,
    token: lease.token, attempt: lease.attempt, expiresAt: lease.expiresAt };
  validateLease(snapshot);
  return Object.freeze(snapshot);
}
