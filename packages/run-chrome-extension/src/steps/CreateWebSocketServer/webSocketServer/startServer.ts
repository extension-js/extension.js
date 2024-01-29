import path from 'path'
import WebSocket from 'ws'
import {WebpackError, type Compiler} from 'webpack'

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
          const {id, manifest, management} = message.data

          if (!management) {
            if (process.env.EXTENSION_ENV === 'development') {
              console.log(
                '[⛔️] No management info received from client. Investigate.'
              )
            }
          }

          const manifestPath = path.join(
            compilerOptions.context || '',
            'manifest.json'
          )
          const manifestFromCompiler = require(manifestPath)
          const permissionsBefore: string[] =
            manifestFromCompiler.permissions || []
          const permissionsAfter: string[] = manifest.permissions || []
          const isMutableId = manifestFromCompiler.id !== manifest.id

          // If a permission is used in the post compilation but not
          // in the pre-compilation step, add a "dev only" string to it.
          const permissions: string[] = permissionsAfter.map((permission) => {
            if (permissionsBefore.includes(permission)) return permission
            return `${permission} (dev only)`
          })

          // TODO: cezaraugusto Also interesting:
          // • Size: 1.2 MB
          // • Static Pages: /pages
          // • Static Resources: /public
          // • Web Accessible Resources: /web_accessible_resources
          console.log('')
          console.log(`• Name: ${manifest.name} (${compilerOptions.mode} mode)`)
          console.log(`• Description: ${manifest.description}`)
          console.log(
            `• ID: ${manifest.id} (${isMutableId ? 'dynamic' : 'static'})`
          )
          console.log(`• Version: ${manifest.version}`)
          manifest.hostPermissions &&
            manifest.hostPermissions.length &&
            console.log(
              `• Host Permissions: ${manifest.hostPermissions.join(', ')}`
            )
          console.log(`• Permissions: ${permissions.sort().join(', ')}`)
          console.log(`• Settings URL: chrome://extensions/?id=${id}\n`)
          console.log(
            `🧩 extension-create ►►► Running a new Chrome instance. Extension ready.`
          )
        }, 1000)
      }
    })
  })

  return webSocketServer
}
