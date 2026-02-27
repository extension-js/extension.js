// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import * as messages from '../../../browsers-lib/messages'
import {CDPClient} from '../cdp-client'
import {deriveExtensionIdFromTargetsHelper} from './derive-id'
import {connectToChromeCdp} from './connect'
import {loadUnpackedIfNeeded, readManifestInfo} from './ensure'
import {registerAutoEnableLogging} from './logging'

interface ExtensionInfoResult {
  extensionId: string
  name?: string
  version?: string
}

export class CDPExtensionController {
  private readonly outPath: string
  private readonly browser: 'chrome' | 'edge' | 'chromium-based'
  private readonly cdpPort: number
  private readonly profilePath?: string
  private readonly extensionPaths?: string[]
  private cdp: CDPClient | null = null
  private extensionId: string | null = null

  constructor(args: {
    outPath: string
    browser: 'chrome' | 'edge' | 'chromium-based'
    cdpPort: number
    profilePath?: string
    extensionPaths?: string[]
  }) {
    this.outPath = args.outPath
    this.browser = args.browser
    this.cdpPort = args.cdpPort
    this.profilePath = args.profilePath
    this.extensionPaths = args.extensionPaths
  }

  async connect(): Promise<void> {
    if (this.cdp) return
    // Use helper to wait for port, connect, and set auto-attach
    this.cdp = await connectToChromeCdp(this.cdpPort)

    // Proactively enable auto-attach and capture extensionId from service worker targets as soon as they appear
    try {
      await this.cdp.sendCommand('Target.setDiscoverTargets', {
        discover: true
      })
      await this.cdp.sendCommand('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true
      })
    } catch (error: unknown) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.warn(
          messages.cdpAutoAttachSetupFailed(
            String((error as Error)?.message || error)
          )
        )
      }
    }

    registerAutoEnableLogging(this.cdp, () => this.extensionId)
  }

  async ensureLoaded(): Promise<ExtensionInfoResult> {
    if (!this.cdp) throw new Error('CDP not connected')

    // Load unpacked extension from output path
    const exists = fs.existsSync(this.outPath)
    if (!exists) throw new Error(`Output path not found: ${this.outPath}`)

    // 1) Prefer deriving extensionId from Chrome targets (works when launched with --load-extension)
    if (!this.extensionId) {
      const id = await this.deriveExtensionIdFromTargets()
      if (id) this.extensionId = id
    }

    // If already known, verify info
    if (this.extensionId) {
      try {
        // Try Extensions domain first; if missing, fall back to manifest
        let info: {
          extensionInfo?: {name?: string; version?: string}
        } | null = null

        try {
          info = await this.cdp.getExtensionInfo(this.extensionId)
        } catch {
          // ignore
        }

        if (!info) {
          const manifest = JSON.parse(
            fs.readFileSync(path.join(this.outPath, 'manifest.json'), 'utf-8')
          )

          return {
            extensionId: this.extensionId,
            name: manifest.name,
            version: manifest.version
          }
        }

        return {
          extensionId: this.extensionId,
          name: info?.extensionInfo?.name,
          version: info?.extensionInfo?.version
        }
      } catch {
        // will reload
      }
    }

    try {
      // 2) If still unknown, attempt Extensions.loadUnpacked (best effort)
      if (!this.extensionId && this.shouldAttemptLoadUnpacked()) {
        const id = await loadUnpackedIfNeeded(this.cdp, this.outPath)
        if (id) this.extensionId = id
      }

      // 3) If still unknown, derive again from targets with a short wait
      if (!this.extensionId) {
        this.extensionId = await this.deriveExtensionIdFromTargets(10, 150)
      }

      if (!this.extensionId) {
        throw new Error('Failed to determine extension ID via CDP')
      }

      // After load/derivation, set up runtime/log domains
      await this.enableLogging()

      // Prefer Extensions.getExtensionInfo; fallback to manifest
      let name: string | undefined
      let version: string | undefined

      try {
        const info = await this.cdp.getExtensionInfo(this.extensionId)
        name = info?.extensionInfo?.name
        version = info?.extensionInfo?.version
      } catch (error) {
        try {
          const manifest = readManifestInfo(this.outPath)
          name = String(manifest?.name || '') || undefined
          version = String(manifest?.version || '') || undefined
        } catch (e2: unknown) {
          if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
            console.warn(
              '[CDP] Fallback manifest read failed:',
              String((e2 as Error)?.message || e2)
            )
          }
        }
      }

      return {extensionId: this.extensionId, name, version}
    } catch (error) {
      throw new Error(
        `Failed to load extension from ${path.resolve(this.outPath)}: ${String(
          (error as Error).message || error
        )}`
      )
    }
  }

  private async deriveExtensionIdFromTargets(
    maxRetries = 20,
    backoffMs = 200
  ): Promise<string | null> {
    if (!this.cdp) return null
    return await deriveExtensionIdFromTargetsHelper(
      this.cdp,
      this.outPath,
      maxRetries,
      backoffMs,
      this.profilePath,
      this.extensionPaths
    )
  }

  private shouldAttemptLoadUnpacked(): boolean {
    const normalizePath = (input: string) => {
      try {
        return fs.realpathSync(path.resolve(input))
      } catch {
        return path.resolve(input)
      }
    }

    const normalizedOutPath = normalizePath(this.outPath)
    const normalizedExtensionPaths = (this.extensionPaths || [])
      .map((candidate) => String(candidate || '').trim())
      .filter(Boolean)
      .map(normalizePath)

    if (normalizedExtensionPaths.length === 0) {
      return true
    }

    // If this outPath is already loaded via --load-extension, avoid a second
    // CDP loadUnpacked call that can relocate/disable the user extension.
    return !normalizedExtensionPaths.includes(normalizedOutPath)
  }

  async hardReload(): Promise<boolean> {
    if (!this.cdp || !this.extensionId) return false

    try {
      return await this.cdp.forceReloadExtension(this.extensionId)
    } catch {
      return false
    }
  }

  onProtocolEvent(
    cb: (
      evt: {method: string; params?: unknown} & Record<string, unknown>
    ) => void
  ) {
    if (!this.cdp) throw new Error('CDP not connected')

    this.cdp.onProtocolEvent((raw: Record<string, unknown>) => {
      const evt = raw as {method: string; params?: unknown} & Record<
        string,
        unknown
      >
      cb(evt)
    })
  }

  clearProtocolEventHandler() {
    if (!this.cdp) return
    this.cdp.onProtocolEvent(() => {})
  }

  // Stream logs when requested: attach to page + extension targets and forward
  async enableUnifiedLogging() {
    if (!this.cdp) return

    try {
      await this.cdp.enableAutoAttach()
      await this.cdp.enableRuntimeAndLog()

      // Proactively attach to existing targets and enable Runtime/Log per-session
      try {
        const targets = await this.cdp.getTargets()

        for (const t of targets || []) {
          const type = String(t?.type || '')
          if (
            type === 'page' ||
            type === 'service_worker' ||
            type === 'background_page' ||
            type === 'worker'
          ) {
            const targetId = String(t?.targetId || '')
            if (!targetId) continue

            const sessionId = await this.cdp.attachToTarget(targetId)
            await this.cdp.enableRuntimeAndLog(sessionId)
          }
        }
      } catch {
        // ignore
      }
      // Filtering is performed in the caller using event metadata
    } catch {
      // ignore
    }
  }

  async enableRuntimeForSession(sessionId: string): Promise<void> {
    if (!this.cdp) return

    try {
      await this.cdp.enableRuntimeAndLog(sessionId)
    } catch {
      // ignore
    }
  }

  private async enableLogging() {
    if (!this.cdp) return
    try {
      const extId = this.extensionId
      this.onProtocolEvent(async (message: Record<string, unknown>) => {
        try {
          if (!message || !message.method) return

          if (message.method === 'Target.attachedToTarget') {
            const params =
              (message as {params?: Record<string, unknown>}).params || {}
            const targetInfo = (
              params as {targetInfo?: {url?: string; type?: string}}
            ).targetInfo || {url: '', type: ''}
            const sessionId = (params as {sessionId?: string}).sessionId
            const url: string = String(targetInfo.url || '')
            const type: string = String(targetInfo.type || '')
            const matchesExtension = !!(
              (this.extensionId &&
                url.includes(`chrome-extension://${this.extensionId}/`)) ||
              (extId && url.includes(`chrome-extension://${extId}/`)) ||
              type === 'service_worker'
            )

            if (sessionId && matchesExtension) {
              // Enable runtime and log domains for this session
              await this.cdp!.sendCommand('Runtime.enable', {}, sessionId)
              await this.cdp!.sendCommand('Log.enable', {}, sessionId)
            }
          } else if (
            message.method === 'Runtime.consoleAPICalled' ||
            message.method === 'Log.entryAdded'
          ) {
            // Basic pretty print
            const ts = new Date().toISOString()
            console.log(messages.cdpUnifiedExtensionLog(ts, message.params))
          }
        } catch {
          // ignore
        }
      })
    } catch (e) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.warn('[CDP] enableLogging failed:', String(e))
      }
    }
  }

  // Best-effort info retrieval without throwing
  async getInfoBestEffort(): Promise<ExtensionInfoResult | null> {
    try {
      if (!this.cdp) return null
      if (!this.extensionId) {
        this.extensionId = await this.deriveExtensionIdFromTargets(6, 150)
      }

      if (!this.extensionId) return null

      let name: string | undefined
      let version: string | undefined

      try {
        const info = await this.cdp.getExtensionInfo(this.extensionId)
        name = info?.extensionInfo?.name
        version = info?.extensionInfo?.version
      } catch {
        try {
          const manifest = JSON.parse(
            fs.readFileSync(path.join(this.outPath, 'manifest.json'), 'utf-8')
          )
          name = manifest?.name
          version = manifest?.version
        } catch {
          // ignore
        }
      }
      return {extensionId: this.extensionId, name, version}
    } catch (error) {
      return null
    }
  }
}
