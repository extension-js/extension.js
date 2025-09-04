import * as path from 'path'

/**
 * Resolve a manifest-declared path to an absolute filesystem path.
 * Handles public-root style inputs consistently across OS/runners:
 * - '/foo'          => '<context>/foo'
 * - '/public/foo'   => '<context>/public/foo'
 * - 'public/foo'    => '<context>/public/foo'
 * - './public/foo'  => '<context>/public/foo'
 * - 'foo/bar'       => '<context>/foo/bar'
 */
export function resolveManifestPath(context: string, relativePath: string) {
  if (!relativePath) return relativePath

  const unix = relativePath.replace(/\\/g, '/')

  // Normalize various public-root forms
  if (/^\/public\//i.test(unix)) {
    const rest = unix.replace(/^\/public\//i, '')
    return path.join(context, 'public', rest)
  }

  if (/^(?:\.\/)?public\//i.test(unix)) {
    const rest = unix.replace(/^(?:\.\/)?public\//i, '')
    return path.join(context, 'public', rest)
  }

  if (/^\//.test(unix)) {
    const rest = unix.slice(1)
    return path.join(context, rest)
  }

  return path.join(context, unix)
}
