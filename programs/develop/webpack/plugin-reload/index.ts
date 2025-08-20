import {type Compiler} from '@rspack/core'
import {type PluginInterface} from './reload-types'
import CreateWebSocketServer from './steps/create-web-socket-server'
import SetupReloadStrategy from './steps/setup-reload-strategy'
import {type DevOptions} from '../../develop-lib/config-types'
import {SetupFirefoxInspectionStep} from '../plugin-browsers/run-firefox/remote-firefox/setup-firefox-inspection'

export class ReloadPlugin {
  public static readonly name: string = 'plugin-reload'

  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']
  private readonly port?: number | string
  private readonly stats?: boolean
  private readonly autoReload?: boolean
  private readonly instanceId?: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.port = parseInt(options.port as string, 10)
    this.stats = options.stats
    this.autoReload = options.autoReload
    this.instanceId = options.instanceId
  }

  apply(compiler: Compiler) {
    // Pass instance information to compiler options
    if (this.instanceId) {
      ;(compiler.options as any).currentInstance = {
        instanceId: this.instanceId
      }
    }

    if (compiler.options.mode !== 'development') return

    // 1 - Creates a WebSockets server to communicate with the browser.
    // This server is responsible for sending reload requests to the client,
    // which is a browser extension that is injected into the browser called
    // reload-extension. This extension is responsible for sending messages
    // to the user extension.
    new CreateWebSocketServer({
      manifestPath: this.manifestPath,
      browser: this.browser,
      port: this.port as any,
      stats: this.stats,
      instanceId: this.instanceId
    }).apply(compiler)

    // 2 - Patches the manifest file, modifies the background script to
    // accept both extension runtime updates (service_worker, manifest.json)
    // and HMR updates (background, content scripts). The HMR part is done by
    // webpack-target-webextension.
    new SetupReloadStrategy({
      manifestPath: this.manifestPath,
      browser: this.browser,
      autoReload: this.autoReload,
      stats: this.stats,
      port: this.port as any,
      instanceId: this.instanceId
    }).apply(compiler)

    // 3 - Setup Firefox inspection if applicable (mirrors BrowsersPlugin usage)
    if (this.browser === 'firefox' || this.browser === 'gecko-based') {
      new SetupFirefoxInspectionStep({
        browser: this.browser,
        mode: compiler.options.mode || 'development',
        port: this.port as any,
        instanceId: this.instanceId
      } as any).apply(compiler)
    }
  }
}
