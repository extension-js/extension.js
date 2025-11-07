import {backgroundPage} from './background'
import {chromeUrlOverrides} from './chrome_url_overrides'
import {contentScripts} from './content_scripts'
import {devtoolsPage} from './devtools_page'
import {icons} from './icons'
import {commands} from './commands'
import {permissions} from './permissions'
import {optionsPage} from './options_page'
import {optionsUi} from './options_ui'
import {sandbox} from './sandbox'
import {storage} from './storage'
import {theme} from './theme'
import {userScripts} from './user_scripts'
import {webAccessibleResources} from './web_accessible_resources'
import {contentSecurityPolicy} from './content_security_policy'
import {omnibox} from './omnibox'
import {type Manifest} from '../../../../webpack-types'

export function manifestCommon(manifest: Manifest) {
  return {
    ...backgroundPage(manifest),
    ...chromeUrlOverrides(manifest),
    ...contentScripts(manifest),
    ...devtoolsPage(manifest),
    ...icons(manifest),
    ...commands(manifest),
    ...permissions(manifest),
    ...optionsPage(manifest),
    ...optionsUi(manifest),
    ...sandbox(manifest),
    ...storage(manifest),
    ...theme(manifest),
    ...userScripts(manifest),
    ...webAccessibleResources(manifest),
    ...contentSecurityPolicy(manifest),
    ...omnibox(manifest)
  }
}
