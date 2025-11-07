import {type Manifest} from '../../../../webpack-types'
import {getFilename} from '../../../../webpack-lib/paths'
import {normalizeManifestOutputPath} from '../../normalize-manifest-path'

export function backgroundServiceWorker(manifest: Manifest) {
  return (
    manifest.background &&
    manifest.background.service_worker && {
      background: {
        ...manifest.background,
        ...(manifest.background.service_worker && {
          service_worker: (() => {
            const raw = String(manifest.background.service_worker)
            const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
            const target = isPublic
              ? normalizeManifestOutputPath(raw)
              : 'background/service_worker.js'
            return getFilename(target, raw)
          })()
        })
      }
    }
  )
}
