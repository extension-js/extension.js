// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createHash} from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {isGeckoBasedBrowser, isWebkitBasedBrowser} from './constants'
import {parseAuthoredJson} from './parse-json-safe'

export interface ManagedExtensionRecord {
  path: string
  id?: string
}

// Chromium spells extension IDs in an a-p alphabet: each hex digit of the
// first 16 hash bytes maps to a letter (0 -> a, f -> p).
function idFromHash(hash: Buffer): string {
  const hex = hash.subarray(0, 16).toString('hex')
  let id = ''

  for (const char of hex) {
    id += String.fromCharCode('a'.charCodeAt(0) + parseInt(char, 16))
  }

  return id
}

// Chrome registers the absolute directory as given on Windows, and with
// symlinks resolved elsewhere (macOS keeps temp dirs under /var, a link to
// /private/var), so the id must come from the path Chrome will hash.
function registeredDirectoryPath(
  dir: string,
  platform: NodeJS.Platform
): string {
  const absolute = path.resolve(dir)
  if (platform === 'win32') return absolute

  try {
    return fs.realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

function upperCaseDriveLetter(windowsPath: string): string {
  return /^[a-z]:/.test(windowsPath)
    ? windowsPath[0].toUpperCase() + windowsPath.slice(1)
    : windowsPath
}

export function chromiumExtensionIdFromKey(manifestKey: string): string {
  const decoded = Buffer.from(manifestKey, 'base64')

  return idFromHash(createHash('sha256').update(decoded).digest())
}

// Chrome hashes the registered path as its native string: on Windows the
// UTF-16LE wide path with only a lowercase drive letter upper-cased, elsewhere
// the UTF-8 bytes unchanged.
export function chromiumExtensionIdFromRegisteredPath(
  registeredPath: string,
  platform: NodeJS.Platform = process.platform
): string {
  const bytes =
    platform === 'win32'
      ? Buffer.from(
          upperCaseDriveLetter(registeredPath.replace(/\//g, '\\')),
          'utf16le'
        )
      : Buffer.from(registeredPath, 'utf8')

  return idFromHash(createHash('sha256').update(bytes).digest())
}

export function chromiumExtensionIdFromPath(extensionDir: string): string {
  return chromiumExtensionIdFromRegisteredPath(
    registeredDirectoryPath(extensionDir, process.platform),
    process.platform
  )
}

function readManifest(extensionDir: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(
      path.join(extensionDir, 'manifest.json'),
      'utf-8'
    )
    const parsed = parseAuthoredJson(raw)

    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function chromiumExtensionId(extensionDir: string): string {
  const manifest = readManifest(extensionDir)
  const key = manifest?.key

  if (typeof key === 'string' && key.trim().length > 0) {
    try {
      return chromiumExtensionIdFromKey(key)
    } catch {
      // Ignore
    }
  }

  return chromiumExtensionIdFromPath(extensionDir)
}

const GECKO_ID_SHAPES = [
  /^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i,
  /^[a-z0-9-._]*@[a-z0-9-._]+$/i
]

export interface GeckoManifestId {
  // The authored value, whatever its type, or undefined when no key holds one.
  declared: unknown
  // The trimmed ID when Firefox accepts its shape.
  valid?: string
}

// Manifest V2 add-ons may still carry the ID under the older applications key.
export function readGeckoManifestId(
  manifest: Record<string, unknown> | null | undefined
): GeckoManifestId {
  let declared: unknown

  for (const key of ['browser_specific_settings', 'applications']) {
    const settings = manifest?.[key] as {gecko?: {id?: unknown}} | undefined
    declared = settings?.gecko?.id
    if (declared != null) break
  }

  // Firefox refuses a gecko.id in any other shape, so it names no add-on.
  const valid =
    typeof declared === 'string' &&
    GECKO_ID_SHAPES.some((shape) => shape.test(declared.trim()))
      ? declared.trim()
      : undefined

  return valid ? {declared, valid} : {declared}
}

export function geckoExtensionId(extensionDir: string): string | undefined {
  return readGeckoManifestId(readManifest(extensionDir)).valid
}

export function managedExtensionRecords(
  browser: string,
  extensionDirs: string[]
): ManagedExtensionRecord[] {
  const gecko = isGeckoBasedBrowser(browser)
  // Safari assigns identity at conversion time (the appex bundle id), so no
  // id is derivable from the directory and a chromium hash would be a lie.
  const webkit = isWebkitBasedBrowser(browser)

  return extensionDirs.map((dir) => {
    const absolute = path.resolve(dir)
    if (webkit) return {path: absolute}

    const id = gecko
      ? geckoExtensionId(absolute)
      : chromiumExtensionId(absolute)

    return id ? {path: absolute, id} : {path: absolute}
  })
}
