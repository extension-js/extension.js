// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {findUndefinedMsgReferences} from '../../helpers/msg-placeholders'

// Manifest shapes Chromium refuses to load AT ALL surface only as a native
// dialog, never a console error; diagnose before spawn and say why.
export type ChromiumManifestRefusal =
  | 'mv2'
  | 'unsupported-manifest-version'
  | null

// Shapes Chrome 151 was measured to load, with an id and no warning, while
// doing less than the manifest asks for.
export type ChromiumManifestCaveat =
  | 'background-scripts-not-run'
  | 'manifest-version-above-3'

// Manifests under diagnosis are arbitrary user JSON; every access is
// runtime-guarded.
// biome-ignore lint/suspicious/noExplicitAny: dynamic manifest JSON diagnostics boundary
type LooseManifest = any

function isManifestObject(manifest: unknown): manifest is LooseManifest {
  return (
    Boolean(manifest) &&
    typeof manifest === 'object' &&
    !Array.isArray(manifest)
  )
}

// Chrome 151 takes the integer 2 and any integer from 3 up. A missing key, a
// string such as "3", a fraction and anything below 2 are refused.
export function diagnoseChromiumManifestRefusal(
  manifest: unknown
): ChromiumManifestRefusal {
  if (!isManifestObject(manifest)) return null

  const version = manifest.manifest_version

  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return 'unsupported-manifest-version'
  }

  // Chromium reads any manifest with a theme key as a theme, and it still
  // installs a Manifest V2 theme, so only an extension manifest is flagged.
  if (version === 2) {
    return manifest.theme && typeof manifest.theme === 'object' ? null : 'mv2'
  }

  return version < 2 ? 'unsupported-manifest-version' : null
}

// What a manifest Chromium loads still gets wrong. Never a refusal: the
// browser assigns an id, and the launch goes on.
export function findChromiumManifestCaveats(
  manifest: unknown
): ChromiumManifestCaveat[] {
  if (!isManifestObject(manifest)) return []

  const version = manifest.manifest_version

  if (typeof version !== 'number' || !Number.isInteger(version)) return []
  if (version < 3) return []

  const caveats: ChromiumManifestCaveat[] = []

  if (version > 3) caveats.push('manifest-version-above-3')

  // Firefox-style background: from Manifest V3 on Chromium runs a service
  // worker only, so these scripts load with the extension and never start.
  if (
    Array.isArray(manifest.background?.scripts) &&
    manifest.background.scripts.length > 0 &&
    !manifest.background?.service_worker
  ) {
    caveats.push('background-scripts-not-run')
  }

  return caveats
}

// Microsoft deprecated Manifest V2 and Edge still loads and runs one unpacked,
// so on Edge the manifest is a deprecation and not a refusal.
export function chromiumStillRunsManifestV2(browser: string): boolean {
  return browser === 'edge'
}

// What the launcher owes a Manifest V2 guest. The build of a dev or start
// session already printed the verdict for its own output, so it is not said twice.
export function planManifestV2Launch(input: {
  browser: string
  builtByThisSession: boolean
}): {say: boolean; refused: boolean} {
  return {
    say: !input.builtByThisSession,
    refused: !chromiumStillRunsManifestV2(input.browser)
  }
}

// The browser's answer repeats a verdict the session already printed only when
// it is the manifest version refusal. Any other reason is new and gets its block.
export function repeatsManifestV2Refusal(
  alreadySaid: boolean | undefined,
  reason: string
): boolean {
  return Boolean(alreadySaid) && /unsupported manifest version/i.test(reason)
}

// Recorded when a refused run could not ask the browser for its own words.
export const GENERAL_REFUSAL_REASON =
  'the manifest declares a shape this browser refuses'

