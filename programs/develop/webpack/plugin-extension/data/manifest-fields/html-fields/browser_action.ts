import {resolveManifestPath} from '../normalize'
import {type Manifest} from '../../../../webpack-types'

export function browserAction(
  context: string,
  manifest: Manifest
): string | undefined {
  if (
    !manifest ||
    !manifest.browser_action ||
    !manifest.browser_action.default_popup
  ) {
    return undefined
  }

  const browserActionPage: string = manifest.browser_action.default_popup

  return resolveManifestPath(context, browserActionPage)
}
