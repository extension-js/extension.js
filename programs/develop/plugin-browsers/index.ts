import os from 'os'
import path from 'path'
import {type Compiler} from 'webpack'
import {type PluginInterface} from './browsers-types'
import {RunChromiumPlugin} from './run-chromium'
import {RunFirefoxPlugin} from './run-firefox'
import {DevOptions} from '../commands/dev'

/**
 * BrowsersPlugin works by creating a WebSockets server
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
  public static readonly name: string = 'plugin-browsers'

  public readonly extension: string | string[]
  public readonly browser: DevOptions['browser']
  public readonly browserFlags: string[]
  public readonly userDataDir?: string
  public readonly profile: string
  public readonly preferences: Record<string, any>
  public readonly startingUrl: string

  constructor(options: PluginInterface) {
    this.extension = [
      ...options.extension,
      ...(options.browserFlags?.filter(
        (flag) => !flag.startsWith('--load-extension=')
      ) || [])
    ]
    this.browser = options.browser
    this.browserFlags =
      options.browserFlags?.filter(
        (flag) => !flag.startsWith('--load-extension=')
      ) || []
    this.userDataDir = options.userDataDir
    this.profile = options.profile || ''
    this.preferences = options.preferences || {}
    this.startingUrl = options.startingUrl || ''
  }

  private getProfilePath(
    compiler: Compiler,
    browser: DevOptions['browser'],
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
        this.browser,
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
        new RunChromiumPlugin({
          ...config,
          browser: 'chrome'
        }).apply(compiler)
        break
      }

      case 'edge':
        new RunChromiumPlugin({
          ...config,
          browser: 'edge'
        }).apply(compiler)
        break

      case 'firefox':
        new RunFirefoxPlugin({
          ...config,
          browser: 'firefox'
        }).apply(compiler)
        break

      default: {
        // TODO: cezaraugusto add attempt to run with any user-declared path
        new RunChromiumPlugin({
          ...config,
          browser: this.browser
        }).apply(compiler)
        break
      }
    }
  }
}
