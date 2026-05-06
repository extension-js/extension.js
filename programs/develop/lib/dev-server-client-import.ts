import {createRequire} from 'module'
import {type Compiler} from '@rspack/core'

const cjsRequire = createRequire(import.meta.url)

function normalizeBoolean(value: unknown, fallback: boolean): string {
  return String(typeof value === 'boolean' ? value : fallback)
}

function normalizeHotValue(value: unknown): string {
  if (value === 'only') return 'only'
  if (typeof value === 'boolean') return String(value)
  return 'true'
}

// Resolve HMR client paths from extension-develop's own dependency tree so they
// don't need to exist in the user's node_modules (pnpm strict hoisting).
let _resolvedClientPath: string | undefined
let _resolvedHotPath: string | undefined

function resolveHmrClientPath(): string {
  if (!_resolvedClientPath) {
    try {
      _resolvedClientPath = cjsRequire.resolve(
        '@rspack/dev-server/client/index.js',
        {paths: [__dirname]}
      )
    } catch {
      _resolvedClientPath = '@rspack/dev-server/client/index.js'
    }
  }
  return _resolvedClientPath
}

function resolveHmrHotPath(): string {
  if (!_resolvedHotPath) {
    try {
      _resolvedHotPath = cjsRequire.resolve('webpack/hot/dev-server', {
        paths: [__dirname]
      })
    } catch {
      _resolvedHotPath = 'webpack/hot/dev-server'
    }
  }
  return _resolvedHotPath
}

export function getDevServerHmrImports(compiler: Compiler): string[] {
  const devServer = (compiler.options as any)?.devServer
  const envHost = process.env.EXTENSION_DEV_SERVER_HOST
  const envPort = process.env.EXTENSION_DEV_SERVER_PORT
  const envPath = process.env.EXTENSION_DEV_SERVER_PATH
  const envProtocol = process.env.EXTENSION_DEV_SERVER_PROTOCOL
  if (!devServer && !envHost && !envPort) return []

  const clientConfig =
    devServer?.client && typeof devServer.client === 'object'
      ? devServer.client
      : {}
  const webSocketURL =
    clientConfig.webSocketURL && typeof clientConfig.webSocketURL === 'object'
      ? clientConfig.webSocketURL
      : {}

  const protocol = String(webSocketURL.protocol || envProtocol || 'ws')
  const hostname = String(
    webSocketURL.hostname || devServer?.host || envHost || '127.0.0.1'
  )
  const port =
    webSocketURL.port ??
    devServer?.port ??
    envPort ??
    process.env.EXTENSION_PUBLIC_PORT ??
    8080
  const pathname = String(webSocketURL.pathname || envPath || '/ws')
  const logging = String(clientConfig.logging || 'none')
  const progress = normalizeBoolean(clientConfig.progress, false)
  const overlay = normalizeBoolean(clientConfig.overlay, false)
  const reconnect = String(clientConfig.reconnect ?? 10)
  const hot = normalizeHotValue(devServer?.hot ?? 'only')
  const liveReload = normalizeBoolean(devServer?.liveReload, true)

  const query = new URLSearchParams({
    protocol,
    hostname,
    port: String(port),
    pathname,
    logging,
    progress,
    overlay,
    reconnect,
    hot,
    'live-reload': liveReload
  })

  return [`${resolveHmrClientPath()}?${query.toString()}`, resolveHmrHotPath()]
}
