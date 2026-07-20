//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {RuleSetRule} from '@rspack/core'
import type {DevOptions} from '../types'
import {buildCssRules, type PreprocessorUsage} from './css-lib/build-css-rules'
import {isContentScriptEntry} from './css-lib/is-content-script'

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
