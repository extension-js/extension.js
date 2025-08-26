let webSocket = null
let triedWsFallback = false

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
    }

    let reloadDebounce
    webSocket.onmessage = async (event) => {
      let message = null
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }

      if (message.status === 'serverReady') {
        console.info(
          `[Extension.js] Server ready. Requesting initial load data...`
        )
        try { await requestInitialLoadData() } catch {}
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

export function disconnect() {
  if (webSocket) {
    webSocket.close()
  }
}

async function getDevExtensions() {
  const allExtensions = await browser.management.getAll()

  return allExtensions.filter((extension) => {
    return (
      // Do not include itself
      extension.id !== browser.runtime.id &&
      // Manager extension
      extension.name !== 'Add-On Manager' &&
      // Show only unpackaged extensions
      extension.installType === 'development'
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
        console.info('[Extension.js] Add-On reloaded and ready.')
      } catch (error) {
        console.error(
          `[Extension.js] Error sending message to ${extension.id}: ${error.message}`
        )
      }
    }
  } else {
    console.info('[Extension.js] External extension is not ready.')
  }
}

async function requestInitialLoadData() {
  const devExtensions = await getDevExtensions()

  const responses = await Promise.all(
    devExtensions.map(async (extension) => {
      try {
        const result = await browser.runtime.sendMessage(extension.id, {
          initialLoadData: true
        })

        return result
      } catch (error) {
        console.error(
          `Error sending message to ${extension.id}: ${error.message}`
        )
        return null
      }
    })
  )

  // We received the info from the use extension.
  // All good, client is ready. Inform the server.
  if (webSocket && webSocket.readyState === WebSocket.OPEN) {
    const message = JSON.stringify({
      status: 'clientReady',
      data: responses.find((response) => response !== null)
    })

    webSocket.send(message)
  }
}

async function checkExtensionReadiness() {
  // Delay for 1 second
  await delay(1000)
  // Assume the extension is ready
  return true
}

async function delay(ms) {
  return await new Promise((resolve) => setTimeout(resolve, ms)).catch(
    (error) => {
      console.error(`[Extension.js] Error delaying: ${error.message}`)
    }
  )
}
