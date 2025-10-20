import {Compilation} from '@rspack/core'
import {RemoteFirefox} from './remote-firefox'

type PluginLike = {
  extension: string | string[]
  extensionsToLoad?: string[]
  browser: 'firefox'
  browserFlags?: string[]
  profile?: string | false
  preferences?: Record<string, unknown>
  startingUrl?: string
  geckoBinary?: string
  instanceId?: string
  source?: string | boolean
  watchSource?: boolean
  port?: number | string
}

export class FirefoxRDPController {
  private readonly remote: RemoteFirefox
  private readonly debugPort: number

  constructor(plugin: PluginLike, debugPort: number) {
    this.remote = new RemoteFirefox({
      extension: plugin.extension,
      extensionsToLoad: plugin.extensionsToLoad,
      browser: plugin.browser,
      browserFlags: plugin.browserFlags,
      profile: plugin.profile,
      preferences: plugin.preferences,
      startingUrl: plugin.startingUrl,
      chromiumBinary: undefined,
      geckoBinary: plugin.geckoBinary,
      instanceId: plugin.instanceId,
      port: debugPort,
      source: typeof plugin.source === 'string' ? plugin.source : undefined,
      watchSource: plugin.watchSource
    })
    this.debugPort =
      typeof debugPort === 'string' ? parseInt(debugPort, 10) : debugPort
  }

  getRemoteFirefox(): RemoteFirefox {
    return this.remote
  }

  async connect(): Promise<void> {
    // RemoteFirefox lazily connects on first operation; nothing to do here intentionally.
  }

  async ensureLoaded(compilation: Compilation): Promise<void> {
    await this.remote.installAddons(compilation)
  }

  async hardReload(
    compilation: Compilation,
    changedAssets: string[]
  ): Promise<void> {
    const rf = this.remote as unknown as {
      hardReloadIfNeeded?: (c: Compilation, assets: string[]) => Promise<void>
    }
    if (typeof rf.hardReloadIfNeeded === 'function') {
      await rf.hardReloadIfNeeded(compilation, changedAssets)
    } else {
      await this.remote.installAddons(compilation)
    }
  }

  async enableUnifiedLogging(opts: {
    level?: string
    contexts?: string[] | undefined
    urlFilter?: string | undefined
    tabFilter?: number | string | undefined
    format?: 'pretty' | 'json' | 'ndjson'
    timestamps?: boolean
    color?: boolean
  }): Promise<void> {
    await this.remote.enableUnifiedLogging(opts)
  }
}
