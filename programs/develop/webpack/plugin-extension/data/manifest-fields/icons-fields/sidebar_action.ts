import {resolveManifestPath} from '../normalize'
import {type Manifest} from '../../../../webpack-types'

export function sidebarAction(
  context: string,
  manifest: Manifest
): string | undefined {
  if (
    !manifest ||
    !manifest.sidebar_action ||
    !manifest.sidebar_action.default_icon
  ) {
    return undefined
  }

  const sidebarActionDefaultIcon = resolveManifestPath(
    context,
    manifest.sidebar_action.default_icon as string
  )

  return sidebarActionDefaultIcon
}
