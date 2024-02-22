import path from 'path'
import {type Manifest, type ManifestData} from '../../types'

export default function browserAction(
  manifestPath: string,
  manifest: Manifest
): ManifestData {
  if (
    !manifest ||
    !manifest.browser_action ||
    !manifest.browser_action.default_icon
  ) {
    return undefined
  }

  const browserActionDefaultIcons: string[] = []

  if (typeof manifest.browser_action.default_icon === 'string') {
    return path.resolve(
      path.dirname(manifestPath),
      manifest.browser_action.default_icon as string
    )
  }

  for (const icon in manifest.browser_action.default_icon) {
    const browserActionDefaultIconAbsolutePath =
      (manifest.browser_action.default_icon[icon] = path.resolve(
        path.dirname(manifestPath),
        manifest.browser_action.default_icon[icon] as string
      ))

    browserActionDefaultIcons.push(browserActionDefaultIconAbsolutePath)
  }

  return browserActionDefaultIcons
}
