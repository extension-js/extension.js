// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {createHash} from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  browserRowValue,
  card,
  claimCardKey,
  humanLine,
  isCardKeyClaimed
} from '../../helpers/messaging'
import type {BrowserType} from '../browsers-types'
import {isChromiumBrowser, isFirefoxBrowser} from './browser-family'
import * as messages from './messages'

type Info = {extensionId?: string; name?: string; version?: string} | null
type HostPort = {host?: string; port?: number | string}
type ReadyLike = {runId?: unknown; pid?: unknown} | null
type BinaryProvenance = 'managed' | 'pinned' | 'system' | 'snapshot'

const printedKeys = new Set<string>()

function readUpdateSuffixOnce() {
  const suffix = process.env.EXTENSION_CLI_UPDATE_SUFFIX

  if (!suffix) return null

  delete process.env.EXTENSION_CLI_UPDATE_SUFFIX

  return suffix
}

function keyFor(browser: BrowserType, outPath: string, hp?: HostPort) {
  const host = (hp?.host || '127.0.0.1').toString()
  const port = hp?.port == null ? '' : String(hp.port)

  return `${browser}::${path.resolve(outPath)}::${host}:${port}`
}

// The cross-bundle key omits host:port on purpose: build's card (printed in
// the develop bundle) must dedupe this bundle's later attempt for `start`.
function baseKeyFor(browser: BrowserType, outPath: string) {
  return `${browser}::${path.resolve(outPath)}`
}

function markCardPrinted(k: string, browser: BrowserType, outPath: string) {
  process.env.EXTENSION_CLI_BANNER_PRINTED = 'true'
  printedKeys.add(k)
  claimCardKey(baseKeyFor(browser, outPath))
}

function toNormalizedId(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function readReadyMetadata(readyPath?: string): ReadyLike {
  if (!readyPath) return null

  try {
    return JSON.parse(fs.readFileSync(readyPath, 'utf-8')) as ReadyLike
  } catch {
    return null
  }
}

function resolveRunLabel(ready: ReadyLike): string {
  const runId = toNormalizedId(ready?.runId)
  const pid =
    typeof ready?.pid === 'number' && Number.isFinite(ready.pid)
      ? String(ready.pid)
      : ''

  if (runId && pid) return `${runId} · PID ${pid}`
  if (runId) return runId
  if (pid) return `PID ${pid}`
  return ''
}

function encodeChromiumExtensionIdFromDigest(digest: Buffer): string {
  let extensionId = ''
  for (const byte of digest) {
    extensionId += String.fromCharCode(97 + ((byte >> 4) & 0x0f))
    extensionId += String.fromCharCode(97 + (byte & 0x0f))
  }
  return extensionId
}

function deriveChromiumExtensionIdFromManifest(manifest: unknown): string {
  const key = toNormalizedId((manifest as {key?: unknown})?.key)

  if (!key) return ''

  try {
    const decodedKey = Buffer.from(key.replace(/\s+/g, ''), 'base64')
    if (!decodedKey.length) return ''

    const digest = createHash('sha256')
      .update(decodedKey)
      .digest()
      .subarray(0, 16)

    return encodeChromiumExtensionIdFromDigest(digest)
  } catch {
    return ''
  }
}

// Mirror Chrome's id_util::GenerateIdForPath so unpacked extensions with no
// key and no runtime surface still get their real ID in the dev banner.
function deriveChromiumExtensionIdFromPath(extensionPath: string): string {
  if (!extensionPath || typeof extensionPath !== 'string') return ''

  try {
    const absolute = path.resolve(extensionPath)
    const isWindows = process.platform === 'win32'
    // Chrome on Windows hashes the wide-char path bytes (UTF-16LE) with
    // backslash separators; POSIX hashes the UTF-8 absolute path bytes.
    const seedBuffer = isWindows
      ? Buffer.from(absolute.replace(/\//g, '\\'), 'utf16le')
      : Buffer.from(absolute, 'utf8')
    const digest = createHash('sha256')
      .update(seedBuffer)
      .digest()
      .subarray(0, 16)

    return encodeChromiumExtensionIdFromDigest(digest)
  } catch {
    return ''
  }
}

function deriveFirefoxExtensionIdFromManifest(manifest: unknown): string {
  const fromBrowserSpecificSettings = toNormalizedId(
    (manifest as {browser_specific_settings?: {gecko?: {id?: unknown}}})
      ?.browser_specific_settings?.gecko?.id
  )
  if (fromBrowserSpecificSettings) return fromBrowserSpecificSettings

  return toNormalizedId(
    (manifest as {applications?: {gecko?: {id?: unknown}}})?.applications?.gecko
      ?.id
  )
}

// The id Chrome will give this unpacked dist: from `key` when the manifest
// pins one, otherwise the deterministic hash of the absolute path.
export function expectedChromiumExtensionId(outPath: string): string {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(outPath, 'manifest.json'), 'utf-8')
    )
    const fromKey = deriveChromiumExtensionIdFromManifest(manifest)
    if (fromKey) return fromKey
  } catch {
    // No readable manifest; the path hash is still well defined.
  }

  return deriveChromiumExtensionIdFromPath(outPath)
}

