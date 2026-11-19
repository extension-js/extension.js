// ██╗      ██████╗  █████╗ ██████╗ ███████╗██████╗
// ██║     ██╔═══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ██║     ██║   ██║███████║██║  ██║█████╗  ██████╔╝
// ██║     ██║   ██║██╔══██║██║  ██║██╔══╝  ██╔══██╗
// ███████╗╚██████╔╝██║  ██║██████╔╝███████╗██║  ██║
// ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {isGeckoBasedBrowser} from '../../lib/constants'
import type {DevOptions, Manifest} from '../../types'
import {getBackgroundWorkerEntryName} from '../feature-scripts/scripts-lib/utils'

// The background entry name the chunk-loading target keys its runtime off.
// It names only an entry AddScripts creates from the authored manifest, and
// names none where the author declared no background that becomes one.
export function getBackgroundEntryName(
  manifest: Manifest,
  browser: DevOptions['browser'],
  context: {manifestDir: string; projectPath?: string}
): {
  pageEntry?: string
  serviceWorkerEntry?: string
} {
  if (manifest.background) {
    // A background page is compiled as the background/index HTML surface, so
    // the runtime belongs in that entry and not in a script entry nothing loads.
    const backgroundPage = manifest.background.page
    const backgroundScripts = manifest.background.scripts
    const hasScripts =
      Array.isArray(backgroundScripts) && backgroundScripts.length > 0
    const hasScriptEntry = Boolean(
      manifest.background.service_worker || hasScripts
    )
    // Every background.scripts file is bundled into the one
    // background/scripts entry, which Gecko and MV2 run as a page.
    const scriptsPageEntry = hasScripts ? {pageEntry: 'background/scripts'} : {}

    if (
      typeof backgroundPage === 'string' &&
      backgroundPage &&
      !hasScriptEntry
    ) {
      return {
        pageEntry: 'background/index'
      }
    }

    if (isGeckoBasedBrowser(String(browser))) {
      return scriptsPageEntry
    }

    if (manifest.manifest_version === 3) {
      const serviceWorkerEntry = getBackgroundWorkerEntryName({
        manifest,
        browser,
        manifestDir: context.manifestDir,
        projectPath: context.projectPath
      })

      // A worker file that is missing gets no entry, so none is named and
      // the scripts feature reports the missing file.
      if (!serviceWorkerEntry) {
        return {}
      }

      return {
        serviceWorkerEntry
      }
    }

    if (manifest.manifest_version === 2) {
      return scriptsPageEntry
    }
  }

  return {}
}
