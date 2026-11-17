// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {IncomingMessage, ServerResponse} from 'node:http'
import {isWildcardHost} from './connectable-host'
import {isSameWebOrigin, normalizeWebOrigin} from './emulator-lane'

// chrome-extension://, moz-extension://, safari-web-extension://: the scheme
// the extension's own pages fetch their hot updates from.
const EXTENSION_ORIGIN = /^[a-z][a-z0-9+.-]*-extension:\/\/[^/]/i

export function isExtensionOrigin(value: unknown): boolean {
  return EXTENSION_ORIGIN.test(String(value ?? '').trim())
}

// Whether an extension origin belongs to this session: one that said hello on
// the control channel with the session's instance id.
export type SessionExtensionOriginCheck = (origin: string) => boolean

// The origin a response may be read by, null when the request carries none the
// session needs. A star let every page the developer visited read the whole
// compiled extension off loopback, and any extension origin let every other
// extension in the profile read it.
export function resolveAllowedCorsOrigin(
  requestOrigin: unknown,
  allowedWebOrigins: readonly (string | null | undefined)[] = [],
  isSessionExtensionOrigin: SessionExtensionOriginCheck = () => false
): string | null {
  const origin = String(requestOrigin ?? '').trim()

  if (!origin) return null

  if (isExtensionOrigin(origin)) {
    return isSessionExtensionOrigin(origin) ? origin : null
  }

  for (const allowed of allowedWebOrigins) {
    if (isSameWebOrigin(origin, allowed)) return normalizeWebOrigin(origin)
  }

  return null
}

export function devServerCorsHeaders(
  requestOrigin: unknown,
  allowedWebOrigins: readonly (string | null | undefined)[] = [],
  isSessionExtensionOrigin: SessionExtensionOriginCheck = () => false
): Array<{key: string; value: string}> {
  const headers = [{key: 'Vary', value: 'Origin'}]
  const allowed = resolveAllowedCorsOrigin(
    requestOrigin,
    allowedWebOrigins,
    isSessionExtensionOrigin
  )

  if (!allowed) return headers

  headers.push({key: 'Access-Control-Allow-Origin', value: allowed})

  // A web viewer reaching loopback is a private-network request Chrome gates
  // behind this header; the extension's own pages are not.
  if (!isExtensionOrigin(allowed)) {
    headers.push({key: 'Access-Control-Allow-Private-Network', value: 'true'})
  }

  return headers
}

// --allowed-hosts and commands.dev.allowedHosts take a comma list or an array.
// A leading dot admits every subdomain, the dev server's own convention.
export function parseAllowedHosts(value: unknown): string[] {
  const items = Array.isArray(value) ? value : String(value ?? '').split(',')
  const hosts = items
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0)

  return [...new Set(hosts)]
}

// The name a refused request asked for, without the port, as the flag takes it.
// The header is attacker-controlled, so nothing but host characters survives.
export function refusedHostName(header: unknown): string {
  const raw = String(header ?? '').trim()
  if (!raw) return ''

  let name = raw

  try {
    name = new URL(`http://${raw}`).hostname
  } catch {
    // Not a parseable authority, keep what was sent.
  }

  return name.replace(/[^A-Za-z0-9.:_[\]-]/g, '?').slice(0, 255)
}

export function refusedHostResponse(host: string): string {
  const name = host || 'an empty Host header'

  return (
    `Extension.js dev server refused the host "${name}".\n` +
    `Allow it with: extension dev --allowed-hosts ${host || '<host>'}\n` +
    'Or set commands.dev.allowedHosts in extension.config.js. ' +
    'Both take more than one host, comma-separated on the flag.\n'
  )
}

interface HostCheckingServer {
  isValidHost?: (
    headers: IncomingMessage['headers'],
    headerToCheck: string
  ) => boolean
}

