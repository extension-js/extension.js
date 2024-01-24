import type webpack from 'webpack'
import {type RunChromeExtensionInterface} from './types'
import CreateWebSocketServer from './src/steps/CreateWebSocketServer'
import SetupReloadStrategy from './src/steps/SetupReloadStrategy'
import RunChromePlugin from './src/steps/RunChromePlugin'
import createUserDataDir from './src/steps/RunChromePlugin/chrome/createUserDataDir'

export default class RunChromeExtension {
  private readonly options: RunChromeExtensionInterface

  constructor(options: RunChromeExtensionInterface) {
    this.options = {
      manifestPath: options.manifestPath,
      extensionPath: options.extensionPath,
      port: options.port || 8082,
      browserFlags: options.browserFlags || [],
      userDataDir: options.userDataDir || createUserDataDir(),
      startingUrl: options.startingUrl,
      autoReload: options.autoReload != null ? options.autoReload : true,
      pagesFolder: options.pagesFolder
    }
  }

  apply(compiler: webpack.Compiler) {
    // This plugin:

    // 1 - Creates a WebSockets server to communicate with the browser.
    // This server is responsible for sending reload requests to the client,
    // which is a browser extension that is injected into the browser called
    // reload-extension. This extension is responsible for sending messages
    // to the user extension.
    new CreateWebSocketServer(this.options).apply(compiler)

    // 2 - Patches the manifest file, modifies the background script to
    // accept both extension runtime updates (service_worker, manifest.json)
    // and HMR updates (background, content scripts). The HMR part is done by
    // webpack-target-webextension.
    new SetupReloadStrategy(this.options).apply(compiler)

    // 3 - Bundle the reloader and manager extensions. The reloader extension
    // is injected into the browser and is responsible for sending reload
    // requests to the user extension. The manager extension is responsible
    // for everything else, for now opening the chrome://extension page on startup.
    // It starts a new browser instance with the user extension loaded.
    new RunChromePlugin(this.options).apply(compiler)
  }
}
