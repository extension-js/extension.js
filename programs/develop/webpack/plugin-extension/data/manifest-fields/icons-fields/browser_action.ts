import {resolveManifestPath} from '../normalize'
import {type Manifest} from '../../../../webpack-types'

export function browserAction(
  context: string,

  manifest: Manifest
): string | string[] | undefined {
  if (
    !manifest ||
    !manifest.browser_action ||
    !manifest.browser_action.default_icon
  ) {
    return undefined
  }

  const browserActionDefaultIcons: string[] = []

  if (typeof manifest.browser_action.default_icon === 'string') {
    return resolveManifestPath(
      context,
      manifest.browser_action.default_icon as string
    )
  }

  for (const icon in manifest.browser_action.default_icon) {
    const browserActionDefaultIconAbsolutePath =
      (manifest.browser_action.default_icon[icon] = resolveManifestPath(
        context,
        manifest.browser_action.default_icon[icon] as string
      ))

    browserActionDefaultIcons.push(browserActionDefaultIconAbsolutePath)
  }

  return browserActionDefaultIcons
}
