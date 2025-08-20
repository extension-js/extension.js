import {resolveManifestPath} from '../normalize'
import {ThemeIcon, type Manifest} from '../../../../webpack-types'

export function browserActionThemeIcons(
  context: string,

  manifest: Manifest
): ThemeIcon[] | undefined {
  if (
    !manifest ||
    !manifest.browser_action ||
    // @ts-ignore
    !manifest.browser_action.theme_icons
  ) {
    return undefined
  }

  for (const themeIcon of manifest.browser_action.theme_icons as ThemeIcon[]) {
    if (themeIcon.light) {
      themeIcon.light = resolveManifestPath(context, themeIcon.light)
    }

    if (themeIcon.dark) {
      themeIcon.dark = resolveManifestPath(context, themeIcon.dark)
    }

    if (themeIcon.size) delete themeIcon.size
  }

  return manifest.browser_action.theme_icons
}
