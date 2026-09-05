// ██╗ ██████╗ ██████╗ ███╗   ██╗███████╗
// ██║██╔════╝██╔═══██╗████╗  ██║██╔════╝
// ██║██║     ██║   ██║██╔██╗ ██║███████╗
// ██║██║     ██║   ██║██║╚██╗██║╚════██║
// ██║╚██████╗╚██████╔╝██║ ╚████║███████║
// ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {stripBom} from '../../lib/parse-json-safe'
import type {FilepathList} from '../../types'

function resolveManifestIconPath(context: string, relativePath: string) {
  const unix = relativePath.replace(/\\/g, '/')
  if (/^\/public\//i.test(unix)) {
    return path.join(context, 'public', unix.replace(/^\/public\//i, ''))
  }
  if (/^(?:\.\/)?public\//i.test(unix)) {
    return path.join(context, 'public', unix.replace(/^(?:\.\/)?public\//i, ''))
  }
  if (/^\//.test(unix)) return path.join(context, unix.slice(1))
  return path.join(context, unix)
}

// The manifest-fields package only extracts browser_action.theme_icons;
// Firefox MV3 action.theme_icons need the same emit path or the rewritten
// entries in the built manifest point at files nothing produced.
export function extractActionThemeIcons(manifestPath: string): FilepathList {
  let manifest: {
    action?: {theme_icons?: Array<{light?: string; dark?: string}>}
  }
  try {
    manifest = JSON.parse(stripBom(fs.readFileSync(manifestPath, 'utf8')))
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
      paths.push(resolveManifestIconPath(context, icon.light))
    }
    if (typeof icon.dark === 'string' && icon.dark) {
      paths.push(resolveManifestIconPath(context, icon.dark))
    }
  }
  return paths.length ? {'action/theme_icons': paths} : {}
}
