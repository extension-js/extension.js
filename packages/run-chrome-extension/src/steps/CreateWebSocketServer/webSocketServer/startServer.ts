import {WebpackError, type Compiler} from 'webpack'
import WebSocket from 'ws'

export default function (compiler: Compiler, port?: number) {
  const webSocketServer = new WebSocket.Server({
    host: 'localhost',
    port
  })

  webSocketServer.on('connection', (ws) => {
    ws.send(JSON.stringify({status: 'serverReady'}))

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
        setTimeout(() => {
          if (!message.data) {
            // TODO: cezaraugusto this happens when the extension
            // can't reach the background script. This can be many
            // things such as a mismatch config or if after an error
            // the extension starts disabled. Improve this error.
            throw new WebpackError(
              '[⛔️] No data received from client. Restart the program and try again.'
            )
          }

          const compilerOptions = compiler.options
          const {id, manifest} = message.data
          const isMutableId = id !== manifest.id
          // TODO: cezaraugusto Also interesting:
          // • Size: 1.2 MB
          // • Static Pages: /pages
          // • Static Resources: /public
          // • Web Accessible Resources: /web_accessible_resources
          console.log('')
          console.log(`• Name: ${manifest.name} (${compilerOptions.mode} mode)`)
          console.log(`• Version: ${manifest.version}`)
          console.log(`• ID: ${id} (${isMutableId ? 'dynamic' : 'fixed'})`)
          console.log(`• Permissions: ${manifest.permissions.join(', ')}`)
          console.log(`• Settings URL: chrome://extensions/?id=${id}\n`)
          console.log(
            `[🧩] chrome-runtime ►►► Running a new Chrome instance. Extension ready.`
          )
        }, 1000)
      }
    })
  })

  return webSocketServer
}
