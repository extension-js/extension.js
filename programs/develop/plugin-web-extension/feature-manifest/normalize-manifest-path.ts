// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

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

// Output path for a manifest icon entry (icons, */default_icon). In-project
// paths keep their declared location so two icons sharing a basename — or a
// real project file that already owns icons/<basename> — can't collide in
// the output (G16). Only paths that escape the project (../ or OS-absolute)
// fall back to the flattened icons/<basename> form. The icons emitter
// (feature-icons/steps/emit-file.ts) mirrors this rule; the two must agree
// or the manifest points at files that were never emitted.
export function iconOutputPath(raw: string) {
  if (/^(?:\/public\/|(?:\.\/)?public\/)/i.test(raw)) {
    return normalizeManifestOutputPath(raw)
  }

  const normalized = normalizeManifestOutputPath(raw).replace(/^\.\//, '')
  const escapes =
    !normalized ||
    normalized.split('/').includes('..') ||
    /^[A-Za-z]:/.test(normalized)

  return escapes
    ? `icons/${normalized.split('/').pop() || ''}`
    : normalized
}
