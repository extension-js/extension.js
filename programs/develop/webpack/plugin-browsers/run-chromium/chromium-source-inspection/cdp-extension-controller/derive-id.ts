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
  maxRetries = 6,
  backoffMs = 150,
  profilePath?: string,
  extensionPaths?: string[]
): Promise<string | null> {
  // Read manifest metadata to disambiguate when multiple extensions are loaded.
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

    // Resolve localized extension names to avoid false negatives when comparing names.
    if (expectedNameIsMsg) {
      const defaultLocale = String(manifest?.default_locale || '').trim()
      const msgKeyMatch = String(expectedName || '').match(/__MSG_(.+)__/i)
      const msgKey = msgKeyMatch ? msgKeyMatch[1] : ''

      if (defaultLocale && msgKey) {
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
          const resolved = String(messagesJson?.[msgKey]?.message || '').trim()
          if (resolved) {
            expectedName = resolved
            expectedNameIsMsg = false
          }
        }
      }
    }
  } catch {
    // Ignore best-effort manifest introspection.
  }

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

  let retries = 0
  let deferredFirstEvalId: string | null = null
  let deferredUrlDerivedId: string | null = null
  const hasExpectedManifestIdentity = Boolean(
    expectedName || expectedVersion || expectedManifestVersion
  )

  while (retries <= maxRetries) {
    try {
      const targets = await cdp.getTargets()
      const profileCandidateId = deriveFromProfile()

      // 1) Try to derive from extension background/service worker contexts
      let firstEvalId: string | null = null
      let evalIdCount = 0
      let urlDerivedId: string | null = null

      for (const t of targets || []) {
        const url: string = String((t as any)?.url || '')
        const type: string = String((t as any)?.type || '')

        const typeOk = ['service_worker', 'background_page', 'worker'].includes(
          type
        )

        if (!typeOk) continue
        const urlMatch = url.match(/^chrome-extension:\/\/([^\/]+)/)

        if (!urlDerivedId && urlMatch?.[1]) {
          urlDerivedId = String(urlMatch[1])
        }
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
          if (profileCandidateId && id === profileCandidateId) return id

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

          if (nameMatches && (!profileCandidateId || id === profileCandidateId))
            return id

          if (
            expectedVersion &&
            versionMatches &&
            (expectedManifestVersion ? manifestVersionMatches : true) &&
            (!profileCandidateId || id === profileCandidateId)
          ) {
            return id
          }
        } catch {
          // Ignore
        }
      }

      // With exactly one viable extension runtime, use it.
      if (evalIdCount === 1 && firstEvalId) {
        if (!hasExpectedManifestIdentity) {
          return firstEvalId
        }

        deferredFirstEvalId = deferredFirstEvalId || firstEvalId
      }

      if (profileCandidateId) {
        return profileCandidateId
      }

      // Best-effort fallback if evaluation is blocked but URL is available.
      if (urlDerivedId) {
        if (!hasExpectedManifestIdentity) {
          return urlDerivedId
        }

        deferredUrlDerivedId = deferredUrlDerivedId || urlDerivedId
      }
    } catch {
      // Ignore
    }

    await new Promise((r) => setTimeout(r, backoffMs))
    retries++
  }

  // Last-resort fallback after retries: prefer profile/path identity, then
  // evaluated runtime ID, then URL-derived ID.
  return deriveFromProfile() || deferredFirstEvalId || deferredUrlDerivedId
}
