import {type Compiler} from '@rspack/core'
import {type PluginInterface} from './reload-types'
import CreateWebSocketServer from './steps/create-web-socket-server'
import SetupReloadStrategy from './steps/setup-reload-strategy'
import {SetupSourceInspectionStep} from './steps/setup-source-inspection'
import {type DevOptions} from '../../commands/commands-lib/config-types'

export class ReloadPlugin {
  public static readonly name: string = 'plugin-reload'

  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']
  private readonly port?: number
  private readonly stats?: boolean
  private readonly autoReload?: boolean
  private readonly instanceId?: string
  private readonly source?: string
  private readonly watchSource?: boolean
  private readonly startingUrl?: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.port = options.port
    this.stats = options.stats
    this.autoReload = options.autoReload
    this.instanceId = options.instanceId
    this.source = (options as any).source
    this.watchSource = (options as any).watchSource
    this.startingUrl = options.startingUrl
  }

  apply(compiler: Compiler) {
    // Pass instance information to compiler options
    if (this.instanceId) {
      ;(compiler.options as any).currentInstance = {
        instanceId: this.instanceId
      }
    }

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
        stats: this.stats,
        instanceId: this.instanceId
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
        stats: this.stats,
        port: this.port,
        instanceId: this.instanceId
      }).apply(compiler)
    }

    // 3 - Sets up source inspection for real-time HTML monitoring
    // This allows developers to see the full HTML output including
    // Shadow DOM content from content scripts
    if (compiler.options.mode === 'development') {
      new SetupSourceInspectionStep({
        browser: this.browser,
        mode: compiler.options.mode || 'development',
        source: this.source,
        watchSource: this.watchSource,
        startingUrl: this.startingUrl
      }).apply(compiler)
    }
  }
}
