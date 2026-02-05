// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {CDPClient} from '../cdp-client'

export async function deriveExtensionIdFromTargetsHelper(
  cdp: CDPClient,
  outPath: string,
  maxRetries = 6,
  backoffMs = 150
): Promise<string | null> {
  let retries = 0

  while (retries <= maxRetries) {
    try {
      const targets = await cdp.getTargets()

      // 1) Try to derive from extension background/service worker contexts
      for (const t of targets || []) {
        const url: string = String((t as any)?.url || '')
        const type: string = String((t as any)?.type || '')

        const typeOk = ['service_worker', 'background_page', 'worker'].includes(
          type
        )

        if (!typeOk) continue
        if (url && !url.startsWith('chrome-extension://')) continue

        const targetId: string | undefined = (t as any)?.targetId
        if (!targetId) continue

        try {
          const sessionId = await cdp.attachToTarget(targetId)
          if (!sessionId) continue

          await cdp.sendCommand('Runtime.enable', {}, sessionId)

          const info = (await cdp.evaluate(
            sessionId,
            '(()=>{try{const m=chrome.runtime.getManifest?.();return {id:chrome.runtime?.id||"",name:m?.name||"",version:m?.version||"",manifestVersion:m?.manifest_version||0}}catch(_){return null}})()'
          )) as {
            id?: string
            name?: string
            version?: string
            manifestVersion?: number
          } | null

          const id = String(info?.id || '').trim()
          if (!id) continue

          return id
        } catch {
          // Ignore
        }
      }
    } catch {
      // Ignore
    }

    await new Promise((r) => setTimeout(r, backoffMs))
    retries++
  }

  return null
}
