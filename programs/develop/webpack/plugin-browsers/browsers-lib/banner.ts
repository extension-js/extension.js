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
import * as messages from './messages'
import * as coreMessages from '../../webpack-lib/messages'
import {markBannerPrinted} from './shared-state'
import type {DevOptions} from '../../webpack-types'

type Info = {extensionId?: string; name?: string; version?: string} | null
type HostPort = {host?: string; port?: number | string}

const printedKeys = new Set<string>()

function readUpdateSuffixOnce() {
  const suffix = process.env.EXTENSION_CLI_UPDATE_SUFFIX

  if (!suffix) return null

  delete process.env.EXTENSION_CLI_UPDATE_SUFFIX

  return suffix
}

function keyFor(
  browser: DevOptions['browser'],
  outPath: string,
  hp?: HostPort
) {
  const host = (hp?.host || '127.0.0.1').toString()
  const port = hp?.port == null ? '' : String(hp.port)

  return `${browser}::${path.resolve(outPath)}::${host}:${port}`
}

function toNormalizedId(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function deriveChromiumExtensionIdFromManifest(manifest: unknown): string {
  const key = toNormalizedId((manifest as {key?: unknown})?.key)

  if (!key) return ''

  try {
    const decodedKey = Buffer.from(key.replace(/\s+/g, ''), 'base64')
    if (!decodedKey.length) return ''

    const digest = createHash('sha256').update(decodedKey).digest().subarray(0, 16)
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
    (manifest as {applications?: {gecko?: {id?: unknown}}})?.applications
      ?.gecko?.id
  )
}

function resolveExtensionId(args: {
  browser: DevOptions['browser']
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
  browser: DevOptions['browser']
  outPath: string
  hostPort?: HostPort
  getInfo: () => Promise<Info>
  fallback?: {name?: string; version?: string; extensionId?: string}
  browserVersionLine?: string
}) {
  const k = keyFor(opts.browser, opts.outPath, opts.hostPort)

  if (printedKeys.has(k)) return false

  const info = (await opts.getInfo()) || null
  const manifestPath = path.join(opts.outPath, 'manifest.json')
  const updateSuffix = readUpdateSuffixOnce()

  if (!fs.existsSync(manifestPath)) return false

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
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
  browser: DevOptions['browser']
  outPath: string
  browserVersionLine?: string
  runtime?: {extensionId?: string; name?: string; version?: string}
  includeExtensionId?: boolean
}) {
  const k = keyFor(opts.browser, opts.outPath)

  if (printedKeys.has(k)) return false

  const browserLabel =
    opts.browserVersionLine && opts.browserVersionLine.trim().length > 0
      ? opts.browserVersionLine.trim()
      : String(opts.browser || 'unknown')
  const updateSuffix = readUpdateSuffixOnce()

  try {
    const manifestPath = path.join(opts.outPath, 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

    if (opts.runtime && opts.runtime.extensionId) {
      const message = {
        data: {
          id: opts.runtime.extensionId,
          management: {
            name: opts.runtime.name || manifest.name,
            version: opts.runtime.version || manifest.version
          }
        }
      }

      console.log(messages.emptyLine())
      console.log(
        messages.runningInDevelopment(
          manifest,
          opts.browser,
          message,
          browserLabel,
          updateSuffix || undefined,
          {includeExtensionId: opts.includeExtensionId}
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

      console.log(messages.emptyLine())
      console.log(
        messages.runningInDevelopment(
          manifest,
          opts.browser,
          message,
          browserLabel,
          updateSuffix || undefined,
          {includeExtensionId: opts.includeExtensionId}
        )
      )
      console.log(messages.emptyLine())
    }
  } catch {
    // Fallback: if anything goes wrong, still try to print a minimal card
    console.log(messages.emptyLine())
    console.log(coreMessages.runningInProduction(opts.outPath, browserLabel))
    console.log(messages.emptyLine())
  }

  markBannerPrinted()
  process.env.EXTENSION_CLI_BANNER_PRINTED = 'true'

  printedKeys.add(k)
  return true
}
