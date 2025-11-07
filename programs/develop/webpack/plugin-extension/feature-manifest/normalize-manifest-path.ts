export function normalizeManifestOutputPath(originalPath: string) {
  if (!originalPath) return originalPath

  const unixPath = originalPath.replace(/\\/g, '/')

  if (/^\/public\//i.test(unixPath)) {
    return unixPath.replace(/^\/public\//i, '')
  }

  if (/^(?:\.\/)?public\//i.test(unixPath)) {
    return unixPath.replace(/^(?:\.\/)?public\//i, '')
  }

  if (/^\//.test(unixPath)) {
    return unixPath.replace(/^\//, '')
  }

  return unixPath
}
