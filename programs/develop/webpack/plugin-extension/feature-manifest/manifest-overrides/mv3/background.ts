import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../../develop-lib/utils'

export function backgroundServiceWorker(
  manifest: Manifest,
  excludeList: FilepathList
) {
  return (
    manifest.background &&
    manifest.background.service_worker && {
      background: {
        ...manifest.background,
        ...(manifest.background.service_worker && {
          service_worker: getFilename(
            'background/service_worker.js',
            manifest.background.service_worker as string,
            excludeList
          )
        })
      }
    }
  )
}
