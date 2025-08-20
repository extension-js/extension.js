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

  let reconnectAttempts = 0
  const maxReconnectAttempts = 10
  const baseBackoffMs = 250
  const maxBackoffMs = 5000

  const establish = () => {
    webSocket = new WebSocket(`ws://127.0.0.1:${port}`)

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
    }

    let reloadDebounce
    webSocket.onmessage = async (event) => {
      const message = JSON.parse(event.data)

      // Only process messages for this instance
      if (message.instanceId && message.instanceId !== instanceId) {
        return
      }

      if (message.status === 'serverReady') {
        await requestInitialLoadData()
      }

      if (message.changedFile) {
        clearTimeout(reloadDebounce)
        reloadDebounce = setTimeout(async () => {
          await hardReloadAllExtensions(message.changedFile)
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
            `[Extension.js] Extension reloaded and ready for instance ${instanceId}.`
          )
        }
      })

      return true
    })

    await Promise.all(reloadAll)
  } else {
    console.info(
      `[Extension.js] External extension is not ready for instance ${instanceId}.`
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
      console.info('[Extension.js] Listening for changes...')
    } else {
      clearInterval(keepAliveIntervalId)
    }
  }, TEN_SECONDS_MS)
}

// Smart reload strategy: Try standard method first, fallback to CDP if needed
async function hardReloadExtension(extensionId) {
  try {
    // Try the standard enable/disable reload first (feels natural)
    await chrome.management.setEnabled(extensionId, false)
    await chrome.management.setEnabled(extensionId, true)

    // Verify it worked with a simple health check
    const isHealthy = await verifyExtensionHealth(extensionId)
    if (isHealthy) {
      console.info(
        `[Extension.js] Standard reload successful for ${extensionId}`
      )
      return true
    }

    // If we get here, the reload "succeeded" but extension isn't healthy
    throw new Error('Extension reloaded but not responding')
  } catch (error) {
    console.warn(
      `[Extension.js] Standard reload failed for ${extensionId}, trying CDP fallback: ${error.message}`
    )

    // Only use CDP when the natural approach fails
    return await attemptCDPFallback(extensionId)
  }
}

// CDP fallback for when standard reload fails
async function attemptCDPFallback(extensionId) {
  try {
    // Get extension info to find its source path
    const extensionInfo = await new Promise((resolve) => {
      chrome.management.get(extensionId, resolve)
    })

    if (!extensionInfo || !extensionInfo.path) {
      console.warn(
        `[Extension.js] No path info for ${extensionId}, CDP fallback not possible`
      )
      return false
    }

    // Use CDP client directly for seamless fallback
    const cdpClient = await getCDPClient()
    if (!cdpClient) {
      console.warn(`[Extension.js] CDP client not available for ${extensionId}`)
      return false
    }

    // Use CDP to force reload the extension
    const success = await cdpClient.forceReloadExtension(extensionId)
    if (success) {
      console.info(`[Extension.js] CDP fallback successful for ${extensionId}`)
      return true
    } else {
      console.warn(`[Extension.js] CDP fallback failed for ${extensionId}`)
      return false
    }
  } catch (cdpError) {
    console.error(
      `[Extension.js] CDP fallback also failed for ${extensionId}: ${cdpError.message}`
    )
    return false
  }
}

// Get CDP client instance
// This will be injected by the build process
async function getCDPClient() {
  try {
    // The CDP client will be available globally when injected
    if (typeof window !== 'undefined' && window.cdpClient) {
      return window.cdpClient
    }

    // Fallback for service worker context
    if (typeof globalThis !== 'undefined' && globalThis.cdpClient) {
      return globalThis.cdpClient
    }

    console.warn(`[Extension.js] CDP client not found in global scope`)
    return null
  } catch (error) {
    console.warn(`[Extension.js] Failed to get CDP client: ${error.message}`)
    return null
  }
}

// Simple health check to verify extension is responsive
async function verifyExtensionHealth(extensionId) {
  try {
    // Simple ping to see if extension responds
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Health check timeout'))
      }, 2000)

      chrome.runtime.sendMessage(extensionId, {type: 'PING'}, (response) => {
        clearTimeout(timeout)
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          resolve(response)
        }
      })
    })
    return true
  } catch (error) {
    console.warn(
      `[Extension.js] Health check failed for ${extensionId}: ${error.message}`
    )
    return false
  }
}
