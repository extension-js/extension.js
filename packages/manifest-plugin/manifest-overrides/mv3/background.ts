import {type ManifestData} from '../types'
import getFilename from '../../helpers/getFilename'

export default function getBackground(
  manifest: ManifestData,
  exclude: string[]
) {
  return (
    manifest.background &&
    manifest.background.service_worker && {
      background: {
        ...manifest.background,
        ...(manifest.background.service_worker && {
          service_worker: getFilename('service_worker', '', exclude)
        })
      }
    }
  )
}
