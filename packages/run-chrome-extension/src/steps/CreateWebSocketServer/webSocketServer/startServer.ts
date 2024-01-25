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
          const {id, manifest, management, management2} = message.data
          const isMutableId = id !== manifest.id
          const manifestPath = path.join(
            compilerOptions.context || '',
            'manifest.json'
          )
          const permissionsBefore: string[] =
            require(manifestPath).permissions || []
          const permissionsAfter: string[] = management.permissions || []

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
          // data: {
          //     id: 'illpikdfgomnapmkenldchkadgedpalf',
          //     manifest: {
          //       background: [Object],
          //       content_security_policy: [Object],
          //       description: 'Uses the chrome.contextMenus API to customize the context menu.',
          //       externally_connectable: [Object],
          //       manifest_version: 3,
          //       name: 'Context Menus Sample',
          //       permissions: [Array],
          //       version: '0.7',
          //       web_accessible_resources: [Array]
          //     },

          console.log('')
          console.log(
            `• Name: ${management.name} (${compilerOptions.mode} mode)`
          )
          console.log(`• Description: ${management.description}`)
          console.log(
            `• ID: ${management.id} (${isMutableId ? 'dynamic' : 'static'})`
          )
          console.log(`• Version: ${management.version}`)
          management.hostPermissions.length &&
            console.log(
              `• Host Permissions: ${management.hostPermissions.join(', ')}`
            )
          console.log(`• Permissions: ${permissions.sort().join(', ')}`)
          management.optionsUrl &&
            console.log(`• Options URL: ${management.optionsUrl}`)
          console.log(`• Settings URL: chrome://extensions/?id=${id}\n`)
          console.log(
            `🧩 extension-create ►►► Running a new Chrome instance. Extension ${management.enabled ? 'enabled' : 'disabled'}.`
          )

          // console.log({data: message.data})
          // console.log('')
          // console.log(`• Name: ${manifest.name} (${compilerOptions.mode} mode)`)
          // console.log(`• Version: ${manifest.version}`)
          // console.log(`• ID: ${id} (${isMutableId ? 'dynamic' : 'static'})`)
          // console.log(`• Permissions: ${permissions.sort().join(', ')}`)
          // console.log(`• Settings URL: chrome://extensions/?id=${id}\n`)
          // console.log(
          //   `[🧩] chrome-runtime ►►► Running a new Chrome instance. Extension ready.`
          // )
        }, 1000)
      }
    })
  })

  return webSocketServer
}
