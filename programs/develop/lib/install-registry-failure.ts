// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {stripVTControlCharacters} from 'node:util'

export type InstallFailure =
  // The packument names a version whose tarball answers 404.
  | {kind: 'tarball-not-served'; retry: true; packageSpec: string}
  // A range no listed version satisfies. Heals only when an upstream asked.
  | {kind: 'version-not-listed'; retry: boolean; packageSpec: string}
  // A reset, a timeout, a throttle or a 5xx answer.
  | {kind: 'registry-unavailable'; retry: true; detail: string}
  | {kind: 'permanent'; retry: false}

const PERMANENT: InstallFailure = {kind: 'permanent', retry: false}

// Auth, disk, permission and peer conflicts read the same on every attempt.
const CANNOT_HEAL = [
  /\bcode E40[13]\b/,
  /ERR_PNPM_FETCH_40[13]\b/,
  /Request failed "40[13] /,
  /^error Error: https?:\/\/\S+: (?:Unauthorized|Forbidden)\b/m,
  /^error: GET \S+ - 40[13]\b/m,
  /Bad response: 40[13]\b/,
  /\b(?:EACCES|EPERM|ENOSPC|EROFS|EDQUOT)\b/,
  /\bcode ERESOLVE\b/,
  /ERR_PNPM_PEER_DEP_ISSUES/,
  /minimum dependency (?:age|date)/
]

const TARBALL_URL = String.raw`(https?:\/\/\S+?\.tgz)`

const TARBALL_NOT_SERVED = [
  // npm
  new RegExp(`404 Not Found - GET ${TARBALL_URL}`),
  // pnpm up to 10
  new RegExp(`ERR_PNPM_FETCH_404\\s+GET ${TARBALL_URL}`),
  // pnpm 12
  new RegExp(`Tarball server returned HTTP 404 for ${TARBALL_URL}`),
  // yarn
  new RegExp(`${TARBALL_URL}: Request failed "404 Not Found"`),
  // bun
  new RegExp(`error: GET ${TARBALL_URL} - 404`),
  // deno
  new RegExp(`Could not find npm package tarball at: ${TARBALL_URL}`)
]

// Each pattern captures the package name first, then the range.
const VERSION_NOT_LISTED: Array<{pattern: RegExp; rangeFirst?: boolean}> = [
  // npm and pnpm
  {pattern: /No matching version found for (\S+)@([^\s@]+?)\.?(?:\s|$)/},
  // yarn
  {pattern: /Couldn't find any versions for "([^"]+)" that matches "([^"]+)"/},
  // bun
  {
    pattern: /No version matching "([^"]+)" found for specifier "([^"]+)"/,
    rangeFirst: true
  },
  // deno
  {pattern: /Could not find npm package '([^']+)' matching '([^']+)'/}
]

const REGISTRY_UNAVAILABLE: Array<{pattern: RegExp; detail: string}> = [
  {pattern: /\bcode E(5\d\d|429)\b/, detail: 'HTTP $1'},
  {pattern: /ERR_PNPM_FETCH_(5\d\d|429)\b/, detail: 'HTTP $1'},
  {pattern: /returned HTTP (5\d\d|429)\b/, detail: 'HTTP $1'},
  {pattern: /Request failed "(5\d\d|429) /, detail: 'HTTP $1'},
  {pattern: /^error: GET \S+ - (5\d\d|429)\b/m, detail: 'HTTP $1'},
  {pattern: /Bad response: (5\d\d|429)\b/, detail: 'HTTP $1'},
  {
    pattern:
      /\bECONNRESET\b|socket hang up|connection closed before message completed|\bConnectionClosed\b|\bConnectionReset\b|\bUND_ERR_SOCKET\b/,
    detail: 'connection reset'
  },
  {
    pattern:
      /\b(?:ETIMEDOUT|ESOCKETTIMEDOUT|ERR_SOCKET_TIMEOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT)\b/,
    detail: 'timeout'
  },
  {pattern: /\bEAI_AGAIN\b/, detail: 'DNS lookup failed'}
]

// Newer pnpm wraps its report at 80 columns behind a tree gutter, splitting a
// URL or a package name at a hyphen or a slash. Rejoin what it split.
function unwrap(output: string): string {
  return stripVTControlCharacters(output)
    .replace(/([-/])[ \t]*\r?\n[ \t]*[│├╰─▶]*[ \t]+(?=\S)/g, '$1')
    .replace(/[ \t]*\r?\n[ \t]*[│├╰─▶]+[ \t]+(?=\S)/g, ' ')
}

// <registry>/@scope/name/-/name-1.2.3.tgz reads back as @scope/name@1.2.3.
export function packageSpecFromTarballUrl(url: string): string {
  let pathname = url

  try {
    pathname = decodeURIComponent(new URL(url).pathname)
  } catch {
    // Not a URL the runtime can parse. The raw text is still worth naming.
  }

  const [before, file] = pathname.split('/-/')
  if (!file) return url

  const segments = before.split('/').filter(Boolean)
  const base = segments[segments.length - 1] || ''
  const scope = segments[segments.length - 2]
  const name = scope?.startsWith('@') ? `${scope}/${base}` : base
  const version = file.replace(/\.tgz$/, '').slice(base.length + 1)

  return name && version ? `${name}@${version}` : url
}

// Reads what the package manager printed. A failure nothing here names is
// permanent, so an unknown error is reported once and never waited on.
export function classifyInstallFailure(
  output: string,
  options?: {directDependencies?: string[]}
): InstallFailure {
  const text = unwrap(String(output || ''))
  if (!text.trim()) return PERMANENT

  if (CANNOT_HEAL.some((pattern) => pattern.test(text))) return PERMANENT

  for (const pattern of TARBALL_NOT_SERVED) {
    const match = pattern.exec(text)

    if (match) {
      return {
        kind: 'tarball-not-served',
        retry: true,
        packageSpec: packageSpecFromTarballUrl(match[1])
      }
    }
  }

  for (const {pattern, rangeFirst} of VERSION_NOT_LISTED) {
    const match = pattern.exec(text)
    if (!match) continue

    const name = rangeFirst ? match[2] : match[1]
    const range = rangeFirst ? match[1] : match[2]
    // A range the project itself wrote is the author's to fix. One an
    // upstream package wrote is a release that has not fully landed.
    const direct = (options?.directDependencies || []).includes(name)

    return {
      kind: 'version-not-listed',
      retry: !direct,
      packageSpec: `${name}@${range}`
    }
  }

  for (const {pattern, detail} of REGISTRY_UNAVAILABLE) {
    const match = pattern.exec(text)

    if (match) {
      return {
        kind: 'registry-unavailable',
        retry: true,
        detail: detail.replace('$1', match[1] || '')
      }
    }
  }

  return PERMANENT
}
