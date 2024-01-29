import path from 'path'
import {type ManifestData} from '../resolver-module/types'

export default function sidebarAction(
  manifestPath: string,
  manifest: ManifestData
) {
  if (
    !manifest ||
    !manifest.sidebar_action ||
    !manifest.sidebar_action.default_panel
  ) {
    return undefined
  }

  const sidebarPage = manifest.sidebar_action.default_panel

  const sidebarPageAbsolutePath = path.join(
    path.dirname(manifestPath),
    sidebarPage
  )

  return sidebarPageAbsolutePath
}
