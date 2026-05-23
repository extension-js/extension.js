// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {ChildProcess, spawn} from 'child_process'
import * as messages from '../../browsers-lib/messages'

type FirefoxBrowserKind = 'firefox' | 'chrome' | 'edge' | 'chromium-based'

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

    const child = childRef()

    if (child && !child.killed) {
      // On Windows, ensure the entire process tree is terminated.
      // Firefox can spawn multiple processes; taskkill /T /F is most reliable.
      if (process.platform === 'win32') {
        try {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true
          }).on('error', () => {
            // Ignore errors from taskkill
          })
        } catch {
          // Ignore
        }
      }

      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(messages.enhancedProcessManagementTerminating(browser))
      }
      child.kill('SIGTERM')

      const killTimer = setTimeout(() => {
        if (child && !child.killed) {
          if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
            console.log(messages.enhancedProcessManagementForceKill(browser))
          }
          child.kill('SIGKILL')
        }
      }, 5000)
      // The SIGKILL fallback must not keep the event loop alive on its own
      killTimer.unref?.()
    }

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

function firstBrowserLabel(): FirefoxBrowserKind {
  for (const instance of activeInstances) return instance.browser
  return 'firefox'
}

function installGlobalHandlersOnce(): void {
  if (globalHandlersInstalled) return
  globalHandlersInstalled = true

  process.on('exit', cleanupAllInstances)
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

const BENIGN_SOCKET_ERROR_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ECONNABORTED',
  'ENOTCONN'
])

function isBenignSocketTeardown(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const code = (value as {code?: unknown}).code
  return typeof code === 'string' && BENIGN_SOCKET_ERROR_CODES.has(code)
}
