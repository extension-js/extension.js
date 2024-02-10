import type webpack from 'webpack'
import {type RunChromeExtensionInterface} from '../../types'
import ApplyManifestDevDefaults from './ApplyManifestDevDefaults'
import TargetWebExtensionPlugin from './TargetWebExtensionPlugin'
import AddRuntimeListener from './AddRuntimeListener'

class SetupReloadStrategy {
  private readonly manifestPath?: string

  constructor(options: RunChromeExtensionInterface) {
    this.manifestPath = options.manifestPath
  }

  public apply(compiler: webpack.Compiler) {
    // 1 - Ensure the background scripts (and service_worker) can
    // receive messages from the extension reload plugin.
    AddRuntimeListener(compiler, this.manifestPath)

    // 2 - Patch the manifest with useful transforms during development,
    // such as bypassing CSP, adding useful defaults to web_accessible_resources,
    // and adding a background script to inject the HMR reloader to all files.
    new ApplyManifestDevDefaults({
      manifestPath: this.manifestPath
    }).apply(compiler)

    // 3 - Add the HMR reloader to the entry point.
    new TargetWebExtensionPlugin({
      manifestPath: this.manifestPath
    }).apply(compiler)
  }
}

export default SetupReloadStrategy
