/**
 * Exhaustiveness backstop for discriminated-union switches (TDD section 5.6).
 * Adding a union variant produces compile errors at every unhandled site.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled union variant: ${JSON.stringify(value)}`);
}
