import {getFilename} from '../../manifest-lib/paths'
import {normalizeManifestOutputPath} from '../../normalize-manifest-path'
import {type Manifest} from '../../../../webpack-types'

export function optionsPage(manifest: Manifest) {
  return (
    manifest.options_page && {
      options_page: (() => {
        const raw = String(manifest.options_page)
        const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
        const target = isPublic
          ? normalizeManifestOutputPath(raw)
          : 'options/index.html'
        return getFilename(target, raw)
      })()
    }
  )
}
