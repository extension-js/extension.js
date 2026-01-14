// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {ChildProcess, spawn} from 'child_process'
import * as messages from '../../browsers-lib/messages'
import type {DevOptions} from '../../../webpack-types'

export function setupProcessSignalHandlers(
  browser: DevOptions['browser'],
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
    console.error(
      messages.enhancedProcessManagementUncaughtException(browser, error)
    )
    cleanup()
    process.exit(1)
  })

  process.on('unhandledRejection', (reason) => {
    console.error(
      messages.enhancedProcessManagementUnhandledRejection(browser, reason)
    )
    cleanup()
    process.exit(1)
  })
}
