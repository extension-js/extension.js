import {type ManifestData} from '../../types'
import action from './action'
import browserAction from './browser_action'
import browserActionThemeIcons from './browser_action.theme_icons'
import chromeSettingsOverrides from './chrome_settings_overrides'
import icons from './icons'
import pageAction from './page_action'
import sidebarAction from './sidebar_action'

export default function getIconsFields(
  manifestPath: string,
  manifest: ManifestData
) {
  return {
    'action/default_icon': action(manifestPath, manifest),
    'browser_action/default_icon': browserAction(manifestPath, manifest),
    'browser_action/theme_icons': browserActionThemeIcons(
      manifestPath,
      manifest
    ),
    'chrome_settings_overrides/favicon_url': chromeSettingsOverrides(
      manifestPath,
      manifest
    ),
    icons: icons(manifestPath, manifest),
    'page_action/default_icon': pageAction(manifestPath, manifest),
    'sidebar_action/default_icon': sidebarAction(manifestPath, manifest)
  }
}
