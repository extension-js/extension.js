// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {RspackDevServer} from '@rspack/dev-server'
import {PortManager} from './port-manager'
import {setupAutoExit} from './auto-exit'
import * as messages from './messages'

/**
 * Closes the dev server and terminates the port manager instance.
 *
 * @param devServer - The RspackDevServer instance
 * @param portManager - The PortManager instance
 */
function closeAll(
  devServer: RspackDevServer,
  portManager: PortManager
): Promise<void> {
  return devServer
    .stop()
    .then(async () => {
      // Terminate the current instance
      await portManager.terminateCurrentInstance()
      // Allow browser plugin signal handlers to complete cleanup
      setTimeout(() => process.exit(), 500)
    })
    .catch(async (error) => {
      console.log(messages.extensionJsRunnerError(error))
      // Still try to terminate the instance
      await portManager.terminateCurrentInstance()
      // Allow browser plugin signal handlers to complete cleanup
      setTimeout(() => process.exit(1), 500)
    })
}

/**
 * Creates cleanup handlers for process termination and uncaught errors.
 * Registers signal handlers for graceful shutdown.
 *
 * @param devServer - The RspackDevServer instance
 * @param portManager - The PortManager instance
 * @returns A cleanup function and a cancel function for auto-exit
 */
export function setupCleanupHandlers(
  devServer: RspackDevServer,
  portManager: PortManager
): () => void {
  // Handle process termination
  const cleanup = async () => {
    try {
      await closeAll(devServer, portManager)
    } catch (error) {
      console.error('[Extension.js Runner] Error during cleanup.', error)
      process.exit(1)
    }
  }

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    console.error('[Extension.js Runner] Uncaught exception.', error)
    await cleanup()
  })

  process.on('unhandledRejection', async (reason, promise) => {
    console.error('[Extension.js Runner] Unhandled rejection.', promise, reason)
    await cleanup()
  })

  // Optional auto-exit support for non-interactive (AI/CI) runs
  const cancelAutoExit = setupAutoExit(
    process.env.EXTENSION_AUTO_EXIT_MS,
    process.env.EXTENSION_FORCE_KILL_MS,
    cleanup
  )

  // Ensure we clear timers before shutdown
  const cancelAndCleanup = async () => {
    try {
      cancelAutoExit()
    } catch {
      // ignore cancellation errors
    }
    await cleanup()
  }

  // Do not remove other listeners; let browser plugins receive signals too.
  // Register our cleanup alongside theirs so Ctrl+C terminates the browser.
  process.on('ERROR', cancelAndCleanup)
  process.on('SIGINT', cancelAndCleanup)
  process.on('SIGTERM', cancelAndCleanup)
  process.on('SIGHUP', cancelAndCleanup)

  return cancelAutoExit
}
