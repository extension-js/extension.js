// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {CdpProtocolMessage, CdpTargetInfo} from '../../chromium-types'
import type {CDPClient} from '../cdp-client'

// Target types the extension itself runs code in. Pages (popup, options,
// sidebar) join only for unified logging, which asks for them explicitly.
const WORKER_TYPES = new Set([
  'service_worker',
  'background_page',
  'worker',
  'shared_worker'
])

export function isExtensionOwnedUrl(url: string, extensionId: string) {
  return url.startsWith(`chrome-extension://${extensionId}/`)
}

export interface ExtensionTargetAttacher {
  // Attach every target the extension owns that is not attached yet. Called
  // once the extension id is known, and again when a flavor of target joins.
  attachOwned(opts?: {pages?: boolean}): Promise<void>
}

// Attach the extension's own targets one by one from Target.targetCreated,
// never through Target.setAutoAttach. A browser-level auto-attach makes a
// page's window.open block for as long as any client holds that page, and it
// hands the engine every site's service worker on the way.
export function registerExtensionTargetAttach(
  cdp: CDPClient,
  getExtensionId: () => string | null
): ExtensionTargetAttacher {
  const attached = new Set<string>()
  const parked = new Map<string, CdpTargetInfo>()
  let includePages = false

  function eligibleType(type: string) {
    return WORKER_TYPES.has(type) || (includePages && type === 'page')
  }

  async function attach(info: CdpTargetInfo) {
    const targetId = String(info.targetId || '')
    if (!targetId || attached.has(targetId)) return

    attached.add(targetId)
    parked.delete(targetId)

    try {
      const sessionId = await cdp.attachToTarget(targetId)
      if (!sessionId) attached.delete(targetId)
    } catch {
      attached.delete(targetId)
    }
  }

  function consider(info: CdpTargetInfo) {
    const targetId = String(info.targetId || '')
    const url = String(info.url || '')
    const type = String(info.type || '')
    if (!targetId || !url.startsWith('chrome-extension://')) return

    const extensionId = getExtensionId()

    if (!extensionId) {
      // The id is derived a moment after connect; keep what might be ours.
      if (eligibleType(type)) parked.set(targetId, info)

      return
    }

    if (eligibleType(type) && isExtensionOwnedUrl(url, extensionId)) {
      void attach(info)
    }
  }

  cdp.onProtocolEvent((message: CdpProtocolMessage) => {
    try {
      if (!message || !message.method) return

      if (
        message.method === 'Target.targetCreated' ||
        message.method === 'Target.targetInfoChanged'
      ) {
        consider(message.params?.targetInfo || {})
      } else if (message.method === 'Target.targetDestroyed') {
        const targetId = String(message.params?.targetId || '')
        attached.delete(targetId)
        parked.delete(targetId)
      }
    } catch {
      // Ignore
    }
  })

  return {
    async attachOwned(opts) {
      if (opts?.pages) includePages = true

      const extensionId = getExtensionId()
      if (!extensionId) return

      const candidates = new Map<string, CdpTargetInfo>(parked)
      parked.clear()

      try {
        for (const info of await cdp.getTargets()) {
          const targetId = String(info?.targetId || '')
          if (targetId) candidates.set(targetId, info)
        }
      } catch {
        // Ignore
      }

      for (const info of candidates.values()) {
        const url = String(info.url || '')
        const type = String(info.type || '')

        if (eligibleType(type) && isExtensionOwnedUrl(url, extensionId)) {
          await attach(info)
        }
      }
    }
  }
}
