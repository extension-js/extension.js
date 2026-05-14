import {initManagerUI} from './manager-ui'
import {appendExternalLog} from './log-central'

type ResolveIconMessage = {
  type: 'resolve-icon-url'
  url: string
}

type GetDxStatusMessage = {
  type: 'get-dx-status'
}

type DxSignalMessage = {
  type: 'dx-signal'
  level?: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace'
  context?: 'background' | 'content' | 'page' | 'sidebar' | 'popup' | 'options' | 'devtools'
  eventType?: 'log' | 'dx.signal'
  code?: string
  status?: 'ok' | 'warn' | 'fail'
  data?: Record<string, unknown>
  remediation?: string
  messageParts?: unknown[]
  url?: string
  stack?: string
  errorName?: string
}

type DxStatusResponse = {
  ok: true
  extensionEnabled: boolean | null
  extensionName?: string
  extensionId?: string
}

type KnownMessage = ResolveIconMessage | GetDxStatusMessage | DxSignalMessage

function isBuiltInExtension(extension: chrome.management.ExtensionInfo) {
  const name = String(extension.name || '').toLowerCase()
  return (
    name.includes('extension.js built-in developer tools') ||
    name.includes('extension.js theme')
  )
}

async function getUserDevExtensionStatus(): Promise<DxStatusResponse> {
  const allExtensions = (await new Promise((resolve) => {
    chrome.management.getAll(resolve)
  })) as chrome.management.ExtensionInfo[]

  const candidates = (allExtensions || []).filter((extension) => {
    return (
      extension.id !== chrome.runtime.id &&
      extension.id !== 'igcijhgmihmjbbahdabahfbpffalcfnn' &&
      extension.installType === 'development' &&
      extension.type !== 'theme' &&
      !isBuiltInExtension(extension)
    )
  })

  if (candidates.length === 0) {
    return {ok: true, extensionEnabled: null}
  }

  const preferred =
    candidates.find((extension) => extension.enabled) ||
    candidates[candidates.length - 1]

  return {
    ok: true,
    extensionEnabled: Boolean(preferred?.enabled),
    extensionName: preferred?.name,
    extensionId: preferred?.id
  }
}

function isAllowedIconUrl(rawUrl: string) {
  if (rawUrl.startsWith('data:')) return true
  try {
    const parsed = new URL(rawUrl)
    return (
      parsed.protocol === 'moz-extension:' ||
      parsed.protocol === 'chrome-extension:'
    )
  } catch {
    return false
  }
}

async function fetchIconAsDataUrl(rawUrl: string) {
  if (rawUrl.startsWith('data:')) return rawUrl

  const response = await fetch(rawUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch icon: ${response.status}`)
  }

  const blob = await response.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Failed to read icon blob'))
    reader.readAsDataURL(blob)
  })
}

chrome.runtime.onMessage.addListener(
  (message: KnownMessage, sender, sendResponse) => {
    if (sender?.id && sender.id !== chrome.runtime.id) return
    if (!message) return

    if (message.type === 'resolve-icon-url') {
      if (!message.url || !isAllowedIconUrl(message.url)) {
        sendResponse({ok: false, error: 'Unsupported icon URL'})
        return
      }

      fetchIconAsDataUrl(message.url)
        .then((dataUrl) => sendResponse({ok: true, dataUrl}))
        .catch((error) => sendResponse({ok: false, error: String(error)}))

      return true
    }

    if (message.type === 'get-dx-status') {
      getUserDevExtensionStatus()
        .then((payload) => sendResponse(payload))
        .catch((error) =>
          sendResponse({ok: false, error: String(error || 'Unknown error')})
        )
      return true
    }

    if (message.type === 'dx-signal') {
      try {
        appendExternalLog({
          level: message.level || 'info',
          context: message.context || 'content',
          messageParts:
            Array.isArray(message.messageParts) && message.messageParts.length > 0
              ? message.messageParts
              : [message.code || 'DX_SIGNAL'],
          eventType: message.eventType || 'dx.signal',
          code: message.code,
          status: message.status,
          data: message.data,
          remediation: message.remediation,
          url: typeof message.url === 'string' ? message.url : undefined,
          stack: typeof message.stack === 'string' ? message.stack : undefined,
          errorName:
            typeof message.errorName === 'string' ? message.errorName : undefined
        })
        sendResponse({ok: true})
      } catch (error) {
        sendResponse({ok: false, error: String(error || 'Unknown error')})
      }
      return true
    }
  }
)

chrome.runtime.onStartup.addListener(async () => {
  await initManagerUI()
})

chrome.runtime.onInstalled.addListener(async () => {
  await initManagerUI()
})

// Broadcast reload-state pings to the content-script overlay so the floating
// pill can render a "Reloading…" indicator while the user's unpacked
// extension is cycling. Chrome's `chrome.runtime.reload()` (which the
// Extension.js SDK fires on file edits) flips the target extension through
// onDisabled → onEnabled, so we hook both and rebroadcast to every tab.
function isUserDevExtensionForReload(
  info: chrome.management.ExtensionInfo
): boolean {
  if (!info) return false
  if (info.id === chrome.runtime.id) return false
  if (info.installType !== 'development') return false
  if (info.type === 'theme') return false
  return !isBuiltInExtension(info)
}

function broadcastReloadState(state: 'reloading' | 'reloaded') {
  try {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs || []) {
        if (typeof tab.id !== 'number') continue
        try {
          chrome.tabs
            .sendMessage(tab.id, {type: 'extjs-dev-reload', state})
            .catch(() => {
              // Tab has no listener — ignore (most pages won't host the overlay).
            })
        } catch {
          // Older Chrome may throw synchronously; nothing to do.
        }
      }
    })
  } catch {
    // chrome.tabs may be unavailable in odd contexts; ignore.
  }
}

if (typeof chrome.management?.onDisabled?.addListener === 'function') {
  chrome.management.onDisabled.addListener((info) => {
    if (!isUserDevExtensionForReload(info)) return
    broadcastReloadState('reloading')
  })
}

if (typeof chrome.management?.onEnabled?.addListener === 'function') {
  chrome.management.onEnabled.addListener((info) => {
    if (!isUserDevExtensionForReload(info)) return
    broadcastReloadState('reloaded')
  })
}

if (typeof chrome.management?.onInstalled?.addListener === 'function') {
  // Reloaded unpacked extensions fire onInstalled with reason=update without
  // necessarily flipping onDisabled first. Treat that as a "reloaded" event
  // so the pill clears its spinner even on the install-only path.
  chrome.management.onInstalled.addListener((info) => {
    if (!isUserDevExtensionForReload(info)) return
    broadcastReloadState('reloaded')
  })
}
