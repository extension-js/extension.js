// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createHash} from 'node:crypto'
import * as fs from 'node:fs'
import type {IncomingMessage, ServerResponse} from 'node:http'
import * as path from 'node:path'

export const EMULATOR_FILES_PATH = '/__extjs-emulator/files.json'
export const EMULATOR_FILES_VERSION = 1 as const
export const EMULATOR_WIRE_VERSION = '1'
export const DEFAULT_EMULATOR_ORIGIN = 'https://browsers.extension.land'

export interface EmulatorFileEntry {
  path: string
  size: number
  sha256: string
}

export interface EmulatorFileIndex {
  version: typeof EMULATOR_FILES_VERSION
  instanceId: string
  root: '/'
  files: EmulatorFileEntry[]
}

export function normalizeWebOrigin(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  let url: URL

  try {
    url = new URL(raw)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null

  return url.origin
}

export function resolveEmulatorOrigin(
  env: NodeJS.ProcessEnv = process.env
): string {
  const configured = String(env.EXTENSION_EMULATOR_ORIGIN || '').trim()
  if (!configured) return DEFAULT_EMULATOR_ORIGIN

  const origin = normalizeWebOrigin(configured)

  if (!origin) {
    throw new Error(
      `EXTENSION_EMULATOR_ORIGIN must be an http or https origin, got: ${configured}`
    )
  }

  return origin
}

export function isSameWebOrigin(
  candidate: unknown,
  expected: string | null | undefined
): boolean {
  if (!expected) return false

  const left = normalizeWebOrigin(candidate)
  const right = normalizeWebOrigin(expected)

  return left !== null && left === right
}

export function buildEmulatorViewerUrl(options: {
  origin: string
  host: string
  port: number
  controlPort: number | null
  controlPath: string
  instanceId: string
}): string {
  const host = options.host.includes(':') ? `[${options.host}]` : options.host
  const params = new URLSearchParams()
  params.set('files', `http://${host}:${options.port}${EMULATOR_FILES_PATH}`)

  if (options.controlPort != null) {
    params.set(
      'control',
      `ws://${host}:${options.controlPort}${options.controlPath}`
    )
  }

  params.set('instance', options.instanceId)
  params.set('v', EMULATOR_WIRE_VERSION)

  return `${options.origin}/chromium/#${params.toString()}`
}

function isManifestTempFile(name: string): boolean {
  return name.startsWith('.manifest.') && name.endsWith('.tmp')
}

async function collectFiles(root: string, dir: string, out: string[]) {
  let entries: fs.Dirent[]

  try {
    entries = await fs.promises.readdir(dir, {withFileTypes: true})
  } catch {
    return
  }

  for (const entry of entries) {
    const absolute = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      await collectFiles(root, absolute, out)
    } else if (entry.isFile() && !isManifestTempFile(entry.name)) {
      out.push(absolute)
    }
  }
}

export async function buildEmulatorFileIndex(
  distPath: string,
  instanceId: string
): Promise<EmulatorFileIndex> {
  const absolutes: string[] = []
  await collectFiles(distPath, distPath, absolutes)

  const files: EmulatorFileEntry[] = []

  for (const absolute of absolutes) {
    let bytes: Buffer

    try {
      bytes = await fs.promises.readFile(absolute)
    } catch {
      continue
    }

    files.push({
      path: path.relative(distPath, absolute).split(path.sep).join('/'),
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')
    })
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  return {version: EMULATOR_FILES_VERSION, instanceId, root: '/', files}
}

export interface EmulatorFileIndexHolder {
  refresh(): Promise<EmulatorFileIndex>
  current(): Promise<EmulatorFileIndex>
}

export function createEmulatorFileIndexHolder(
  distPath: string,
  instanceId: string
): EmulatorFileIndexHolder {
  let latest: Promise<EmulatorFileIndex> | null = null

  const refresh = () => {
    latest = buildEmulatorFileIndex(distPath, instanceId)

    return latest
  }

  return {
    refresh,
    current: () => latest ?? refresh()
  }
}

export function createEmulatorFilesMiddleware(holder: EmulatorFileIndexHolder) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void
  ) => {
    const method = String(req.method || 'GET').toUpperCase()

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Private-Network', 'true')
    res.setHeader('Cache-Control', 'no-store')

    if (method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
      res.statusCode = 204
      res.end()

      return
    }

    if (method !== 'GET' && method !== 'HEAD') {
      next()

      return
    }

    try {
      const index = await holder.current()
      const body = JSON.stringify(index)
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Content-Length', Buffer.byteLength(body))
      res.end(method === 'HEAD' ? undefined : body)
    } catch (error) {
      next(error)
    }
  }
}
