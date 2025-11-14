import {getFilename} from '../../manifest-lib/paths'
import {normalizeManifestOutputPath} from '../../normalize-manifest-path'
import {type Manifest} from '../../../../webpack-types'

export function optionsUi(manifest: Manifest) {
  return (
    manifest.options_ui && {
      options_ui: {
        ...manifest.options_ui,
        ...(manifest.options_ui.page && {
          page: (() => {
            const raw = String(manifest.options_ui.page)
            const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
            const target = isPublic
              ? normalizeManifestOutputPath(raw)
              : 'options/index.html'
            return getFilename(target, raw)
          })()
        })
      }
    }
  )
}
