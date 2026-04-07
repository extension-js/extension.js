import {type Compiler} from '@rspack/core'

function normalizeBoolean(value: unknown, fallback: boolean): string {
  return String(typeof value === 'boolean' ? value : fallback)
}

function normalizeHotValue(value: unknown): string {
  if (value === 'only') return 'only'
  if (typeof value === 'boolean') return String(value)
  return 'true'
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

  return [
    `@rspack/dev-server/client/index.js?${query.toString()}`,
    'webpack/hot/dev-server'
  ]
}
