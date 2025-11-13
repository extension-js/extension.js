import type {Controller} from '../../chromium-types'
import {CDPClient} from '../cdp-client'
import * as messages from '../../../browsers-lib/messages'

export async function enableUnifiedLoggingForAllTargets(
  controller: Controller
) {
  await controller.enableUnifiedLogging({})
}

export async function enableRuntimeForAttachedTarget(
  controller: {enableRuntimeForSession: (sessionId: string) => Promise<void>},
  sessionId: string
) {
  await controller.enableRuntimeForSession(sessionId)
}

// Auto-enable Runtime/Log domains for attached
// extension sessions, and emit unified CDP log lines.
export function registerAutoEnableLogging(
  cdp: CDPClient,
  getExtensionId: () => string | null
) {
  cdp.onProtocolEvent((message: Record<string, unknown>) => {
    try {
      if (!message || !(message as any).method) return

      if ((message as any).method === 'Target.attachedToTarget') {
        const params = (message as any).params || {}
        const targetInfo = params.targetInfo || {}
        const sessionId = params.sessionId
        const url: string = String(targetInfo.url || '')
        const type: string = String(targetInfo.type || '')
        const extId = getExtensionId()
        const matchesExtension = !!(
          (extId && url.includes(`chrome-extension://${extId}/`)) ||
          type === 'service_worker'
        )

        if (sessionId && matchesExtension) {
          // Enable runtime and log domains for this session
          cdp.sendCommand('Runtime.enable', {}, sessionId).catch(() => {})
          cdp.sendCommand('Log.enable', {}, sessionId).catch(() => {})
        }
      } else if (
        (message as any).method === 'Runtime.consoleAPICalled' ||
        (message as any).method === 'Log.entryAdded'
      ) {
        // Only print unified CDP logs when user has enabled verbose output
        if (String(process.env.EXTENSION_VERBOSE || '').trim() === '1') {
          const ts = new Date().toISOString()
          console.log(
            messages.cdpUnifiedExtensionLog(ts, (message as any).params)
          )
        }
      }
    } catch (error: unknown) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.warn(
          messages.cdpProtocolEventHandlerError(
            String((error as Error)?.message || error)
          )
        )
      }
    }
  })
}
