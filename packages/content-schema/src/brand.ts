/**
 * Compile-time branding for IDs and units (TDD section 5.3).
 *
 * The brand exists only in the type system; at runtime a branded value is the
 * plain string or number it wraps.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };
