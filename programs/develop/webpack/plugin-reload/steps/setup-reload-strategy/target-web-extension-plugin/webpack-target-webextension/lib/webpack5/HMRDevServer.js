// @ts-check
module.exports = class DevServerConfigPlugin {
  /** @param {import('webpack').Compiler} compiler */
  apply(compiler) {
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
        protocol: 'ws',
      },
    })
    // Overlay doesn't work well in content script.
    setDefault(devServer.client, 'overlay', false)
    // Progress is annoying in console.
    setDefault(devServer.client, 'progress', false)
    // In content script loaded in https:// pages, it will try to use wss:// because of protocol detect.
    setDefault(devServer.client, 'webSocketURL', { protocol: 'ws' })
    setDefault(devServer.client.webSocketURL, 'protocol', 'ws')

    // HMR requires CORS requests in content scripts.
    setDefault(devServer, 'allowedHosts', 'all')
    setDefault(devServer, 'headers', {
      'Access-Control-Allow-Origin': '*',
    })

    // Avoid listening to node_modules
    setDefault(devServer, 'static', { watch: { ignored: /\bnode_modules\b/ } })
    setDefault(devServer.static, 'watch', { ignored: /\bnode_modules\b/ })
    isObject(devServer.static) &&
      'watch' in devServer.static &&
      isObject(devServer.static.watch) &&
      setDefault(devServer.static.watch, 'ignored', /\bnode_modules\b/)
  }
}

/**
 * @param {{ [x: string]: any; }} obj
 * @param {string | number} key
 * @param {any} val
 */
function setDefault(obj, key, val) {
  if (isObject(obj) && obj[key] === undefined) obj[key] = val
}

/**
 * @param {any} x
 * @returns {x is object}
 */
function isObject(x) {
  return typeof x === 'object' && x !== null
}
