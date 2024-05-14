const TEN_SECONDS_MS = 10 * 1000
let webSocket = null

browser.runtime.onInstalled.addListener(async () => {
  if (webSocket) {
    disconnect()
  } else {
    await connect()
    keepAlive()
  }
})

async function connect() {
  if (webSocket) {
    // If already connected, do nothing
    return
  }

  webSocket = new WebSocket('wss://127.0.0.1:8002')

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

      await messageAllExtensions(message.changedFile)
    }
  }

  webSocket.onclose = () => {
    console.info('[Reload Service] Connection closed.')
    webSocket = null
  }
}

function disconnect() {
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
      extension.browser_specific_settings?.gecko?.id !==
        'manager@extension-js' &&
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
        console.info('[Reload Service] Add-On reloaded and ready.')
      } catch (error) {
        console.error(
          `Error sending message to ${extension.id}: ${error.message}`
        )
      }
    }
  } else {
    console.info('[Reload Service] External extension is not ready.')
  }
}

async function requestInitialLoadData() {
  const devExtensions = await getDevExtensions()

  const responses = await Promise.all(
    devExtensions.map(async (extension) => {
      try {
        return await browser.runtime.sendMessage(extension.id, {
          initialLoadData: true
        })
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function keepAlive() {
  const keepAliveIntervalId = setInterval(() => {
    // if (webSocket) {
    //   webSocket.send(JSON.stringify({status: 'ping'}))
    //   console.info('[Reload Service] Listening for changes...')
    // } else {
    //   clearInterval(keepAliveIntervalId)
    // }
  }, TEN_SECONDS_MS)
}
