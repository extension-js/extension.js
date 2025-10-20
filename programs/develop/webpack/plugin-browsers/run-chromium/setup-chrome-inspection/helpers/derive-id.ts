import * as fs from 'fs'
import * as path from 'path'
import {CDPClient} from '../cdp-client'

export async function deriveExtensionIdFromTargetsHelper(
  cdp: CDPClient,
  outPath: string,
  maxRetries = 20,
  backoffMs = 200
): Promise<string | null> {
  // Read manifest name to help disambiguate service worker targets
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

      // 1) Try strict match by evaluating manifest name in SW contexts
      if (expectedName) {
        for (const t of targets || []) {
          const url: string = String((t as any)?.url || '')
          const type: string = String((t as any)?.type || '')
          if (
            !(
              type === 'service_worker' && url.startsWith('chrome-extension://')
            )
          ) {
            continue
          }

          const targetId: string | undefined = (t as any)?.targetId
          if (!targetId) continue

          try {
            const sessionId = await cdp.attachToTarget(targetId)
            if (!sessionId) continue

            await cdp.sendCommand('Runtime.enable', {}, sessionId)
            const gotName = String(
              await cdp.evaluate(
                sessionId,
                '(()=>{try{return chrome.runtime.getManifest().name}catch(_){return null}})()'
              )
            )

            if (gotName && String(gotName) === expectedName) {
              const gotIdStr = String(
                (await cdp.evaluate(
                  sessionId,
                  '(()=>{try{return chrome.runtime.id}catch(_){return null}})()'
                )) || ''
              )

              if (gotIdStr && gotIdStr.length > 0) {
                return gotIdStr
              }
            }
          } catch {
            // Ignore
          }
        }
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
