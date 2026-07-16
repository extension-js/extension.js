// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'

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

// Output path for a manifest HTML-page entry (options_page, options_ui.page,
// devtools_page, chrome_url_overrides.*). A `public/`-prefixed ref is served
// verbatim from the output root, so only the prefix is stripped. A plain
// root-absolute ref (`/page/options.html`) resolves from the EXTENSION root
// (Chrome semantics): when the file really lives at the project root the html
// pipeline compiles it to `compiledTarget` — the manifest must point there,
// not at the raw path nothing emits (public/ still wins when it has the
// file). Refs that exist nowhere keep the normalized raw path so the broken
// ref stays visibly broken instead of pointing at a surface we never built.
export function manifestPageOutputTarget(
  raw: string,
  compiledTarget: string,
  manifestPath?: string
): string {
  const unixPath = raw.replace(/\\/g, '/')

  if (/^(?:\/public\/|(?:\.\/)?public\/)/i.test(unixPath)) {
    return normalizeManifestOutputPath(unixPath)
  }

  if (/^\//.test(unixPath)) {
    const rest = unixPath.replace(/^\/+/, '')
    if (manifestPath && rest) {
      const manifestDir = path.dirname(manifestPath)
      const inPublic = fs.existsSync(path.join(manifestDir, 'public', rest))
      const inRoot = fs.existsSync(path.join(manifestDir, rest))
      if (inRoot && !inPublic) return compiledTarget
    }
    return normalizeManifestOutputPath(unixPath)
  }

  return compiledTarget
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
