import {type Manifest} from '../../../../webpack-types'
import {getFilename} from '../../manifest-lib/paths'
import {normalizeManifestOutputPath} from '../../normalize-manifest-path'

export function background(manifest: Manifest) {
  return (
    manifest.background &&
    manifest.background.scripts && {
      background: {
        ...manifest.background,
        ...(manifest.background.scripts && {
          scripts: [
            ...manifest.background.scripts.map((script) =>
              (() => {
                const raw = String(script)
                const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
                const target = isPublic
                  ? normalizeManifestOutputPath(raw)
                  : 'background/scripts.js'
                return getFilename(target, raw)
              })()
            )
          ]
        })
      }
    }
  )
}
