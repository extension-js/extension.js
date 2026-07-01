// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {BrowserType, CompilationLike} from '../../../browsers-types'
import {RemoteFirefox} from '../remote-firefox'

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
    const normalizedDebugPort =
      typeof debugPort === 'string' ? parseInt(debugPort, 10) : debugPort
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
      // The launcher hands us the concrete port Firefox was actually started
      // with (already passed through findAvailablePortNear). Pin it so the
      // add-on install connects to THAT port instead of re-deriving it.
      resolvedRdpPort: normalizedDebugPort,
      browserVersionLine: plugin.browserVersionLine
    })
    this.debugPort = normalizedDebugPort
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

  async probeRuntimeCapability(): Promise<{hasScripting: boolean} | null> {
    return this.remote.probeRuntimeCapability()
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
