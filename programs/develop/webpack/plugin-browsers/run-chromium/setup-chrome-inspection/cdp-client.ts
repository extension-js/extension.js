import * as net from 'net'
import * as http from 'http'
import WebSocket from 'ws'
import * as messages from '../../browsers-lib/messages'
import {mergeShadowIntoDocument} from '../../browsers-lib/html-merge'

// Chrome DevTools Protocol Client for source inspection
// Handles communication with Chrome's remote debugging interface
export class CDPClient {
  private port: number
  private host: string
  private ws: WebSocket | null = null
  private messageId = 0
  private pendingRequests = new Map<
    number,
    {resolve: Function; reject: Function}
  >()
  private targetWebSocketUrl: string | null = null

  constructor(port: number = 9222, host: string = '127.0.0.1') {
    this.port = port
    this.host = host
  }

  async connect(): Promise<void> {
    // Prefer the browser-level websocket (more stable), fallback to first page target
    const getJson = (path: string) =>
      new Promise<any>((resolve, reject) => {
        const req = http.request(
          {hostname: this.host, port: this.port, path, method: 'GET'},
          (res) => {
            let data = ''
            res.on('data', (chunk) => (data += chunk))
            res.on('end', () => {
              try {
                resolve(JSON.parse(data))
              } catch (e) {
                reject(new Error(`Failed to parse ${path}: ${e}`))
              }
            })
          }
        )
        req.on('error', (err) => reject(err))
        req.end()
      })

    return new Promise(async (resolve, reject) => {
      try {
        // Try /json/version for browser websocket URL
        try {
          const version = await getJson('/json/version')
          if (version && version.webSocketDebuggerUrl) {
            this.targetWebSocketUrl = version.webSocketDebuggerUrl
            console.log(messages.cdpClientTargetWebSocketUrlStored())
          }
        } catch {}

        if (!this.targetWebSocketUrl) {
          const targets = await getJson('/json')
          console.log(messages.cdpClientFoundTargets(targets?.length || 0))
          const pageTarget = (targets || []).find(
            (target: any) =>
              target.type === 'page' && target.webSocketDebuggerUrl
          )
          if (pageTarget) {
            this.targetWebSocketUrl = pageTarget.webSocketDebuggerUrl
            console.log(messages.cdpClientTargetWebSocketUrlStored())
          }
        }

        if (!this.targetWebSocketUrl) {
          return reject(new Error('No CDP WebSocket URL available'))
        }

        await this.establishBrowserConnection()
        console.log(messages.cdpClientConnected(this.host, this.port))
        resolve()
      } catch (error: any) {
        reject(
          new Error(`Failed to connect to CDP: ${error?.message || error}`)
        )
      }
    })
  }

  disconnect() {
    if (this.ws) {
      try {
        this.ws.close()
      } catch {}
      this.ws = null
    }
    // Reject any pending requests to avoid dangling promises
    this.pendingRequests.forEach(({reject}, id) => {
      try {
        reject(new Error('CDP client disconnected'))
      } catch {}
      this.pendingRequests.delete(id)
    })
  }

  async sendCommand(
    method: string,
    params: any = {},
    sessionId?: string
  ): Promise<any> {
    if (!this.ws) {
      throw new Error('CDP client not connected')
    }

    const id = ++this.messageId
    const message: any = {
      id,
      method,
      params
    }

    if (sessionId) {
      message.sessionId = sessionId
    }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {resolve, reject})

      const messageStr = JSON.stringify(message)
      this.ws!.send(messageStr)
    })
  }

  private handleMessage(data: string) {
    const messageData = data.split('\0').filter((msg) => msg.trim())

    for (const messageStr of messageData) {
      try {
        const message = JSON.parse(messageStr)

        // Debug logging for important events
        if (message.method === 'Page.loadEventFired') {
          console.log(messages.cdpClientPageLoadEventFired())
        }

        if (message.id && this.pendingRequests.has(message.id)) {
          const {resolve, reject} = this.pendingRequests.get(message.id)!
          this.pendingRequests.delete(message.id)

          if (message.error) {
            reject(new Error(message.error.message))
          } else {
            resolve(message.result)
          }
        }
      } catch (error) {
        console.error(
          messages.cdpClientMessageParseError((error as Error).message)
        )
      }
    }
  }

  // Get all available tabs
  async getTargets(): Promise<any[]> {
    const response = await this.sendCommand('Target.getTargets')
    return response.targetInfos || []
  }

  // Create a new tab with the specified URL
  async createTarget(url: string): Promise<string> {
    // Ensure we have a WebSocket connection
    if (!this.ws) {
      throw new Error('CDP client not connected. Call connect() first.')
    }

    // Create the target with the URL. Should automatically navigate
    const response = await this.sendCommand('Target.createTarget', {
      url,
      newWindow: false
    })

    const targetId = response.targetId

    // Wait a moment for the target to be created and start navigating
    // Using a reasonable delay instead of complex event waiting
    await new Promise((resolve) => setTimeout(resolve, 1000))

    return targetId
  }

  // Navigate to a URL in an existing target
  async navigateToUrl(targetId: string, url: string): Promise<void> {
    // First attach to the target to get a session
    const attachResponse = await this.sendCommand('Target.attachToTarget', {
      targetId,
      flatten: true
    })

    const sessionId = attachResponse.sessionId

    // Enable page domain to receive load events
    await this.sendCommand('Page.enable', {}, sessionId)

    // Navigate to the URL
    await this.sendCommand('Page.navigate', {url}, sessionId)
  }

  // Establish connection to the chromes's CDP endpoint (not to a specific target)
  private async establishBrowserConnection(): Promise<void> {
    if (!this.targetWebSocketUrl) {
      throw new Error('No target WebSocket URL available')
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.targetWebSocketUrl!)

      this.ws.on('open', () => {
        console.log(messages.cdpClientBrowserConnectionEstablished())
        resolve()
      })

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data.toString())
      })

      this.ws.on('error', (error: Error) => {
        console.error(messages.cdpClientConnectionError(error.message))
        // Reject all pending to avoid hangs
        this.pendingRequests.forEach(({reject}, id) => {
          try {
            reject(new Error(error.message))
          } catch {}
          this.pendingRequests.delete(id)
        })
        reject(error)
      })

      this.ws.on('close', () => {
        console.log(messages.cdpClientConnectionClosed())
        // Reject any pending requests
        this.pendingRequests.forEach(({reject}, id) => {
          try {
            reject(new Error('CDP connection closed'))
          } catch {}
          this.pendingRequests.delete(id)
        })
      })
    })
  }

  // Attach to a tab
  async attachToTarget(targetId: string): Promise<string> {
    const response = await this.sendCommand('Target.attachToTarget', {
      targetId,
      flatten: true
    })
    return response.sessionId
  }

  // Navigate to a URL in the specified session
  async navigate(sessionId: string, url: string): Promise<void> {
    await this.sendCommand('Page.navigate', {url}, sessionId)
  }

  // Wait for the page to finish loading
  async waitForLoadEvent(sessionId: string): Promise<void> {
    return new Promise((resolve) => {
      let resolved = false

      // Listen for Page.loadEventFired
      const listener = (data: string) => {
        try {
          const message = JSON.parse(data)
          if (
            message.method === 'Page.loadEventFired' &&
            message.sessionId === sessionId &&
            !resolved
          ) {
            resolved = true
            resolve()
          }
        } catch (error) {
          // Ignore parsing errors
        }
      }

      // Add temporary listener
      const originalHandleMessage = this.handleMessage.bind(this)
      this.handleMessage = (data: string) => {
        originalHandleMessage(data)
        listener(data)
      }

      // Remove listener after load event or timeout
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          console.log(messages.cdpClientLoadEventTimeout())
          resolve()
        }
        this.handleMessage = originalHandleMessage
      }, 2000)
    })
  }

  // Wait for content script injection with reasonable timeout
  async waitForContentScriptInjection(sessionId: string): Promise<void> {
    // Use a reasonable delay for content script injection
    // This is more reliable than complex event waiting
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  // Evaluate JavaScript in the page context
  async evaluate(sessionId: string, expression: string): Promise<any> {
    const response = await this.sendCommand(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true
      },
      sessionId
    )

    return response.result?.value
  }

  // Get the full HTML of the page including Shadow DOM content
  async getPageHTML(sessionId: string): Promise<string> {
    // Test if basic evaluation works
    console.log(messages.cdpClientTestingEvaluation())
    const testResult = await this.evaluate(sessionId, 'document.title')
    console.log(messages.cdpClientDocumentTitle(testResult))

    // Get the main HTML
    console.log(messages.cdpClientGettingMainHTML())
    const mainHTML = await this.evaluate(
      sessionId,
      'document.documentElement.outerHTML'
    )
    console.log(
      messages.cdpClientMainHTMLLength(mainHTML ? mainHTML.length : 0)
    )

    if (!mainHTML) {
      console.log(messages.cdpClientFailedToGetMainHTML())
      return ''
    }

    // Check for Shadow DOM
    console.log(messages.cdpClientCheckingShadowDOM())
    const shadowContent = await this.evaluate(
      sessionId,
      `
      (function() {
        const extensionRoot = document.getElementById('extension-root');
        if (extensionRoot && extensionRoot.shadowRoot) {
          return extensionRoot.shadowRoot.innerHTML;
        }
        return null;
      })()
    `
    )

    console.log(messages.cdpClientShadowDOMContentFound(!!shadowContent))
    if (shadowContent) {
      console.log(
        messages.cdpClientShadowDOMContentLength(shadowContent.length)
      )
      console.log(messages.cdpClientProcessingShadowDOM())

      const finalHTML = mergeShadowIntoDocument(mainHTML, shadowContent)
      console.log(
        messages.cdpClientFinalHTMLWithShadowDOMLength(
          finalHTML ? finalHTML.length : 0
        )
      )
      return finalHTML || ''
    }

    console.log(messages.cdpClientReturningMainHTML())
    return mainHTML || ''
  }

  // Close a target (tab)
  async closeTarget(targetId: string): Promise<void> {
    await this.sendCommand('Target.closeTarget', {targetId})
  }

  // Extension Management Methods
  async forceReloadExtension(extensionId: string): Promise<boolean> {
    try {
      await this.sendCommand('Extensions.reload', {
        extensionId: extensionId,
        forceReload: true
      })
      return true
    } catch (error) {
      console.error(
        messages.cdpClientExtensionReloadFailed(
          extensionId,
          (error as Error).message
        )
      )
      return false
    }
  }

  async getExtensionInfo(extensionId: string): Promise<any> {
    try {
      const response = await this.sendCommand('Extensions.getExtensionInfo', {
        extensionId: extensionId
      })
      return response
    } catch (error) {
      throw new Error(
        messages.cdpClientExtensionInfoFailed(
          extensionId,
          (error as Error).message
        )
      )
    }
  }

  async loadUnpackedExtension(path: string): Promise<string> {
    try {
      const response = await this.sendCommand('Extensions.loadUnpacked', {
        path: path
      })
      return response.extensionId
    } catch (error) {
      throw new Error(
        messages.cdpClientExtensionLoadFailed(path, (error as Error).message)
      )
    }
  }

  async unloadExtension(extensionId: string): Promise<boolean> {
    try {
      await this.sendCommand('Extensions.unload', {
        extensionId: extensionId
      })
      return true
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

// Utility function to check if Chrome is running with remote debugging
export async function checkChromeRemoteDebugging(
  port: number = 9222
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()

    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })

    socket.on('error', () => {
      resolve(false)
    })

    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })

    socket.setTimeout(2000)
    socket.connect(port, 'localhost')
  })
}
