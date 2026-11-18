import type { Icao24 } from './icao24.ts';
import type { Registration } from './registration.ts';
export type StrongIdentifier =
  | { readonly kind: 'ICAO24'; readonly value: Icao24 }
  | { readonly kind: 'REGISTRATION'; readonly value: Registration };
