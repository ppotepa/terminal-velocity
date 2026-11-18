declare const brand: unique symbol;
/** Typ techniczny. Wyłącznie fabryki domenowe mogą nadawać markę. */
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };
