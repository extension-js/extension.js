const TEN_SECONDS_MS = 10 * 1000
const INSTANT_MS = 100
const READINESS_DELAY_MS = 1000
let webSocket: WebSocket | null = null

// Get instance ID from the service worker context
const instanceId = '__INSTANCE_ID__'

// Define message types for better type safety
interface WebSocketMessage {
  status?: string
  instanceId?: string
  data?: unknown
  changedFile?: string
}

interface LoggerMessage {
  type: string
  event?: unknown
  events?: unknown[]
}

export async function connect() {
  if (webSocket) {
    // If already connected, do nothing
    return
  }

  // Get port from the placeholder that will be replaced during build
  const port = '__RELOAD_PORT__'

  let reconnectAttempts = 0
  const maxReconnectAttempts = 10
  const baseBackoffMs = 250
  const maxBackoffMs = 5000

  const establish = () => {
    try {
      webSocket = new WebSocket(`ws://127.0.0.1:${port}`)
    } catch (err) {
      webSocket = null
      return
    }

    webSocket.onerror = (_event) => {
      try {
        webSocket && webSocket.close()
      } catch {}
    }

    webSocket.onopen = () => {
      reconnectAttempts = 0
      console.info(
        `[Extension.js] Connection opened. Listening on port ${port} for instance ${instanceId}...`
      )
      try {
        subscribeAllLoggers()
      } catch {}
      try {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) {
          webSocket.send(
            JSON.stringify({
              status: 'log',
              instanceId: instanceId,
              data: {
                level: 'info',
                context: 'manager',
                timestamp: Date.now(),
                messageParts: ['manager connected']
              }
            })
          )
        }
      } catch {}
    }

    let reloadDebounce: ReturnType<typeof setTimeout> | null = null
    webSocket.onmessage = async (event) => {
      let message: WebSocketMessage | null = null
      try {
        message = JSON.parse(event.data) as WebSocketMessage
      } catch {
        return
      }

      // Only process messages for this instance
      if (message.instanceId && message.instanceId !== instanceId) {
        return
      }

      if (message.status === 'serverReady') {
        await ensureClientReadyHandshake()
        try {
          subscribeAllLoggers()
        } catch {}
      }

      if (message && message.changedFile) {
        if (reloadDebounce) clearTimeout(reloadDebounce)

        const changedFile = message.changedFile

        reloadDebounce = setTimeout(async () => {
          await hardReloadAllExtensions(changedFile)
        }, 200)
      }
    }

    webSocket.onclose = () => {
      webSocket = null
      if (reconnectAttempts >= maxReconnectAttempts) return
      reconnectAttempts++
      const backoff = Math.min(
        maxBackoffMs,
        baseBackoffMs * 2 ** reconnectAttempts
      )
      setTimeout(establish, backoff)
    }
  }

  establish()
}

export function disconnect() {
  if (webSocket) {
    webSocket.close()
  }
}

// Ensure sockets are closed when the worker is suspended
try {
  chrome.runtime.onSuspend.addListener(() => {
    if (webSocket) {
      try {
        webSocket.close()
      } catch {}
      webSocket = null
    }
  })
} catch {}

