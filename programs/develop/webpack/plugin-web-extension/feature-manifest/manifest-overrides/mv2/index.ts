// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {background} from './background'
import {browserAction} from './browser_action'
import {chromeSettingsOverrides} from './chrome_settings_overrides.ts'
import {pageAction} from '../common/page_action'
import {sidebarAction} from '../common/sidebar_action'
import {themeExperiment} from './theme_experiment'
import {type Manifest} from '../../../../webpack-types.ts'

export function manifestV2(manifest: Manifest) {
  return {
    ...background(manifest),
    ...browserAction(manifest),
    ...pageAction(manifest),
    ...sidebarAction(manifest),
    ...chromeSettingsOverrides(manifest),
    ...themeExperiment(manifest)
  }
}
