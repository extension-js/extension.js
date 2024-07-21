import {type Manifest} from '../../../../types'
import {getFilename} from '../../../../lib/utils'

export function backgroundServiceWorker(manifest: Manifest, exclude: string[]) {
  return (
    manifest.background &&
    manifest.background.service_worker && {
      background: {
        ...manifest.background,
        ...(manifest.background.service_worker && {
          service_worker: getFilename(
            'background/service_worker.js',
            manifest.background.service_worker as string,
            exclude
          )
        })
      }
    }
  )
}
