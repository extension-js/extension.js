// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import type {Readable, Writable} from 'stream'
import * as messages from '../../../browsers-lib/messages'
import type {
  CdpProtocolMessage,
  CdpProtocolParams,
  CdpTargetInfo
} from '../../chromium-types'
import {type CDPClient, EXTENSION_AUTO_ATTACH_FILTER} from '../cdp-client'
import {connectToChromeCdp, connectToChromeCdpViaPipe} from './connect'
import {deriveExtensionIdFromTargetsHelper} from './derive-id'
import {readManifestInfo} from './ensure'
import {registerAutoEnableLogging} from './logging'
import {classifyExtensionOwnership} from './ownership'

interface ExtensionInfoResult {
  extensionId: string
  name?: string
  version?: string
}

const __fileReadCache = new Map<string, {key: string; text: string}>()

function readTextFileCached(filePath: string): string {
  try {
    const stat = fs.statSync(filePath)
    const key = `${stat.mtimeMs}:${stat.size}`
    const cached = __fileReadCache.get(filePath)

    if (cached && cached.key === key) return cached.text

    const text = fs.readFileSync(filePath, 'utf-8')
    __fileReadCache.set(filePath, {key, text})

    return text
  } catch {
    return fs.readFileSync(filePath, 'utf-8')
  }
}

export class CDPExtensionController {
  private readonly outPath: string
  private readonly cdpPort: number
  private readonly profilePath?: string
  private readonly extensionPaths?: string[]
  private readonly pipeIn?: Readable
  private readonly pipeOut?: Writable
  private cdp: CDPClient | null = null
  private extensionId: string | null = null

  constructor(args: {
    outPath: string
    browser: 'chrome' | 'edge' | 'chromium-based'
    cdpPort: number
    profilePath?: string
    extensionPaths?: string[]
    pipeIn?: Readable
    pipeOut?: Writable
  }) {
    this.outPath = args.outPath
    this.cdpPort = args.cdpPort
    this.profilePath = args.profilePath
    this.extensionPaths = args.extensionPaths
    this.pipeIn = args.pipeIn
    this.pipeOut = args.pipeOut
  }

  async connect(): Promise<void> {
    if (this.cdp) return
    await this.connectFreshClient()
  }

  /**
   * Open a fresh browser tab. Used after the extension registers to land the
   * developer on a `chrome_url_overrides.newtab` surface — that override only
   * takes effect for tabs created AFTER registration, so the launch tab (which
   * predates it) shows Chrome's default new tab (#50). Best-effort: a no-op
   * when disconnected, and callers swallow errors so it never blocks launch.
   */
  async openTab(url: string): Promise<void> {
    if (!this.cdp) return
    await this.cdp.sendCommand('Target.createTarget', {url})
  }

