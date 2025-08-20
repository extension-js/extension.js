import {resolveManifestPath} from '../normalize'
import {type Manifest} from '../../../../webpack-types'

export function sidebarAction(
  context: string,
  manifest: Manifest
): string | undefined {
  if (
    !manifest ||
    !manifest.sidebar_action ||
    !manifest.sidebar_action.default_panel
  ) {
    return undefined
  }

  const sidebarActionPage: string = manifest.sidebar_action.default_panel
  return resolveManifestPath(context, sidebarActionPage)
}
