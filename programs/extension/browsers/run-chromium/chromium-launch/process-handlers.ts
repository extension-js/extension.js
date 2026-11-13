// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {ChildProcess} from 'node:child_process'
import {humanError, humanLine, isDebug} from '../../../helpers/messaging'
import * as messages from '../../browsers-lib/messages'
import {
  forceKillChildOnExit,
  forceKillMarkedOnExit,
  gracefulTerminateChild,
  isBenignSocketTeardown,
  markDescendants,
  type ProcessMark
} from '../../browsers-lib/process-teardown'
import type {BrowserType} from '../../browsers-types'

interface ChromiumInstanceHandlers {
  browser: BrowserType
  child: ChildProcess
  cleanupInstance: () => void
  cleanupOnExit?: () => void
  isCleaningUp: boolean
  helpers?: ProcessMark[]
}

const activeInstances = new Set<ChromiumInstanceHandlers>()
let globalHandlersInstalled = false

export function __activeChromiumInstanceCount() {
  return activeInstances.size
}

export function __resetChromiumProcessHandlersForTest() {
  activeInstances.clear()
  globalHandlersInstalled = false
}

function cleanupOne(instance: ChromiumInstanceHandlers) {
  if (instance.isCleaningUp) return

  instance.isCleaningUp = true

  const {browser, child, cleanupInstance} = instance

  try {
    if (isDebug()) {
      humanLine(messages.enhancedProcessManagementCleanup(browser))
    }

    instance.helpers = markDescendants(child.pid)
    gracefulTerminateChild(child, browser)
    cleanupInstance()
  } catch (error) {
    humanError(messages.enhancedProcessManagementCleanupError(browser, error))
  }
}

function cleanupAll() {
  for (const instance of activeInstances) cleanupOne(instance)
}

// The process ends before the browser's close event can run, so the helpers
// a killed browser orphans and its throwaway profile are dealt with here.
function forceKillAllOnExit() {
  for (const instance of activeInstances) {
    const helpers = instance.helpers ?? markDescendants(instance.child.pid)

    forceKillChildOnExit(instance.child, instance.browser)
    forceKillMarkedOnExit(helpers)

    try {
      instance.cleanupOnExit?.()
    } catch {
      // Ignore
    }
  }
}

function firstBrowserLabel(): BrowserType {
  for (const instance of activeInstances) return instance.browser

  return 'chrome' as BrowserType
}

function installGlobalHandlersOnce() {
  if (globalHandlersInstalled) return

  globalHandlersInstalled = true

  process.on('SIGINT', cleanupAll)
  process.on('SIGTERM', cleanupAll)
  process.on('SIGHUP', cleanupAll)
  process.on('exit', forceKillAllOnExit)

  process.on('uncaughtException', (error) => {
    if (isBenignSocketTeardown(error)) {
      // Auto-exit and Ctrl+C teardowns close sockets mid-read; process.exit(1) here
      // turns a clean shutdown into a CI failure.
      return
    }

    humanError(
      messages.enhancedProcessManagementUncaughtException(
        firstBrowserLabel(),
        error
      )
    )

    cleanupAll()
    process.exit(1)
  })

  process.on('unhandledRejection', (reason) => {
    if (isBenignSocketTeardown(reason)) return

    humanError(
      messages.enhancedProcessManagementUnhandledRejection(
        firstBrowserLabel(),
        reason
      )
    )

    cleanupAll()
    process.exit(1)
  })
}

// Register a Chromium instance for process-exit cleanup; returns a disposer.
// Global process listeners are installed only on the first call.
export function setupProcessSignalHandlers(
  browser: BrowserType,
  child: ChildProcess,
  cleanupInstance: () => void,
  cleanupOnExit?: () => void
): () => void {
  const instance: ChromiumInstanceHandlers = {
    browser,
    child,
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
