import {
  getInstancePorts,
  getLastCDPPort
} from '../../browsers-lib/instance-registry'
import * as messages from '../../browsers-lib/messages'
import {checkChromeRemoteDebugging} from './discovery'

export async function waitForChromeRemoteDebugging(
  port: number,
  instanceId?: string
): Promise<void> {
  // First attempt: override with any registered CDP port
  try {
    const fromRegistry =
      (instanceId && getInstancePorts(instanceId)?.cdpPort) || getLastCDPPort()

    if (typeof fromRegistry === 'number' && fromRegistry > 0) {
      port = fromRegistry
    }
  } catch {
    // Ignore
  }

  if (process.env.EXTENSION_ENV === 'development') {
    console.log(messages.sourceInspectorWaitingForChrome())
  }

  let retries = 0
  const maxRetries = 60
  const backoffMs = 500

  while (retries < maxRetries) {
    // On each retry, re-check the registry in case the
    // launcher registered a port after we started waiting
    try {
      const dyn =
        (instanceId && getInstancePorts(instanceId)?.cdpPort) ||
        getLastCDPPort()
      if (typeof dyn === 'number' && dyn > 0 && dyn !== port) {
        port = dyn
      }
    } catch {
      // Ignore
    }

    const isDebuggingEnabled = await checkChromeRemoteDebugging(port)

    if (isDebuggingEnabled) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.chromeRemoteDebuggingReady())
      }
      return
    }

    retries++

    if (retries % 10 === 0 && process.env.EXTENSION_ENV === 'development') {
      console.log(
        messages.sourceInspectorChromeNotReadyYet(retries, maxRetries)
      )
    }

    await new Promise((resolve) => setTimeout(resolve, backoffMs))
  }

  throw new Error(messages.sourceInspectorChromeDebuggingRequired(port))
}
