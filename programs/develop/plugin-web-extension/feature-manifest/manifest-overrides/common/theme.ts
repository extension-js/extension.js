// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'path'
import type {Manifest} from '../../../../types'
import {getFilename} from '../../../shared/paths'

const getBasename = (filepath: string) => path.basename(filepath)

const rewriteThemeImage = (value: string) =>
  getFilename(`theme/images/${getBasename(value)}`, value)

export function theme(manifest: Manifest) {
  return (
    manifest.theme && {
      theme: {
        ...manifest.theme,
        ...(manifest.theme.images && {
          // `theme.images` values are usually a single path string
          // (e.g. `theme_frame`), but `additional_backgrounds` is an array of
          // paths. A theme can layer multiple backgrounds. Rewrite each entry,
          // mapping over arrays instead of passing one straight to
          // `path.basename()` (which only accepts a string and throws on an
          // array).
          images: Object.fromEntries(
            Object.entries(
              manifest.theme.images as Record<string, string | string[]>
            ).map(([key, value]) => [
              key,
              Array.isArray(value)
                ? value.map(rewriteThemeImage)
                : rewriteThemeImage(value)
            ])
          )
        })
      }
    }
  )
}
