// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {isGeckoBasedBrowser} from '../../../lib/constants'
import {resolveDevelopDistFile} from '../../../lib/develop-context'
import {
  filterKeysForThisBrowser,
  isStaticTheme
} from '../../../lib/manifest-utils'
import {parseAuthoredJson} from '../../../lib/parse-json-safe'
import type {DevOptions, Manifest} from '../../../types'

export class SetupBackgroundEntry {
  // The entry this step generated for a manifest that declares no
  // background the browser can run, set once the step is applied.
  public generated?: {pageEntry?: string; serviceWorkerEntry?: string}

  private manifestPath: string
  private browser: DevOptions['browser']

  constructor(options: {
    manifestPath: string
    browser?: DevOptions['browser']
  }) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  private addDefaultEntry(
    compiler: Compiler,
    name: string,
    defaultScript: string
  ) {
    compiler.options.entry = {
      ...compiler.options.entry,
      [name]: {import: [defaultScript]}
    }
  }

  apply(compiler: Compiler) {
    // Guards are handled at the root plugin level
    const manifest = parseAuthoredJson<Manifest>(
      fs.readFileSync(this.manifestPath, 'utf-8')
    )
    const browser = this.browser
    // Gecko family (firefox + forks) gets the gecko reload helper; everything else
    // (chromium family + Safari/webkit) gets the chromium one.
    const isGecko = isGeckoBasedBrowser(String(browser))
    const minimumBgScript = resolveDevelopDistFile(
      isGecko ? 'minimum-firefox-file' : 'minimum-chromium-file'
    )
    const dirname = path.dirname(this.manifestPath)
    const filteredManifest =
      (filterKeysForThisBrowser(manifest, browser) as Manifest) || manifest
    const manifestBg = filteredManifest?.background ?? manifest.background
    const manifestVersion =
      filteredManifest?.manifest_version ?? manifest.manifest_version

    // A static theme has nothing to reload and no place to host a background
    // script; adding one turns the dist into something that is not a theme.
    if (isStaticTheme(filteredManifest)) return

    // A declared background page is the background context, and the built
    // manifest keeps naming it, so a default script entry here loads nowhere.
    const hasBackgroundPage = Boolean(manifestBg?.page)

    if (isGecko) {
      const bgScripts = manifestBg?.scripts

      if (!bgScripts?.length && !hasBackgroundPage) {
        this.addDefaultEntry(compiler, 'background/script', minimumBgScript)
        this.generated = {pageEntry: 'background/script'}
      }

      return
    }

    // Safari resolves neither chromium: nor firefox: prefixed manifest_version, so
    // the default branch must register the service-worker entry patch-background expects.
    if (manifestVersion === 2) {
      const bgScripts = manifestBg?.scripts

      if (!bgScripts?.length && !hasBackgroundPage) {
        this.addDefaultEntry(compiler, 'background/script', minimumBgScript)
        this.generated = {pageEntry: 'background/script'}
      }
    } else {
      const serviceWorker = manifestBg?.service_worker

      if (serviceWorker) {
        // A missing file is the scripts feature's report, in every mode.
        const swPath = path.join(dirname, serviceWorker)
        const existingEntry =
          compiler.options.entry &&
          'background/service_worker' in compiler.options.entry
            ? compiler.options.entry['background/service_worker']
            : undefined

        if (!existingEntry && fs.existsSync(swPath)) {
          this.addDefaultEntry(compiler, 'background/service_worker', swPath)
        }
      } else {
        this.addDefaultEntry(
          compiler,
          'background/service_worker',
          minimumBgScript
        )

        this.generated = {serviceWorkerEntry: 'background/service_worker'}
      }
    }
  }
}
