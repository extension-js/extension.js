import WebSocket from 'ws'

export default function (port?: number) {
  const webSocketServer = new WebSocket.Server({host: 'localhost', port})
  webSocketServer.on('connection', (ws) => {
    ws.send(JSON.stringify({status: 'serverReady'}))
    console.log('\n[Reload Service] Starting a new browser instance...\n')

    ws.on('error', (error) => {
      console.log('Error', error)
      webSocketServer.close()
    })

    ws.on('close', () => {
      console.log('[Reload Service] Watch mode closed. Exiting...\n')
      webSocketServer.close()
    })

    // We're only ready when the extension says so
    ws.on('message', (msg) => {
      const message = JSON.parse(JSON.stringify(msg))

      if (message.status === 'clientReady') {
        console.log(
          '[Reload Service] Browser setup completed! Extension loaded.\n'
        )
      }

      if (message.status === 'extensionReloaded') {
        console.log(
          '[Reload Service] Extension reloaded. Watching for changes...\n'
        )
      }

      if (message.status === 'tabReloaded') {
        console.log(
          '[Reload Service] Extension tab reloaded. Watching for changes...\n'
        )
      }

      if (message.status === 'allTabsReloaded') {
        console.log(
          '[Reload Service] All tabs reloaded. Watching for changes...\n'
        )
      }

      if (message.status === 'allExtensionsReloaded') {
        console.log(
          '[Reload Service] All extensions reloaded. Watching for changes...\n'
        )
      }

      if (message.status === 'manifestReloaded') {
        console.log(
          '[Reload Service] Manifest change detected. Watching for changes...\n'
        )
      }

      if (message.status === 'everythingReloaded') {
        console.log(
          '[Reload Service] Extension and tabs reloaded. Watching for changes...\n'
        )
      }
    })
  })

  return webSocketServer
}