function resolveExtensionId(args: {
  browser: BrowserType
  info: Info
  fallback?: {extensionId?: string}
  manifest: unknown
  extensionPath?: string
}): string {
  const fromInfo = toNormalizedId(args.info?.extensionId)
  if (fromInfo) return fromInfo

  const fromFallback = toNormalizedId(args.fallback?.extensionId)
  if (fromFallback) return fromFallback

  if (isChromiumBrowser(args.browser)) {
    const fromKey = deriveChromiumExtensionIdFromManifest(args.manifest)
    if (fromKey) return fromKey
    return deriveChromiumExtensionIdFromPath(args.extensionPath || '')
  }

  if (isFirefoxBrowser(args.browser)) {
    return deriveFirefoxExtensionIdFromManifest(args.manifest)
  }

  return ''
}

export async function printDevBannerOnce(opts: {
  browser: BrowserType
  outPath: string
  hostPort?: HostPort
  getInfo: () => Promise<Info>
  fallback?: {name?: string; version?: string; extensionId?: string}
  browserVersionLine?: string
  profilePath?: string
  binaryPath?: string
  binaryProvenance?: BinaryProvenance
}) {
  const k = keyFor(opts.browser, opts.outPath, opts.hostPort)

  // A dedupe hit must still answer "is the guest nameable": the firefox
  // add-on install reads this boolean as its verification, not as a receipt.
  const alreadyPrinted =
    printedKeys.has(k) ||
    isCardKeyClaimed(baseKeyFor(opts.browser, opts.outPath))

  const manifestPath = path.join(opts.outPath, 'manifest.json')

  if (!fs.existsSync(manifestPath)) return false

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  const manifestDerivedExtensionId = resolveExtensionId({
    browser: opts.browser,
    info: null,
    fallback: opts.fallback,
    manifest,
    extensionPath: opts.outPath
  })

  if (alreadyPrinted && manifestDerivedExtensionId) return true

  // Prefer manifest/fallback IDs first so startup banner can render ASAP.
  // Runtime info is best-effort and should never stall the first banner.
  const info = manifestDerivedExtensionId
    ? await Promise.race<Info>([
        opts.getInfo().catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 250))
      ])
    : await opts.getInfo().catch(() => null)

  const extensionId = resolveExtensionId({
    browser: opts.browser,
    info,
    fallback: opts.fallback,
    manifest,
    extensionPath: opts.outPath
  })

  if (!extensionId) return false

  if (alreadyPrinted) return true

  const name = info?.name || opts.fallback?.name || manifest.name
  const version = info?.version || opts.fallback?.version || manifest.version

  const message = {
    data: {
      id: extensionId,
      management: {name, version}
    }
  }

  // Consume the update-suffix env var only once committed to printing: the
  // launch flow calls this twice and an early consume would lose the hint.
  const updateSuffix = readUpdateSuffixOnce()

  humanLine(messages.emptyLine())
  humanLine(
    messages.runningInDevelopment(
      manifest,
      opts.browser,
      message,
      opts.browserVersionLine,
      updateSuffix || undefined,
      {
        profilePath: opts.profilePath,
        binaryPath: opts.binaryPath,
        binaryProvenance: opts.binaryProvenance
      }
    )
  )
  humanLine(messages.emptyLine())
  markCardPrinted(k, opts.browser, opts.outPath)
  return true
}

