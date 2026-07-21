/**
 * Structured semantic random keys (TDD section 10.1), e.g.
 * `randomKey("training", modelId, "capability", "reasoning")`.
 *
 * The key keeps its segments so hashing can length-prefix each one — a
 * segment containing "/" can therefore never collide with two separate
 * segments. `describeRandomKey` provides the display form.
 */
export interface RandomKey {
  readonly segments: readonly [string, ...string[]];
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function randomKey(...segments: readonly string[]): RandomKey {
  if (segments.length === 0) {
    throw new RangeError("A random key needs at least one segment.");
  }
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new RangeError("Random key segments must be non-empty.");
    }
    if (CONTROL_CHARS.test(segment)) {
      throw new RangeError(
        `Random key segment ${JSON.stringify(segment)} contains control characters.`,
      );
    }
    // Unpaired surrogates encode to U+FFFD, so two distinct malformed keys
    // would silently collide to the same generator (TDD 10.2 step 2).
    if (!segment.isWellFormed()) {
      throw new RangeError(
        `Random key segment ${JSON.stringify(segment)} is not well-formed UTF-16.`,
      );
    }
  }
  return { segments: segments as unknown as readonly [string, ...string[]] };
}

export function describeRandomKey(key: RandomKey): string {
  return key.segments.join("/");
}
