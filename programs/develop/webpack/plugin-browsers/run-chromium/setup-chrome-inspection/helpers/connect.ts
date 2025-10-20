import {CDPClient} from '../cdp-client'
import {checkChromeRemoteDebugging} from '../discovery'
import * as messages from '../../../browsers-lib/messages'

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

  const cdp = new CDPClient(cdpPort, '127.0.0.1')
  await cdp.connect()

  try {
    await cdp.sendCommand('Target.setDiscoverTargets', {discover: true})
    await cdp.sendCommand('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true
    })
  } catch (error: unknown) {
    if (process.env.EXTENSION_ENV === 'development') {
      console.warn(
        messages.cdpAutoAttachSetupFailed(
          String((error as Error)?.message || error)
        )
      )
    }
  }

  return cdp
}
