// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {replaceCssUrlRefs} from '../../../plugin-css/css-lib/dead-url-refs'
import {parseCanonicalContentScriptAsset} from '../contracts'
import {runtimeScriptSheetName} from './runtime-script-sheet'

// Chromium fills the id in as it loads a sheet from the extension, in the
// manifest css list, a registration and an insertCSS file alike.
export const CHROMIUM_EXTENSION_ROOT =
  'chrome-extension://__MSG_@@extension_id__/'

// A sheet the browser puts on the visited page itself, by its emitted name.
export function isInjectedSheet(
  assetName: string,
  runtimeEntries: string[]
): boolean {
  if (parseCanonicalContentScriptAsset(assetName)?.extension === 'css') {
    return true
  }

  return runtimeEntries.some(
    (entryName) => runtimeScriptSheetName(entryName) === assetName
  )
}

// Chromium reads a url() in an injected sheet against the visited page, so
// a target named from the output root is named from the extension instead.
export function rootedAtExtension(css: string): string {
  return replaceCssUrlRefs(css, (request) =>
    request.startsWith('/') && !request.startsWith('//')
      ? `${CHROMIUM_EXTENSION_ROOT}${request.slice(1)}`
      : undefined
  )
}
