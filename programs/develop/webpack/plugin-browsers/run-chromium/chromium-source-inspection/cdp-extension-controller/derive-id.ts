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
  // Read manifest metadata to help disambiguate extension targets
  let expectedName: string | undefined
  let expectedVersion: string | undefined
  let expectedManifestVersion: number | undefined
  let expectedNameIsMsg = false
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(outPath, 'manifest.json'), 'utf-8')
    )
    expectedName = manifest?.name
    expectedVersion = manifest?.version
    expectedManifestVersion = manifest?.manifest_version
    expectedNameIsMsg =
      typeof expectedName === 'string' && /__MSG_/i.test(expectedName)

    if (expectedNameIsMsg) {
      const defaultLocale = String(manifest?.default_locale || '').trim()
      const msgKeyMatch = String(expectedName || '').match(/__MSG_([^_]+)__/i)
      const msgKey = msgKeyMatch ? msgKeyMatch[1] : ''

      if (defaultLocale && msgKey) {
        try {
          const messagesPath = path.join(
            outPath,
            '_locales',
            defaultLocale,
            'messages.json'
          )
          if (fs.existsSync(messagesPath)) {
            const messagesJson = JSON.parse(
              fs.readFileSync(messagesPath, 'utf-8')
            )
            const resolved = String(
              messagesJson?.[msgKey]?.message || ''
            ).trim()
            if (resolved) {
              expectedName = resolved
              expectedNameIsMsg = false
            }
          }
        } catch {
          // Ignore
        }
      }
    }
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
          const gotVersion = String(info?.version || '')
          const gotManifestVersion = Number(info?.manifestVersion || 0)

          const nameMatches =
            expectedName && !expectedNameIsMsg
              ? gotName === expectedName
              : false
          const versionMatches = expectedVersion
            ? gotVersion === expectedVersion
            : false
          const manifestVersionMatches = expectedManifestVersion
            ? gotManifestVersion === expectedManifestVersion
            : false

          if (nameMatches) return id

          if (
            expectedVersion &&
            versionMatches &&
            (expectedManifestVersion ? manifestVersionMatches : true)
          ) {
            return id
          }
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
