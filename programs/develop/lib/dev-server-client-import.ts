// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createRequire} from 'node:module'
import type {Compiler} from '@rspack/core'
import {resolveConnectableHost} from '../dev-server/connectable-host'

const cjsRequire = createRequire(import.meta.url)

function normalizeBoolean(value: unknown, fallback: boolean): string {
  return String(typeof value === 'boolean' ? value : fallback)
}

function normalizeHotValue(value: unknown): string {
  if (value === 'only') return 'only'
  if (typeof value === 'boolean') return String(value)
  return 'true'
}

// The HMR client + runtime specifiers that get prepended to user entry chains.
//
// INVARIANT (locked by dev-server-client-import.spec.ts): the package root of
// each specifier MUST be a declared dependency of extension-develop. We resolve
// them from THIS package's own context (`paths: [__dirname]`) to an absolute
// path, so the injected entry never depends on the user's node_modules layout
// or on any package manager's hoisting. A specifier for a package we do not
// declare only resolves by hoisting accident (npm's flat tree, pnpm's public
// virtual store) and breaks under strict linkers, Yarn PnP rejected the old
// `webpack/hot/dev-server` because extension-develop never declared `webpack`
// (issue #486). `@rspack/core` ships the equivalent `hot/dev-server.js` via its
// `./hot/*` exports map and IS a direct dependency, so it resolves everywhere.
export const HMR_CLIENT_SPECIFIER = '@rspack/dev-server/client/index.js'
export const HMR_HOT_SPECIFIER = '@rspack/core/hot/dev-server'

// Resolve HMR client paths from extension-develop's own dependency tree so they
// don't need to exist in the user's node_modules (pnpm strict hoisting).
let _resolvedClientPath: string | undefined
let _resolvedHotPath: string | undefined

function resolveHmrClientPath(): string {
  if (!_resolvedClientPath) {
    try {
      _resolvedClientPath = cjsRequire.resolve(HMR_CLIENT_SPECIFIER, {
        paths: [__dirname]
      })
    } catch {
      _resolvedClientPath = HMR_CLIENT_SPECIFIER
    }
  }
  return _resolvedClientPath
}

function resolveHmrHotPath(): string {
  if (!_resolvedHotPath) {
    try {
      _resolvedHotPath = cjsRequire.resolve(HMR_HOT_SPECIFIER, {
        paths: [__dirname]
      })
    } catch {
      _resolvedHotPath = HMR_HOT_SPECIFIER
    }
  }
  return _resolvedHotPath
}

export function getDevServerHmrImports(compiler: Compiler): string[] {
  interface DevServerClientConfig {
    webSocketURL?: {
      protocol?: unknown
      hostname?: unknown
      port?: unknown
      pathname?: unknown
    }
    logging?: unknown
    progress?: unknown
    overlay?: unknown
    reconnect?: unknown
  }
  const devServer = (
    compiler.options as
      | {
          devServer?: {
            client?: DevServerClientConfig
            host?: string
            port?: string | number
            hot?: unknown
            liveReload?: unknown
          }
        }
      | undefined
  )?.devServer
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
  // The HMR client must dial a CONNECTABLE host. The bind host (devServer.host /
  // EXTENSION_DEV_SERVER_HOST) is a wildcard like 0.0.0.0 under
  // `--host 0.0.0.0` (devcontainer/CI), which the browser can't connect to.
  // Prefer an explicit client hostname, then the resolved connectable host
  // exported by dev-server/index.ts, then rewrite any wildcard bind host to
  // loopback (resolveConnectableHost).
  const envConnectableHost = process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST
  const hostname = String(
    webSocketURL.hostname ||
      envConnectableHost ||
      resolveConnectableHost(devServer?.host || envHost)
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
