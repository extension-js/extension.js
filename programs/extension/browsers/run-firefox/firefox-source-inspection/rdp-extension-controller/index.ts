// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {CompilationLike} from '../../../browsers-types'
import {RemoteFirefox} from '../remote-firefox'
import type {BrowserType} from '../../../browsers-types'
import type {ContentScriptTargetRule} from '../../../browsers-lib/content-script-targets'

type PluginLike = {
  extension: string | string[]
  browser: BrowserType
  browserFlags?: string[]
  profile?: string | false
  preferences?: Record<string, unknown>
  startingUrl?: string
  geckoBinary?: string
  instanceId?: string
  source?: string | boolean
  watchSource?: boolean
  port?: number | string
  browserVersionLine?: string
}

export class FirefoxRDPController {
  private readonly remote: RemoteFirefox
  private readonly debugPort: number

  constructor(plugin: PluginLike, debugPort: number) {
    this.remote = new RemoteFirefox({
      extension: plugin.extension,
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
      watchSource: plugin.watchSource,
      browserVersionLine: plugin.browserVersionLine
    })
    this.debugPort =
      typeof debugPort === 'string' ? parseInt(debugPort, 10) : debugPort
  }

  getRemoteFirefox(): RemoteFirefox {
    return this.remote
  }

  async connect(): Promise<void> {
    // RemoteFirefox lazily connects on first operation.
    // Nothing to do here intentionally
  }

  async ensureLoaded(compilation: CompilationLike): Promise<void> {
    await this.remote.installAddons(compilation)
  }

  async hardReload(
    compilation: CompilationLike,
    changedAssets: string[]
  ): Promise<void> {
    const rf = this.remote as unknown as {
      hardReloadIfNeeded?: (
        c: CompilationLike,
        assets: string[]
      ) => Promise<void>
    }
    if (typeof rf.hardReloadIfNeeded === 'function') {
      await rf.hardReloadIfNeeded(compilation, changedAssets)
    } else {
      await this.remote.installAddons(compilation)
    }
  }

  async reloadMatchingTabsForContentScripts(
    rules: ContentScriptTargetRule[]
  ): Promise<number> {
    return this.remote.reloadMatchingTabsForContentScripts(rules)
  }

  async registerContentScriptsForFutureNavigations(
    rules: ContentScriptTargetRule[]
  ): Promise<void> {
    await this.remote.registerContentScriptsForFutureNavigations(rules)
  }

  async probeRuntimeCapability(): Promise<{hasScripting: boolean} | null> {
    return this.remote.probeRuntimeCapability()
  }

  getLastRuntimeReinjectionReport(): Record<string, unknown> | null {
    const report = this.remote.getLastRuntimeReinjectionReport()
    return report ? (report as unknown as Record<string, unknown>) : null
  }

  getRuntimeCapability(): {hasScripting: boolean; probedAt: number} | null {
    return this.remote.getRuntimeCapability()
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

// Optional alias to match Chromium naming symmetry in types/imports
export {FirefoxRDPController as RDPExtensionController}
