import {resolveManifestPath} from '../normalize'
import {type Manifest} from '../../../../webpack-types'

export function background(
  context: string,
  manifest: Manifest
): string | undefined {
  if (!manifest || !manifest.background || !manifest.background.page) {
    return undefined
  }

  const backgroundPage: string = manifest.background.page
  return resolveManifestPath(context, backgroundPage)
}
