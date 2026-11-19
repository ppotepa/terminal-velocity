import type { SourceObservation } from '../domain/source-observation.ts';
import type { SourceDeliveryOrigin } from './source-delivery-store.ts';

export interface DeliveryReceipt {
  readonly deliveryId: string;
  readonly origin: SourceDeliveryOrigin;
}

export interface LockedSourceDelivery {
  readPrevious(): Promise<(DeliveryReceipt & { readonly matches: boolean }) | null>;
  /** Append both delivery facts and the source event on this transaction. */
  append(): Promise<DeliveryReceipt>;
}

export interface SourceAcceptanceTransaction {
  run<T>(observation: SourceObservation, origin: SourceDeliveryOrigin,
    work: (locked: LockedSourceDelivery) => Promise<T>): Promise<T>;
}
