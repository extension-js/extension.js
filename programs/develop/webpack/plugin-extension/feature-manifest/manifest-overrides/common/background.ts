import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../manifest-lib/paths'
import {normalizeManifestOutputPath} from '../../normalize-manifest-path'

export function backgroundPage(manifest: Manifest) {
  return (
    manifest.background &&
    manifest.background.page && {
      background: {
        ...manifest.background,
        ...(manifest.background.page && {
          page: (() => {
            const raw = String(manifest.background.page)
            const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
            const target = isPublic
              ? normalizeManifestOutputPath(raw)
              : 'background/index.html'
            return getFilename(target, raw)
          })()
        })
      }
    }
  )
}
