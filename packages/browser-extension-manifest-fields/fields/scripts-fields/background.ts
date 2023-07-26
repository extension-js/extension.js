import path from 'path'
import {type ManifestData} from '../../types'

export default function background(
  manifestPath: string,
  manifest: ManifestData
) {
  if (!manifest || !manifest.background) {
    return undefined
  }

  const scripts: string[] = manifest.background.scripts

  if (scripts) {
    return scripts.map((script: string) => {
      const scriptAbsolutePath = path.join(path.dirname(manifestPath), script)

      return scriptAbsolutePath
    })
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
