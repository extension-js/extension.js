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
import {parseAuthoredJson} from '../../lib/parse-json-safe'
import type {DevOptions, FilepathList, Manifest} from '../../types'
import {resolveManifestIconPath} from './extract-action-theme-icons'

const ACTION_KEYS = ['action', 'browser_action', 'page_action'] as const

function variantPaths(variants: unknown): string[] {
  if (!Array.isArray(variants)) return []

  const paths: string[] = []

  for (const group of variants) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue

    for (const [key, value] of Object.entries(group)) {
      // color_schemes is the one key of a group that is not a file.
      if (key === 'color_schemes') continue
      if (typeof value === 'string' && value) paths.push(value)
    }
  }

  return paths
}

// The manifest-fields package does not know icon_variants, so a browser that
// reads the key would be pointed at files nothing put in the output.
export function extractIconVariants(
  manifestPath: string,
  browser: DevOptions['browser'] = 'chrome',
  projectPath?: string
): FilepathList {
  let manifest: Record<string, unknown>

  try {
    // Filtered first so a list under chromium: or firefox: ships on that
    // target and stays out of the others.
    manifest = filterKeysForThisBrowser(
      parseAuthoredJson(fs.readFileSync(manifestPath, 'utf8')) as Manifest,
      browser
    ) as Record<string, unknown>
  } catch {
    return {}
  }

  if (!manifest || typeof manifest !== 'object') return {}

  const context = path.dirname(manifestPath)
  const resolveAll = (variants: unknown) =>
    variantPaths(variants).map((entry) =>
      resolveManifestIconPath(context, entry, projectPath)
    )

  const out: Record<string, string[]> = {}
  const topLevel = resolveAll(manifest.icon_variants)

  if (topLevel.length) out.icon_variants = topLevel

  for (const key of ACTION_KEYS) {
    const surface = manifest[key]

    if (!surface || typeof surface !== 'object') continue

    const paths = resolveAll(
      (surface as {icon_variants?: unknown}).icon_variants
    )

    if (paths.length) out[`${key}/icon_variants`] = paths
  }

  return out as FilepathList
}
