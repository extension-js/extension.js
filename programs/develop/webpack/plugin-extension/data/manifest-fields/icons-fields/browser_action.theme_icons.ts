import * as path from 'path'
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
      themeIcon.light = path.join(context, themeIcon.light)
    }

    if (themeIcon.dark) {
      themeIcon.dark = path.join(context, themeIcon.dark)
    }

    if (themeIcon.size) delete themeIcon.size
  }

  return manifest.browser_action.theme_icons
}
