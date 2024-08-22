import path from 'path'
import fs from 'fs'
import WebSocket from 'ws'
import {Compiler} from 'webpack'
import * as messages from '../../../../lib/messages'
import {type Manifest} from '../../../../webpack-types'
import {getHardcodedMessage, isFirstRun} from '../../../../lib/utils'
import {DevOptions} from '../../../../../module'
import {CERTIFICATE_DESTINATION_PATH} from '../../../../lib/constants'
import {httpsServer} from './https-server'

interface Data {
  id: string
  manifest: Manifest
  management: chrome.management.ExtensionInfo
}

interface Message {
  data?: Data | undefined
  status: string
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = require('net').createServer()

    server.once('error', function (err: NodeJS.ErrnoException) {
      if (err.code === 'EADDRINUSE') {
        resolve(true)
      } else {
        resolve(false)
      }
    })

    server.once('listening', function () {
      server.close()
      resolve(false)
    })

    server.listen(port)
  })
}

let webSocketServer: WebSocket.Server | null = null

export async function startServer(compiler: Compiler, options: DevOptions) {
  const projectPath = compiler.options.context || ''
  const manifest = require(path.join(projectPath, 'manifest.json'))
  const manifestName = manifest.name || 'Extension.js'

  const port = options.port || 8000
  const portInUse = await isPortInUse(port)

  if (!webSocketServer && !portInUse) {
    const {server} = httpsServer(manifestName, port)
    webSocketServer = new WebSocket.Server({server})

    console.log(`WebSocket server started on port ${port}`)

    webSocketServer.on('connection', (ws) => {
      ws.send(JSON.stringify({status: 'serverReady'}))

      ws.on('error', (error) => {
        console.log(messages.webSocketError(manifestName, error))
      })

      ws.on('message', (msg) => {
        const message: Message = JSON.parse(msg.toString())

        if (message.status === 'clientReady') {
          const manifest: Manifest = require(
            path.join(projectPath, 'manifest.json')
          )

          console.log(messages.runningInDevelopment(manifest, message))
          console.log('')

          if (isFirstRun(options.browser)) {
            setTimeout(() => {
              console.log(messages.isFirstRun(options.browser))
            }, 5000)
          }
        }
      })
    })
  } else if (webSocketServer) {
    console.log(`Reusing existing WebSocket server on port ${port}`)
  } else {
    console.error(
      `Port ${port} is already in use but WebSocket server is not initialized.`
    )
    return
  }

  // Additional logic specific to Firefox, such as certificate checks
  if (options.browser === 'firefox' && !portInUse) {
    if (!fs.existsSync(CERTIFICATE_DESTINATION_PATH)) {
      const hardcodedMessage = getHardcodedMessage(manifest)
      console.log(messages.runningInDevelopment(manifest, hardcodedMessage))
      console.log('')

      if (isFirstRun('firefox')) {
        console.log(messages.certRequired())
        console.log('')
      }
    }
  }

  return webSocketServer
}
