import {type Manifest} from '../../../../webpack-types'
import {getFilename} from '../../manifest-lib/paths'
import {normalizeManifestOutputPath} from '../../normalize-manifest-path'

export function sidePanel(manifest: Manifest) {
  return (
    manifest.side_panel && {
      side_panel: {
        ...manifest.side_panel,
        ...(manifest.side_panel.default_path && {
          default_path: (() => {
            const raw = String(manifest.side_panel.default_path)
            const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
            const target = isPublic
              ? normalizeManifestOutputPath(raw)
              : 'sidebar/index.html'
            return getFilename(target, raw)
          })()
        })
      }
    }
  )
}
