// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createHash} from 'node:crypto'
import * as os from 'node:os'
import * as path from 'node:path'

export interface TokenExpiry {
  at: Date
  expired: boolean
}

// A link wrapped by a terminal comes back with spaces inside it, and no url
// carries literal whitespace, so dropping it restores what was copied.
export function repairPastedUrl(url: string): {url: string; repaired: boolean} {
  const repaired = url.replace(/\s+/g, '')

  return {url: repaired, repaired: repaired !== url}
}

function expClaim(segment: string): number | undefined {
  try {
    const parsed = JSON.parse(
      Buffer.from(segment, 'base64url').toString('utf-8')
    ) as {exp?: unknown} | null
    const exp = parsed?.exp

    if (typeof exp === 'number' && Number.isFinite(exp)) return exp
    if (typeof exp === 'string' && /^\d+$/.test(exp)) return Number(exp)
  } catch {
    // Not a JSON record: the segment is a signature or an opaque token.
  }

  return undefined
}

// The expiry a share token carries when it is a JWT or a base64 JSON record
// with an exp claim. Any other token reads as one with no known expiry.
export function tokenExpiry(
  url: string,
  now = Date.now()
): TokenExpiry | undefined {
  let params: URLSearchParams

  try {
    params = new URL(url).searchParams
  } catch {
    return undefined
  }

  for (const name of ['t', 'token']) {
    const value = params.get(name)

    if (!value) continue

    for (const segment of value.split('.')) {
      const exp = expClaim(segment)

      if (exp === undefined) continue

      const ms = exp > 1e12 ? exp : exp * 1000

      return {at: new Date(ms), expired: ms <= now}
    }
  }

  return undefined
}

// Where previewed archives land: under the user's cache, never the folder
// the command happened to run from.
export function remoteArchiveCacheRoot(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  const xdg = String(env.XDG_CACHE_HOME || '').trim()

  if (xdg) return path.join(xdg, 'extension.js', 'previews')

  const home = String(env.HOME || env.USERPROFILE || '').trim() || os.homedir()

  if (home) {
    return platform === 'darwin'
      ? path.join(home, 'Library', 'Caches', 'extension.js', 'previews')
      : path.join(home, '.cache', 'extension.js', 'previews')
  }

  return path.resolve(process.cwd(), '.cache', 'extension.js', 'previews')
}

// One folder per archive: the url path spelled out, then a digest of the
// host and path, so two archives that share a name never share a folder.
export function remoteArchiveCacheKey(url: string): string {
  const parsed = new URL(url)
  const pathname = parsed.pathname.replace(/\.zip$/i, '')
  const slug =
    pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => segment.replace(/[^A-Za-z0-9._-]+/g, '-'))
      .join('-')
      .replace(/^[.-]+/, '')
      .slice(0, 80) || 'archive'
  const digest = createHash('sha256')
    .update(`${parsed.host}${parsed.pathname}`)
    .digest('hex')
    .slice(0, 8)

  return `${slug}-${digest}`
}
