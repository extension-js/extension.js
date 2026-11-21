// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import parse from 'content-security-policy-parser'
import {isGeckoBasedBrowser} from '../../../lib/constants'
import {withAddedSources} from '../../../lib/csp-sources'
import type {Manifest} from '../../../types'

function resolveV2Policy(policy: Manifest['content_security_policy']) {
  if (!policy) return undefined

  if (typeof policy === 'string') return policy

  if (typeof policy === 'object') {
    const extensionPages = (policy as {extension_pages?: unknown})
      .extension_pages
    if (typeof extensionPages === 'string') return extensionPages
  }

  return undefined
}

function buildCSP(cspObject: Record<string, string[]>) {
  const directives = Object.entries(cspObject).map(([directive, values]) =>
    values.length ? `${directive} ${values.join(' ')}` : directive
  )

  return `${directives.join('; ')}; `
}

// A user CSP restricting connect-src silently blocks the dev-server socket and
// kills reload delivery for the session. Dev-only, never production builds.
const DEV_CONNECT_SOURCES = [
  'ws://127.0.0.1:*',
  'ws://localhost:*',
  'http://127.0.0.1:*',
  'http://localhost:*'
]

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

// Under --host <lan-ip> / --public-host, clients dial the resolved CONNECTABLE
// host, so the loosened connect-src must whitelist it too (verified live).
// Only the session's own host is added, never one the environment names.
function devConnectSources(connectableHost?: string): string[] {
  const sources = [...DEV_CONNECT_SOURCES]
  const raw = String(connectableHost ?? '').trim()
  if (!raw || LOOPBACK_HOSTS.has(raw)) return sources

  // A CSP host-source with an IPv6 literal must be bracketed.
  const host = raw.includes(':') && !raw.startsWith('[') ? `[${raw}]` : raw
  sources.push(`ws://${host}:*`, `http://${host}:*`)

  return sources
}

// An unset fetch directive reads default-src, so the dev copy starts from
// it: what the author allowed stays allowed and nothing else is opened.
function addDevSources(
  csp: Map<string, string[]>,
  directive: string,
  added: string[],
  whenNoPolicyCovers?: string[]
) {
  const current =
    csp.get(directive) || csp.get('default-src') || whenNoPolicyCovers

  if (current) csp.set(directive, withAddedSources(current, added))
}

// Firefox upgrades the loopback ws:// dial to TLS under this directive and
// the dev server never answers it, so reload and control stay dark.
function loosenConnectSrcForDev(
  csp: Map<string, string[]>,
  browser?: string,
  connectableHost?: string
) {
  if (browser && isGeckoBasedBrowser(browser)) {
    csp.delete('upgrade-insecure-requests')
  }

  addDevSources(csp, 'connect-src', devConnectSources(connectableHost))
}

type V3Policy = Record<string, unknown> & {extension_pages: string}

// Dev only loosens the pages policy. Every other slot the author wrote
// (sandbox above all) rides along byte for byte: a whole-key replacement
// dropped them and left a sandboxed page with its helper script blocked.
function keepSiblingSlots(
  policy: Manifest['content_security_policy'],
  extensionPages: string
): V3Policy {
  if (policy && typeof policy === 'object' && !Array.isArray(policy)) {
    return {
      ...(policy as Record<string, unknown>),
      extension_pages: extensionPages
    }
  }

  return {extension_pages: extensionPages}
}

// MV2 reads one string, so the dev policy is the loosened pages policy on
// its own. The canonical manifest already folded an object to that string.
export function patchV2CSP(
  manifest: Manifest,
  browser?: string,
  connectableHost?: string
): string {
  return patchV2PagesPolicy(manifest, browser, connectableHost)
}

function patchV2PagesPolicy(
  manifest: Manifest,
  browser?: string,
  connectableHost?: string
): string {
  const policy: string | undefined = resolveV2Policy(
    manifest.content_security_policy
  )

  if (!policy) {
    return buildCSP({
      'script-src': ["'self'", "'unsafe-eval'", 'blob:', 'filesystem:'],
      'object-src': ["'self'", 'blob:', 'filesystem:']
    })
  }

  const csp = parse(policy)

  addDevSources(
    csp,
    'script-src',
    ["'unsafe-eval'", 'blob:', 'filesystem:'],
    ["'self'"]
  )

  addDevSources(csp, 'object-src', ['blob:', 'filesystem:'], ["'self'"])

  loosenConnectSrcForDev(csp, browser, connectableHost)

  const cspObject: Record<string, string[]> = Object.fromEntries(csp.entries())

  return buildCSP(cspObject)
}

export function patchV3CSP(
  manifest: Manifest,
  browser?: string,
  connectableHost?: string
): V3Policy {
  const policy = manifest.content_security_policy

  if (!policy) {
    return {
      extension_pages: buildCSP({
        'script-src': ["'self'"],
        'object-src': ["'self'"]
      })
    }
  }

  const extensionPages =
    typeof policy === 'string'
      ? policy
      : (policy as {extension_pages?: unknown}).extension_pages
  const csp = parse(typeof extensionPages === 'string' ? extensionPages : '')

  // Chrome refuses a pages policy that leaves scripts or objects uncovered.
  // An author's default-src covers both, and a copy here would override it.
  if (!csp.get('default-src')) {
    for (const directive of ['script-src', 'object-src']) {
      if (!csp.get(directive)) csp.set(directive, ["'self'"])
    }
  }

  loosenConnectSrcForDev(csp, browser, connectableHost)

  const cspObject: Record<string, string[]> = Object.fromEntries(csp.entries())
  const extensionPagesPolicy = buildCSP(cspObject)

  return keepSiblingSlots(policy, extensionPagesPolicy)
}
