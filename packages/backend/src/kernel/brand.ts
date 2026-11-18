declare const brand: unique symbol;
/** Technical type. Only domain factories may assign the brand. */
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };
