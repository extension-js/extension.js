import {type Compiler} from 'webpack'
import WebSocket from 'ws'

export default function (compiler: Compiler, port?: number) {
  const webSocketServer = new WebSocket.Server({
    host: 'localhost',
    port
  })

  webSocketServer.on('connection', (ws) => {
    ws.send(JSON.stringify({status: 'serverReady'}))
    if (process.env.EXTENSION_ENV === 'development') {
      console.log(
        '\n[extension-create setup] Starting a new Chrome instance...\n'
      )
    }

    ws.on('error', (error) => {
      console.log('Error', error)
      webSocketServer.close()
    })

    ws.on('close', () => {
      console.log('[😓] Watch mode closed. Exiting...\n')
      webSocketServer.close()
    })

    // We're only ready when the extension says so
    ws.on('message', (msg) => {
      const message = JSON.parse(msg.toString())

      if (message.status === 'clientReady') {
        if (!message.data) {
          // TODO: cezaraugusto this happens when the extension
          // can't reach the background script. Improve this error.
          throw new Error(
            '[run-chrome] No data received from client. Restart the program and try again.'
          )
        }

        const {id, manifest} = message.data
        const isMutableId = id !== manifest.id
        // TODO: cezaraugusto Also interesting:
        // • Size: 1.2 MB
        // • Static Pages: /pages
        // • Static Resources: /public
        // • Web Accessible Resources: /web_accessible_resources
        console.log(`• Name: ${manifest.name}`)
        console.log(`• Version: ${manifest.version}`)
        console.log(`• ID: ${id} (${isMutableId ? 'dynamic' : 'fixed'})`)
        console.log(`• Permissions: ${manifest.permissions.join(', ')}`)
        console.log(`• Settings URL: chrome://extensions/?id=${id}\n`)
        console.log(`[🧩] Started a new Chrome instance. Extension ready.\n`)
      }
    })
  })

  return webSocketServer
}
