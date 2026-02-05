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
  backoffMs = 200,
  profilePath?: string,
  extensionPaths?: string[]
): Promise<string | null> {
  // Read manifest metadata to help disambiguate extension targets
  let expectedName: string | undefined
  let expectedVersion: string | undefined
  let expectedManifestVersion: number | undefined
  let expectedNameIsMsg = false
  const trimTrailingSep = (p: string) => p.replace(/[\\\/]+$/g, '')
  const normalizePath = (p: string) => {
    try {
      const resolved = path.resolve(p)
      if (fs.existsSync(resolved)) {
        return trimTrailingSep(fs.realpathSync(resolved))
      }
      return trimTrailingSep(resolved)
    } catch {
      return trimTrailingSep(path.resolve(p))
    }
  }
  const resolvedOutPath = normalizePath(outPath)
  const normalizedCandidates = Array.isArray(extensionPaths)
    ? extensionPaths.map((p) => (p ? normalizePath(p) : '')).filter(Boolean)
    : []
  const resolvedCandidates = normalizedCandidates.length
    ? normalizedCandidates
    : [resolvedOutPath]
  const platformIsCaseInsensitive =
    process.platform === 'win32' || process.platform === 'darwin'
  const normalizeForCompare = (p: string) =>
    platformIsCaseInsensitive ? p.toLowerCase() : p
  const matchesAnyCandidate = (p: string) => {
    const n = normalizeForCompare(p)
    return resolvedCandidates.some(
      (candidate) => n === normalizeForCompare(candidate)
    )
  }
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

  const deriveFromProfile = () => {
    if (!profilePath) return null

    const candidates: string[] = []

    const pushPrefIfExists = (dir: string) => {
      const prefPath = path.join(dir, 'Preferences')
      if (fs.existsSync(prefPath)) candidates.push(prefPath)
    }

    try {
      pushPrefIfExists(profilePath)
      pushPrefIfExists(path.join(profilePath, 'Default'))
      const entries = fs.readdirSync(profilePath)
      for (const entry of entries) {
        if (!/^Profile\s+\d+$/i.test(entry)) continue
        pushPrefIfExists(path.join(profilePath, entry))
      }
    } catch {
      // Ignore
    }

    for (const prefPath of candidates) {
      try {
        if (!fs.existsSync(prefPath)) continue
        const prefs = JSON.parse(fs.readFileSync(prefPath, 'utf-8'))
        const settings = prefs?.extensions?.settings
        if (!settings || typeof settings !== 'object') continue

        const entries = Object.entries(settings) as Array<
          [
            string,
            {path?: string; manifest?: {name?: string; version?: string}}
          ]
        >

        let fallbackId: string | null = null

        for (const [id, info] of entries) {
          const storedPath = String(info?.path || '')
          if (!storedPath) continue
          const normalized = normalizePath(storedPath)

          if (!matchesAnyCandidate(normalized)) continue

          const manifestName = String(info?.manifest?.name || '')
          const manifestVersion = String(info?.manifest?.version || '')

          if (expectedName && manifestName === expectedName) return id
          if (expectedVersion && manifestVersion === expectedVersion) return id

          fallbackId = id
        }

        if (fallbackId) return fallbackId
      } catch {
        // Ignore
      }
    }
    return null
  }

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

    const profileId = deriveFromProfile()
    if (profileId) return profileId

    await new Promise((r) => setTimeout(r, backoffMs))
    retries++
  }

  return null
}
