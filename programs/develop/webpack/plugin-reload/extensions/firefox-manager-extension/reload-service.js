let webSocket = null
let triedWsFallback = false

// Get instance ID from the service worker context
const instanceId = '__INSTANCE_ID__'

async function connect() {
  if (webSocket) {
    // If already connected, do nothing
    return
  }

  const port = '__RELOAD_PORT__'
  let reconnectAttempts = 0
  const maxReconnectAttempts = 10
  const baseBackoffMs = 250
  const maxBackoffMs = 5000

  const connectTo = (url) => {
    try {
      webSocket = new WebSocket(url)
    } catch (err) {
      webSocket = null
      return
    }

    webSocket.onerror = (_event) => {
      try {
        webSocket && webSocket.close()
      } catch {}
      if (!triedWsFallback) {
        triedWsFallback = true
        connectTo(`ws://127.0.0.1:${port}`)
      }
    }

    webSocket.onopen = () => {
      reconnectAttempts = 0
      console.info(
        `[Extension.js] Connection opened. Listening on port ${port}...`
      )
      try {
        subscribeAllLoggers()
      } catch {}
      try {
        if (
          !self.__managerHelloSent &&
          webSocket &&
          webSocket.readyState === WebSocket.OPEN
        ) {
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
          self.__managerHelloSent = true
        }
      } catch {}
    }

    let reloadDebounce
    webSocket.onmessage = async (event) => {
      let message = null
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }

      // Only process messages for this instance
      if (message.instanceId && message.instanceId !== instanceId) {
        console.log(
          `[Reload Service] Ignoring message from wrong instance: ${message.instanceId} (expected: ${instanceId})`
        )
        return
      }

      if (message.status === 'serverReady') {
        console.info(
          `[Extension.js] Server ready. Ensuring initial load handshake...`
        )
        await ensureClientReadyHandshake()
        try {
          subscribeAllLoggers()
        } catch {}
      }

      if (message.changedFile) {
        clearTimeout(reloadDebounce)
        reloadDebounce = setTimeout(async () => {
          await messageAllExtensions(message.changedFile)
        }, 200)
      }
    }

    webSocket.onclose = () => {
      console.info('[Extension.js] Connection closed.')
      webSocket = null
      if (reconnectAttempts >= maxReconnectAttempts) return
      reconnectAttempts++
      const backoff = Math.min(
        maxBackoffMs,
        baseBackoffMs * 2 ** reconnectAttempts
      )
      setTimeout(() => connectTo(url), backoff)
    }
  }

  connectTo(`wss://127.0.0.1:${port}`)
}

function disconnect() {
  if (webSocket) {
    webSocket.close()
  }
}

async function requestInitialLoadData() {
  const devExtensions = await getDevExtensions()

  for (const extension of devExtensions) {
    try {
      const response = await browser.runtime.sendMessage(extension.id, {
        initialLoadData: true
      })

      if (response) {
        // Send the response back to the server with instance ID
        webSocket.send(
          JSON.stringify({
            status: 'clientReady',
            instanceId: instanceId,
            data: response
          })
        )
        return true
      }
    } catch (error) {
      console.error(
        `Error sending message to ${extension.id}: ${error.message}`
      )
    }
  }
  return false
}

async function getDevExtensions() {
  const allExtensions = await new Promise((resolve) => {
    try {
      // Firefox MV2 supports callback-style getAll
      browser.management.getAll(resolve)
    } catch {
      // Fallback to promise-based API
      browser.management.getAll().then(resolve)
    }
  })

  return allExtensions.filter((extension) => {
    return (
      // Do not include itself
      extension.id !== browser.runtime.id &&
      // Show only unpackaged extensions (Firefox reports "temporary")
      (extension.installType === 'development' ||
        extension.installType === 'temporary')
    )
  })
}

function subscribeAllLoggers() {
  getDevExtensions().then((devExtensions) => {
    for (const extension of devExtensions) {
      try {
        const port = browser.runtime.connect(extension.id, {name: 'logger'})
        try {
          port.postMessage({type: 'subscribe'})
        } catch {}
        port.onMessage.addListener((msg) => {
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
                const p = browser.runtime.connect(extension.id, {
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

async function messageAllExtensions(changedFile) {
  // Check if the external extension is ready
  const isExtensionReady = await checkExtensionReadiness()

  if (isExtensionReady) {
    const devExtensions = await getDevExtensions()
    for (const extension of devExtensions) {
      try {
        await browser.runtime.sendMessage(extension.id, {changedFile})
        console.info(
          `[Extension.js] Add-On reloaded and ready for instance ${instanceId}.`
        )
      } catch (error) {
        console.error(
          `Error sending message to ${extension.id}: ${error.message}`
        )
      }
    }
  } else {
    console.info(
      `[Extension.js] External extension is not ready for instance ${instanceId}.`
    )
  }
}

async function checkExtensionReadiness() {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(true)
    }, 1000)
  })
}

// Retry handshake until the user extension responds or timeout elapses
async function ensureClientReadyHandshake() {
  const start = Date.now()
  const timeoutMs = Number(self.EXTENSION_CLIENT_READY_TIMEOUT_MS || 15000)
  const attemptDelayMs = 500

  while (Date.now() - start < timeoutMs) {
    try {
      const ok = await requestInitialLoadData()
      if (ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, attemptDelayMs))
  }
}
