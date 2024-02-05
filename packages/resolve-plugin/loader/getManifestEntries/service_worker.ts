import * as path from '../../helpers/pathUtils.js'
import {type ManifestData} from './types.js'

export default function serviceWorker(manifest: ManifestData) {
  if (!manifest || !manifest.background) {
    return undefined
  }

  const serviceWorker = manifest.background.service_worker

  if (serviceWorker) {
    const serviceWorker = manifest.background.service_worker

    const serviceWorkerAbsolutePath = serviceWorker

    return serviceWorkerAbsolutePath
  }

  return undefined
}
