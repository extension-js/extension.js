import backgroundScript from './background'
import chromeSettingsOverrides from './chrome_settings_overrides'
import chromeUrlOverrides from './chrome_url_overrides'
import contentScripts from './content_scripts'
import devtoolsPage from './devtools_page'
import icons from './icons'
import optionsPage from './options_page'
import optionsUi from './options_ui'
import pageAction from './page_action'
import sandbox from './sandbox'
import sidePanel from '../mv3/side_panel'
import sidebarAction from './sidebar_action'
import storage from './storage'
import theme from './theme'
import userScripts from './user_scripts'
import webAccessibleResources from './web_accessible_resources'
import {type ManifestData} from '../types'

function manifestCommon(manifest: ManifestData, exclude: string[]) {
  return {
    ...backgroundScript(manifest, exclude),
    ...chromeSettingsOverrides(manifest, exclude),
    ...chromeUrlOverrides(manifest, exclude),
    ...contentScripts(manifest, exclude),
    ...devtoolsPage(manifest, exclude),
    ...icons(manifest, exclude),
    ...optionsPage(manifest, exclude),
    ...optionsUi(manifest, exclude),
    ...pageAction(manifest, exclude),
    ...sandbox(manifest, exclude),
    ...sidePanel(manifest, exclude),
    ...sidebarAction(manifest, exclude),
    ...storage(manifest, exclude),
    ...theme(manifest, exclude),
    ...userScripts(manifest, exclude),
    ...webAccessibleResources(manifest, exclude)
  }
}

export default manifestCommon