// Same verdict as the dev server's own Host check, which stays the DNS
// rebinding defense. Only the refusal changes: it names the host and the fix.
export function createHostCheckMiddleware(
  devServer: unknown,
  onRefused: (host: string) => void
) {
  const announced = new Set<string>()
  const maxAnnounced = 20

  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const server = devServer as HostCheckingServer
    const headerName = req.headers[':authority'] ? ':authority' : 'host'

    if (server?.isValidHost?.(req.headers, headerName)) {
      next()

      return
    }

    const host = refusedHostName(req.headers[headerName])

    if (!announced.has(host) && announced.size < maxAnnounced) {
      announced.add(host)
      onRefused(host)
    }

    res.statusCode = 403
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.end(refusedHostResponse(host))
  }
}

export const HOST_CHECK_MIDDLEWARE_NAME = 'host-header-check'

// Swaps the stock check for ours in place, so it still runs before any file.
export function withHostCheckMiddleware<T>(
  middlewares: T[],
  devServer: unknown,
  onRefused: (host: string) => void
): T[] {
  const entry = {
    name: HOST_CHECK_MIDDLEWARE_NAME,
    middleware: createHostCheckMiddleware(devServer, onRefused)
  } as unknown as T
  const index = middlewares.findIndex(
    (item) => (item as {name?: string})?.name === HOST_CHECK_MIDDLEWARE_NAME
  )

  if (index === -1) return [entry, ...middlewares]

  return middlewares.map((item, position) =>
    position === index ? entry : item
  )
}

export const REQUEST_SITE_MIDDLEWARE_NAME = 'cross-origin-header-check'

const FETCH_SITES: ReadonlySet<string> = new Set([
  'same-origin',
  'same-site',
  'cross-site',
  'none'
])
const LOOPBACK_NAMES = ['localhost', '127.0.0.1', '::1']

// What makes a request part of one session: the address the browser reaches
// the server at, the origins the session named, and its own extension.
export interface RequestSiteSession {
  port: number
  // Host names the server answers on, without brackets or a port.
  sessionHosts: readonly string[]
  // Hosts the developer named with --allowed-hosts, the dev server's convention.
  namedHosts: readonly string[]
  allowedWebOrigins: readonly (string | null | undefined)[]
  isSessionExtensionOrigin: SessionExtensionOriginCheck
}

type RequestHeaders = Readonly<Record<string, string | string[] | undefined>>

function headerText(value: string | string[] | undefined): string {
  return String((Array.isArray(value) ? value[0] : value) ?? '').trim()
}

function bareHostName(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
}

function isNamedHost(name: string, namedHosts: readonly string[]): boolean {
  return namedHosts.some((entry) => {
    const named = entry.toLowerCase()

    if (!named.startsWith('.')) return bareHostName(named) === name

    return name === named.slice(1) || name.endsWith(named)
  })
}

// A web origin is the session's own when it is the address this request
// dialed, a name the server answers on with its port, or one the session named.
export function isSessionWebOrigin(
  value: unknown,
  hostHeader: unknown,
  session: RequestSiteSession
): boolean {
  const origin = normalizeWebOrigin(value)
  if (!origin) return false

  const url = new URL(origin)
  const dialed = String(hostHeader ?? '').trim()

  if (dialed) {
    try {
      if (new URL(`${url.protocol}//${dialed}`).host === url.host) return true
    } catch {
      // Not a parseable authority, so it proves nothing.
    }
  }

  const name = bareHostName(url.hostname)
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))

  if (port === session.port && session.sessionHosts.includes(name)) return true
  if (isNamedHost(name, session.namedHosts)) return true

  return session.allowedWebOrigins.some((allowed) =>
    isSameWebOrigin(origin, allowed)
  )
}

function isSessionOrigin(
  origin: string,
  hostHeader: unknown,
  session: RequestSiteSession
): boolean {
  return isExtensionOrigin(origin)
    ? session.isSessionExtensionOrigin(origin)
    : isSessionWebOrigin(origin, hostHeader, session)
}

// Whether the browser says this request belongs to the session. A request
// with no fetch metadata passes, as it does through the stock server.
export function isRequestFromSession(
  headers: RequestHeaders,
  session: RequestSiteSession
): boolean {
  const site = headerText(headers['sec-fetch-site']).toLowerCase()
  if (!FETCH_SITES.has(site)) return true

  const hostHeader = headerText(headers[':authority'] ?? headers.host)
  const origin = headerText(headers.origin)

  if (origin) return isSessionOrigin(origin, hostHeader, session)
  if (site === 'same-origin' || site === 'none') return true

  // A same-site request can come from another port, so only a referrer that
  // is the session's own settles a request that carries no Origin.
  return isSessionWebOrigin(headerText(headers.referer), hostHeader, session)
}

