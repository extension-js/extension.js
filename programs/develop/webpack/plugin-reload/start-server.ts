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
import colors from 'pintor'

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

  // Track all active connections and start health checks
  const connections = new Set<WebSocket>()
  const heartbeat = createHeartbeat()
  const healthInterval = startHealthChecks(webSocketServer)

  webSocketServer.on('connection', (ws) => {
    connections.add(ws)
    ;(ws as any).isAlive = true
    ws.on('pong', heartbeat)

    sendServerReady(ws, instanceId)

    // Dev-only watchdog: if clientReady doesn't arrive, provide diagnostics
    let sawManagerHello = false
    let wrongInstanceCount = 0
    const watchdogMs = Number(
      process.env.EXTENSION_CLIENT_READY_TIMEOUT_MS || 15000
    )
    const watchdog = setTimeout(() => {
      try {
        if (process.env.EXTENSION_ENV === 'development') {
          const manifestName = (() => {
            try {
              const raw = fs.readFileSync(manifestPath, 'utf-8')
              return (JSON.parse(raw) as any)?.name || 'Extension.js'
            } catch {
              return 'Extension.js'
            }
          })()
          console.log(
            (messages as any).clientReadyTimeoutSummary?.({
              manifestName,
              browser: options.browser,
              expectedInstanceId: instanceId,
              webSocketPort: instance.webSocketPort,
              sawManagerHello,
              wrongInstanceCount
            })
          )
        }
      } catch {}
    }, watchdogMs)

    ws.on('error', (error) => {
      console.log(messages.webSocketError(error))
      connections.delete(ws)
      try {
        clearTimeout(watchdog)
      } catch {}
    })

    ws.on('close', () => {
      connections.delete(ws)
      try {
        clearTimeout(watchdog)
      } catch {}
    })

    ws.on('message', (msg) => {
      const message: Message = JSON.parse(msg.toString())
      logWsStatus(message)

      if (message.instanceId && message.instanceId !== instanceId) {
        wrongInstanceCount++
        console.log(
          messages.ignoringMessageFromWrongInstance(
            message.instanceId,
            instanceId
          )
        )
        try {
          // Actively drop noisy connections from wrong instances
          ;(ws as any)?.close?.(1008, 'Wrong instance')
        } catch {}
        return
      }

      if (message.status === 'log' && (message as any).data) {
        try {
          const data: any = (message as any).data
          if (
            String(data?.context).toLowerCase() === 'manager' &&
            Array.isArray(data?.messageParts) &&
            data.messageParts.some((p: any) =>
              String(p).includes('manager connected')
            )
          ) {
            sawManagerHello = true
          }
        } catch {}
      }

      if (message.status === 'clientReady') {
        try {
          clearTimeout(watchdog)
        } catch {}
        handleClientReady({
          compiler,
          options,
          instanceManager,
          instanceId,
          manifestPath,
          message
        })
      }

      if (message.status === 'log' && message.data) {
        handleForwardedLog({message, options})
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
  const cleanup = () =>
    gracefulShutdown({
      healthInterval,
      connections,
      webSocketServer,
      instanceId
    })

  // Handle process termination signals
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('SIGHUP', cleanup)

  return webSocketServer
}

function createHeartbeat() {
  return function heartbeat(this: WebSocket) {
    ;(this as any).isAlive = true
  }
}

function startHealthChecks(webSocketServer: WebSocketServer) {
  return setInterval(() => {
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
}

function sendServerReady(ws: WebSocket, instanceId: string) {
  ws.send(
    JSON.stringify({
      status: 'serverReady',
      instanceId
    })
  )
}

function logWsStatus(message: Message) {
  try {
    if (process.env.EXTENSION_ENV === 'development') {
      console.log(
        `[Extension.js] WS message status: ${message.status || 'unknown'}`
      )
    }
  } catch {}
}

function handleClientReady(args: {
  compiler: Compiler
  options: DevOptions
  instanceManager: InstanceManager
  instanceId: string
  manifestPath: string
  message: Message
}) {
  const {
    compiler,
    options,
    instanceManager,
    instanceId,
    manifestPath,
    message
  } = args
  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

  if (message.data?.id) {
    instanceManager
      .updateInstance(instanceId, {extensionId: message.data.id})
      .catch((error) => {
        console.warn(
          messages.failedToUpdateInstanceWithExtensionId(String(error))
        )
      })
  }

  console.log(messages.emptyLine())
  console.log(messages.runningInDevelopment(manifest, options.browser, message))

  const projectPath = compiler.options.context || process.cwd()
  const outPath = compiler.options.output.path!
  if (shouldShowFirstRun(outPath, options.browser, projectPath)) {
    console.log(messages.emptyLine())
    console.log(messages.isFirstRun(options.browser))
    markFirstRunMessageShown(projectPath, options.browser)
  }
  console.log(messages.emptyLine())
}

function handleForwardedLog(args: {message: Message; options: DevOptions}) {
  try {
    const {message, options} = args
    const evt: any = (message as any).data

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

    const allowedContexts = (options as any).logContexts as string[] | undefined
    if (
      Array.isArray(allowedContexts) &&
      allowedContexts.length &&
      evt?.context &&
      !allowedContexts.includes(evt.context)
    ) {
      return
    }

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
    const useColor = (options as any).logColor !== false

    if (format === 'json') {
      console.log(JSON.stringify(evt))
      return
    }

    const levelRaw = String(evt.level || 'info').toLowerCase()
    const arrow = (() => {
      if (!useColor) return '►►►'
      switch (levelRaw) {
        case 'error':
          return colors.red('►►►')
        case 'warn':
          return colors.brightYellow('►►►')
        case 'debug':
          return (colors as any).magenta
            ? (colors as any).magenta('►►►')
            : colors.gray('►►►')
        case 'trace':
          return (colors as any).white ? (colors as any).white('►►►') : '►►►'
        case 'log':
          return colors.gray('►►►')
        case 'info':
        default:
          return colors.blue('►►►')
      }
    })()

    const rawTs =
      new Date(Number(evt.timestamp) || Date.now()).toISOString() + ' '
    const ts = showTs ? (useColor ? colors.gray(rawTs) : rawTs) : ''
    const lvlBase = String(evt.level || 'info').toUpperCase()
    const lvl = (() => {
      if (!useColor) return lvlBase
      switch (levelRaw) {
        case 'error':
          return colors.red(lvlBase)
        case 'warn':
          return colors.brightYellow(lvlBase)
        case 'debug':
          return (colors as any).magenta
            ? (colors as any).magenta(lvlBase)
            : colors.gray(lvlBase)
        case 'trace':
          return (colors as any).white
            ? (colors as any).white(lvlBase)
            : lvlBase
        case 'log':
          return colors.gray(lvlBase)
        case 'info':
        default:
          return colors.blue(lvlBase)
      }
    })()
    const ctx = String(evt.context || 'unknown')
    const tab = evt.tabId != null ? `#${evt.tabId}` : ''
    const url = evt.url ? ` ${evt.url}` : ''
    // Refine context/tab display: omit tab for background/manager contexts
    const isBgOrManager =
      String(evt.context).toLowerCase() === 'background' ||
      String(evt.context).toLowerCase() === 'manager'
    const tabForHead =
      !isBgOrManager && evt?.tabId != null ? `#${evt.tabId}` : ''

    // Incognito indicator
    const incog = evt && evt.incognito ? ' (incognito)' : ''

    const coloredCtx = (() => {
      if (!useColor) return ctx
      switch (String(evt.context || '').toLowerCase()) {
        case 'background':
          return colors.green(ctx)
        case 'manager':
          return colors.blue(ctx)
        case 'content':
          return (colors as any).magenta
            ? (colors as any).magenta(ctx)
            : colors.blue(ctx)
        case 'page':
          return colors.brightYellow
            ? colors.brightYellow(ctx)
            : colors.yellow
              ? (colors as any).yellow(ctx)
              : ctx
        case 'sidebar':
          return (colors as any).cyan
            ? (colors as any).cyan(ctx)
            : colors.brightBlue(ctx)
        case 'popup':
          return (colors as any).brightGreen
            ? (colors as any).brightGreen(ctx)
            : colors.green(ctx)
        case 'options':
          return (colors as any).cyan
            ? (colors as any).cyan(ctx)
            : colors.blue(ctx)
        case 'devtools':
          return colors.brightYellow
            ? colors.brightYellow(ctx)
            : colors.yellow
              ? (colors as any).yellow(ctx)
              : ctx
        default:
          return colors.gray(ctx)
      }
    })()

    const head = useColor
      ? `${arrow} ${ts}${coloredCtx}${tabForHead}${url}${incog}`
      : `${ts}[${lvl}] ${ctx}${tabForHead}${url}${incog}`

    // Clean up message parts: replace null/undefined with (unknown), drop empty strings
    let msg = ''
    if (Array.isArray(evt.messageParts)) {
      const cleanParts = (evt.messageParts as any[])
        .map((a: any) => {
          try {
            if (a == null) return '(unknown)'
            if (typeof a === 'string') return a.trim()
            return JSON.stringify(a)
          } catch {
            return String(a)
          }
        })
        .filter((s: any) => typeof s === 'string' && s.length > 0)
      msg = cleanParts.length ? cleanParts.join(' ') : '(none)'
    } else {
      msg = String(evt.message || '(none)')
    }

    console.log(`${head} - ${msg}`)
  } catch {}
}

function gracefulShutdown(args: {
  healthInterval: NodeJS.Timeout
  connections: Set<WebSocket>
  webSocketServer: WebSocketServer
  instanceId: string
}) {
  const {healthInterval, connections, webSocketServer, instanceId} = args
  try {
    clearInterval(healthInterval)
  } catch {}
  for (const ws of connections) {
    try {
      ws.close(1000, 'Server shutting down')
    } catch (error) {
      console.error(messages.webSocketConnectionCloseError(error))
    }
  }
  webSocketServer.close(() => {
    if (process.env.EXTENSION_ENV === 'development') {
      console.log(
        messages.webSocketServerForInstanceClosed(instanceId.slice(0, 8))
      )
    }
  })
}