// Nothing rebuilds a run-only session, so a refused guest ends the run. A
// predicted refusal also ends it when the browser gave no answer at all.
export function endsRunOnlyLaunch(
  predictedRefusal: boolean,
  status: 'loaded' | 'refused' | 'unknown'
): boolean {
  return predictedRefusal ? status !== 'loaded' : status === 'refused'
}

// An invalid host wildcard in a content script or a web accessible resource
// refuses the whole extension. Chrome 151 loads one in host permissions.
export function findInvalidMatchPatterns(manifest: unknown): string[] {
  const m = manifest as Record<string, LooseManifest> | null | undefined
  const patterns: string[] = []

  for (const list of [m?.host_permissions, m?.optional_host_permissions]) {
    if (Array.isArray(list)) patterns.push(...list)
  }

  for (const contentScript of Array.isArray(m?.content_scripts)
    ? m.content_scripts
    : []) {
    for (const list of [
      contentScript?.matches,
      contentScript?.exclude_matches
    ]) {
      if (Array.isArray(list)) patterns.push(...list)
    }
  }

  for (const resource of Array.isArray(m?.web_accessible_resources)
    ? m.web_accessible_resources
    : []) {
    if (Array.isArray(resource?.matches)) patterns.push(...resource.matches)
  }

  const invalid = patterns.filter(
    (pattern): pattern is string =>
      typeof pattern === 'string' &&
      pattern !== '<all_urls>' &&
      hasInvalidHostWildcard(pattern)
  )

  return [...new Set(invalid)]
}

// Chrome's host grammar allows *, *.domain.tld, or a literal host. The PORT is
// not part of the host and may itself be a wildcard (verified live on Chrome 150).
function hasInvalidHostWildcard(pattern: string): boolean {
  const match = /^[a-zA-Z*]+:\/\/([^/]*)/.exec(pattern)
  const authority = match?.[1]
  if (!authority) return false

  // Strip the port. IPv6 literals keep their brackets (`[::1]:*`).
  let host = authority

  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    if (end !== -1) host = authority.slice(0, end + 1)
  } else {
    const colon = authority.indexOf(':')
    if (colon !== -1) host = authority.slice(0, colon)
  }

  if (!host.includes('*')) return false

  return host !== '*' && !/^\*\.[^*]+$/.test(host)
}

