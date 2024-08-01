import {type ManifestData} from './types.js'

export function sidebarAction(manifest: ManifestData) {
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
