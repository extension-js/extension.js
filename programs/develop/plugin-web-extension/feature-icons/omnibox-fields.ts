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
import type {DevOptions, FilepathList, Manifest} from '../../types'

// The manifest-fields package has no omnibox entry, so the omnibox icon had
// no emitter at all: the manifest named a path nothing produced.
export function omniboxIconFields(
  manifestPath: string,
  browser: DevOptions['browser'] = 'chrome'
): FilepathList {
  let manifest: {omnibox?: {default_icon?: unknown}}
  try {
    // An omnibox written under a browser prefix is invisible to a raw read,
    // and the manifest then names an icon path nothing produces.
    manifest = filterKeysForThisBrowser(
      JSON.parse(stripBom(fs.readFileSync(manifestPath, 'utf8'))) as Manifest,
      browser
    ) as {omnibox?: {default_icon?: unknown}}
  } catch {
    return {}
  }
  const icon = manifest?.omnibox?.default_icon
  if (!icon) return {}
  const manifestDir = path.dirname(manifestPath)
  // Root-absolute spellings stay raw so the emitter reads them as
  // extension-root refs; everything else resolves from the manifest folder.
  const resolve = (value: unknown) =>
    typeof value === 'string' &&
    !value.startsWith('/') &&
    !path.isAbsolute(value)
      ? path.join(manifestDir, value)
      : String(value)
  if (typeof icon === 'string') return {'omnibox/default_icon': resolve(icon)}
  if (typeof icon === 'object') {
    return {
      'omnibox/default_icon': Object.fromEntries(
        Object.entries(icon as Record<string, unknown>).map(([size, value]) => [
          size,
          resolve(value)
        ])
      ) as unknown as string
    }
  }
  return {}
}
