// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {Compiler} from '@rspack/core'
import * as messages from '../../scripts-lib/messages'
import {reportToCompilation} from '../../scripts-lib/utils'
import {filterKeysForThisBrowser} from '../../scripts-lib/manifest'
import {type DevOptions} from '../../../../webpack-types'

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
      const manifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'))
      const patched = filterKeysForThisBrowser(manifest, this.browser)
      const fieldKey =
        patched.manifest_version === 3
          ? 'background/service_worker'
          : 'background/scripts'
      return messages.backgroundIsRequiredMessageOnly(fieldKey)
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
    const manifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'))
    const browser = this.browser
    const minimumBgScript = path.resolve(
      __dirname,
      browser === 'firefox' || browser === 'gecko-based'
        ? 'minimum-firefox-file'
        : 'minimum-chromium-file'
    )
    const dirname = path.dirname(this.manifestPath)
    let manifestBg = filterKeysForThisBrowser(manifest, browser)
    manifestBg = manifestBg?.background ?? manifest.background

    function hookError(maybeError: string) {
      compiler.hooks.thisCompilation.tap(
        'run-chromium:setup-background-entry',
        (compilation) => {
          reportToCompilation(compilation, compiler, maybeError, 'error')
        }
      )
    }

    if (browser === 'firefox' || browser === 'gecko-based') {
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

    // chromium / manifest v3 or v2
    if (manifest.manifest_version === 3) {
      const serviceWorker = manifestBg?.service_worker
      if (serviceWorker) {
        const swPath = path.join(dirname, serviceWorker)
        const maybeError = this.getMissingBackgroundError(swPath)

        if (maybeError) hookError(maybeError)

        const existingEntry =
          compiler.options.entry && 'background/service_worker' in compiler.options.entry
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
    } else if (manifest.manifest_version === 2) {
      const bgScripts = manifestBg?.scripts

      if (bgScripts && bgScripts.length > 0) {
        const bgScriptPath = path.join(dirname, bgScripts[0])
        const maybeError = this.getMissingBackgroundError(bgScriptPath)

        if (maybeError) hookError(maybeError)
      } else {
        this.addDefaultEntry(compiler, 'background/script', minimumBgScript)
      }
    }
  }
}
