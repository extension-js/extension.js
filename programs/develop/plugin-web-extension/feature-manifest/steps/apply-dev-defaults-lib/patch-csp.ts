// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import parse from 'content-security-policy-parser'
import type {Manifest} from '../../../../types'

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
  const directives = Object.entries(cspObject).map(
    ([directive, values]) => `${directive} ${values.join(' ')}`
  )
  return directives.join('; ') + '; '
}

// The dev reload producer (service worker) and HMR client dial the local dev
// server over ws/http. A user CSP that restricts `connect-src` (or implies the
// restriction via `default-src`) silently blocks that socket, the producer
// never connects and reload delivery is dead for the whole session. Dev-only:
// this file feeds apply-dev-defaults, never production builds.
const DEV_CONNECT_SOURCES = [
  'ws://127.0.0.1:*',
  'ws://localhost:*',
  'http://127.0.0.1:*',
  'http://localhost:*'
]

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

// Client sockets don't always dial loopback: under `--host <lan-ip>` or the
// `--public-host` override (devcontainers, remote browsers) the HMR client and
// the control-bridge producer dial the CONNECTABLE host the dev server
// resolved and exported (dev-server/index.ts, same process, set before the
// first compile). The loosened connect-src must whitelist that host too, or
// the exact remote scenario the connectable-host machinery was built for is
// the one where reload delivery silently dies (verified live: SW console
// shows "Connecting to 'ws://<lan-ip>:<port>/extjs-control' violates …").
function devConnectSources(): string[] {
  const sources = [...DEV_CONNECT_SOURCES]
  const raw = String(
    process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST || ''
  ).trim()
  if (!raw || LOOPBACK_HOSTS.has(raw)) return sources
  // A CSP host-source with an IPv6 literal must be bracketed.
  const host = raw.includes(':') && !raw.startsWith('[') ? `[${raw}]` : raw
  sources.push(`ws://${host}:*`, `http://${host}:*`)
  return sources
}

function loosenConnectSrcForDev(csp: Map<string, string[]>) {
  const devSources = devConnectSources()
  const connectSrc = csp.get('connect-src')
  const defaultSrc = csp.get('default-src')
  if (connectSrc) {
    for (const source of devSources) {
      if (!connectSrc.includes(source)) connectSrc.push(source)
    }
    csp.set('connect-src', connectSrc)
  } else if (defaultSrc) {
    // No connect-src: connections fall back to default-src, extend a copy
    // as an explicit connect-src instead of loosening default-src itself.
    csp.set('connect-src', [...defaultSrc, ...devSources])
  }
}

export function patchV2CSP(manifest: Manifest) {
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

  if (!csp.get('script-src')) {
    csp.set('script-src', ["'self'", "'unsafe-eval'", 'blob:', 'filesystem:'])
  } else {
    const scriptSrc = csp.get('script-src') || []
    if (!scriptSrc.includes("'unsafe-eval'")) {
      scriptSrc.push("'unsafe-eval'")
    }
    if (!scriptSrc.includes('blob:')) {
      scriptSrc.push('blob:')
    }
    if (!scriptSrc.includes('filesystem:')) {
      scriptSrc.push('filesystem:')
    }
    csp.set('script-src', scriptSrc)
  }

  if (!csp.get('object-src')) {
    csp.set('object-src', ["'self'", 'blob:', 'filesystem:'])
  } else {
    const objectSrc = csp.get('object-src') || []
    if (!objectSrc.includes('blob:')) {
      objectSrc.push('blob:')
    }
    if (!objectSrc.includes('filesystem:')) {
      objectSrc.push('filesystem:')
    }
    csp.set('object-src', objectSrc)
  }

  loosenConnectSrcForDev(csp)

  const cspObject: Record<string, string[]> = Object.fromEntries(csp.entries())
  return buildCSP(cspObject)
}

export function patchV3CSP(manifest: Manifest) {
  const policy = manifest.content_security_policy

  if (!policy) {
    return {
      extension_pages: buildCSP({
        'script-src': ["'self'"],
        'object-src': ["'self'"]
      })
    }
  }

  const csp = parse(policy.extension_pages || '')
  const defaultDirectives = {
    'script-src': ["'self'"],
    'object-src': ["'self'"]
  }

  for (const directive in defaultDirectives) {
    if (!csp.get(directive)) {
      csp.set(
        directive,
        defaultDirectives[directive as keyof typeof defaultDirectives]
      )
    }
  }

  loosenConnectSrcForDev(csp)

  const cspObject: Record<string, string[]> = Object.fromEntries(csp.entries())
  const extensionPagesPolicy = buildCSP(cspObject)

  return {
    extension_pages: extensionPagesPolicy
  }
}
