import path from 'path'
import {type Manifest, type ManifestData} from '../../types'

export default function pageAction(
  manifestPath: string,
  manifest: Manifest
): ManifestData {
  if (
    !manifest ||
    !manifest.page_action ||
    !manifest.page_action.default_icon
  ) {
    return undefined
  }

  if (typeof manifest.page_action.default_icon === 'string') {
    return path.join(
      path.dirname(manifestPath),
      manifest.page_action.default_icon
    )
  }

  const pageActionDefaultIcons = []

  for (const icon in manifest.page_action.default_icon) {
    const pageactionDefaultIconAbsolutePath = path.join(
      path.dirname(manifestPath),
      manifest.page_action.default_icon[icon]
    )

    pageActionDefaultIcons.push(pageactionDefaultIconAbsolutePath)
  }

  return pageActionDefaultIcons
}
