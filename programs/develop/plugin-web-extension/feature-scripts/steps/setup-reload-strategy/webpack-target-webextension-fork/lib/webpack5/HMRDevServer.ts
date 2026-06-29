export default class DevServerConfigPlugin {
  apply(compiler: any) {
    if (!compiler.options.devServer) compiler.options.devServer = {}
    const devServer = compiler.options.devServer

    setDefault(devServer, 'devMiddleware', {})
    // Extensions cannot be loaded over network
    setDefault(devServer.devMiddleware, 'writeToDisk', true)

    if (devServer.hot === undefined) devServer.hot = 'only'
    if (!devServer.hot) return

    setDefault(devServer, 'host', '127.0.0.1')
    setDefault(devServer, 'client', {
      overlay: false,
      progress: false,
      webSocketURL: {
        protocol: 'ws'
      }
    })
    // Overlay doesn't work well in content script.
    setDefault(devServer.client, 'overlay', false)
    // Progress is annoying in console.
    setDefault(devServer.client, 'progress', false)
    // In content scripts loaded in https:// pages, it will try to use wss:// because of protocol detect.
    // Also: if host/port are not set, the client may fall back to the page's host/port, which can
    // collide with user apps (e.g. localhost:8080) and produce "Upgrade Required" responses.
    setDefault(devServer.client, 'webSocketURL', {protocol: 'ws'})
    setDefault(devServer.client.webSocketURL, 'protocol', 'ws')
    // The HMR client must dial a CONNECTABLE host, not the bind host. Under
    // `--host 0.0.0.0` (devcontainer/CI) `devServer.host` is a wildcard the
    // browser can't connect to, which silently breaks HMR. dev-server/index.ts
    // resolves the connectable host once (resolveConnectableHost) and exports it
    // here; prefer it, then rewrite any wildcard bind host to loopback as a
    // fallback, and only use the raw bind host when it's already connectable.
    const connectableHost = resolveClientHost(
      process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST,
      devServer.host
    )
    if (connectableHost)
      setDefault(devServer.client.webSocketURL, 'hostname', connectableHost)
    if (devServer.port)
      setDefault(devServer.client.webSocketURL, 'port', devServer.port)

    // HMR requires CORS requests in content scripts.
    setDefault(devServer, 'allowedHosts', 'all')
    setDefault(devServer, 'headers', {
      'Access-Control-Allow-Origin': '*'
    })

    // Avoid listening to node_modules
    setDefault(devServer, 'static', {watch: {ignored: /\bnode_modules\b/}})
    setDefault(devServer.static, 'watch', {ignored: /\bnode_modules\b/})
    isObject(devServer.static) &&
      'watch' in devServer.static &&
      isObject((devServer.static as any).watch) &&
      setDefault((devServer.static as any).watch, 'ignored', /\bnode_modules\b/)
  }
}

function setDefault(obj: unknown, key: string | number, val: unknown) {
  if (isObject(obj) && obj[key] === undefined) obj[key] = val
}

// Mirrors dev-server/connectable-host.resolveConnectableHost, kept inline so
// this vendored fork has no cross-module import. A wildcard bind host is not a
// connectable client target, so it is rewritten to loopback.
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]', '::0', '*', ''])
function resolveClientHost(
  connectable: string | undefined,
  bindHost: unknown
): string | undefined {
  const resolved = String(connectable ?? '').trim()
  if (resolved) return resolved
  const bind = typeof bindHost === 'string' ? bindHost.trim() : ''
  if (!bind) return undefined
  return WILDCARD_HOSTS.has(bind) ? '127.0.0.1' : bind
}

function isObject(x: unknown): x is Record<string | number, any> {
  return typeof x === 'object' && x !== null
}
