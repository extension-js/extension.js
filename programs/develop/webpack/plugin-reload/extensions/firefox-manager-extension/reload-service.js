let webSocket = null

// Get instance ID from the service worker context
const instanceId = '__INSTANCE_ID__'

export async function connect() {
  if (webSocket) {
    // If already connected, do nothing
    return
  }

  const port = '__RELOAD_PORT__'
  webSocket = new WebSocket(`wss://127.0.0.1:${port + 2}`)

  webSocket.onerror = (event) => {
    console.error(`[Reload Service] Connection error: ${JSON.stringify(event)}`)
    webSocket.close()
  }

  webSocket.onopen = () => {
    console.info(
      `[Reload Service] Connection opened. Listening on port ${port} for instance ${instanceId}...`
    )
  }

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
        `[Reload Service] Server ready for instance ${instanceId}. Requesting initial load data...`
      )
      await requestInitialLoadData()
    }

    if (message.changedFile) {
      console.info(
        `[Reload Service] Changes detected on ${message.changedFile} for instance ${instanceId}. Reloading extension...`
      )

      await messageAllExtensions(message.changedFile)
    }
  }

  webSocket.onclose = () => {
    console.info(
      `[Reload Service] Connection closed for instance ${instanceId}.`
    )
    webSocket = null
  }
}

export function disconnect() {
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
    browser.management.getAll(resolve)
  })

  return allExtensions.filter((extension) => {
    return (
      // Do not include itself
      extension.id !== browser.runtime.id &&
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
        console.info(
          `[Reload Service] Add-On reloaded and ready for instance ${instanceId}.`
        )
      } catch (error) {
        console.error(
          `Error sending message to ${extension.id}: ${error.message}`
        )
      }
    }
  } else {
    console.info(
      `[Reload Service] External extension is not ready for instance ${instanceId}.`
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
