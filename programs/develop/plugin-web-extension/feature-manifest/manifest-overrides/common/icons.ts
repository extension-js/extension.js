// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../../types'
import {getFilename} from '../../../shared/paths'
import {
  iconOutputPath,
  iconVariantsOf,
  iconVariantsOutput
} from '../../normalize-manifest-path'

export function icons(manifest: Manifest) {
  const variants = iconVariantsOf(manifest)

  if (!manifest.icons && !variants) return manifest.icons

  return {
    ...(manifest.icons && {
      icons: Object.fromEntries(
        Object.entries(manifest.icons).map(([size, icon]) => {
          const raw = String(icon)

          return [size, getFilename(iconOutputPath(raw), raw)]
        })
      )
    }),
    ...(Boolean(variants) && {icon_variants: iconVariantsOutput(variants)})
  }
}
