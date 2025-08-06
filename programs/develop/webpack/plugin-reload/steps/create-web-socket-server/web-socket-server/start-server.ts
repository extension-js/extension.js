import * as path from 'path'
import * as fs from 'fs'
import {WebSocketServer, WebSocket} from 'ws'
import {Compiler} from '@rspack/core'
import * as messages from '../../../../lib/messages'
import {type Manifest} from '../../../../webpack-types'
import {isFirstRun} from '../../../../lib/utils'
import {DevOptions} from '../../../../../module'
import {CERTIFICATE_DESTINATION_PATH} from '../../../../lib/constants'
import {httpsServer} from './servers'
import {InstanceManager} from '../../../../../lib/instance-manager'

interface Data {
  id: string
  manifest: Manifest
  management: chrome.management.ExtensionInfo
}

interface Message {
  data?: Data | undefined
  status: string
  instanceId?: string
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
  // In monorepo setups, context is packageJsonDir, but manifest is in manifestDir
  // We need to find the manifest.json by walking up from the output path
  const outputPath = compiler.options.output?.path as string
  // The output path is something like /tmp/monorepo-test/apps/extension-a/dist/chrome
  // We need to go up 2 levels to get to the manifest directory
  const manifestDir = path.dirname(path.dirname(outputPath))
  const manifestPath = path.join(manifestDir, 'manifest.json')

  // Get the current instance from the compiler options
  const currentInstance = (compiler.options as any).currentInstance
  const instanceId = currentInstance?.instanceId

  if (!instanceId) {
    throw new Error('No instance ID found in compiler options')
  }

  // Initialize instance manager
  const projectPath = compiler.options.context || process.cwd()
  const instanceManager = new InstanceManager(projectPath)
  const instance = await instanceManager.getInstance(instanceId)

  if (!instance) {
    throw new Error(`Instance ${instanceId} not found`)
  }

  // Use the instance-specific WebSocket port
  const {server: webSocketServer} = setupServer(
    instance.webSocketPort,
    options.browser
  )

  // Track all active connections for this instance
  const connections = new Set<WebSocket>()

  webSocketServer.on('connection', (ws) => {
    // Add to active connections
    connections.add(ws)

    // Send instance-specific server ready message
    ws.send(
      JSON.stringify({
        status: 'serverReady',
        instanceId: instanceId
      })
    )

    ws.on('error', (error) => {
      console.log(messages.webSocketError(error))
      connections.delete(ws)
    })

    ws.on('close', () => {
      connections.delete(ws)
    })

    ws.on('message', (msg) => {
      const message: Message = JSON.parse(msg.toString())

      // Only process messages for this instance
      if (message.instanceId && message.instanceId !== instanceId) {
        console.log(
          `Ignoring message from wrong instance: ${message.instanceId} (expected: ${instanceId})`
        )
        return
      }

      if (message.status === 'clientReady') {
        const manifest: Manifest = JSON.parse(
          fs.readFileSync(manifestPath, 'utf-8')
        )

        // Update the instance with the extension ID
        if (message.data?.id) {
          instanceManager
            .updateInstance(instanceId, {
              extensionId: message.data.id
            })
            .catch((error) => {
              console.warn(
                `Failed to update instance with extension ID: ${error}`
              )
            })
        }

        setTimeout(() => {
          console.log(
            messages.runningInDevelopment(manifest, options.browser, message)
          )
          console.log(messages.emptyLine())
        }, 500)

        if (isFirstRun(compiler.options.output.path!, options.browser)) {
          setTimeout(() => {
            console.log(messages.isFirstRun(options.browser))
          }, 1000)
        }
      }
    })
  })

  // Additional logic specific to Firefox, such as certificate checks
  if (options.browser === 'firefox' || options.browser === 'gecko-based') {
    if (!fs.existsSync(CERTIFICATE_DESTINATION_PATH)) {
      console.log(messages.certRequired())
      console.log(messages.emptyLine())
    }
  }

  // Handle graceful shutdown
  const cleanup = () => {
    // Close all active connections for this instance
    for (const ws of connections) {
      try {
        ws.close(1000, 'Server shutting down')
      } catch (error) {
        console.error(messages.webSocketConnectionCloseError(error))
      }
    }

    // Close the server
    webSocketServer.close(() => {
      console.log(
        `WebSocket server for instance ${instanceId.slice(0, 8)} closed`
      )
    })
  }

  // Handle process termination signals
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('SIGHUP', cleanup)

  return webSocketServer
}
