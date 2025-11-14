import * as path from 'path'
import {getFilename} from '../../manifest-lib/paths'
import {normalizeManifestOutputPath} from '../../normalize-manifest-path'
import {type Manifest} from '../../../../webpack-types'

export function icons(manifest: Manifest) {
  return (
    manifest.icons && {
      icons: Object.fromEntries(
        Object.entries(manifest.icons).map(([size, icon]) => {
          const raw = String(icon)
          const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
          const target = isPublic
            ? normalizeManifestOutputPath(raw)
            : `icons/${path.basename(raw)}`
          return [size, getFilename(target, raw)]
        })
      )
    }
  )
}
