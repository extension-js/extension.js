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
import {isGeckoBasedBrowser} from './constants'
import {stripBom} from './parse-json-safe'

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

export function chromiumExtensionIdFromKey(manifestKey: string): string {
  const decoded = Buffer.from(manifestKey, 'base64')
  return idFromHash(createHash('sha256').update(decoded).digest())
}

// Chromium hashes the profile-registered directory path for unpacked
// extensions without a key; on Windows it lowercases ASCII and hashes UTF-16LE.
export function chromiumExtensionIdFromPath(extensionDir: string): string {
  const absolute = path.resolve(extensionDir)
  const bytes =
    process.platform === 'win32'
      ? Buffer.from(
          absolute.replace(/[A-Z]/g, (char) => char.toLowerCase()),
          'utf16le'
        )
      : Buffer.from(absolute, 'utf8')
  return idFromHash(createHash('sha256').update(bytes).digest())
}

function readManifest(extensionDir: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(
      path.join(extensionDir, 'manifest.json'),
      'utf-8'
    )
    const parsed = JSON.parse(stripBom(raw))
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

export function geckoExtensionId(extensionDir: string): string | undefined {
  const manifest = readManifest(extensionDir)
  const settings = (manifest?.browser_specific_settings ??
    manifest?.applications) as {gecko?: {id?: unknown}} | undefined
  const id = settings?.gecko?.id
  return typeof id === 'string' && id.trim().length > 0 ? id : undefined
}

export function managedExtensionRecords(
  browser: string,
  extensionDirs: string[]
): ManagedExtensionRecord[] {
  const gecko = isGeckoBasedBrowser(browser)
  return extensionDirs.map((dir) => {
    const absolute = path.resolve(dir)
    const id = gecko
      ? geckoExtensionId(absolute)
      : chromiumExtensionId(absolute)
    return id ? {path: absolute, id} : {path: absolute}
  })
}
