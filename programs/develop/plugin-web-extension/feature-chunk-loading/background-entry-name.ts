// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {isGeckoBasedBrowser} from '../../lib/constants'
import type {DevOptions, Manifest} from '../../types'
import {getBackgroundWorkerEntryName} from '../feature-scripts/scripts-lib/utils'

// The background entry name the chunk-loading target keys its runtime off.
// It resolves against the entries AddScripts will actually create, so both
// the dev reload strategy and the production chunk-loading target can share it.
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
    const hasScriptEntry = Boolean(
      manifest.background.service_worker ||
        (Array.isArray(backgroundScripts) && backgroundScripts.length > 0)
    )

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
      return {
        pageEntry: 'background/script'
      }
    }

    if (manifest.manifest_version === 3) {
      const serviceWorkerEntry = getBackgroundWorkerEntryName({
        manifest,
        browser,
        manifestDir: context.manifestDir,
        projectPath: context.projectPath
      })

      // Naming an entry that will not exist makes the fork assert at
      // entryOption and kill the build before the scripts feature can report
      // the real problem, such as a missing service worker file.
      if (!serviceWorkerEntry) {
        return {}
      }

      return {
        serviceWorkerEntry
      }
    }

    if (manifest.manifest_version === 2) {
      return {
        pageEntry: 'background/script'
      }
    }
  }

  return {
    pageEntry: 'background'
  }
}
