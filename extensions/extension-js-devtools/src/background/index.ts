import {initManagerUI} from './manager-ui'

type ResolveIconMessage = {
  type: 'resolve-icon-url'
  url: string
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
  (message: ResolveIconMessage, sender, sendResponse) => {
    if (sender?.id && sender.id !== chrome.runtime.id) return
    if (!message || message.type !== 'resolve-icon-url') return
    if (!message.url || !isAllowedIconUrl(message.url)) {
      sendResponse({ok: false, error: 'Unsupported icon URL'})
      return
    }

    fetchIconAsDataUrl(message.url)
      .then((dataUrl) => sendResponse({ok: true, dataUrl}))
      .catch((error) => sendResponse({ok: false, error: String(error)}))

    return true
  }
)

chrome.runtime.onStartup.addListener(async () => {
  await initManagerUI()
})

chrome.runtime.onInstalled.addListener(async () => {
  await initManagerUI()
})
