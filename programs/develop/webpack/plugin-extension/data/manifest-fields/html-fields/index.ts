import {action as mv3Action} from './action'
import {browserAction as mv2BrowserAction} from './browser_action'
import {chromeUrlOverrides} from './chrome_url_overrides'
import {devtoolsPage} from './devtools_page'
import {optionsUi} from './options_ui'
import {pageAction as mv2PageAction} from './page_action'
import {sandbox} from './sandbox'
import {sidePanel} from './side_panel'
import {sidebarAction} from './sidebar_action'
import {background} from './background'
import {type Manifest} from '../../../../webpack-types'

export function htmlFields(
  context: string,
  manifest: Manifest
): Record<string, string | undefined> {
  const actionPath =
    mv3Action(context, manifest) ||
    mv2BrowserAction(context, manifest) ||
    mv2PageAction(context, manifest)

  const sidebarPath =
    sidePanel(context, manifest) || sidebarAction(context, manifest)
  const optionsPath = optionsUi(context, manifest)
  const backgroundPath = background(context, manifest)
  const devtoolsPath = devtoolsPage(context, manifest)

  return {
    ...(actionPath ? {'action/index': actionPath} : {}),
    // read as: chrome_url_overrides/<history | newtab | settings | ...>: chromeUrlOverrides(manifest),
    ...chromeUrlOverrides(context, manifest),
    ...(devtoolsPath ? {'devtools/index': devtoolsPath} : {}),
    ...(optionsPath ? {'options/index': optionsPath} : {}),
    ...(backgroundPath ? {'background/index': backgroundPath} : {}),
    // read as: sandbox/page-<index>: sandbox(context, manifest),
    ...sandbox(context, manifest),
    ...(sidebarPath ? {'sidebar/index': sidebarPath} : {})
  }
}
