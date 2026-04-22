// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {Readable, Writable} from 'stream'
import WebSocket from 'ws'
import * as messages from '../../browsers-lib/messages'
import {
  CDP_COMMAND_TIMEOUT_MS,
  CDP_HEARTBEAT_INTERVAL_MS
} from '../../browsers-lib/constants'
import {discoverWebSocketDebuggerUrl} from './discovery'
import {
  getExtensionInfo,
  loadUnpackedExtension,
  unloadExtension
} from './extensions'
import {
  type ExtensionRootMetaPayload,
  evaluateExtensionRootMeta,
  evaluateShadowStyleSnapshot,
  getPageHTML,
  hasVisibleShadowHostContent,
  pollForVisibleShadowHostContent,
  waitForContentScriptInjection,
  waitForLoadEvent
} from './page'
import {establishBrowserConnection} from './ws'

// Restrict browser-root auto-attach to extension-relevant target types.
// Excluding page/iframe prevents third-party OAuth popups (claude.ai, Google, etc.)
// from being pulled into our CDP session, which Chrome flags as "a debugger is
// attached" and surfaces as "Debugger paused in another tab" when those popups
// ship anti-debug `debugger;` statements. enableAutoAttach() below stays filter-less
// for the unified-logging path, which needs page coverage.
export const EXTENSION_AUTO_ATTACH_FILTER: Array<{
  type?: string
  exclude?: boolean
}> = [{type: 'page', exclude: true}, {type: 'iframe', exclude: true}, {}]

// Chrome DevTools Protocol Client for source inspection
// Handles communication with Chrome's remote debugging interface
export class CDPClient {
  private port: number
  private host: string
  private transport: 'websocket' | 'pipe' = 'websocket'
  private ws: WebSocket | null = null
  private pipeIn: Readable | null = null
  private pipeOut: Writable | null = null
  private pipeBuffer: Buffer = Buffer.alloc(0)
  private targetWebSocketUrl: string | null = null
  private eventCallbacks = new Set<(message: Record<string, unknown>) => void>()
  private messageId = 0
  private pendingRequests = new Map<
    number,
    {
      resolve: Function
      reject: Function
      timeout?: ReturnType<typeof setTimeout>
      method?: string
    }
  >()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  constructor(port: number = 9222, host: string = '127.0.0.1') {
    this.port = port
    this.host = host
  }

  private isDev() {
    return process.env.EXTENSION_AUTHOR_MODE === 'true'
  }

