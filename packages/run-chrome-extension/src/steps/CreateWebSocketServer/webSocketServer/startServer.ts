import path from 'path'
import WebSocket from 'ws'
import {WebpackError, type Compiler} from 'webpack'
const {log} = console

function extensionCreateServerOutput(
  compiler: Compiler,
  message: {
    data?: {
      id: string
      manifest: Record<string, any>
      management: Record<string, any>
    }
  }
) {
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
      console.log('[⛔️] No management info received from client. Investigate.')
    }
  }
  const {
    name,
    description,
    version,
    hostPermissions,
    permissions
  } = manifest

  const manifestPath = path.join(compilerOptions.context || '', 'manifest.json')
  const manifestFromCompiler = require(manifestPath)
  const permissionsBefore: string[] = manifestFromCompiler.permissions || []
  const permissionsAfter: string[] = permissions || []
  // If a permission is used in the post compilation but not
  // in the pre-compilation step, add a "dev only" string to it.
  const permissionsParsed: string[] = permissionsAfter.map((permission) => {
    if (permissionsBefore.includes(permission)) return permission
    return `${permission} (dev only)`
  })
  const fixedId = manifestFromCompiler.id === id
  const hasHost = hostPermissions && hostPermissions.length

  // TODO: cezaraugusto Also interesting:
  // log(`• Size: 1.2 MB`)
  // log(`• Static Pages: /pages`)
  // log(`• Static Resources: /public`)
  // log(`• Web Accessible Resources: /web_accessible_resources`)

  log('')
  log(`• Name: ${name} (${compilerOptions.mode} mode)`)
  description && log(`• Description: ${description}`)
  log(`• ID: ${id} (${fixedId ? 'fixed' : 'dynamic'})`)
  log(`• Version: ${version}`)
  hasHost && log(`• Host Permissions: ${hostPermissions.sort().join(', ')}`)
  log(`• Permissions: ${permissionsParsed.sort().join(', ')}`)
  log(`• Settings URL: chrome://extensions/?id=${id}\n`)
  log(`►►► Running a new Chrome instance. Extension ready.`)
}

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
          extensionCreateServerOutput(compiler, message)
        }, 1000)
      }
    })
  })

  return webSocketServer
}
