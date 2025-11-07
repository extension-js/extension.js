import * as path from 'path'
import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../webpack-lib/paths'
import {normalizeManifestOutputPath} from '../../normalize-manifest-path'

export function icons(manifest: Manifest, _excludeList: FilepathList) {
  return (
    manifest.icons && {
      icons: Object.fromEntries(
        Object.entries(manifest.icons).map(([size, icon]) => {
          const raw = String(icon)
          const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
          const target = isPublic
            ? normalizeManifestOutputPath(raw)
            : `icons/${path.basename(raw)}`
          return [size, getFilename(target, raw, {})]
        })
      )
    }
  )
}
