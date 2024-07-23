import os from 'os'
import path from 'path'
import {type Compiler} from 'webpack'
import {type PluginInterface} from './types'
import {RunChromiumPlugin} from './run-chromium'
import RunFirefoxPlugin from 'webpack-run-firefox-addon'

/**
 * RunChromiumPlugin works by creating a WebSockets server
 * that listens to changes triggered by the user extension
 * via webpack. When a change is detected, the server sends
 * a message to an extension called reload-extension, which
 * is injected into the browser. This extension is responsible
 * for sending messages to the user extension. We do that by
 * injecting a script into the background page that listens
 * to messages from the reload-extension.
 *
 * Features supported:
 * - Service worker - Full extension reload (chrome.runtime.reload)
 * - manifest.json - Full extension reload (chrome.runtime.reload)
 */
export class BrowsersPlugin {
  public readonly extension: string | string[]
  public readonly browser: string
  public readonly browserFlags: string[]
  public readonly userDataDir?: string
  public readonly profile: string
  public readonly preferences: string
  public readonly startingUrl: string

  constructor(options: PluginInterface) {
    this.extension = options.extension
    this.browser = options.browser || 'chrome'
    this.browserFlags = options.browserFlags || []
    this.userDataDir = options.userDataDir
    this.profile = options.profile || ''
    this.preferences = options.preferences || ''
    this.startingUrl = options.startingUrl || ''
  }

  private getProfilePath(
    compiler: Compiler,
    browser: string,
    profile: string | undefined
  ) {
    if (profile) {
      return profile
    }

    // Ensure `start` runs in a fresh profile by default.
    if (compiler.options.mode === 'production') {
      return path.join(os.tmpdir(), 'extension-js', browser, 'profile')
    }

    return path.resolve(__dirname, `run-${browser}-profile`)
  }

  apply(compiler: Compiler) {
    const config = {
      stats: true,
      extension: this.extension,
      browser: this.browser,
      browserFlags: this.browserFlags || [],
      userDataDir: this.getProfilePath(
        compiler,
        this.browser || 'chrome',
        this.userDataDir || this.profile
      )
    }

    // 1 - Bundle the reloader and manager extensions. The reloader extension
    // is injected into the browser and is responsible for sending reload
    // requests to the user extension. The manager extension is responsible
    // for everything else, for now opening the chrome://extension page on startup.
    // It starts a new browser instance with the user extension loaded.
    switch (this.browser) {
      case 'chrome': {
        new RunChromiumPlugin({...config, browser: 'chrome'}).apply(compiler)
        break
      }

      case 'edge':
        new RunChromiumPlugin({...config, browser: 'edge'}).apply(compiler)
        break

      case 'firefox':
        // TODO: Use updated Firefox plugin
        new RunFirefoxPlugin({
          port: 8002,
          manifestPath: path.join(this.extension[0], 'manifest.json'),
          // The final folder where the extension manifest file is located.
          // This is used to load the extension into the browser.
          extensionPath: path.join(this.extension[0], 'dist', this.browser),
          autoReload: true,
          userDataDir: this.getProfilePath(
            compiler,
            'firefox',
            this.userDataDir || this.profile
          ),
          stats: true
        }).apply(compiler)
        break
      default: {
        new RunChromiumPlugin({...config, browser: 'chrome'}).apply(compiler)
        break
      }
    }
  }
}
