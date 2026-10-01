// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {IncomingMessage} from 'node:http'
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

// The HTTP surface one session needs and no more: the Host check names the
// host clients actually dial, and allow-origin is reflected, never starred.
export function devServerAccessConfig(options: {
  connectableHost: string
  emulatorOrigin?: string | null
}): {
  allowedHosts: string[]
  headers: (req: IncomingMessage) => Array<{key: string; value: string}>
} {
  const viewerOrigin = normalizeWebOrigin(options.emulatorOrigin)
  const viewerHost = viewerOrigin ? new URL(viewerOrigin).hostname : null
  const allowedWebOrigins = viewerOrigin ? [viewerOrigin] : []
  const hosts = [options.connectableHost, viewerHost].filter(
    (host): host is string => Boolean(host)
  )

  return {
    allowedHosts: hosts,
    headers: (req) =>
      devServerCorsHeaders(req.headers.origin, allowedWebOrigins)
  }
}
