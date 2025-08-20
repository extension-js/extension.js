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
    webSocket = new WebSocket(url)

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
    }

    let reloadDebounce
    webSocket.onmessage = async (event) => {
      const message = JSON.parse(event.data)

      // Only process messages for this instance
      if (message.instanceId && message.instanceId !== instanceId) {
        console.log(
          `[Reload Service] Ignoring message from wrong instance: ${message.instanceId} (expected: ${instanceId})`
        )
        return
      }

      if (message.status === 'serverReady') {
        console.info(
          `[Extension.js] Server ready. Requesting initial load data...`
        )
        await requestInitialLoadData()
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
      }
    } catch (error) {
      console.error(
        `Error sending message to ${extension.id}: ${error.message}`
      )
    }
  }
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
