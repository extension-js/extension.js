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
    action: action(manifestPath, manifest),
    browser_action: browserAction(manifestPath, manifest),
    'browser_action/theme_icons': browserActionThemeIcons(
      manifestPath,
      manifest
    ),
    chrome_settings_overrides: chromeSettingsOverrides(manifestPath, manifest),
    icons: icons(manifestPath, manifest),
    page_action: pageAction(manifestPath, manifest),
    sidebar_action: sidebarAction(manifestPath, manifest)
  }
}
