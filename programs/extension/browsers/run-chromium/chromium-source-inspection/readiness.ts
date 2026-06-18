// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {resolvePortForInstance} from '../../browsers-lib/instance-registry'
import * as messages from '../../browsers-lib/messages'
import {checkChromeRemoteDebugging} from './discovery'

export async function waitForChromeRemoteDebugging(
  port: number,
  instanceId?: string
): Promise<void> {
  // First attempt: prefer this instance's registered CDP port, but never another
  // instance's. `port` is the caller's own per-instance derived default, so it is
  // a safe fallback when this instance hasn't registered yet or the id is absent.
  try {
    const fromRegistry = resolvePortForInstance(instanceId, 'cdp', port)

    if (typeof fromRegistry === 'number' && fromRegistry > 0) {
      port = fromRegistry
    }
  } catch {
    // Ignore
  }

  if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
    console.log(messages.sourceInspectorWaitingForChrome())
  }

  let retries = 0
  const maxRetries = 60
  const backoffMs = 500

  while (retries < maxRetries) {
    // On each retry, re-check the registry in case the
    // launcher registered a port after we started waiting
    try {
      const dyn = resolvePortForInstance(instanceId, 'cdp', port)
      if (typeof dyn === 'number' && dyn > 0 && dyn !== port) {
        port = dyn
      }
    } catch {
      // Ignore
    }

    const isDebuggingEnabled = await checkChromeRemoteDebugging(port)

    if (isDebuggingEnabled) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(messages.chromeRemoteDebuggingReady())
      }
      return
    }

    retries++

    if (retries % 10 === 0 && process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(
        messages.sourceInspectorChromeNotReadyYet(retries, maxRetries)
      )
    }

    await new Promise((resolve) => setTimeout(resolve, backoffMs))
  }

  throw new Error(messages.sourceInspectorChromeDebuggingRequired(port))
}
