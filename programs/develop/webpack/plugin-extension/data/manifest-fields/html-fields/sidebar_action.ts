import * as path from 'path'
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

  const sidebarPage: string = manifest.sidebar_action.default_panel

  return path.join(context, sidebarPage)
}
