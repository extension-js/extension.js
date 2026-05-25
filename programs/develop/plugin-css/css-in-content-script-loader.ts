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
import type {DevOptions} from '../types'

export async function cssInContentScriptLoader(
  projectPath: string,
  manifestPath: string,
  mode: DevOptions['mode'],
  usage: PreprocessorUsage = {}
): Promise<RuleSetRule[]> {
  return buildCssRules(projectPath, mode, usage, {
    nonModuleType: 'asset/inline',
    issuer: (issuer) => isContentScriptEntry(issuer, manifestPath, projectPath)
  })
}
