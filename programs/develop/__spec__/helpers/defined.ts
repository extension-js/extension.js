export function defined<T>(value: T | null | undefined, what: string): T {
  // Named here, a missing value fails the spec with what was expected
  // instead of a crash on whichever line read it first.
  if (value === null || value === undefined) {
    throw new Error(`Expected ${what}, got ${String(value)}`)
  }

  return value
}
