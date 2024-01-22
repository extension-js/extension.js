import path from 'path'
import {type ManifestData} from '../../types'

export default function serviceWorker(
  manifestPath: string,
  manifest: ManifestData
) {
  if (!manifest || !manifest.background) {
    return undefined
  }

  const serviceWorker = manifest.background.service_worker

  if (serviceWorker) {
    const serviceWorker = manifest.background.service_worker

    const serviceWorkerAbsolutePath = path.join(
      path.dirname(manifestPath),
      serviceWorker
    )

    return serviceWorkerAbsolutePath
  }

  return undefined
}
