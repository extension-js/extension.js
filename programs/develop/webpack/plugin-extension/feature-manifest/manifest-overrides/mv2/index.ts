import {background} from './background'
import {browserAction} from './browser_action'
import {chromeSettingsOverrides} from './chrome_settings_overrides.ts'
import {pageAction} from '../common/page_action'
import {sidebarAction} from '../common/sidebar_action'
import {themeExperiment} from './theme_experiment'
import {type Manifest, type FilepathList} from '../../../../webpack-types'

export function manifestV2(manifest: Manifest, excludeList: FilepathList) {
  return {
    ...background(manifest, excludeList),
    ...browserAction(manifest, excludeList),
    ...pageAction(manifest, excludeList),
    ...sidebarAction(manifest, excludeList),
    ...chromeSettingsOverrides(manifest, excludeList),
    ...themeExperiment(manifest, excludeList)
  }
}
