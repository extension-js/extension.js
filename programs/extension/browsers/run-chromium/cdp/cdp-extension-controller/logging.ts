// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as messages from '../../../browsers-lib/messages'
import type {BrowserLogSink} from '../../../browsers-types'
import type {
  CdpProtocolMessage,
  CdpProtocolParams,
  CdpTargetInfo
} from '../../chromium-types'
import type {CDPClient} from '../cdp-client'

// Map CDP Log.LogEntry levels ('verbose' | 'info' | 'warning' | 'error')
// onto the log pipeline's level vocabulary.
function toSinkLevel(
  level: string
): 'log' | 'info' | 'warn' | 'error' | 'debug' {
  switch (level) {
    case 'verbose':
      return 'debug'
    case 'info':
      return 'info'
    case 'warning':
      return 'warn'
    case 'error':
      return 'error'
    default:
      return 'log'
  }
}

// Auto-enable Runtime/Log domains for attached
// extension sessions, and emit unified CDP log lines.
export function registerAutoEnableLogging(
  cdp: CDPClient,
  getExtensionId: () => string | null,
  logSink?: BrowserLogSink
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

        // Browser-generated entries (alarm clamps, CSP refusals, deprecations)
        // never pass through the page's console hook, so the SW producer can't
        // report them; route them to the host's log pipeline here. Console-API
        // events are NOT routed: the in-extension producer already ingests
        // those, and doubling them would duplicate every console line.
        if (logSink && message.method === 'Log.entryAdded') {
          const entry = message.params?.entry || {}
          logSink({
            level: toSinkLevel(String(entry.level || '')),
            text: String(entry.text || ''),
            source: entry.source,
            url: entry.url,
            lineNumber: entry.lineNumber,
            timestamp: entry.timestamp
          })
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
