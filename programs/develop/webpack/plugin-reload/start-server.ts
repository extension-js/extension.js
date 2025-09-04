import * as path from 'path'
import * as fs from 'fs'
import {WebSocketServer, WebSocket} from 'ws'
import {Compiler} from '@rspack/core'
import * as messages from './reload-lib/messages'
import {type Manifest} from '../../webpack/webpack-types'
import {
  isFirstRun,
  shouldShowFirstRun,
  markFirstRunMessageShown
} from '../webpack-lib/utils'
import {DevOptions} from '../../module'
import {CERTIFICATE_DESTINATION_PATH} from '../webpack-lib/constants'
import {httpsServer} from './steps/create-web-socket-server/web-socket-server/servers'
import {InstanceManager} from '../plugin-browsers/browsers-lib/instance-manager'

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
  switch (browser) {
    case 'chrome':
    case 'chromium-based':
    case 'edge':
      return {
        server: new WebSocketServer({
          host: '127.0.0.1',
          port,
          perMessageDeflate: false
        }),
        port
      }

    case 'firefox':
    case 'gecko-based':
      return {
        server: new WebSocketServer({
          server: httpsServer(port).server,
          perMessageDeflate: false
        }),
        port
      }

    default:
      return {
        server: new WebSocketServer({
          host: '127.0.0.1',
          port,
          perMessageDeflate: false
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
  // Heartbeat to clean up dead connections and avoid hung sockets consuming resources
  function heartbeat(this: WebSocket) {
    ;(this as any).isAlive = true
  }

  const healthInterval = setInterval(() => {
    try {
      ;(webSocketServer.clients || new Set()).forEach((ws: any) => {
        if (ws.isAlive === false) {
          try {
            ws.terminate()
          } catch {}
          return
        }
        ws.isAlive = false
        try {
          ws.ping()
        } catch {}
      })
    } catch {}
  }, 30000)

  webSocketServer.on('connection', (ws) => {
    // Add to active connections
    connections.add(ws)
    ;(ws as any).isAlive = true
    ws.on('pong', heartbeat)

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
      try {
        if (process.env.EXTENSION_ENV === 'development') {
          // Lightweight visibility for WS traffic in dev
          console.log(
            `[Extension.js] WS message status: ${message.status || 'unknown'}`
          )
        }
      } catch {}

      // Only process messages for this instance
      if (message.instanceId && message.instanceId !== instanceId) {
        console.log(
          messages.ignoringMessageFromWrongInstance(
            message.instanceId,
            instanceId
          )
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
                messages.failedToUpdateInstanceWithExtensionId(String(error))
              )
            })
        }

        console.log(messages.emptyLine())
        console.log(
          messages.runningInDevelopment(manifest, options.browser, message)
        )

        const projectPath = compiler.options.context || process.cwd()
        const outPath = compiler.options.output.path!

        if (shouldShowFirstRun(outPath, options.browser, projectPath)) {
          console.log(messages.emptyLine())
          console.log(messages.isFirstRun(options.browser))
          markFirstRunMessageShown(projectPath, options.browser)
        }

        console.log(messages.emptyLine())
      }

      // Centralized logs forwarded from manager extension → print to terminal
      if (message.status === 'log' && message.data) {
        try {
          const evt: any = message.data

          // level filter
          const levelOrder: Record<string, number> = {
            trace: 10,
            debug: 20,
            info: 30,
            warn: 40,
            error: 50
          }
          const rawLevel = (options as any).logLevel || 'info'
          const minLevel = typeof rawLevel === 'string' ? rawLevel : 'info'
          if (
            evt?.level &&
            levelOrder[evt.level] != null &&
            levelOrder[minLevel] != null &&
            levelOrder[evt.level] < levelOrder[minLevel]
          ) {
            return
          }

          // context filter
          const allowedContexts = (options as any).logContexts as
            | string[]
            | undefined
          if (
            Array.isArray(allowedContexts) &&
            allowedContexts.length &&
            evt?.context &&
            !allowedContexts.includes(evt.context)
          ) {
            return
          }

          // url filter
          const urlFilter = (options as any).logUrl as string | undefined
          if (urlFilter && evt?.url) {
            let match = false
            try {
              if (
                typeof urlFilter === 'string' &&
                urlFilter.startsWith('/') &&
                urlFilter.endsWith('/')
              ) {
                const body = urlFilter.slice(1, -1)
                match = new RegExp(body).test(String(evt.url))
              } else {
                match = String(evt.url).includes(urlFilter)
              }
            } catch {
              match = String(evt.url).includes(String(urlFilter))
            }
            if (!match) return
          }

          // tab filter
          const tabFilter = (options as any).logTab as number | undefined
          if (
            typeof tabFilter === 'number' &&
            evt?.tabId != null &&
            Number(evt.tabId) !== Number(tabFilter)
          ) {
            return
          }

          const format = (options as any).logFormat || 'pretty'
          const showTs = (options as any).logTimestamps !== false
          // const useColor = (options as any).logColor !== false // reserved

          if (format === 'json') {
            console.log(JSON.stringify(evt))
            return
          }

          const ts = showTs
            ? new Date(Number(evt.timestamp) || Date.now()).toISOString() + ' '
            : ''
          const lvl = String(evt.level || 'info')
            .toUpperCase()
            .padEnd(5)
          const ctx = String(evt.context || 'unknown')
          const tab = evt.tabId != null ? `#${evt.tabId}` : ''
          const url = evt.url ? ` ${evt.url}` : ''
          const head = `${ts}[${lvl}] ${ctx}${tab}${url}`
          const msg = Array.isArray(evt.messageParts)
            ? evt.messageParts
                .map((a: any) => {
                  try {
                    return typeof a === 'string' ? a : JSON.stringify(a)
                  } catch {
                    return String(a)
                  }
                })
                .join(' ')
            : String(evt.message || '')

          console.log(`${head} - ${msg}`)
        } catch {}
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
    try {
      clearInterval(healthInterval)
    } catch {}
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
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(
          messages.webSocketServerForInstanceClosed(instanceId.slice(0, 8))
        )
      }
    })
  }

  // Handle process termination signals
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('SIGHUP', cleanup)

  return webSocketServer
}
