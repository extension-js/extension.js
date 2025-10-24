import {initManagerUI} from './manager-ui'
import {appendExternalLog} from './log-central'
import {type LogLevel} from '@/types/logger'

chrome.runtime.onStartup.addListener(async () => {
  await initManagerUI()
})

chrome.runtime.onInstalled.addListener(async () => {
  await initManagerUI()
})

// Optional: capture page logs via chrome.debugger
// (no user content injection required)
const ATTACHED: Set<number> = new Set()

chrome.tabs.onUpdated.addListener(
  async (tabId: number, info: chrome.tabs.TabChangeInfo) => {
    if (info.status !== 'complete') return
    if (ATTACHED.has(tabId)) return

    // Only available in Chromium. Guard on Firefox
    // @ts-ignore
    const isFirefox = import.meta.env.EXTENSION_BROWSER === 'firefox'

    if (isFirefox) return

    await chrome.debugger.attach({tabId}, '1.3')
    ATTACHED.add(tabId)
    await chrome.debugger.sendCommand({tabId}, 'Runtime.enable')
    await chrome.debugger.sendCommand({tabId}, 'Log.enable')
    // Enable network to observe 404/failed requests
    await chrome.debugger.sendCommand({tabId}, 'Network.enable')
  }
)

chrome.tabs.onRemoved.addListener((tabId: number) => {
  if (!ATTACHED.has(tabId)) return

  // Only available in Chromium. Guard on Firefox
  // @ts-ignore
  const isFirefox = import.meta.env.EXTENSION_BROWSER === 'firefox'
  if (!isFirefox) {
    chrome.debugger.detach({tabId})
  }
  ATTACHED.delete(tabId)
})

type DebuggerTarget = {tabId?: number}
type ConsoleAPICalledParams = {
  type?: string
  args?: Array<{value?: unknown; description?: string}>
  stackTrace?: {callFrames?: Array<{url?: string}>}
}
type LogEntryAddedParams = {
  entry?: {level?: string; text?: string; url?: string}
}
type NetworkResponseReceivedParams = {
  response?: {status?: number; url?: string}
}
type NetworkLoadingFailedParams = {
  requestId?: string
  errorText?: string
}

// Guard listener registration where debugger api exists
if (
  typeof chrome?.debugger !== 'undefined' &&
  chrome.debugger?.onEvent?.addListener
) {
  chrome.debugger.onEvent.addListener(
    (
      target: DebuggerTarget,
      method: string,
      params:
        | ConsoleAPICalledParams
        | LogEntryAddedParams
        | NetworkResponseReceivedParams
        | NetworkLoadingFailedParams
        | undefined
    ) => {
      const tabId = target?.tabId
      if (!tabId) return

      if (method === 'Runtime.consoleAPICalled') {
        const p = params as ConsoleAPICalledParams
        const type = (p.type ?? 'log').toLowerCase()
        const args = p.args ?? []
        const text = String(args[0]?.value ?? args[0]?.description ?? '')
        const loc = p.stackTrace?.callFrames?.[0]
        const url = String(loc?.url ?? '')

        appendExternalLog({
          level: type as LogLevel,
          context: 'page',
          messageParts: [text],
          url,
          tabId
        })
      } else if (method === 'Log.entryAdded') {
        const p = params as LogEntryAddedParams
        const entry = p.entry ?? {}

        appendExternalLog({
          level: String(entry.level ?? 'info') as LogLevel,
          context: 'page',
          messageParts: [String(entry.text ?? '')],
          url: String(entry.url ?? ''),
          tabId
        })
      } else if (method === 'Network.responseReceived') {
        // Capture 404 responses
        const p = params as NetworkResponseReceivedParams
        const resp = p.response ?? {}
        const status = Number(resp.status ?? 0)
        const url = String(resp.url ?? '')

        if (status >= 400) {
          appendExternalLog({
            level: 'error',
            context: 'page',
            messageParts: [`HTTP ${status}: ${url}`],
            url,
            tabId
          })
        }
      } else if (method === 'Network.loadingFailed') {
        const p = params as NetworkLoadingFailedParams
        // requestId may not be URL, best effort
        const url = String(p.requestId ?? '')
        const errorText = String(p.errorText ?? 'request failed')

        appendExternalLog({
          level: 'error',
          context: 'page',
          messageParts: [errorText],
          url,
          tabId
        })
      }
    }
  )
}

// WebRequest capture for 4xx/5xx and errors
chrome.webRequest.onCompleted.addListener(
  (details: chrome.webRequest.WebResponseCacheDetails) => {
    const status = Number(details.statusCode ?? 0)
    const url = String(details.url ?? '')

    if (status >= 400) {
      appendExternalLog({
        level: 'error',
        context: 'page',
        messageParts: [`HTTP ${status}: ${url}`],
        url,
        tabId: details.tabId
      })
    }
  },
  {urls: ['<all_urls>']}
)

chrome.webRequest.onErrorOccurred.addListener(
  (details: chrome.webRequest.WebResponseErrorDetails) => {
    const url = String(details.url ?? '')
    const errorText = String(details.error ?? 'request failed')

    appendExternalLog({
      level: 'error',
      context: 'page',
      messageParts: [errorText, url],
      url,
      tabId: details.tabId
    })
  },
  {urls: ['<all_urls>']}
)
