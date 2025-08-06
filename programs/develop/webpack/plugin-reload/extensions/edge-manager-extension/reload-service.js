const TEN_SECONDS_MS = 10 * 1000
const INSTANT_MS = 100
let webSocket = null

// Get instance ID from the service worker context
const instanceId = '__INSTANCE_ID__'

export async function connect() {
  if (webSocket) {
    // If already connected, do nothing
    return
  }

  // Get port from the placeholder that will be replaced during build
  const port = '__RELOAD_PORT__'
  webSocket = new WebSocket(`ws://localhost:${port}`)

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

      await hardReloadAllExtensions(message.changedFile)
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
      const response = await chrome.runtime.sendMessage(extension.id, {
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
    chrome.management.getAll(resolve)
  })

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

async function hardReloadAllExtensions(changedFile) {
  // For critical files like manifest.json, skip the long delay
  const isCriticalFile =
    changedFile === 'manifest.json' ||
    changedFile === 'service_worker' ||
    changedFile === 'declarative_net_request'

  // Check if the external extension is ready with optimized timing
  const isExtensionReady = await checkExtensionReadiness(isCriticalFile)

  if (isExtensionReady) {
    const devExtensions = await getDevExtensions()
    const reloadAll = devExtensions.map(async (extension) => {
      await hardReloadExtension(extension.id)

      chrome.runtime.sendMessage(extension.id, {changedFile}, (response) => {
        if (response) {
          console.info(
            `[Reload Service] Extension reloaded and ready for instance ${instanceId}.`
          )
        }
      })

      return true
    })

    await Promise.all(reloadAll)
  } else {
    console.info(
      `[Reload Service] External extension is not ready for instance ${instanceId}.`
    )
  }
}

async function checkExtensionReadiness(isCriticalFile = false) {
  return new Promise((resolve) => {
    // For critical files like manifest.json, use minimal delay
    // For regular files, use longer delay to ensure stability
    const delay = isCriticalFile ? INSTANT_MS : TEN_SECONDS_MS

    setTimeout(() => {
      resolve(true)
    }, delay)
  })
}

async function delay(ms) {
  return await new Promise((resolve) => setTimeout(resolve, ms))
}

export function keepAlive() {
  const keepAliveIntervalId = setInterval(() => {
    if (webSocket) {
      webSocket.send(JSON.stringify({status: 'ping'}))
      console.info('[Reload Service] Listening for changes...')
    } else {
      clearInterval(keepAliveIntervalId)
    }
  }, TEN_SECONDS_MS)
}

async function hardReloadExtension(extensionId) {
  try {
    await chrome.management.setEnabled(extensionId, false)
    await chrome.management.setEnabled(extensionId, true)
  } catch (error) {
    console.error(`Error reloading extension ${extensionId}: ${error.message}`)
  }
}
