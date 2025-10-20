import {CDPClient} from './cdp-client'

export async function enableRuntimeAndLog(
  cdp: CDPClient,
  sessionId?: string
): Promise<void> {
  try {
    await cdp.sendCommand('Runtime.enable', {}, sessionId)
  } catch {
    // ignore
  }

  try {
    await cdp.sendCommand('Log.enable', {}, sessionId)
  } catch {
    // ignore
  }
}
