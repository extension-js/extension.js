// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Manifest shapes Chromium refuses to load AT ALL, the refusal surfaces
 * only as a native dialog (or nothing), never as a console error, so the
 * dev session just wedges with no CDP target. Diagnose them before spawn
 * and say why, like the resolved-binary line.
 */
export type ChromiumManifestRefusal =
  | 'mv2'
  | 'mv3-background-scripts'
  | 'unsupported-manifest-version'
  | null

// Manifests under diagnosis are arbitrary user JSON; a loose view keeps the
// dozens of shape probes below readable. Every access is runtime-guarded.
// biome-ignore lint/suspicious/noExplicitAny: dynamic manifest JSON diagnostics boundary
type LooseManifest = any

export function diagnoseChromiumManifestRefusal(
  manifest: unknown
): ChromiumManifestRefusal {
  const m = manifest as Record<string, LooseManifest> | null | undefined
  if (Number(m?.manifest_version) === 2) return 'mv2'

  // Firefox-style MV3: `background.scripts` with no `service_worker`.
  // Chromium requires background.service_worker in MV3 and refuses the
  // whole extension; Firefox is the browser this manifest is written for.
  if (
    Number(m?.manifest_version) === 3 &&
    Array.isArray(m?.background?.scripts) &&
    m.background.scripts.length > 0 &&
    !m?.background?.service_worker
  ) {
    return 'mv3-background-scripts'
  }

  // Any other declared value, missing (Chrome treats it as MV1), 1, or a
  // number above 3, is refused with "Cannot install extension because it
  // uses an unsupported manifest version" (wild: Custom-salesforce-inspector).
  // Only diagnose real manifest objects; malformed input is the browser's
  // problem to report.
  if (
    m &&
    typeof m === 'object' &&
    !Array.isArray(m) &&
    Number(m.manifest_version) !== 3
  ) {
    return 'unsupported-manifest-version'
  }

  return null
}

/**
 * Match patterns Chrome's grammar refuses. ONE invalid pattern in
 * content_scripts matches, host_permissions, or web_accessible_resources
 * makes Chrome refuse the WHOLE extension at load. The only shape verified
 * to actually refuse is an invalid HOST WILDCARD (wild: CarbonWise's
 * `*carbonwise*`, CDP loadUnpacked reports "Invalid host wildcard").
 *
 * NOT flagged, all verified live on Chrome 150 (2026-07-11, both CDP
 * loadUnpacked and --load-extension, install ENABLED):
 * - explicit ports (`http://localhost:3000/*`; wild memux loads fine)
 * - WILDCARD ports (`ws://localhost:<star>` with a wildcard port; wild
 *   BinaryBeastMaster/chat-relay installs ENABLED with a live service
 *   worker). The port is not part of the host
 * - query strings / fragments in the path (`?`, `#` are literal path
 *   characters: `.../gcpd/730?tab=majors` and `/page#section` both load;
 *   wild SN-Utils ships a query-string exclude_matches on the store),
 *   flagging them warned "the whole extension will not load" on extensions
 *   that load fine.
 */
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

/**
 * Chrome's host grammar allows `*`, `*.domain.tld`, or a literal host, a
 * wildcard anywhere else in the host is invalid (wild: CarbonWise matches on
 * a host of `*carbonwise*`). Chrome refuses the whole extension over it.
 *
 * The PORT is not part of the host and may itself be a wildcard. This used to
 * test the whole authority, so a wildcard-port host like `localhost:<star>`
 * read as a mid-host wildcard
 * and warned "the whole extension will not load" about an extension Chrome
 * installs ENABLED (verified live on Chrome 150 via --load-extension: wild
 * BinaryBeastMaster/chat-relay installs enabled with a running service worker).
 * Explicit ports only ever passed by luck, `localhost:3000` contains no `*`
 * to trip the check.
 */
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

/**
 * Other manifest shapes Chrome refuses outright, each proven with CDP
 * `Extensions.loadUnpacked` (which, unlike --load-extension, reports the
 * reason), the wild-subject shapes on Chrome 150 (2026-07-11) and the
 * fixture batch on Chrome 150 (2026-07-13). The refusal is silent under
 * --load-extension, so dev must name it instead of printing an ID for an
 * extension that never loads.
 *
 * NOT refusals, verified to LOAD on Chrome 150 (2026-07-13, CDP
 * loadUnpacked); do NOT add these however fatal they look:
 * - MV3 `background.page`; `background.persistent` true or false
 * - icon files with undecodable bytes, and SVG icons, only a MISSING or
 *   0-byte icon file refuses
 * - unknown `permissions` entries; MV2 keys like `browser_action` under MV3
 * - a WAR dictionary with only `use_dynamic_url` beside `resources`
 * - `__MSG_@@predefined__` variables; catalog-key case differences (message
 *   lookup is case-insensitive)
 * And on Firefox 147 (2026-07-13, RDP installTemporaryAddon): explicit AND
 * wildcard ports in match patterns install fine, the old "host must not
 * include a port" grammar is gone; do not resurrect it for gecko.
 *
 * Safari (2026-07-13, macOS 15.7.7): safari-web-extension-converter
 * CONVERTS every one of these shapes with exit 0, missing name, bad locale
 * catalogs, all of it. The converter is not a refusal surface and must not
 * be gated on manifest shapes; Safari's real refusals happen at runtime
 * inside Safari, which has no scriptable install path to verify against.
 * Converter/xcodebuild exit codes still matter (toolchain failures), but
 * they say nothing about manifest validity.
 *
 * `browserVersion` (when known) enables the minimum_chrome_version compare.
 */
