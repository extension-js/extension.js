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

export async function cssInContentScriptLoader(
  projectPath: string,
  manifestPath: string,
  mode: DevOptions['mode'],
  usage: PreprocessorUsage = {}
): Promise<RuleSetRule[]> {
  return buildCssRules(projectPath, mode, usage, {
    nonModuleType: 'asset/inline',
    // The layer follows the whole import graph, so a component's stylesheet
    // is inlined too. A manifest-declared sheet has no issuer and stays a file.
    issuerLayer: EXTENSIONJS_CONTENT_SCRIPT_LAYER,
    issuer: /./,
    manifestPath
  })
}
