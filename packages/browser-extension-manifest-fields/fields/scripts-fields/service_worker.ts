import path from 'path'
import {type Manifest, type ManifestData} from '../../types'

export default function serviceWorker(
  manifestPath: string,
  manifest: Manifest
): ManifestData {
  if (!manifest || !manifest.background) {
    return undefined
  }

  const serviceWorker: string = manifest.background.service_worker

  if (serviceWorker) {
    const serviceWorkerAbsolutePath = path.join(
      path.dirname(manifestPath),
      serviceWorker
    )

    return serviceWorkerAbsolutePath
  }

  return undefined
}