async function requestInitialLoadData() {
  const devExtensions = await getDevExtensions()

  for (const extension of devExtensions) {
    try {
      const response = await chrome.runtime.sendMessage(extension.id, {
        initialLoadData: true
      })

      if (response) {
        // Send the response back to the server with instance ID
        webSocket!.send(
          JSON.stringify({
            status: 'clientReady',
            instanceId: instanceId,
            data: response
          })
        )
        return true
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      console.error(`Error sending message to ${extension.id}: ${errorMessage}`)
    }
  }

  return false
}

async function getDevExtensions() {
  const allExtensions = await new Promise<chrome.management.ExtensionInfo[]>(
    (resolve) => {
      chrome.management.getAll(resolve)
    }
  )

  return allExtensions.filter((extension) => {
    return (
      // Do not include itself
      extension.id !== chrome.runtime.id &&
      // Reload extension
      extension.id !== 'igcijhgmihmjbbahdabahfbpffalcfnn' &&
      // Show only unpackaged extensions
      extension.installType === 'development'
    )
  })
}

function subscribeAllLoggers() {
  getDevExtensions().then((devExtensions) => {
    for (const extension of devExtensions) {
      try {
        const port = chrome.runtime.connect(extension.id, {
          name: 'logger'
        }) as chrome.runtime.Port
        try {
          port.postMessage({type: 'subscribe'})
        } catch {}
        port.onMessage.addListener((msg: LoggerMessage) => {
          try {
            if (!webSocket) return
            if (webSocket.readyState !== WebSocket.OPEN) return
            if (msg && msg.type === 'append' && msg.event) {
              webSocket.send(
                JSON.stringify({
                  status: 'log',
                  instanceId: instanceId,
                  data: msg.event
                })
              )
            } else if (
              msg &&
              msg.type === 'init' &&
              Array.isArray(msg.events)
            ) {
              for (const ev of msg.events) {
                webSocket.send(
                  JSON.stringify({
                    status: 'log',
                    instanceId: instanceId,
                    data: ev
                  })
                )
              }
            }
          } catch {}
        })
        port.onDisconnect.addListener(() => {
          try {
            setTimeout(() => {
              try {
                const p = chrome.runtime.connect(extension.id, {
                  name: 'logger'
                })
                p.postMessage({type: 'subscribe'})
              } catch {}
            }, 1000)
          } catch {}
        })
      } catch {}
    }
  })
}

async function hardReloadAllExtensions(changedFile: string) {
  // For critical files like manifest.json, skip the long delay
  const isCriticalFile =
    changedFile === 'manifest.json' ||
    changedFile === 'service_worker' ||
    changedFile === 'declarative_net_request'

  // Check if the external extension is ready with optimized timing
  const isExtensionReady = await checkExtensionReadiness(isCriticalFile)

  if (isExtensionReady) {
    // The CLI controller drives the actual extension reload via CDP/RDP
    // (chrome.runtime.reload() / reloadAddon). This companion only
    // forwards the changedFile signal so user extensions that listen for
    // it can run in-process HMR. We deliberately do NOT call
    // chrome.management.setEnabled(false→true) here — repeated toggling
    // of dev-loaded extensions clobbers the manifest registration of
    // OTHER dev-mode add-ons (this companion included), which breaks
    // its own content_script auto-injection after a few rebuild cycles
    const devExtensions = await getDevExtensions()

    for (const extension of devExtensions) {
      try {
        chrome.runtime.sendMessage(
          extension.id,
          {changedFile},
          (response) => {
            if (response) {
              console.info(
                `[Extension.js] Change notification delivered for instance ${instanceId}.`
              )
            }
          }
        )
      } catch {
        // The user extension may not expose a runtime message listener
      }
    }
  } else {
    console.info(
      `[Extension.js] External extension is not ready for instance ${instanceId}.`
    )
  }
}

async function checkExtensionReadiness(
  isCriticalFile = false
): Promise<boolean> {
  return new Promise((resolve) => {
    // For critical files like manifest.json, use minimal delay
    // For regular files, use shorter delay to improve responsiveness
    const delay = isCriticalFile ? INSTANT_MS : READINESS_DELAY_MS

    setTimeout(() => {
      resolve(true)
    }, delay)
  })
}

export function keepAlive() {
  const keepAliveIntervalId = setInterval(() => {
    if (webSocket) {
      webSocket.send(JSON.stringify({status: 'ping'}))
      console.info('[Extension.js] Listening for changes...')
    } else {
      clearInterval(keepAliveIntervalId)
    }
  }, TEN_SECONDS_MS)
}

// Retry handshake until the user extension responds or timeout elapses
async function ensureClientReadyHandshake() {
  const start = Date.now()
  const timeoutMs = Number(
    (globalThis as {EXTENSION_CLIENT_READY_TIMEOUT_MS?: number})
      .EXTENSION_CLIENT_READY_TIMEOUT_MS || 15000
  )
  const attemptDelayMs = Number(
    (globalThis as {EXTENSION_CLIENT_READY_POLL_MS?: number})
      .EXTENSION_CLIENT_READY_POLL_MS || 250
  )

  while (Date.now() - start < timeoutMs) {
    try {
      const ok = await requestInitialLoadData()
      if (ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, attemptDelayMs))
  }
}

