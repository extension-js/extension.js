import fs from 'fs'
import path from 'path'
import type webpack from 'webpack'
import WebExtension from 'webpack-target-webextension'
import {type RunChromeExtensionInterface} from '../../../types'
import messages from '../../../helpers/messages'
import {Manifest} from '../../../types'

class TargetWebExtensionPlugin {
  private readonly manifestPath?: string

  constructor(options: RunChromeExtensionInterface) {
    this.manifestPath = options.manifestPath
  }

  private handleMissingBackground(manifest: Manifest) {
    if (manifest.manifest_version === 3) {
      if (manifest.background.service_worker) {
        const serviceWorker = manifest.background.service_worker
        const serviceWorkerPath = path.join(
          path.dirname(this.manifestPath!),
          serviceWorker
        )

        if (!fs.existsSync(serviceWorkerPath)) {
          const fieldError = messages.manifestFieldError(
            'background.service_worker',
            serviceWorkerPath
          )
          throw Error(fieldError)
        }
      }
    }

    if (manifest.background.scripts) {
      const backgroundScripts = manifest.background.scripts
      const backgroundPath = path.join(
        path.dirname(this.manifestPath!),
        backgroundScripts[0]
      )

      if (!fs.existsSync(backgroundPath)) {
        const fieldError = messages.manifestFieldError(
          'background.scripts',
          backgroundPath
        )
        throw Error(fieldError)
      }
    }
  }

  private getEntryName(manifestPath: string) {
    const manifest = require(manifestPath)

    if (manifest.background) {
      if (manifest.manifest_version === 3) {
        return {serviceWorkerEntry: 'background/service_worker'}
      }

      if (manifest.manifest_version === 2) {
        return {pageEntry: 'background/script'}
      }
    }

    return {pageEntry: 'background'}
  }

  public apply(compiler: webpack.Compiler) {
    if (!this.manifestPath || !fs.lstatSync(this.manifestPath).isFile()) {
      return
    }

    const manifest = require(this.manifestPath)

    if (manifest.background) {
      this.handleMissingBackground(manifest)
    }

    new WebExtension({
      background: this.getEntryName(this.manifestPath),
      weakRuntimeCheck: true
    }).apply(compiler)
  }
}

export default TargetWebExtensionPlugin
