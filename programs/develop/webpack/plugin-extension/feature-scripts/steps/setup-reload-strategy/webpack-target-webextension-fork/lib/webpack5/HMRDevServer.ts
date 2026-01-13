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
    // In content script loaded in https:// pages, it will try to use wss:// because of protocol detect.
    setDefault(devServer.client, 'webSocketURL', {protocol: 'ws'})
    setDefault(devServer.client.webSocketURL, 'protocol', 'ws')

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

function setDefault(obj: any, key: string | number, val: any) {
  if (isObject(obj) && obj[key] === undefined) obj[key] = val
}

function isObject(x: any): x is object {
  return typeof x === 'object' && x !== null
}
