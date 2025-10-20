import {ChildProcess} from 'child_process'
import * as messages from '../browsers-lib/messages'
import { DevOptions } from '../../../types/options'

export function setupProcessSignalHandlers(
  browser: DevOptions['browser'],
  child: ChildProcess,
  cleanupInstance: () => void
) {
  const cleanup = () => {
    try {
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.enhancedProcessManagementCleanup(browser))
      }

      if (child && !child.killed) {
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(messages.enhancedProcessManagementTerminating(browser))
        }

        child.kill('SIGTERM')

        setTimeout(() => {
          if (child && !child.killed) {
            if (process.env.EXTENSION_ENV === 'development') {
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
