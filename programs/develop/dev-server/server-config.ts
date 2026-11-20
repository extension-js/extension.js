// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {IncomingMessage} from 'node:http'
import * as path from 'node:path'
import type {Duplex} from 'node:stream'
import type {Compiler} from '@rspack/core'
import type {Configuration} from '@rspack/dev-server'
import {rootAbsolutePathIsWithheld} from '../plugin-special-folders/public-private-files'
import {
  createSocketVerifier,
  devServerAccessConfig,
  REQUEST_SITE_MIDDLEWARE_NAME,
  type SessionExtensionOriginCheck,
  withHostCheckMiddleware,
  withRequestSiteMiddleware
} from './cors'
import {
  createResponseDataRepair,
  type OutputFileSystemLike
} from './dev-middleware-body'
import {
  createEmulatorFilesMiddlewareEntry,
  type EmulatorFileIndexHolder
} from './emulator-lane'

// Letter case is folded on every platform. A case-insensitive Linux mount
// (WSL /mnt/c, casefold ext4) would let MANIFEST.JSON replace the manifest.
// Both separators and the long-path prefix name one file on Windows, so two
// spellings of a path compare equal here.
function comparablePath(filePath: string) {
  const forward = filePath.replace(/\\/g, '/').replace(/^\/\/\?\//, '')
  const normalized = path.posix.normalize(forward)

  return normalized.toLowerCase()
}

// Only manifest.json at the root of the output folder is the extension's own.
// A nested one is an ordinary file, copied the way a production build does.
export function isRootManifestPath(
  filePath: string,
  outputPath: string | undefined
) {
  const file = comparablePath(filePath)

  if (file === 'manifest.json') return true

  // With no output folder to compare against, protect every manifest.json.
  if (!outputPath) return /(?:^|\/)manifest\.json$/.test(file)

  return file === comparablePath(`${outputPath}/manifest.json`)
}

export function shouldWriteAssetToDisk(
  filePath: string,
  outputPath: string | undefined
) {
  // A `..` segment means an emitted asset NAME escapes the output dir; writing
  // it would clobber a SOURCE file and start a self-feeding recompile loop.
  if (/(?:^|[/\\])\.\.(?:[/\\]|$)/.test(filePath)) return false

  return !isRootManifestPath(filePath, outputPath)
}

type MiddlewareList = Parameters<
  NonNullable<Configuration['setupMiddlewares']>
>[0]

type NextFn = (error?: unknown) => void

// The stock server reads public/ by URL. A name the build leaves out of the
// output answers as a missing file, so a URL reaches no more than the build.
export function withPrivatePublicFilesWithheld(
  middlewares: MiddlewareList
): MiddlewareList {
  return middlewares.map((entry) => {
    if (typeof entry !== 'object' || entry.name !== 'serve-static') {
      return entry
    }

    const serve = entry.middleware as (
      req: {url?: string},
      res: unknown,
      next: NextFn
    ) => void

    return {
      ...entry,
      middleware: ((req: {url?: string}, res: unknown, next: NextFn) => {
        const urlPath = String(req.url || '').split(/[?#]/)[0]

        if (rootAbsolutePathIsWithheld(urlPath)) return next()

        return serve(req, res, next)
      }) as typeof entry.middleware
    }
  })
}

export interface ServerConfigInput {
  // The bind host, which may be a wildcard such as 0.0.0.0.
  host: string
  port: number
  connectableHost: string
  emulatorOrigin: string | null
  allowedHosts?: string | string[]
  isSessionExtensionOrigin: SessionExtensionOriginCheck
  publicFolder: string | undefined
  emulatorFiles: EmulatorFileIndexHolder | null
  // The middleware reads the live compiler's output; a restart swaps it.
  activeCompiler: () => Compiler | null
  onHostRefused: (host: string) => void
  // Called once per session, with the origin the first refused request named.
  onSiteRefused: (origin: string) => void
  server: Configuration['server']
  // The reload socket path the session's own extension is built with.
  socketPath: string
}

// The reload socket names the session, so only an extension this session
// built can open it. The stock server answers no other path.
export function sessionSocketPath(instanceId: string): string {
  return `/ws/${encodeURIComponent(instanceId)}`
}

// What a build of another session hears when it dials its reload socket here.
export const OTHER_SESSION_SOCKET_REASON =
  'This reload socket path belongs to another dev session. Load the build of the session that is running.'

// The stock server leaves an upgrade at a path it does not serve unanswered,
// so a build from another session would wait out its handshake bound.
export function refuseOtherSessionSockets(
  server: {
    on(
      event: 'upgrade',
      listener: (req: IncomingMessage, socket: Duplex) => void
    ): unknown
  },
  socketPath: string
): void {
  server.on('upgrade', (req, socket) => {
    const pathname = String(req.url || '').split('?')[0]

    if (pathname === socketPath) return
    if (pathname !== '/ws' && !pathname.startsWith('/ws/')) return

    const body = `${OTHER_SESSION_SOCKET_REASON}\n`

    socket.end(
      'HTTP/1.1 404 Not Found\r\n' +
        'Connection: close\r\n' +
        'Content-Type: text/plain; charset=utf-8\r\n' +
        `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
        body
    )
  })
}

export function buildServerConfig(input: ServerConfigInput): Configuration {
  const {publicFolder, emulatorFiles, emulatorOrigin} = input
  const access = devServerAccessConfig({
    connectableHost: input.connectableHost,
    emulatorOrigin,
    allowedHosts: input.allowedHosts,
    isSessionExtensionOrigin: input.isSessionExtensionOrigin,
    host: input.host,
    port: input.port
  })
  let siteRefusalAnnounced = false
  // A restart makes the next compiler live before the old one stops, so a
  // late write from the old emit is judged against every output folder seen.
  const outputPathsSeen = new Set<string>()

  const writeToDisk = (filePath: string) => {
    const current = input.activeCompiler()?.options?.output?.path
    if (!current) return shouldWriteAssetToDisk(filePath, undefined)

    outputPathsSeen.add(current)

    return [...outputPathsSeen].every((outputPath) =>
      shouldWriteAssetToDisk(filePath, outputPath)
    )
  }

  const announceSiteRefusal = (origin: string) => {
    if (siteRefusalAnnounced) return

    siteRefusalAnnounced = true
    input.onSiteRefused(origin)
  }

  return {
    host: input.host,
    allowedHosts: access.allowedHosts,
    // Served, never watched: an edit under public/ reaches the session
    // through the compiler, which copies the folder and reloads for it.
    static: publicFolder ? {directory: publicFolder, watch: false} : false,
    compress: false,
    devMiddleware: {
      // Manifest writes must stay atomic; let the manifest plugin own disk
      // persistence so Chromium never reads an in-place truncated file.
      writeToDisk,
      stats: {all: false},
      // A one-byte asset is served empty by the middleware, see the helper.
      modifyResponseData: createResponseDataRepair({
        outputPath: () => input.activeCompiler()?.options?.output?.path,
        outputFileSystem: () =>
          input.activeCompiler()?.outputFileSystem as
            | OutputFileSystemLike
            | undefined
      })
    },
    client: false,
    // The stock socket check still runs after this one, on the connection.
    webSocketServer: {
      type: 'ws',
      options: {
        path: input.socketPath,
        verifyClient: createSocketVerifier(
          access.requestSite,
          announceSiteRefusal
        )
      }
    },
    headers: access.headers,
    setupMiddlewares: (
      ...args: Parameters<NonNullable<Configuration['setupMiddlewares']>>
    ) => {
      // The HTTP server exists by now. The socket server attaches after listen.
      const httpServer = (
        args[1] as {server?: Parameters<typeof refuseOtherSessionSockets>[0]}
      ).server
      if (httpServer) refuseOtherSessionSockets(httpServer, input.socketPath)

      const checked = withRequestSiteMiddleware(
        withHostCheckMiddleware(args[0], args[1], input.onHostRefused),
        access.requestSite,
        announceSiteRefusal
      )

      const served = withPrivatePublicFilesWithheld(checked)

      if (!emulatorFiles) return served

      // Both checks run before the viewer's file index, as before any file.
      const after =
        served.findIndex(
          (item) =>
            (item as {name?: string}).name === REQUEST_SITE_MIDDLEWARE_NAME
        ) + 1

      return [
        ...served.slice(0, after),
        createEmulatorFilesMiddlewareEntry(
          emulatorFiles,
          args[1],
          emulatorOrigin
        ) as unknown as (typeof args)[0][number],
        ...served.slice(after)
      ]
    },
    port: input.port,
    // Rspack must inject `module.hot` so `@rspack/core/hot/dev-server` does not
    // throw; content bundles strip HMR startup, so liveReload cannot loop them.
    hot: true,
    liveReload: true,
    // setupCleanupHandlers owns the signals. The server's own handler stopped
    // it a second time, so one Ctrl+C closed the watch and logged twice.
    setupExitSignals: false,
    server: input.server
  }
}
