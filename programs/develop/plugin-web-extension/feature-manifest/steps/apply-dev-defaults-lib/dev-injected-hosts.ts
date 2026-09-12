// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../../../feature-scripts/contracts'

// The single source for the hosts the dev build grants. The manifest patch,
// the optional-promotion warning and the undeclared-fetch warning all read
// this, so a host added here cannot reach the dist manifest without every
// warning covering it. Never re-derive content-script matches elsewhere.
export function devInjectedHostPatterns(
  manifest: Record<string, unknown>
): readonly string[] {
  const contentScripts = manifest?.content_scripts
  if (!Array.isArray(contentScripts)) return []
  // A MAIN world script repeats its matches on a synthesised bridge entry,
  // so the union dedupes or the promotion warning prints the pattern twice.
  return [
    ...new Set(
      (contentScripts as Array<{matches?: unknown}>).flatMap((cs) =>
        Array.isArray(cs?.matches) ? (cs.matches as string[]) : []
      )
    )
  ]
}

// MV3 keeps hosts in host_permissions. MV2 has no such key, so a host lives
// in permissions next to the API permissions and has to be told apart.
export function declaredHostPatterns(
  manifest: Record<string, unknown>
): string[] {
  if (manifest?.manifest_version === 3) {
    const hosts = manifest?.host_permissions
    return Array.isArray(hosts) ? (hosts as string[]) : []
  }
  const permissions = manifest?.permissions
  if (!Array.isArray(permissions)) return []
  return (permissions as unknown[])
    .filter((entry): entry is string => typeof entry === 'string')
    .filter((entry) => isHostPattern(entry))
}

export function optionalHostPatterns(
  manifest: Record<string, unknown>
): string[] {
  const declared =
    manifest?.manifest_version === 3
      ? manifest?.optional_host_permissions
      : manifest?.optional_permissions
  if (!Array.isArray(declared)) return []
  return (declared as unknown[])
    .filter((entry): entry is string => typeof entry === 'string')
    .filter((entry) => isHostPattern(entry))
}

// The schemes a match pattern can name a host under. ws and wss are hosts a
// worker socket needs, urn carries no authority so it never names one.
export function isHostPattern(value: string): boolean {
  return (
    value === '<all_urls>' || /^(?:\*|https?|wss?|file|ftp):\/\//.test(value)
  )
}

// The source files a dev scan reads. The module graph names an SFC block as
// file.vue?vue&type=script, so the query goes before the extension test.
const SCANNABLE_SOURCE_RE = /\.(?:[cm]?js|jsx|[cm]?ts|tsx|vue|svelte)$/