// Shapes proven to refuse via CDP loadUnpacked on Chrome 150; the listed
// non-refusals and Firefox/Safari tolerances were verified live - do not re-add.
export function findChromiumLoadBlockers(
  manifest: unknown,
  browserVersion?: string
): string[] {
  const m = manifest as Record<string, LooseManifest> | null | undefined
  const blockers: string[] = []
  if (!m || typeof m !== 'object' || Array.isArray(m)) return blockers

  // "Required value 'name' is missing or invalid": missing, empty, and
  // non-string names all refuse; this names it for external dists.
  if (typeof m.name !== 'string' || m.name === '') {
    blockers.push(
      `name: missing, empty, or not a string, Chrome requires a non-empty string name and refuses the extension.`
    )
  }

  // "Required value 'version' is missing or invalid": 1-4 dot-separated
  // integers, each 0-65536; same grammar the emission sanitizer repairs.
  if (typeof m.version !== 'string' || !isValidDottedVersion(m.version)) {
    blockers.push(
      `version: missing or invalid, Chrome requires 1-4 dot-separated integers (0-65535) and refuses the extension.`
    )
  }

  // MV3 web_accessible_resources entries must be dictionaries with resources
  // plus matches/extension_ids/use_dynamic_url; MV2's string-array form stays legal.
  if (
    Number(m.manifest_version) === 3 &&
    Array.isArray(m.web_accessible_resources)
  ) {
    m.web_accessible_resources.forEach(
      (entry: LooseManifest, index: number) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          blockers.push(
            `web_accessible_resources[${index}]: MV2-style entry, MV3 requires {resources, matches|extension_ids|use_dynamic_url} dictionaries.`
          )

          return
        }

        if (entry.resources === undefined) {
          blockers.push(
            `web_accessible_resources[${index}]: 'resources' is required, Chrome refuses the extension without it.`
          )
        }

        if (
          entry.matches === undefined &&
          entry.extension_ids === undefined &&
          entry.use_dynamic_url === undefined
        ) {
          blockers.push(
            `web_accessible_resources[${index}]: needs one of 'matches', 'extension_ids', or 'use_dynamic_url' beside resources, Chrome refuses the extension without it.`
          )
        }
      }
    )
  }

  // content_scripts grammar Chrome refuses over: matches required and non-empty,
  // js/css entries strings, run_at exactly three values.
  const CS_RUN_AT = ['document_start', 'document_end', 'document_idle']
  const csGroups = Array.isArray(m.content_scripts) ? m.content_scripts : []
  csGroups.forEach((group: LooseManifest, index: number) => {
    if (!group || typeof group !== 'object') return

    if (group.matches === undefined) {
      blockers.push(
        `content_scripts[${index}]: 'matches' is required, Chrome refuses the extension without it.`
      )
    } else if (Array.isArray(group.matches) && group.matches.length === 0) {
      blockers.push(
        `content_scripts[${index}].matches: there must be at least one match, Chrome refuses the extension over an empty list.`
      )
    }

    for (const listKey of ['js', 'css']) {
      const list = group[listKey]
      if (!Array.isArray(list)) continue

      list.forEach((entry: LooseManifest, entryIndex: number) => {
        if (typeof entry !== 'string') {
          blockers.push(
            `content_scripts[${index}].${listKey}[${entryIndex}]: expected a string, got ${typeof entry}, Chrome refuses the extension.`
          )
        }
      })
    }

    if (group.run_at !== undefined && !CS_RUN_AT.includes(group.run_at)) {
      blockers.push(
        `content_scripts[${index}].run_at: expected "document_start", "document_end" or "document_idle", got ${JSON.stringify(group.run_at)}, Chrome refuses the extension.`
      )
    }
  })

  // minimum_chrome_version: invalid grammar refuses outright; a valid value
  // above the running browser refuses too, same silent wedge.
  const minVersion = m.minimum_chrome_version

  if (minVersion !== undefined) {
    if (typeof minVersion !== 'string' || !isValidDottedVersion(minVersion)) {
      blockers.push(
        `minimum_chrome_version: invalid value ${JSON.stringify(minVersion)}, Chrome refuses the extension.`
      )
    } else if (
      browserVersion &&
      isValidDottedVersion(browserVersion) &&
      compareDottedVersions(minVersion, browserVersion) > 0
    ) {
      blockers.push(
        `minimum_chrome_version: requires ${minVersion} but the resolved browser is ${browserVersion}, the browser refuses the extension.`
      )
    }
  }

  // Chrome caps keyboard shortcuts at 4; Firefox has no cap, so ported Firefox
  // extensions routinely trip it.
  const commands = m?.commands

  if (commands && typeof commands === 'object') {
    const withKeys = Object.values(commands).filter(
      (command: LooseManifest) => command?.suggested_key
    )

    if (withKeys.length > 4) {
      blockers.push(
        `commands: ${withKeys.length} shortcuts declared with "suggested_key", Chrome allows at most 4.`
      )
    }
  }

  // "At least one js or css file is required for 'content_scripts[N]'."
  const contentScripts = Array.isArray(m?.content_scripts)
    ? m.content_scripts
    : []
  contentScripts.forEach((group: LooseManifest, index: number) => {
    const js = Array.isArray(group?.js) ? group.js : []
    const css = Array.isArray(group?.css) ? group.css : []

    if (js.length === 0 && css.length === 0) {
      blockers.push(
        `content_scripts[${index}]: declares neither "js" nor "css", Chrome requires at least one.`
      )
    }
  })

  // "Value 'key' is missing or invalid.", a manifest key must be a valid
  // base64 public key (wild: queup ships one with broken padding).
  const key = m?.key

  if (key !== undefined) {
    if (typeof key !== 'string' || !isValidBase64(key)) {
      blockers.push(
        `key: not a valid base64 public key, Chrome refuses the extension.`
      )
    }
  }

  return blockers
}

