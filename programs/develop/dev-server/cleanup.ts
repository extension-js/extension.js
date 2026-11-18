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

type ProcessEventsLike = Pick<NodeJS.EventEmitter, 'on' | 'removeListener'>

// How long a shutdown may take before the process is ended anyway.
// A stop waits for a compile in flight, so the bound leaves room for one.
export const SHUTDOWN_TIMEOUT_MS = 10000

// One Ctrl+C can reach the process twice, from the terminal and from the
// package manager above it, so a repeat this soon is the same request.
export const REPEATED_SIGNAL_GRACE_MS = 1000

// A shutdown cut short is a truncated session, never a completed one.
export const FORCED_SHUTDOWN_EXIT_CODE = 1

export interface CleanupDependencies {
  events?: ProcessEventsLike
  exit?: ExitFn
  env?: Readonly<Record<string, string | undefined>>
  // Closes the control server, which the dev server's stop does not own.
  closeControlBridge?: () => Promise<void>
  shutdownTimeoutMs?: number
  print?: (line: string) => void
  now?: () => number
  // Called once, before anything is stopped.
  onShutdownStart?: () => void
}

function resolveDevServer(
  handle: DevServerHandle
): RspackDevServer | null | undefined {
  return typeof handle === 'function' ? handle() : handle
}

async function closeAll(
  devServer: RspackDevServer | null | undefined,
  portManager: PortManager,
  exit: ExitFn,
  closeControlBridge: (() => Promise<void>) | undefined
): Promise<void> {
  let failed = false

  // Each step runs even when the one before it failed, and any failure still
  // leaves the browser plugins their grace before the exit.
  const steps = [
    () => devServer?.stop?.(),
    () => closeControlBridge?.(),
    () => portManager.terminateCurrentInstance()
  ]

  for (const step of steps) {
    try {
      await step()
    } catch (error) {
      failed = true
      console.error(messages.runnerCleanupError(error))
    }
  }

  // Allow browser plugin signal handlers to complete cleanup
  setTimeout(() => (failed ? exit(1) : exit()), 500)
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
  const processExit: ExitFn =
    dependencies.exit ??
    ((code) => (code === undefined ? process.exit() : process.exit(code)))
  const env = dependencies.env ?? process.env
  const print = dependencies.print ?? humanLine
  const now = dependencies.now ?? Date.now
  const shutdownTimeoutMs =
    dependencies.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS
  let isShuttingDown = false
  let shutdownStartedAt = 0
  let shutdownTimer: NodeJS.Timeout | undefined

  const exit: ExitFn = (code) => {
    if (shutdownTimer) clearTimeout(shutdownTimer)

    shutdownTimer = undefined

    if (code === undefined) processExit()
    else processExit(code)
  }

  const cleanup = async () => {
    if (isShuttingDown) return

    isShuttingDown = true
    shutdownStartedAt = now()

    try {
      dependencies.onShutdownStart?.()
    } catch {
      // Ignore
    }

    // A stop that never settles would hold the terminal for good.
    shutdownTimer = setTimeout(() => {
      print(messages.shutdownTimedOut(shutdownTimeoutMs))
      exit(FORCED_SHUTDOWN_EXIT_CODE)
    }, shutdownTimeoutMs)

    try {
      await closeAll(
        resolveDevServer(devServer),
        portManager,
        exit,
        dependencies.closeControlBridge
      )
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

    // Asking twice means stop waiting, as the stock dev server does.
    if (isShuttingDown) {
      if (now() - shutdownStartedAt < REPEATED_SIGNAL_GRACE_MS) return

      print(messages.shutdownForcedBySignal(signal))
      exit(FORCED_SHUTDOWN_EXIT_CODE)

      return
    }

    // Before the server stops: closeAll ends the process, and a frame written
    // after it would never reach the pipe.
    onSignal?.(signal)

    await cleanup()
  }

  // Do not remove other listeners; let browser plugins receive signals too.
  // Register our cleanup alongside theirs so Ctrl+C terminates the browser.
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']
  for (const signal of signals) events.on(signal, cancelAndCleanup)

  return () => {
    cancelAutoExit()
    if (shutdownTimer) clearTimeout(shutdownTimer)

    shutdownTimer = undefined
    events.removeListener('uncaughtException', onUncaughtException)
    events.removeListener('unhandledRejection', onUnhandledRejection)

    for (const signal of signals) {
      events.removeListener(signal, cancelAndCleanup)
    }
  }
}
