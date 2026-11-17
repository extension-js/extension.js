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

type ExitFn = (code?: number) => void

interface ProcessEventsLike {
  on(event: string, listener: (...args: never[]) => unknown): unknown
  removeListener(
    event: string,
    listener: (...args: never[]) => unknown
  ): unknown
}

export interface CleanupDependencies {
  events?: ProcessEventsLike
  exit?: ExitFn
  env?: Readonly<Record<string, string | undefined>>
}

function resolveDevServer(
  handle: DevServerHandle
): RspackDevServer | null | undefined {
  return typeof handle === 'function' ? handle() : handle
}

function closeAll(
  devServer: RspackDevServer | null | undefined,
  portManager: PortManager,
  exit: ExitFn
): Promise<void> {
  const afterStop = async () => {
    await portManager.terminateCurrentInstance()
    // Allow browser plugin signal handlers to complete cleanup
    setTimeout(() => exit(), 500)
  }

  if (!devServer || typeof devServer.stop !== 'function') return afterStop()

  return devServer
    .stop()
    .then(afterStop)
    .catch(async (error) => {
      humanLine(messages.extensionJsRunnerError(error))
      await portManager.terminateCurrentInstance()
      // Allow browser plugin signal handlers to complete cleanup
      setTimeout(() => exit(1), 500)
    })
}

// Returns a disposer that cancels auto-exit and removes every listener added
// here, so a second session in one process does not stack handlers.
export function setupCleanupHandlers(
  devServer: DevServerHandle,
  portManager: PortManager,
  onSignal?: (signal: NodeJS.Signals) => void,
  dependencies: CleanupDependencies = {}
): () => void {
  const events = dependencies.events ?? process
  // process.exit(undefined) clears an exitCode set earlier, exit() keeps it.
  const exit: ExitFn =
    dependencies.exit ??
    ((code) => (code === undefined ? process.exit() : process.exit(code)))
  const env = dependencies.env ?? process.env
  let isShuttingDown = false

  const cleanup = async () => {
    if (isShuttingDown) return

    isShuttingDown = true

    try {
      await closeAll(resolveDevServer(devServer), portManager, exit)
    } catch (error) {
      console.error(messages.runnerCleanupError(error))
      exit(1)
    }
  }

  // An uncaught exception leaves the process in an undefined state, tear down.
  // closeAll exits with no argument, so without this a crashed --no-browser
  // session (no launcher handler to exit 1) reports success to CI.
  const onUncaughtException = async (error: unknown) => {
    console.error(messages.runnerUncaughtException(error))
    process.exitCode = 1
    await cleanup()
  }

  // A stray rejection (common from browser plugins / CDP during long HMR
  // sessions) should NOT kill the dev server, log it and keep serving
  const onUnhandledRejection = (reason: unknown) => {
    console.error(messages.runnerUnhandledRejection(reason))
  }

  events.on('uncaughtException', onUncaughtException)
  events.on('unhandledRejection', onUnhandledRejection)

  // Optional auto-exit support for non-interactive (AI/CI) runs
  const cancelAutoExit = setupAutoExit(
    env.EXTENSION_AUTO_EXIT_MS,
    env.EXTENSION_FORCE_KILL_MS,
    cleanup
  )

  const cancelAndCleanup = async (signal: NodeJS.Signals) => {
    try {
      cancelAutoExit()
    } catch {
      // Ignore
    }

    // Before the server stops: closeAll ends the process, and a frame written
    // after it would never reach the pipe.
    if (!isShuttingDown) onSignal?.(signal)

    await cleanup()
  }

  // Do not remove other listeners; let browser plugins receive signals too.
  // Register our cleanup alongside theirs so Ctrl+C terminates the browser.
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']
  for (const signal of signals) events.on(signal, cancelAndCleanup)

  return () => {
    cancelAutoExit()
    events.removeListener('uncaughtException', onUncaughtException)
    events.removeListener('unhandledRejection', onUnhandledRejection)

    for (const signal of signals) {
      events.removeListener(signal, cancelAndCleanup)
    }
  }
}
