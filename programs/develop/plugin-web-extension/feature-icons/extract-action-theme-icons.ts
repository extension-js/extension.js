// ██╗ ██████╗ ██████╗ ███╗   ██╗███████╗
// ██║██╔════╝██╔═══██╗████╗  ██║██╔════╝
// ██║██║     ██║   ██║██╔██╗ ██║███████╗
// ██║██║     ██║   ██║██║╚██╗██║╚════██║
// ██║╚██████╗╚██████╔╝██║ ╚████║███████║
// ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {filterKeysForThisBrowser} from '../../lib/manifest-utils'
import {stripBom} from '../../lib/parse-json-safe'
import {
  findPublicFile,
  publicRelativePath
} from '../../plugin-special-folders/resolve-public-folder'
import type {DevOptions, FilepathList, Manifest} from '../../types'

// Beside the manifest first; a file only public/ has (project root first,
// then next to the manifest) resolves there, where the emitter reads it.
function resolveManifestIconPath(
  context: string,
  relativePath: string,
  projectPath?: string
) {
  const unix = relativePath.replace(/\\/g, '/')
  const hosted = findPublicFile(
    path.join(context, 'manifest.json'),
    projectPath,
    unix
  )

  if (/^(?:\/public\/|(?:\.\/)?public\/)/i.test(unix)) {
    return hosted || path.join(context, 'public', publicRelativePath(unix))
  }

  const beside = /^\//.test(unix)
    ? path.join(context, unix.slice(1))
    : path.join(context, unix)

  if (hosted && !fs.existsSync(beside)) return hosted

  return beside
}

// The manifest-fields package only extracts browser_action.theme_icons;
// Firefox MV3 action.theme_icons need the same emit path or the rewritten
// entries in the built manifest point at files nothing produced.
export function extractActionThemeIcons(
  manifestPath: string,
  browser: DevOptions['browser'] = 'chrome',
  projectPath?: string
): FilepathList {
  let manifest: {
    action?: {theme_icons?: Array<{light?: string; dark?: string}>}
  }

  try {
    // An action written under a browser prefix is invisible to a raw read,
    // and the built manifest then names theme icons nothing emits.
    manifest = filterKeysForThisBrowser(
      JSON.parse(stripBom(fs.readFileSync(manifestPath, 'utf8'))) as Manifest,
      browser
    ) as typeof manifest
  } catch {
    return {}
  }

  const themeIcons = manifest?.action?.theme_icons
  if (!Array.isArray(themeIcons) || themeIcons.length === 0) return {}

  const context = path.dirname(manifestPath)
  const paths: string[] = []

  for (const icon of themeIcons) {
    if (!icon || typeof icon !== 'object') continue

    if (typeof icon.light === 'string' && icon.light) {
      paths.push(resolveManifestIconPath(context, icon.light, projectPath))
    }

    if (typeof icon.dark === 'string' && icon.dark) {
      paths.push(resolveManifestIconPath(context, icon.dark, projectPath))
    }
  }

  return paths.length ? {'action/theme_icons': paths} : {}
}
