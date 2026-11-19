// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {ChildProcess} from 'node:child_process'
import {humanError, humanLine, isDebug} from '../../../helpers/messaging'
import * as messages from '../../browsers-lib/messages'
import {
  forceKillChildOnExit,
  forceKillPidOnExit,
  gracefulTerminateChild,
  isBenignSocketTeardown
} from '../../browsers-lib/process-teardown'

export type FirefoxBrowserKind =
  | 'firefox'
  | 'chrome'
  | 'edge'
  | 'chromium-based'

interface FirefoxInstanceHandlers {
  browser: FirefoxBrowserKind
  childRef: () => ChildProcess | null
  // The process the browser handed the session to, when it did. The exit
  // backstop has to reach it as well or it outlives the session.
  livePidRef: () => AdoptedPid | null
  cleanupInstance: () => Promise<void>
  // Runs as the process ends, after the browser was killed, for what only
  // a dead browser lets go of: its throwaway profile.
  cleanupOnExit?: () => void
  isCleaningUp: boolean
}

export interface AdoptedPid {
  pid: number
  adoptedAt: number
}

const activeInstances = new Set<FirefoxInstanceHandlers>()
let globalHandlersInstalled = false

export function __activeFirefoxInstanceCount(): number {
  return activeInstances.size
}

export function __resetFirefoxProcessHandlersForTest(): void {
  activeInstances.clear()
  globalHandlersInstalled = false
}

async function attemptCleanup(
  instance: FirefoxInstanceHandlers
): Promise<void> {
  if (instance.isCleaningUp) return

  instance.isCleaningUp = true

  const {browser, childRef, cleanupInstance} = instance

  try {
    if (isDebug()) {
      humanLine(messages.enhancedProcessManagementCleanup(browser))
    }

    gracefulTerminateChild(childRef(), browser)
    await cleanupInstance()
  } catch (error) {
    humanError(messages.enhancedProcessManagementCleanupError(browser, error))
  }
}

function cleanupAllInstances(): void {
  for (const instance of activeInstances) {
    void attemptCleanup(instance)
  }
}

function forceKillAllOnExit(): void {
  for (const instance of activeInstances) {
    const child = instance.childRef()
    const live = instance.livePidRef()
    forceKillChildOnExit(child, instance.browser)

    if (live && live.pid !== child?.pid) {
      forceKillPidOnExit(live.pid, instance.browser, live.adoptedAt)
    }

    try {
      instance.cleanupOnExit?.()
    } catch {
      // Ignore
    }
  }
}

function firstBrowserLabel(): FirefoxBrowserKind {
  for (const instance of activeInstances) return instance.browser

  return 'firefox'
}

function installGlobalHandlersOnce(): void {
  if (globalHandlersInstalled) return

  globalHandlersInstalled = true

  process.on('exit', forceKillAllOnExit)
  process.on('SIGINT', cleanupAllInstances)
  process.on('SIGTERM', cleanupAllInstances)
  process.on('SIGHUP', cleanupAllInstances)
  // Windows-specific (Ctrl+Break / some console close scenarios)
  process.on('SIGBREAK', cleanupAllInstances)
  process.on('beforeExit', cleanupAllInstances)

  process.on('uncaughtException', async (error) => {
    if (isBenignSocketTeardown(error)) {
      // RDP socket reads can fire ECONNRESET while Firefox is being closed
      // (auto-exit, Ctrl+C). Ignoring keeps a graceful shutdown clean.
      return
    }

    humanError(
      messages.enhancedProcessManagementUncaughtException(
        firstBrowserLabel(),
        error
      )
    )

    await Promise.all([...activeInstances].map((i) => attemptCleanup(i)))
    process.exit(1)
  })

  process.on('unhandledRejection', async (reason) => {
    if (isBenignSocketTeardown(reason)) return

    humanError(
      messages.enhancedProcessManagementUnhandledRejection(
        firstBrowserLabel(),
        reason
      )
    )

    await Promise.all([...activeInstances].map((i) => attemptCleanup(i)))
    process.exit(1)
  })
}

export function setupFirefoxProcessHandlers(
  browser: FirefoxBrowserKind,
  childRef: () => ChildProcess | null,
  cleanupInstance: () => Promise<void>,
  livePidRef: () => AdoptedPid | null = () => null,
  cleanupOnExit?: () => void
): () => void {
  const instance: FirefoxInstanceHandlers = {
    browser,
    childRef,
    livePidRef,
    cleanupInstance,
    cleanupOnExit,
    isCleaningUp: false
  }

  activeInstances.add(instance)
  installGlobalHandlersOnce()

  return () => {
    activeInstances.delete(instance)
  }
}
