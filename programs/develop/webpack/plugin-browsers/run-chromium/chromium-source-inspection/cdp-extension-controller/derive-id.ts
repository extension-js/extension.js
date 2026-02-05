// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {CDPClient} from '../cdp-client'

export async function deriveExtensionIdFromTargetsHelper(
  cdp: CDPClient,
  outPath: string,
  maxRetries = 20,
  backoffMs = 200
): Promise<string | null> {
  // Read manifest name to help disambiguate extension targets
  let expectedName: string | undefined
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(outPath, 'manifest.json'), 'utf-8')
    )
    expectedName = manifest?.name
  } catch {
    // Ignore
  }

  let retries = 0

  while (retries <= maxRetries) {
    try {
      const targets = await cdp.getTargets()

      // 1) Try to derive from extension background/service worker contexts
      let firstEvalId: string | null = null
      let evalIdCount = 0
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

          evalIdCount += 1
          if (!firstEvalId) firstEvalId = id

          const gotName = String(info?.name || '')
          if (expectedName && gotName === expectedName) return id
        } catch {
          // Ignore
        }
      }

      if (evalIdCount === 1 && firstEvalId) {
        return firstEvalId
      }

      // 2) Fallback to URL-based extraction
      for (const t of targets || []) {
        const url: string = String((t as any)?.url || '')
        const type: string = String((t as any)?.type || '')

        if (!url.startsWith('chrome-extension://')) continue

        const typeOk = ['service_worker', 'background_page', 'worker'].includes(
          type
        )

        if (!typeOk) continue

        const match = url.match(/^chrome-extension:\/\/([^\/]+)/)

        if (match && match[1]) return match[1]
      }
    } catch {
      // Ignore
    }

    await new Promise((r) => setTimeout(r, backoffMs))
    retries++
  }

  return null
}
