import backgroundScripts from './background'
import serviceWorker from './service_worker'
import contentScripts from './content_scripts'
import userScripts from './user_scripts'
import action from './action'
import background from './background.page'
import browserAction from './browser_action'
import chromeSettingsOverrides from './chrome_settings_overrides'
import chromeUrlOverrides from './chrome_url_overrides'
import devtoolsPage from './devtools_page'
import optionsUi from './options_ui'
import pageAction from './page_action'
import sandbox from './sandbox'
import sidePanel from './side_panel'
import sidebarAction from './sidebar_action'
import {type ManifestData} from './types'

export default function getManifestEntries(manifest: ManifestData): {
  [key: string]: string | string[] | undefined
} {
  return {
    [`background/script.js`]: backgroundScripts(manifest),
    [`background/service_worker.js`]: serviceWorker(manifest),
    ...contentScripts(manifest),
    [`user_scripts/apiscript.js`]: userScripts(manifest),
    [`action/index.html`]: action(manifest),
    ['background/index.html']: background(manifest),
    ['browser_action/index.html']: browserAction(manifest),
    [`chrome_settings_overrides/index.html`]: chromeSettingsOverrides(manifest),
    [`chrome_url_overrides/index.html`]: chromeUrlOverrides(manifest),
    [`devtools_page/index.html`]: devtoolsPage(manifest),
    [`options_ui/index.html`]: optionsUi(manifest),
    [`page_action/index.html`]: pageAction(manifest),
    ...sandbox(manifest),
    [`side_panel/index.html`]: sidePanel(manifest),
    [`sidebar_action/index.html`]: sidebarAction(manifest)
  }
}
