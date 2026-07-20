// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {Manifest} from '../../../../types'
import {backgroundPage} from './background'
import {chromeUrlOverrides} from './chrome_url_overrides'
import {commands} from './commands'
import {contentScripts} from './content_scripts'
import {contentSecurityPolicy} from './content_security_policy'
import {devtoolsPage} from './devtools_page'
import {icons} from './icons'
import {omnibox} from './omnibox'
import {optionsPage} from './options_page'
import {optionsUi} from './options_ui'
import {permissions} from './permissions'
import {sandbox} from './sandbox'
import {storage} from './storage'
import {theme} from './theme'
import {userScripts} from './user_scripts'
import {webAccessibleResources} from './web_accessible_resources'

export function manifestCommon(manifest: Manifest, manifestPath?: string) {
  return {
    ...backgroundPage(manifest),
    ...chromeUrlOverrides(manifest, manifestPath),
    ...contentScripts(manifest, manifestPath),
    ...devtoolsPage(manifest, manifestPath),
    ...icons(manifest),
    ...commands(manifest),
    ...permissions(manifest),
    ...optionsPage(manifest, manifestPath),
    ...optionsUi(manifest, manifestPath),
    ...sandbox(manifest),
    ...storage(manifest),
    ...theme(manifest),
    ...userScripts(manifest),
    ...webAccessibleResources(manifest),
    ...contentSecurityPolicy(manifest),
    ...omnibox(manifest)
  }
}
