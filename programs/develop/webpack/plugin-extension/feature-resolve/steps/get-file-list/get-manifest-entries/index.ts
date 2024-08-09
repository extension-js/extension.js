import {backgroundScripts} from './background'
import {serviceWorker} from './service_worker'
import {contentScripts} from './content_scripts'
import {userScripts} from './user_scripts'
import {action} from './action'
import {background} from './background.page'
import {browserAction} from './browser_action'
import {chromeUrlOverrides} from './chrome_url_overrides'
import {devtoolsPage} from './devtools_page'
import {optionsUi} from './options_ui'
import {pageAction} from './page_action'
import {sandbox} from './sandbox'
import {sidePanel} from './side_panel'
import {sidebarAction} from './sidebar_action'
import {type ManifestData} from './types'

export function getManifestEntries(
  manifest: ManifestData
): Record<string, string | string[] | undefined> {
  return {
    [`background/scripts.js`]: backgroundScripts(manifest),
    [`background/service_worker.js`]: serviceWorker(manifest),
    // read as content_scripts/content-0.js
    ...contentScripts(manifest),
    [`user_scripts/apiscript.js`]: userScripts(manifest),
    [`action/default_popup.html`]: action(manifest),
    'background/page.html': background(manifest),
    'browser_action/default_popup.html': browserAction(manifest),
    // read as chrom_settings_overrides/newtab.html
    ...chromeUrlOverrides(manifest),
    [`devtools_page.html`]: devtoolsPage(manifest),
    [`options_ui/page.html`]: optionsUi(manifest),
    [`page_action/default_popup.html`]: pageAction(manifest),
    // read as sandbox/page-0.html
    ...sandbox(manifest),
    [`side_panel/default_path.html`]: sidePanel(manifest),
    [`sidebar_action/default_panel.html`]: sidebarAction(manifest)
  }
}
