import action from './action'
import background from './background'
import browserAction from './browser_action'
import chromeSettingsOverrides from './chrome_settings_overrides'
import chromeUrlOverrides from './chrome_url_overrides'
import devtoolsPage from './devtools_page'
import optionsUi from './options_ui'
import pageAction from './page_action'
import sandbox from './sandbox'
import sidePanel from './side_panel'
import sidebarAction from './sidebar_action'
import {type ManifestData} from '../../types'

export default function getHtmlFields(
  manifestPath: string,
  manifest: ManifestData
) {
  return {
    action: action(manifestPath, manifest),
    background: background(manifestPath, manifest),
    browser_action: browserAction(manifestPath, manifest),
    chrome_settings_overrides: chromeSettingsOverrides(manifestPath, manifest),
    chrome_url_overrides: chromeUrlOverrides(manifestPath, manifest),
    devtools_page: devtoolsPage(manifestPath, manifest),
    options_ui: optionsUi(manifestPath, manifest),
    page_action: pageAction(manifestPath, manifest),
    ...sandbox(manifestPath, manifest),
    side_panel: sidePanel(manifestPath, manifest),
    sidebar_action: sidebarAction(manifestPath, manifest)
  }
}
