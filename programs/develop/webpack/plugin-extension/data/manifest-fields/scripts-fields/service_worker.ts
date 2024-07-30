import path from 'path'
import {type Manifest} from '../../../../webpack-types'

export function serviceWorker(
  context: string,
  manifest: Manifest
): string | undefined {
  if (!manifest || !manifest.background) {
    return undefined
  }

  const serviceWorker = manifest.background.service_worker

  if (serviceWorker) {
    return path.join(context, serviceWorker)
  }

  return undefined
}
