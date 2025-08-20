import * as path from 'path'

/**
 * Normalize a manifest-declared icon path so that leading "public/" segments
 * are removed. This allows users on Windows who may specify "./public/..."
 * to work consistently on macOS/Linux where the public folder resolves to "/".
 */
export function resolveIconPath(context: string, relativePath: string) {
  if (!relativePath) return relativePath

  // Use posix-style for detection, then join using native separators
  const unix = relativePath.replace(/\\/g, '/')
  // Strip an optional leading ./ then public/
  const stripped = unix.replace(/^(?:\.\/)?public\//i, '')

  return path.join(context, stripped)
}
