// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {resolveSwcTargets} from '../plugin-js-frameworks/swc-targets'
import type {DevOptions, Manifest} from '../types'

// Minifying must not rewrite selectors the author wrote: lowering :dir() and
// :lang() lists expands one rule into dozens and grew real sheets twelvefold.
export function cssMinimizerOptions(
  rawManifest: unknown,
  browser: DevOptions['browser'] | string | undefined
) {
  return {
    targets: resolveSwcTargets(rawManifest as Manifest | undefined, browser),
    exclude: {dirSelector: true, langSelectorList: true}
  }
}
