// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {ChildProcess, spawn} from 'child_process'
import * as messages from '../../browsers-lib/messages'

export function setupFirefoxProcessHandlers(
  browser: 'firefox' | 'chrome' | 'edge' | 'chromium-based',
  childRef: () => ChildProcess | null,
  cleanupInstance: () => Promise<void>
) {
  let isCleaningUp = false

  const attemptCleanup = async () => {
    if (isCleaningUp) return
    isCleaningUp = true

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

        setTimeout(() => {
          if (child && !child.killed) {
            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
              console.log(messages.enhancedProcessManagementForceKill(browser))
            }
            child.kill('SIGKILL')
          }
        }, 5000)
      }

      await cleanupInstance()
    } catch (error) {
      console.error(
        messages.enhancedProcessManagementCleanupError(browser, error)
      )
    }
  }

  const onExit = () => {
    // Ensure full cleanup (SIGTERM -> optional SIGKILL -> instance cleanup)
    // Note: cannot await in 'exit' handler; fire-and-forget
    attemptCleanup()
  }

  process.on('exit', onExit)

  const onSignal = () => {
    // Perform cleanup and allow Node’s default exit behavior to proceed
    attemptCleanup()
  }

  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  process.on('SIGHUP', onSignal)
  // Windows-specific (Ctrl+Break / some console close scenarios)
  process.on('SIGBREAK', onSignal)
  // Opportunistic fallback before exit
  process.on('beforeExit', onSignal)

  process.on('uncaughtException', async (error) => {
    console.error(
      messages.enhancedProcessManagementUncaughtException(browser, error)
    )
    await attemptCleanup()
    process.exit(1)
  })

  process.on('unhandledRejection', async (reason) => {
    console.error(
      messages.enhancedProcessManagementUnhandledRejection(browser, reason)
    )
    await attemptCleanup()
    process.exit(1)
  })
}
