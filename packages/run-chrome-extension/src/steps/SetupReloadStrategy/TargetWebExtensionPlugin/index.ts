import fs from 'fs'
import type webpack from 'webpack'
import WebExtension from 'webpack-target-webextension'
import {type RunChromeExtensionInterface} from '../../../types'
import {getFilepath} from '../../../helpers/getResourceName'

class TargetWebExtensionPlugin {
  private readonly manifestPath?: string

  constructor(options: RunChromeExtensionInterface) {
    this.manifestPath = options.manifestPath
  }

  private getEntryName(manifestPath: string) {
    const manifest = require(manifestPath)

    if (manifest.background) {
      if (manifest.manifest_version === 3) {
        return {serviceWorkerEntry: getFilepath('service_worker')}
      }

      if (manifest.manifest_version === 2) {
        return {pageEntry: getFilepath('background')}
      }
    }

    return {pageEntry: getFilepath('background')}
  }

  public apply(compiler: webpack.Compiler) {
    if (!this.manifestPath || !fs.lstatSync(this.manifestPath).isFile()) {
      return
    }

    new WebExtension({
      background: this.getEntryName(this.manifestPath),
      weakRuntimeCheck: true
    }).apply(compiler)
  }
}

export default TargetWebExtensionPlugin
