import type webpack from 'webpack'
import {type PluginInterface} from './reload-types'
import CreateWebSocketServer from './steps/create-web-socket-server'
import SetupReloadStrategy from './steps/setup-reload-strategy'
import {DevOptions} from '../../develop-types'

export class ReloadPlugin {
  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']
  private readonly port?: number
  private readonly stats?: boolean
  private readonly autoReload?: boolean

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser
    this.port = options.port
    this.stats = options.stats
    this.autoReload = options.autoReload
  }

  apply(compiler: webpack.Compiler) {
    // 1 - Creates a WebSockets server to communicate with the browser.
    // This server is responsible for sending reload requests to the client,
    // which is a browser extension that is injected into the browser called
    // reload-extension. This extension is responsible for sending messages
    // to the user extension.
    if (compiler.options.mode === 'development') {
      new CreateWebSocketServer({
        manifestPath: this.manifestPath,
        browser: this.browser,
        port: this.port,
        stats: this.stats
      }).apply(compiler)
    }

    // 2 - Patches the manifest file, modifies the background script to
    // accept both extension runtime updates (service_worker, manifest.json)
    // and HMR updates (background, content scripts). The HMR part is done by
    // webpack-target-webextension.
    if (compiler.options.mode === 'development') {
      new SetupReloadStrategy({
        manifestPath: this.manifestPath,
        browser: this.browser,
        autoReload: this.autoReload,
        stats: this.stats
      }).apply(compiler)
    }
  }
}
