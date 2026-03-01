// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as messages from '../../../browsers-lib/messages'
import {CDPClient} from '../cdp-client'
import {checkChromeRemoteDebugging} from '../discovery'

function isRecoverableBootstrapError(error: unknown): boolean {
  const msg = String((error as Error)?.message || error || '').toLowerCase()
  return (
    msg.includes('econnreset') ||
    msg.includes('websocket is not open') ||
    msg.includes('cdp connection closed') ||
    msg.includes('socket hang up') ||
    msg.includes('timed out') ||
    msg.includes('no cdp websocket url')
  )
}

export async function connectToChromeCdp(cdpPort: number): Promise<CDPClient> {
  // Wait until Chrome opens the debugging port
  let retries = 0
  const maxRetries = 60
  const backoffMs = 250

  while (retries < maxRetries) {
    const ready = await checkChromeRemoteDebugging(cdpPort)
    if (ready) break

    retries++

    await new Promise((r) => setTimeout(r, backoffMs))
  }

  const maxBootstrapAttempts = 4
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxBootstrapAttempts; attempt++) {
    const cdp = new CDPClient(cdpPort, '127.0.0.1')

    try {
      await cdp.connect()

      // Treat discover/auto-attach as part of startup readiness. If this
      // handshake fails due to early socket churn, retry with a fresh client.
      await cdp.sendCommand('Target.setDiscoverTargets', {discover: true})
      await cdp.sendCommand('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true
      })

      return cdp
    } catch (error: unknown) {
      lastError = error
      cdp.disconnect()

      const retryable = isRecoverableBootstrapError(error)
      const hasMoreAttempts = attempt < maxBootstrapAttempts

      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        const base = String((error as Error)?.message || error)
        console.warn(
          `[CDP] bootstrap attempt ${attempt}/${maxBootstrapAttempts} failed: ${base}`
        )
      }

      if (!retryable || !hasMoreAttempts) {
        throw error
      }

      const delayMs = 120 * attempt
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Failed to bootstrap CDP connection')
}
