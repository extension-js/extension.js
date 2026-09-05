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

// The manifest-fields package keys theme images by basename, so two images
// that share a basename collapse into one entry before the emitter runs.
// Key them by their theme.images property instead and keep every path.
export function themeImageFields(manifestPath: string): FilepathList {
  let manifest: {theme?: {images?: unknown}}
  try {
    manifest = JSON.parse(stripBom(fs.readFileSync(manifestPath, 'utf8')))
  } catch {
    return {}
  }
  const images = manifest?.theme?.images
  if (!images || typeof images !== 'object' || Array.isArray(images)) {
    return {}
  }
  const manifestDir = path.dirname(manifestPath)
  // Root-absolute spellings stay raw so the emitter reads them as
  // extension-root refs; everything else resolves from the manifest folder.
  const resolve = (value: string) =>
    !value.startsWith('/') && !path.isAbsolute(value)
      ? path.join(manifestDir, value)
      : value

  const out: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(
    images as Record<string, unknown>
  )) {
    if (typeof value === 'string') {
      out[`theme/images/${key}`] = resolve(value)
    } else if (Array.isArray(value)) {
      const entries = value.filter(
        (entry): entry is string => typeof entry === 'string'
      )
      if (entries.length) out[`theme/images/${key}`] = entries.map(resolve)
    }
  }
  return out as FilepathList
}
