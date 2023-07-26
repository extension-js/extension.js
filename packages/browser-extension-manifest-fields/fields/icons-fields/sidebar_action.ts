import path from 'path'
import {type ManifestData} from '../../types'

export default function sidebarAction(
  manifestPath: string,
  manifest: ManifestData
) {
  if (
    !manifest ||
    !manifest.sidebar_action ||
    !manifest.sidebar_action.default_icon
  ) {
    return undefined
  }

  const sidebarActionDefaultIcons = []

  for (const icon in manifest.sidebar_action.default_icon) {
    const sidebarActionDefaultIconAbsolutePath = path.join(
      path.dirname(manifestPath),
      manifest.sidebar_action.default_icon[icon]
    )

    sidebarActionDefaultIcons.push(sidebarActionDefaultIconAbsolutePath)
  }

  return sidebarActionDefaultIcons
}
