import path from 'path'
import {type Manifest, type ManifestBrowserThemeIcons} from '../../types'

interface ThemeIcon {
  light: string
  dark: string
  size?: number
}

export default function browserActionThemeIcon(
  manifestPath: string,
  manifest: Manifest
): ManifestBrowserThemeIcons {
  if (
    !manifest ||
    !manifest.browser_action ||
    !manifest.browser_action.theme_icons
  ) {
    return undefined
  }

  const context = path.dirname(manifestPath)
  for (const themeIcon of manifest.browser_action.theme_icons as ThemeIcon[]) {
    if (themeIcon.light) {
      const lightThemeIconAbsolutePath = path.resolve(context, themeIcon.light)
      themeIcon.light = lightThemeIconAbsolutePath
    }

    if (themeIcon.dark) {
      const darkThemeIconAbsolutePath = path.resolve(context, themeIcon.dark)
      themeIcon.dark = darkThemeIconAbsolutePath
    }

    if (themeIcon.size) delete themeIcon.size
  }

  return manifest.browser_action.theme_icons
}
