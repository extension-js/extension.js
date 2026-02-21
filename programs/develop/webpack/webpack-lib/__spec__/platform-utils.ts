import * as path from 'path'

/**
 * Normalize a path to Unix-style separators for stable assertions.
 * Use when comparing paths that may come from path.join() or process.cwd() on Windows.
 */
export function normalizePathForAssert(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

/**
 * Build a RegExp that matches a path containing the given segments with either / or \\.
 * Use in expect(String(actual)).toMatch(pathPattern(['svelte', 'src', 'index-client.js'])).
 *
 * @example
 * expect(String(result?.alias?.svelte)).toMatch(pathPattern(['svelte', 'src', 'index-client.js']))
 */
export function pathPattern(segments: string[]): RegExp {
  const escaped = segments.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = escaped.join('[\\\\/]')
  return new RegExp(`${pattern}$`)
}
