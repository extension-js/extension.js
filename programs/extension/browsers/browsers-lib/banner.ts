// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {createHash} from 'crypto'
import colors from 'pintor'
import * as messages from './messages'
import type {BrowserType} from '../browsers-types'

// Inline shared-state flag: in the standalone browser package we only need
// the boolean so other modules can query whether the banner was already
// emitted during this process lifetime.
let bannerPrinted = false
export const BANNER_PRINTED_EVENT = 'extensionjs:banner-printed'
function markBannerPrinted() {
  bannerPrinted = true
  // Cross-package signal so develop's shared-state can flush any compile
  // line that arrived before the banner was visible. Without this, the
  // first deferred line stays parked until the next `done` hook, which
  // makes the initial run silent and double-prints on first reload.
  ;(process as any).emit(BANNER_PRINTED_EVENT)
}
export function isBannerPrinted(): boolean {
  return bannerPrinted
}

type Info = {extensionId?: string; name?: string; version?: string} | null
type HostPort = {host?: string; port?: number | string}
type ReadyLike = {runId?: unknown; pid?: unknown} | null

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
    let extensionId = ''

    for (const byte of digest) {
      extensionId += String.fromCharCode(97 + ((byte >> 4) & 0x0f))
      extensionId += String.fromCharCode(97 + (byte & 0x0f))
    }

    return extensionId
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

function resolveExtensionId(args: {
  browser: BrowserType
  info: Info
  fallback?: {extensionId?: string}
  manifest: unknown
}): string {
  const fromInfo = toNormalizedId(args.info?.extensionId)
  if (fromInfo) return fromInfo

  const fromFallback = toNormalizedId(args.fallback?.extensionId)
  if (fromFallback) return fromFallback

  if (
    args.browser === 'chrome' ||
    args.browser === 'edge' ||
    args.browser === 'chromium' ||
    args.browser === 'chromium-based'
  ) {
    return deriveChromiumExtensionIdFromManifest(args.manifest)
  }

  if (args.browser === 'firefox' || args.browser === 'firefox-based') {
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
}) {
  const k = keyFor(opts.browser, opts.outPath, opts.hostPort)

  if (printedKeys.has(k)) return false

  const manifestPath = path.join(opts.outPath, 'manifest.json')

  if (!fs.existsSync(manifestPath)) return false

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  const manifestDerivedExtensionId = resolveExtensionId({
    browser: opts.browser,
    info: null,
    fallback: opts.fallback,
    manifest
  })

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
    manifest
  })

  if (!extensionId) return false

  const name = info?.name || opts.fallback?.name || manifest.name
  const version = info?.version || opts.fallback?.version || manifest.version

  const message = {
    data: {
      id: extensionId,
      management: {name, version}
    }
  }

  // Consume the update-suffix env var only at the moment we're committed
  // to printing. Earlier in the function we may bail (manifest not yet on
  // disk, extensionId not yet derivable) — Chromium's launch flow calls
  // this twice on the same process: an early call before the manifest is
  // stable that would early-return, and a later one after CDP wires up.
  // If we consumed the suffix at the top, the early call would delete it
  // and the visible banner would lose the "(version X.Y.Z is available!)"
  // hint. Reading it here, after every early-return, makes both browsers
  // surface the suffix consistently.
  const updateSuffix = readUpdateSuffixOnce()

  console.log(messages.emptyLine())
  console.log(
    messages.runningInDevelopment(
      manifest,
      opts.browser,
      message,
      opts.browserVersionLine,
      updateSuffix || undefined
    )
  )
  console.log(messages.emptyLine())
  markBannerPrinted()
  process.env.EXTENSION_CLI_BANNER_PRINTED = 'true'

  printedKeys.add(k)
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
}) {
  const k = keyFor(opts.browser, opts.outPath)

  if (printedKeys.has(k)) return false

  const browserLabel =
    opts.browserVersionLine && opts.browserVersionLine.trim().length > 0
      ? opts.browserVersionLine.trim()
      : String(opts.browser || 'unknown')

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
      manifest
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

      // Read the suffix at the moment of printing — see printDevBannerOnce
      // for context. Avoids losing it across a try-catch fallback path.
      const updateSuffix = readUpdateSuffixOnce()
      console.log(messages.emptyLine())
      console.log(
        messages.runningInDevelopment(
          manifest,
          opts.browser,
          message,
          browserLabel,
          updateSuffix || undefined,
          {
            includeExtensionId: opts.includeExtensionId,
            runLabel
          }
        )
      )
      console.log(messages.emptyLine())
    } else {
      // Fallback: manifest-only summary using the unified dev/preview layout.
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
      console.log(messages.emptyLine())
      console.log(
        messages.runningInDevelopment(
          manifest,
          opts.browser,
          message,
          browserLabel,
          updateSuffix || undefined,
          {
            includeExtensionId: opts.includeExtensionId,
            runLabel
          }
        )
      )
      console.log(messages.emptyLine())
    }
  } catch {
    // Fallback: if anything goes wrong, still try to print a minimal card.
    // We cannot re-read the manifest here (it likely failed above), so we
    // print a short summary using only the information already available.
    // Don't consume the suffix on this path — leave it for a later
    // banner attempt that has more information to work with.
    console.log(messages.emptyLine())
    console.log(
      ` 🧩 ${colors.brightBlue('Extension.js')}\n` +
        `    Browser        ${colors.gray(browserLabel)}\n` +
        `    Output         ${colors.gray(opts.outPath)}`
    )
    console.log(messages.emptyLine())
  }

  markBannerPrinted()
  process.env.EXTENSION_CLI_BANNER_PRINTED = 'true'

  printedKeys.add(k)
  return true
}
