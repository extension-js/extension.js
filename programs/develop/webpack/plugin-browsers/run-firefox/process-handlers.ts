import {ChildProcess} from 'child_process'
import * as messages from '../browsers-lib/messages'

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
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.enhancedProcessManagementCleanup(browser))
      }

      const child = childRef()

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

      await cleanupInstance()
    } catch (error) {
      console.error(
        messages.enhancedProcessManagementCleanupError(browser, error)
      )
    }
  }

  const onExit = () => {
    const child = childRef()

    if (child && !child.killed) {
      try {
        child.kill('SIGTERM')
      } catch {
        // Ignore
      }
    }
  }

  process.on('exit', onExit)

  const onSignal = async () => {
    await attemptCleanup()
    process.exit(0)
  }

  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  process.on('SIGHUP', onSignal)

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
