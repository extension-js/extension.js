// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import type {Configuration} from '@rspack/dev-server'
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

export function shouldWriteAssetToDisk(filePath: string) {
  // A `..` segment means an emitted asset NAME escapes the output dir; writing
  // it would clobber a SOURCE file and start a self-feeding recompile loop.
  if (/(?:^|[/\\])\.\.(?:[/\\]|$)/.test(filePath)) return false

  return !/(?:^|[/\\])manifest\.json$/i.test(filePath)
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
  packageJsonDir: string
  emulatorFiles: EmulatorFileIndexHolder | null
  // The middleware reads the live compiler's output; a restart swaps it.
  activeCompiler: () => Compiler | null
  onHostRefused: (host: string) => void
  // Called once per session, with the origin the first refused request named.
  onSiteRefused: (origin: string) => void
  server: Configuration['server']
  env?: Readonly<Record<string, string | undefined>>
}

export function buildServerConfig(input: ServerConfigInput): Configuration {
  const {publicFolder, emulatorFiles, emulatorOrigin} = input
  const env = input.env ?? process.env
  const access = devServerAccessConfig({
    connectableHost: input.connectableHost,
    emulatorOrigin,
    allowedHosts: input.allowedHosts,
    isSessionExtensionOrigin: input.isSessionExtensionOrigin,
    host: input.host,
    port: input.port
  })
  let siteRefusalAnnounced = false

  const announceSiteRefusal = (origin: string) => {
    if (siteRefusalAnnounced) return

    siteRefusalAnnounced = true
    input.onSiteRefused(origin)
  }

  return {
    host: input.host,
    allowedHosts: access.allowedHosts,
    static: publicFolder ? {directory: publicFolder, watch: false} : false,
    compress: false,
    devMiddleware: {
      // Manifest writes must stay atomic; let the manifest plugin own disk
      // persistence so Chromium never reads an in-place truncated file.
      writeToDisk: shouldWriteAssetToDisk,
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
    watchFiles: {
      // Meant to watch public/ outside the compiler, but chokidar 5 reads this
      // glob as a literal path, so it sees no edit (see the loopback spec).
      paths: publicFolder ? [path.join(publicFolder, '**/*')] : [],
      options: {
        // A literal path to chokidar 5 as well. This watcher only sends
        // static-changed and never rebuilds, so it guards nothing today.
        ignored: [path.join(input.packageJsonDir, 'dist', '**/*')],
        // Native FS events by default: polling wakes the CPU and adds HMR latency.
        // EXTENSION_WATCH_POLL opts into polling where native events are unreliable.
        ...(env.EXTENSION_WATCH_POLL === 'true'
          ? {
              usePolling: true,
              interval: parseInt(
                String(env.EXTENSION_WATCH_POLL_INTERVAL || '1000'),
                10
              )
            }
          : {})
      }
    },
    client: false,
    // The stock socket check still runs after this one, on the connection.
    webSocketServer: {
      type: 'ws',
      options: {
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
      const checked = withRequestSiteMiddleware(
        withHostCheckMiddleware(args[0], args[1], input.onHostRefused),
        access.requestSite,
        announceSiteRefusal
      )

      if (!emulatorFiles) return checked

      // Both checks run before the viewer's file index, as before any file.
      const after =
        checked.findIndex(
          (item) =>
            (item as {name?: string}).name === REQUEST_SITE_MIDDLEWARE_NAME
        ) + 1

      return [
        ...checked.slice(0, after),
        createEmulatorFilesMiddlewareEntry(
          emulatorFiles,
          args[1],
          emulatorOrigin
        ) as unknown as (typeof args)[0][number],
        ...checked.slice(after)
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
