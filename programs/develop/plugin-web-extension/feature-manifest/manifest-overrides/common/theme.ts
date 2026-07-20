// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
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
          // theme.images values are usually a single path, but additional_backgrounds is
          // an array; map over arrays instead of passing one to path.basename().
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
