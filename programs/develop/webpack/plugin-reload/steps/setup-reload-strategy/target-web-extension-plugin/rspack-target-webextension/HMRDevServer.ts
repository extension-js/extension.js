import {Compiler} from '@rspack/core'

// @ts-check
export class HMRDevServerPlugin {
  apply(compiler: Compiler) {
    const options = compiler.options
    if (!options.devServer) options.devServer = {}
    const devServer = options.devServer

    setDefault(devServer, 'devMiddleware', {})
    // Extensions cannot be loaded over network
    setDefault(devServer.devMiddleware!, 'writeToDisk', true)

    if (!devServer.hot) return

    setDefault(devServer, 'host', '127.0.0.1')
    setDefault(devServer, 'client', {
      overlay: false,
      progress: false,
      webSocketURL: {
        protocol: 'ws'
      }
    })

    const devServerClient = devServer.client! as Record<string, any>
    // Overlay doesn't work well in content script.
    setDefault(devServerClient, 'overlay', false)
    // Progress is annoying in console.
    setDefault(devServerClient, 'progress', false)
    // In content script loaded in https:// pages, it will try to use wss:// because of protocol detection.
    setDefault(devServer!, 'webSocketServer', 'ws')

    // HMR requires CORS requests in content scripts.
    setDefault(devServer, 'allowedHosts', 'all')
    setDefault(devServer, 'headers', {
      'Access-Control-Allow-Origin': '*'
    })

    // Avoid listening to node_modules
    setDefault(devServer, 'static', {watch: {ignored: /\bnode_modules\b/}})
    if (isObject(devServer.static)) {
      setDefault(devServer.static, 'watch', {ignored: /\bnode_modules\b/})
    }
  }
}

function setDefault(obj: Record<string, any>, key: string | number, val: any) {
  if (isObject(obj) && obj[key] === undefined) obj[key] = val
}

function isObject(x: any): x is Record<string, any> {
  return typeof x === 'object' && x !== null
}
