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
