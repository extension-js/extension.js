import {initManagerUI} from './manager-ui'

type ResolveIconMessage = {
  type: 'resolve-icon-url'
  url: string
}

type GetDxStatusMessage = {
  type: 'get-dx-status'
}

type DxStatusResponse = {
  ok: true
  extensionEnabled: boolean | null
  extensionName?: string
  extensionId?: string
}

type KnownMessage = ResolveIconMessage | GetDxStatusMessage

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
  }
)

chrome.runtime.onStartup.addListener(async () => {
  await initManagerUI()
})

chrome.runtime.onInstalled.addListener(async () => {
  await initManagerUI()
})
