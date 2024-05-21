let webSocket = null

browser.runtime.onInstalled.addListener(async () => {
  if (webSocket) {
    disconnect()
  } else {
    await connect()
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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

// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
async function delay(ms) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return await new Promise((resolve) => setTimeout(resolve, ms)).catch(
    (error) => {
      console.error(`Error delaying: ${error.message}`)
    }
  )
}
