//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {RuleSetRule} from '@rspack/core'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../plugin-web-extension/feature-scripts/contracts'
import type {DevOptions} from '../types'
import {buildCssRules, type PreprocessorUsage} from './css-lib/build-css-rules'

export async function cssInHtmlLoader(
  projectPath: string,
  mode: DevOptions['mode'],
  manifestPath: string,
  usage: PreprocessorUsage = {}
): Promise<RuleSetRule[]> {
  // Real stylesheets: anything no content script imports, plus a sheet the
  // manifest declares for a content script, which is an entry with no issuer.
  return [
    ...(await buildCssRules(projectPath, mode, usage, {
      nonModuleType: 'css',
      issuerLayer: {not: EXTENSIONJS_CONTENT_SCRIPT_LAYER},
      manifestPath
    })),
    ...(await buildCssRules(projectPath, mode, usage, {
      nonModuleType: 'css',
      issuerLayer: EXTENSIONJS_CONTENT_SCRIPT_LAYER,
      issuer: {not: /./},
      manifestPath
    }))
  ]
}
