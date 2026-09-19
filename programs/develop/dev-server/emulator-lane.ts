// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createHash} from 'node:crypto'
import type {IncomingMessage, ServerResponse} from 'node:http'

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
  livereload?: {path: string}
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

export interface EmulatorAssetLike {
  name: string
  source: {buffer(): Buffer}
  info?: {
    hotModuleReplacement?: boolean
    related?: Record<string, string | string[] | undefined>
  }
}

function hotModuleReplacementNames(assets: readonly EmulatorAssetLike[]) {
  const names = new Set<string>()

  for (const asset of assets) {
    if (!asset.info?.hotModuleReplacement) continue

    names.add(asset.name)

    for (const related of Object.values(asset.info.related || {})) {
      for (const name of ([] as Array<string | undefined>).concat(related)) {
        if (name) names.add(name)
      }
    }
  }

  return names
}

function isServableAssetName(name: string): boolean {
  if (!name || name.startsWith('/') || name.includes('\\')) return false

  return !/(?:^|\/)\.\.(?:\/|$)/.test(name)
}

function servedAssetPath(name: string): string {
  return name
    .split('/')
    .filter(
      (segment, index) => segment !== '' && !(segment === '.' && index > 0)
    )
    .join('/')
}

export function buildEmulatorFileIndex(
  assets: Iterable<EmulatorAssetLike>,
  instanceId: string
): EmulatorFileIndex {
  const list = Array.from(assets)
  const hotNames = hotModuleReplacementNames(list)
  const files: EmulatorFileEntry[] = []

  const listed = new Set<string>()

  for (const asset of list) {
    const name = String(asset.name || '')
    if (!isServableAssetName(name) || hotNames.has(name)) continue

    const servedPath = servedAssetPath(name)
    if (!servedPath || listed.has(servedPath)) continue

    listed.add(servedPath)

    const bytes = asset.source.buffer()

    files.push({
      path: servedPath,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')
    })
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  return {version: EMULATOR_FILES_VERSION, instanceId, root: '/', files}
}

export function resolveLivereloadPath(webSocketServer: unknown): string | null {
  if (!webSocketServer || typeof webSocketServer !== 'object') return null

  const options = (webSocketServer as {options?: {path?: unknown}}).options
  const socketPath = options?.path

  return typeof socketPath === 'string' && socketPath.startsWith('/')
    ? socketPath
    : null
}

export interface EmulatorFileIndexHolder {
  publish(assets: Iterable<EmulatorAssetLike>): EmulatorFileIndex
  reset(): void
  setLivereloadPath(socketPath: string | null): void
  current(): Promise<EmulatorFileIndex>
}

export function createEmulatorFileIndexHolder(
  instanceId: string
): EmulatorFileIndexHolder {
  let latest: EmulatorFileIndex | null = null
  let livereloadPath: string | null = null
  let waiters: Array<(index: EmulatorFileIndex) => void> = []

  const withLivereload = (index: EmulatorFileIndex): EmulatorFileIndex =>
    livereloadPath
      ? {
          version: index.version,
          instanceId: index.instanceId,
          root: index.root,
          livereload: {path: livereloadPath},
          files: index.files
        }
      : index

  return {
    publish(assets) {
      latest = buildEmulatorFileIndex(assets, instanceId)
      const ready = waiters
      waiters = []

      for (const resolve of ready) resolve(withLivereload(latest))

      return withLivereload(latest)
    },
    reset() {
      latest = null
    },
    setLivereloadPath(socketPath) {
      livereloadPath = socketPath
    },
    current() {
      if (latest) return Promise.resolve(withLivereload(latest))

      return new Promise((resolve) => {
        waiters.push(resolve)
      })
    }
  }
}

interface EmulatorCompilerLike {
  hooks?: {
    done?: {
      tap(
        options: {name: string; stage?: number},
        fn: (stats: {
          compilation: {
            errors?: unknown[]
            getAssets(): readonly EmulatorAssetLike[]
          }
        }) => void
      ): void
    }
  }
}

export function attachEmulatorFileIndex(
  compiler: unknown,
  holder: EmulatorFileIndexHolder
) {
  const done = (compiler as EmulatorCompilerLike | undefined)?.hooks?.done
  if (!done) return

  holder.reset()

  done.tap({name: 'extjs-emulator-files', stage: -100}, (stats) => {
    if (stats.compilation.errors?.length) return

    holder.publish(stats.compilation.getAssets())
  })
}

export function createEmulatorFilesMiddlewareEntry(
  holder: EmulatorFileIndexHolder,
  devServer: unknown
) {
  const options = (devServer as {options?: {webSocketServer?: unknown}})
    ?.options

  holder.setLivereloadPath(resolveLivereloadPath(options?.webSocketServer))

  return {
    name: 'extjs-emulator-files',
    path: EMULATOR_FILES_PATH,
    middleware: createEmulatorFilesMiddleware(holder)
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
