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
  devServerAccessConfig,
  type SessionExtensionOriginCheck,
  withHostCheckMiddleware
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
    isSessionExtensionOrigin: input.isSessionExtensionOrigin
  })

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
      // Only public/ is watched outside the compiler: every page the build
      // knows is a file dependency, so its edit rebuilds and the done hook
      // refreshes it (html-refresh.ts). A project-wide html glob refreshed
      // every open page for a demo page the extension never loads.
      paths: publicFolder ? [path.join(publicFolder, '**/*')] : [],
      options: {
        // Prevent startup self-rebuild: initial emit writes dist/**/*.html.
        // Those generated files must not be treated as source watch inputs.
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
    headers: access.headers,
    setupMiddlewares: (
      ...args: Parameters<NonNullable<Configuration['setupMiddlewares']>>
    ) => {
      const checked = withHostCheckMiddleware(
        args[0],
        args[1],
        input.onHostRefused
      )

      if (!emulatorFiles) return checked

      return [
        createEmulatorFilesMiddlewareEntry(
          emulatorFiles,
          args[1],
          emulatorOrigin
        ) as unknown as (typeof args)[0][number],
        ...checked
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
