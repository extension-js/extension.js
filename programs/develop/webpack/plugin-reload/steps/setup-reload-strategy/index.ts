import type webpack from 'webpack'
import {type PluginInterface} from '../../reload-types'
import AddRuntimeListener from '../add-runtime-listener'
import ApplyManifestDevDefaults from './apply-manifest-dev-defaults'
import TargetWebExtensionPlugin from './target-web-extension-plugin'
import { DevOptions } from '../../../../module'

class SetupReloadStrategy {
  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: webpack.Compiler) {
    // 1 - Ensure the background scripts (and service_worker) can
    // receive messages from the extension reload plugin.
    AddRuntimeListener(compiler, this.manifestPath)

    // 2 - Patch the manifest with useful transforms during development,
    // such as bypassing CSP, adding useful defaults to web_accessible_resources,
    // and adding a background script to inject the HMR reloader to all files.
    new ApplyManifestDevDefaults({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    // 3 - Add the HMR reloader to the entry point.
    new TargetWebExtensionPlugin({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)
  }
}

export default SetupReloadStrategy
