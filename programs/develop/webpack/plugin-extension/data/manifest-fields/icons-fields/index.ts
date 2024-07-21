import {action} from './action'
import {browserAction} from './browser_action'
import {browserActionThemeIcons} from './browser_action.theme_icons'
import {icons} from './icons'
import {pageAction} from './page_action'
import {sidebarAction} from './sidebar_action'
import {type Manifest, type ThemeIcon} from '../../../../types'

export function iconFields(
  context: string,

  manifest: Manifest
): Record<string, string | string[] | ThemeIcon[] | undefined> {
  return {
    action: action(context, manifest),
    browser_action: browserAction(context, manifest),
    'browser_action/theme_icons': browserActionThemeIcons(context, manifest),
    icons: icons(context, manifest),
    page_action: pageAction(context, manifest),
    sidebar_action: sidebarAction(context, manifest)
  }
}
