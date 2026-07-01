// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {CDPClient} from '../cdp-client'
import type {
  CdpProtocolMessage,
  CdpProtocolParams,
  CdpTargetInfo
} from '../../chromium-types'
import * as messages from '../../../browsers-lib/messages'

// Auto-enable Runtime/Log domains for attached
// extension sessions, and emit unified CDP log lines.
export function registerAutoEnableLogging(
  cdp: CDPClient,
  getExtensionId: () => string | null
) {
  cdp.onProtocolEvent((message: CdpProtocolMessage) => {
    try {
      if (!message || !message.method) return

      if (message.method === 'Target.attachedToTarget') {
        const params: CdpProtocolParams = message.params || {}
        const targetInfo: CdpTargetInfo = params.targetInfo || {}
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
        message.method === 'Runtime.consoleAPICalled' ||
        message.method === 'Log.entryAdded'
      ) {
        // Only print unified CDP logs when user has enabled verbose output
        if (String(process.env.EXTENSION_VERBOSE || '').trim() === '1') {
          const ts = new Date().toISOString()
          console.log(messages.cdpUnifiedExtensionLog(ts, message.params))
        }
      }
    } catch (error: unknown) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.warn(
          messages.cdpProtocolEventHandlerError(
            String((error as Error)?.message || error)
          )
        )
      }
    }
  })
}
