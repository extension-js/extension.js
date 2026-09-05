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

// Output path for a manifest page or JSON entry: public/-prefixed refs strip
// the prefix; root-absolute refs owned by public/ stay at the output root;
// in-project refs compiled by the pipeline point at compiledTarget.
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
// A path that leaves the extension root has no place of its own in the output.
function pathEscapesExtensionRoot(normalized: string): boolean {
  return (
    !normalized ||
    normalized.split('/').includes('..') ||
    /^[A-Za-z]:/.test(normalized)
  )
}

// Outside-the-root asset path to a stable unique slot under `root/`. Each
// `..` segment becomes `_` and a drive letter a segment, so two files that
// share a basename in different folders never land on one output path.
// Manifest overrides and the icons emitter share this; keep them agreed.
export function externalAssetOutputPath(
  normalized: string,
  root: string
): string {
  const unix = normalized.replace(/\\/g, '/')
  const noDrive = unix.replace(/^([A-Za-z]):(?:\/|$)/, '_drive_$1/')
  const safe = noDrive
    .split('/')
    .map((segment) => {
      if (segment === '..') return '_'
      if (segment === '.' || !segment) return ''
      return segment.replace(/[<>:"|?*\x00-\x1F]/g, '_')
    })
    .filter(Boolean)
    .join('/')

  return safe ? `${root}/${safe}` : `${root}/external`
}

export function iconOutputPath(raw: string) {
  if (/^(?:\/public\/|(?:\.\/)?public\/)/i.test(raw)) {
    return normalizeManifestOutputPath(raw)
  }

  const normalized = normalizeManifestOutputPath(raw).replace(/^\.\//, '')
  if (!pathEscapesExtensionRoot(normalized)) return normalized

  return externalAssetOutputPath(normalized, 'icons')
}

// Output path for action / browser_action theme_icons (light and dark).
// In-project paths keep their manifest-relative location under the folder,
// so a light/dark pair that shares a basename in two folders stays two
// files; outside paths get a unique slot under that folder.
export function themeIconOutputPath(
  raw: string,
  folder: 'action' | 'browser_action'
): string {
  return featureAssetOutputPath(raw, folder)
}

// Output path for a theme.images entry. Same rule as theme_icons under
// theme/images, so additional_backgrounds entries that share a basename
// keep their own alignment and tiling pairs.
export function themeImageOutputPath(raw: string): string {
  return featureAssetOutputPath(raw, 'theme/images')
}

function featureAssetOutputPath(raw: string, folder: string): string {
  if (/^(?:\/public\/|(?:\.\/)?public\/)/i.test(raw)) {
    return normalizeManifestOutputPath(raw)
  }

  const normalized = normalizeManifestOutputPath(raw).replace(/^\.\//, '')
  if (!pathEscapesExtensionRoot(normalized)) {
    return `${folder}/${normalized}`
  }

  return externalAssetOutputPath(normalized, folder)
}