  async ensureLoaded(): Promise<ExtensionInfoResult> {
    if (!this.cdp) throw new Error('CDP not connected')

    // Load unpacked extension from output path
    const exists = fs.existsSync(this.outPath)
    if (!exists) throw new Error(`Output path not found: ${this.outPath}`)

    // Before loading this build, evict any prior unpacked load of THIS project
    // that the persistent profile auto-loaded at startup (a sibling dist path
    // from an earlier run/CLI resolution) — otherwise the profile accumulates
    // duplicate extension IDs for one project (#49). Best-effort, once.
    if (this.profilePath) {
      try {
        const {uninstallStaleUnpackedLoads} = await import('./ensure')
        await uninstallStaleUnpackedLoads(
          this.cdp,
          this.profilePath,
          this.outPath
        )
      } catch {
        // best-effort only — never block launch on cleanup
      }
    }

    // CDP-first strategy: try Extensions.loadUnpacked (Chrome 126+ with
    // --enable-unsafe-extension-debugging), then fall back to target derivation
    // for older Chrome or when the CDP domain isn't available.
    if (!this.extensionId) {
      try {
        const {loadUnpackedIfNeeded} = await import('./ensure')
        const cdpId = await loadUnpackedIfNeeded(this.cdp, this.outPath)
        if (cdpId) this.extensionId = cdpId
      } catch {
        // Extensions.loadUnpacked not supported — fall through to target derivation
      }
    }

    // Fallback: derive extensionId from Chrome targets (--load-extension path)
    if (!this.extensionId) {
      const id = await this.deriveExtensionIdFromTargets()
      if (id) this.extensionId = id
    }

    if (this.extensionId) {
      const ownership = this.classifyOwnership(this.extensionId)
      if (ownership === 'not_mine') {
        // Verifiably another extension — never adopt it.
        this.extensionId = null
      } else if (ownership === 'unknown' && this.profilePath) {
        // The profile cannot confirm ownership yet (a freshly created profile
        // has not flushed its Preferences). 'unknown' is not a yes: instead of
        // adopting the derived id on trust, re-derive and re-check the shared
        // decision until the profile converges. We accept the id only once it
        // verifies as ours, and drop it the moment it verifies as another's; a
        // still-unconfirmed id is left for the longer-wait derivation below
        // rather than silently reported as mine.
        for (let attempt = 0; attempt < 5; attempt++) {
          await new Promise((r) => setTimeout(r, 200))
          const candidate =
            this.extensionId ||
            (await this.deriveExtensionIdFromTargets(4, 150))
          if (!candidate) continue
          const verdict = this.classifyOwnership(candidate)
          if (verdict === 'mine') {
            this.extensionId = candidate
            break
          }
          if (verdict === 'not_mine') {
            this.extensionId = null
            break
          }
        }
      }
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
            readTextFileCached(path.join(this.outPath, 'manifest.json'))
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
      // If still unknown, derive from targets with a longer wait.
      if (!this.extensionId) {
        this.extensionId = await this.deriveExtensionIdFromTargets(20, 200)
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

  // Ask the one ownership question. Every site that needs to know whether an
  // id belongs to the dev extension resolves through this shared decision, so
  // the tri-state ('mine' | 'not_mine' | 'unknown') is never re-interpreted
  // per call site. 'unknown' is not a yes — see `ownership.ts`.
  private classifyOwnership(extensionId: string) {
    return classifyExtensionOwnership(
      this.profilePath,
      this.outPath,
      extensionId
    )
  }

  private async connectFreshClient(): Promise<void> {
    // Prefer pipe transport (--remote-debugging-pipe) when available;
    // fall back to WebSocket via --remote-debugging-port.
    if (this.pipeIn && this.pipeOut && !this.pipeIn.destroyed) {
      this.cdp = await connectToChromeCdpViaPipe(
        this.pipeIn,
        this.pipeOut,
        this.cdpPort
      )
    } else {
      this.cdp = await connectToChromeCdp(this.cdpPort)
    }

    // Proactively enable auto-attach and capture extensionId from service worker targets as soon as they appear
    try {
      await this.cdp.sendCommand('Target.setDiscoverTargets', {
        discover: true
      })
      await this.cdp.sendCommand('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
        filter: EXTENSION_AUTO_ATTACH_FILTER
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

  onProtocolEvent(cb: (evt: CdpProtocolMessage) => void) {
    if (!this.cdp) throw new Error('CDP not connected')

    this.cdp.onProtocolEvent((message: CdpProtocolMessage) => {
      cb(message)
    })
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

  private async enableLogging() {
    if (!this.cdp) return
    try {
      const extId = this.extensionId
      this.onProtocolEvent(async (message: CdpProtocolMessage) => {
        try {
          if (!message || !message.method) return

          if (message.method === 'Target.attachedToTarget') {
            const params: CdpProtocolParams = message.params || {}
            const targetInfo: CdpTargetInfo = params.targetInfo || {
              url: '',
              type: ''
            }
            const sessionId = params.sessionId
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
            if (String(process.env.EXTENSION_VERBOSE || '').trim() === '1') {
              const ts = new Date().toISOString()
              console.log(messages.cdpUnifiedExtensionLog(ts, message.params))
            }
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

      if (this.extensionId) {
        const ownership = this.classifyOwnership(this.extensionId)
        if (ownership === 'not_mine') {
          this.extensionId = await this.deriveExtensionIdFromTargets(10, 150)
        } else if (ownership === 'unknown' && this.profilePath) {
          // Best-effort: the id is not confirmed as ours, so re-derive rather
          // than report a possibly-foreign extension's name/version. Adopt the
          // result only if it is not verifiably someone else's; otherwise keep
          // the existing id (still unconfirmed, never asserted as mine).
          const rederived = await this.deriveExtensionIdFromTargets(6, 150)
          if (rederived && this.classifyOwnership(rederived) !== 'not_mine') {
            this.extensionId = rederived
          }
        }
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
            readTextFileCached(path.join(this.outPath, 'manifest.json'))
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