export async function printProdBannerOnce(opts: {
  browser: BrowserType
  outPath: string
  browserVersionLine?: string
  runtime?: {extensionId?: string; name?: string; version?: string}
  includeExtensionId?: boolean
  readyPath?: string
  includeRunId?: boolean
  profilePath?: string
  binaryPath?: string
  binaryProvenance?: BinaryProvenance
}) {
  const k = keyFor(opts.browser, opts.outPath)

  // The pair already has its card: report that state as success so hoisted
  // callers print first and later, better-informed attempts stay quiet.
  if (
    printedKeys.has(k) ||
    isCardKeyClaimed(baseKeyFor(opts.browser, opts.outPath))
  ) {
    return true
  }

  const browserLabel = browserRowValue(
    String(opts.browser || 'unknown'),
    messages.resolveBrowserVersionLine(
      String(opts.browser || ''),
      opts.browserVersionLine
    )
  )

  try {
    const manifestPath = path.join(opts.outPath, 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    const ready = readReadyMetadata(opts.readyPath)
    const runLabel = opts.includeRunId ? resolveRunLabel(ready) : ''
    const runtimeInfo: Info = opts.runtime
      ? {
          extensionId: opts.runtime.extensionId,
          name: opts.runtime.name,
          version: opts.runtime.version
        }
      : null
    const resolvedExtensionId = resolveExtensionId({
      browser: opts.browser,
      info: runtimeInfo,
      manifest,
      extensionPath: opts.outPath
    })

    if (resolvedExtensionId) {
      const message = {
        data: {
          id: resolvedExtensionId,
          management: {
            name: opts.runtime?.name || manifest.name,
            version: opts.runtime?.version || manifest.version
          }
        }
      }

      // Read the suffix at the moment of printing, see printDevBannerOnce
      // for context. Avoids losing it across a try-catch fallback path.
      const updateSuffix = readUpdateSuffixOnce()
      humanLine(messages.emptyLine())
      humanLine(
        messages.runningInDevelopment(
          manifest,
          opts.browser,
          message,
          browserLabel,
          updateSuffix || undefined,
          {
            includeExtensionId: opts.includeExtensionId,
            runLabel,
            profilePath: opts.profilePath,
            binaryPath: opts.binaryPath,
            binaryProvenance: opts.binaryProvenance
          }
        )
      )
      humanLine(messages.emptyLine())
    } else {
      const message = {
        data: {
          id: '',
          management: {
            name: manifest.name,
            version: manifest.version
          }
        }
      }

      const updateSuffix = readUpdateSuffixOnce()
      humanLine(messages.emptyLine())
      humanLine(
        messages.runningInDevelopment(
          manifest,
          opts.browser,
          message,
          browserLabel,
          updateSuffix || undefined,
          {
            includeExtensionId: opts.includeExtensionId,
            runLabel,
            profilePath: opts.profilePath,
            binaryPath: opts.binaryPath,
            binaryProvenance: opts.binaryProvenance
          }
        )
      )
      humanLine(messages.emptyLine())
    }
  } catch {
    // Fallback: still print a minimal card from information already available;
    // don't consume the suffix, leave it for a better-informed later attempt.
    const provenanceNote = messages.binaryProvenanceNote(opts.binaryProvenance)
    humanLine(messages.emptyLine())
    humanLine(
      card({
        rows: [
          {
            label: 'Browser',
            value: provenanceNote
              ? `${browserLabel} ${provenanceNote}`
              : browserLabel
          },
          {
            label: 'Binary',
            value: provenanceNote
              ? messages.collapseHomeDirInCardValue(opts.binaryPath || '')
              : ''
          },
          {
            label: 'Output',
            value: messages.collapseHomeDirInCardValue(opts.outPath)
          },
          {
            label: 'Profile',
            value: messages.collapseHomeDirInCardValue(opts.profilePath || '')
          }
        ]
      })
    )
    humanLine(messages.emptyLine())
  }

  markCardPrinted(k, opts.browser, opts.outPath)
  return true
}
