const TEN_SECONDS_MS = 10 * 1000
let webSocket = null

export async function connect() {
  if (webSocket) {
    // If already connected, do nothing
    return
  }

  webSocket = new WebSocket('ws://localhost:__RELOAD_PORT__')

  webSocket.onerror = (event) => {
    console.error(`[Reload Service] Connection error: ${JSON.stringify(event)}`)
    webSocket.close()
  }

  webSocket.onopen = () => {
    console.info(`[Reload Service] Connection opened.`)
  }

  webSocket.onmessage = async (event) => {
    const message = JSON.parse(event.data)

    if (message.status === 'serverReady') {
      console.info('[Reload Service] Connection ready.')
      await requestInitialLoadData()
    }

    if (message.changedFile) {
      console.info(
        `[Reload Service] Changes detected on ${message.changedFile}. Reloading extension...`
      )

      await hardReloadAllExtensions(message.changedFile)
    }
  }

  webSocket.onclose = () => {
    console.info('[Reload Service] Connection closed.')
    webSocket = null
  }
}

export function disconnect() {
  if (webSocket) {
    webSocket.close()
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
      // Manager extension
      extension.id !== 'hkklidinfhnfidkjiknmmbmcloigimco' &&
      // Show only unpackaged extensions
      extension.installType === 'development'
    )
  })
}

async function hardReloadAllExtensions(changedFile) {
  // Check if the external extension is ready
  const isExtensionReady = await checkExtensionReadiness()

  if (isExtensionReady) {
    const devExtensions = await getDevExtensions()
    const reloadAll = devExtensions.map(async (extension) => {
      await hardReloadExtension(extension.id)

      chrome.runtime.sendMessage(extension.id, {changedFile}, (response) => {
        if (response) {
          console.info('[Reload Service] Extension reloaded and ready.')
        }
      })

      return true
    })

    await Promise.all(reloadAll)
  } else {
    console.info('[Reload Service] External extension is not ready.')
  }
}

async function requestInitialLoadData() {
  const devExtensions = await getDevExtensions()

  const messagePromises = devExtensions.map(async (extension) => {
    return await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        extension.id,
        {initialLoadData: true},
        (response) => {
          if (chrome.runtime.lastError) {
            console.error(
              `Error sending message to ${extension.id}: ${chrome.runtime.lastError.message}`
            )
            resolve(null)
          } else {
            resolve(response)
          }
        }
      )
    })
  })

  const responses = await Promise.all(messagePromises)

  // We received the info from the use extension.
  // All good, client is ready. Inform the server.
  if (webSocket && webSocket.readyState === WebSocket.OPEN) {
    const message = JSON.stringify({
      status: 'clientReady',
      data: responses[0]
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

const toggleExtensionState = (extensionId, enabled) => {
  if (extensionId === chrome.runtime.id) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    chrome.management.setEnabled(extensionId, enabled, resolve)
  })
}

async function hardReloadExtension(extensionId) {
  await toggleExtensionState(extensionId, false)
  await toggleExtensionState(extensionId, true)
}
