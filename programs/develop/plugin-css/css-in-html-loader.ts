//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {RuleSetRule} from '@rspack/core'
import {isContentScriptEntry} from './css-lib/is-content-script'
import {buildCssRules, type PreprocessorUsage} from './css-lib/build-css-rules'
import type {DevOptions} from './types'

export async function cssInHtmlLoader(
  projectPath: string,
  mode: DevOptions['mode'],
  manifestPath: string,
  usage: PreprocessorUsage = {}
): Promise<RuleSetRule[]> {
  // HTML entries emit a real stylesheet (css) and match everything that is NOT
  // a content script.
  return buildCssRules(projectPath, mode, usage, {
    nonModuleType: 'css',
    issuer: (issuer) => !isContentScriptEntry(issuer, manifestPath, projectPath)
  })
}
