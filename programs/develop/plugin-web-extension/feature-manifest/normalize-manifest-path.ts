// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

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

// Output path for a manifest HTML-page entry: public/-prefixed refs strip the
// prefix; root-absolute refs compiled by the html pipeline point at compiledTarget.
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

// Output path for a manifest icon entry: in-project paths keep their location
// to avoid output collisions; the icons emitter mirrors this rule, keep them agreed.
export function iconOutputPath(raw: string) {
  if (/^(?:\/public\/|(?:\.\/)?public\/)/i.test(raw)) {
    return normalizeManifestOutputPath(raw)
  }

  const normalized = normalizeManifestOutputPath(raw).replace(/^\.\//, '')
  const escapes =
    !normalized ||
    normalized.split('/').includes('..') ||
    /^[A-Za-z]:/.test(normalized)

  return escapes ? `icons/${normalized.split('/').pop() || ''}` : normalized
}
