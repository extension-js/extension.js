// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {ChildProcess} from 'node:child_process'
import * as messages from '../../browsers-lib/messages'
import {
  forceKillChildOnExit,
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
  cleanupInstance: () => Promise<void>
  isCleaningUp: boolean
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
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(messages.enhancedProcessManagementCleanup(browser))
    }

    gracefulTerminateChild(childRef(), browser)
    await cleanupInstance()
  } catch (error) {
    console.error(
      messages.enhancedProcessManagementCleanupError(browser, error)
    )
  }
}

function cleanupAllInstances(): void {
  for (const instance of activeInstances) {
    void attemptCleanup(instance)
  }
}

function forceKillAllOnExit(): void {
  for (const instance of activeInstances) {
    forceKillChildOnExit(instance.childRef(), instance.browser)
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
  // Opportunistic fallback before exit
  process.on('beforeExit', cleanupAllInstances)

  process.on('uncaughtException', async (error) => {
    if (isBenignSocketTeardown(error)) {
      // RDP socket reads can fire ECONNRESET while Firefox is being closed
      // (auto-exit, Ctrl+C). Ignoring keeps a graceful shutdown clean.
      return
    }
    console.error(
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
    console.error(
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
  cleanupInstance: () => Promise<void>
): () => void {
  const instance: FirefoxInstanceHandlers = {
    browser,
    childRef,
    cleanupInstance,
    isCleaningUp: false
  }

  activeInstances.add(instance)
  installGlobalHandlersOnce()

  return () => {
    activeInstances.delete(instance)
  }
}