  async connect(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        this.targetWebSocketUrl = await discoverWebSocketDebuggerUrl(
          this.host,
          this.port,
          this.isDev()
        )

        let pendingRejected = false
        this.ws = await establishBrowserConnection(
          this.targetWebSocketUrl!,
          this.isDev(),
          (data) => this.handleMessage(data),
          (reason) => {
            // Guard against double-rejection (error + close fire in sequence)
            if (pendingRejected) return
            pendingRejected = true
            // Reject any pending requests to avoid hangs
            this.pendingRequests.forEach(({reject, timeout}, id) => {
              try {
                reject(new Error(reason))
              } catch (error) {
                if (this.isDev()) {
                  const err = error as Error
                  console.warn(
                    messages.cdpPendingRejectFailed(String(err.message || err))
                  )
                }
              }
              if (timeout) clearTimeout(timeout)
              this.pendingRequests.delete(id)
            })
            // Mark ws as dead so sendCommand rejects immediately
            this.ws = null
          }
        )

        this.transport = 'websocket'
        this.startHeartbeat()

        if (this.isDev()) {
          console.log(messages.cdpClientConnected(this.host, this.port))
        }

        resolve()
      } catch (error) {
        const err = error as Error
        reject(new Error(`Failed to connect to CDP: ${err.message || err}`))
      }
    })
  }

  async connectViaPipe(input: Readable, output: Writable): Promise<void> {
    this.transport = 'pipe'
    this.pipeIn = input
    this.pipeOut = output
    this.pipeBuffer = Buffer.alloc(0)

    input.on('data', (chunk: Buffer) => {
      this.pipeBuffer = Buffer.concat([this.pipeBuffer, chunk])
      let idx: number

      while ((idx = this.pipeBuffer.indexOf(0)) !== -1) {
        const msg = this.pipeBuffer.subarray(0, idx).toString('utf-8')
        this.pipeBuffer = this.pipeBuffer.subarray(idx + 1)
        this.handleMessage(msg)
      }
    })

    input.on('error', (error: Error) => {
      if (this.isDev()) {
        console.error(`[CDP] Pipe read error: ${error.message}`)
      }
      this.rejectAllPending('CDP pipe read error')
    })

    input.on('close', () => {
      if (this.isDev()) console.log('[CDP] Pipe closed')
      this.rejectAllPending('CDP pipe closed')
      this.pipeIn = null
    })

    this.startHeartbeat()

    if (this.isDev()) {
      console.log(messages.cdpClientConnected(this.host, this.port))
    }
  }

  private rejectAllPending(reason: string) {
    this.pendingRequests.forEach(({reject, timeout}, id) => {
      try {
        reject(new Error(reason))
      } catch {
        // ignore
      }
      if (timeout) clearTimeout(timeout)
      this.pendingRequests.delete(id)
    })
  }

  disconnect() {
    this.stopHeartbeat()
    if (this.transport === 'pipe') {
      try {
        this.pipeIn?.removeAllListeners()
        this.pipeOut?.end()
      } catch {
        // ignore
      }
      this.pipeIn = null
      this.pipeOut = null
    }
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // ignore
      }
      this.ws = null
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(async () => {
      if (!this.isConnected()) {
        this.stopHeartbeat()
        return
      }
      try {
        await this.getBrowserVersion()
      } catch {
        // Heartbeat failure — connection is dead, disconnect to trigger cleanup
        if (this.isDev()) {
          console.warn('[CDP] Heartbeat failed, connection appears dead')
        }
        this.disconnect()
      }
    }, CDP_HEARTBEAT_INTERVAL_MS)
    if (typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref()
    }
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  isConnected(): boolean {
    if (this.transport === 'pipe') {
      return (
        !!this.pipeIn &&
        !this.pipeIn.destroyed &&
        !!this.pipeOut &&
        !this.pipeOut.destroyed
      )
    }
    return !!this.ws && this.ws.readyState === WebSocket.OPEN
  }

  onProtocolEvent(handler: (message: Record<string, unknown>) => void) {
    this.eventCallbacks.add(handler)
    return () => {
      this.eventCallbacks.delete(handler)
    }
  }

  private handleMessage(data: string) {
    try {
      const message = JSON.parse(data)

      if (message.id) {
        const pending = this.pendingRequests.get(message.id)

        if (pending) {
          if (pending.timeout) {
            clearTimeout(pending.timeout)
          }

          this.pendingRequests.delete(message.id)

          if (message.error) {
            pending.reject(new Error(JSON.stringify(message.error)))
          } else {
            pending.resolve(message.result)
          }
        }
        return
      }

      if (message.method === 'Target.attachedToTarget') {
        const params = message.params || {}

        if (this.isDev()) {
          console.log(
            messages.cdpClientAttachedToTarget(
              String(params.sessionId || ''),
              String(params.targetInfo?.type || '')
            )
          )
        }
      }

      for (const eventCallback of this.eventCallbacks) {
        eventCallback(message)
      }
    } catch (error) {
      if (this.isDev()) {
        const err = error as Error
        console.warn(
          messages.cdpFailedToHandleMessage(String(err.message || err))
        )
      }
    }
  }

  // Send a command to the CDP endpoint
  async sendCommand(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs: number = CDP_COMMAND_TIMEOUT_MS
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        return reject(new Error('CDP transport is not open'))
      }

      const id = ++this.messageId
      const message: Record<string, unknown> = {id, method, params}
      if (sessionId) message.sessionId = sessionId

      try {
        const timeout = setTimeout(() => {
          const pending = this.pendingRequests.get(id)
          if (!pending) return

          this.pendingRequests.delete(id)

          pending.reject(
            new Error(
              `CDP command timed out (${timeoutMs}ms): ${String(
                pending.method || method
              )}`
            )
          )
        }, timeoutMs)

        this.pendingRequests.set(id, {resolve, reject, timeout, method})

        const data = JSON.stringify(message)
        if (this.transport === 'pipe' && this.pipeOut) {
          this.pipeOut.write(data + '\0')
        } else if (this.ws) {
          this.ws.send(data)
        }
      } catch (error) {
        const pending = this.pendingRequests.get(id)

        if (pending?.timeout) {
          clearTimeout(pending.timeout)
        }

        this.pendingRequests.delete(id)
        reject(error)
      }
    })
  }

  // Target and Session Management
  async getTargets() {
    const response = (await this.sendCommand('Target.getTargets')) as
      | {targetInfos?: Array<Record<string, unknown>>}
      | undefined

    return response?.targetInfos || []
  }

  async getBrowserVersion() {
    const response = (await this.sendCommand('Browser.getVersion')) as
      | {product?: string; userAgent?: string; jsVersion?: string}
      | undefined

    return response || {}
  }

  async attachToTarget(targetId: string) {
    const response = (await this.sendCommand('Target.attachToTarget', {
      targetId,
      flatten: true
    })) as {sessionId?: string}

    return response.sessionId || ''
  }

  async enableAutoAttach() {
    await this.sendCommand('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true
    })
  }

  async enableRuntimeAndLog(sessionId?: string) {
    // Enable across browser for Log domain; Runtime enables per-session
    await this.sendCommand('Log.enable', {}, sessionId)

    if (sessionId) {
      await this.sendCommand('Runtime.enable', {}, sessionId)
    }
  }

  // Navigate to a URL in the specified session
  async navigate(sessionId: string, url: string) {
    await this.sendCommand('Page.navigate', {url}, sessionId)
  }

  // Create a new target (tab) at a given URL and return its targetId
  async createTarget(url: string): Promise<string> {
    const res = (await this.sendCommand('Target.createTarget', {
      url
    })) as {targetId?: string}
    return String(res?.targetId || '')
  }

  // Activate/focus an existing target by id
  async activateTarget(targetId: string): Promise<void> {
    await this.sendCommand('Target.activateTarget', {targetId})
  }

  // Wait for the page to finish loading
  async waitForLoadEvent(sessionId: string) {
    return waitForLoadEvent(this, sessionId)
  }

  // Wait for content script injection with reasonable timeout
  async waitForContentScriptInjection(sessionId: string) {
    return waitForContentScriptInjection(this, sessionId)
  }

  /** Extension root / reinject markers — uses page + isolated content-script context (matches injection wait). */
  async getExtensionRootMeta(
    sessionId: string
  ): Promise<ExtensionRootMetaPayload | undefined> {
    return evaluateExtensionRootMeta(this, sessionId)
  }

  /** Shadow <style> nodes under non-devtools content roots — same dual-context evaluation as root meta. */
  async getShadowStyleSnapshot(
    sessionId: string
  ): Promise<Record<string, unknown> | undefined> {
    return evaluateShadowStyleSnapshot(this, sessionId)
  }

  /** Best-effort poll when injection wait fails (async shadow fill, context quirks). */
  async pollForVisibleShadowHostContent(
    sessionId: string,
    deadlineMs?: number
  ): Promise<void> {
    return pollForVisibleShadowHostContent(this, sessionId, deadlineMs)
  }

  async hasVisibleShadowHostContent(sessionId: string): Promise<boolean> {
    return hasVisibleShadowHostContent(this, sessionId)
  }

  // Evaluate JavaScript in the page context
  async evaluate(
    sessionId: string,
    expression: string,
    options?: {
      awaitPromise?: boolean
    }
  ): Promise<unknown> {
    const response = (await this.sendCommand(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise: options?.awaitPromise === true
      },
      sessionId
    )) as {result?: {value?: unknown}}

    return response.result?.value as unknown
  }

  async evaluateInContext(
    sessionId: string,
    expression: string,
    contextId: number,
    options?: {
      awaitPromise?: boolean
    }
  ): Promise<unknown> {
    const response = (await this.sendCommand(
      'Runtime.evaluate',
      {
        expression,
        contextId,
        returnByValue: true,
        awaitPromise: options?.awaitPromise === true
      },
      sessionId
    )) as {result?: {value?: unknown}}

    return response.result?.value as unknown
  }

  // Get the full HTML of the page including Shadow DOM content
  async getPageHTML(
    sessionId: string,
    includeShadow: 'off' | 'open-only' | 'all' = 'open-only'
  ) {
    return getPageHTML(this, sessionId, includeShadow)
  }

  // Close a target (tab)
  async closeTarget(targetId: string) {
    await this.sendCommand('Target.closeTarget', {targetId})
  }

  // Extension Management Methods
  async forceReloadExtension(extensionId: string) {
    // Safety first: avoid Extensions.reload(forceReload), which can disable
    // or relocate unpacked extensions in fresh Chromium profiles during
    // automation. Keep reloads extension-owned via runtime.reload().
    const attempts = 8
    let lastError: unknown = null
    for (let i = 0; i < attempts; i++) {
      try {
        const ok = await this.reloadExtensionViaTargetEval(extensionId)
        if (ok) return true
      } catch (error) {
        lastError = error
      }
      const backoffMs = Math.min(1200, 150 * (i + 1))
      await new Promise((r) => setTimeout(r, backoffMs))
    }
    console.warn(
      messages.cdpClientExtensionReloadFailed(
        extensionId,
        (lastError as Error)?.message ||
          String(lastError || 'runtime.reload failed')
      )
    )
    return false
  }

  async getExtensionInfo(extensionId: string) {
    try {
      return await getExtensionInfo(this, extensionId)
    } catch (error) {
      throw new Error(
        messages.cdpClientExtensionInfoFailed(
          extensionId,
          (error as Error).message
        )
      )
    }
  }

  private async reloadExtensionViaTargetEval(extensionId: string) {
    try {
      const targets = await this.getTargets()
      const preferredOrder = [
        'service_worker',
        'background_page',
        'worker',
        'page'
      ]

      for (const type of preferredOrder) {
        const matchingTargets = (targets || []).filter(
          (t: Record<string, unknown>) => {
            const url: string = String((t as any)?.url || '')
            const tt: string = String((t as any)?.type || '')
            const inExtensionScope = url.startsWith(
              `chrome-extension://${extensionId}/`
            )

            return tt === type && inExtensionScope
          }
        )

        for (const target of matchingTargets) {
          const targetId: string | undefined = (target as any)?.targetId

          if (!targetId) continue

          try {
            const sessionId = await this.attachToTarget(targetId)
            await this.sendCommand('Runtime.enable', {}, sessionId)
            await this.sendCommand(
              'Runtime.evaluate',
              {
                expression:
                  '(function(){ try { if (!chrome || !chrome.runtime || !chrome.runtime.reload) return false; chrome.runtime.reload(); return true; } catch (error) { return false; } })()',
                returnByValue: true
              },
              sessionId
            )
            return true
          } catch {
            // ignore and try next target
          }
        }
      }
      return false
    } catch {
      return false
    }
  }

  async loadUnpackedExtension(path: string) {
    try {
      return await loadUnpackedExtension(this, path)
    } catch (error) {
      throw new Error(
        messages.cdpClientExtensionLoadFailed(path, (error as Error).message)
      )
    }
  }

  async unloadExtension(extensionId: string) {
    try {
      return await unloadExtension(this, extensionId)
    } catch (error) {
      console.error(
        messages.cdpClientExtensionUnloadFailed(
          extensionId,
          (error as Error).message
        )
      )
      return false
    }
  }
}