// Missing or 0-byte icon files make Chrome refuse the WHOLE extension, only on
// stderr/native dialog; checks the same keys Chrome validates at install.
export function findUnloadableIconFiles(
  manifest: unknown,
  extensionDir: string
): string[] {
  const m = manifest as Record<string, LooseManifest> | null | undefined
  const findings: string[] = []

  const check = (field: string, ref: unknown) => {
    if (typeof ref !== 'string' || ref.trim() === '') return

    let reason: string | null = null

    try {
      const abs = path.join(extensionDir, ref.replace(/^\//, ''))

      if (!fs.existsSync(abs)) {
        reason = 'is missing from the extension directory'
      } else if (fs.statSync(abs).size === 0) {
        reason = 'is an empty file (0 bytes)'
      }
    } catch {
      return
    }

    if (reason) {
      findings.push(
        `${field}: icon "${ref}" ${reason}, Chrome refuses the whole extension over an icon it cannot load.`
      )
    }
  }

  const icons = m?.icons

  if (icons && typeof icons === 'object' && !Array.isArray(icons)) {
    for (const [size, ref] of Object.entries(icons)) {
      check(`icons.${size}`, ref)
    }
  }

  for (const actionKey of ['action', 'browser_action', 'page_action']) {
    const icon = m?.[actionKey]?.default_icon

    if (typeof icon === 'string') {
      check(`${actionKey}.default_icon`, icon)
    } else if (icon && typeof icon === 'object' && !Array.isArray(icon)) {
      for (const [size, ref] of Object.entries(icon)) {
        check(`${actionKey}.default_icon.${size}`, ref)
      }
    }
  }

  return findings
}

// Locale shapes Chrome refuses the whole extension over (verified live);
// empty messages.json loads, key lookup is case-insensitive.
export function findLocaleLoadBlockers(
  manifest: unknown,
  extensionDir: string
): string[] {
  const m = manifest as Record<string, LooseManifest> | null | undefined
  const blockers: string[] = []
  if (!m || typeof m !== 'object' || Array.isArray(m)) return blockers

  const localesDir = path.join(extensionDir, '_locales')
  const defaultLocale = m.default_locale

  if (typeof defaultLocale === 'string' && defaultLocale.trim() !== '') {
    const catalogPath = path.join(localesDir, defaultLocale, 'messages.json')
    let catalogKeys: Set<string> | null = null

    try {
      if (!fs.existsSync(catalogPath)) {
        blockers.push(
          `default_locale: "${defaultLocale}" is declared but _locales/${defaultLocale}/messages.json is missing, Chrome refuses the whole extension.`
        )
      } else {
        try {
          const raw = fs
            .readFileSync(catalogPath, 'utf8')
            .replace(/^\uFEFF/, '')
          const catalog = JSON.parse(raw)
          catalogKeys = new Set(Object.keys(catalog || {}))
        } catch {
          blockers.push(
            `default_locale: _locales/${defaultLocale}/messages.json is not valid JSON, Chrome refuses the whole extension.`
          )
        }
      }
    } catch {
      return blockers
    }

    // "Variable __MSG_x__ used but not defined": the same reading the build
    // gate applies (lazy scan, @@ exempt, case-insensitive lookup), so the two
    // never disagree about what a reference names.
    if (catalogKeys) {
      for (const ref of findUndefinedMsgReferences(m, catalogKeys)) {
        blockers.push(
          `__MSG_${ref}__: used in the manifest but not defined in _locales/${defaultLocale}/messages.json, Chrome refuses the whole extension.`
        )
      }
    }
  } else {
    // "Localization used, but default_locale wasn't specified in the
    // manifest.", a populated _locales tree with no default_locale.
    try {
      if (fs.existsSync(localesDir)) {
        const hasCatalog = fs
          .readdirSync(localesDir)
          .some((entry) =>
            fs.existsSync(path.join(localesDir, entry, 'messages.json'))
          )

        if (hasCatalog) {
          blockers.push(
            `_locales: a locales tree exists but the manifest declares no default_locale, Chrome refuses the whole extension.`
          )
        }
      }
    } catch {
      // unreadable dir. The browser will complain on its own
    }
  }

  return blockers
}

// A storage.managed_schema pointing at a file not in the extension directory
// refuses the whole extension.
export function findMissingManagedSchema(
  manifest: unknown,
  extensionDir: string
): string[] {
  const m = manifest as Record<string, LooseManifest> | null | undefined
  const schema = m?.storage?.managed_schema
  if (typeof schema !== 'string' || schema.trim() === '') return []

  try {
    const abs = path.join(extensionDir, schema.replace(/^\//, ''))

    if (!fs.existsSync(abs)) {
      return [
        `storage.managed_schema: "${schema}" does not exist in the extension directory, Chrome refuses the whole extension.`
      ]
    }
  } catch {
    // unreadable. The browser will complain on its own
  }

  return []
}

function isValidDottedVersion(version: string): boolean {
  if (!version) return false

  const parts = version.split('.')
  if (parts.length > 4) return false

  return parts.every((part) => /^\d{1,5}$/.test(part) && Number(part) <= 65535)
}

function compareDottedVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)

  for (let i = 0; i < 4; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }

  return 0
}

function isValidBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false

  try {
    return Buffer.from(value, 'base64').toString('base64') === value
  } catch {
    return false
  }
}

// A predicted refusal waits for the browser's own answer. The browser's
// sentence replaces it, and it prints only when the browser gave none.
export interface HeldRefusalPredictions {
  hold(prediction: string, ifLoaded: string): void
  browserRefused(): void
  browserLoaded(): void
  flush(): void
}

export function holdRefusalPredictions(
  print: (message: string) => void
): HeldRefusalPredictions {
  const held: Array<{prediction: string; ifLoaded: string}> = []

  return {
    hold: (prediction, ifLoaded) => {
      held.push({prediction, ifLoaded})
    },
    browserRefused: () => {
      held.length = 0
    },
    // The browser took what was predicted refused, so the prediction was
    // wrong. What stays true is that the manifest has the shape.
    browserLoaded: () => {
      for (const {ifLoaded} of held.splice(0)) print(ifLoaded)
    },
    flush: () => {
      for (const {prediction} of held.splice(0)) print(prediction)
    }
  }
}

// Why Firefox refuses, where its own words do not say. Keyed on what the
// manifest shows, and each row was measured on Firefox Nightly 160.
const GECKO_REFUSAL_CAUSES: Array<{
  shows: (manifest: Record<string, unknown>) => boolean
  cause: string
}> = [
  {
    shows: ({manifest_version: version}) =>
      Number.isInteger(version) && Number(version) > 3,
    cause: 'Firefox does not load a manifest_version above 3.'
  },
  {
    shows: ({manifest_version: version}) => version !== 2 && version !== 3,
    cause: 'Firefox loads only the integer 2 or 3 as manifest_version.'
  }
]

export function findGeckoRefusalCause(manifest: unknown): string | undefined {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return undefined
  }

  return GECKO_REFUSAL_CAUSES.find((known) =>
    known.shows(manifest as Record<string, unknown>)
  )?.cause
}

export function readGeckoRefusalCause(
  extensionPath: string | undefined
): string | undefined {
  try {
    return findGeckoRefusalCause(
      JSON.parse(
        fs.readFileSync(
          path.join(String(extensionPath), 'manifest.json'),
          'utf8'
        )
      )
    )
  } catch {
    return undefined
  }
}
