// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'

/**
 * Manifest shapes Chromium refuses to load AT ALL — the refusal surfaces
 * only as a native dialog (or nothing), never as a console error, so the
 * dev session just wedges with no CDP target. Diagnose them before spawn
 * and say why, like the resolved-binary line.
 */
export type ChromiumManifestRefusal = 'mv2' | 'mv3-background-scripts' | null

export function diagnoseChromiumManifestRefusal(
  manifest: unknown
): ChromiumManifestRefusal {
  const m = manifest as Record<string, any> | null | undefined
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

  return null
}

/**
 * Match patterns Chrome's grammar refuses. ONE invalid pattern in
 * content_scripts matches, host_permissions, or web_accessible_resources
 * makes Chrome refuse the WHOLE extension at load. The only shape verified
 * to actually refuse is an invalid HOST WILDCARD (wild: CarbonWise's
 * `*carbonwise*` — CDP loadUnpacked reports "Invalid host wildcard").
 *
 * NOT flagged, all verified live on Chrome 150 (2026-07-11, both CDP
 * loadUnpacked and --load-extension, install ENABLED):
 * - explicit ports (`http://localhost:3000/*`; wild memux loads fine)
 * - WILDCARD ports (`ws://localhost:<star>` with a wildcard port; wild
 *   BinaryBeastMaster/chat-relay installs ENABLED with a live service
 *   worker) — the port is not part of the host
 * - query strings / fragments in the path (`?`, `#` are literal path
 *   characters: `.../gcpd/730?tab=majors` and `/page#section` both load;
 *   wild SN-Utils ships a query-string exclude_matches on the store) —
 *   flagging them warned "the whole extension will not load" on extensions
 *   that load fine.
 */
export function findInvalidMatchPatterns(manifest: unknown): string[] {
  const m = manifest as Record<string, any> | null | undefined
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
 * Chrome's host grammar allows `*`, `*.domain.tld`, or a literal host — a
 * wildcard anywhere else in the host is invalid (wild: CarbonWise matches on
 * a host of `*carbonwise*`). Chrome refuses the whole extension over it.
 *
 * The PORT is not part of the host and may itself be a wildcard. This used to
 * test the whole authority, so a wildcard-port host like `localhost:<star>`
 * read as a mid-host wildcard
 * and warned "the whole extension will not load" about an extension Chrome
 * installs ENABLED (verified live on Chrome 150 via --load-extension: wild
 * BinaryBeastMaster/chat-relay installs enabled with a running service worker).
 * Explicit ports only ever passed by luck — `localhost:3000` contains no `*`
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
 * Other manifest shapes Chrome refuses outright, each proven against a wild
 * subject with CDP `Extensions.loadUnpacked` (which, unlike --load-extension,
 * reports the reason). All are extension-own — loading the source unpacked in
 * real Chrome fails identically — but the refusal is silent, so dev must name
 * it instead of printing an ID for an extension that never loads.
 */
export function findChromiumLoadBlockers(manifest: unknown): string[] {
  const m = manifest as Record<string, any> | null | undefined
  const blockers: string[] = []

  // Chrome caps keyboard shortcuts at 4 ("Too many shortcuts specified for
  // 'commands': The maximum is 4."). Firefox has no such cap, so ported
  // Firefox extensions routinely trip it (wild: spotify-hotkeys, 12).
  const commands = m?.commands
  if (commands && typeof commands === 'object') {
    const withKeys = Object.values(commands).filter(
      (command: any) => command?.suggested_key
    )
    if (withKeys.length > 4) {
      blockers.push(
        `commands: ${withKeys.length} shortcuts declared with "suggested_key" — Chrome allows at most 4.`
      )
    }
  }

  // "At least one js or css file is required for 'content_scripts[N]'."
  const contentScripts = Array.isArray(m?.content_scripts)
    ? m.content_scripts
    : []
  contentScripts.forEach((group: any, index: number) => {
    const js = Array.isArray(group?.js) ? group.js : []
    const css = Array.isArray(group?.css) ? group.css : []
    if (js.length === 0 && css.length === 0) {
      blockers.push(
        `content_scripts[${index}]: declares neither "js" nor "css" — Chrome requires at least one.`
      )
    }
  })

  // "Value 'key' is missing or invalid." — a manifest key must be a valid
  // base64 public key (wild: queup ships one with broken padding).
  const key = m?.key
  if (key !== undefined) {
    if (typeof key !== 'string' || !isValidBase64(key)) {
      blockers.push(
        `key: not a valid base64 public key — Chrome refuses the extension.`
      )
    }
  }

  return blockers
}

/**
 * Icon files Chrome cannot load — missing from the extension directory or
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
  const m = manifest as Record<string, any> | null | undefined
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
        `${field}: icon "${ref}" ${reason} — Chrome refuses the whole extension over an icon it cannot load.`
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

function isValidBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false
  try {
    return Buffer.from(value, 'base64').toString('base64') === value
  } catch {
    return false
  }
}