export function scannableSourcePath(
  resource: string | undefined
): string | undefined {
  if (!resource || resource.includes('node_modules')) return undefined
  const bare = resource.split('?')[0]
  return SCANNABLE_SOURCE_RE.test(bare) ? bare : undefined
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Chrome match-pattern semantics: a bare "*" scheme covers http and https,
// a "*." host prefix covers the base domain plus every subdomain.
export function matchesHostPattern(pattern: string, url: string): boolean {
  if (!pattern) return false
  if (pattern === '<all_urls>') return true

  const parts = /^(\*|https?|file|ftp|urn):\/\/([^/]*)(\/.*)?$/.exec(pattern)
  if (!parts) return false
  const [, scheme, host, rawPath] = parts

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  const urlScheme = parsed.protocol.replace(/:$/, '')
  if (scheme === '*') {
    if (urlScheme !== 'http' && urlScheme !== 'https') return false
  } else if (scheme !== urlScheme) {
    return false
  }

  if (host !== '*') {
    if (host.startsWith('*.')) {
      const base = host.slice(2)
      if (parsed.hostname !== base && !parsed.hostname.endsWith(`.${base}`)) {
        return false
      }
    } else if (host.toLowerCase() !== parsed.hostname.toLowerCase()) {
      return false
    }
  }

  const pathPattern = rawPath || '/*'
  const pathRe = new RegExp(
    `^${pathPattern.split('*').map(escapeForRegExp).join('.*')}$`
  )
  return pathRe.test(parsed.pathname + parsed.search)
}

export interface InjectedOnlyHostUse {
  url: string
  file: string
  pattern: string
  optional: boolean
}

interface ScannableModule {
  resource?: string
  layer?: string | null
}

// A fetch from a content script goes through the page's CORS, not through
// extension host permissions, so flagging it would be a false positive.
export function isContentScriptModule(module: ScannableModule): boolean {
  return module?.layer === EXTENSIONJS_CONTENT_SCRIPT_LAYER
}

const URL_LITERAL = `(https?:\\/\\/[^'"\`\\s)\\\\]+)`
const FETCH_RE = new RegExp(`\\bfetch\\s*\\(\\s*(['"\`])${URL_LITERAL}\\1`, 'g')
const REQUEST_RE = new RegExp(
  `\\bnew\\s+Request\\s*\\(\\s*(['"\`])${URL_LITERAL}\\1`,
  'g'
)
const XHR_OPEN_RE = new RegExp(
  `\\.\\s*open\\s*\\(\\s*(['"\`])[A-Za-z]+\\1\\s*,\\s*(['"\`])${URL_LITERAL}\\2`,
  'g'
)

// The dev server itself lives on localhost, so a loopback URL is never the
// packaged-extension gap this warning is about.
function isLoopback(url: string): boolean {
  try {
    const {hostname} = new URL(url)
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname.endsWith('.localhost')
    )
  } catch {
    return false
  }
}

export function findAbsoluteRequestUrls(source: string): string[] {
  const found: string[] = []
  for (const expression of [FETCH_RE, REQUEST_RE]) {
    expression.lastIndex = 0
    let match: RegExpExecArray | null = expression.exec(source)
    while (match) {
      found.push(match[2])
      match = expression.exec(source)
    }
  }
  // The .open() shape is common enough on unrelated objects that it only
  // counts when the same file names XMLHttpRequest.
  if (/\bXMLHttpRequest\b/.test(source)) {
    XHR_OPEN_RE.lastIndex = 0
    let match: RegExpExecArray | null = XHR_OPEN_RE.exec(source)
    while (match) {
      found.push(match[3])
      match = XHR_OPEN_RE.exec(source)
    }
  }
  return [...new Set(found)].filter((url) => !isLoopback(url))
}

/**
 * Finds absolute request URLs whose host is granted only because dev unioned
 * the content-script matches into the manifest. Content-script modules are
 * skipped: their requests answer to page CORS rather than host permissions.
 */
export function findInjectedOnlyHostUses(
  modules: Iterable<ScannableModule>,
  injected: readonly string[],
  declared: readonly string[],
  optional: readonly string[]
): InjectedOnlyHostUse[] {
  if (!injected.length) return []

  const firstUseByOrigin = new Map<string, InjectedOnlyHostUse>()

  for (const module of modules) {
    const resource = scannableSourcePath(module?.resource)
    if (!resource) continue
    if (isContentScriptModule(module)) continue

    let source: string
    try {
      const stat = fs.statSync(resource)
      if (stat.size > 1024 * 1024) continue
      source = fs.readFileSync(resource, 'utf-8')
    } catch {
      continue
    }

    for (const url of findAbsoluteRequestUrls(source)) {
      if (declared.some((pattern) => matchesHostPattern(pattern, url))) continue
      const pattern = injected.find((candidate) =>
        matchesHostPattern(candidate, url)
      )
      if (!pattern) continue

      let origin: string
      try {
        origin = new URL(url).origin
      } catch {
        continue
      }
      if (firstUseByOrigin.has(origin)) continue

      firstUseByOrigin.set(origin, {
        url,
        file: resource,
        pattern,
        optional: optional.some((candidate) =>
          matchesHostPattern(candidate, url)
        )
      })
    }
  }

  return [...firstUseByOrigin.values()]
}
