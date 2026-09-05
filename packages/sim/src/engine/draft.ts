/**
 * Deep-mutable working-copy typing for transaction internals (TDD section 9.3).
 * The mutable draft never escapes the transaction; committed state is the
 * canonical readonly `GameState`.
 */
export type DeepMutable<T> = T extends number | string | boolean | null | undefined
  ? T
  : T extends readonly (infer U)[]
    ? DeepMutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
      : T;

/**
 * Clone canonical simulation data without the overhead of the browser's
 * general-purpose structured clone algorithm.
 *
 * GameState's invariant permits only primitives, arrays, and plain objects.
 * Preserving each object's prototype also keeps the permitted null-prototype
 * record case exact. No canonical state value may contain a cycle.
 */
export function clonePlainData<T>(value: T): DeepMutable<T> {
  if (value === null || typeof value !== "object") {
    return value as DeepMutable<T>;
  }
  if (Array.isArray(value)) {
    const clone: unknown[] = new Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      clone[index] = clonePlainData(value[index]);
    }
    return clone as DeepMutable<T>;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("clonePlainData requires a plain object");
  }
  const clone: Record<string, unknown> =
    prototype === null ? (Object.create(null) as Record<string, unknown>) : {};
  for (const key of Object.keys(value)) {
    clone[key] = clonePlainData((value as Record<string, unknown>)[key]);
  }
  return clone as DeepMutable<T>;
}
