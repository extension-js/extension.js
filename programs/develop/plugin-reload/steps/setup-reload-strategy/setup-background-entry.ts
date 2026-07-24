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
import {isStaticTheme} from '../../../lib/manifest-utils'
import {stripBom} from '../../../lib/parse-json-safe'
import {filterKeysForThisBrowser} from '../../../plugin-web-extension/feature-manifest/manifest-lib/manifest'
import {reportToCompilation} from '../../../plugin-web-extension/shared/compilation-issues'
import type {DevOptions, Manifest} from '../../../types'
import * as reloadMessages from '../../messages'

export class SetupBackgroundEntry {
  private manifestPath: string
  private browser: DevOptions['browser']

  constructor(options: {
    manifestPath: string
    browser?: DevOptions['browser']
  }) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  private getMissingBackgroundError(bgFile: string) {
    if (!fs.existsSync(bgFile) && this.manifestPath) {
      const manifest = JSON.parse(
        stripBom(fs.readFileSync(this.manifestPath, 'utf8'))
      )
      const patched = filterKeysForThisBrowser(manifest, this.browser)
      const fieldKey =
        patched.manifest_version === 3
          ? 'background/service_worker'
          : 'background/scripts'
      return reloadMessages.backgroundIsRequiredMessageOnly(fieldKey)
    }
    return undefined
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
    const manifest = JSON.parse(
      stripBom(fs.readFileSync(this.manifestPath, 'utf-8'))
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

    function hookError(maybeError: string) {
      compiler.hooks.thisCompilation.tap(
        'run-chromium:setup-background-entry',
        (compilation) => {
          reportToCompilation(compilation, compiler, maybeError, 'error')
        }
      )
    }

    if (isGecko) {
      const bgScripts = manifestBg?.scripts

      if (bgScripts && bgScripts.length > 0) {
        const bgScriptPath = path.join(dirname, bgScripts[0])
        const maybeError = this.getMissingBackgroundError(bgScriptPath)
        if (maybeError) hookError(maybeError)
      } else {
        this.addDefaultEntry(compiler, 'background/script', minimumBgScript)
      }
      return
    }

    // Safari resolves neither chromium: nor firefox: prefixed manifest_version, so
    // the default branch must register the service-worker entry patch-background expects.
    if (manifestVersion === 2) {
      const bgScripts = manifestBg?.scripts

      if (bgScripts && bgScripts.length > 0) {
        const bgScriptPath = path.join(dirname, bgScripts[0])
        const maybeError = this.getMissingBackgroundError(bgScriptPath)

        if (maybeError) hookError(maybeError)
      } else {
        this.addDefaultEntry(compiler, 'background/script', minimumBgScript)
      }
    } else {
      const serviceWorker = manifestBg?.service_worker
      if (serviceWorker) {
        const swPath = path.join(dirname, serviceWorker)
        const maybeError = this.getMissingBackgroundError(swPath)

        if (maybeError) hookError(maybeError)

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
      }
    }
  }
}
