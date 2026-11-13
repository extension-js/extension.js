// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {
  isChromiumBasedBrowser,
  isGeckoBasedBrowser
} from '../../../lib/constants'
import {replaceCssUrlRefs} from '../../../plugin-css/css-lib/dead-url-refs'
import {parseCanonicalContentScriptAsset} from '../contracts'
import {runtimeScriptSheetName} from './runtime-script-sheet'

// Chromium fills the id in as it loads a sheet from the extension, in the
// manifest css list, a registration and an insertCSS file alike.
export const CHROMIUM_EXTENSION_ROOT =
  'chrome-extension://__MSG_@@extension_id__/'

// Firefox fills the id in as it serves the file, so a sheet a script fetches
// and places itself reads the same address the injected one does.
export const GECKO_EXTENSION_ROOT = 'moz-extension://__MSG_@@extension_id__/'

// Undefined for an engine no measurement covers, whose sheet keeps its bytes.
export function injectedSheetRoot(browser: string): string | undefined {
  if (isChromiumBasedBrowser(browser)) return CHROMIUM_EXTENSION_ROOT
  if (isGeckoBasedBrowser(browser)) return GECKO_EXTENSION_ROOT

  return undefined
}

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

// A sheet on the visited page reads a url() against that page, injected on
// Chromium or placed by a script on Firefox, so a root target names the extension.
export function rootedAtExtension(
  css: string,
  root: string = CHROMIUM_EXTENSION_ROOT
): string {
  return replaceCssUrlRefs(css, (request) =>
    request.startsWith('/') && !request.startsWith('//')
      ? `${root}${request.slice(1)}`
      : undefined
  )
}
