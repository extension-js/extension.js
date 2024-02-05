import * as path from '../../helpers/pathUtils.js'

import {type ManifestData} from './types.js'

export default function sidebarAction(manifest: ManifestData) {
  if (
    !manifest ||
    !manifest.sidebar_action ||
    !manifest.sidebar_action.default_panel
  ) {
    return undefined
  }

  const sidebarPage = manifest.sidebar_action.default_panel

  const sidebarPageAbsolutePath = sidebarPage

  return sidebarPageAbsolutePath
}
