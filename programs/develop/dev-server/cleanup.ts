// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {RspackDevServer} from '@rspack/dev-server'
import {humanLine} from '../lib/messaging'
import {setupAutoExit} from './auto-exit'
import {leaveWatchHandlesToExit} from './leave-watch-handles-to-exit'
import * as messages from './messages'
import type {PortManager} from './port-manager'

// A self-restart swaps the live server, so shutdown asks for the current one.
type DevServerHandle =
  | RspackDevServer
  | (() => RspackDevServer | null | undefined)

type ExitFn = (code?: number) => void

type ProcessEventsLike = Pick<NodeJS.EventEmitter, 'on' | 'removeListener'>

// How long a shutdown may take before the process is ended anyway.
// A stop waits for a compile in flight, so the bound leaves room for one.
export const SHUTDOWN_TIMEOUT_MS = 10000

// How far past the shutdown bound the auto-exit backstop fires, so the
// bound's own line and exit code are what a stuck stop reports.
const AUTO_EXIT_BACKSTOP_MARGIN_MS = 500

// One Ctrl+C can reach the process twice, from the terminal and from the
// package manager above it, so a repeat this soon is the same request.
export const REPEATED_SIGNAL_GRACE_MS = 1000

// A shutdown cut short is a truncated session, never a completed one.
export const FORCED_SHUTDOWN_EXIT_CODE = 1

// The wait after the last stop step, so browser plugins finish their cleanup.
export const EXIT_DELAY_MS = 500

interface CleanupDependencies {
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
  // Called when a stop passes its bound, right before the forced exit.
  onShutdownTimedOut?: (timeoutMs: number, exitCode: number) => void
  // Called once before the stop. Defaults to the macOS watch release only
  // when the real process exit ends the shutdown.
  leaveWatchHandles?: () => void
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
  setTimeout(() => (failed ? exit(1) : exit()), EXIT_DELAY_MS)
}

interface CleanupHandlers {
  (): void
  // Runs the same shutdown a signal runs, and the process then exits 1.
  endAsFailed: () => Promise<void>
}

// Returns a disposer that cancels auto-exit and removes every listener added
// here, so a second session in one process does not stack handlers.
export function setupCleanupHandlers(
  devServer: DevServerHandle,
  portManager: PortManager,
  onSignal?: (signal: NodeJS.Signals) => void,
  dependencies: CleanupDependencies = {}
): CleanupHandlers {
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
  const leaveWatchHandles =
    dependencies.leaveWatchHandles ??
    (dependencies.exit ? undefined : () => leaveWatchHandlesToExit())
  let isShuttingDown = false
  let shutdownStartedAt = 0
  let shutdownTimer: NodeJS.Timeout | undefined
  let endingAsFailed = false
  // A crash keeps its own verdict even when the stop after it hangs.
  let crashed = false

  const exit: ExitFn = (code) => {
    if (shutdownTimer) clearTimeout(shutdownTimer)

    shutdownTimer = undefined

    // A session ended as a failure never exits 0, however clean its stop.
    if (code === undefined && endingAsFailed) processExit(1)
    else if (code === undefined) processExit()
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
      if (!crashed) {
        try {
          dependencies.onShutdownTimedOut?.(
            shutdownTimeoutMs,
            FORCED_SHUTDOWN_EXIT_CODE
          )
        } catch {
          // The exit code is the verdict that must survive.
        }
      }

      print(messages.shutdownTimedOut(shutdownTimeoutMs))
      exit(FORCED_SHUTDOWN_EXIT_CODE)
    }, shutdownTimeoutMs)

    try {
      leaveWatchHandles?.()
    } catch {
      // The stop still runs, with the slower native close.
    }

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
    crashed = true
    await cleanup()
  }

  // A stray rejection (common from browser plugins / CDP during long HMR
  // sessions) should NOT kill the dev server, log it and keep serving
  const onUnhandledRejection = (reason: unknown) => {
    console.error(messages.runnerUnhandledRejection(reason))
  }

  events.on('uncaughtException', onUncaughtException)
  events.on('unhandledRejection', onUnhandledRejection)

  // Optional auto-exit support for non-interactive (AI/CI) runs. The default
  // backstop outlasts the shutdown bound, which already ends a stuck stop.
  const cancelAutoExit = setupAutoExit(
    env.EXTENSION_AUTO_EXIT_MS,
    env.EXTENSION_FORCE_KILL_MS,
    cleanup,
    shutdownTimeoutMs + EXIT_DELAY_MS + AUTO_EXIT_BACKSTOP_MARGIN_MS
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

  // The CLI arms a fallback frame for a signal no command answers yet. This
  // session frames its own stop from here on, and says so where both can read.
  if (onSignal) {
    ;(globalThis as unknown as Record<symbol, boolean>)[
      Symbol.for('extension.js.interrupt-frame-claimed')
    ] = true
  }

  // Do not remove other listeners; let browser plugins receive signals too.
  // Register our cleanup alongside theirs so Ctrl+C terminates the browser.
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']
  for (const signal of signals) events.on(signal, cancelAndCleanup)

  const dispose = () => {
    cancelAutoExit()
    if (shutdownTimer) clearTimeout(shutdownTimer)

    shutdownTimer = undefined
    events.removeListener('uncaughtException', onUncaughtException)
    events.removeListener('unhandledRejection', onUnhandledRejection)

    for (const signal of signals) {
      events.removeListener(signal, cancelAndCleanup)
    }
  }

  return Object.assign(dispose, {
    endAsFailed: async () => {
      // A shutdown under way already wrote its stopped frame and owns the exit.
      if (isShuttingDown) return

      endingAsFailed = true

      try {
        cancelAutoExit()
      } catch {
        // Ignore
      }

      await cleanup()
    }
  })
}
