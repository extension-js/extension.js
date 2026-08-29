// ██████╗ ███████╗██╗   ██╗████████╗ ██████╗  ██████╗ ██╗     ███████╗
// ██╔══██╗██╔════╝██║   ██║╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝
// ██║  ██║█████╗  ██║   ██║   ██║   ██║   ██║██║   ██║██║     ███████╗
// ██║  ██║██╔══╝  ╚██╗ ██╔╝   ██║   ██║   ██║██║   ██║██║     ╚════██║
// ██████╔╝███████╗ ╚████╔╝    ██║   ╚██████╔╝╚██████╔╝███████╗███████║
// ╚═════╝ ╚══════╝  ╚═══╝     ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export const OVERLAY_ENABLED_KEY = 'overlay_enabled'

export async function getOverlayEnabled(): Promise<boolean> {
  try {
    const result = await new Promise<Record<string, unknown>>((resolve) => {
      chrome.storage.local.get(OVERLAY_ENABLED_KEY, (items) => resolve(items))
    })
    // A missing key means the user never opted out, keep the overlay on.
    return result?.[OVERLAY_ENABLED_KEY] !== false
  } catch {
    return true
  }
}

export function setOverlayEnabled(enabled: boolean) {
  try {
    chrome.storage.local.set({[OVERLAY_ENABLED_KEY]: enabled})
  } catch {
    // Ignore
  }
}

export function onOverlayEnabledChanged(
  callback: (enabled: boolean) => void
): () => void {
  const listener = (
    changes: {[key: string]: chrome.storage.StorageChange},
    areaName: string
  ) => {
    if (areaName !== 'local') return
    const change = changes[OVERLAY_ENABLED_KEY]
    if (!change) return
    callback(change.newValue !== false)
  }

  try {
    chrome.storage.onChanged.addListener(listener)
  } catch {
    // Ignore
  }

  return () => {
    try {
      chrome.storage.onChanged.removeListener(listener)
    } catch {
      // Ignore
    }
  }
}
