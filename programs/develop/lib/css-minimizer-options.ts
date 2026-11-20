// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {DevOptions, Manifest} from '../types'
import {resolveEngineTargets} from './swc-targets'

// Minifying must not rewrite selectors the author wrote: lowering :dir() and
// :lang() lists expands one rule into dozens and grew real sheets twelvefold.
export function cssMinimizerOptions(
  rawManifest: unknown,
  browser: DevOptions['browser'] | string | undefined
) {
  return {
    targets: resolveEngineTargets(rawManifest as Manifest | undefined, browser),
    exclude: {dirSelector: true, langSelectorList: true}
  }
}
