import path from 'path'
import {type ManifestData} from '../../types'

export default function browserAction(
  manifestPath: string,
  manifest: ManifestData
) {
  if (
    !manifest ||
    !manifest.browser_action ||
    !manifest.browser_action.default_icon
  ) {
    return undefined
  }

  const browserActionDefaultIcons = []

  if (typeof manifest.browser_action.default_icon === 'string') {
    return path.join(
      path.dirname(manifestPath),
      manifest.browser_action.default_icon
    )
  }

  for (const icon in manifest.browser_action.default_icon) {
    const browserActionDefaultIconAbsolutePath =
      (manifest.browser_action.default_icon[icon] = path.join(
        path.dirname(manifestPath),
        manifest.browser_action.default_icon[icon]
      ))

    browserActionDefaultIcons.push(browserActionDefaultIconAbsolutePath)
  }

  return browserActionDefaultIcons
}
