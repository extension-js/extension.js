import {backgroundPage} from './background'
import {chromeUrlOverrides} from './chrome_url_overrides'
import {contentScripts} from './content_scripts'
import {devtoolsPage} from './devtools_page'
import {icons} from './icons'
import {optionsPage} from './options_page'
import {optionsUi} from './options_ui'
import {pageAction} from './page_action'
import {sandbox} from './sandbox'
import {sidePanel} from '../mv3/side_panel'
import {sidebarAction} from './sidebar_action'
import {storage} from './storage'
import {theme} from './theme'
import {userScripts} from './user_scripts'
import {webAccessibleResources} from './web_accessible_resources'
import {type Manifest, type FilepathList} from '../../../../webpack-types'

export function manifestCommon(manifest: Manifest, excludeList: FilepathList) {
  return {
    ...backgroundPage(manifest, excludeList),
    ...chromeUrlOverrides(manifest, excludeList),
    ...contentScripts(manifest, excludeList),
    ...devtoolsPage(manifest, excludeList),
    ...icons(manifest, excludeList),
    ...optionsPage(manifest, excludeList),
    ...optionsUi(manifest, excludeList),
    ...pageAction(manifest, excludeList),
    ...sandbox(manifest, excludeList),
    ...sidePanel(manifest, excludeList),
    ...sidebarAction(manifest, excludeList),
    ...storage(manifest, excludeList),
    ...theme(manifest, excludeList),
    ...userScripts(manifest, excludeList),
    ...webAccessibleResources(manifest)
  }
}