export function findChromiumLoadBlockers(
  manifest: unknown,
  browserVersion?: string
): string[] {
  const m = manifest as Record<string, LooseManifest> | null | undefined
  const blockers: string[] = []
  if (!m || typeof m !== 'object' || Array.isArray(m)) return blockers

  // "Required value 'name' is missing or invalid.", missing, empty-string,
  // and non-string names all refuse (fixtures 01/02/26). The develop
  // pipeline repairs these at emission; this names it for external dists.
  if (typeof m.name !== 'string' || m.name === '') {
    blockers.push(
      `name: missing, empty, or not a string, Chrome requires a non-empty string name and refuses the extension.`
    )
  }

  // "Required value 'version' is missing or invalid. It must be between 1-4
  // dot-separated integers each between 0 and 65536" (wild stderr:
  // Ananyakk71/javscript). Same grammar the emission sanitizer repairs.
  if (typeof m.version !== 'string' || !isValidDottedVersion(m.version)) {
    blockers.push(
      `version: missing or invalid, Chrome requires 1-4 dot-separated integers (0-65535) and refuses the extension.`
    )
  }

  // MV3 web_accessible_resources grammar (fixtures 06/07/08): entries must
  // be dictionaries with `resources` plus at least one of `matches`,
  // `extension_ids`, or `use_dynamic_url`. MV2's string-array form is legal
  // on MV2, so this is gated on manifest_version 3.
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

  // content_scripts grammar Chrome refuses over (fixtures 09/10/17/18/27):
  // 'matches' is required and must be non-empty; js/css entries must be
  // strings; run_at allows exactly three values.
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

  // minimum_chrome_version (fixtures 11/31/32): invalid grammar refuses
  // outright; a valid value above the running browser refuses with "This
  // extension requires ... version N or greater", same silent wedge.
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

  // Chrome caps keyboard shortcuts at 4 ("Too many shortcuts specified for
  // 'commands': The maximum is 4."). Firefox has no such cap, so ported
  // Firefox extensions routinely trip it (wild: spotify-hotkeys, 12).
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

/**
 * Icon files Chrome cannot load, missing from the extension directory or
 * present but empty (0 bytes, undecodable). Either one makes Chrome refuse
 * the WHOLE extension at load with "Could not load icon '<file>'", surfaced
 * only on stderr/a native dialog (wild: Speak2Type ships a 0-byte
 * icon-128.png; the dev session printed an Extension ID for an extension the
 * browser silently never installed). Checks the same manifest keys Chrome
 * validates at install: `icons` and `*_action.default_icon`.
 */
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

/**
 * The locale shapes Chrome refuses the whole extension over, all verified
 * live on Chrome 150 (2026-07-13, CDP loadUnpacked; fixtures 03/04/05/20/
 * 22/29). Common in converted/repacked extensions that lost their _locales
 * tree. Verified tolerances: an EMPTY messages.json loads; message-key
 * lookup is case-insensitive; `__MSG_@@predefined__` never needs a catalog.
 */
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
          catalogKeys = new Set(
            Object.keys(catalog || {}).map((key) => key.toLowerCase())
          )
        } catch {
          blockers.push(
            `default_locale: _locales/${defaultLocale}/messages.json is not valid JSON, Chrome refuses the whole extension.`
          )
        }
      }
    } catch {
      return blockers
    }

    // "Variable __MSG_x__ used but not defined.", only whole-string
    // references are flagged (the verified shape), @@predefined variables
    // are exempt, and the key match is case-insensitive like Chrome's.
    if (catalogKeys) {
      const refs = new Set<string>()
      collectMsgRefs(m, refs)
      for (const ref of refs) {
        if (!catalogKeys.has(ref.toLowerCase())) {
          blockers.push(
            `__MSG_${ref}__: used in the manifest but not defined in _locales/${defaultLocale}/messages.json, Chrome refuses the whole extension.`
          )
        }
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

/**
 * "File does not exist: <path>/schema.json", a storage.managed_schema
 * pointing at a file that is not in the extension directory refuses the
 * whole extension (fixture 19, Chrome 150).
 */
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

function collectMsgRefs(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    const match = /^__MSG_(.+)__$/.exec(value.trim())
    if (match && !match[1].startsWith('@@')) out.add(match[1])
  } else if (Array.isArray(value)) {
    for (const item of value) collectMsgRefs(item, out)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectMsgRefs(item, out)
  }
}

/** Chrome's version grammar: 1-4 dot-separated integers 0-65535. */
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
