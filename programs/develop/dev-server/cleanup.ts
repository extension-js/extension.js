// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {RspackDevServer} from '@rspack/dev-server'
import {setupAutoExit} from './auto-exit'
import {humanLine} from './lifecycle-stream'
import * as messages from './messages'
import type {PortManager} from './port-manager'

// A self-restart swaps the live server, so shutdown asks for the current one.
export type DevServerHandle =
  | RspackDevServer
  | (() => RspackDevServer | null | undefined)

function resolveDevServer(
  handle: DevServerHandle
): RspackDevServer | null | undefined {
  return typeof handle === 'function' ? handle() : handle
}

function closeAll(
  devServer: RspackDevServer | null | undefined,
  portManager: PortManager
): Promise<void> {
  const afterStop = async () => {
    await portManager.terminateCurrentInstance()
    // Allow browser plugin signal handlers to complete cleanup
    setTimeout(() => process.exit(), 500)
  }

  if (!devServer || typeof devServer.stop !== 'function') return afterStop()

  return devServer
    .stop()
    .then(afterStop)
    .catch(async (error) => {
      humanLine(messages.extensionJsRunnerError(error))
      await portManager.terminateCurrentInstance()
      // Allow browser plugin signal handlers to complete cleanup
      setTimeout(() => process.exit(1), 500)
    })
}

export function setupCleanupHandlers(
  devServer: DevServerHandle,
  portManager: PortManager
): () => void {
  let isShuttingDown = false

  const cleanup = async () => {
    if (isShuttingDown) return
    isShuttingDown = true

    try {
      await closeAll(resolveDevServer(devServer), portManager)
    } catch (error) {
      console.error('[Extension.js Runner] Error during cleanup.', error)
      process.exit(1)
    }
  }

  // An uncaught exception leaves the process in an undefined state, tear down
  process.on('uncaughtException', async (error) => {
    console.error('[Extension.js Runner] Uncaught exception.', error)
    await cleanup()
  })

  // A stray rejection (common from browser plugins / CDP during long HMR
  // sessions) should NOT kill the dev server, log it and keep serving
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[Extension.js Runner] Unhandled rejection.', promise, reason)
  })

  // Optional auto-exit support for non-interactive (AI/CI) runs
  const cancelAutoExit = setupAutoExit(
    process.env.EXTENSION_AUTO_EXIT_MS,
    process.env.EXTENSION_FORCE_KILL_MS,
    cleanup
  )

  const cancelAndCleanup = async () => {
    try {
      cancelAutoExit()
    } catch {
      // Ignore
    }
    await cleanup()
  }

  // Do not remove other listeners; let browser plugins receive signals too.
  // Register our cleanup alongside theirs so Ctrl+C terminates the browser.
  process.on('SIGINT', cancelAndCleanup)
  process.on('SIGTERM', cancelAndCleanup)
  process.on('SIGHUP', cancelAndCleanup)

  return cancelAutoExit
}
