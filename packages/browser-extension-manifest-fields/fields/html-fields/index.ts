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
import {type Manifest, type ManifestHtmlData} from '../../types'

export default function getHtmlFields(
  manifestPath: string,
  manifest: Manifest
): {[key: string]: ManifestHtmlData} {
  return {
    'action/default_popup': action(manifestPath, manifest),
    'background/page': background(manifestPath, manifest),
    'browser_action/default_popup': browserAction(manifestPath, manifest),
    'chrome_settings_overrides/homepage': chromeSettingsOverrides(
      manifestPath,
      manifest
    ),
    // read as: chrome_url_overrides/<history | newtab | settings | ...>: chromeUrlOverrides(manifestPath, manifest),
    ...chromeUrlOverrides(manifestPath, manifest),
    devtools_page: devtoolsPage(manifestPath, manifest),
    'options_ui/page': optionsUi(manifestPath, manifest),
    'page_action/default_popup': pageAction(manifestPath, manifest),
    // read as: sandbox/page-<index>: sandbox(manifestPath, manifest),
    ...sandbox(manifestPath, manifest),
    'side_panel/default_path': sidePanel(manifestPath, manifest),
    'sidebar_action/default_panel': sidebarAction(manifestPath, manifest)
  }
}
