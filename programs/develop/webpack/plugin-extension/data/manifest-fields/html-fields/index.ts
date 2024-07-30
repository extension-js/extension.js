import {action} from './action'
import {browserAction} from './browser_action'
import {chromeUrlOverrides} from './chrome_url_overrides'
import {devtoolsPage} from './devtools_page'
import {optionsUi} from './options_ui'
import {pageAction} from './page_action'
import {sandbox} from './sandbox'
import {sidePanel} from './side_panel'
import {sidebarAction} from './sidebar_action'
import {type Manifest} from '../../../../webpack-types'

export function htmlFields(
  context: string,
  manifest: Manifest
): Record<string, string | undefined> {
  return {
    'action/default_popup': action(context, manifest),
    'browser_action/default_popup': browserAction(context, manifest),
    // read as: chrome_url_overrides/<history | newtab | settings | ...>: chromeUrlOverrides(manifest),
    ...chromeUrlOverrides(context, manifest),
    devtools_page: devtoolsPage(context, manifest),
    'options_ui/page': optionsUi(context, manifest),
    'page_action/default_popup': pageAction(context, manifest),
    // read as: sandbox/page-<index>: sandbox(context, manifest),
    ...sandbox(context, manifest),
    'side_panel/default_path': sidePanel(context, manifest),
    'sidebar_action/default_panel': sidebarAction(context, manifest)
  }
}
