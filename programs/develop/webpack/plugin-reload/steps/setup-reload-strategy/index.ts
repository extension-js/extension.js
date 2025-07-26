import {type Compiler} from '@rspack/core'
import {type PluginInterface} from '../../reload-types'
import {SetupChromiumReloadClient} from '../setup-chromium-reload-client'
import {SetupFirefoxReloadClient} from '../setup-firefox-reload-client'
import {ApplyManifestDevDefaults} from './apply-manifest-dev-defaults'
import {TargetWebExtensionPlugin} from './target-web-extension-plugin'
import {GenerateManagerExtension} from './generate-manager-extension'
import {DevOptions} from '../../../../commands/commands-lib/config-types'
import {CHROMIUM_BASED_BROWSERS} from '../../../lib/constants'

class SetupReloadStrategy {
  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']
  private readonly port: number

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.port = options.port || 8080
  }

  public apply(compiler: Compiler) {
    // 1 - Ensure the background scripts (and service_worker) can
    // receive messages from the extension reload plugin.
    if (
      CHROMIUM_BASED_BROWSERS.includes(this.browser) ||
      this.browser === 'chromium-based'
    ) {
      SetupChromiumReloadClient(compiler, this.browser, this.manifestPath)
    }

    if (this.browser === 'firefox' || this.browser === 'gecko-based') {
      SetupFirefoxReloadClient(compiler, this.browser, this.manifestPath)
    }

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

    // 4 - Generate the Extension.js manager extension
    // related to the current browser.
    new GenerateManagerExtension({
      manifestPath: this.manifestPath,
      browser: this.browser,
      port: this.port
    }).apply(compiler)
  }
}

export default SetupReloadStrategy
