import * as path from 'node:path'
import type {Manifest} from '../../../../types'
import {getFilename} from '../../../shared/paths'
import {manifestPageOutputTarget} from '../../normalize-manifest-path'

const getBasename = (filepath: string) => path.basename(filepath)

// A public-hosted image ships at its public-relative path (the copier puts
// it there), so the manifest must name that path, not the canonical one.
const rewriteThemeImage = (value: string, manifestPath?: string) =>
  getFilename(
    manifestPageOutputTarget(
      value,
      `theme/images/${getBasename(value)}`,
      manifestPath
    ),
    value
  )

export function theme(manifest: Manifest, manifestPath?: string) {
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
                ? value.map((entry) => rewriteThemeImage(entry, manifestPath))
                : rewriteThemeImage(value, manifestPath)
            ])
          )
        })
      }
    }
  )
}
