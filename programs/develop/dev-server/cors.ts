// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {IncomingMessage, ServerResponse} from 'node:http'
import {isSameWebOrigin, normalizeWebOrigin} from './emulator-lane'

// chrome-extension://, moz-extension://, safari-web-extension://: the scheme
// the extension's own pages fetch their hot updates from.
const EXTENSION_ORIGIN = /^[a-z][a-z0-9+.-]*-extension:\/\/[^/]/i

export function isExtensionOrigin(value: unknown): boolean {
  return EXTENSION_ORIGIN.test(String(value ?? '').trim())
}

// The origin a response may be read by, null when the request carries none the
// session needs. A star let every page the developer visited read the whole
// compiled extension off loopback.
export function resolveAllowedCorsOrigin(
  requestOrigin: unknown,
  allowedWebOrigins: readonly (string | null | undefined)[] = []
): string | null {
  const origin = String(requestOrigin ?? '').trim()

  if (!origin) return null
  if (isExtensionOrigin(origin)) return origin

  for (const allowed of allowedWebOrigins) {
    if (isSameWebOrigin(origin, allowed)) return normalizeWebOrigin(origin)
  }

  return null
}

export function devServerCorsHeaders(
  requestOrigin: unknown,
  allowedWebOrigins: readonly (string | null | undefined)[] = []
): Array<{key: string; value: string}> {
  const headers = [{key: 'Vary', value: 'Origin'}]
  const allowed = resolveAllowedCorsOrigin(requestOrigin, allowedWebOrigins)

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

// The HTTP surface one session needs and no more: the Host check names the
// hosts clients actually dial, and allow-origin is reflected, never starred.
export function devServerAccessConfig(options: {
  connectableHost: string
  emulatorOrigin?: string | null
  allowedHosts?: unknown
}): {
  allowedHosts: string[]
  headers: (req: IncomingMessage) => Array<{key: string; value: string}>
} {
  const viewerOrigin = normalizeWebOrigin(options.emulatorOrigin)
  const viewerHost = viewerOrigin ? new URL(viewerOrigin).hostname : null
  const allowedWebOrigins = viewerOrigin ? [viewerOrigin] : []
  const hosts = [
    options.connectableHost,
    viewerHost,
    ...parseAllowedHosts(options.allowedHosts)
  ].filter((host): host is string => Boolean(host))

  return {
    allowedHosts: [...new Set(hosts)],
    headers: (req) =>
      devServerCorsHeaders(req.headers.origin, allowedWebOrigins)
  }
}
