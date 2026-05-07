// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {ChildProcess, spawn} from 'child_process'
import * as messages from '../../browsers-lib/messages'
import type {BrowserType} from '../../browsers-types'

export function setupProcessSignalHandlers(
  browser: BrowserType,
  child: ChildProcess,
  cleanupInstance: () => void
) {
  const cleanup = () => {
    try {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(messages.enhancedProcessManagementCleanup(browser))
      }

      if (child && !child.killed) {
        // On Windows, ensure the entire process tree is terminated.
        // Chromium spawns multiple processes; taskkill /T /F is most reliable.
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

        setTimeout(() => {
          if (child && !child.killed) {
            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
              console.log(messages.enhancedProcessManagementForceKill(browser))
            }
            child.kill('SIGKILL')
          }
        }, 5000)
      }

      cleanupInstance()
    } catch (error) {
      console.error(
        messages.enhancedProcessManagementCleanupError(browser, error)
      )
    }
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('SIGHUP', cleanup)
  process.on('exit', cleanup)

  process.on('uncaughtException', (error) => {
    if (isBenignSocketTeardown(error)) {
      // Browser auto-exit (EXTENSION_AUTO_EXIT_MS) and Ctrl+C teardowns close
      // the CDP/HTTP sockets while reads may still be in flight. The runner
      // can safely ignore these — keeping `process.exit(1)` here turns a
      // clean shutdown into a CI failure (Templates Nightly Edge).
      return
    }
    console.error(
      messages.enhancedProcessManagementUncaughtException(browser, error)
    )
    cleanup()
    process.exit(1)
  })

  process.on('unhandledRejection', (reason) => {
    if (isBenignSocketTeardown(reason)) return
    console.error(
      messages.enhancedProcessManagementUnhandledRejection(browser, reason)
    )
    cleanup()
    process.exit(1)
  })
}

// Errors that come from a socket the browser is in the middle of closing.
// They are not faults in the runner — they mean "the peer hung up while we
// were reading". Treat as no-op so a graceful shutdown stays graceful.
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