// The origin a refused request named, for the one printed line.
export function refusedRequestOrigin(headers: RequestHeaders): string {
  const origin = headerText(headers.origin)
  const named =
    origin && origin !== 'null'
      ? origin
      : (normalizeWebOrigin(headerText(headers.referer)) ?? '')

  return named.replace(/[^A-Za-z0-9.:_/[\]-]/g, '?').slice(0, 255)
}

export const REFUSED_REQUEST_RESPONSE =
  'Extension.js dev server refused a request from another site.\n' +
  'Open this address directly in the browser to load it.\n'

export function createRequestSiteMiddleware(
  session: RequestSiteSession,
  onRefused: (origin: string) => void
) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (isRequestFromSession(req.headers, session)) {
      next()

      return
    }

    // An extension is known to the session only once it says hello, so its
    // refusal is not printed as a page from outside.
    if (!isExtensionOrigin(req.headers.origin)) {
      onRefused(refusedRequestOrigin(req.headers))
    }

    res.statusCode = 403
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Vary', 'Origin, Sec-Fetch-Site')
    res.end(REFUSED_REQUEST_RESPONSE)
  }
}

// Takes the stock check's place, or the slot right after the host check, so
// it runs before any file is served.
export function withRequestSiteMiddleware<T>(
  middlewares: T[],
  session: RequestSiteSession,
  onRefused: (origin: string) => void
): T[] {
  const entry = {
    name: REQUEST_SITE_MIDDLEWARE_NAME,
    middleware: createRequestSiteMiddleware(session, onRefused)
  } as unknown as T
  const indexOf = (name: string) =>
    middlewares.findIndex((item) => (item as {name?: string})?.name === name)
  const stock = indexOf(REQUEST_SITE_MIDDLEWARE_NAME)

  if (stock !== -1) {
    return middlewares.map((item, position) =>
      position === stock ? entry : item
    )
  }

  const after = indexOf(HOST_CHECK_MIDDLEWARE_NAME) + 1

  return [...middlewares.slice(0, after), entry, ...middlewares.slice(after)]
}

// The HTTP surface one session needs and no more: the Host check names the
// hosts clients actually dial, and allow-origin is reflected, never starred.
export function devServerAccessConfig(options: {
  connectableHost: string
  emulatorOrigin?: string | null
  allowedHosts?: unknown
  isSessionExtensionOrigin: SessionExtensionOriginCheck
  // The bind host and port, which decide the origins the session calls its own.
  host?: string
  port?: number
}): {
  allowedHosts: string[]
  headers: (req: IncomingMessage) => Array<{key: string; value: string}>
  requestSite: RequestSiteSession
} {
  const viewerOrigin = normalizeWebOrigin(options.emulatorOrigin)
  const viewerHost = viewerOrigin ? new URL(viewerOrigin).hostname : null
  const allowedWebOrigins = viewerOrigin ? [viewerOrigin] : []
  const namedHosts = parseAllowedHosts(options.allowedHosts)
  const hosts = [options.connectableHost, viewerHost, ...namedHosts].filter(
    (host): host is string => Boolean(host)
  )
  const bind = bareHostName(String(options.host ?? ''))
  const answersOnLoopback =
    isWildcardHost(options.host) || LOOPBACK_NAMES.includes(bind)
  const sessionHosts = [
    bareHostName(options.connectableHost),
    ...(answersOnLoopback ? LOOPBACK_NAMES : [])
  ]

  return {
    allowedHosts: [...new Set(hosts)],
    headers: (req) =>
      devServerCorsHeaders(
        req.headers.origin,
        allowedWebOrigins,
        options.isSessionExtensionOrigin
      ),
    requestSite: {
      port: Number(options.port ?? 0),
      sessionHosts: [...new Set(sessionHosts)],
      namedHosts,
      allowedWebOrigins,
      isSessionExtensionOrigin: options.isSessionExtensionOrigin
    }
  }
}
