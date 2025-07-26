import * as path from 'path'
import * as fs from 'fs'
import {WebSocketServer, WebSocket} from 'ws'
import {Compiler} from '@rspack/core'
import * as messages from '../../../../lib/messages'
import {type Manifest} from '../../../../webpack-types'
import {getHardcodedMessage, isFirstRun} from '../../../../lib/utils'
import {DevOptions} from '../../../../../module'
import {CERTIFICATE_DESTINATION_PATH} from '../../../../lib/constants'
import {httpsServer} from './servers'

interface Data {
  id: string
  manifest: Manifest
  management: chrome.management.ExtensionInfo
}

interface Message {
  data?: Data | undefined
  status: string
}

function setupServer(port: number, browser: DevOptions['browser']) {
  // All browsers use the same port for consistency
  switch (browser) {
    case 'chrome':
    case 'chromium-based':
    case 'edge':
      return {
        server: new WebSocketServer({
          host: 'localhost',
          port
        }),
        port
      }

    case 'firefox':
    case 'gecko-based':
      return {
        server: new WebSocketServer({
          server: httpsServer(port).server
        }),
        port
      }

    default:
      return {
        server: new WebSocketServer({
          host: 'localhost',
          port
        }),
        port
      }
  }
}

export async function startServer(compiler: Compiler, options: DevOptions) {
  const projectPath = compiler.options.context || ''
  const manifest = JSON.parse(
    fs.readFileSync(path.join(projectPath, 'manifest.json'), 'utf-8')
  )

  const {server: webSocketServer} = setupServer(options.port!, options.browser)

  // Track all active connections
  const connections = new Set<WebSocket>()

  webSocketServer.on('connection', (ws) => {
    // Add to active connections
    connections.add(ws)

    ws.send(JSON.stringify({status: 'serverReady'}))

    ws.on('error', (error) => {
      console.log(messages.webSocketError(error))
      connections.delete(ws)
    })

    ws.on('close', () => {
      connections.delete(ws)
    })

    ws.on('message', (msg) => {
      const message: Message = JSON.parse(msg.toString())

      if (message.status === 'clientReady') {
        const manifest: Manifest = JSON.parse(
          fs.readFileSync(path.join(projectPath, 'manifest.json'), 'utf-8')
        )

        setTimeout(() => {
          console.log(
            messages.runningInDevelopment(manifest, options.browser, message)
          )
          console.log('')
        }, 2500)

        if (isFirstRun(compiler.options.output.path!, options.browser)) {
          setTimeout(() => {
            console.log(messages.isFirstRun(options.browser))
          }, 5000)
        }
      }
    })
  })

  // Additional logic specific to Firefox, such as certificate checks
  if (options.browser === 'firefox' || options.browser === 'gecko-based') {
    const hardcodedMessage = getHardcodedMessage(manifest)
    console.log(
      messages.runningInDevelopment(manifest, options.browser, hardcodedMessage)
    )
    console.log('')

    if (!fs.existsSync(CERTIFICATE_DESTINATION_PATH)) {
      console.log(messages.certRequired())
      console.log('')
    }
  }

  // Handle graceful shutdown
  const cleanup = () => {
    // Close all active connections
    for (const ws of connections) {
      try {
        ws.close(1000, 'Server shutting down')
      } catch (error) {
        console.error('Error closing WebSocket connection:', error)
      }
    }

    // Close the server
    webSocketServer.close(() => {
      process.exit(0)
    })
  }

  // Handle process termination signals
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('SIGHUP', cleanup)

  return webSocketServer
}
