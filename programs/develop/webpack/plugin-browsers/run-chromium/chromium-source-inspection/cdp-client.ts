// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import WebSocket from 'ws'
import * as messages from '../../browsers-lib/messages'
import {
  getExtensionInfo,
  loadUnpackedExtension,
  unloadExtension
} from './extensions'
import {discoverWebSocketDebuggerUrl} from './discovery'
import {establishBrowserConnection} from './ws'
import {
  waitForLoadEvent,
  waitForContentScriptInjection,
  getPageHTML
} from './page'

// Chrome DevTools Protocol Client for source inspection
// Handles communication with Chrome's remote debugging interface
export class CDPClient {
  private port: number
  private host: string
  private ws: WebSocket | null = null
  private targetWebSocketUrl: string | null = null
  private eventCallback?: (message: Record<string, unknown>) => void
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

        this.ws = await establishBrowserConnection(
          this.targetWebSocketUrl!,
          this.isDev(),
          (data) => this.handleMessage(data),
          (reason) => {
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
          }
        )

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

  disconnect() {
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // ignore
      }
      this.ws = null
    }
  }

  onProtocolEvent(handler: (message: Record<string, unknown>) => void) {
    this.eventCallback = handler
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

      if (this.eventCallback) this.eventCallback(message)
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
    timeoutMs: number = 12000
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('WebSocket is not open'))
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
        this.ws.send(JSON.stringify(message))
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

  // Evaluate JavaScript in the page context
  async evaluate(sessionId: string, expression: string): Promise<unknown> {
    const response = (await this.sendCommand(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true
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
    try {
      // Preferred path: Chrome's Extensions domain when available
      await this.sendCommand('Extensions.reload', {
        extensionId,
        forceReload: true
      })
      return true
    } catch (error) {
      // Fallback: evaluate chrome.runtime.reload() on a suitable target
      const attempts = 8
      for (let i = 0; i < attempts; i++) {
        try {
          const ok = await this.reloadExtensionViaTargetEval(extensionId)
          if (ok) return true
        } catch {}
        const backoffMs = Math.min(1200, 150 * (i + 1))
        await new Promise((r) => setTimeout(r, backoffMs))
      }
      console.warn(
        messages.cdpClientExtensionReloadFailed(
          extensionId,
          (error as Error).message || String(error)
        )
      )
      return false
    }
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
