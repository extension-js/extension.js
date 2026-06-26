// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {ChildProcess} from 'child_process'
import * as messages from '../../browsers-lib/messages'
import {
  gracefulTerminateChild,
  forceKillChildOnExit,
  isBenignSocketTeardown
} from '../../browsers-lib/process-teardown'
import type {BrowserType} from '../../browsers-types'

interface ChromiumInstanceHandlers {
  browser: BrowserType
  child: ChildProcess
  cleanupInstance: () => void
  isCleaningUp: boolean
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
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(messages.enhancedProcessManagementCleanup(browser))
    }

    gracefulTerminateChild(child, browser)
    cleanupInstance()
  } catch (error) {
    console.error(
      messages.enhancedProcessManagementCleanupError(browser, error)
    )
  }
}

function cleanupAll() {
  for (const instance of activeInstances) cleanupOne(instance)
}

function forceKillAllOnExit() {
  for (const instance of activeInstances) {
    forceKillChildOnExit(instance.child, instance.browser)
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
      // Browser auto-exit (EXTENSION_AUTO_EXIT_MS) and Ctrl+C teardowns close
      // the CDP/HTTP sockets while reads may still be in flight. The runner
      // can safely ignore these — keeping `process.exit(1)` here turns a
      // clean shutdown into a CI failure (Templates Nightly Edge).
      return
    }
    console.error(
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
    console.error(
      messages.enhancedProcessManagementUnhandledRejection(
        firstBrowserLabel(),
        reason
      )
    )
    cleanupAll()
    process.exit(1)
  })
}

/**
 * Register a Chromium instance for process-exit cleanup. Returns a disposer that
 * unregisters the instance (call it once the child has exited). Global process
 * listeners are installed only on the first call.
 */
export function setupProcessSignalHandlers(
  browser: BrowserType,
  child: ChildProcess,
  cleanupInstance: () => void
): () => void {
  const instance: ChromiumInstanceHandlers = {
    browser,
    child,
    cleanupInstance,
    isCleaningUp: false
  }
  activeInstances.add(instance)
  installGlobalHandlersOnce()

  return () => {
    activeInstances.delete(instance)
  }
}
