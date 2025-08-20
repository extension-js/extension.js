import {resolveManifestPath} from '../normalize'
import {type Manifest} from '../../../../webpack-types'

export function userScripts(
  context: string,
  manifest: Manifest
): string | undefined {
  if (
    !manifest ||
    !manifest.user_scripts ||
    !manifest.user_scripts.api_script
  ) {
    return undefined
  }

  const userScript: string = manifest.user_scripts.api_script

  return resolveManifestPath(context, userScript)
}
