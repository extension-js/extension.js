import path from 'path'
import {type Manifest, type ManifestData} from '../../types'

export default function sidebarAction(
  manifestPath: string,
  manifest: Manifest
): ManifestData {
  if (
    !manifest ||
    !manifest.sidebar_action ||
    !manifest.sidebar_action.default_icon
  ) {
    return undefined
  }

  const sidebarActionDefaultIconAbsolutePath = path.join(
    path.dirname(manifestPath),
    manifest.sidebar_action.default_icon as string
  )

  return sidebarActionDefaultIconAbsolutePath
}
